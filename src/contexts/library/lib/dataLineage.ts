import type { DatasetMeta, Folder } from "../../chartBuilder/lib/types"
import { UNFILED_FOLDER_ID, folderAncestors, folderSubtreeIds } from "./folderSubtree"

/** The Data tab's view of the data sets: which was made from which
 *  (lineage), which folder each is filed in, and the rows its list shows.
 *  Everything here reads metadata only — no rows are loaded to list a
 *  library. */

const latestVersionOf = (meta: DatasetMeta) =>
	meta.versions.find((v) => v.id === meta.latestVersionId) ?? meta.versions.at(-1)

/** Data set id → the id of the data set it was made from.
 *
 *  A copy forked since lineage was recorded names its source
 *  (`Dataset.derivedFrom`). An older copy doesn't, but its first version is
 *  a copy of the source's version — same file name, upload time and row
 *  count — so it is matched on that, to an OLDER data set (which also rules
 *  out a cycle). A source that has since been deleted leaves no entry: the
 *  copy then stands on its own. */
export const sourceIds = (
	datasets: Record<string, DatasetMeta>
): Map<string, string> => {
	const out = new Map<string, string>()
	const all = Object.values(datasets)
	for (const d of all) {
		const named = d.derivedFrom?.datasetId
		if (named !== undefined) {
			if (named !== d.id && datasets[named]) out.set(d.id, named)
			continue
		}
		const first = d.versions[0]
		const madeFromAnother =
			first !== undefined &&
			first.editedFrom === undefined &&
			d.versions.some((v) => v.editedFrom !== undefined)
		if (!madeFromAnother) continue
		const candidates = all.filter(
			(s) =>
				s.id !== d.id &&
				s.createdAt < d.createdAt &&
				s.versions.some(
					(v) =>
						v.createdAt === first.createdAt &&
						v.filename === first.filename &&
						v.rowCount === first.rowCount
				)
		)
		// The original import, when it is still there, over a sibling copy.
		const source =
			candidates.find((s) => s.versions.every((v) => v.editedFrom === undefined)) ??
			candidates.sort((a, b) => a.createdAt - b.createdAt)[0]
		if (source) out.set(d.id, source.id)
	}
	// `derivedFrom` is stored data: break any loop it could describe.
	for (const id of [...out.keys()]) {
		const seen = new Set<string>([id])
		let cursor = out.get(id)
		while (cursor !== undefined) {
			if (seen.has(cursor)) {
				out.delete(id)
				break
			}
			seen.add(cursor)
			cursor = out.get(cursor)
		}
	}
	return out
}

/** Data set id → the data folder holding it. A data set is in at most one;
 *  should stored data ever list it twice, the first folder wins. */
export const folderByDataset = (folders: readonly Folder[]): Map<string, Folder> => {
	const out = new Map<string, Folder>()
	for (const f of folders) {
		for (const id of f.datasetIds ?? []) if (!out.has(id)) out.set(id, f)
	}
	return out
}

/** File `datasetIds` in `folderId` (null = no folder), taking them out of
 *  wherever they were. Returns the same list when nothing moves. */
export const moveDatasetsToFolder = (
	folders: Folder[],
	datasetIds: readonly string[],
	folderId: string | null
): Folder[] => {
	const moving = new Set(datasetIds)
	let changed = false
	const next = folders.map((f) => {
		const had = f.datasetIds ?? []
		// The target keeps the members it has where they are and takes the
		// newcomers at the end; every other folder gives the moved ones up.
		const mine =
			f.id === folderId
				? [...had, ...datasetIds.filter((id) => !had.includes(id))]
				: had.filter((id) => !moving.has(id))
		if (mine.length === had.length && mine.every((id, i) => id === had[i])) return f
		changed = true
		return { ...f, datasetIds: mine }
	})
	return changed ? next : folders
}

/** Delete a data folder: its subfolders and its data sets move up to its
 *  parent (the top level / "not in a folder" for a top-level folder).
 *  Nothing but the folder itself is lost. */
export const removeDataFolder = (folders: Folder[], folderId: string): Folder[] => {
	const doomed = folders.find((f) => f.id === folderId)
	if (!doomed) return folders
	const orphans = doomed.datasetIds ?? []
	return folders
		.filter((f) => f.id !== folderId)
		.map((f) => {
			let out = f
			if (f.parentId === folderId) out = { ...out, parentId: doomed.parentId }
			if (f.id === doomed.parentId && orphans.length > 0)
				out = { ...out, datasetIds: [...(out.datasetIds ?? []), ...orphans] }
			return out
		})
}

/** The folder selection as a data set filter: null → every data set;
 *  `UNFILED_FOLDER_ID` → those in no folder; a folder id → its subtree. */
export const dataFolderPredicate = (
	folders: Folder[],
	selectedFolderId: string | null
): ((datasetId: string) => boolean) => {
	if (selectedFolderId === null) return () => true
	const byDataset = folderByDataset(folders)
	if (selectedFolderId === UNFILED_FOLDER_ID) return (id) => !byDataset.has(id)
	const subtree = folderSubtreeIds(folders, selectedFolderId)
	return (id) => {
		const folder = byDataset.get(id)
		return folder !== undefined && subtree.has(folder.id)
	}
}

/** One data set in the rail's tree, with the data sets made from it. */
export type LineageNode = { meta: DatasetMeta; children: LineageNode[] }

const byName = (a: DatasetMeta, b: DatasetMeta) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
	a.createdAt - b.createdAt

/** `members` (the data sets of one folder, or the unfiled ones) as lineage
 *  trees: a data set made from another member sits under it; one whose
 *  source is filed elsewhere (or gone) stands at the top. Top level by
 *  name, copies oldest first. */
export const lineageTrees = (
	members: readonly DatasetMeta[],
	sources: ReadonlyMap<string, string>
): LineageNode[] => {
	const here = new Set(members.map((m) => m.id))
	const childrenOf = new Map<string, DatasetMeta[]>()
	const tops: DatasetMeta[] = []
	for (const m of members) {
		const source = sources.get(m.id)
		if (source !== undefined && here.has(source)) {
			childrenOf.set(source, [...(childrenOf.get(source) ?? []), m])
		} else tops.push(m)
	}
	const build = (meta: DatasetMeta): LineageNode => ({
		meta,
		children: (childrenOf.get(meta.id) ?? [])
			.sort((a, b) => a.createdAt - b.createdAt)
			.map(build),
	})
	return tops.sort(byName).map(build)
}

/** One line of the Data tab's list. */
export type DataRow = {
	meta: DatasetMeta
	/** "Reports / 2026", or "" when the data set is in no folder. */
	folderPath: string
	folderId: string | null
	/** The data set this one was made from, when it is still in the library. */
	source: DatasetMeta | null
	rows: number
	columns: number
	/** Size of the latest version as CSV; null while it is being measured. */
	bytes: number | null
	createdAt: number
	updatedAt: number
	/** How many visualizations (Trash included) draw from it. */
	usedBy: number
}

/** A measurement that failed is stored negative: unknown, not zero. */
const measuredBytes = (bytes: number | undefined): number | null =>
	bytes !== undefined && bytes >= 0 ? bytes : null

export const dataRowFor = (
	meta: DatasetMeta,
	ctx: {
		datasets: Record<string, DatasetMeta>
		folders: readonly Folder[]
		byDataset: ReadonlyMap<string, Folder>
		sources: ReadonlyMap<string, string>
		sizes: Readonly<Record<string, number>>
		useCounts: ReadonlyMap<string, number>
	}
): DataRow => {
	const latest = latestVersionOf(meta)
	const folder = ctx.byDataset.get(meta.id) ?? null
	const sourceId = ctx.sources.get(meta.id)
	return {
		meta,
		folderId: folder?.id ?? null,
		folderPath: folderAncestors(ctx.folders, folder?.id)
			.map((f) => f.name)
			.join(" / "),
		source: sourceId !== undefined ? (ctx.datasets[sourceId] ?? null) : null,
		rows: latest?.rowCount ?? 0,
		columns: (latest?.fields ?? meta.fields).length,
		bytes: latest ? (latest.byteSize ?? measuredBytes(ctx.sizes[latest.id])) : 0,
		createdAt: meta.createdAt,
		updatedAt: meta.versions.reduce(
			(latestAt, v) => Math.max(latestAt, v.createdAt),
			meta.createdAt
		),
		usedBy: ctx.useCounts.get(meta.id) ?? 0,
	}
}

export type DataSortField =
	| "name"
	| "createdAt"
	| "updatedAt"
	| "folder"
	| "dimensions"
	| "size"
export type DataSort = { field: DataSortField; dir: "asc" | "desc" }

const DATA_SORT_FIELDS: readonly DataSortField[] = [
	"name",
	"createdAt",
	"updatedAt",
	"folder",
	"dimensions",
	"size",
]

/** `?sort=<field>:<dir>` for the Data tab; anything else (the visuals'
 *  sort fields included) reads as the default, last edited first. */
export const parseDataSort = (raw: string | undefined): DataSort => {
	const [field, dir] = (raw ?? "").split(":")
	return DATA_SORT_FIELDS.includes(field as DataSortField) &&
		(dir === "asc" || dir === "desc")
		? { field: field as DataSortField, dir }
		: { field: "updatedAt", dir: "desc" }
}

export const sortDataRows = (rows: DataRow[], sort: DataSort): DataRow[] => {
	const text = (a: string, b: string) =>
		a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
	const compare = (a: DataRow, b: DataRow): number => {
		switch (sort.field) {
			case "name":
				return text(a.meta.name, b.meta.name)
			case "createdAt":
				return a.createdAt - b.createdAt
			case "updatedAt":
				return a.updatedAt - b.updatedAt
			case "folder":
				return text(a.folderPath, b.folderPath)
			case "dimensions":
				return a.rows - b.rows || a.columns - b.columns
			case "size":
				return (a.bytes ?? 0) - (b.bytes ?? 0)
		}
	}
	const sign = sort.dir === "asc" ? 1 : -1
	return [...rows].sort(
		(a, b) => sign * compare(a, b) || text(a.meta.name, b.meta.name)
	)
}

/** "812 B", "14 KB", "2.3 MB" — decimal units, like a file manager. */
export const formatBytes = (bytes: number): string => {
	if (bytes < 1000) return `${bytes} B`
	const units = ["KB", "MB", "GB"]
	let value = bytes / 1000
	let unit = 0
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000
		unit += 1
	}
	return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")} ${units[unit]}`
}

export { latestVersionOf }
