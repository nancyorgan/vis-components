import { describe, expect, it } from "vitest"
import type { DatasetMeta, Folder } from "../../chartBuilder/lib/types"
import {
	dataFolderPredicate,
	dataRowFor,
	folderByDataset,
	formatBytes,
	lineageTrees,
	moveDatasetsToFolder,
	parseDataSort,
	removeDataFolder,
	sortDataRows,
	sourceIds,
} from "./dataLineage"
import { UNFILED_FOLDER_ID } from "./folderSubtree"

const meta = (
	id: string,
	over: Partial<DatasetMeta> = {},
	versions: DatasetMeta["versions"] = [
		{ id: `${id}-v1`, filename: `${id}.csv`, createdAt: 100, rowCount: 3 },
	]
): DatasetMeta => ({
	id,
	name: id,
	fields: [
		{ name: "a", inferredType: "categorical" },
		{ name: "b", inferredType: "quantitative" },
	],
	versions,
	latestVersionId: versions.at(-1)?.id ?? "",
	createdAt: 100,
	...over,
})

const index = (...metas: DatasetMeta[]) =>
	Object.fromEntries(metas.map((m) => [m.id, m]))

const folder = (id: string, over: Partial<Folder> = {}): Folder => ({
	id,
	name: id,
	parentId: null,
	createdAt: 1,
	kind: "data",
	datasetIds: [],
	...over,
})

describe("sourceIds", () => {
	it("reads a recorded source, and drops one that is gone", () => {
		const datasets = index(
			meta("import"),
			meta("copy", { derivedFrom: { datasetId: "import", versionId: "x" } }),
			meta("stray", { derivedFrom: { datasetId: "deleted", versionId: "x" } })
		)
		expect([...sourceIds(datasets)]).toEqual([["copy", "import"]])
	})

	it("matches an older copy to its source by its first version", () => {
		const imported = meta("import", { createdAt: 100 }, [
			{ id: "i1", filename: "sales.csv", createdAt: 100, rowCount: 3 },
		])
		// Forked before lineage was recorded: v1 is a copy of the import's
		// version (same file, time and row count), v2 the edit.
		const copy = meta("copy", { createdAt: 500 }, [
			{ id: "c1", filename: "sales.csv", createdAt: 100, rowCount: 3 },
			{
				id: "c2",
				filename: "Edited data",
				createdAt: 500,
				rowCount: 3,
				editedFrom: "c1",
			},
		])
		// Same file name, but never edited: an import of its own.
		const twin = meta("twin", { createdAt: 600 }, [
			{ id: "t1", filename: "sales.csv", createdAt: 100, rowCount: 3 },
		])
		expect([...sourceIds(index(imported, copy, twin))]).toEqual([
			["copy", "import"],
		])
	})

	it("breaks a loop in stored lineage", () => {
		const datasets = index(
			meta("a", { derivedFrom: { datasetId: "b", versionId: "x" } }),
			meta("b", { derivedFrom: { datasetId: "a", versionId: "x" } })
		)
		expect(sourceIds(datasets).size).toBeLessThan(2)
	})
})

describe("lineageTrees", () => {
	it("nests a data set under the member it was made from", () => {
		const members = [meta("b-copy"), meta("a-import"), meta("z-elsewhere")]
		const trees = lineageTrees(
			members,
			new Map([
				["b-copy", "a-import"],
				// Its source is filed in another folder: it stands at the top.
				["z-elsewhere", "not-here"],
			])
		)
		expect(trees.map((t) => t.meta.id)).toEqual(["a-import", "z-elsewhere"])
		expect(trees[0].children.map((c) => c.meta.id)).toEqual(["b-copy"])
	})
})

describe("data folders", () => {
	it("a data set is in one folder at a time", () => {
		const folders = [
			folder("one", { datasetIds: ["x", "y"] }),
			folder("two", { datasetIds: ["z"] }),
		]
		const moved = moveDatasetsToFolder(folders, ["x"], "two")
		expect(moved.map((f) => f.datasetIds)).toEqual([["y"], ["z", "x"]])
		expect(moveDatasetsToFolder(moved, ["x"], null).map((f) => f.datasetIds)).toEqual(
			[["y"], ["z"]]
		)
		// Nothing to move: the same list comes back.
		expect(moveDatasetsToFolder(folders, ["x"], "one")).toBe(folders)
	})

	it("deleting a folder keeps what was in it, one level up", () => {
		const folders = [
			folder("top", { datasetIds: ["a"] }),
			folder("mid", { parentId: "top", datasetIds: ["b"] }),
			folder("leaf", { parentId: "mid", datasetIds: ["c"] }),
		]
		const next = removeDataFolder(folders, "mid")
		expect(next.map((f) => [f.id, f.parentId, f.datasetIds])).toEqual([
			["top", null, ["a", "b"]],
			["leaf", "top", ["c"]],
		])
	})

	it("filters by folder subtree, or to the unfiled", () => {
		const folders = [
			folder("top", { datasetIds: ["a"] }),
			folder("sub", { parentId: "top", datasetIds: ["b"] }),
		]
		const ids = ["a", "b", "c"]
		expect(ids.filter(dataFolderPredicate(folders, null))).toEqual(ids)
		expect(ids.filter(dataFolderPredicate(folders, "top"))).toEqual(["a", "b"])
		expect(ids.filter(dataFolderPredicate(folders, "sub"))).toEqual(["b"])
		expect(ids.filter(dataFolderPredicate(folders, UNFILED_FOLDER_ID))).toEqual([
			"c",
		])
	})
})

describe("list rows", () => {
	const folders = [
		folder("top", { name: "Reports" }),
		folder("sub", { name: "2026", parentId: "top", datasetIds: ["d"] }),
	]
	const d = meta("d", { createdAt: 100 }, [
		{ id: "d1", filename: "d.csv", createdAt: 100, rowCount: 3, byteSize: 40 },
		{
			id: "d2",
			filename: "Edited data",
			createdAt: 900,
			rowCount: 5,
			editedFrom: "d1",
		},
	])
	const row = (sizes: Record<string, number>) =>
		dataRowFor(d, {
			datasets: index(d),
			folders,
			byDataset: folderByDataset(folders),
			sources: new Map(),
			sizes,
			useCounts: new Map([["d", 2]]),
		})

	it("describes the latest version", () => {
		expect(row({ d2: 1234 })).toMatchObject({
			folderPath: "Reports / 2026",
			rows: 5,
			columns: 2,
			bytes: 1234,
			createdAt: 100,
			updatedAt: 900,
			usedBy: 2,
		})
		// Not measured yet, or a measurement that failed: unknown, not zero.
		expect(row({}).bytes).toBeNull()
		expect(row({ d2: -1 }).bytes).toBeNull()
	})

	it("sorts by the Data tab's own columns, last edited first by default", () => {
		expect(parseDataSort(undefined)).toEqual({ field: "updatedAt", dir: "desc" })
		expect(parseDataSort("name:asc")).toEqual({ field: "name", dir: "asc" })
		// A visuals-only sort field falls back to the default.
		expect(parseDataSort("embedCount:asc")).toEqual({
			field: "updatedAt",
			dir: "desc",
		})
		const small = { ...row({ d2: 10 }), meta: meta("small") }
		const big = { ...row({ d2: 99 }), meta: meta("big") }
		expect(
			sortDataRows([small, big], { field: "size", dir: "desc" }).map(
				(r) => r.meta.id
			)
		).toEqual(["big", "small"])
	})
})

describe("formatBytes", () => {
	it("reads like a file manager", () => {
		expect(formatBytes(812)).toBe("812 B")
		expect(formatBytes(14_000)).toBe("14 KB")
		expect(formatBytes(2_340_000)).toBe("2.3 MB")
		expect(formatBytes(512_000_000)).toBe("512 MB")
	})
})
