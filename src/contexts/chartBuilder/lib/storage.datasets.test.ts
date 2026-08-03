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

import { loadDatasetsAsync, saveDatasetsAsync } from "./storage"

const KEY = "vis-components:datasets"

/** happy-dom's localStorage is incomplete here (no `clear`), so install a
 *  minimal in-memory Storage — same approach the viz smoke tests use. */
const installInMemoryLocalStorage = (): Map<string, string> => {
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
	return store
}

const makeDataset = (id: string): Dataset => ({
	id,
	name: id,
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
		// …copied it into IndexedDB…
		expect(idb.store.has(KEY)).toBe(true)
		// …and removed the localStorage copy to free quota.
		expect(localStorage.getItem(KEY)).toBeNull()
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

	it("returns empty when neither store has datasets", async () => {
		expect(await loadDatasetsAsync()).toEqual({})
	})
})
