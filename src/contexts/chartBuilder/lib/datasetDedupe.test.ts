import { describe, it, expect } from "vitest"
import { datasetContentHash, datasetsEqual, dedupeDatasetStores, findDuplicateDataset } from "./datasetDedupe"
import type { Dataset, Visual, EmbedInstance } from "./types"

const ds = (over: Partial<Dataset> = {}): Dataset => ({
	id: "ds-1",
	name: "iris",
	fields: [{ name: "a", inferredType: "quantitative" }],
	versions: [{ id: "dv-1", filename: "iris.csv", rows: [{ a: "1" }, { a: "2" }], createdAt: 1 }],
	latestVersionId: "dv-1",
	createdAt: 1,
	...over,
})

describe("datasetContentHash", () => {
	it("is stable across re-serialization (ignores id/createdAt/versionId)", () => {
		const a = ds()
		const b = ds({ id: "ds-2", createdAt: 999, versions: [{ ...ds().versions[0]!, id: "dv-9", createdAt: 999 }] })
		expect(datasetContentHash(a)).toBe(datasetContentHash(b))
	})

	it("differs when rows differ", () => {
		expect(datasetContentHash(ds())).not.toBe(
			datasetContentHash(ds({ versions: [{ id: "dv-1", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 1 }] }))
		)
	})

	it("differs when version count differs (multi-version not identical to single)", () => {
		const multi = ds({
			versions: [
				{ id: "dv-1", filename: "iris.csv", rows: [{ a: "1" }, { a: "2" }], createdAt: 1 },
				{ id: "dv-2", filename: "iris.csv", rows: [{ a: "1" }, { a: "2" }], createdAt: 2 },
			],
		})
		expect(datasetContentHash(multi)).not.toBe(datasetContentHash(ds()))
	})
})

describe("datasetsEqual", () => {
	it("true for same name + identical content, ignoring ids/timestamps", () => {
		expect(datasetsEqual(ds(), ds({ id: "ds-2", createdAt: 5, latestVersionId: "dv-1" }))).toBe(true)
	})
	it("false when names differ", () => {
		expect(datasetsEqual(ds(), ds({ name: "iris.csv" }))).toBe(false)
	})
	it("false when rows differ", () => {
		expect(datasetsEqual(ds(), ds({ versions: [{ id: "dv-1", filename: "x", rows: [{ a: "9" }], createdAt: 1 }] }))).toBe(false)
	})
})

describe("findDuplicateDataset", () => {
	it("returns the id of a same-name + identical-content dataset", () => {
		const datasets = { "ds-1": ds({ id: "ds-1" }) }
		const candidate = { name: "iris", fields: ds().fields, versions: ds().versions }
		expect(findDuplicateDataset(datasets, candidate)).toBe("ds-1")
	})
	it("returns null when name differs", () => {
		const datasets = { "ds-1": ds({ id: "ds-1", name: "iris" }) }
		expect(findDuplicateDataset(datasets, { name: "iris.csv", fields: ds().fields, versions: ds().versions })).toBeNull()
	})
	it("returns null when rows differ", () => {
		const datasets = { "ds-1": ds({ id: "ds-1" }) }
		const candidate = { name: "iris", fields: ds().fields, versions: [{ id: "x", filename: "iris.csv", rows: [{ a: "9" }], createdAt: 0 }] }
		expect(findDuplicateDataset(datasets, candidate)).toBeNull()
	})
})

const mkVisual = (over: Partial<Visual>): Visual => ({
	id: "v1",
	name: "V",
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: {} as Visual["encodings"],
	channelConfigs: {} as Visual["channelConfigs"],
	labelsConfig: {} as Visual["labelsConfig"],
	thumbnail: null,
	createdAt: 0,
	updatedAt: 0,
	...over,
})

describe("dedupeDatasetStores", () => {
	it("merges two identical-name+content datasets, keeps earliest as canonical", () => {
		const datasets = {
			"ds-old": ds({ id: "ds-old", createdAt: 1, latestVersionId: "dv-old",
				versions: [{ id: "dv-old", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 1 }] }),
			"ds-new": ds({ id: "ds-new", createdAt: 2, latestVersionId: "dv-new",
				versions: [{ id: "dv-new", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 2 }] }),
		}
		const visuals = [mkVisual({ id: "v1", datasetId: "ds-new", createdAtVersionId: "dv-new" })]
		const embeds: Record<string, EmbedInstance> = {
			"ei-1": { id: "ei-1", visualId: "v1", versionId: "dv-new", createdAt: 2, lastExportedAt: 2 },
			"ei-live": { id: "ei-live", visualId: "v1", versionId: null, createdAt: 2, lastExportedAt: 2 },
		}
		const out = dedupeDatasetStores({ datasets, visuals, embeds })

		expect(Object.keys(out.datasets)).toEqual(["ds-old"])
		expect(out.visuals[0]!.datasetId).toBe("ds-old")
		expect(out.visuals[0]!.createdAtVersionId).toBe("dv-old")
		expect(out.embeds["ei-1"]!.versionId).toBe("dv-old")
		expect(out.embeds["ei-live"]!.versionId).toBe(null)
		expect(out.changed).toBe(true)
	})

	it("leaves distinct datasets and differently-named twins alone", () => {
		const datasets = {
			"ds-a": ds({ id: "ds-a", name: "iris" }),
			"ds-b": ds({ id: "ds-b", name: "iris.csv" }),
		}
		const out = dedupeDatasetStores({ datasets, visuals: [], embeds: {} })
		expect(Object.keys(out.datasets).sort()).toEqual(["ds-a", "ds-b"])
		expect(out.changed).toBe(false)
	})

	it("is idempotent — second run is a no-op", () => {
		const datasets = {
			"ds-old": ds({ id: "ds-old", createdAt: 1 }),
			"ds-new": ds({ id: "ds-new", createdAt: 2,
				versions: [{ id: "dv-2", filename: "iris.csv", rows: [{ a: "1" }, { a: "2" }], createdAt: 2 }] }),
		}
		const once = dedupeDatasetStores({ datasets, visuals: [], embeds: {} })
		const twice = dedupeDatasetStores({ datasets: once.datasets, visuals: once.visuals, embeds: once.embeds })
		expect(twice.changed).toBe(false)
		expect(Object.keys(twice.datasets)).toEqual(Object.keys(once.datasets))
	})

	it("backfills contentHash on surviving datasets", () => {
		const out = dedupeDatasetStores({ datasets: { "ds-1": ds() }, visuals: [], embeds: {} })
		expect(out.datasets["ds-1"]!.contentHash).toBe(datasetContentHash(ds()))
	})

	it("does NOT merge same-name datasets with different content", () => {
		const datasets = {
			"ds-a": ds({ id: "ds-a", name: "iris", versions: [{ id: "dv-a", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 1 }] }),
			"ds-b": ds({ id: "ds-b", name: "iris", versions: [{ id: "dv-b", filename: "iris.csv", rows: [{ a: "2" }], createdAt: 1 }] }),
		}
		const out = dedupeDatasetStores({ datasets, visuals: [], embeds: {} })
		expect(Object.keys(out.datasets).sort()).toEqual(["ds-a", "ds-b"])
		expect(out.changed).toBe(false)
	})

	it("remaps a non-first version positionally when multi-version datasets merge", () => {
		const versions = (a: string, b: string) => [
			{ id: a, filename: "iris.csv", rows: [{ a: "1" }], createdAt: 1 },
			{ id: b, filename: "iris.csv", rows: [{ a: "2" }], createdAt: 2 },
		]
		const datasets = {
			"ds-old": ds({ id: "ds-old", createdAt: 1, latestVersionId: "dv-old-2", versions: versions("dv-old-1", "dv-old-2") }),
			"ds-new": ds({ id: "ds-new", createdAt: 2, latestVersionId: "dv-new-2", versions: versions("dv-new-1", "dv-new-2") }),
		}
		// Visual + embed both pin the SECOND version of the duplicate (ds-new).
		const visuals = [mkVisual({ id: "v1", datasetId: "ds-new", createdAtVersionId: "dv-new-2" })]
		const embeds: Record<string, EmbedInstance> = {
			"ei-1": { id: "ei-1", visualId: "v1", versionId: "dv-new-2", createdAt: 2, lastExportedAt: 2 },
		}
		const out = dedupeDatasetStores({ datasets, visuals, embeds })

		expect(Object.keys(out.datasets)).toEqual(["ds-old"])
		expect(out.visuals[0]!.createdAtVersionId).toBe("dv-old-2") // positional: [1] -> [1]
		expect(out.embeds["ei-1"]!.versionId).toBe("dv-old-2")
	})

	it("does not mutate input objects", () => {
		const input = {
			datasets: {
				"ds-old": ds({ id: "ds-old", createdAt: 1, latestVersionId: "dv-old", versions: [{ id: "dv-old", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 1 }] }),
				"ds-new": ds({ id: "ds-new", createdAt: 2, latestVersionId: "dv-new", versions: [{ id: "dv-new", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 2 }] }),
			},
			visuals: [mkVisual({ id: "v1", datasetId: "ds-new", createdAtVersionId: "dv-new" })],
			embeds: {} as Record<string, EmbedInstance>,
		}
		dedupeDatasetStores(input)
		expect(Object.keys(input.datasets).sort()).toEqual(["ds-new", "ds-old"]) // original keys intact
		expect(input.visuals[0]!.datasetId).toBe("ds-new") // original visual untouched
	})

	it("exposes dup->canonical id maps for repointing external pointers", () => {
		const datasets = {
			"ds-old": ds({ id: "ds-old", createdAt: 1, latestVersionId: "dv-old",
				versions: [{ id: "dv-old", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 1 }] }),
			"ds-new": ds({ id: "ds-new", createdAt: 2, latestVersionId: "dv-new",
				versions: [{ id: "dv-new", filename: "iris.csv", rows: [{ a: "1" }], createdAt: 2 }] }),
		}
		const out = dedupeDatasetStores({ datasets, visuals: [], embeds: {} })
		expect(out.datasetIdMap).toEqual({ "ds-new": "ds-old" })
		expect(out.versionIdMap).toEqual({ "dv-new": "dv-old" })
	})
})
