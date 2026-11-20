import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"
import { Select } from "../../../components/ui/Select"
import { EditDataBody } from "../../chartBuilder/components/drawer/EditDataModal"
import { downloadDatasetCsv } from "../../chartBuilder/lib/downloadDataset"
import { gridFromView } from "../../chartBuilder/lib/editGrid"
import {
	resolveDatasetView,
	resolveDatasetViewFromMeta,
} from "../../chartBuilder/lib/resolveDatasetVersion"
import { getStorageAdapter } from "../../chartBuilder/lib/storage/registry"
import type { DatasetMeta, DatasetView } from "../../chartBuilder/lib/types"
import { describeVersionOrigin } from "../../chartBuilder/lib/versionTransforms"
import {
	currentDatasetIdAtom,
	dataFoldersAtom,
	datasetIndexAtom,
	loadedDatasetsAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"
import {
	folderByDataset,
	formatBytes,
	moveDatasetsToFolder,
	sourceIds,
} from "../lib/dataLineage"
import { folderTreeOrder } from "../lib/folderOrder"
import { isStockDataFolder } from "../lib/stockDataFolder"
import { isDataTrashFolder, trashDatasets } from "../lib/dataTrash"
import { useDataFoldersView } from "../hooks/useDataFoldersView"

/** A data set opened from the Data tab: its rows as a spreadsheet to scan
 *  and sort, and to edit — saving makes a new version exactly as the
 *  editor's Edit data dialog does (the first change to imported data makes
 *  a new data set under it; a change to one already made from another adds
 *  a version). Around the grid: which version is shown, what the data set
 *  was made from, its folder, a CSV download, a new visualization on it,
 *  and Move to trash once nothing draws from it. */
export const DataPreviewModal = ({
	datasetId,
	versionId = null,
	onClose,
	onOpenDataset,
}: {
	datasetId: string | null
	/** The version to open on (null = the latest). */
	versionId?: string | null
	onClose: () => void
	onOpenDataset: (id: string) => void
}) => {
	const datasets = useAtomValue(datasetIndexAtom)
	const meta = datasetId ? datasets[datasetId] : undefined
	return (
		<Modal
			open={meta !== undefined}
			onClose={onClose}
			title={meta?.name}
			widthClass="max-w-6xl"
			closeButton
		>
			{meta && (
				<DataPreview
					// A fresh panel per data set: version pick, edits and all.
					key={`${meta.id}:${versionId ?? ""}`}
					meta={meta}
					initialVersionId={versionId}
					onClose={onClose}
					onOpenDataset={onOpenDataset}
				/>
			)}
		</Modal>
	)
}

/** The outcome of the last fetch, tagged with the version it was for;
 *  `rows: null` = it failed. Anything for another version reads as
 *  "still loading". */
type RowsState = {
	key: string
	rows: Array<Record<string, string>> | null
} | null

/** The view of one version: from a body already in memory, else that one
 *  version's rows fetched for this panel (and not kept past it). */
const useVersionView = (
	meta: DatasetMeta,
	versionId: string
): { view: DatasetView | undefined; failed: boolean } => {
	const whole = useAtomValue(loadedDatasetsAtom)[meta.id]
	const [state, setState] = useState<RowsState>(null)
	const key = `${meta.id}:${versionId}`
	const needFetch = whole === undefined
	const datasetId = meta.id
	useEffect(() => {
		if (!needFetch) return
		let cancelled = false
		const adapter = getStorageAdapter()
		const load = async () =>
			(await adapter.loadDatasetVersion(datasetId, versionId)) ??
			(await adapter.loadDataset(datasetId))?.versions.find(
				(v) => v.id === versionId
			)?.rows ??
			null
		load()
			.then((rows) => {
				if (!cancelled) setState({ key, rows })
			})
			.catch(() => {
				if (!cancelled) setState({ key, rows: null })
			})
		return () => {
			cancelled = true
		}
	}, [needFetch, datasetId, versionId, key])

	const view = useMemo(() => {
		if (whole) return resolveDatasetView(whole, versionId)
		if (state?.key !== key || state.rows === null) return undefined
		return resolveDatasetViewFromMeta(meta, state.rows, versionId)
	}, [whole, state, key, meta, versionId])
	return { view, failed: !whole && state?.key === key && state.rows === null }
}

/** The spreadsheet for one version. Its grid seeds ONCE per mount (keyed by
 *  version above), so a background refresh of the data set can't wipe the
 *  edits in progress. */
const PreviewGrid = ({
	view,
	onClose,
}: {
	view: DatasetView
	onClose: () => void
}) => {
	const [seedGrid] = useState(() => gridFromView(view))
	return (
		<EditDataBody
			view={view}
			seedGrid={seedGrid}
			onClose={onClose}
			detached
			closeLabel="Close"
			intro={
				<div className="text-sm vc-muted">
					Sort a column from the arrow beside its name. Change any cell to
					save a new version of the data — the data as it is now is kept.
				</div>
			}
		/>
	)
}

const DataPreview = ({
	meta,
	initialVersionId,
	onClose,
	onOpenDataset,
}: {
	meta: DatasetMeta
	initialVersionId: string | null
	onClose: () => void
	onOpenDataset: (id: string) => void
}) => {
	const datasets = useAtomValue(datasetIndexAtom)
	const visuals = useAtomValue(visualsAtom)
	const editorDatasetId = useAtomValue(currentDatasetIdAtom)
	// The picker offers the user's folders; the stock shelf is where a stock
	// data set sits until it is filed in one of them.
	const [storedFolders, setFolders] = useAtom(dataFoldersAtom)
	const folders = storedFolders.filter((f) => !isDataTrashFolder(f))
	const onStockShelf = isStockDataFolder({
		id: folderByDataset(useDataFoldersView()).get(meta.id)?.id ?? "",
	})
	const [pickedVersionId, setVersionId] = useState(
		initialVersionId ?? meta.latestVersionId
	)
	// A version deleted elsewhere while this is open falls back to the latest.
	const versionId = meta.versions.some((v) => v.id === pickedVersionId)
		? pickedVersionId
		: meta.latestVersionId
	const { view, failed } = useVersionView(meta, versionId)

	const version = meta.versions.find((v) => v.id === versionId)
	const sourceId = useMemo(
		() => sourceIds(datasets).get(meta.id),
		[datasets, meta.id]
	)
	const source = sourceId ? datasets[sourceId] : undefined
	const folderId = folderByDataset(folders).get(meta.id)?.id ?? null
	const users = visuals.filter((v) => v.datasetId === meta.id)
	const liveUsers = users.filter((v) => !v.deletedAt).length
	const trashedUsers = users.length - liveUsers
	// A data set bound in the editor (an upload not yet saved as a visual
	// included) is in use too.
	const deletable = users.length === 0 && editorDatasetId !== meta.id

	const facts = [
		version &&
			`${version.rowCount.toLocaleString()} rows × ${(version.fields ?? meta.fields).length.toLocaleString()} columns`,
		version?.byteSize !== undefined && formatBytes(version.byteSize),
		users.length === 0
			? "Not used by any visualization"
			: `Used by ${liveUsers} visualization${liveUsers === 1 ? "" : "s"}${
					trashedUsers > 0 ? ` (and ${trashedUsers} in the Trash)` : ""
				}`,
	].filter(Boolean)

	// Restorable from the Data tab's trash, so no confirmation.
	const onTrash = () => {
		void setFolders((prev) => trashDatasets(prev, [meta.id]))
		onClose()
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				<span className="vc-muted">{facts.join(" · ")}</span>
				{source && (
					<span className="vc-muted">
						Made from{" "}
						<button
							type="button"
							className="underline hover:text-stone-900 dark:hover:text-white"
							onClick={() => onOpenDataset(source.id)}
						>
							{source.name}
						</button>
					</span>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{meta.versions.length > 1 && (
					<Select
						value={versionId}
						onChange={(e) => setVersionId(e.target.value)}
						aria-label="Version shown"
						className="w-72"
					>
						{[...meta.versions].reverse().map((v, i) => {
							const origin = describeVersionOrigin(v)
							return (
								<option key={v.id} value={v.id}>
									v{meta.versions.length - i}
									{v.id === meta.latestVersionId ? " (latest)" : ""} ·{" "}
									{v.filename}
									{origin ? ` · ${origin}` : ""}
								</option>
							)
						})}
					</Select>
				)}
				{/* A stock data set stays on its shelf: nothing to pick. */}
				{folders.length > 0 && !onStockShelf && (
					<Select
						value={folderId ?? ""}
						onChange={(e) =>
							void setFolders((prev) =>
								moveDatasetsToFolder(prev, [meta.id], e.target.value || null)
							)
						}
						aria-label="Folder"
						className="w-48"
					>
						<option value="">Not in a folder</option>
						{folderTreeOrder(folders).map(({ folder, depth }) => (
							<option key={folder.id} value={folder.id}>
								{"  ".repeat(depth)}
								{folder.name}
							</option>
						))}
					</Select>
				)}
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{/* Only a data set no visualization draws from can be trashed. */}
					{deletable && (
						<Button compact danger onClick={onTrash}>
							Move to trash
						</Button>
					)}
					{view && (
						<Button
							compact
							onClick={() =>
								void downloadDatasetCsv(view, {
									imported: version?.editedFrom === undefined,
								})
							}
						>
							Download CSV
						</Button>
					)}
					<Link to="/editor/new" search={{ datasetId: meta.id }}>
						<Button compact>New visualization</Button>
					</Link>
				</div>
			</div>
			{view ? (
				<PreviewGrid key={view.versionId} view={view} onClose={onClose} />
			) : (
				<div className="py-16 text-center text-sm vc-muted">
					{failed
						? "Couldn't load this data set. Check your connection and try again."
						: "Loading data…"}
				</div>
			)}
		</div>
	)
}
