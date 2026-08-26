import { useMemo } from "react"
import {
	deriveLandingRows,
	type LandingRow,
} from "../../chartBuilder/lib/landingRows"
import type { DatasetLike } from "../../chartBuilder/lib/datasetMeta"
import type {
	EmbedInstance,
	Folder,
	Visual,
} from "../../chartBuilder/lib/types"
import { folderSubtreeIds } from "../lib/folderSubtree"

export type SortField =
	| "name"
	| "datasetName"
	| "createdAt"
	| "updatedAt"
	| "folderName"
	| "pinState"

export type SortDir = "asc" | "desc"

/** Visual with display-friendly fields pre-resolved for the table view. */
export type DecoratedVisual = {
	visual: Visual
	datasetName: string
	datasetVersionCount: number
	folderName: string // empty string for root
	folderPath: string // e.g. "Marketing / Campaigns" or "" for root
}

const folderPathOf = (
	folders: Folder[],
	folderId: string | null
): { name: string; path: string } => {
	if (!folderId) return { name: "", path: "" }
	const byId = new Map(folders.map((f) => [f.id, f]))
	const segments: string[] = []
	let id: string | null = folderId
	let depth = 0
	while (id && depth < 32) {
		const f = byId.get(id)
		if (!f) break
		segments.unshift(f.name)
		id = f.parentId
		depth += 1
	}
	return { name: segments.at(-1) ?? "", path: segments.join(" / ") }
}

const compareStrings = (a: string, b: string, dir: SortDir): number => {
	const cmp = a.localeCompare(b)
	return dir === "asc" ? cmp : -cmp
}

const compareNumbers = (a: number, b: number, dir: SortDir): number =>
	dir === "asc" ? a - b : b - a

const parseSort = (
	raw: string | undefined
): { field: SortField; dir: SortDir } => {
	const def = { field: "updatedAt" as SortField, dir: "desc" as SortDir }
	if (!raw) return def
	const [field, dir] = raw.split(":")
	const validFields: SortField[] = [
		"name",
		"datasetName",
		"createdAt",
		"updatedAt",
		"folderName",
		"pinState",
	]
	if (!validFields.includes(field as SortField)) return def
	return {
		field: field as SortField,
		dir: dir === "asc" ? "asc" : "desc",
	}
}

type Args = {
	visuals: Visual[]
	datasets: Record<string, DatasetLike>
	folders: Folder[]
	folderId: string | null // selected folder filter; null = all
	/** Selected dataset filter by NAME; null = all datasets. Matching by name
	 * (not id) means one dropdown entry per name collapses same-named datasets
	 * — e.g. two uploads of "sales.csv" with different content — so the filter
	 * catches every visual using any dataset with that name. */
	datasetName: string | null
	query: string
	sort: string | undefined
}

/** Decorate, filter, and sort visuals once. Used by the grid view. */
export const useFilteredSortedVisuals = ({
	visuals,
	datasets,
	folders,
	folderId,
	datasetName,
	query,
	sort,
}: Args): DecoratedVisual[] => {
	return useMemo(() => {
		const { field, dir } = parseSort(sort)
		const q = query.trim().toLowerCase()

		const decorated: DecoratedVisual[] = visuals.map((v) => {
			const dataset = v.datasetId ? datasets[v.datasetId] : undefined
			const { name: folderName, path: folderPath } = folderPathOf(
				folders,
				v.folderId
			)
			return {
				visual: v,
				datasetName: dataset?.name ?? "",
				datasetVersionCount: dataset?.versions.length ?? 0,
				folderName,
				folderPath,
			}
		})

		// Selecting a folder shows its whole subtree, not just direct children.
		const folderFilter =
			folderId === null ? null : folderSubtreeIds(folders, folderId)

		const filtered = decorated.filter((d) => {
			const vFolder = d.visual.folderId ?? null
			if (
				folderFilter !== null &&
				(vFolder === null || !folderFilter.has(vFolder))
			) {
				return false
			}
			if (datasetName !== null && d.datasetName !== datasetName) {
				return false
			}
			if (q.length > 0 && !d.visual.name.toLowerCase().includes(q)) {
				return false
			}
			return true
		})

		const sorted = [...filtered].sort((a, b) => {
			switch (field) {
				case "name": {
					return compareStrings(a.visual.name, b.visual.name, dir)
				}
				case "datasetName": {
					return compareStrings(a.datasetName, b.datasetName, dir)
				}
				case "folderName": {
					return compareStrings(a.folderPath, b.folderPath, dir)
				}
				case "createdAt": {
					return compareNumbers(a.visual.createdAt, b.visual.createdAt, dir)
				}
				default: {
					// "updatedAt" — also the parser fallback.
					return compareNumbers(a.visual.updatedAt, b.visual.updatedAt, dir)
				}
			}
		})

		return sorted
	}, [visuals, datasets, folders, folderId, datasetName, query, sort])
}

/** One LandingRow extended with folder path info for table display +
 * sorting. `updatedAt` is always the underlying visual's updatedAt (instance
 * rows don't currently carry their own updatedAt); `rowCreatedAt` is the
 * embed-instance createdAt for instance rows, falling back to the visual's
 * createdAt for unexported rows so sorts remain stable. */
export type DecoratedRow = LandingRow & {
	folderName: string
	folderPath: string
	rowCreatedAt: number
	visualUpdatedAt: number
	datasetName: string
}

type RowArgs = Args & {
	instances: Record<string, EmbedInstance>
}

/** Table-view variant: emits one row per EmbedInstance (plus a placeholder
 * for visuals with no instances). Shares filtering and sorting semantics
 * with `useFilteredSortedVisuals` — filters apply to the underlying visual,
 * then rows are expanded and sorted. */
export const useFilteredSortedLandingRows = ({
	visuals,
	datasets,
	instances,
	folders,
	folderId,
	datasetName,
	query,
	sort,
}: RowArgs): DecoratedRow[] => {
	return useMemo(() => {
		const { field, dir } = parseSort(sort)
		const q = query.trim().toLowerCase()

		// Selecting a folder shows its whole subtree, not just direct children.
		const folderFilter =
			folderId === null ? null : folderSubtreeIds(folders, folderId)

		// Filter visuals first — row derivation only runs on the surviving set.
		const filteredVisuals = visuals.filter((v) => {
			const vFolder = v.folderId ?? null
			if (
				folderFilter !== null &&
				(vFolder === null || !folderFilter.has(vFolder))
			) {
				return false
			}
			if (datasetName !== null) {
				const vName = v.datasetId ? datasets[v.datasetId]?.name ?? "" : ""
				if (vName !== datasetName) return false
			}
			if (q.length > 0 && !v.name.toLowerCase().includes(q)) return false
			return true
		})

		const rows = deriveLandingRows(filteredVisuals, instances, datasets)

		const decorated: DecoratedRow[] = rows.map((row) => {
			const { name: folderName, path: folderPath } = folderPathOf(
				folders,
				row.visual.folderId
			)
			const rowCreatedAt =
				row.kind === "instance" ? row.instance.createdAt : row.visual.createdAt
			return {
				...row,
				folderName,
				folderPath,
				rowCreatedAt,
				visualUpdatedAt: row.visual.updatedAt,
				datasetName: row.dataset?.name ?? "",
			}
		})

		// Pin state ordering for sort: live updates first, then pinned, then
		// the warning states. Alphabetic sort would put "dangling" before
		// "live", which matches almost no user intent.
		const pinOrder: Record<DecoratedRow["pinState"], number> = {
			live: 0,
			pinned: 1,
			dangling: 2,
			unexported: 3,
		}
		const sorted = [...decorated].sort((a, b) => {
			switch (field) {
				case "name": {
					return compareStrings(a.visual.name, b.visual.name, dir)
				}
				case "datasetName": {
					return compareStrings(a.datasetName, b.datasetName, dir)
				}
				case "folderName": {
					return compareStrings(a.folderPath, b.folderPath, dir)
				}
				case "createdAt": {
					return compareNumbers(a.rowCreatedAt, b.rowCreatedAt, dir)
				}
				case "pinState": {
					return compareNumbers(pinOrder[a.pinState], pinOrder[b.pinState], dir)
				}
				default: {
					return compareNumbers(a.visualUpdatedAt, b.visualUpdatedAt, dir)
				}
			}
		})

		return sorted
	}, [visuals, datasets, instances, folders, folderId, datasetName, query, sort])
}

export { parseSort }
