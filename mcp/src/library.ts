/** list_charts: the library's charts counted and listed the way the
 *  library page does. Pure: the handler fetches and passes everything in.
 *
 *  - Trash is left out: a chart is trashed only when `deletedAt` is a time
 *    (null and absent both read live).
 *  - Templates are left out, as the library's default "Visuals" view
 *    leaves them out (`kindPredicate(undefined)`).
 *  - The stock Examples folder counts like any folder (server mode stores
 *    its examples as ordinary rows); it is marked read-only.
 *  - A folder's `charts` count is its own charts; listing a folder shows
 *    its whole subtree, as selecting it in the library does, and a chart
 *    in a subfolder names its folder path. */

import { PUBLIC_SEED_FOLDER_IDS } from "../../src/contexts/chartBuilder/lib/stockFolders"
import type { Folder, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { folderTreeOrder } from "../../src/contexts/library/lib/folderOrder"
import { folderSubtreeIds } from "../../src/contexts/library/lib/folderSubtree"
import { kindPredicate } from "../../src/contexts/library/lib/libraryKind"

/** A folder's path from the root ("Research / Drafts"), as the library
 *  table shows it. A parentId cycle stops at 32 levels. */
export const folderPath = (folders: readonly Folder[], id: string | null | undefined): string => {
	const byId = new Map(folders.map((f) => [f.id, f]))
	const segments: string[] = []
	let at = id ?? null
	for (let depth = 0; at !== null && depth < 32; depth++) {
		const f = byId.get(at)
		if (!f) break
		segments.unshift(f.name)
		at = f.parentId
	}
	return segments.join(" / ")
}

/** A listing holds at most this many charts. */
export const LIST_CAP = 50

const listed = kindPredicate(undefined)

/** Every folder in the library tree's order; a folder whose parent is gone
 *  (which the tree can't reach) follows at the end. */
export const treeOrder = (folders: readonly Folder[]): Folder[] => {
	const out = folderTreeOrder(folders).map((e) => e.folder)
	const placed = new Set(out.map((f) => f.id))
	for (const f of folders) if (!placed.has(f.id)) out.push(f)
	return out
}

/** The charts the library lists: live and not templates. */
export const libraryCharts = (visuals: readonly Visual[]): Visual[] =>
	visuals.filter((v) => typeof v.deletedAt !== "number" && listed(v))

/** ISO time to the second. */
const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : "")

export const librarySummary = (visuals: readonly Visual[], folders: readonly Folder[]) => {
	const charts = libraryCharts(visuals)
	const known = new Set(folders.map((f) => f.id))
	const perFolder = new Map<string, number>()
	let unfiled = 0
	for (const v of charts) {
		// A chart pointing at a folder that's gone shows at the root, as the
		// library's unfiled view and Restore treat it.
		if (v.folderId && known.has(v.folderId)) perFolder.set(v.folderId, (perFolder.get(v.folderId) ?? 0) + 1)
		else unfiled++
	}
	return {
		totalFolders: folders.length,
		totalCharts: charts.length,
		chartsInNoFolder: unfiled,
		folders: treeOrder(folders).map((folder) => ({
			path: folderPath(folders, folder.id),
			id: folder.id,
			charts: perFolder.get(folder.id) ?? 0,
			...(PUBLIC_SEED_FOLDER_IDS.includes(folder.id) ? { readOnly: true } : {}),
		})),
	}
}

export type ChartFilter = {
	/** undefined: every folder; null: charts in no folder; else that folder's subtree. */
	folder?: Folder | null
	datasetId?: string
	/** Words the name must all hold, any order and case. */
	query?: string
}

export const chartListing = (visuals: readonly Visual[], folders: readonly Folder[], filter: ChartFilter) => {
	const known = new Set(folders.map((f) => f.id))
	const home = (v: Visual) => (v.folderId && known.has(v.folderId) ? v.folderId : null)
	const subtree = filter.folder ? folderSubtreeIds([...folders], filter.folder.id) : null
	const words = (filter.query ?? "")
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w !== "")
	const hits = libraryCharts(visuals)
		.filter((v) => {
			if (filter.folder === null && home(v) !== null) return false
			if (subtree && !subtree.has(home(v) ?? "")) return false
			if (filter.datasetId !== undefined && v.datasetId !== filter.datasetId) return false
			const name = (v.name ?? "").toLowerCase()
			return words.every((w) => name.includes(w))
		})
		.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
	// A chart names its folder whenever the listing reaches past one folder.
	const nameFolder = (v: Visual) =>
		filter.folder === undefined ? true : filter.folder !== null && home(v) !== filter.folder.id
	const charts = hits.slice(0, LIST_CAP).map((v) => ({
		id: v.id,
		name: v.name,
		updated: iso(v.updatedAt),
		...(nameFolder(v) ? { folder: home(v) === null ? null : folderPath(folders, home(v)) } : {}),
	}))
	return {
		...(filter.folder !== undefined
			? { path: filter.folder === null ? null : folderPath(folders, filter.folder.id) }
			: {}),
		total: hits.length,
		charts,
		...(hits.length > LIST_CAP
			? {
					note: `Showing the newest ${LIST_CAP} of ${hits.length}; narrow with query or dataset.`,
				}
			: {}),
	}
}
