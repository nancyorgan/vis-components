/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed and inspect localStorage deliberately */
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Dataset } from "./types"

/** In-memory fake for the IndexedDB wrapper, shared with the mock via
 *  `vi.hoisted` so the (hoisted) `vi.mock` factory can reference it safely. */
const idb = vi.hoisted(() => {
	const store = new Map<string, unknown>()
	let writesSucceed = true
	let failingKeys: ReadonlySet<string> = new Set()
	let failingReadKeys: ReadonlySet<string> = new Set()
	return {
		store,
		setWritesSucceed: (v: boolean) => {
			writesSucceed = v
		},
		/** Fail writes to exactly these keys (a quota failure hits the huge
		 *  body write while the small index write still lands). */
		setFailingKeys: (keys: readonly string[]) => {
			failingKeys = new Set(keys)
		},
		/** Fail CHECKED reads of exactly these keys (`ok: false`) — the
		 *  transient-read-error case the read-modify-write guards exist for. */
		setFailingReadKeys: (keys: readonly string[]) => {
			failingReadKeys = new Set(keys)
		},
		idbAvailable: () => true,
		idbGet: async (key: string) => (store.has(key) ? store.get(key) : null),
		idbGetChecked: async (key: string) =>
			failingReadKeys.has(key)
				? { ok: false as const }
				: {
						ok: true as const,
						value: store.has(key) ? store.get(key) : null,
					},
		idbSet: async (key: string, value: unknown) => {
			if (!writesSucceed || failingKeys.has(key)) return false
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
	idbGetChecked: idb.idbGetChecked,
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
		idb.setFailingKeys([])
		idb.setFailingReadKeys([])
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

	it("does not index a dataset whose body write failed", async () => {
		// A quota failure hits the huge body write; the tiny index write still
		// lands. Indexing the ghost would show a dataset nothing can read AND
		// make the all-or-nothing corpus read (bundle export) refuse forever.
		idb.setFailingKeys(["vis-components:dataset:d2"])
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		expect(Object.keys(await loadDatasetIndexAsync())).toEqual(["d1"])
		expect(await loadDatasetsAsync()).toEqual({ d1: makeDataset("d1") })
	})

	it("a save racing a delete cannot resurrect the deleted dataset", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		// Fired the way the atoms fire them — unawaited, in one tick. Without
		// the shared write queue, the save's index read predated the delete and
		// its merge wrote d2's entry back after d2's body keys were gone.
		const save = saveDatasetsAsync({ d1: makeDataset("d1", "renamed") })
		const del = deleteDatasetsAsync(["d2"])
		await Promise.all([save, del])
		expect(Object.keys(await loadDatasetIndexAsync())).toEqual(["d1"])
		expect(idb.store.has("vis-components:dataset:d2")).toBe(false)
	})

	it("deleting on a not-yet-split store splits first, then deletes", async () => {
		seedLegacyLocalStorage({ a: makeDataset("a"), b: makeDataset("b") })
		// Per-key deletes can't reach bodies still inside the legacy blob;
		// writing an empty index over them hid every dataset and resurrected
		// the "deleted" ones on the next split.
		await deleteDatasetsAsync(["a"])
		expect(Object.keys(await loadDatasetIndexAsync())).toEqual(["b"])
		expect(await loadDatasetAsync("a")).toBeNull()
		expect(await loadDatasetAsync("b")).toEqual(makeDataset("b"))
	})

	it("a save racing the one-time legacy split loses neither side", async () => {
		seedLegacyLocalStorage({ legacy: makeDataset("legacy") })
		// The index read triggers the split; the save lands in the same tick.
		const read = loadDatasetIndexAsync()
		const save = saveDatasetsAsync({ fresh: makeDataset("fresh") })
		await Promise.all([read, save])
		expect(Object.keys(await loadDatasetIndexAsync()).sort()).toEqual([
			"fresh",
			"legacy",
		])
	})

	it("keeps a stale-tagged index instead of persisting a shrunken rebuild", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		// Simulate a post-bump boot where one body read fails transiently: the
		// index carries an old tag and d2's body answers null. Persisting the
		// rebuild without d2 would drop it from the library permanently.
		const stored = idb.store.get(INDEX_KEY) as { _v: number; data: unknown }
		idb.store.set(INDEX_KEY, { _v: stored._v - 1, data: stored.data })
		const d2Body = idb.store.get("vis-components:dataset:d2")
		idb.store.delete("vis-components:dataset:d2")

		expect(Object.keys(await loadDatasetIndexAsync())).toEqual(["d1"])
		// The read served what it could, but the stored index kept its stale
		// tag — so once the body reads again, the rebuild retries and heals.
		idb.store.set("vis-components:dataset:d2", d2Body)
		expect(Object.keys(await loadDatasetIndexAsync()).sort()).toEqual([
			"d1",
			"d2",
		])
	})

	it("a save that cannot read the index skips the index write instead of emptying it", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1") })
		idb.setFailingReadKeys([INDEX_KEY])

		// The save must not treat the failed read as "no index yet" and write
		// one containing only d2 — that is exactly how a transient read error
		// once wiped a populated index.
		await saveDatasetsAsync({ d2: makeDataset("d2") })
		expect(await loadDatasetAsync("d2")).not.toBeNull()
		const stored = idb.store.get(INDEX_KEY) as {
			data: Record<string, unknown>
		}
		expect(Object.keys(stored.data)).toEqual(["d1"])

		// Once reads work again, the next save indexes the body it wrote.
		idb.setFailingReadKeys([])
		await saveDatasetsAsync({ d2: makeDataset("d2") })
		expect(Object.keys(await loadDatasetIndexAsync()).sort()).toEqual([
			"d1",
			"d2",
		])
	})

	it("a delete that cannot read the index deletes nothing", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		idb.setFailingReadKeys([INDEX_KEY])

		// Deleting rewrites the index as "everything but the doomed ids"; with
		// the index unreadable that rewrite would erase every other entry too.
		await deleteDatasetsAsync(["d1"])
		expect(await loadDatasetAsync("d1")).not.toBeNull()

		idb.setFailingReadKeys([])
		expect(Object.keys(await loadDatasetIndexAsync()).sort()).toEqual([
			"d1",
			"d2",
		])
	})

	it("a save never uses a partial index rebuild as its merge baseline", async () => {
		await saveDatasetsAsync({ d1: makeDataset("d1"), d2: makeDataset("d2") })
		// Stale tag + one unreadable body = a rebuild that only knows d1.
		const stored = idb.store.get(INDEX_KEY) as { _v: number; data: unknown }
		idb.store.set(INDEX_KEY, { _v: stored._v - 1, data: stored.data })
		const d2Body = idb.store.get("vis-components:dataset:d2")
		idb.store.delete("vis-components:dataset:d2")

		// Merging d3 into the partial rebuild would persist an index without
		// d2 under a CURRENT tag — the rebuild's retry-on-stale-tag defeated.
		await saveDatasetsAsync({ d3: makeDataset("d3") })
		expect(await loadDatasetAsync("d3")).not.toBeNull()
		const after = idb.store.get(INDEX_KEY) as { _v: number }
		expect(after._v).toBe(stored._v - 1)

		// Body back → the rebuild heals with nothing lost.
		idb.store.set("vis-components:dataset:d2", d2Body)
		expect(Object.keys(await loadDatasetIndexAsync()).sort()).toEqual([
			"d1",
			"d2",
		])
	})
})

describe("per-version dataset bodies", () => {
	beforeEach(() => {
		idb.store.clear()
		idb.setWritesSucceed(true)
		idb.setFailingReadKeys([])
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

	it("repairs an index entry that names a version the body doesn't hold", async () => {
		await saveDatasetsAsync({ d1: twoVersions("d1") })
		// Drift the index entry: a ghost version id as latest, the kind a
		// stale write left behind. Resolvers pick the version to fetch from
		// this metadata, so without repair the dataset reads as deleted
		// forever even though the body is fine.
		const stored = idb.store.get(INDEX_KEY) as {
			_v: number
			data: Record<string, { versions: unknown; latestVersionId: string }>
		}
		stored.data.d1 = {
			...stored.data.d1,
			versions: [
				{ id: "ghost", filename: "g.csv", rowCount: 1, createdAt: 0 },
			],
			latestVersionId: "ghost",
		} as (typeof stored.data)["d1"]
		idb.store.set(INDEX_KEY, stored)

		// The ghost version itself is honestly unservable…
		expect(await loadDatasetVersionAsync("d1", "ghost")).toBeNull()
		// …but the entry has been rewritten from the body, so the next
		// resolve names real versions.
		const healed = (await loadDatasetIndexAsync()).d1
		expect(healed?.latestVersionId).toBe("v2")
		expect(healed?.versions.map((v) => v.id)).toEqual(["v1", "v2"])
		expect(await loadDatasetVersionAsync("d1", "v2")).toEqual([
			{ a: "2" },
			{ a: "3" },
		])
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
