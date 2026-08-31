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

export const VersionBadge = () => {
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

	const badgeLabel = view.isLatest
		? `v${view.versionIndex} of ${view.totalVersions} · latest`
		: `v${view.versionIndex} of ${view.totalVersions}`

	return (
		<div className="relative" ref={popoverRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={`flex items-center gap-2 rounded-sm border px-2 py-1 text-sm transition-colors ${
					view.isLatest
						? "border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
						: "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
				}`}
				title="Data set versions"
			>
				<span className="truncate font-medium">{view.name}</span>
				<span className="text-sm">{badgeLabel}</span>
			</button>
			{open && (
				<div className="absolute top-full right-0 z-20 mt-1 w-80 rounded-md border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800">
					<div className="border-b border-stone-200 px-3 py-2 dark:border-stone-700">
						<div className="truncate text-sm font-medium text-stone-900 dark:text-white">
							{view.name}
						</div>
					</div>
					{mutateError && (
						<div className="border-b border-stone-200 px-3 py-2 text-sm text-red-700 dark:border-stone-700 dark:text-red-300">
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
							className="block w-full border-b border-stone-200 px-3 py-2 text-left text-sm text-blue-700 hover:bg-blue-50 dark:border-stone-700 dark:text-blue-300 dark:hover:bg-blue-900/30"
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
									? "bg-blue-50 dark:bg-blue-900/20"
									: "hover:bg-stone-100 dark:hover:bg-stone-700/50"
							}`}
						>
							<div className="flex items-center justify-between gap-2">
								<button
									type="button"
									onClick={() => onPreview(isLatest ? null : v.id)}
									className="min-w-0 flex-1 text-left"
								>
									<div className="flex items-center gap-2">
										<span className="font-medium text-stone-900 dark:text-stone-100">
											v{versionNumber}
										</span>
										{isLatest && (
											<span className="text-sm text-stone-500 dark:text-stone-400">
												latest
											</span>
										)}
									</div>
									<div className="text-sm text-stone-500 dark:text-stone-400">
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
										className="text-sm text-stone-400 opacity-0 transition-opacity group-hover/v:opacity-100 hover:text-red-600"
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
									className="mt-1 w-full text-left text-sm text-stone-500 italic hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
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
