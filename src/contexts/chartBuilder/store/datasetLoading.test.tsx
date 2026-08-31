/** The lazy dataset-loading pipeline, exercised at the store level with a
 *  controllable adapter. This suite exists because the first cut of lazy
 *  loading shipped with consumers that silently assumed the whole body was
 *  in memory — every test then passing because they all seeded whole bodies.
 *  Everything here runs the path a RELOADED session takes: index first,
 *  rows on demand. */
import { createStore } from "jotai"
import { renderHook, waitFor } from "@testing-library/react"
import { Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { datasetMetaFrom } from "../lib/datasetMeta"
import {
	localStorageAdapter,
	type StorageContentAdapter,
} from "../lib/storage/adapter"
import { setStorageAdapter } from "../lib/storage/registry"
import type { Dataset } from "../lib/types"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { stringifyJsonDangerous } from "../../../lib/json"
import { DATASETS_VERSION } from "../lib/storage/migrations"
import {
	currentDatasetIdAtom,
	datasetIndexAtom,
	datasetIndexReadyAtom,
	datasetLoadStatesAtom,
	deleteDatasetsAtom,
	ensureDatasetLoadedAtom,
	loadedDatasetsAtom,
	loadedVersionRowsAtom,
	mutateDatasetBodyAtom,
	previewVersionIdAtom,
	versionRowsKey,
} from "./atoms"
import {
	currentDatasetStatusAtom,
	currentRawDatasetViewAtom,
	useEnsureCurrentDatasetLoaded,
} from "./useCurrentDatasetView"

const dataset = (id: string, versionCount = 2): Dataset => ({
	id,
	name: `Set ${id}`,
	fields: [{ name: "a", inferredType: "quantitative" }],
	versions: Array.from({ length: versionCount }, (_, i) => ({
		id: `v${i + 1}`,
		filename: `${id}-${i + 1}.csv`,
		rows: [{ a: String(i + 1) }],
		createdAt: i,
	})),
	latestVersionId: `v${versionCount}`,
	createdAt: 0,
})

/** An adapter whose reads the test controls, with a call log. */
const stubAdapter = (
	datasets: Record<string, Dataset>
): StorageContentAdapter & { log: string[] } => {
	const log: string[] = []
	return {
		...localStorageAdapter,
		capabilities: { remoteLoad: true },
		log,
		loadDatasetIndex: async () => {
			log.push("index")
			return Object.fromEntries(
				Object.entries(datasets).map(([id, d]) => [id, datasetMetaFrom(d)])
			)
		},
		loadDatasetVersion: async (id, versionId) => {
			log.push(`version:${id}:${versionId}`)
			return (
				datasets[id]?.versions.find((v) => v.id === versionId)?.rows ?? null
			)
		},
		loadDataset: async (id) => {
			log.push(`body:${id}`)
			return datasets[id] ?? null
		},
	}
}

let restoreAdapter: (() => void) | null = null
const install = (adapter: StorageContentAdapter) => {
	setStorageAdapter(adapter)
	restoreAdapter = () => setStorageAdapter(localStorageAdapter)
}

beforeEach(() => {
	installInMemoryLocalStorage()
})

afterEach(() => {
	restoreAdapter?.()
	restoreAdapter = null
	vi.restoreAllMocks()
})

const mountEnsure = (store: ReturnType<typeof createStore>) =>
	renderHook(() => useEnsureCurrentDatasetLoaded(), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<Provider store={store}>{children}</Provider>
		),
	})

describe("cold open of a saved visualization", () => {
	it("fetches ONE version's rows — never the whole body — once the index arrives", async () => {
		const adapter = stubAdapter({ "ds-1": dataset("ds-1", 3) })
		install(adapter)
		const store = createStore()
		store.set(currentDatasetIdAtom, "ds-1")
		// Subscribe the index (as Header/EmbedPage do) so onMount fires.
		store.sub(datasetIndexAtom, () => {})

		mountEnsure(store)
		await waitFor(() =>
			expect(store.get(currentDatasetStatusAtom)).toBe("ready")
		)

		// The entire point of the design: one index read, one version read.
		expect(adapter.log).toEqual(["index", "version:ds-1:v3"])
		expect(store.get(currentRawDatasetViewAtom)?.rows).toEqual([{ a: "3" }])
	})

	it("waits for the index rather than falling back to a whole-body download", async () => {
		// An index that resolves slowly — the cold-open race. Before the
		// ready gate, the ensure effect fired first, found no index, and
		// downloaded the entire upload history on every cold open.
		const adapter = stubAdapter({ "ds-1": dataset("ds-1", 3) })
		let releaseIndex: () => void = () => {}
		const slowIndex = new Promise<void>((resolve) => {
			releaseIndex = resolve
		})
		const inner = adapter.loadDatasetIndex.bind(adapter)
		adapter.loadDatasetIndex = async () => {
			await slowIndex
			return inner()
		}
		install(adapter)
		const store = createStore()
		store.set(currentDatasetIdAtom, "ds-1")
		store.sub(datasetIndexAtom, () => {})

		mountEnsure(store)
		// Give the effect every chance to (wrongly) fire a whole-body read.
		await new Promise((r) => setTimeout(r, 20))
		expect(adapter.log.filter((c) => c.startsWith("body:"))).toEqual([])

		releaseIndex()
		await waitFor(() =>
			expect(store.get(currentDatasetStatusAtom)).toBe("ready")
		)
		expect(adapter.log.filter((c) => c.startsWith("body:"))).toEqual([])
	})

	it("pinning an older version fetches that version's rows", async () => {
		const adapter = stubAdapter({ "ds-1": dataset("ds-1", 3) })
		install(adapter)
		const store = createStore()
		store.set(currentDatasetIdAtom, "ds-1")
		store.sub(datasetIndexAtom, () => {})
		const hook = mountEnsure(store)
		await waitFor(() =>
			expect(store.get(currentDatasetStatusAtom)).toBe("ready")
		)

		store.set(previewVersionIdAtom, "v1")
		hook.rerender()
		await waitFor(() =>
			expect(
				store.get(loadedVersionRowsAtom)[versionRowsKey("ds-1", "v1")]
			).toEqual([{ a: "1" }])
		)
		expect(store.get(currentRawDatasetViewAtom)?.rows).toEqual([{ a: "1" }])
	})
})

describe("failure states", () => {
	it("a dataset the store doesn't have lands on 'missing'", async () => {
		const adapter = stubAdapter({})
		install(adapter)
		const store = createStore()
		store.set(currentDatasetIdAtom, "ds-gone")
		store.sub(datasetIndexAtom, () => {})
		mountEnsure(store)
		await waitFor(() =>
			expect(store.get(currentDatasetStatusAtom)).toBe("missing")
		)
	})

	it("a failed read lands on 'error', not a permanent spinner", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		const adapter = stubAdapter({ "ds-1": dataset("ds-1") })
		adapter.loadDatasetVersion = async () => {
			throw new Error("500")
		}
		install(adapter)
		const store = createStore()
		store.set(currentDatasetIdAtom, "ds-1")
		store.sub(datasetIndexAtom, () => {})
		mountEnsure(store)
		await waitFor(() =>
			expect(store.get(currentDatasetStatusAtom)).toBe("error")
		)
		expect(store.get(datasetLoadStatesAtom)["ds-1"]).toBe("error")
	})

	it("a later ensure clears the error and retries", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		const adapter = stubAdapter({ "ds-1": dataset("ds-1") })
		let fail = true
		const inner = adapter.loadDatasetVersion.bind(adapter)
		adapter.loadDatasetVersion = async (id, versionId) => {
			if (fail) throw new Error("500")
			return inner(id, versionId)
		}
		install(adapter)
		const store = createStore()
		store.set(currentDatasetIdAtom, "ds-1")
		store.sub(datasetIndexAtom, () => {})
		mountEnsure(store)
		await waitFor(() =>
			expect(store.get(currentDatasetStatusAtom)).toBe("error")
		)

		fail = false
		store.set(ensureDatasetLoadedAtom, "ds-1")
		await waitFor(() =>
			expect(store.get(currentDatasetStatusAtom)).toBe("ready")
		)
	})
})

describe("deletion vs the bootstrap blob", () => {
	it("a deleted bootstrap dataset stays deleted through later writes", () => {
		// Browser-local mode: the synchronous bootstrap blob is read-only, so
		// deletion tombstones its ids. Without that, the boot merge resurfaced
		// the dataset and the next functional write copied it back into the
		// base map and re-persisted it — the deletion silently undone.
		const legacyBlob = stringifyJsonDangerous({
			_v: DATASETS_VERSION,
			data: { "d-boot": dataset("d-boot") },
		} as never)
		// eslint-disable-next-line no-restricted-globals, @th/no-storage-outside-try -- seeding the legacy blob deliberately
		localStorage.setItem("vis-components:datasets", legacyBlob)
		const store = createStore()
		expect(store.get(loadedDatasetsAtom)["d-boot"]).toBeTruthy()

		store.set(deleteDatasetsAtom, ["d-boot"])
		expect(store.get(loadedDatasetsAtom)["d-boot"]).toBeUndefined()
		expect(store.get(datasetIndexAtom)["d-boot"]).toBeUndefined()

		store.set(loadedDatasetsAtom, (prev) => ({
			...prev,
			"d-new": dataset("d-new"),
		}))
		expect(Object.keys(store.get(loadedDatasetsAtom))).toEqual(["d-new"])
		expect(store.get(datasetIndexAtom)["d-boot"]).toBeUndefined()
	})
})

describe("mutating a lazily-loaded body", () => {
	it("an edit landing during the body load is not clobbered", async () => {
		const adapter = stubAdapter({ "ds-1": dataset("ds-1") })
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const inner = adapter.loadDataset.bind(adapter)
		adapter.loadDataset = async (id) => {
			await gate
			return inner(id)
		}
		install(adapter)
		const store = createStore()

		const extra = {
			id: "v3",
			filename: "c.csv",
			rows: [{ a: "9" }],
			createdAt: 2,
		}
		const mutation = store.set(mutateDatasetBodyAtom, "ds-1", (d) => ({
			...d,
			versions: [...d.versions, extra],
			latestVersionId: "v3",
		}))
		// A concurrent edit lands while the load is still in flight. The
		// mutation must apply on top of it (prev wins over the fetched body),
		// not overwrite it with the pre-edit read.
		store.set(loadedDatasetsAtom, (prev) => ({
			...prev,
			"ds-1": { ...dataset("ds-1"), name: "renamed" },
		}))
		release()
		await mutation

		const final = store.get(loadedDatasetsAtom)["ds-1"]
		expect(final?.name).toBe("renamed")
		expect(final?.versions.map((v) => v.id)).toEqual(["v1", "v2", "v3"])
	})
})

describe("cache bounds", () => {
	it("evicts the least-recently-drawn datasets' rows", async () => {
		const corpus = Object.fromEntries(
			Array.from({ length: 6 }, (_, i) => [
				`ds-${i + 1}`,
				dataset(`ds-${i + 1}`),
			])
		)
		const adapter = stubAdapter(corpus)
		install(adapter)
		const store = createStore()
		store.sub(datasetIndexAtom, () => {})
		await waitFor(() => expect(store.get(datasetIndexReadyAtom)).toBe(true))

		for (let i = 1; i <= 6; i++) {
			store.set(ensureDatasetLoadedAtom, `ds-${i}`)
			await waitFor(() =>
				expect(
					store.get(loadedVersionRowsAtom)[versionRowsKey(`ds-${i}`, "v2")]
				).toBeTruthy()
			)
		}
		// Unbounded, these caches converged back on the full-corpus memory
		// footprint over a long session. Only the most recent stay resident.
		const cachedIds = new Set(
			Object.keys(store.get(loadedVersionRowsAtom)).map((key) =>
				key.slice(0, key.lastIndexOf(":"))
			)
		)
		expect([...cachedIds].sort()).toEqual(["ds-3", "ds-4", "ds-5", "ds-6"])
	})
})

describe("store isolation", () => {
	it("an in-flight load in one store never blocks another store", async () => {
		const adapter = stubAdapter({ "ds-1": dataset("ds-1") })
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const inner = adapter.loadDatasetVersion.bind(adapter)
		adapter.loadDatasetVersion = async (id, versionId) => {
			await gate
			return inner(id, versionId)
		}
		install(adapter)

		const storeA = createStore()
		const storeB = createStore()
		for (const store of [storeA, storeB]) {
			store.set(currentDatasetIdAtom, "ds-1")
			store.sub(datasetIndexAtom, () => {})
		}
		await waitFor(() => {
			expect(storeA.get(datasetIndexReadyAtom)).toBe(true)
			expect(storeB.get(datasetIndexReadyAtom)).toBe(true)
		})
		for (const store of [storeA, storeB]) {
			store.set(ensureDatasetLoadedAtom, "ds-1")
		}
		// Both stores must have issued their own fetch — a module-global
		// in-flight guard would have swallowed store B's.
		release()
		await waitFor(() => {
			expect(
				storeA.get(loadedVersionRowsAtom)[versionRowsKey("ds-1", "v2")]
			).toBeTruthy()
			expect(
				storeB.get(loadedVersionRowsAtom)[versionRowsKey("ds-1", "v2")]
			).toBeTruthy()
		})
	})
})
