import { useEffect, useMemo, useRef, useState } from "react"
import { SectionChevron } from "../../../components/ui/Chevron"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import {
	foldersAtom,
	libraryCollapsedFoldersAtom,
	liveVisualsAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"
import {
	FOLDER_DRAG_TYPE,
	type FolderDropZone,
	VISUALS_DRAG_TYPE,
	canDropFolderOn,
	decodeFolderDrag,
	decodeVisualsDrag,
	dropZoneFor,
	encodeFolderDrag,
	encodeVisualsDrag,
	getCurrentDrag,
	rangeBetween,
	setCurrentDrag,
	visibleVisualOrder,
} from "../lib/folderDnd"
import {
	canReorderFolderInto,
	clearSortIndex,
	folderTreeOrder,
	insertionPointFor,
	isStockFolder,
	nextSortIndex,
	orderableSiblings,
	orderedSiblings,
	reorderFolder,
} from "../lib/folderOrder"
import { UNFILED_FOLDER_ID, folderAncestors } from "../lib/folderSubtree"
import { kindPredicate, type LibraryKind } from "../lib/libraryKind"
import { isTemplate } from "../../chartBuilder/lib/visualTrash"
import { OpenVisualLink, TemplateChip } from "./OpenVisualLink"

const newFolderId = () =>
	`fl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Every row in the tree — "All visualizations", folders, visuals — so the
 *  three stay the same height.
 *
 *  24px rows, the SAME on touch and mouse. Touch used to get a taller row,
 *  but the tree is a long list and on a phone it's the whole screen, so the
 *  extra height cost more than it bought. A row is full-width, so the tap
 *  target is ~330x24 on a phone: narrow vertically, but hard to miss.
 *
 *  Nothing in the row may exceed the 20px text line, or IT sets the height
 *  instead of this padding — that's what kept the earlier passes at 40px
 *  and then 32px. Keep ROW_CHEVRON_BOX and the row's action buttons
 *  (`p-0.5` around a 10px glyph = 18px) at or under 20px. */
const TREE_ROW =
	"flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm select-none"

/** The expand chevron's box — and, as a bare span, the stand-in on rows that
 *  have none, so a chevron-less row isn't shorter than its neighbours. 20px
 *  matches the text line exactly: the widest it can be without driving the
 *  row height (see TREE_ROW). */
const ROW_CHEVRON_BOX = "h-5 w-4 flex-shrink-0"

/** Shared drop-target behavior for folder rows and the "All visualizations"
 *  row. Uses the enter/leave depth-counter pattern from DataDrawer so
 *  hovering child elements doesn't flicker the highlight. `resolve` maps a
 *  hover to the zone it would drop into — or null when this drag isn't
 *  welcome here — reading the module-level current drag (dataTransfer
 *  payloads are unreadable during dragover); the authoritative payload is
 *  re-read from dataTransfer at drop time. */
const useFolderDropTarget = ({
	resolve,
	onDropPayload,
}: {
	resolve: (e: React.DragEvent) => FolderDropZone | null
	onDropPayload: (e: React.DragEvent, zone: FolderDropZone) => void
}) => {
	// Doubles as the highlight state: which zone the pointer is in, or null
	// for no highlight at all.
	const [dropZone, setDropZone] = useState<FolderDropZone | null>(null)
	const depth = useRef(0)
	// The zone to act on at drop time — `dropZone` state can lag the last
	// dragover by a render.
	const zoneRef = useRef<FolderDropZone | null>(null)
	const track = (e: React.DragEvent) => {
		const zone = resolve(e)
		zoneRef.current = zone
		setDropZone(zone)
		return zone
	}
	return {
		dropZone,
		dropHandlers: {
			onDragEnter: (e: React.DragEvent) => {
				if (track(e) === null) return
				e.preventDefault()
				depth.current += 1
			},
			onDragOver: (e: React.DragEvent) => {
				// Re-resolved on every move: the pointer crosses between the
				// nest-inside band and the two edge bands without ever
				// leaving the row, so enter/leave alone can't track it.
				if (track(e) === null) return
				e.preventDefault()
				e.dataTransfer.dropEffect = "move"
			},
			onDragLeave: () => {
				depth.current = Math.max(0, depth.current - 1)
				if (depth.current === 0) {
					zoneRef.current = null
					setDropZone(null)
				}
			},
			onDrop: (e: React.DragEvent) => {
				e.preventDefault()
				e.stopPropagation()
				depth.current = 0
				const zone = zoneRef.current ?? resolve(e)
				setDropZone(null)
				zoneRef.current = null
				if (zone) onDropPayload(e, zone)
				// A drop can remount the dragged row (it moved subtrees), and
				// browsers don't reliably fire dragend on a detached node — so
				// the source's own dragend can't be trusted to clear this.
				setCurrentDrag(null)
			},
		},
	}
}

/** Highlight for a row the current drag may drop INTO (nest / move). */
const DROP_HOVER_CLASS =
	"vc-nav-active ring-1 ring-brand-400 dark:ring-brand-500"

/** Insertion line for an "order it here" drop, drawn as an inset shadow on
 *  the row's leading / trailing edge so it can't shift the row's height the
 *  way a border would. Brand-500 purple reads on both themes, so it
 *  needs no dark variant. */
const DROP_BEFORE_CLASS = "shadow-[inset_0_2px_0_0_var(--color-brand-500)]"
const DROP_AFTER_CLASS = "shadow-[inset_0_-2px_0_0_var(--color-brand-500)]"

/** Row classes for a resolved drop zone (null = not a drop target now). */
const dropZoneClass = (zone: FolderDropZone | null): string => {
	if (zone === "inside") return DROP_HOVER_CLASS
	if (zone === "before") return DROP_BEFORE_CLASS
	if (zone === "after") return DROP_AFTER_CLASS
	return ""
}

/** One step of the path shown above an entered folder: "All visualizations"
 *  and each ancestor. Clicking it goes back out to that level (selecting
 *  it, which is what entering means); it's also a drop target, so a visual
 *  or folder can be dragged up out of the entered folder without leaving
 *  it first. */
const TrailCrumb = ({
	label,
	onClick,
	resolve,
	onDropPayload,
}: {
	label: string
	onClick: () => void
	resolve: (e: React.DragEvent) => FolderDropZone | null
	onDropPayload: (e: React.DragEvent, zone: FolderDropZone) => void
}) => {
	const { dropZone, dropHandlers } = useFolderDropTarget({
		resolve,
		onDropPayload,
	})
	return (
		<button
			type="button"
			data-folder-crumb
			className={`max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-white ${dropZoneClass(dropZone)}`}
			title={label}
			{...dropHandlers}
			onClick={onClick}
		>
			{label}
		</button>
	)
}

/** Replace the browser's default ghost (the full row, or a link preview)
 *  with a compact "N items" badge when dragging a multi-selection. The
 *  node must be in the document when setDragImage snapshots it; it's
 *  removed on the next tick. */
const setMultiDragImage = (dt: DataTransfer, count: number) => {
	const badge = document.createElement("div")
	badge.textContent = `${count} items`
	badge.style.cssText =
		"position:fixed;top:-100px;left:-100px;padding:2px 8px;" +
		// Brand purple (white text passes AA on it; the lighter vc-accent
		// doesn't). The badge is in the document when snapshotted, so the
		// custom property resolves.
		"background:var(--color-vc-section-header);color:#fff;border-radius:4px;" +
		"font-size:12px;font-family:sans-serif;"
	document.body.appendChild(badge)
	dt.setDragImage(badge, 12, 12)
	setTimeout(() => badge.remove(), 0)
}

/** A visual row in the tree. Also a drop target for its OWN container
 *  (`dropHandlers` come from the enclosing folder — or from the root row for
 *  unfiled visuals): dragging over a folder's contents has to mean "into
 *  that folder", or an expanded folder's rows would be dead space between
 *  the only live target (its title row) and the next one. The highlight is
 *  the container's — these rows never light up on their own, because
 *  dropping "onto a visual" isn't a thing.
 *
 *  The row is a div so the pencil can sit beside the link rather than
 *  inside it (a button nested in an anchor is one control to a screen
 *  reader); the link is the name, and the row's select/drag/drop handlers
 *  are on the div. Clicking the pencil swaps the name for the same inline
 *  rename box a folder row uses — Enter / blur commit, Escape cancels, a
 *  blank name is ignored. A rename stamps nothing: like a move to another
 *  folder it's catalogue metadata, so the preview isn't marked stale. */
const VisualTreeItem = ({
	visual,
	depth,
	isSelected,
	onClick,
	onRename,
	onDragStart,
	dropHandlers,
}: {
	visual: Visual
	depth: number
	isSelected: boolean
	onClick: (visualId: string, e: React.MouseEvent) => void
	onRename: (visualId: string, name: string) => void
	onDragStart: (e: React.DragEvent) => void
	dropHandlers: {
		onDragEnter: (e: React.DragEvent) => void
		onDragOver: (e: React.DragEvent) => void
		onDragLeave: () => void
		onDrop: (e: React.DragEvent) => void
	}
}) => {
	const [editing, setEditing] = useState(false)
	const [editName, setEditName] = useState(visual.name)

	const commitRename = () => {
		const trimmed = editName.trim()
		if (trimmed && trimmed !== visual.name) onRename(visual.id, trimmed)
		setEditing(false)
	}

	return (
		// The row is a pointer/drag target (a click anywhere selects or, via
		// the link's own handler, opens); the link inside is the keyboard
		// path, so the row itself is not a control. The selection handler
		// sits on the row so a modified click on the gutter counts too; it
		// preventDefaults the same event the link saw, which is what stops
		// a cmd/shift-click from also opening the editor in a new tab.
		// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the link inside is the keyboard path
		<div
			className={`group/visualrow ${TREE_ROW} ${
				isSelected
					? "vc-nav-active"
					: "hover:bg-stone-100 dark:hover:bg-stone-800 vc-text"
			}`}
			style={{ paddingLeft: `${depth * 16 + 4}px` }}
			title={visual.name}
			data-selected={isSelected || undefined}
			onClick={(e) => {
				if (!editing) onClick(visual.id, e)
			}}
			draggable={!editing}
			onDragStart={(e) => {
				if (editing) {
					e.preventDefault()
					return
				}
				onDragStart(e)
			}}
			onDragEnd={() => setCurrentDrag(null)}
			{...dropHandlers}
		>
			{editing ? (
				<>
					<span className={ROW_CHEVRON_BOX} />
					<input
						type="text"
						value={editName}
						onChange={(e) => setEditName(e.target.value)}
						onBlur={commitRename}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitRename()
							if (e.key === "Escape") {
								setEditName(visual.name)
								setEditing(false)
							}
						}}
						onClick={(e) => e.stopPropagation()}
						// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the inline rename editor the user just opened
						autoFocus
						aria-label={`New name for ${visual.name}`}
						className="vc-focus-ring min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0 text-sm dark:bg-stone-900"
					/>
				</>
			) : (
				<>
					{/* The link spans the chevron gutter too, so the whole
					 *  row short of the pencil still opens the editor. */}
					<OpenVisualLink
						visual={visual}
						className="flex min-w-0 flex-1 items-center gap-1"
					>
						<span className={ROW_CHEVRON_BOX} />
						<span className="min-w-0 flex-1 truncate">{visual.name}</span>
						{isTemplate(visual) && <TemplateChip />}
					</OpenVisualLink>
					{/* Same pencil and reveal rule as the folder row's buttons:
					 *  on hover, always on touch, and for a keyboard user who
					 *  tabs onto it. */}
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation()
							setEditName(visual.name)
							setEditing(true)
						}}
						className="flex-shrink-0 rounded p-1 opacity-0 group-hover/visualrow:opacity-100 hover:text-stone-900 kbd:group-has-focus-visible/visualrow:opacity-100 pointer-coarse:opacity-100 dark:hover:text-white vc-muted"
						title="Rename"
						aria-label={`Rename ${visual.name}`}
					>
						<svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true">
							<path
								d="M11.7 1.6l2.7 2.7-9.2 9.2-3.4.7.7-3.4 9.2-9.2z"
								fill="currentColor"
							/>
						</svg>
					</button>
				</>
			)}
		</div>
	)
}

const menuItem =
	"block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:py-2 dark:hover:bg-stone-700 vc-text"

/** The folder row's "⋯" menu: rename, step up/down among siblings, and move
 *  into another folder — every drag-and-drop outcome (plus the double-click
 *  rename) reachable by tap and keyboard. The "Move to…" item swaps the
 *  list for the legal destinations, same rule as the drop. */
const FolderRowMenu = ({
	folder,
	folders,
	open,
	onOpenChange,
	canMoveUp,
	canMoveDown,
	onRename,
	onMoveSibling,
	onMoveInto,
}: {
	folder: Folder
	folders: Folder[]
	open: boolean
	onOpenChange: (open: boolean) => void
	canMoveUp: boolean
	canMoveDown: boolean
	onRename: () => void
	onMoveSibling: (dir: -1 | 1) => void
	onMoveInto: (parentId: string | null) => void
}) => {
	const [picking, setPicking] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const close = () => {
		onOpenChange(false)
		setPicking(false)
	}

	useEffect(() => {
		if (!open) return
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) close()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close()
		}
		document.addEventListener("mousedown", onDown)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("mousedown", onDown)
			document.removeEventListener("keydown", onKey)
		}
		// `close` is recreated per render; the listeners only need the
		// latest one while open.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open])

	const targets = folderTreeOrder(folders).filter(({ folder: f }) =>
		canDropFolderOn(folders, folder.id, f.id)
	)

	return (
		// Click here only stops the row underneath from selecting; the
		// buttons inside are the real interactions.
		// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
		<div
			ref={ref}
			className="relative"
			onClick={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
		>
			<button
				type="button"
				onClick={() => (open ? close() : onOpenChange(true))}
				className="rounded p-1 hover:text-stone-900 dark:hover:text-white vc-muted"
				title="More actions"
				aria-label={`Actions for ${folder.name}`}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<svg viewBox="0 0 12 12" width={10} height={10} aria-hidden="true">
					<circle cx="2" cy="6" r="1.1" fill="currentColor" />
					<circle cx="6" cy="6" r="1.1" fill="currentColor" />
					<circle cx="10" cy="6" r="1.1" fill="currentColor" />
				</svg>
			</button>
			{open && (
				<div
					role="menu"
					className="absolute top-full right-0 z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
				>
					{picking ? (
						<>
							<div className="px-3 py-1 text-xs font-medium tracking-wider uppercase vc-muted">
								Move to
							</div>
							{folder.parentId !== null && (
								<button
									type="button"
									role="menuitem"
									className={menuItem}
									onClick={() => {
										onMoveInto(null)
										close()
									}}
								>
									Top level
								</button>
							)}
							{targets.map(({ folder: f, depth }) => (
								<button
									key={f.id}
									type="button"
									role="menuitem"
									className={menuItem}
									style={{ paddingLeft: `${12 + depth * 12}px` }}
									onClick={() => {
										onMoveInto(f.id)
										close()
									}}
								>
									{f.name}
								</button>
							))}
							{targets.length === 0 && folder.parentId === null && (
								<div className="px-3 py-1.5 text-sm italic vc-muted">
									No other folder to move into
								</div>
							)}
						</>
					) : (
						<>
							<button
								type="button"
								role="menuitem"
								className={menuItem}
								onClick={() => {
									onRename()
									close()
								}}
							>
								Rename
							</button>
							<button
								type="button"
								role="menuitem"
								className={menuItem}
								disabled={!canMoveUp}
								onClick={() => {
									onMoveSibling(-1)
									close()
								}}
							>
								Move up
							</button>
							<button
								type="button"
								role="menuitem"
								className={menuItem}
								disabled={!canMoveDown}
								onClick={() => {
									onMoveSibling(1)
									close()
								}}
							>
								Move down
							</button>
							<button
								type="button"
								role="menuitem"
								className={menuItem}
								onClick={() => setPicking(true)}
							>
								Move to…
							</button>
						</>
					)}
				</div>
			)}
		</div>
	)
}

type FolderTreeItemProps = {
	folder: Folder
	folders: Folder[]
	visuals: Visual[]
	selectedId: string | null
	onSelect: (id: string | null) => void
	onRename: (id: string, name: string) => void
	onDelete: (id: string) => void
	onCreateChild: (parentId: string) => void
	/** Non-drag paths for what the drag-and-drop does — the row's "⋯" menu.
	 *  A finger can't start an HTML5 drag in every mobile browser, and a
	 *  double-click (rename) has no touch equivalent at all. */
	onMoveSibling: (id: string, dir: -1 | 1) => void
	onMoveInto: (id: string, parentId: string | null) => void
	collapsedFolderIds: ReadonlySet<string>
	onToggleExpanded: (id: string) => void
	selectedVisualIds: ReadonlySet<string>
	onVisualClick: (visualId: string, e: React.MouseEvent) => void
	onRenameVisual: (visualId: string, name: string) => void
	resolveDropOn: (folder: Folder) => (e: React.DragEvent) => FolderDropZone | null
	resolveDropInto: (folder: Folder) => () => FolderDropZone | null
	onDropOn: (
		folder: Folder
	) => (e: React.DragEvent, zone: FolderDropZone) => void
	onVisualDragStart: (visualId: string) => (e: React.DragEvent) => void
	depth: number
	/** This folder is the one the tree has been entered into: it is the
	 *  top row, always open (no chevron — closing it would leave nothing),
	 *  and its row has no before/after drop bands, because the siblings
	 *  those would order it against aren't on screen. */
	entered?: boolean
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
	onMoveSibling,
	onMoveInto,
	collapsedFolderIds,
	onToggleExpanded,
	selectedVisualIds,
	onVisualClick,
	onRenameVisual,
	resolveDropOn,
	resolveDropInto,
	onDropOn,
	onVisualDragStart,
	depth,
	entered = false,
}: FolderTreeItemProps) => {
	const expanded = entered || !collapsedFolderIds.has(folder.id)
	// The shipped examples' shelf: pinned last by `orderedSiblings`, drawn
	// in plain heading ink rather than brand purple, and read-only — no
	// rename (double-click or menu), no drag, no subfolder, no delete. Its
	// contents are still ordinary rows.
	const stock = isStockFolder(folder)
	const [editing, setEditing] = useState(false)
	const [menuOpen, setMenuOpen] = useState(false)
	const siblings = orderableSiblings(folders, folder.parentId)
	const siblingIndex = siblings.findIndex((f) => f.id === folder.id)
	const [editName, setEditName] = useState(folder.name)
	const { dropZone, dropHandlers } = useFolderDropTarget({
		resolve: entered ? resolveDropInto(folder) : resolveDropOn(folder),
		onDropPayload: onDropOn(folder),
	})
	// The folder's own visual rows, as a second target with no edge zones —
	// a drop there always means "into this folder". Its own state (rather
	// than the row's handlers reused) so the enter/leave counters stay
	// independent, but the highlight it paints is the row's: what lights up
	// is the folder, not the row the pointer happens to be over.
	const contents = useFolderDropTarget({
		resolve: resolveDropInto(folder),
		onDropPayload: onDropOn(folder),
	})
	const rowDropZone = dropZone ?? contents.dropZone
	const children = orderedSiblings(folders, folder.id)
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
			{/* The row is a pointer target (click anywhere selects, drag to
			 *  move/drop); the keyboard path is the name button inside, so the
			 *  row itself is not a control — it contains other buttons. */}
			{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the name button is the keyboard path, see above */}
			<div
				className={`group group/folderrow ${TREE_ROW} ${
					isSelected
						? "vc-nav-active"
						: "hover:bg-stone-100 dark:hover:bg-stone-800 vc-text"
				} ${dropZoneClass(rowDropZone)}`}
				data-folder-row
				data-drop-zone={rowDropZone ?? undefined}
				style={{ paddingLeft: `${depth * 16 + 4}px` }}
				draggable={!editing && !stock}
				onDragStart={(e) => {
					if (editing || stock) {
						e.preventDefault()
						return
					}
					e.dataTransfer.setData(FOLDER_DRAG_TYPE, encodeFolderDrag(folder.id))
					e.dataTransfer.effectAllowed = "move"
					setCurrentDrag({ kind: "folder", folderId: folder.id })
				}}
				onDragEnd={() => setCurrentDrag(null)}
				{...dropHandlers}
				// Selecting a folder ENTERS it: the tree re-roots on it and its
				// siblings drop out of view (see FolderTree). The chevron is the
				// other way in — it opens the folder in place, selecting
				// nothing, so several siblings can be open at once.
				onClick={() => onSelect(folder.id)}
			>
				{hasExpandable && !entered ? (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation()
							onToggleExpanded(folder.id)
						}}
						className={`flex ${ROW_CHEVRON_BOX} items-center justify-center ${
							stock
								? "vc-heading"
								: "text-vc-brand-text dark:text-vc-electric-indigo-300"
						}`}
						aria-label={
							expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`
						}
						aria-expanded={expanded}
					>
						<SectionChevron open={expanded} />
					</button>
				) : (
					<span className={ROW_CHEVRON_BOX} />
				)}
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
						aria-label="New folder name"
						className="vc-focus-ring min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0 text-sm dark:bg-stone-900"
					/>
				) : (
					// The row's click (bubbling from here) selects; as a real
					// button the name is also the row's Tab stop and Enter target.
					<button
						type="button"
						data-tip={stock ? undefined : "folder-row"}
						className={`min-w-0 flex-1 truncate text-left font-bold ${
							stock
								? "vc-heading"
								: "text-vc-brand-text dark:text-vc-electric-indigo-300"
						}`}
						aria-current={isSelected ? "true" : undefined}
						onDoubleClick={(e) => {
							e.stopPropagation()
							if (stock) return
							setEditing(true)
							setEditName(folder.name)
						}}
					>
						{folder.name}
					</button>
				)}
				{/* Always visible on touch (no hover there) and while the row's
				 *  menu is open, so it doesn't vanish under a moving pointer;
				 *  revealed for a keyboard user who tabs onto one of them.
				 *  The stock shelf has none of these: every one of them edits
				 *  the folder itself. */}
				{!stock && (
				<div
					className={`flex gap-1.5 group-hover:opacity-100 kbd:group-has-focus-visible/folderrow:opacity-100 pointer-coarse:opacity-100 ${
						menuOpen ? "opacity-100" : "opacity-0"
					}`}
				>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation()
							onCreateChild(folder.id)
						}}
						className="rounded p-1 hover:text-stone-900 dark:hover:text-white vc-muted"
						title="New subfolder"
						aria-label={`New subfolder in ${folder.name}`}
					>
						<svg viewBox="0 0 12 12" width={10} height={10} aria-hidden="true">
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
							className="rounded p-1 hover:text-red-600 dark:hover:text-red-400 vc-muted"
							title="Delete folder"
							aria-label={`Delete folder ${folder.name}`}
						>
							<svg viewBox="0 0 12 12" width={10} height={10} aria-hidden="true">
								<path
									d="M3 3l6 6M9 3l-6 6"
									stroke="currentColor"
									strokeWidth={1.5}
									strokeLinecap="round"
								/>
							</svg>
						</button>
					)}
					<FolderRowMenu
						folder={folder}
						folders={folders}
						open={menuOpen}
						onOpenChange={setMenuOpen}
						canMoveUp={siblingIndex > 0}
						canMoveDown={
							siblingIndex >= 0 && siblingIndex < siblings.length - 1
						}
						onRename={() => {
							setEditName(folder.name)
							setEditing(true)
						}}
						onMoveSibling={(dir) => onMoveSibling(folder.id, dir)}
						onMoveInto={(parentId) => onMoveInto(folder.id, parentId)}
					/>
				</div>
				)}
			</div>
			{expanded && (
				<>
					{children.map((child) => (
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
							onMoveSibling={onMoveSibling}
							onMoveInto={onMoveInto}
							collapsedFolderIds={collapsedFolderIds}
							onToggleExpanded={onToggleExpanded}
							selectedVisualIds={selectedVisualIds}
							onVisualClick={onVisualClick}
							onRenameVisual={onRenameVisual}
							resolveDropOn={resolveDropOn}
							resolveDropInto={resolveDropInto}
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
								onRename={onRenameVisual}
								onDragStart={onVisualDragStart(v.id)}
								dropHandlers={contents.dropHandlers}
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
	kind,
}: {
	selectedFolderId: string | null
	onSelect: (id: string | null) => void
	/** Visuals | Templates | All filter (the library's `?kind=`): the tree
	 *  lists the same rows the gallery does. Absent = ordinary visuals. */
	kind?: LibraryKind
}) => {
	const [folders, setFolders] = useAtom(foldersAtom)
	// Listed: live visuals of the selected kind only. Written: the whole
	// collection, so a move or folder delete never drops the trashed ones
	// (or the rows another kind filter hides).
	const liveVisuals = useAtomValue(liveVisualsAtom)
	const visuals = useMemo(
		() => liveVisuals.filter(kindPredicate(kind)),
		[liveVisuals, kind]
	)
	const setVisuals = useSetAtom(visualsAtom)

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

	// The folder the tree has been entered into — the selected one, when it
	// is a real folder. Selecting and entering are the same move: clicking
	// a folder's name filters the gallery to it AND re-roots the tree on
	// it, so a long top level stops competing with the folder's contents.
	// "All visualizations", the unfiled set, and a stale id (a deleted
	// folder still in the URL) all show the full tree.
	const enteredFolder =
		selectedFolderId !== null && selectedFolderId !== UNFILED_FOLDER_ID
			? (folders.find((f) => f.id === selectedFolderId) ?? null)
			: null
	// The crumbs above the entered folder: root first, then each ancestor.
	const enteredTrail = enteredFolder
		? folderAncestors(folders, enteredFolder.parentId)
		: []

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
			const order = visibleVisualOrder(
				folders,
				visuals,
				collapsedFolderIds,
				enteredFolder?.id ?? null
			)
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

	/** Plain re-parent (a nest-inside drop). Clears the folder's hand-placed
	 *  position: it would otherwise be a stale index in a group it just
	 *  left, and nesting a folder shouldn't freeze its new group's order. */
	const reparentFolder = (folderId: string, parentId: string | null) => {
		setFolders((prev) =>
			prev.map((f) =>
				f.id === folderId ? clearSortIndex({ ...f, parentId }) : f
			)
		)
	}

	/** Menu fallback for the edge-zone drop: step a folder one place up or
	 *  down among its siblings. `reorderFolder` slots are "before X", so
	 *  down = before the sibling two ahead (or last when there is none). */
	const moveFolderBy = (folderId: string, dir: -1 | 1) => {
		setFolders((prev) => {
			const folder = prev.find((f) => f.id === folderId)
			if (!folder) return prev
			const group = orderableSiblings(prev, folder.parentId)
			const i = group.findIndex((f) => f.id === folderId)
			const j = i + dir
			if (i === -1 || j < 0 || j >= group.length) return prev
			const beforeId =
				dir === -1 ? (group[i - 1]?.id ?? null) : (group[i + 2]?.id ?? null)
			return reorderFolder(prev, folderId, folder.parentId, beforeId)
		})
	}

	/** Menu fallback for the nest-inside drop, with the same legality check. */
	const moveFolderInto = (folderId: string, parentId: string | null) => {
		if (!canDropFolderOn(folders, folderId, parentId)) return
		reparentFolder(folderId, parentId)
	}

	/** Place a folder in a sibling group at an explicit position — the
	 *  before/after edge zones. Also re-parents when the anchor row lives in
	 *  a different group. */
	const placeFolder = (
		folderId: string,
		parentId: string | null,
		beforeId: string | null
	) => {
		setFolders((prev) => reorderFolder(prev, folderId, parentId, beforeId))
	}

	// What the in-flight drag would do if dropped on `folder`'s row: nest
	// inside it, or order itself against it. Null = not a drop target.
	const resolveDropOn = (folder: Folder) => (e: React.DragEvent) => {
		const drag = getCurrentDrag()
		if (!drag) return null
		// Visual drags don't order anything (visuals stay alphabetical), so
		// the whole row remains one "move into this folder" target.
		if (drag.kind === "visuals") return "inside" as const
		// The stock shelf neither takes user folders nor orders against
		// them: it's pinned, and nesting would edit it.
		if (isStockFolder(folder)) return null
		const rect = e.currentTarget.getBoundingClientRect()
		const zone = dropZoneFor(rect, e.clientY)
		if (zone === "inside") {
			return canDropFolderOn(folders, drag.folderId, folder.id)
				? ("inside" as const)
				: null
		}
		// An edge zone targets the row's OWN group, so it's legal even when
		// the row is the dragged folder's current parent (that's the
		// promote-a-level case) — but never relative to the folder itself.
		if (folder.id === drag.folderId) return null
		return canReorderFolderInto(folders, drag.folderId, folder.parentId)
			? zone
			: null
	}

	// What the in-flight drag would do if dropped on one of `folder`'s
	// contents rows: always "into this folder" — the edge zones exist to
	// order a folder against a SIBLING ROW, which a contents row isn't.
	const resolveDropInto = (folder: Folder) => () => {
		const drag = getCurrentDrag()
		if (!drag) return null
		if (drag.kind === "visuals") return "inside" as const
		if (isStockFolder(folder)) return null
		return canDropFolderOn(folders, drag.folderId, folder.id)
			? ("inside" as const)
			: null
	}

	// "All visualizations" only ever means "move to the root group"; there
	// are no rows above or below it to order against.
	const resolveDropOnRoot = () => {
		const drag = getCurrentDrag()
		if (!drag) return null
		if (drag.kind === "visuals") return "inside" as const
		return canDropFolderOn(folders, drag.folderId, null)
			? ("inside" as const)
			: null
	}

	// Decode from dataTransfer at drop time (readable there, and it survives
	// even if dragend raced the module-level ref clear).
	const handleDropOn =
		(target: Folder | null) => (e: React.DragEvent, zone: FolderDropZone) => {
			const targetFolderId = target?.id ?? null
			const visualsRaw = e.dataTransfer.getData(VISUALS_DRAG_TYPE)
			if (visualsRaw) {
				const payload = decodeVisualsDrag(visualsRaw)
				if (payload) moveVisualsToFolder(payload.visualIds, targetFolderId)
				return
			}
			const folderRaw = e.dataTransfer.getData(FOLDER_DRAG_TYPE)
			if (!folderRaw) return
			const payload = decodeFolderDrag(folderRaw)
			if (!payload) return
			if (zone !== "inside" && target) {
				const { parentId, beforeId } = insertionPointFor(
					folders,
					payload.folderId,
					target,
					zone
				)
				if (canReorderFolderInto(folders, payload.folderId, parentId)) {
					placeFolder(payload.folderId, parentId, beforeId)
				}
				return
			}
			if (canDropFolderOn(folders, payload.folderId, targetFolderId)) {
				reparentFolder(payload.folderId, targetFolderId)
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
		resolve: resolveDropOnRoot,
		onDropPayload: handleDropOn(null),
	})

	// Same contents rule one level up: the unfiled visuals listed below the
	// tree are "All visualizations"'s contents, and dropping on one of them
	// means the root group (lighting up that row, not the hovered one).
	const rootContents = useFolderDropTarget({
		resolve: resolveDropOnRoot,
		onDropPayload: handleDropOn(null),
	})

	const rootFolders = orderedSiblings(folders, null)
	const unfiledVisuals = visuals
		.filter((v) => v.folderId === null)
		.sort((a, b) => a.name.localeCompare(b.name))

	const createFolder = (parentId: string | null) => {
		setFolders((prev) => {
			// Appended last in a hand-ordered group (where the user just
			// watched it appear); left unplaced — and so alphabetical — in a
			// group that has never been ordered by hand.
			const sortIndex = nextSortIndex(prev, parentId)
			const folder: Folder = {
				id: newFolderId(),
				name: "New folder",
				parentId,
				createdAt: Date.now(),
				...(sortIndex === undefined ? {} : { sortIndex }),
			}
			return [...prev, folder]
		})
	}

	// Functional update over the FULL list (trash included) — see CLAUDE.md.
	const renameVisual = (id: string, name: string) => {
		setVisuals((prev) => prev.map((v) => (v.id === id ? { ...v, name } : v)))
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
				<span className="text-sm font-medium tracking-wider uppercase vc-muted">
					Folders
				</span>
				{/* Makes a folder where the user IS: top level in the full
				 *  tree, inside the entered folder otherwise. Gone while
				 *  inside the read-only stock shelf, which takes no
				 *  subfolders. */}
				{!(enteredFolder && isStockFolder(enteredFolder)) && (
					<button
						type="button"
						onClick={() => createFolder(enteredFolder?.id ?? null)}
						className="-m-0.5 rounded p-1.5 hover:bg-stone-100 hover:text-stone-900 pointer-coarse:p-2 dark:hover:bg-stone-800 dark:hover:text-white vc-muted"
						title="New folder"
						data-tip="new-folder"
						aria-label={
							enteredFolder
								? `New folder in ${enteredFolder.name}`
								: "New folder"
						}
					>
						<svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
							<path
								d="M6 2v8M2 6h8"
								stroke="currentColor"
								strokeWidth={1.5}
								strokeLinecap="round"
							/>
						</svg>
					</button>
				)}
			</div>
			{/* Clicking the panel's own whitespace — below/between the rows,
			 *  not on any of them — filters to the visuals that aren't in any
			 *  folder: the ones still waiting to be catalogued. Row clicks
			 *  stop here as the row's own target, so only a bare-container
			 *  click counts. This is a pointer-only shortcut on the panel's
			 *  background, not a control: the container wraps real buttons,
			 *  so it can't take a button role itself, and the same filter
			 *  is reachable by URL (`?folder=unfiled`). */}
			{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- background shortcut, see above */}
			<div
				className="flex flex-1 cursor-pointer flex-col overflow-y-auto px-1 py-1"
				data-testid="folder-tree-body"
				onClick={(e) => {
					if (e.target === e.currentTarget) onSelect(UNFILED_FOLDER_ID)
				}}
			>
				{enteredFolder ? (
					<>
						{/* The way back out: "All visualizations" and every
						 *  ancestor, each a click (and a drop target) away. */}
						<nav
							aria-label="Folder path"
							className="mb-1 flex flex-wrap items-center px-1 text-xs vc-muted"
						>
							<TrailCrumb
								label="All visualizations"
								onClick={() => onSelect(null)}
								resolve={resolveDropOnRoot}
								onDropPayload={handleDropOn(null)}
							/>
							{enteredTrail.map((f) => (
								<span key={f.id} className="contents">
									<span aria-hidden="true" className="px-0.5">
										›
									</span>
									<TrailCrumb
										label={f.name}
										onClick={() => onSelect(f.id)}
										resolve={resolveDropInto(f)}
										onDropPayload={handleDropOn(f)}
									/>
								</span>
							))}
							{/* Trailing separator: the trail leads INTO the row
							 *  below it, so it ends on an open "›" rather than
							 *  on the parent's name. */}
							<span aria-hidden="true" className="px-0.5">
								›
							</span>
						</nav>
						<FolderTreeItem
							key={enteredFolder.id}
							folder={enteredFolder}
							folders={folders}
							visuals={visuals}
							selectedId={selectedFolderId}
							onSelect={onSelect}
							onRename={renameFolder}
							onDelete={deleteFolder}
							onCreateChild={createFolder}
							onMoveSibling={moveFolderBy}
							onMoveInto={moveFolderInto}
							collapsedFolderIds={collapsedFolderIds}
							onToggleExpanded={toggleFolderExpanded}
							selectedVisualIds={selectedVisualIds}
							onVisualClick={onVisualClick}
							onRenameVisual={renameVisual}
							resolveDropOn={resolveDropOn}
							resolveDropInto={resolveDropInto}
							onDropOn={handleDropOn}
							onVisualDragStart={onVisualDragStart}
							depth={0}
							entered
						/>
						{!folders.some((f) => f.parentId === enteredFolder.id) &&
							!visuals.some((v) => v.folderId === enteredFolder.id) && (
								<p className="px-5 py-0.5 text-xs italic vc-faint">
									Empty folder
								</p>
							)}
					</>
				) : (
					<>
						{/* "All visualizations" root item: pointer target row, with the
						 *  label button as its keyboard path (same shape as a folder). */}
						{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the label button is the keyboard path */}
						<div
							className={`${TREE_ROW} ${
								selectedFolderId === null
									? "vc-nav-active"
									: "hover:bg-stone-100 dark:hover:bg-stone-800 vc-text"
							} ${dropZoneClass(rootDrop.dropZone ?? rootContents.dropZone)}`}
							data-folder-row
							{...rootDrop.dropHandlers}
							onClick={() => onSelect(null)}
						>
							<span className={ROW_CHEVRON_BOX} />
							<button
								type="button"
								className="flex-1 text-left"
								aria-current={selectedFolderId === null ? "true" : undefined}
							>
								All visualizations
							</button>
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
								onMoveSibling={moveFolderBy}
								onMoveInto={moveFolderInto}
								collapsedFolderIds={collapsedFolderIds}
								onToggleExpanded={toggleFolderExpanded}
								selectedVisualIds={selectedVisualIds}
								onVisualClick={onVisualClick}
								onRenameVisual={renameVisual}
								resolveDropOn={resolveDropOn}
								resolveDropInto={resolveDropInto}
								onDropOn={handleDropOn}
								onVisualDragStart={onVisualDragStart}
								depth={0}
							/>
						))}
						{/* Visuals not assigned to any folder. Render flat below the
						 *  folder tree (no indent) so they're discoverable from the
						 *  same panel — otherwise an "in the root" visual lives only
						 *  behind the "All visualizations" filter. The top margin sets
						 *  them apart from the folder list (which ends on the pinned
						 *  stock shelf). The block stretches over the panel's leftover
						 *  space and tints on hover, so the whole "not in a folder"
						 *  area reads as one click target (same shortcut as above). The
						 *  faint dotted outline on hover (inset, so nothing shifts)
						 *  shows the extent of that target. */}
						{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- background shortcut, see above */}
						<div
							className="mt-3 min-h-8 shrink-0 grow rounded -outline-offset-1 hover:bg-stone-100 hover:outline-1 hover:outline-dotted hover:outline-stone-300 dark:hover:bg-stone-800 dark:hover:outline-stone-600"
							onClick={(e) => {
								if (e.target === e.currentTarget) onSelect(UNFILED_FOLDER_ID)
							}}
						>
							{unfiledVisuals.map((v) => (
								<VisualTreeItem
									key={v.id}
									visual={v}
									depth={0}
									isSelected={selectedVisualIds.has(v.id)}
									onClick={onVisualClick}
									onRename={renameVisual}
									onDragStart={onVisualDragStart(v.id)}
									dropHandlers={rootContents.dropHandlers}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</div>
	)
}
