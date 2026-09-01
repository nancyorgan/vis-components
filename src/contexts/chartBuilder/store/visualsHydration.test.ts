/** Server mode fills the visuals list asynchronously. Anything that treats
 *  "id not in the list" as "no such visual" (the /editor/$visualId deep link,
 *  embeds) must gate on `visualsHydratedAtom`, or a cold load decides
 *  "not found" off the pre-hydration empty list and bounces to the library —
 *  which is exactly how shared visual links broke in production. */
import { createStore } from "jotai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../lib/labelsConfig"
import {
	localStorageAdapter,
	type StorageContentAdapter,
} from "../lib/storage/adapter"
import { setStorageAdapter } from "../lib/storage/registry"
import { emptyEncodings, type Visual } from "../lib/types"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { visualsAtom, visualsHydratedAtom } from "./atoms"

const mkVisual = (id: string): Visual => ({
	id,
	name: `Visual ${id}`,
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
})

/** A remote adapter whose visuals fetch the test resolves/rejects by hand. */
const deferredRemoteAdapter = () => {
	let resolve!: (visuals: Visual[]) => void
	let reject!: (error: unknown) => void
	const pending = new Promise<Visual[]>((res, rej) => {
		resolve = res
		reject = rej
	})
	const adapter: StorageContentAdapter = {
		...localStorageAdapter,
		capabilities: { remoteLoad: true },
		loadVisuals: () => pending,
	}
	return { adapter, resolve, reject }
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

describe("visualsHydratedAtom", () => {
	it("server mode: false until the fetch lands, then true with the visuals visible", async () => {
		const { adapter, resolve } = deferredRemoteAdapter()
		install(adapter)
		const store = createStore()
		// Subscribe (as VisualLoaderForExisting does) so onMount starts the fetch.
		store.sub(visualsHydratedAtom, () => {})

		// Pre-hydration: the list is empty and must NOT be read as authoritative.
		expect(store.get(visualsHydratedAtom)).toBe(false)
		expect(store.get(visualsAtom)).toEqual([])

		resolve([mkVisual("vs-shared")])
		await vi.waitFor(() => {
			expect(store.get(visualsHydratedAtom)).toBe(true)
		})
		expect(store.get(visualsAtom).map((v) => v.id)).toEqual(["vs-shared"])
	})

	it("server mode: a failed fetch still settles hydration on the bootstrap", async () => {
		const { adapter, reject } = deferredRemoteAdapter()
		install(adapter)
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const store = createStore()
		store.sub(visualsHydratedAtom, () => {})
		expect(store.get(visualsHydratedAtom)).toBe(false)

		reject(new Error("network down"))
		await vi.waitFor(() => {
			expect(store.get(visualsHydratedAtom)).toBe(true)
		})
		expect(errorSpy).toHaveBeenCalled()
	})

	it("local mode: hydrated immediately (the sync bootstrap is the store)", () => {
		install(localStorageAdapter)
		const store = createStore()
		store.sub(visualsHydratedAtom, () => {})
		expect(store.get(visualsHydratedAtom)).toBe(true)
	})
})
