import { useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"
import {
	currentDatasetIdAtom,
	dataFoldersAtom,
	datasetIndexAtom,
	deleteDatasetsAtom,
} from "../../chartBuilder/store/atoms"
import { useDatasetUseCounts } from "../hooks/useDataFoldersView"
import { latestVersionOf } from "../lib/dataLineage"
import { trashedDatasetIds, untrashDatasets } from "../lib/dataTrash"
import { TrashIcon } from "./DeleteVisualButton"

const plural = (n: number, word: string) =>
	`${n} ${word}${n === 1 ? "" : "s"}`

/** The Data tab's Trash: the same floating can the visuals' listing has
 *  (`TrashButton`), holding data sets instead. "Move to trash" puts a data
 *  set here (`lib/dataTrash.ts`); the panel restores it — to no folder — or
 *  deletes it for good, which is the only place a data set's rows are
 *  removed. A trashed data set that has come into use since (only an old
 *  tab could do it) is restored rather than deleted. */
export const DataTrashButton = () => {
	const datasets = useAtomValue(datasetIndexAtom)
	const [folders, setFolders] = useAtom(dataFoldersAtom)
	const deleteDatasets = useSetAtom(deleteDatasetsAtom)
	const useCounts = useDatasetUseCounts(useAtomValue(currentDatasetIdAtom))
	const [open, setOpen] = useState(false)
	const [confirmEmpty, setConfirmEmpty] = useState(false)

	// Ids whose data set is gone (deleted from another tab) just drop out.
	const trashed = trashedDatasetIds(folders)
		.map((id) => datasets[id])
		.filter((meta) => meta !== undefined)
	const count = trashed.length

	const close = () => {
		setOpen(false)
		setConfirmEmpty(false)
	}
	const restore = (ids: string[]) =>
		void setFolders((prev) => untrashDatasets(prev, ids))
	const purge = (ids: string[]) => {
		void setFolders((prev) => untrashDatasets(prev, ids))
		deleteDatasets(ids.filter((id) => !useCounts.has(id)))
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				title="Trash"
				aria-label={
					count === 0
						? "Open trash (empty)"
						: `Open trash, ${plural(count, "data set")}`
				}
				className="bg-brand-text-aa fixed right-6 bottom-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:shadow-xl"
			>
				<TrashIcon size={20} />
				{count > 0 && (
					<span
						className="absolute -top-1 -right-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-xs leading-5 font-semibold text-white ring-2 ring-white dark:ring-stone-900"
						aria-hidden="true"
					>
						{count}
					</span>
				)}
			</button>
			<Modal
				open={open}
				onClose={close}
				title={count === 0 ? "Trash" : `Trash · ${plural(count, "data set")}`}
				widthClass="max-w-lg"
			>
				<div className="flex flex-col gap-4">
					{count === 0 ? (
						<p className="text-sm vc-muted">
							Nothing in the trash. Data sets you move to the trash wait here
							until you restore them or empty the trash.
						</p>
					) : (
						<ul className="flex flex-col divide-y divide-stone-200 dark:divide-stone-700">
							{trashed.map((meta) => {
								const latest = latestVersionOf(meta)
								return (
									<li key={meta.id} className="flex items-center gap-3 py-2">
										<div className="min-w-0 flex-1">
											<div className="truncate text-sm font-medium vc-heading">
												{meta.name}
											</div>
											<div className="truncate text-xs vc-muted">
												{(latest?.rowCount ?? 0).toLocaleString()} rows ×{" "}
												{(latest?.fields ?? meta.fields).length} columns ·{" "}
												{plural(meta.versions.length, "version")}
											</div>
										</div>
										<Button compact onClick={() => restore([meta.id])}>
											Restore
										</Button>
										<button
											type="button"
											onClick={() => purge([meta.id])}
											className="text-sm whitespace-nowrap hover:text-red-700 dark:hover:text-red-300 vc-muted"
										>
											Delete forever
										</button>
									</li>
								)
							})}
						</ul>
					)}
					{count > 0 &&
						(confirmEmpty ? (
							<div className="flex flex-col gap-3 rounded-card border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-900/20">
								<p className="text-sm vc-text">
									Permanently delete {plural(count, "data set")} and every
									version of {count === 1 ? "it" : "them"}? This can&rsquo;t be
									undone.
								</p>
								<div className="flex justify-end gap-2">
									<Button compact onClick={() => setConfirmEmpty(false)}>
										Cancel
									</Button>
									<Button
										compact
										danger
										onClick={() => {
											purge(trashed.map((m) => m.id))
											close()
										}}
									>
										Yes, empty the trash
									</Button>
								</div>
							</div>
						) : (
							<div className="flex justify-end">
								<Button compact danger onClick={() => setConfirmEmpty(true)}>
									Empty trash…
								</Button>
							</div>
						))}
				</div>
			</Modal>
		</>
	)
}
