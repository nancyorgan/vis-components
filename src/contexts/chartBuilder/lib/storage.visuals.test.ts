/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed and inspect localStorage deliberately */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { VISUALS_VERSION } from "./storage/migrations"
import {
	loadCurrentVisualId,
	loadVisuals,
	saveCurrentVisualId,
} from "./storage"

/** The visuals collection and the current-visual pointer are the two entities
 *  that carry a RENAMED legacy key (`projects` / `currentProjectId`, from
 *  before the entity was called a Visual). Those one-shot fallbacks are the
 *  only part of the load path with no test coverage — storage.thumbnails and
 *  storage.datasets cover the side-tables, and exampleOverlay / datasetSweep
 *  exercise the happy path. A user upgrading from a pre-rename build only ever
 *  hits this code once, so a regression here is silent and permanent: their
 *  whole library reads as empty. */

const KEY_VISUALS = "vis-components:visuals"
const KEY_CURRENT_VISUAL = "vis-components:currentVisualId"
const LEGACY_KEY_PROJECTS = "vis-components:projects"
const LEGACY_KEY_CURRENT_PROJECT = "vis-components:currentProjectId"

const write = (key: string, value: unknown) =>
	/* eslint-disable-next-line @th/use-wrapped-json-functions */
	localStorage.setItem(key, JSON.stringify(value))

const stored = (key: string): { _v: number; data: unknown } | null => {
	const raw = localStorage.getItem(key)
	return raw === null ? null : (JSON.parse(raw) as { _v: number; data: unknown })
}

/** A pre-rename (v0) visual: no `createdAtVersionId`, the bogus "neutral"
 *  sat/bri values the old reset wrote, and a mapConfig with the OLD
 *  `showNoDataRegions` default. Each of those is healed by a DIFFERENT
 *  migration step, which is what makes this fixture able to prove the whole
 *  chain ran rather than just its first entry. */
const legacyVisual = (id: string): Record<string, unknown> => ({
	id,
	name: `Legacy ${id}`,
	folderId: null,
	datasetId: "ds-legacy",
	fieldTypeOverrides: {},
	encodings: {},
	channelConfigs: { defaultSaturation: 1, defaultBrightness: 0.5 },
	labelsConfig: {},
	mapConfig: { showNoDataRegions: false },
	thumbnail: null,
	createdAt: 1,
	updatedAt: 2,
})

type LoadedVisual = {
	id: string
	createdAtVersionId: string | null
	channelConfigs: { defaultSaturation: unknown; defaultBrightness: unknown }
	mapConfig: { showNoDataRegions: boolean }
}

const loaded = (): LoadedVisual[] => loadVisuals() as unknown as LoadedVisual[]

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
	installInMemoryLocalStorage()
	// The failure paths under test log deliberately; keep the run readable.
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
	warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
	errorSpy.mockRestore()
	warnSpy.mockRestore()
})

describe("loadVisuals — legacy `projects` key adoption", () => {
	it("runs the FULL migration chain on the legacy payload, not just the first step", () => {
		write(LEGACY_KEY_PROJECTS, [legacyVisual("v1")])
		const [v] = loaded()
		// v0 → v1: missing pointer backfilled, fake-neutral sat/bri scrubbed.
		expect(v!.createdAtVersionId).toBeNull()
		expect(v!.channelConfigs.defaultSaturation).toBeNull()
		expect(v!.channelConfigs.defaultBrightness).toBeNull()
		// v3 → v4: the LAST step in the chain. Stopping after the v0 → v1
		// migration (the bug the "run the full chain" comment guards against)
		// would leave this `false`.
		expect(v!.mapConfig.showNoDataRegions).toBe(true)
	})

	it("rewrites the migrated payload under the new key, stamped at the current version", () => {
		write(LEGACY_KEY_PROJECTS, [legacyVisual("v1")])
		loadVisuals()
		const blob = stored(KEY_VISUALS)
		expect(blob).not.toBeNull()
		expect(blob!._v).toBe(VISUALS_VERSION)
		expect((blob!.data as Array<{ id: string }>).map((v) => v.id)).toEqual(["v1"])
	})

	it("leaves the legacy key in place and stops consulting it once adopted", () => {
		write(LEGACY_KEY_PROJECTS, [legacyVisual("v1")])
		loadVisuals()
		// The legacy blob is not deleted — a downgrade shouldn't strand the user.
		expect(localStorage.getItem(LEGACY_KEY_PROJECTS)).not.toBeNull()

		// After adoption the new key is authoritative: edits to the legacy blob
		// are invisible, and the second read goes through the versioned path (no
		// re-migration, so an already-`false` user choice would now survive).
		write(LEGACY_KEY_PROJECTS, [legacyVisual("v2")])
		expect(loaded().map((v) => v.id)).toEqual(["v1"])
	})

	it("prefers the new key even when it holds an EMPTY library", () => {
		// The check is `raw !== null`, not "non-empty" — a user who deleted every
		// visual must not have the pre-rename library resurrected.
		write(KEY_VISUALS, { _v: VISUALS_VERSION, data: [] })
		write(LEGACY_KEY_PROJECTS, [legacyVisual("v1")])
		expect(loadVisuals()).toEqual([])
	})

	it("returns an empty library when neither key exists", () => {
		expect(loadVisuals()).toEqual([])
		// …and doesn't write a blob on the way out, so the legacy fallback is
		// still live on the next boot.
		expect(localStorage.getItem(KEY_VISUALS)).toBeNull()
	})

	it("falls back to an empty library when the legacy blob is unparseable", () => {
		localStorage.setItem(LEGACY_KEY_PROJECTS, "{not json")
		expect(loadVisuals()).toEqual([])
		expect(errorSpy).toHaveBeenCalled()
		// No half-written blob under the new key — the next boot retries.
		expect(localStorage.getItem(KEY_VISUALS)).toBeNull()
	})

	it("coerces a legacy blob of the wrong SHAPE into an empty library", () => {
		// Pre-rename data was hand-editable; the v0 → v1 migration guards with
		// `Array.isArray`, so a stray object must degrade rather than throw.
		write(LEGACY_KEY_PROJECTS, { v1: legacyVisual("v1") })
		expect(loadVisuals()).toEqual([])
	})
})

describe("loadVisuals — versioned reads under the current key", () => {
	it("resumes the chain mid-way and rewrites the upgraded shape", () => {
		// Stored at v3: only the v3 → v4 step should run.
		write(KEY_VISUALS, { _v: 3, data: [legacyVisual("v1")] })
		const [v] = loaded()
		expect(v!.mapConfig.showNoDataRegions).toBe(true)
		// The earlier steps did NOT re-run, so the fake-neutral sat/bri that
		// v0 → v1 scrubs is left exactly as stored.
		expect(v!.channelConfigs.defaultSaturation).toBe(1)
		// The write-back stamps the current version so the next read is O(1).
		expect(stored(KEY_VISUALS)!._v).toBe(VISUALS_VERSION)
	})

	it("falls back rather than guessing at a payload from a NEWER build", () => {
		// A user who opened the app in a newer tab, then an older one. Handing
		// an unknown shape to the renderer is worse than showing nothing.
		write(KEY_VISUALS, { _v: VISUALS_VERSION + 1, data: [legacyVisual("v1")] })
		expect(loadVisuals()).toEqual([])
		// The future payload is left untouched, so the newer build still sees it.
		expect(stored(KEY_VISUALS)!._v).toBe(VISUALS_VERSION + 1)
	})
})

describe("loadCurrentVisualId — legacy `currentProjectId` adoption", () => {
	it("adopts the legacy pointer and rewrites it under the new key", () => {
		write(LEGACY_KEY_CURRENT_PROJECT, "vs-legacy")
		expect(loadCurrentVisualId()).toBe("vs-legacy")
		expect(localStorage.getItem(KEY_CURRENT_VISUAL)).toBe('"vs-legacy"')
	})

	it("respects an explicit null under the new key instead of resurrecting the legacy one", () => {
		// "I closed my visual" is a real state, stored as literal `null`. The
		// read keys off the RAW string being present, so the legacy pointer must
		// not leak back in and reopen last year's chart.
		write(KEY_CURRENT_VISUAL, null)
		write(LEGACY_KEY_CURRENT_PROJECT, "vs-legacy")
		expect(loadCurrentVisualId()).toBeNull()
	})

	it("prefers the new key when both hold an id", () => {
		write(KEY_CURRENT_VISUAL, "vs-new")
		write(LEGACY_KEY_CURRENT_PROJECT, "vs-legacy")
		expect(loadCurrentVisualId()).toBe("vs-new")
	})

	it("returns null (rather than throwing) on a corrupt pointer", () => {
		localStorage.setItem(KEY_CURRENT_VISUAL, "{not json")
		expect(loadCurrentVisualId()).toBeNull()
	})

	it("does not write anything when neither key exists", () => {
		expect(loadCurrentVisualId()).toBeNull()
		expect(localStorage.getItem(KEY_CURRENT_VISUAL)).toBeNull()
	})

	it("round-trips through saveCurrentVisualId, including clearing to null", () => {
		saveCurrentVisualId("vs-1")
		expect(loadCurrentVisualId()).toBe("vs-1")
		saveCurrentVisualId(null)
		expect(loadCurrentVisualId()).toBeNull()
		// Cleared means "stored as null", not "key removed" — that's what keeps
		// the legacy fallback from firing again on the next boot.
		expect(localStorage.getItem(KEY_CURRENT_VISUAL)).toBe("null")
	})
})
