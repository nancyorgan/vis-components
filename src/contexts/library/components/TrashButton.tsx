import { useState } from "react"
import { useAtomValue } from "jotai"
import {
	datasetIndexAtom,
	embedInstancesAtom,
	trashedVisualsAtom,
} from "../../chartBuilder/store/atoms"
import {
	usePurgeVisuals,
	useRestoreVisuals,
} from "../../chartBuilder/store/useDeleteVisuals"

import { Button } from "../../../components/ui/Button"
import { Modal } from "../../../components/ui/Modal"
import { TrashIcon } from "./DeleteVisualButton"

const formatDeletedAt = (ts: number): string =>
	new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})

const plural = (n: number, word: string) =>
	`${n} ${word}${n === 1 ? "" : "s"}`

/** The library's Trash: a floating can in the page's bottom-right corner
 * (badge = how many visuals it holds) that opens the Trash panel. Deleting
 * a visual anywhere in the library moves it here; the panel restores it or
 * purges it for good — purge is the only place the old delete cascade
 * (unpublish embeds, sweep orphaned data sets) still runs. */
export const TrashButton = () => {
	const trashed = useAtomValue(trashedVisualsAtom)
	const datasets = useAtomValue(datasetIndexAtom)
	const instances = useAtomValue(embedInstancesAtom)
	const restoreVisuals = useRestoreVisuals()
	const purgeVisuals = usePurgeVisuals()
	const [open, setOpen] = useState(false)
	const [confirmEmpty, setConfirmEmpty] = useState(false)

	const count = trashed.length
	const publishedCount = trashed.filter((v) =>
		Object.values(instances).some(
			(i) => i.visualId === v.id && i.publishId !== undefined
		)
	).length

	const close = () => {
		setOpen(false)
		setConfirmEmpty(false)
	}

	const onEmpty = () => {
		purgeVisuals(trashed.map((v) => v.id))
		close()
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				title={count === 0 ? "Trash is empty" : `Trash · ${plural(count, "visualization")}`}
				aria-label={
					count === 0 ? "Open trash (empty)" : `Open trash, ${plural(count, "item")}`
				}
				className="bg-brand-text-aa fixed right-6 bottom-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:shadow-xl"
			>
				<TrashIcon size={20} />
				{count > 0 && (
					<span
						className="absolute -top-1 -right-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] leading-5 font-semibold text-white ring-2 ring-white dark:ring-stone-900"
						aria-hidden="true"
					>
						{count}
					</span>
				)}
			</button>
			<Modal
				open={open}
				onClose={close}
				title={count === 0 ? "Trash" : `Trash · ${plural(count, "visualization")}`}
				widthClass="max-w-lg"
			>
				<div className="flex flex-col gap-4">
					{count === 0 ? (
						<p className="text-sm text-stone-600 dark:text-stone-400">
							Nothing in the trash. Deleted visualizations wait here until you
							restore them or empty the trash.
						</p>
					) : (
						<ul className="flex flex-col divide-y divide-stone-200 dark:divide-stone-700">
							{trashed.map((v) => (
								<li key={v.id} className="flex items-center gap-3 py-2">
									<div className="flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
										{v.thumbnail ? (
											<img
												src={v.thumbnail}
												alt=""
												className="h-full w-full object-contain"
											/>
										) : (
											<span className="text-[10px] text-stone-400">No preview</span>
										)}
									</div>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium text-stone-900 dark:text-white">
											{v.name}
										</div>
										<div className="truncate text-xs text-stone-600 dark:text-stone-400">
											{v.datasetId && datasets[v.datasetId]
												? `Data set: ${datasets[v.datasetId].name} · `
												: ""}
											Deleted {formatDeletedAt(v.deletedAt ?? 0)}
										</div>
									</div>
									<Button compact onClick={() => restoreVisuals([v.id])}>
										Restore
									</Button>
									<button
										type="button"
										onClick={() => purgeVisuals([v.id])}
										className="text-sm whitespace-nowrap text-stone-500 hover:text-red-700 dark:text-stone-400 dark:hover:text-red-300"
										title="Delete this visualization permanently"
									>
										Delete forever
									</button>
								</li>
							))}
						</ul>
					)}
					{count > 0 &&
						(confirmEmpty ? (
							<div className="flex flex-col gap-3 rounded-card border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-900/20">
								<p className="text-sm text-stone-700 dark:text-stone-300">
									Permanently delete {plural(count, "visualization")}? This
									can&rsquo;t be undone.
									{publishedCount > 0
										? ` ${plural(publishedCount, "visualization")} ${
												publishedCount === 1 ? "has" : "have"
											} published embeds — their public embed URLs will stop working.`
										: ""}{" "}
									Data sets no other visualization uses will be removed too.
								</p>
								<div className="flex justify-end gap-2">
									<Button compact onClick={() => setConfirmEmpty(false)}>
										Cancel
									</Button>
									<Button compact danger onClick={onEmpty}>
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
