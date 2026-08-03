import { useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useAtom } from "jotai"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import {
	foldersAtom,
	libraryCollapsedFoldersAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"
import {
	FOLDER_DRAG_TYPE,
	VISUALS_DRAG_TYPE,
	canDropFolderOn,
	decodeFolderDrag,
	decodeVisualsDrag,
	encodeFolderDrag,
	encodeVisualsDrag,
	getCurrentDrag,
	rangeBetween,
	setCurrentDrag,
	visibleVisualOrder,
} from "../lib/folderDnd"

const newFolderId = () =>
	`fl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const FolderIcon = ({ open }: { open?: boolean }) => (
	<svg
		viewBox="0 0 16 16"
		width={14}
		height={14}
		aria-hidden="true"
		className="flex-shrink-0"
	>
		{open ? (
			<path
				d="M1 3.5A1.5 1.5 0 012.5 2h3.172a1.5 1.5 0 011.06.44l.829.828a.5.5 0 00.353.147H13.5A1.5 1.5 0 0115 4.914V5H1V3.5zM1 6h13.5a.5.5 0 01.49.598l-1.286 6.43A1.5 1.5 0 0112.23 14H3.77a1.5 1.5 0 01-1.474-1.222L1.01 6.348A.5.5 0 011 6z"
				fill="currentColor"
			/>
		) : (
			<path
				d="M1 3.5A1.5 1.5 0 012.5 2h3.172a1.5 1.5 0 011.06.44l.829.828a.5.5 0 00.353.147H13.5A1.5 1.5 0 0115 4.914V12.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"
				fill="currentColor"
			/>
		)}
	</svg>
)

const VisualIcon = () => (
	<svg
		viewBox="0 0 16 16"
		width={14}
		height={14}
		aria-hidden="true"
		className="flex-shrink-0"
	>
		<path
			d="M4 1.5A1.5 1.5 0 015.5 0h4.086a1.5 1.5 0 011.06.44l2.914 2.914a1.5 1.5 0 01.44 1.06V14.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 14.5v-13A1.5 1.5 0 014.5 0H5.5"
			fill="currentColor"
			opacity={0.7}
		/>
	</svg>
)

/** Shared drop-target behavior for folder rows and the "All visualizations"
 *  row. Uses the enter/leave depth-counter pattern from DataDrawer so
 *  hovering child elements doesn't flicker the highlight. `accepts` is
 *  checked against the module-level current drag (dataTransfer payloads are
 *  unreadable during dragover); the authoritative payload is re-read from
 *  dataTransfer at drop time. */
const useFolderDropTarget = ({
	accepts,
	onDropPayload,
}: {
	accepts: () => boolean
	onDropPayload: (e: React.DragEvent) => void
}) => {
	const [dropHover, setDropHover] = useState(false)
	const depth = useRef(0)
	return {
		dropHover,
		dropHandlers: {
			onDragEnter: (e: React.DragEvent) => {
				if (!accepts()) return
				e.preventDefault()
				depth.current += 1
				setDropHover(true)
			},
			onDragOver: (e: React.DragEvent) => {
				if (!accepts()) return
				e.preventDefault()
				e.dataTransfer.dropEffect = "move"
			},
			onDragLeave: () => {
				depth.current = Math.max(0, depth.current - 1)
				if (depth.current === 0) setDropHover(false)
			},
			onDrop: (e: React.DragEvent) => {
				e.preventDefault()
				e.stopPropagation()
				depth.current = 0
				setDropHover(false)
				onDropPayload(e)
				// A drop can remount the dragged row (it moved subtrees), and
				// browsers don't reliably fire dragend on a detached node — so
				// the source's own dragend can't be trusted to clear this.
				setCurrentDrag(null)
			},
		},
	}
}

/** Highlight for a row the current drag may drop onto. */
const DROP_HOVER_CLASS =
	"bg-blue-100 ring-1 ring-blue-400 dark:bg-blue-900/40 dark:ring-blue-500"

/** Replace the browser's default ghost (the full row, or a link preview)
 *  with a compact "N items" badge when dragging a multi-selection. The
 *  node must be in the document when setDragImage snapshots it; it's
 *  removed on the next tick. */
const setMultiDragImage = (dt: DataTransfer, count: number) => {
	const badge = document.createElement("div")
	badge.textContent = `${count} items`
	badge.style.cssText =
		"position:fixed;top:-100px;left:-100px;padding:2px 8px;" +
		"background:#1d4ed8;color:#fff;border-radius:4px;" +
		"font-size:12px;font-family:sans-serif;"
	document.body.appendChild(badge)
	dt.setDragImage(badge, 12, 12)
	setTimeout(() => badge.remove(), 0)
}

const VisualTreeItem = ({
	visual,
	depth,
	isSelected,
	onClick,
	onDragStart,
}: {
	visual: Visual
	depth: number
	isSelected: boolean
	onClick: (visualId: string, e: React.MouseEvent) => void
	onDragStart: (e: React.DragEvent) => void
}) => (
	<Link
		to="/editor/$visualId"
		params={{ visualId: visual.id }}
		className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm select-none ${
			isSelected
				? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200"
				: "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
		}`}
		style={{ paddingLeft: `${depth * 16 + 4}px` }}
		title={visual.name}
		data-selected={isSelected || undefined}
		// TanStack Router types the Link event as MouseEvent<"a">, which is
		// incompatible with React.MouseEvent<Element> in both directions;
		// the runtime object is an ordinary synthetic mouse event.
		onClick={(e) => onClick(visual.id, e as unknown as React.MouseEvent)}
		draggable
		onDragStart={(e) => onDragStart(e as unknown as React.DragEvent)}
		onDragEnd={() => setCurrentDrag(null)}
	>
		<span className="w-4 flex-shrink-0" />
		<VisualIcon />
		<span className="min-w-0 flex-1 truncate">{visual.name}</span>
	</Link>
)

type FolderTreeItemProps = {
	folder: Folder
	folders: Folder[]
	visuals: Visual[]
	selectedId: string | null
	onSelect: (id: string | null) => void
	onRename: (id: string, name: string) => void
	onDelete: (id: string) => void
	onCreateChild: (parentId: string) => void
	collapsedFolderIds: ReadonlySet<string>
	onToggleExpanded: (id: string) => void
	selectedVisualIds: ReadonlySet<string>
	onVisualClick: (visualId: string, e: React.MouseEvent) => void
	acceptsDropOn: (targetFolderId: string | null) => () => boolean
	onDropOn: (targetFolderId: string | null) => (e: React.DragEvent) => void
	onVisualDragStart: (visualId: string) => (e: React.DragEvent) => void
	depth: number
}

const FolderTreeItem = ({
	folder,
	folders,
	visuals,
	selectedId,
	onSelect,
	onRename,
	onDelete,
	onCreateChild,
	collapsedFolderIds,
	onToggleExpanded,
	selectedVisualIds,
	onVisualClick,
	acceptsDropOn,
	onDropOn,
	onVisualDragStart,
	depth,
}: FolderTreeItemProps) => {
	const expanded = !collapsedFolderIds.has(folder.id)
	const [editing, setEditing] = useState(false)
	const [editName, setEditName] = useState(folder.name)
	const { dropHover, dropHandlers } = useFolderDropTarget({
		accepts: acceptsDropOn(folder.id),
		onDropPayload: onDropOn(folder.id),
	})
	const children = folders.filter((f) => f.parentId === folder.id)
	const childVisuals = visuals.filter((v) => v.folderId === folder.id)
	const isSelected = selectedId === folder.id
	const hasExpandable = children.length > 0 || childVisuals.length > 0

	const commitRename = () => {
		const trimmed = editName.trim()
		if (trimmed && trimmed !== folder.name) {
			onRename(folder.id, trimmed)
		} else {
			setEditName(folder.name)
		}
		setEditing(false)
	}

	return (
		<div>
			<div
				className={`group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm select-none ${
					dropHover
						? DROP_HOVER_CLASS
						: isSelected
							? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200"
							: "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
				}`}
				style={{ paddingLeft: `${depth * 16 + 4}px` }}
				draggable={!editing}
				onDragStart={(e) => {
					if (editing) {
						e.preventDefault()
						return
					}
					e.dataTransfer.setData(FOLDER_DRAG_TYPE, encodeFolderDrag(folder.id))
					e.dataTransfer.effectAllowed = "move"
					setCurrentDrag({ kind: "folder", folderId: folder.id })
				}}
				onDragEnd={() => setCurrentDrag(null)}
				{...dropHandlers}
				onClick={() => onSelect(folder.id)}
				onKeyDown={(e) => {
					// Only when the row itself is focused — Enter inside the
					// rename input / expand button must not also select.
					if (e.target !== e.currentTarget) return
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault()
						onSelect(folder.id)
					}
				}}
				role="button"
				tabIndex={0}
			>
				{hasExpandable ? (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation()
							onToggleExpanded(folder.id)
						}}
						className="flex h-4 w-4 flex-shrink-0 items-center justify-center"
					>
						<svg
							viewBox="0 0 8 8"
							width={8}
							height={8}
							className={`transition-transform ${expanded ? "rotate-90" : ""}`}
						>
							<path d="M2 1l4 3-4 3z" fill="currentColor" />
						</svg>
					</button>
				) : (
					<span className="w-4 flex-shrink-0" />
				)}
				<FolderIcon open={isSelected} />
				{editing ? (
					<input
						type="text"
						value={editName}
						onChange={(e) => setEditName(e.target.value)}
						onBlur={commitRename}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitRename()
							if (e.key === "Escape") {
								setEditName(folder.name)
								setEditing(false)
							}
						}}
						onClick={(e) => e.stopPropagation()}
						// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the inline rename editor the user just opened
						autoFocus
						className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0 text-sm outline-none dark:bg-stone-900"
					/>
				) : (
					<span
						className="min-w-0 flex-1 truncate"
						onDoubleClick={(e) => {
							e.stopPropagation()
							setEditing(true)
							setEditName(folder.name)
						}}
					>
						{folder.name}
					</span>
				)}
				<div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation()
							onCreateChild(folder.id)
						}}
						className="rounded p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-white"
						title="New subfolder"
					>
						<svg viewBox="0 0 12 12" width={10} height={10}>
							<path
								d="M6 2v8M2 6h8"
								stroke="currentColor"
								strokeWidth={1.5}
								strokeLinecap="round"
							/>
						</svg>
					</button>
					{!hasExpandable && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation()
								onDelete(folder.id)
							}}
							className="rounded p-0.5 text-stone-400 hover:text-red-600 dark:hover:text-red-400"
							title="Delete folder"
						>
							<svg viewBox="0 0 12 12" width={10} height={10}>
								<path
									d="M3 3l6 6M9 3l-6 6"
									stroke="currentColor"
									strokeWidth={1.5}
									strokeLinecap="round"
								/>
							</svg>
						</button>
					)}
				</div>
			</div>
			{expanded && (
				<>
					{children
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((child) => (
							<FolderTreeItem
								key={child.id}
								folder={child}
								folders={folders}
								visuals={visuals}
								selectedId={selectedId}
								onSelect={onSelect}
								onRename={onRename}
								onDelete={onDelete}
								onCreateChild={onCreateChild}
								collapsedFolderIds={collapsedFolderIds}
								onToggleExpanded={onToggleExpanded}
								selectedVisualIds={selectedVisualIds}
								onVisualClick={onVisualClick}
								acceptsDropOn={acceptsDropOn}
								onDropOn={onDropOn}
								onVisualDragStart={onVisualDragStart}
								depth={depth + 1}
							/>
						))}
					{childVisuals
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((v) => (
							<VisualTreeItem
								key={v.id}
								visual={v}
								depth={depth + 1}
								isSelected={selectedVisualIds.has(v.id)}
								onClick={onVisualClick}
								onDragStart={onVisualDragStart(v.id)}
							/>
						))}
				</>
			)}
		</div>
	)
}

export const FolderTree = ({
	selectedFolderId,
	onSelect,
}: {
	selectedFolderId: string | null
	onSelect: (id: string | null) => void
}) => {
	const [folders, setFolders] = useAtom(foldersAtom)
	const [visuals, setVisuals] = useAtom(visualsAtom)

	// Expansion is lifted (rather than per-item useState) because shift-click
	// range selection needs the flat visible row order, which depends on
	// which folders are collapsed. It lives in a persisted atom so the tree
	// keeps its shape across editor round-trips and reloads. Default:
	// everything expanded, as before.
	const [collapsedFolderIds, setCollapsedFolderIds] = useAtom(
		libraryCollapsedFoldersAtom
	)
	const toggleFolderExpanded = (id: string) => {
		setCollapsedFolderIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	// Sidebar-local multi-selection of visual rows, for drag-as-a-set.
	// Ephemeral: not synced with the grid checkboxes, cleared after a drop.
	const [selectedVisualIds, setSelectedVisualIds] = useState<
		ReadonlySet<string>
	>(new Set())
	const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
		null
	)

	const onVisualClick = (visualId: string, e: React.MouseEvent) => {
		if (e.metaKey || e.ctrlKey) {
			// Toggle membership. preventDefault stops the Link from opening
			// the editor in a new tab (selection wins over navigation).
			e.preventDefault()
			setSelectedVisualIds((prev) => {
				const next = new Set(prev)
				if (next.has(visualId)) next.delete(visualId)
				else next.add(visualId)
				return next
			})
			setSelectionAnchorId(visualId)
			return
		}
		if (e.shiftKey) {
			e.preventDefault()
			const order = visibleVisualOrder(folders, visuals, collapsedFolderIds)
			setSelectedVisualIds(
				new Set(rangeBetween(order, selectionAnchorId, visualId))
			)
			// Anchorless shift-click degrades to a single selection; make that
			// row the anchor so the NEXT shift-click extends from it (Finder
			// semantics). An existing anchor stays put for re-ranging.
			if (selectionAnchorId === null) setSelectionAnchorId(visualId)
			return
		}
		// Plain click: let the Link navigate to the editor as before.
	}

	const moveVisualsToFolder = (
		visualIds: string[],
		folderId: string | null
	) => {
		const ids = new Set(visualIds)
		setVisuals((prev) =>
			prev.map((v) => (ids.has(v.id) ? { ...v, folderId } : v))
		)
		setSelectedVisualIds(new Set())
		setSelectionAnchorId(null)
	}

	const reparentFolder = (folderId: string, parentId: string | null) => {
		setFolders((prev) =>
			prev.map((f) => (f.id === folderId ? { ...f, parentId } : f))
		)
	}

	// Whether the in-flight drag may drop on `targetFolderId` (null = root).
	const acceptsDropOn = (targetFolderId: string | null) => () => {
		const drag = getCurrentDrag()
		if (!drag) return false
		if (drag.kind === "visuals") return true
		return canDropFolderOn(folders, drag.folderId, targetFolderId)
	}

	// Decode from dataTransfer at drop time (readable there, and it survives
	// even if dragend raced the module-level ref clear).
	const handleDropOn =
		(targetFolderId: string | null) => (e: React.DragEvent) => {
			const visualsRaw = e.dataTransfer.getData(VISUALS_DRAG_TYPE)
			if (visualsRaw) {
				const payload = decodeVisualsDrag(visualsRaw)
				if (payload) moveVisualsToFolder(payload.visualIds, targetFolderId)
				return
			}
			const folderRaw = e.dataTransfer.getData(FOLDER_DRAG_TYPE)
			if (folderRaw) {
				const payload = decodeFolderDrag(folderRaw)
				if (
					payload &&
					canDropFolderOn(folders, payload.folderId, targetFolderId)
				) {
					reparentFolder(payload.folderId, targetFolderId)
				}
			}
		}

	const onVisualDragStart =
		(visualId: string) => (e: React.DragEvent) => {
			// Dragging a selected row drags the whole selection; dragging an
			// unselected row drags just that row (Finder semantics).
			const ids = selectedVisualIds.has(visualId)
				? [...selectedVisualIds]
				: [visualId]
			e.dataTransfer.setData(VISUALS_DRAG_TYPE, encodeVisualsDrag(ids))
			e.dataTransfer.effectAllowed = "move"
			setCurrentDrag({ kind: "visuals", visualIds: ids })
			if (ids.length > 1) setMultiDragImage(e.dataTransfer, ids.length)
		}

	const rootDrop = useFolderDropTarget({
		accepts: acceptsDropOn(null),
		onDropPayload: handleDropOn(null),
	})

	const rootFolders = folders
		.filter((f) => f.parentId === null)
		.sort((a, b) => a.name.localeCompare(b.name))

	const createFolder = (parentId: string | null) => {
		const folder: Folder = {
			id: newFolderId(),
			name: "New folder",
			parentId,
			createdAt: Date.now(),
		}
		setFolders((prev) => [...prev, folder])
	}

	const renameFolder = (id: string, name: string) => {
		setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)))
	}

	const deleteFolder = (id: string) => {
		// Collect all descendant folder IDs
		const toRemove = new Set<string>()
		const collect = (fid: string) => {
			toRemove.add(fid)
			for (const f of folders) {
				if (f.parentId === fid) collect(f.id)
			}
		}
		collect(id)
		// Move visuals in deleted folders to root
		setVisuals((prev) =>
			prev.map((v) =>
				v.folderId && toRemove.has(v.folderId) ? { ...v, folderId: null } : v
			)
		)
		setFolders((prev) => prev.filter((f) => !toRemove.has(f.id)))
		if (selectedFolderId && toRemove.has(selectedFolderId)) {
			onSelect(null)
		}
	}

	// Width comes from the parent (LibraryPage sizes and resizes the panel);
	// the resize handle next to it carries the divider border.
	return (
		<div className="flex h-full w-full flex-col bg-white dark:bg-stone-900">
			<div className="flex items-center justify-between border-b border-stone-200 px-3 py-2 dark:border-stone-700">
				<span className="text-sm font-medium tracking-wider text-stone-600 uppercase dark:text-stone-400">
					Folders
				</span>
				<button
					type="button"
					onClick={() => createFolder(null)}
					className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-white"
					title="New folder"
				>
					<svg viewBox="0 0 12 12" width={12} height={12}>
						<path
							d="M6 2v8M2 6h8"
							stroke="currentColor"
							strokeWidth={1.5}
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</div>
			<div className="flex-1 overflow-y-auto px-1 py-1">
				{/* "All visualizations" root item */}
				<div
					className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm select-none ${
						rootDrop.dropHover
							? DROP_HOVER_CLASS
							: selectedFolderId === null
								? "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200"
								: "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
					}`}
					{...rootDrop.dropHandlers}
					onClick={() => onSelect(null)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							onSelect(null)
						}
					}}
					role="button"
					tabIndex={0}
				>
					<span className="w-4 flex-shrink-0" />
					<svg
						viewBox="0 0 16 16"
						width={14}
						height={14}
						aria-hidden="true"
						className="flex-shrink-0"
					>
						<path
							d="M2 2.5A1.5 1.5 0 013.5 1h3a1.5 1.5 0 011.5 1.5V3h4.5A1.5 1.5 0 0114 4.5v8a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-10z"
							fill="currentColor"
						/>
					</svg>
					<span className="flex-1">All visualizations</span>
				</div>
				{rootFolders.map((folder) => (
					<FolderTreeItem
						key={folder.id}
						folder={folder}
						folders={folders}
						visuals={visuals}
						selectedId={selectedFolderId}
						onSelect={onSelect}
						onRename={renameFolder}
						onDelete={deleteFolder}
						onCreateChild={createFolder}
						collapsedFolderIds={collapsedFolderIds}
						onToggleExpanded={toggleFolderExpanded}
						selectedVisualIds={selectedVisualIds}
						onVisualClick={onVisualClick}
						acceptsDropOn={acceptsDropOn}
						onDropOn={handleDropOn}
						onVisualDragStart={onVisualDragStart}
						depth={0}
					/>
				))}
				{/* Visuals not assigned to any folder. Render flat below the
				 *  folder tree (no indent) so they're discoverable from the
				 *  same panel — otherwise an "in the root" visual lives only
				 *  behind the "All visualizations" filter. */}
				{visuals
					.filter((v) => v.folderId === null)
					.sort((a, b) => a.name.localeCompare(b.name))
					.map((v) => (
						<VisualTreeItem
							key={v.id}
							visual={v}
							depth={0}
							isSelected={selectedVisualIds.has(v.id)}
							onClick={onVisualClick}
							onDragStart={onVisualDragStart(v.id)}
						/>
					))}
			</div>
		</div>
	)
}
