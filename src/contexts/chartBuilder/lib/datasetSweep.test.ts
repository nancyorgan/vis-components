import { beforeEach, describe, expect, it, vi } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { DEFAULT_LABELS_CONFIG } from "./labelsConfig"
import { emptyEncodings, type Dataset, type Visual } from "./types"

/** In-memory fake for the IndexedDB wrapper (same pattern as
 *  exampleSeed.test.ts), shared with the mock via `vi.hoisted`. */
const idb = vi.hoisted(() => {
	const store = new Map<string, unknown>()
	return {
		store,
		idbAvailable: () => true,
		idbGet: async (key: string) => (store.has(key) ? store.get(key) : null),
		idbSet: async (key: string, value: unknown) => {
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

import { runDatasetStoreCleanup, sweepOrphanDatasets } from "./datasetSweep"
import {
	loadCurrentDatasetId,
	loadDatasetsAsync,
	loadVisuals,
	saveCurrentDatasetId,
	saveDatasetsAsync,
	saveVisuals,
} from "./storage"

const installInMemoryLocalStorage = (): void => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? store.get(k)! : null),
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	Object.defineProperty(window, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
}

const makeVisual = (id: string, datasetId: string | null): Visual => ({
	id,
	name: `Visual ${id}`,
	folderId: null,
	datasetId,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 0,
	updatedAt: 0,
})

const makeDataset = (
	id: string,
	{ name = id, createdAt = 0 }: { name?: string; createdAt?: number } = {}
): Dataset => ({
	id,
	name,
	fields: [{ name: "a", inferredType: "quantitative" }],
	versions: [
		{ id: `${id}-v1`, filename: `${name}.csv`, rows: [{ a: "1" }], createdAt },
	],
	latestVersionId: `${id}-v1`,
	createdAt,
})

describe("sweepOrphanDatasets", () => {
	it("removes datasets no visual references, keeps referenced ones", () => {
		const out = sweepOrphanDatasets({
			datasets: {
				"ds-used": makeDataset("ds-used"),
				"ds-orphan": makeDataset("ds-orphan"),
			},
			visuals: [makeVisual("v1", "ds-used")],
		})
		expect(Object.keys(out.datasets)).toEqual(["ds-used"])
		expect(out.removedIds).toEqual(["ds-orphan"])
	})

	it("keeps protected ids even when unreferenced (nulls ignored)", () => {
		const out = sweepOrphanDatasets({
			datasets: { "ds-wip": makeDataset("ds-wip") },
			visuals: [],
			protectedIds: ["ds-wip", null],
		})
		expect(Object.keys(out.datasets)).toEqual(["ds-wip"])
		expect(out.removedIds).toEqual([])
	})

	it("returns the same record reference when nothing is removed", () => {
		const datasets = { "ds-used": makeDataset("ds-used") }
		const out = sweepOrphanDatasets({
			datasets,
			visuals: [makeVisual("v1", "ds-used")],
		})
		expect(out.datasets).toBe(datasets)
	})
})

describe("runDatasetStoreCleanup", () => {
	beforeEach(() => {
		installInMemoryLocalStorage()
		idb.store.clear()
	})

	it("removes orphans, keeps referenced + current, and stamps the marker", async () => {
		await saveVisuals([makeVisual("v1", "ds-used")])
		saveCurrentDatasetId("ds-wip")
		await saveDatasetsAsync({
			"ds-used": makeDataset("ds-used"),
			"ds-wip": makeDataset("ds-wip"),
			"ds-orphan": makeDataset("ds-orphan"),
		})

		await runDatasetStoreCleanup()

		expect(Object.keys(await loadDatasetsAsync()).sort()).toEqual([
			"ds-used",
			"ds-wip",
		])

		// Marker set: a later orphan survives because the one-shot is done.
		await saveDatasetsAsync({
			...(await loadDatasetsAsync()),
			"ds-later": makeDataset("ds-later"),
		})
		await runDatasetStoreCleanup()
		expect(Object.keys(await loadDatasetsAsync())).toContain("ds-later")
	})

	it("collapses byte-identical duplicates, repointing visuals and the current-dataset pin", async () => {
		await saveVisuals([
			makeVisual("v1", "ds-early"),
			makeVisual("v2", "ds-late"),
		])
		saveCurrentDatasetId("ds-late")
		await saveDatasetsAsync({
			"ds-early": makeDataset("ds-early", { name: "shared" }),
			"ds-late": makeDataset("ds-late", { name: "shared", createdAt: 5 }),
		})

		await runDatasetStoreCleanup()

		expect(Object.keys(await loadDatasetsAsync())).toEqual(["ds-early"])
		expect(loadVisuals().map((v) => v.datasetId)).toEqual([
			"ds-early",
			"ds-early",
		])
		expect(loadCurrentDatasetId()).toBe("ds-early")
	})
})
