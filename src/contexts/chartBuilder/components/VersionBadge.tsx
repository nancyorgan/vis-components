import { useEffect, useRef, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { pruneOrphanFields } from "../lib/datasetCompat"
import { withFreshContentHash } from "../lib/datasetDedupe"
import type { DatasetLike } from "../lib/datasetMeta"
import type { Dataset } from "../lib/types"
import {
	datasetIndexAtom,
	mutateDatasetBodyAtom,
	previewVersionIdAtom,
} from "../store/atoms"
import { useCurrentDatasetView } from "../store/useCurrentDatasetView"

import { Input } from "../../../components/ui/Input"

const formatTime = (ts: number): string => {
	const d = new Date(ts)
	return d.toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})
}

/** `compact` (narrow layouts): drop the data set name so the chip fits on
 *  a phone row beside the action buttons; the version label stays. */
export const VersionBadge = ({ compact = false }: { compact?: boolean }) => {
	const view = useCurrentDatasetView()
	const [previewVersionId, setPreviewVersionId] =
		useAtom(previewVersionIdAtom)
	const mutateDatasetBody = useSetAtom(mutateDatasetBodyAtom)
	const [open, setOpen] = useState(false)
	// Deleting a version or editing a note may first LOAD the full body
	// (lazily, possibly over the network) — a failure there must say so, or
	// the click just silently does nothing.
	const [mutateError, setMutateError] = useState<string | null>(null)
	const popoverRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onClick = (e: MouseEvent) => {
			const target = e.target as Node
			// Skip targets that React already detached from the DOM during this
			// event's bubble (e.g. clicking the "Add a note…" button replaces it
			// with an Input mid-bubble; without this guard, contains() returns
			// false and we'd incorrectly close the popover).
			if (!target.isConnected) return
			if (popoverRef.current && !popoverRef.current.contains(target)) {
				setOpen(false)
			}
		}
		// Defer one tick so the click that opened us doesn't immediately close it
		const id = window.setTimeout(
			() => window.addEventListener("click", onClick),
			0
		)
		return () => {
			window.clearTimeout(id)
			window.removeEventListener("click", onClick)
		}
	}, [open])

	if (!view) return null

	/** Apply `mutate` to the full dataset body, loading it first if this
	 * session only has the lazy per-version rows (the shared
	 * `mutateDatasetBodyAtom` owns the load and the prev-wins merge). The
	 * version list itself renders from metadata; only these two mutations
	 * need every row. */
	const mutateDataset = async (
		id: string,
		mutate: (d: Dataset) => Dataset
	): Promise<void> => {
		try {
			await mutateDatasetBody(id, mutate)
			setMutateError(null)
		} catch {
			setMutateError(
				"Couldn't load this data set to update it. Check your connection and try again."
			)
		}
	}

	const deleteVersion = (versionId: string) => {
		void mutateDataset(view.id, (d) => {
			if (d.versions.length <= 1) return d
			const remaining = d.versions.filter((v) => v.id !== versionId)
			// Length-checked above: remaining has at least one entry.
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded above
			const fallbackLatest = remaining.at(-1)!.id
			const latestVersionId =
				d.latestVersionId === versionId ? fallbackLatest : d.latestVersionId
			// The deleted version may have been the only one carrying an
			// additively-merged column; drop fields no remaining version has.
			// Deleting a version changes the content, so the cached content
			// hash must follow (see withFreshContentHash).
			return withFreshContentHash(
				pruneOrphanFields({
					...d,
					versions: remaining,
					latestVersionId,
				})
			)
		})
		// If the deleted version was being previewed, fall back to latest.
		if (previewVersionId === versionId) setPreviewVersionId(null)
	}

	const editVersionNote = (versionId: string, note: string) => {
		void mutateDataset(view.id, (d) => ({
			...d,
			versions: d.versions.map((v) =>
				v.id === versionId
					? {
							...v,
							...(note.trim() ? { note: note.trim() } : { note: undefined }),
						}
					: v
			),
		}))
	}

	// Compact drops "· latest" too (the amber styling already flags a
	// non-latest version) so the chip plus the action group fit a 320px row.
	const badgeLabel =
		view.isLatest && !compact
			? `v${view.versionIndex} of ${view.totalVersions} · latest`
			: `v${view.versionIndex} of ${view.totalVersions}`

	return (
		<div className="relative" ref={popoverRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`flex items-center gap-2 rounded-control border px-2 py-1 text-sm transition-colors ${
					view.isLatest
						? "vc-version-pill-latest"
						: "vc-version-pill-old"
				}`}
				title="Data set versions"
			>
				{!compact && (
					<span className="truncate font-medium">{view.name}</span>
				)}
				<span className="text-sm whitespace-nowrap">{badgeLabel}</span>
			</button>
			{open && (
				<div className="vc-menu absolute top-full right-0 z-20 mt-1 w-80">
					<div className="vc-rule-b px-3 py-2">
						<div className="vc-text truncate text-sm font-medium">
							{view.name}
						</div>
					</div>
					{mutateError && (
						<div className="vc-rule-b vc-text-danger px-3 py-2 text-sm">
							{mutateError}
						</div>
					)}
					{!view.isLatest && (
						<button
							type="button"
							onClick={() => {
								setPreviewVersionId(null)
								setOpen(false)
							}}
							className="vc-version-restore vc-rule-b block w-full px-3 py-2 text-left text-sm"
						>
							← Back to latest
						</button>
					)}
					<ul className="max-h-72 overflow-y-auto py-1">
						<VersionList
							view={view}
							previewVersionId={previewVersionId}
							onPreview={(id) => {
								setPreviewVersionId(id)
								setOpen(false)
							}}
							onEditNote={editVersionNote}
							onDelete={deleteVersion}
							canDelete={view.totalVersions > 1}
						/>
					</ul>
				</div>
			)}
		</div>
	)
}

type VersionListProps = {
	view: NonNullable<ReturnType<typeof useCurrentDatasetView>>
	previewVersionId: string | null
	onPreview: (versionId: string | null) => void
	onEditNote: (versionId: string, note: string) => void
	onDelete: (versionId: string) => void
	canDelete: boolean
}

const VersionList = ({
	view,
	previewVersionId,
	onPreview,
	onEditNote,
	onDelete,
	canDelete,
}: VersionListProps) => {
	const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
	const [noteDraft, setNoteDraft] = useState("")
	// Re-fetch the actual version objects from the dataset (the view only has the
	// current one); for the popover list we want all of them.
	const dataset = useDatasetById(view.id)
	if (!dataset) return null
	return (
		<>
			{[...dataset.versions]
				.slice()
				.reverse()
				.map((v, idx) => {
					const versionNumber = dataset.versions.length - idx
					const isLatest = v.id === dataset.latestVersionId
					const isActive =
						(previewVersionId === null && isLatest) || previewVersionId === v.id
					return (
						<li
							key={v.id}
							className={`group/v px-3 py-2 text-sm transition-colors ${
								isActive
									? "vc-version-row-active"
									: "vc-version-row-hover"
							}`}
						>
							<div className="flex items-center justify-between gap-2">
								<button
									type="button"
									onClick={() => onPreview(isLatest ? null : v.id)}
									className="min-w-0 flex-1 text-left"
								>
									<div className="flex items-center gap-2">
										<span className="font-medium vc-text">
											v{versionNumber}
										</span>
										{isLatest && (
											<span className="text-sm vc-text-faint">
												latest
											</span>
										)}
									</div>
									<div className="text-sm vc-text-faint">
										{formatTime(v.createdAt)} · {v.filename}
									</div>
								</button>
								{canDelete && !isActive && (
									<button
										type="button"
										onClick={() => {
											const ok = globalThis.confirm(
												`Delete v${versionNumber}? Iframes pinned to this version will show a "version not found" error.`
											)
											if (ok) onDelete(v.id)
										}}
										className="vc-version-delete text-sm opacity-0 transition-opacity group-hover/v:opacity-100"
										title="Delete version"
									>
										Delete
									</button>
								)}
							</div>
							{editingNoteId === v.id ? (
								<Input
									// eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus for the inline note editor the user just opened
									autoFocus
									value={noteDraft}
									onChange={(e) => setNoteDraft(e.target.value)}
									onBlur={() => {
										onEditNote(v.id, noteDraft)
										setEditingNoteId(null)
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											onEditNote(v.id, noteDraft)
											setEditingNoteId(null)
										}
										if (e.key === "Escape") setEditingNoteId(null)
									}}
									className="mt-1 w-full"
								/>
							) : (
								<button
									type="button"
									onClick={() => {
										setNoteDraft(v.note ?? "")
										setEditingNoteId(v.id)
									}}
									className="vc-link-faint mt-1 w-full text-left text-sm italic"
								>
									{v.note || "Add a note…"}
								</button>
							)}
						</li>
					)
				})}
		</>
	)
}

// The version list is pure metadata (id, filename, createdAt, note), so it
// reads the INDEX — present for every dataset — rather than the loaded-bodies
// map, which is empty for a dataset opened lazily and left the popover blank.
const useDatasetById = (id: string): DatasetLike | undefined => {
	const [index] = useAtom(datasetIndexAtom)
	return index[id]
}
