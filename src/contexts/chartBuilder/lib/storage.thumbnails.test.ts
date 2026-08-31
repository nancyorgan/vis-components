/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed and inspect localStorage deliberately */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { DEFAULT_LABELS_CONFIG } from "./labelsConfig"
import type { Visual } from "./types"
import { emptyEncodings } from "./types"

/** In-memory fake for the IndexedDB wrapper, shared with the mock via
 *  `vi.hoisted` so the (hoisted) `vi.mock` factory can reference it safely. */
const idb = vi.hoisted(() => {
	const store = new Map<string, unknown>()
	return {
		store,
		idbAvailable: () => true,
		idbGet: async (key: string) => (store.has(key) ? store.get(key) : null),
		idbGetChecked: async (key: string) => ({
			ok: true as const,
			value: store.has(key) ? store.get(key) : null,
		}),
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
	idbGetChecked: idb.idbGetChecked,
	idbSet: idb.idbSet,
	idbDelete: idb.idbDelete,
}))

import * as storage from "./storage"
import {
	loadThumbnailsAsync,
	mergeThumbnails,
	restoreDraftState,
	saveVisuals,
	snapshotDraftState,
} from "./storage"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"

const KEY_VISUALS = "vis-components:visuals"
const KEY_THUMBNAILS = "vis-components:thumbnails"

const mkVisual = (overrides: Partial<Visual> = {}): Visual => ({
	id: "vis-1",
	name: "Kinds of Cats",
	folderId: null,
	datasetId: "ds-cats",
	createdAtVersionId: "dv-1",
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 2,
	...overrides,
})

const thumb = (id: string) => `data:image/png;base64,${id}`

/** The thumbnail write is queued behind a promise chain; flush microtasks so
 *  assertions see the settled IndexedDB state. */
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0))

const storedVisuals = (): Visual[] => {
	const raw = localStorage.getItem(KEY_VISUALS)
	expect(raw).not.toBeNull()
	return (JSON.parse(raw!) as { data: Visual[] }).data
}

describe("thumbnail IndexedDB persistence", () => {
	beforeEach(() => {
		idb.store.clear()
		installInMemoryLocalStorage()
	})

	it("writes the localStorage visuals payload thumbnail-free", async () => {
		saveVisuals([
			mkVisual({ id: "a", thumbnail: thumb("a") }),
			mkVisual({ id: "b" }),
		])
		await flushAsync()
		expect(storedVisuals().map((v) => v.thumbnail)).toEqual([null, null])
	})

	it("persists thumbnails to the IndexedDB side-table", async () => {
		saveVisuals([
			mkVisual({ id: "a", thumbnail: thumb("a") }),
			mkVisual({ id: "b" }),
		])
		await flushAsync()
		expect(await loadThumbnailsAsync()).toEqual({ a: thumb("a") })
	})

	it("keeps stored thumbnails when the in-memory list has nulls (pre-merge save)", async () => {
		// Simulates autosave firing before the async IndexedDB merge lands:
		// the visual exists in memory but its thumbnail is still null.
		idb.store.set(KEY_THUMBNAILS, { a: thumb("a") })
		saveVisuals([mkVisual({ id: "a" }), mkVisual({ id: "b" })])
		await flushAsync()
		expect(await loadThumbnailsAsync()).toEqual({ a: thumb("a") })
	})

	it("prefers the in-memory thumbnail over the stored one", async () => {
		idb.store.set(KEY_THUMBNAILS, { a: thumb("stale") })
		saveVisuals([mkVisual({ id: "a", thumbnail: thumb("fresh") })])
		await flushAsync()
		expect(await loadThumbnailsAsync()).toEqual({ a: thumb("fresh") })
	})

	it("drops thumbnails of deleted visuals", async () => {
		idb.store.set(KEY_THUMBNAILS, { a: thumb("a"), gone: thumb("gone") })
		saveVisuals([mkVisual({ id: "a", thumbnail: thumb("a") })])
		await flushAsync()
		expect(await loadThumbnailsAsync()).toEqual({ a: thumb("a") })
	})

	it("serializes queued writes so the last save wins intact", async () => {
		saveVisuals([mkVisual({ id: "a", thumbnail: thumb("v1") })])
		saveVisuals([
			mkVisual({ id: "a", thumbnail: thumb("v2") }),
			mkVisual({ id: "b", thumbnail: thumb("b") }),
		])
		await flushAsync()
		expect(await loadThumbnailsAsync()).toEqual({
			a: thumb("v2"),
			b: thumb("b"),
		})
	})
})

describe("mergeThumbnails", () => {
	it("fills only thumbnail-less visuals and keeps others reference-equal", () => {
		const withThumb = mkVisual({ id: "a", thumbnail: thumb("mem") })
		const withoutThumb = mkVisual({ id: "b" })
		const noStored = mkVisual({ id: "c" })
		const merged = mergeThumbnails([withThumb, withoutThumb, noStored], {
			a: thumb("stored"),
			b: thumb("b"),
		})
		expect(merged[0]).toBe(withThumb)
		expect(merged[1].thumbnail).toBe(thumb("b"))
		expect(merged[2]).toBe(noStored)
	})
})

describe("draft-state snapshot", () => {
	beforeEach(() => {
		installInMemoryLocalStorage()
	})

	it("restores overwritten and added draft keys, leaving others alone", () => {
		localStorage.setItem("vis-components:currentVisualName", '"My draft"')
		localStorage.setItem("vis-components:visuals", '{"_v":3,"data":[]}')
		const snapshot = snapshotDraftState()

		// What an embed-iframe boot would do: overwrite one draft key, add another.
		localStorage.setItem("vis-components:currentVisualName", '"Embedded"')
		localStorage.setItem("vis-components:currentDatasetId", '"ds-x"')

		restoreDraftState(snapshot)
		expect(localStorage.getItem("vis-components:currentVisualName")).toBe(
			'"My draft"'
		)
		expect(localStorage.getItem("vis-components:currentDatasetId")).toBeNull()
		// Non-draft keys are untouched.
		expect(localStorage.getItem("vis-components:visuals")).toBe(
			'{"_v":3,"data":[]}'
		)
	})

	it("keeps an unsaved wide\u2192long reshape draft", () => {
		localStorage.setItem(
			"vis-components:currentReshapeConfig",
			'{"_v":1,"data":{"applied":true}}'
		)
		const snapshot = snapshotDraftState()

		// The backfill iframe loads a visual with no reshape of its own, which
		// clears the key rather than overwriting it.
		localStorage.removeItem("vis-components:currentReshapeConfig")

		restoreDraftState(snapshot)
		expect(localStorage.getItem("vis-components:currentReshapeConfig")).toBe(
			'{"_v":1,"data":{"applied":true}}'
		)
	})

	/** Drift guard: a new `current*` draft key added to storage.ts without a
	 *  matching DRAFT_STATE_KEYS entry silently loses that draft on every
	 *  thumbnail backfill \u2014 which is exactly how the reshape key was missed.
	 *  Every draft writer is a thin pass-through, so any value makes it write. */
	it("snapshots every draft key the module can write", () => {
		const store = installInMemoryLocalStorage()
		for (const [name, exported] of Object.entries(storage)) {
			if (!/^save(Current|PreviewVersionId)/.test(name)) continue
			;(exported as (value: unknown) => void)("x")
		}
		const covered = new Set(Object.keys(snapshotDraftState()))
		expect([...store.keys()].filter((k) => !covered.has(k))).toEqual([])
	})
})
