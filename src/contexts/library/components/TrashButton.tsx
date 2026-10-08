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
				className="vc-library-trash-fab vc-btn-primary fixed right-6 bottom-6 z-40 flex h-12 w-12 items-center justify-center rounded-full transition-all"
			>
				<TrashIcon size={20} />
				{count > 0 && (
					<span
						className="vc-library-trash-count absolute -top-1 -right-1 min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold"
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
						<p className="vc-text-muted text-sm">
							Nothing in the trash. Deleted visualizations wait here until you
							restore them or empty the trash.
						</p>
					) : (
						<ul className="vc-divide-y flex flex-col">
							{trashed.map((v) => (
								<li key={v.id} className="flex items-center gap-3 py-2">
									<div className="vc-box-muted flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden">
										{v.thumbnail ? (
											<img
												src={v.thumbnail}
												alt=""
												className="h-full w-full object-contain"
											/>
										) : (
											<span className="vc-text-fainter text-[10px]">No preview</span>
										)}
									</div>
									<div className="min-w-0 flex-1">
										<div className="vc-text truncate text-sm font-medium">
											{v.name}
										</div>
										<div className="vc-text-muted truncate text-xs">
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
										className="vc-link-danger text-sm whitespace-nowrap"
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
							<div className="vc-library-trash-confirm flex flex-col gap-3 p-3">
								<p className="vc-text-2 text-sm">
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
