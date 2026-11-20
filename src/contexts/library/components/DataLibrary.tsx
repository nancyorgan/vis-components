import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import { Button } from "../../../components/ui/Button"
import { SearchInput } from "../../../components/ui/SearchInput"
import { ResetLink } from "../../../components/ui/ResetLink"
import {
	currentDatasetIdAtom,
	dataFoldersAtom,
	datasetIndexReadyAtom,
} from "../../chartBuilder/store/atoms"
import {
	useDataFoldersView,
	useDatasetUseCounts,
	useListedDatasets,
} from "../hooks/useDataFoldersView"
import {
	useDownloadDatasets,
	useDuplicateDatasets,
} from "../hooks/useDatasetActions"
import { trashDatasets } from "../lib/dataTrash"
import { DataTrashButton } from "./DataTrashButton"
import {
	UploadDatasetButton,
	type UploadNotice,
} from "./UploadDatasetButton"
import { useDatasetSizes } from "../hooks/useDatasetSizes"
import { DATASETS_DRAG_TYPE, encodeDatasetsDrag } from "../lib/dataDnd"
import {
	dataFolderPredicate,
	dataRowFor,
	folderByDataset,
	formatBytes,
	moveDatasetsToFolder,
	parseDataSort,
	sortDataRows,
	sourceIds,
	type DataRow,
	type DataSortField,
} from "../lib/dataLineage"
import { UNFILED_FOLDER_ID } from "../lib/folderSubtree"
import type { LibraryKind } from "../lib/libraryKind"
import { isStockDataFolder, stockIdsIn } from "../lib/stockDataFolder"
import { DataFolderTree } from "./DataFolderTree"
import { DataPreviewModal } from "./DataPreviewModal"
import { FolderPickerModal } from "./FolderPickerModal"
import { KindToggle } from "./KindToggle"
import { LibraryRailLayout } from "./LibraryRailLayout"

const formatDate = (ts: number): string =>
	new Date(ts).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	})

const TH =
	"border-b border-stone-200 px-3 py-2 text-left text-sm font-medium text-stone-600 dark:border-stone-700 dark:text-stone-300"
const TD = "border-b border-stone-100 px-3 py-2 dark:border-stone-700/60"

/** The library's Data tab: every data set as a list (name, created, last
 *  edited, folder, dimensions, size), with the data folders and each data
 *  set's lineage in the rail (`DataFolderTree`). Clicking a data set opens
 *  it as a spreadsheet (`DataPreviewModal`) to scan, sort, edit into a new
 *  version, or start a visualization from. List only — there is no grid of
 *  data sets. Reads the same `?folder=`, `?q=` and `?sort=` params as the
 *  visuals' listing, with its own folder ids and sort fields. */
export const DataLibrary = () => {
	// Everything not in the Data trash.
	const datasets = useListedDatasets()
	const indexReady = useAtomValue(datasetIndexReadyAtom)
	const folders = useDataFoldersView()
	const useCounts = useDatasetUseCounts(useAtomValue(currentDatasetIdAtom))
	const search = useSearch({ from: "/" })
	const navigate = useNavigate({ from: "/" })
	// The data set open in the preview, and the version asked for (null =
	// its latest; set by a version row of the rail).
	const [opened, setOpened] = useState<{
		id: string
		versionId: string | null
	} | null>(null)
	const openDatasetId = opened?.id ?? null
	const setOpenDatasetId = (id: string | null) =>
		setOpened(id === null ? null : { id, versionId: null })

	const query = search.q ?? ""
	const sort = parseDataSort(search.sort)
	// A folder id carried over from the visuals' listing isn't one of ours.
	const selectedFolderId =
		search.folder === UNFILED_FOLDER_ID ||
		folders.some((f) => f.id === search.folder)
			? (search.folder ?? null)
			: null

	const setSelectedFolderId = (id: string | null) =>
		void navigate({ search: (prev) => ({ ...prev, folder: id ?? undefined }) })
	const setQuery = (next: string) =>
		void navigate({ search: (prev) => ({ ...prev, q: next || undefined }) })
	const setKind = (next: LibraryKind | undefined) =>
		// Leaving for the visuals: their folders and sort fields are their own.
		void navigate({
			search: (prev) => ({
				...prev,
				kind: next,
				folder: undefined,
				sort: undefined,
			}),
		})
	const onSort = (field: DataSortField) => {
		const dir = sort.field === field && sort.dir === "desc" ? "asc" : "desc"
		const value = `${field}:${dir}`
		void navigate({
			search: (prev) => ({
				...prev,
				sort: value === "updatedAt:desc" ? undefined : value,
			}),
		})
	}

	const sizes = useDatasetSizes(datasets)
	const sources = useMemo(() => sourceIds(datasets), [datasets])
	const rows = useMemo(() => {
		const byDataset = folderByDataset(folders)
		const inFolder = dataFolderPredicate(folders, selectedFolderId)
		const needle = query.trim().toLowerCase()
		return sortDataRows(
			Object.values(datasets)
				.filter((d) => inFolder(d.id))
				.filter((d) => needle === "" || d.name.toLowerCase().includes(needle))
				.map((meta) =>
					dataRowFor(meta, {
						datasets,
						folders,
						byDataset,
						sources,
						sizes,
						useCounts,
					})
				),
			{ field: sort.field, dir: sort.dir }
		)
	}, [
		datasets,
		folders,
		useCounts,
		sources,
		sizes,
		selectedFolderId,
		query,
		sort.field,
		sort.dir,
	])

	// Checked rows, for the bulk Move. Ids that stop being listed (a search,
	// another folder) are dropped, so a move never catches a hidden row.
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
	const [moveOpen, setMoveOpen] = useState(false)
	const setDataFolders = useSetAtom(dataFoldersAtom)
	// The user's own folders: the stock shelf takes nothing.
	const ownFolders = useMemo(
		() => folders.filter((f) => !isStockDataFolder(f)),
		[folders]
	)
	const visibleIds = rows.map((r) => r.meta.id)
	const visibleKey = visibleIds.join("|")
	useEffect(() => {
		const visible = new Set(visibleKey.split("|"))
		setSelectedIds((prev) => {
			const next = new Set([...prev].filter((id) => visible.has(id)))
			return next.size === prev.size ? prev : next
		})
	}, [visibleKey])
	const selectedCount = selectedIds.size
	// Stock data sets stay on their shelf: a move takes the rest.
	const stockIds = useMemo(() => stockIdsIn(folders), [folders])
	const movableIds = [...selectedIds].filter((id) => !stockIds.has(id))
	const stockSelected = selectedCount - movableIds.length
	const allSelected = rows.length > 0 && selectedCount === rows.length
	// The last box clicked: where a shift-click's range starts.
	const anchorRef = useRef<string | null>(null)
	const onToggleRow = (id: string, shift: boolean) => {
		const selecting = !selectedIds.has(id)
		const from = anchorRef.current ? visibleIds.indexOf(anchorRef.current) : -1
		const to = visibleIds.indexOf(id)
		const range =
			shift && from >= 0
				? visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)
				: [id]
		setSelectedIds((prev) => {
			const next = new Set(prev)
			for (const each of range) {
				if (selecting) next.add(each)
				else next.delete(each)
			}
			return next
		})
		anchorRef.current = id
	}
	const moveTo = (ids: readonly string[], folderId: string | null) =>
		void setDataFolders((prev) => moveDatasetsToFolder(prev, ids, folderId))
	const selectedFolders = new Set(
		rows.filter((r) => movableIds.includes(r.meta.id)).map((r) => r.folderId)
	)
	const sharedFolder =
		selectedFolders.size === 1 ? [...selectedFolders][0] : null

	// Duplicate takes any checked data set, stock ones included: the copy is
	// the user's own. With folders it asks where the copies go.
	const duplicateDatasets = useDuplicateDatasets()
	const [duplicateOpen, setDuplicateOpen] = useState(false)
	const onDuplicate = (folderId: string | null) => {
		void duplicateDatasets([...selectedIds], folderId)
		setDuplicateOpen(false)
		setSelectedIds(new Set())
	}
	const downloadDatasets = useDownloadDatasets()
	const [downloading, setDownloading] = useState(false)
	const [actionError, setActionError] = useState<string | null>(null)
	const onDownload = async () => {
		if (downloading) return
		setDownloading(true)
		setActionError(null)
		try {
			await downloadDatasets([...selectedIds])
		} catch (e) {
			setActionError(
				`Download failed: ${e instanceof Error ? e.message : String(e)}`
			)
		} finally {
			setDownloading(false)
		}
	}
	// Only a data set no visualization draws from can go to the trash.
	const trashableIds = [...selectedIds].filter((id) => !useCounts.has(id))
	const inUseSelected = selectedCount - trashableIds.length
	const trashHint =
		inUseSelected === 0
			? undefined
			: trashableIds.length === 0
				? "Used by a visualization, so it can't go to the trash."
				: `${inUseSelected} of these ${inUseSelected === 1 ? "is" : "are"} used by a visualization and will stay.`
	const moveHint =
		ownFolders.length === 0
			? "Make a folder with the + in the left menu first."
			: undefined
	const onTrash = () => {
		void setDataFolders((prev) => trashDatasets(prev, trashableIds))
		setSelectedIds(new Set())
	}

	// What the last upload did, said under the header until dismissed.
	const [uploadNotices, setUploadNotices] = useState<UploadNotice[]>([])

	const title =
		selectedFolderId === null
			? "All data sets"
			: selectedFolderId === UNFILED_FOLDER_ID
				? "Not in a folder"
				: (folders.find((f) => f.id === selectedFolderId)?.name ?? "Data sets")

	const header = (field: DataSortField, label: string, right = false) => (
		<th
			className={TH}
			aria-sort={
				sort.field === field
					? sort.dir === "asc"
						? "ascending"
						: "descending"
					: undefined
			}
		>
			<button
				type="button"
				onClick={() => onSort(field)}
				className={`flex items-center gap-1 hover:text-stone-900 dark:hover:text-white ${right ? "ml-auto" : ""}`}
			>
				{label}
				{sort.field === field && (
					<span aria-hidden="true" className="text-sm">
						{sort.dir === "asc" ? "▲" : "▼"}
					</span>
				)}
			</button>
		</th>
	)

	return (
		<>
			<LibraryRailLayout
				rail={(onPicked) => (
					<DataFolderTree
						selectedFolderId={selectedFolderId}
						openDatasetId={openDatasetId}
						openVersionId={opened?.versionId ?? null}
						onSelect={(id) => {
							setSelectedFolderId(id)
							onPicked()
						}}
						onOpenDataset={(id, versionId) => {
							setOpened({ id, versionId: versionId ?? null })
							onPicked()
						}}
					/>
				)}
			>
				<div className="mx-auto max-w-6xl px-4 py-6 pl-10 sm:px-6 sm:py-10 sm:pl-10">
					<div className="mb-3 flex flex-wrap items-center gap-3">
						<h1 className="mr-auto text-xl vc-heading">{title}</h1>
						<UploadDatasetButton
							folders={ownFolders}
							// Starts on the folder being looked at, when it is one of
							// the user's.
							initialFolderId={
								ownFolders.some((f) => f.id === selectedFolderId)
									? selectedFolderId
									: null
							}
							listed={datasets}
							onNotices={setUploadNotices}
						/>
						<SearchInput
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search data sets…"
							aria-label="Search data sets"
							className="w-full sm:w-64"
						/>
					</div>
					<div className="mb-6 flex flex-wrap items-end gap-3 border-b border-stone-200 dark:border-stone-700">
						<KindToggle kind="data" onChange={setKind} />
					</div>
					{uploadNotices.length > 0 && (
						<div className="mb-4 flex items-start gap-3" role="status">
							<div className="flex flex-1 flex-col gap-1">
								{uploadNotices.map((n) => (
									<p
										key={n.text}
										className={
											n.kind === "error"
												? "vc-notice-error"
												: n.kind === "warning"
													? "vc-notice-warning"
													: "text-sm vc-text"
										}
									>
										{n.text}
									</p>
								))}
							</div>
							<ResetLink label="Dismiss" onClick={() => setUploadNotices([])} />
						</div>
					)}
					{selectedCount > 0 && (
						<div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-800 dark:bg-brand-900/20">
							<span className="text-sm font-medium text-brand-900 dark:text-brand-200">
								{selectedCount} selected
							</span>
							<div className="ml-auto flex flex-wrap items-center gap-2">
								{actionError !== null && (
									<span className="text-sm text-red-700 dark:text-red-300">
										{actionError}
									</span>
								)}
								{/* A reason an action is off, or covers only part of the
								 *  selection, rides on its button — the hover text, and
								 *  a count in the label — so the bar stays one row of
								 *  buttons. The span carries the hover text because a
								 *  disabled button shows none in some browsers. */}
								<span title={moveHint}>
									<Button
										compact
										disabled={ownFolders.length === 0 || movableIds.length === 0}
										onClick={() => setMoveOpen(true)}
									>
										{movableIds.length > 0 && stockSelected > 0
											? `Move ${movableIds.length}…`
											: "Move…"}
									</Button>
								</span>
								<Button
									compact
									onClick={() =>
										ownFolders.length === 0
											? onDuplicate(null)
											: setDuplicateOpen(true)
									}
								>
									{ownFolders.length === 0 ? "Duplicate" : "Duplicate…"}
								</Button>
								<Button
									compact
									disabled={downloading}
									onClick={() => void onDownload()}
								>
									{downloading ? "Downloading…" : "Download"}
								</Button>
								<span title={trashHint}>
									<Button
										compact
										danger
										disabled={trashableIds.length === 0}
										onClick={onTrash}
									>
										{trashableIds.length > 0 && inUseSelected > 0
											? `Move ${trashableIds.length} to trash`
											: "Move to trash"}
									</Button>
								</span>
								<ResetLink label="Clear" onClick={() => setSelectedIds(new Set())} />
							</div>
						</div>
					)}
					{rows.length === 0 ? (
						<div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-stone-300 bg-white px-8 py-20 text-center dark:border-stone-700 dark:bg-stone-800">
							<p className="max-w-md text-sm vc-muted">
								{!indexReady
									? "Loading data sets…"
									: query
										? `No data sets match "${query}".`
										: selectedFolderId === UNFILED_FOLDER_ID
											? "Every data set is in a folder."
											: selectedFolderId
												? "This folder is empty. Drag data sets onto it to file them here."
												: "No data sets yet. Start a new visualization to upload one."}
							</p>
						</div>
					) : (
						<div className="overflow-x-auto rounded-card border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
							<table className="min-w-full text-sm" data-testid="data-table">
								<thead>
									<tr>
										<th className={TH}>
											<input
												type="checkbox"
												checked={allSelected}
												ref={(el) => {
													if (el)
														el.indeterminate = selectedCount > 0 && !allSelected
												}}
												onChange={() =>
													setSelectedIds(
														allSelected ? new Set() : new Set(visibleIds)
													)
												}
												aria-label={
													allSelected
														? "Deselect all listed data sets"
														: "Select all listed data sets"
												}
												className="h-4 w-4 cursor-pointer"
											/>
										</th>
										{header("name", "Name")}
										{header("createdAt", "Created")}
										{header("updatedAt", "Last edited")}
										{header("folder", "Folder")}
										{header("dimensions", "Rows × columns", true)}
										{header("size", "Size", true)}
									</tr>
								</thead>
								<tbody>
									{rows.map((row) => (
										<DataTableRow
											key={row.meta.id}
											row={row}
											active={openDatasetId === row.meta.id}
											selected={selectedIds.has(row.meta.id)}
											onToggle={(shift) => onToggleRow(row.meta.id, shift)}
											// A checked row drags the whole selection along.
											dragIds={
												selectedIds.has(row.meta.id)
													? [...selectedIds]
													: [row.meta.id]
											}
											onOpen={() => setOpenDatasetId(row.meta.id)}
										/>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</LibraryRailLayout>
			<FolderPickerModal
				open={moveOpen}
				title={`Move ${movableIds.length} data set${movableIds.length === 1 ? "" : "s"}`}
				confirmLabel="Move"
				folders={ownFolders}
				rootLabel="Not in a folder"
				initialTarget={
					ownFolders.some((f) => f.id === sharedFolder) ? sharedFolder : null
				}
				onCancel={() => setMoveOpen(false)}
				onConfirm={(folderId) => {
					moveTo(movableIds, folderId)
					setMoveOpen(false)
					setSelectedIds(new Set())
				}}
			/>
			<FolderPickerModal
				open={duplicateOpen}
				title={`Duplicate ${selectedCount} data set${selectedCount === 1 ? "" : "s"}`}
				confirmLabel="Duplicate"
				folders={ownFolders}
				rootLabel="Not in a folder"
				initialTarget={
					ownFolders.some((f) => f.id === sharedFolder) ? sharedFolder : null
				}
				onCancel={() => setDuplicateOpen(false)}
				onConfirm={onDuplicate}
			/>
			{/* Floating trash can, bottom-right: what Move to trash fills. */}
			<DataTrashButton />
			<DataPreviewModal
				datasetId={openDatasetId}
				versionId={opened?.versionId ?? null}
				onClose={() => setOpenDatasetId(null)}
				onOpenDataset={setOpenDatasetId}
			/>
		</>
	)
}

const DataTableRow = ({
	row,
	active,
	selected,
	dragIds,
	onToggle,
	onOpen,
}: {
	row: DataRow
	active: boolean
	selected: boolean
	dragIds: string[]
	onToggle: (shift: boolean) => void
	onOpen: () => void
}) => (
	<tr
		className={`cursor-pointer ${
			active
				? "vc-nav-active"
				: selected
					? "bg-brand-50 hover:bg-brand-100 dark:bg-brand-900/20 dark:hover:bg-brand-900/30"
					: "hover:bg-stone-50 dark:hover:bg-stone-700/40"
		}`}
		data-selected={selected || undefined}
		data-dataset-id={row.meta.id}
		draggable
		onDragStart={(e) => {
			e.dataTransfer.setData(
				DATASETS_DRAG_TYPE,
				encodeDatasetsDrag(dragIds)
			)
			e.dataTransfer.effectAllowed = "move"
		}}
		onClick={onOpen}
	>
		{/* The box's cell takes its own clicks: checking a row doesn't open it. */}
		<td className={`${TD} w-px`} onClick={(e) => e.stopPropagation()}>
			<input
				type="checkbox"
				checked={selected}
				onMouseDown={(e) => {
					// Keep shift-click from also selecting page text.
					if (e.shiftKey) e.preventDefault()
				}}
				onChange={(e) => onToggle((e.nativeEvent as MouseEvent).shiftKey)}
				aria-label={`Select ${row.meta.name}`}
				className="h-4 w-4 cursor-pointer"
			/>
		</td>
		<td className={`${TD} max-w-xs`}>
			<button
				type="button"
				className="block max-w-full truncate text-left font-medium vc-heading"
			>
				{row.meta.name}
			</button>
			{row.source && (
				<div className="truncate text-sm vc-muted">
					Made from {row.source.name}
				</div>
			)}
		</td>
		<td className={`${TD} whitespace-nowrap vc-text`}>
			{formatDate(row.createdAt)}
		</td>
		<td className={`${TD} whitespace-nowrap vc-text`}>
			{formatDate(row.updatedAt)}
		</td>
		<td className={`${TD} vc-text`}>
			{row.folderPath || <span className="vc-faint">—</span>}
		</td>
		<td className={`${TD} text-right whitespace-nowrap tabular-nums vc-text`}>
			{row.rows.toLocaleString()} × {row.columns.toLocaleString()}
		</td>
		<td className={`${TD} text-right whitespace-nowrap tabular-nums vc-text`}>
			{row.bytes === null ? (
				<span className="vc-faint">—</span>
			) : (
				formatBytes(row.bytes)
			)}
		</td>
	</tr>
)
