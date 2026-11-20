import { useMemo, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { SectionChevron } from "../../../components/ui/Chevron"
import { IconButton } from "../../../components/ui/IconButton"
import type { DatasetMeta, Folder } from "../../chartBuilder/lib/types"
import {
	dataFoldersAtom,
	libraryCollapsedFoldersAtom,
} from "../../chartBuilder/store/atoms"
import {
	DATASETS_DRAG_TYPE,
	decodeDatasetsDrag,
	encodeDatasetsDrag,
} from "../lib/dataDnd"
import {
	folderByDataset,
	lineageTrees,
	moveDatasetsToFolder,
	removeDataFolder,
	sourceIds,
	type LineageNode,
} from "../lib/dataLineage"
import { UNFILED_FOLDER_ID } from "../lib/folderSubtree"
import { isStockDataFolder, stockIdsIn } from "../lib/stockDataFolder"
import { describeVersionOrigin } from "../../chartBuilder/lib/versionTransforms"
import {
	useDataFoldersView,
	useListedDatasets,
} from "../hooks/useDataFoldersView"

const newFolderId = () =>
	`fl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Row metrics shared with the visuals' tree (`FolderTree`): 24px rows,
 *  nothing in a row taller than the 20px text line. */
const TREE_ROW =
	"group/row flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm select-none"
const ROW_CHEVRON_BOX = "h-5 w-4 flex-shrink-0"
const ROW_IDLE = "hover:bg-stone-100 dark:hover:bg-stone-800 vc-text"
const DROP_HOVER = "vc-nav-active ring-1 ring-brand-400 dark:ring-brand-500"
const INDENT = 16
/** A folder's name and chevron: brand purple for the user's folders, the
 *  heading ink for the app's stock shelf — as in the visuals' tree. */
const FOLDER_INK = "text-vc-brand-text dark:text-vc-electric-indigo-300"
const RENAME_INPUT =
	"vc-focus-ring min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0 text-sm dark:bg-stone-900"

const byFolderName = (a: Folder, b: Folder) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })

const Glyph = ({ d }: { d: string }) => (
	<svg viewBox="0 0 12 12" width={10} height={10} aria-hidden="true">
		<path
			d={d}
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			fill="none"
		/>
	</svg>
)
const PLUS = "M6 2v8M2 6h8"
const CROSS = "M3 3l6 6M9 3l-6 6"

/** The Data tab's rail: the folders the user has named, each listing its
 *  data sets, and the unfiled data sets beneath. Within a folder the data
 *  sets read as LINEAGE — a data set made from another (an edit, a reshape,
 *  a derived variable) sits under the one it was made from.
 *
 *  Clicking a folder filters the list beside it; clicking a data set opens
 *  its preview. A data set dragged from here or from the list onto a
 *  folder is filed there; dropped on "All data sets" or the unfiled area it
 *  leaves its folder. Folders are separate from the visuals' folders
 *  (`dataFoldersAtom`). The stock shelf (`lib/stockDataFolder.ts`) comes
 *  last and is the app's: it lists and filters like a folder but takes no
 *  rename, delete, subfolder or drop. */
export const DataFolderTree = ({
	selectedFolderId,
	onSelect,
	onOpenDataset,
	openDatasetId,
	openVersionId = null,
}: {
	selectedFolderId: string | null
	onSelect: (id: string | null) => void
	/** Open a data set's preview — at one version when a version row was
	 *  clicked, at its latest otherwise. */
	onOpenDataset: (id: string, versionId?: string) => void
	openDatasetId: string | null
	/** The version the open preview was asked for, to mark its row. */
	openVersionId?: string | null
}) => {
	// Written: the stored folders. Shown: those plus the stock shelf.
	const setFolders = useSetAtom(dataFoldersAtom)
	const folders = useDataFoldersView()
	const datasets = useListedDatasets()
	const [collapsed, setCollapsed] = useAtom(libraryCollapsedFoldersAtom)
	const [renamingId, setRenamingId] = useState<string | null>(null)
	const [dropTarget, setDropTarget] = useState<string | null>(null)

	const sources = useMemo(() => sourceIds(datasets), [datasets])
	const stockIds = useMemo(() => stockIdsIn(folders), [folders])
	const byDataset = useMemo(() => folderByDataset(folders), [folders])
	const membersOf = (folderId: string | null): DatasetMeta[] =>
		Object.values(datasets).filter(
			(d) => (byDataset.get(d.id)?.id ?? null) === folderId
		)

	const toggle = (id: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})

	const createFolder = (parentId: string | null) => {
		const id = newFolderId()
		void setFolders((prev) => [
			...prev,
			{
				id,
				name: "New folder",
				parentId,
				createdAt: Date.now(),
				kind: "data",
				datasetIds: [],
			},
		])
		if (parentId !== null && collapsed.has(parentId)) toggle(parentId)
		setRenamingId(id)
	}
	const renameFolder = (id: string, raw: string) => {
		const name = raw.trim()
		setRenamingId(null)
		if (name === "") return
		void setFolders((prev) =>
			prev.map((f) => (f.id === id && f.name !== name ? { ...f, name } : f))
		)
	}
	const deleteFolder = (folder: Folder) => {
		void setFolders((prev) => removeDataFolder(prev, folder.id))
		if (selectedFolderId === folder.id) onSelect(folder.parentId)
	}

	/** Drop handlers for a row that files data sets in `folderId` (null =
	 *  out of every folder). `key` names the row for the hover highlight. */
	const dropInto = (key: string, folderId: string | null) => ({
		onDragOver: (e: React.DragEvent) => {
			if (!e.dataTransfer.types.includes(DATASETS_DRAG_TYPE)) return
			e.preventDefault()
			e.dataTransfer.dropEffect = "move"
			if (dropTarget !== key) setDropTarget(key)
		},
		onDragLeave: () => setDropTarget((prev) => (prev === key ? null : prev)),
		onDrop: (e: React.DragEvent) => {
			const ids = decodeDatasetsDrag(e.dataTransfer.getData(DATASETS_DRAG_TYPE))
			setDropTarget(null)
			if (!ids) return
			e.preventDefault()
			e.stopPropagation()
			// Stock data sets stay on their shelf.
			const movable = ids.filter((id) => !stockIds.has(id))
			if (movable.length === 0) return
			void setFolders((prev) => moveDatasetsToFolder(prev, movable, folderId))
		},
	})

	const renderDataset = (node: LineageNode, depth: number, derived: boolean) => {
		const { meta, children } = node
		const open = !collapsed.has(meta.id)
		// A data set with a history lists it: every version, oldest first,
		// then the data sets made from it.
		const versions = meta.versions.length > 1 ? meta.versions : []
		const expandable = versions.length > 0 || children.length > 0
		return (
			<div key={meta.id}>
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the name button is the keyboard path */}
				<div
					className={`${TREE_ROW} ${
						openDatasetId === meta.id && openVersionId === null
							? "vc-nav-active"
							: ROW_IDLE
					}`}
					style={{ paddingLeft: 4 + depth * INDENT }}
					data-dataset-row={meta.id}
					draggable
					onDragStart={(e) => {
						e.dataTransfer.setData(
							DATASETS_DRAG_TYPE,
							encodeDatasetsDrag([meta.id])
						)
						e.dataTransfer.effectAllowed = "move"
					}}
					onClick={() => onOpenDataset(meta.id)}
				>
					{expandable ? (
						<button
							type="button"
							className={`${ROW_CHEVRON_BOX} flex items-center justify-center`}
							aria-label={`${open ? "Collapse" : "Expand"} the versions of ${meta.name}`}
							aria-expanded={open}
							onClick={(e) => {
								e.stopPropagation()
								toggle(meta.id)
							}}
						>
							<SectionChevron open={open} />
						</button>
					) : (
						<span className={`${ROW_CHEVRON_BOX} text-center vc-faint`} aria-hidden="true">
							{derived ? "↳" : ""}
						</span>
					)}
					<button
						type="button"
						className="min-w-0 flex-1 truncate text-left"
						title={derived ? `${meta.name} — made from the data set above` : meta.name}
					>
						{meta.name}
					</button>
				</div>
				{open &&
					versions.map((v, i) => {
						const origin = describeVersionOrigin(v)
						const label = `v${i + 1} · ${origin ?? v.filename}`
						const active = openDatasetId === meta.id && openVersionId === v.id
						return (
							// eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the name button is the keyboard path
							<div
								key={v.id}
								className={`${TREE_ROW} ${active ? "vc-nav-active" : ROW_IDLE}`}
								style={{ paddingLeft: 4 + (depth + 1) * INDENT }}
								data-version-row={v.id}
								onClick={() => onOpenDataset(meta.id, v.id)}
							>
								<span className={ROW_CHEVRON_BOX} />
								<button
									type="button"
									className="min-w-0 flex-1 truncate text-left vc-muted"
									title={`${label}${origin ? ` · ${v.filename}` : ""} · ${new Date(
										v.createdAt
									).toLocaleDateString()}${
										v.id === meta.latestVersionId ? " · latest" : ""
									}`}
								>
									{label}
								</button>
							</div>
						)
					})}
				{open && children.map((child) => renderDataset(child, depth + 1, true))}
			</div>
		)
	}

	const renderFolder = (folder: Folder, depth: number) => {
		const open = !collapsed.has(folder.id)
		const subfolders = folders.filter((f) => f.parentId === folder.id).sort(byFolderName)
		const trees = lineageTrees(membersOf(folder.id), sources)
		const selected = selectedFolderId === folder.id
		const stock = isStockDataFolder(folder)
		return (
			<div key={folder.id}>
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the name button is the keyboard path */}
				<div
					className={`${TREE_ROW} ${
						dropTarget === folder.id ? DROP_HOVER : selected ? "vc-nav-active" : ROW_IDLE
					}`}
					style={{ paddingLeft: 4 + depth * INDENT }}
					data-folder-row={folder.id}
					{...(stock ? {} : dropInto(folder.id, folder.id))}
					onClick={() => onSelect(folder.id)}
				>
					<button
						type="button"
						className={`${ROW_CHEVRON_BOX} flex items-center justify-center ${
							stock ? "vc-heading" : FOLDER_INK
						}`}
						aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
						aria-expanded={open}
						onClick={(e) => {
							e.stopPropagation()
							toggle(folder.id)
						}}
					>
						<SectionChevron open={open} />
					</button>
					{renamingId === folder.id ? (
						<input
							// eslint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to name this folder
							autoFocus
							defaultValue={folder.name}
							aria-label="Folder name"
							className={RENAME_INPUT}
							onClick={(e) => e.stopPropagation()}
							onFocus={(e) => e.target.select()}
							onBlur={(e) => renameFolder(folder.id, e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") renameFolder(folder.id, e.currentTarget.value)
								if (e.key === "Escape") setRenamingId(null)
							}}
						/>
					) : (
						<>
							<button
								type="button"
								className={`min-w-0 flex-1 truncate text-left font-bold ${
									stock ? "vc-heading" : FOLDER_INK
								}`}
								aria-current={selected ? "true" : undefined}
								onDoubleClick={
									stock ? undefined : () => setRenamingId(folder.id)
								}
							>
								{folder.name}
							</button>
							{!stock && (
							<span
								className="flex gap-1.5 opacity-0 group-hover/row:opacity-100 kbd:group-has-focus-visible/row:opacity-100 pointer-coarse:opacity-100">
								<IconButton
									quiet
									className="p-1"
									title="New subfolder"
									aria-label={`New subfolder in ${folder.name}`}
									onClick={(e) => {
										e.stopPropagation()
										createFolder(folder.id)
									}}
								>
									<Glyph d={PLUS} />
								</IconButton>
								<IconButton
									quiet
									className="p-1"
									title="Rename"
									aria-label={`Rename ${folder.name}`}
									onClick={(e) => {
										e.stopPropagation()
										setRenamingId(folder.id)
									}}
								>
									<svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true">
										<path
											d="M11.7 1.6l2.7 2.7-9.2 9.2-3.4.7.7-3.4 9.2-9.2z"
											fill="currentColor"
										/>
									</svg>
								</IconButton>
								<button
									type="button"
									className="rounded p-1 hover:text-red-600 dark:hover:text-red-400 vc-muted"
									title="Delete folder (its data sets are kept)"
									aria-label={`Delete folder ${folder.name}`}
									onClick={(e) => {
										e.stopPropagation()
										deleteFolder(folder)
									}}
								>
									<Glyph d={CROSS} />
								</button>
							</span>
							)}
						</>
					)}
				</div>
				{open && (
					<>
						{subfolders.map((f) => renderFolder(f, depth + 1))}
						{trees.map((node) => renderDataset(node, depth + 1, false))}
						{subfolders.length === 0 && trees.length === 0 && (
							<p
								className="py-0.5 text-xs italic vc-faint"
								style={{ paddingLeft: 24 + (depth + 1) * INDENT }}
							>
								Empty folder
							</p>
						)}
					</>
				)}
			</div>
		)
	}

	// The stock shelf last, whatever it is called.
	const rootFolders = folders
		.filter((f) => f.parentId === null || !folders.some((p) => p.id === f.parentId))
		.sort(
			(a, b) =>
				Number(isStockDataFolder(a)) - Number(isStockDataFolder(b)) ||
				byFolderName(a, b)
		)
	const unfiled = lineageTrees(membersOf(null), sources)
	const newFolderParent =
		selectedFolderId !== null &&
		folders.some((f) => f.id === selectedFolderId && !isStockDataFolder(f))
			? selectedFolderId
			: null

	return (
		<div className="flex h-full w-full flex-col bg-white dark:bg-stone-900">
			<div className="flex items-center justify-between border-b border-stone-200 px-3 py-2 dark:border-stone-700">
				<span className="text-sm font-medium tracking-wider uppercase vc-muted">
					Folders
				</span>
				<IconButton
					onClick={() => createFolder(newFolderParent)}
					className="-m-0.5 p-1.5 pointer-coarse:p-2"
					title="New folder"
					aria-label="New data folder"
				>
					<svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
						<path d={PLUS} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
					</svg>
				</IconButton>
			</div>
			{/* As in the visuals' tree: a click on the panel's own whitespace
			 *  filters to the data sets in no folder. A pointer shortcut on the
			 *  background, not a control (`?folder=unfiled` reaches the same). */}
			{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- background shortcut, see above */}
			<div
				className="flex flex-1 cursor-pointer flex-col overflow-y-auto px-1 py-1"
				data-testid="data-folder-tree"
				onClick={(e) => {
					if (e.target === e.currentTarget) onSelect(UNFILED_FOLDER_ID)
				}}
			>
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer convenience; the label button is the keyboard path */}
				<div
					className={`${TREE_ROW} ${
						dropTarget === "all" ? DROP_HOVER : selectedFolderId === null ? "vc-nav-active" : ROW_IDLE
					}`}
					{...dropInto("all", null)}
					onClick={() => onSelect(null)}
				>
					<span className={ROW_CHEVRON_BOX} />
					<button
						type="button"
						className="flex-1 text-left"
						aria-current={selectedFolderId === null ? "true" : undefined}
					>
						All data sets
					</button>
				</div>
				{rootFolders.map((f) => renderFolder(f, 0))}
				{/* Data sets in no folder, flat below the folders. The block
				 *  stretches over the panel's leftover space and tints on hover
				 *  (with a faint dotted outline), so the whole "not in a folder"
				 *  area reads as one click target — and one drop target, which
				 *  takes a data set out of its folder. */}
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- background shortcut, see above */}
				<div
					className={`mt-3 min-h-8 shrink-0 grow rounded -outline-offset-1 hover:bg-stone-100 hover:outline-1 hover:outline-dotted hover:outline-stone-300 dark:hover:bg-stone-800 dark:hover:outline-stone-600 ${
						dropTarget === "unfiled" ? DROP_HOVER : ""
					}`}
					data-unfiled-area
					{...dropInto("unfiled", null)}
					onClick={(e) => {
						if (e.target === e.currentTarget) onSelect(UNFILED_FOLDER_ID)
					}}
				>
					{unfiled.map((node) => renderDataset(node, 0, false))}
				</div>
			</div>
		</div>
	)
}
