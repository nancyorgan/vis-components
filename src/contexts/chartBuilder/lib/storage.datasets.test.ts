/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed and inspect localStorage deliberately */
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Dataset } from "./types"

/** In-memory fake for the IndexedDB wrapper, shared with the mock via
 *  `vi.hoisted` so the (hoisted) `vi.mock` factory can reference it safely. */
const idb = vi.hoisted(() => {
	const store = new Map<string, unknown>()
	let writesSucceed = true
	return {
		store,
		setWritesSucceed: (v: boolean) => {
			writesSucceed = v
		},
		idbAvailable: () => true,
		idbGet: async (key: string) => (store.has(key) ? store.get(key) : null),
		idbSet: async (key: string, value: unknown) => {
			if (!writesSucceed) return false
			store.set(key, value)
			return true
		},
		idbDelete: async (key: string) => {
			store.delete(key)
		},
	}
})

vi.mock("./storage/idb", () => ({
	idbAvailable: idb.idbAvailable,
	idbGet: idb.idbGet,
	idbSet: idb.idbSet,
	idbDelete: idb.idbDelete,
}))

import {
	deleteDatasetsAsync,
	loadDatasetAsync,
	loadDatasetIndexAsync,
	loadDatasetVersionAsync,
	loadDatasetsAsync,
	saveDatasetsAsync,
} from "./storage"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"

const KEY = "vis-components:datasets"
const INDEX_KEY = "vis-components:datasetIndex"

const makeDataset = (id: string, name = id): Dataset => ({
	id,
	name,
	fields: [{ name: "a", inferredType: "quantitative" }],
	versions: [
		{ id: "v1", filename: `${id}.csv`, rows: [{ a: "1" }], createdAt: 0 },
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const seedLegacyLocalStorage = (datasets: Record<string, Dataset>) => {
	/* eslint-disable-next-line @th/use-wrapped-json-functions */
	localStorage.setItem(KEY, JSON.stringify({ _v: 1, data: datasets }))
}

describe("datasets IndexedDB persistence", () => {
	beforeEach(() => {
		idb.store.clear()
		idb.setWritesSucceed(true)
		installInMemoryLocalStorage()
	})

	it("round-trips datasets through IndexedDB", async () => {
		const datasets = { d1: makeDataset("d1") }
		await saveDatasetsAsync(datasets)
		expect(await loadDatasetsAsync()).toEqual(datasets)
	})

	it("prefers IndexedDB over the legacy localStorage copy", async () => {
		await saveDatasetsAsync({ idb: makeDataset("idb") })
		seedLegacyLocalStorage({ legacy: makeDataset("legacy") })
		const loaded = await loadDatasetsAsync()
		expect(Object.keys(loaded)).toEqual(["idb"])
	})

	it("migrates the legacy localStorage copy into IndexedDB, then clears it", async () => {
		seedLegacyLocalStorage({ legacy: makeDataset("legacy") })
		const loaded = await loadDatasetsAsync()
		// Returned the legacy data…
		expect(Object.keys(loaded)).toEqual(["legacy"])
		// …split it into a per-dataset body plus the shared metadata index,
		// rather than re-storing one blob of everything…
		expect(idb.store.has("vis-components:dataset:legacy")).toBe(true)
		expect(idb.store.has(INDEX_KEY)).toBe(true)
		// …dropped the pre-split blob…
		expect(idb.store.has(KEY)).toBe(false)
		// …and removed the localStorage copy to free quota.
		expect(localStorage.getItem(KEY)).toBeNull()
	})

	it("reads one dataset body without touching the others", async () => {
		await saveDatasetsAsync({
			d1: makeDataset("d1"),
			d2: makeDataset("d2"),
		})
		expect(await loadDatasetAsync("d1")).toEqual(makeDataset("d1"))
		expect(await loadDatasetAsync("nope")).toBeNull()
	})

	it("lists every dataset from the index, carrying no rows", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1") })
		const index = await loadDatasetIndexAsync()
		expect(Object.keys(index)).toEqual(["d1"])
		expect(
			index.d1?.versions.every((v) => !("rows" in v))
		).toBe(true)
		// The count survives the strip, so version pickers stay answerable.
		expect(index.d1?.versions[0]?.rowCount).toBe(
			makeDataset("d1").versions[0]?.rows.length
		)
	})

	it("rewrites only the bodies that actually changed", async () => {
		const d1 = makeDataset("d1")
		const d2 = makeDataset("d2")
		await saveDatasetsAsync({ d1, d2 })

		const writes: string[] = []
		const realSet = idb.store.set.bind(idb.store)
		idb.store.set = ((key: string, value: unknown) => {
			writes.push(key)
			return realSet(key, value)
		}) as typeof idb.store.set
		try {
			// d1 is the SAME object; only d2 is replaced.
			await saveDatasetsAsync({ d1, d2: makeDataset("d2", "renamed") })
		} finally {
			idb.store.set = realSet
		}
		expect(writes).not.toContain("vis-components:dataset:d1")
		expect(writes).toContain("vis-components:dataset:d2")
	})

	it("keeps datasets a partial save simply didn't mention", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		// A session that only ever loaded d1 saves only d1. d2 must survive —
		// inferring deletion from absence here would destroy every dataset the
		// user hadn't opened.
		await saveDatasetsAsync({ d1: makeDataset("d1", "renamed") })
		expect(Object.keys(await loadDatasetIndexAsync()).sort()).toEqual([
			"d1",
			"d2",
		])
		expect(await loadDatasetAsync("d2")).toEqual(makeDataset("d2"))
	})

	it("deletes bodies and index entries only when asked explicitly", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		await deleteDatasetsAsync(["d2"])
		expect(idb.store.has("vis-components:dataset:d2")).toBe(false)
		expect(Object.keys(await loadDatasetIndexAsync())).toEqual(["d1"])
	})

	it("keeps the legacy localStorage copy when the IndexedDB write fails", async () => {
		idb.setWritesSucceed(false)
		seedLegacyLocalStorage({ legacy: makeDataset("legacy") })
		const loaded = await loadDatasetsAsync()
		// Still returns the data so the session works…
		expect(Object.keys(loaded)).toEqual(["legacy"])
		// …but does NOT drop the only surviving copy.
		expect(localStorage.getItem(KEY)).not.toBeNull()
	})

	it("refuses to return a partial corpus when an indexed body is unreadable", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		// An interrupted delete / failed write can leave an index entry whose
		// body key is gone. The full-corpus read backs the bundle EXPORT —
		// returning what's left would produce a silently incomplete backup of
		// a library the UI still shows in full.
		idb.store.delete("vis-components:dataset:d2")
		await expect(loadDatasetsAsync()).rejects.toThrow(/d2/)
	})

	it("returns empty when neither store has datasets", async () => {
		expect(await loadDatasetsAsync()).toEqual({})
	})
})

describe("per-version dataset bodies", () => {
	beforeEach(() => {
		idb.store.clear()
		idb.setWritesSucceed(true)
		installInMemoryLocalStorage()
	})

	const twoVersions = (id: string): Dataset => ({
		id,
		name: id,
		fields: [{ name: "a", inferredType: "quantitative" }],
		versions: [
			{ id: "v1", filename: "a.csv", rows: [{ a: "1" }], createdAt: 0 },
			{
				id: "v2",
				filename: "b.csv",
				rows: [{ a: "2" }, { a: "3" }],
				createdAt: 1,
			},
		],
		latestVersionId: "v2",
		createdAt: 0,
	})

	it("reads one version's rows without the rest of the history", async () => {
		await saveDatasetsAsync({ d1: twoVersions("d1") })
		expect(await loadDatasetVersionAsync("d1", "v1")).toEqual([{ a: "1" }])
		expect(await loadDatasetVersionAsync("d1", "v2")).toEqual([
			{ a: "2" },
			{ a: "3" },
		])
	})

	it("deletes the stored rows of a version removed by a save", async () => {
		const two = twoVersions("d1")
		await saveDatasetsAsync({ d1: two })
		expect(idb.store.has("vis-components:dataset:d1:v:v2")).toBe(true)

		const [v1] = two.versions
		await saveDatasetsAsync({
			d1: { ...two, versions: [v1!], latestVersionId: "v1" },
		})
		// The removed version's rows must not sit in IndexedDB forever —
		// unreachable (nothing names the key) but still consuming quota.
		expect(idb.store.has("vis-components:dataset:d1:v:v2")).toBe(false)
		expect(idb.store.has("vis-components:dataset:d1:v:v1")).toBe(true)
	})

	it("splits a dataset stored before per-version bodies existed, once", async () => {
		// A pre-split store: the whole body under its own key, no version keys.
		await idb.store.set("vis-components:dataset:d1", {
			_v: 1,
			data: twoVersions("d1"),
		})
		await idb.store.set("vis-components:datasetIndex", {
			_v: 1,
			data: { d1: { ...twoVersions("d1"), versions: [] } },
		})

		expect(await loadDatasetVersionAsync("d1", "v2")).toEqual([
			{ a: "2" },
			{ a: "3" },
		])
		// Both versions now have their own key, so no later read re-reads the
		// whole body.
		expect(idb.store.has("vis-components:dataset:d1:v:v1")).toBe(true)
		expect(idb.store.has("vis-components:dataset:d1:v:v2")).toBe(true)
	})

	it("returns null for a version that does not exist", async () => {
		await saveDatasetsAsync({ d1: twoVersions("d1") })
		expect(await loadDatasetVersionAsync("d1", "nope")).toBeNull()
		expect(await loadDatasetVersionAsync("nope", "v1")).toBeNull()
	})

	it("takes the version keys with the dataset when it is deleted", async () => {
		await saveDatasetsAsync({ d1: twoVersions("d1") })
		expect(idb.store.has("vis-components:dataset:d1:v:v1")).toBe(true)

		await deleteDatasetsAsync(["d1"])
		expect(idb.store.has("vis-components:dataset:d1:v:v1")).toBe(false)
		expect(idb.store.has("vis-components:dataset:d1:v:v2")).toBe(false)
		expect(idb.store.has("vis-components:dataset:d1")).toBe(false)
	})

	it("serves fresh rows after a version's contents change", async () => {
		await saveDatasetsAsync({ d1: twoVersions("d1") })
		const edited = twoVersions("d1")
		edited.versions[0]!.rows = [{ a: "99" }]
		await saveDatasetsAsync({ d1: edited })
		expect(await loadDatasetVersionAsync("d1", "v1")).toEqual([{ a: "99" }])
	})
})
