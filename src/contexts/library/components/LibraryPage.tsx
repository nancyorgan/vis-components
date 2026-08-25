import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import {
	datasetsAtom,
	embedInstancesAtom,
	foldersAtom,
	librarySidebarWidthAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"
import { duplicateVisual } from "../../chartBuilder/lib/duplicateVisual"
import {
	loadLibrarySelectedFolderId,
	saveLibrarySelectedFolderId,
} from "../../chartBuilder/lib/storage"
import { useDeleteVisuals } from "../../chartBuilder/store/useDeleteVisuals"

import { Button } from "../../../components/ui/Button"
import { Input } from "../../../components/ui/Input"
import { Modal } from "../../../components/ui/Modal"
import { ResetLink } from "../../../components/ui/ResetLink"
import { Select } from "../../../components/ui/Select"
import {
	parseSort,
	useFilteredSortedLandingRows,
	useFilteredSortedVisuals,
	type SortField,
} from "../hooks/useFilteredSortedVisuals"
import {
	VISUALS_DRAG_TYPE,
	encodeVisualsDrag,
	setCurrentDrag,
} from "../lib/folderDnd"
import {
	backfillCandidates,
	runThumbnailBackfill,
	type BackfillProgress,
} from "../lib/thumbnailBackfill"
import { BulkMoveModal } from "./BulkMoveModal"
import { DeleteVisualButton } from "./DeleteVisualButton"
import { DownloadVisualsButton } from "./DownloadVisualsButton"
import { DuplicateVisualButton } from "./DuplicateVisualButton"
import { FolderTree } from "./FolderTree"
import { MoveToFolderButton } from "./MoveToFolderButton"
import { RegeneratePreviewButton } from "./RegeneratePreviewButton"
import { VisualsTable } from "./VisualsTable"

const MIN_SIDEBAR_WIDTH = 208
const MAX_SIDEBAR_WIDTH = 480

const formatTimestamp = (ts: number): string => {
	const d = new Date(ts)
	return d.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	})
}

export const LibraryPage = () => {
	const visuals = useAtomValue(visualsAtom)
	const datasets = useAtomValue(datasetsAtom)
	const embedInstances = useAtomValue(embedInstancesAtom)
	const folders = useAtomValue(foldersAtom)
	const [, setVisuals] = useAtom(visualsAtom)
	const deleteVisuals = useDeleteVisuals()
	const search = useSearch({ from: "/" })
	const navigate = useNavigate({ from: "/" })

	// Resizable folder sidebar — same pointer-capture pattern as the
	// editor's sidebar (EditorLayout), persisted independently of it.
	const [sidebarWidth, setSidebarWidth] = useAtom(
		librarySidebarWidthAtom
	)
	const resizingRef = useRef(false)
	const resizeStartXRef = useRef(0)
	const resizeStartWidthRef = useRef(0)

	const onSidebarResizeStart = useCallback(
		(e: React.PointerEvent) => {
			resizingRef.current = true
			resizeStartXRef.current = e.clientX
			resizeStartWidthRef.current = sidebarWidth
			;(e.target as HTMLElement).setPointerCapture(e.pointerId)

			const onMove = (ev: PointerEvent) => {
				if (!resizingRef.current) return
				const delta = ev.clientX - resizeStartXRef.current
				const next = Math.min(
					MAX_SIDEBAR_WIDTH,
					Math.max(MIN_SIDEBAR_WIDTH, resizeStartWidthRef.current + delta)
				)
				setSidebarWidth(next)
			}
			const onUp = () => {
				resizingRef.current = false
				window.removeEventListener("pointermove", onMove)
				window.removeEventListener("pointerup", onUp)
			}
			window.addEventListener("pointermove", onMove)
			window.addEventListener("pointerup", onUp)
		},
		[sidebarWidth, setSidebarWidth]
	)

	// Selection lives at the Visual-id level (not row-key level). In the
	// table, multiple instance rows can share a visual; they highlight
	// together so the user sees what "selected" actually targets when they
	// run a bulk Move or Delete.
	const [selectedVisualIds, setSelectedVisualIds] = useState<Set<string>>(
		new Set()
	)
	const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

	const toggleVisualSelected = (visualId: string) => {
		setSelectedVisualIds((prev) => {
			const next = new Set(prev)
			if (next.has(visualId)) next.delete(visualId)
			else next.add(visualId)
			return next
		})
	}
	const clearSelection = () => setSelectedVisualIds(new Set())

	const selectedFolderId = search.folder ?? null
	const selectedDatasetName = search.dataset ?? null

	// The selected folder lives in the URL (?folder=), which links back from
	// the editor don't carry. Restore the last-visited folder once on mount
	// when the URL doesn't name one; afterwards mirror every change back to
	// storage. Skipping the first save keeps the bare-URL null of a fresh
	// mount from clobbering the stored id before the restore navigation lands.
	const folderRestoredRef = useRef(false)
	useEffect(() => {
		if (!folderRestoredRef.current) {
			folderRestoredRef.current = true
			if (selectedFolderId === null) {
				const stored = loadLibrarySelectedFolderId()
				if (stored !== null && folders.some((f) => f.id === stored)) {
					void navigate({
						search: (prev) => ({ ...prev, folder: stored }),
						replace: true,
					})
				}
				return
			}
			// Mounted with an explicit ?folder= (bookmark, browser back):
			// fall through and record it so the next round-trip returns here.
		}
		saveLibrarySelectedFolderId(selectedFolderId)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedFolderId])
	const view = search.view ?? "grid"
	const query = search.q ?? ""
	const { field: sortField, dir: sortDir } = parseSort(search.sort)

	const setSelectedFolderId = (id: string | null) => {
		navigate({ search: (prev) => ({ ...prev, folder: id ?? undefined }) })
	}
	const setSelectedDatasetName = (name: string | null) => {
		navigate({ search: (prev) => ({ ...prev, dataset: name ?? undefined }) })
	}
	const setView = (next: "grid" | "table") => {
		navigate({
			search: (prev) => ({ ...prev, view: next === "grid" ? undefined : next }),
		})
	}
	const setQuery = (next: string) => {
		navigate({ search: (prev) => ({ ...prev, q: next || undefined }) })
	}
	const onSort = (field: SortField) => {
		const nextDir = sortField === field && sortDir === "desc" ? "asc" : "desc"
		const value = `${field}:${nextDir}`
		// Hide the URL param when it matches the default (updatedAt:desc).
		const isDefault = value === "updatedAt:desc"
		navigate({
			search: (prev) => ({ ...prev, sort: isDefault ? undefined : value }),
		})
	}

	// Grid view uses one card per visual. Table view uses one row per embed
	// instance (with a placeholder for visuals that have zero instances). Both
	// apply the same folder / dataset / query / sort inputs; the two hooks
	// produce different row shapes.
	const gridRows = useFilteredSortedVisuals({
		visuals,
		datasets,
		folders,
		folderId: selectedFolderId,
		datasetName: selectedDatasetName,
		query,
		sort: search.sort,
	})
	const tableRows = useFilteredSortedLandingRows({
		visuals,
		datasets,
		instances: embedInstances,
		folders,
		folderId: selectedFolderId,
		datasetName: selectedDatasetName,
		query,
		sort: search.sort,
	})

	// Dataset names for the filter dropdown, deduped and alphabetized. Keyed by
	// name (not id) so same-named datasets — e.g. two uploads of "sales.csv"
	// with different content — collapse to a single entry, and selecting it
	// matches every visual using any dataset with that name. Only names that at
	// least one visual actually references are listed, so the filter never
	// offers a dataset that would return zero results.
	const datasetList = Array.from(
		new Set(
			visuals
				.map((v) => (v.datasetId ? datasets[v.datasetId]?.name : undefined))
				.filter((name): name is string => name != null)
		)
	).sort((a, b) => a.localeCompare(b))

	const moveToFolder = (visualId: string, folderId: string | null) => {
		setVisuals((prev) =>
			prev.map((v) => (v.id === visualId ? { ...v, folderId } : v))
		)
	}

	// Drop any selected ids that no longer correspond to a visible row, so
	// a bulk action can't quietly catch a hidden-but-selected visual after
	// the user changes filters.
	const visibleVisualIds =
		view === "table"
			? new Set(tableRows.map((r) => r.visual.id))
			: new Set(gridRows.map((d) => d.visual.id))
	const visibleKey = [...visibleVisualIds].sort().join("|")
	useEffect(() => {
		setSelectedVisualIds((prev) => {
			let changed = false
			const next = new Set<string>()
			for (const id of prev) {
				if (visibleVisualIds.has(id)) next.add(id)
				else changed = true
			}
			return changed ? next : prev
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visibleKey])

	const toggleAllVisible = () => {
		setSelectedVisualIds((prev) => {
			const allSelected = [...visibleVisualIds].every((id) => prev.has(id))
			if (allSelected) {
				const next = new Set(prev)
				for (const id of visibleVisualIds) next.delete(id)
				return next
			}
			const next = new Set(prev)
			for (const id of visibleVisualIds) next.add(id)
			return next
		})
	}

	const onBulkMove = (folderId: string | null) => {
		setVisuals((prev) =>
			prev.map((v) =>
				selectedVisualIds.has(v.id) ? { ...v, folderId } : v
			)
		)
		setBulkMoveOpen(false)
		clearSelection()
	}

	const onBulkDuplicate = () => {
		setVisuals((prev) => {
			const copies = prev
				.filter((v) => selectedVisualIds.has(v.id))
				.map((v) => duplicateVisual(v))
			return [...copies, ...prev]
		})
		clearSelection()
	}

	const onBulkDelete = () => {
		// Cascades embeds and now-orphaned datasets (see useDeleteVisuals).
		deleteVisuals(selectedVisualIds)
		setBulkDeleteOpen(false)
		clearSelection()
	}

	// Bulk thumbnail regeneration — restores previews stripped by the old
	// localStorage quota fallback. Non-null progress doubles as the "a run is
	// in flight" flag; candidates are recomputed at click time so the run
	// reflects the freshest list.
	const [backfillProgress, setBackfillProgress] =
		useState<BackfillProgress | null>(null)
	const [backfillNote, setBackfillNote] = useState<string | null>(null)
	const missingPreviewCount = backfillCandidates(visuals, datasets).length

	const onRegeneratePreviews = async () => {
		if (backfillProgress) return
		setBackfillNote(null)
		const candidates = backfillCandidates(visuals, datasets)
		setBackfillProgress({ done: 0, total: candidates.length })
		try {
			const result = await runThumbnailBackfill(candidates, {
				onProgress: setBackfillProgress,
				onCaptured: (visualId, thumbnail) => {
					// Fill only if still empty — a visual edited (and re-captured)
					// mid-run has a fresher thumbnail than our offscreen render.
					// updatedAt stays put: regenerating a preview isn't an edit.
					setVisuals((prev) =>
						prev.map((v) =>
							v.id === visualId && !v.thumbnail ? { ...v, thumbnail } : v
						)
					)
				},
			})
			if (result.failed > 0) {
				setBackfillNote(
					`Couldn't regenerate ${result.failed} preview${
						result.failed === 1 ? "" : "s"
					} — those visuals may not render with their current data.`
				)
			}
		} finally {
			setBackfillProgress(null)
		}
	}

	const selectedCount = selectedVisualIds.size
	// Id + name for the selected rows, in library order — the Download action
	// names a single-visual file after the visual itself.
	const selectedVisuals = visuals
		.filter((v) => selectedVisualIds.has(v.id))
		.map((v) => ({ id: v.id, name: v.name }))

	const selectedFolderName =
		selectedFolderId === null
			? "All visualizations"
			: (folders.find((f) => f.id === selectedFolderId)?.name ??
				"Visualizations")

	return (
		<div className="flex h-[calc(100vh-57px)]">
			<div className="flex-shrink-0" style={{ width: sidebarWidth }}>
				<FolderTree
					selectedFolderId={selectedFolderId}
					onSelect={setSelectedFolderId}
				/>
			</div>
			{/* Resize handle */}
			<div
				role="separator"
				aria-orientation="vertical"
				onPointerDown={onSidebarResizeStart}
				className="group flex w-1.5 flex-shrink-0 cursor-ew-resize items-center justify-center border-r border-stone-200 bg-stone-50 hover:bg-stone-200 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-700"
			>
				<div className="h-8 w-0.5 rounded-full bg-stone-300 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-stone-500" />
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-6xl px-6 py-10">
					<div className="mb-6 flex flex-wrap items-center gap-3">
						<h1 className="mr-auto text-xl font-semibold text-stone-900 dark:text-white">
							{selectedFolderName}
						</h1>
						<Input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search visualizations…"
							className="w-64"
						/>
						<Select
							value={selectedDatasetName ?? ""}
							onChange={(e) => setSelectedDatasetName(e.target.value || null)}
							className="w-48"
							title="Filter by data set"
						>
							<option value="">All data sets</option>
							{datasetList.map((name) => (
								<option key={name} value={name}>
									{name}
								</option>
							))}
						</Select>
						{(missingPreviewCount > 0 || backfillProgress !== null) && (
							<Button
								compact
								outline
								disabled={backfillProgress !== null}
								onClick={onRegeneratePreviews}
								title="Render each visualization without a preview offscreen and save a new thumbnail"
							>
								{backfillProgress
									? `Regenerating ${Math.min(
											backfillProgress.done + 1,
											backfillProgress.total
										)}/${backfillProgress.total}…`
									: `Regenerate ${missingPreviewCount} preview${
											missingPreviewCount === 1 ? "" : "s"
										}`}
							</Button>
						)}
						<ViewToggle view={view} onChange={setView} />
					</div>
					{backfillNote && (
						<p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
							{backfillNote}
						</p>
					)}
					{selectedCount > 0 && (
						<div className="mb-4 flex flex-wrap items-center gap-2 rounded-sm border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
							<span className="text-sm font-medium text-blue-900 dark:text-blue-200">
								{selectedCount} selected
							</span>
							<div className="ml-auto flex items-center gap-2">
								<Button compact onClick={() => setBulkMoveOpen(true)}>
									Move…
								</Button>
								<Button compact onClick={onBulkDuplicate}>
									Duplicate
								</Button>
								<DownloadVisualsButton selected={selectedVisuals} />
								{/* Destructive action: red all the way through, including the
								    brand-colored top/bottom edges the filled button inherits. */}
								<Button
									compact
									onClick={() => setBulkDeleteOpen(true)}
									className="!border-t-red-500 !border-b-red-800 !bg-red-600 !text-white hover:!bg-red-700 dark:!border-t-red-600 dark:!border-b-red-900 dark:!bg-red-700 dark:hover:!bg-red-600"
								>
									Delete…
								</Button>
								<ResetLink label="Clear" onClick={clearSelection} />
							</div>
						</div>
					)}
					{view === "table" ? (
						<VisualsTable
							rows={tableRows}
							sortField={sortField}
							sortDir={sortDir}
							onSort={onSort}
							selectedVisualIds={selectedVisualIds}
							onToggleVisual={toggleVisualSelected}
							onToggleAllVisible={toggleAllVisible}
						/>
					) : gridRows.length === 0 ? (
						<div className="flex flex-col items-center gap-4 rounded-sm border border-dashed border-stone-300 bg-white px-8 py-20 text-center dark:border-stone-700 dark:bg-stone-800">
							<p className="max-w-md text-sm text-stone-600 dark:text-stone-400">
								{query
									? `No visualizations match "${query}".`
									: selectedFolderId
										? "This folder is empty."
										: "No visualizations yet. Start a new one to upload a data set and build a visualization."}
							</p>
							<Link to="/editor/new" className="mt-2">
								<Button>New visualization</Button>
							</Link>
						</div>
					) : (
						<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{gridRows.map((d) => {
								const isSelected = selectedVisualIds.has(d.visual.id)
								return (
								<li
									key={d.visual.id}
									className="group/card relative"
									draggable
									onDragStart={(e) => {
										// Grid drags carry just this card (the checkbox selection is
										// deliberately not drawn in — see the design doc's YAGNI list).
										e.dataTransfer.setData(
											VISUALS_DRAG_TYPE,
											encodeVisualsDrag([d.visual.id])
										)
										e.dataTransfer.effectAllowed = "move"
										setCurrentDrag({ kind: "visuals", visualIds: [d.visual.id] })
									}}
									onDragEnd={() => setCurrentDrag(null)}
								>
									<Link
										to="/editor/$visualId"
										params={{ visualId: d.visual.id }}
										className={`block overflow-hidden rounded-sm border bg-white shadow-sm transition-shadow hover:shadow-md dark:bg-stone-800 ${
											isSelected
												? "border-blue-500 ring-2 ring-blue-400 dark:border-blue-400 dark:ring-blue-500"
												: "border-stone-200 dark:border-stone-700"
										}`}
									>
										<div
											className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-stone-50 dark:bg-stone-900"
											style={
												d.visual.channelConfigs?.backgroundColor
													? {
															backgroundColor:
																d.visual.channelConfigs.backgroundColor,
														}
													: undefined
											}
										>
											{d.visual.thumbnail ? (
												<img
													src={d.visual.thumbnail}
													alt={d.visual.name}
													className="h-full w-full object-contain"
												/>
											) : (
												<div className="text-sm text-stone-600 dark:text-stone-400">
													No preview
												</div>
											)}
										</div>
										<div className="border-t border-stone-200 px-3 py-2 dark:border-stone-700">
											<div className="truncate text-sm font-medium text-stone-900 dark:text-white">
												{d.visual.name}
											</div>
											<div className="truncate text-sm text-stone-600 dark:text-stone-400">
												{d.datasetName
													? `Data set: ${d.datasetName}`
													: "No data set"}
											</div>
											<div className="text-sm text-stone-500 dark:text-stone-400">
												Updated {formatTimestamp(d.visual.updatedAt)}
											</div>
										</div>
									</Link>
									{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- click here only stops propagation so checkbox clicks don't reach the card; the checkbox inside is the real (keyboard-accessible) interaction */}
									<label
										className={`absolute top-2 left-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-white/90 shadow-sm ring-1 ring-stone-200 transition-opacity dark:bg-stone-800/90 dark:ring-stone-700 ${
											isSelected
												? "opacity-100"
												: "opacity-0 group-hover/card:opacity-100"
										}`}
										onClick={(e) => e.stopPropagation()}
										title={
											isSelected ? "Deselect this visualization" : "Select this visualization"
										}
									>
										<input
											type="checkbox"
											checked={isSelected}
											onChange={(e) => {
												e.stopPropagation()
												toggleVisualSelected(d.visual.id)
											}}
											aria-label={`Select ${d.visual.name}`}
											className="h-4 w-4 cursor-pointer"
										/>
									</label>
									<div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
										{d.visual.datasetId !== null &&
											datasets[d.visual.datasetId] && (
												<RegeneratePreviewButton
													visualId={d.visual.id}
													visualName={d.visual.name}
												/>
											)}
										<MoveToFolderButton
											visualId={d.visual.id}
											currentFolderId={d.visual.folderId ?? null}
											onMove={moveToFolder}
										/>
										<DuplicateVisualButton
											visualId={d.visual.id}
											visualName={d.visual.name}
										/>
										<DeleteVisualButton
											visualId={d.visual.id}
											visualName={d.visual.name}
										/>
									</div>
								</li>
								)
							})}
						</ul>
					)}
				</div>
			</div>
			<BulkMoveModal
				open={bulkMoveOpen}
				count={selectedCount}
				onCancel={() => setBulkMoveOpen(false)}
				onConfirm={onBulkMove}
			/>
			<Modal
				open={bulkDeleteOpen}
				onClose={() => setBulkDeleteOpen(false)}
				title={`Delete ${selectedCount} visualization${selectedCount === 1 ? "" : "s"}?`}
				widthClass="max-w-md"
			>
				<div className="flex flex-col gap-4">
					<p className="text-sm text-stone-700 dark:text-stone-300">
						This can&rsquo;t be undone. Any iframe embeds pointing to these
						visualizations will stop working.
					</p>
					<div className="flex justify-end gap-2">
						<Button compact outline onClick={() => setBulkDeleteOpen(false)}>
							Cancel
						</Button>
						<button
							type="button"
							onClick={onBulkDelete}
							className="rounded-sm bg-red-600 px-3 py-1.5 text-sm font-medium tracking-wider text-white shadow transition-all hover:bg-red-700 hover:shadow-lg"
						>
							Yes, delete {selectedCount === 1 ? "it" : "them"}
						</button>
					</div>
				</div>
			</Modal>
		</div>
	)
}

const ViewToggle = ({
	view,
	onChange,
}: {
	view: "grid" | "table"
	onChange: (next: "grid" | "table") => void
}) => (
	<div className="inline-flex overflow-hidden rounded-sm border border-stone-300 dark:border-stone-700">
		<button
			type="button"
			onClick={() => onChange("grid")}
			className={`px-3 py-1 text-sm transition-colors ${
				view === "grid"
					? "bg-vc-section-header text-white"
					: "bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
			}`}
			title="Grid view"
			aria-pressed={view === "grid"}
		>
			Grid
		</button>
		<button
			type="button"
			onClick={() => onChange("table")}
			className={`border-l border-stone-300 px-3 py-1 text-sm transition-colors dark:border-stone-700 ${
				view === "table"
					? "bg-vc-section-header text-white"
					: "bg-white text-stone-600 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
			}`}
			title="Table view"
			aria-pressed={view === "table"}
		>
			Table
		</button>
	</div>
)
