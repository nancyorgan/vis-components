import { beforeEach, describe, expect, it, vi } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { DEFAULT_LABELS_CONFIG } from "./labelsConfig"
import { emptyEncodings, type Dataset, type Visual } from "./types"

/** In-memory fake for the IndexedDB wrapper, shared with the mock via
 *  `vi.hoisted` so the (hoisted) `vi.mock` factory can reference it safely. */
const idb = vi.hoisted(() => {
	const store = new Map<string, unknown>()
	let available = true
	return {
		store,
		setAvailable: (v: boolean) => {
			available = v
		},
		idbAvailable: () => available,
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

import { clearExampleOverlay } from "./exampleOverlay"
import {
	applyExampleSeed,
	buildSeedBundle,
	installEphemeralExamples,
	type SeedBundle,
} from "./exampleSeed"
import {
	loadDatasets,
	loadDatasetsAsync,
	loadExampleSeedApplied,
	loadFolders,
	loadThemes,
	loadThumbnailsAsync,
	loadVisuals,
	saveDatasetsAsync,
	saveThemes,
	saveVisuals,
} from "./storage"
import { localStorageAdapter, type StorageContentAdapter } from "./storage/adapter"
import { setStorageAdapter } from "./storage/registry"
import { SYSTEM_THEMES } from "./systemThemes"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
const makeVisual = (
	id: string,
	thumbnail: string | null = null,
	datasetId = "ds-1"
): Visual => ({
	id,
	name: `Visual ${id}`,
	folderId: null,
	datasetId,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail,
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

const makeSeed = (overrides: Partial<SeedBundle> = {}): SeedBundle => ({
	exportedAt: "2026-07-27T00:00:00.000Z",
	visuals: [makeVisual("seed-1", "data:image/png;base64,AAA")],
	folders: [{ id: "f1", name: "Examples", parentId: null, createdAt: 0 }],
	datasets: { "ds-1": makeDataset("ds-1") },
	themes: [],
	userDefaultThemeId: null,
	...overrides,
})

describe("buildSeedBundle", () => {
	beforeEach(() => {
		installInMemoryLocalStorage()
		idb.store.clear()
		idb.setAvailable(true)
		clearExampleOverlay()
		setStorageAdapter(localStorageAdapter)
	})

	it("exports only datasets referenced by a visual (orphans excluded)", async () => {
		await saveVisuals([makeVisual("vis-1", null, "ds-used")])
		await saveDatasetsAsync({
			"ds-used": makeDataset("ds-used"),
			"ds-orphan": makeDataset("ds-orphan"),
		})

		const bundle = await buildSeedBundle()
		expect(Object.keys(bundle.datasets)).toEqual(["ds-used"])
		expect(bundle.visuals.map((v) => v.id)).toEqual(["vis-1"])
	})

	it("collapses byte-identical duplicates and repoints visuals to the canonical copy", async () => {
		await saveVisuals([
			makeVisual("vis-a", null, "ds-early"),
			makeVisual("vis-b", null, "ds-late"),
		])
		await saveDatasetsAsync({
			"ds-early": makeDataset("ds-early", { name: "shared" }),
			"ds-late": makeDataset("ds-late", { name: "shared", createdAt: 5 }),
		})

		const bundle = await buildSeedBundle()
		expect(Object.keys(bundle.datasets)).toEqual(["ds-early"])
		expect(bundle.visuals.map((v) => v.datasetId)).toEqual([
			"ds-early",
			"ds-early",
		])
	})

	it("excludes the ephemeral example overlay — a backup is the user's work only", async () => {
		await saveVisuals([makeVisual("mine", null, "ds-mine")])
		await saveDatasetsAsync({ "ds-mine": makeDataset("ds-mine") })
		await installEphemeralExamples(
			makeSeed({
				folders: [
					{ id: "seed-folder", name: "Examples", parentId: null, createdAt: 0 },
				],
			})
		)
		// Overlaid reads see both…
		expect(loadVisuals().map((v) => v.id)).toEqual(["mine", "seed-1"])

		// …the export only the user's own rows.
		const bundle = await buildSeedBundle()
		expect(bundle.visuals.map((v) => v.id)).toEqual(["mine"])
		expect(Object.keys(bundle.datasets)).toEqual(["ds-mine"])
		expect(bundle.folders).toEqual([])
	})

	it("still exports overlay rows the user has adopted (old persist-once library)", async () => {
		// Seed persisted under the older behaviour, then the sandbox installs
		// over it: the rows are adopted — the user's — and export normally.
		await applyExampleSeed(makeSeed())
		clearExampleOverlay()
		await installEphemeralExamples(makeSeed())

		const bundle = await buildSeedBundle()
		expect(bundle.visuals.map((v) => v.id)).toEqual(["seed-1"])
		expect(Object.keys(bundle.datasets)).toEqual(["ds-1"])
	})
})

describe("applyExampleSeed", () => {
	beforeEach(() => {
		installInMemoryLocalStorage()
		idb.store.clear()
		idb.setAvailable(true)
		clearExampleOverlay()
		setStorageAdapter(localStorageAdapter)
	})

	it("hydrates an empty library: visuals, thumbnails, folders, datasets, marker", async () => {
		const seed = makeSeed()
		await applyExampleSeed(seed)

		expect(loadVisuals().map((v) => v.id)).toEqual(["seed-1"])
		// Thumbnails are stripped from localStorage and land in the side-table.
		expect(loadVisuals()[0]?.thumbnail).toBeNull()
		expect(await loadThumbnailsAsync()).toEqual({
			"seed-1": "data:image/png;base64,AAA",
		})
		expect(Object.keys(await loadDatasetsAsync())).toEqual(["ds-1"])
		expect(loadExampleSeedApplied()).toBe(seed.exportedAt)
	})

	it("does nothing when the library already has visuals", async () => {
		await saveVisuals([makeVisual("mine")])
		await applyExampleSeed(makeSeed())

		expect(loadVisuals().map((v) => v.id)).toEqual(["mine"])
		expect(await loadDatasetsAsync()).toEqual({})
		expect(loadExampleSeedApplied()).toBeNull()
	})

	it("does not resurrect examples the recipient deleted (marker match)", async () => {
		const seed = makeSeed()
		await applyExampleSeed(seed)
		// Recipient deletes everything…
		await saveVisuals([])
		// …and the same build reloads.
		await applyExampleSeed(seed)
		expect(loadVisuals()).toEqual([])
	})

	it("re-seeds an empty library when a NEW export arrives", async () => {
		await applyExampleSeed(makeSeed())
		await saveVisuals([])
		const newer = makeSeed({
			exportedAt: "2026-08-01T00:00:00.000Z",
			visuals: [makeVisual("seed-2")],
		})
		await applyExampleSeed(newer)
		expect(loadVisuals().map((v) => v.id)).toEqual(["seed-2"])
	})

	it("is a no-op for the checked-in empty seed", async () => {
		await applyExampleSeed(makeSeed({ exportedAt: null, visuals: [] }))
		expect(loadVisuals()).toEqual([])
		expect(loadExampleSeedApplied()).toBeNull()
	})

	it("falls back to localStorage datasets when IndexedDB is unavailable", async () => {
		idb.setAvailable(false)
		await applyExampleSeed(makeSeed())
		expect(Object.keys(loadDatasets())).toEqual(["ds-1"])
	})

	it("merges seed themes without overwriting an existing same-id theme", async () => {
		const mine = { ...SYSTEM_THEMES[0]!, id: "th-x", name: "Mine", isSystem: false }
		saveThemes([mine])
		const seeded = { ...SYSTEM_THEMES[0]!, id: "th-y", name: "Seeded", isSystem: false }
		const clash = { ...SYSTEM_THEMES[0]!, id: "th-x", name: "Clobber", isSystem: false }
		await applyExampleSeed(makeSeed({ themes: [seeded, clash] }))

		const names = (loadThemes() ?? []).map((t) => t.name)
		expect(names).toContain("Mine")
		expect(names).toContain("Seeded")
		expect(names).not.toContain("Clobber")
	})

	it("writes through the storage ADAPTER, so server mode persists to the backend", async () => {
		const written: Record<string, unknown> = {}
		const remote: StorageContentAdapter = {
			...localStorageAdapter,
			capabilities: { remoteLoad: true },
			loadVisuals: async () => [],
			loadThemes: async () => null,
			loadUserDefaultThemeId: async () => null,
			saveVisuals: async (v) => {
				written.visuals = v
			},
			saveFolders: async (f) => {
				written.folders = f
			},
			saveDatasets: async (d) => {
				written.datasets = d
			},
			saveThemes: async (t) => {
				written.themes = t
			},
			saveUserDefaultThemeId: async (id) => {
				written.userDefaultThemeId = id
			},
		}
		setStorageAdapter(remote)

		const seeded = { ...SYSTEM_THEMES[0]!, id: "th-y", name: "Seeded", isSystem: false }
		await applyExampleSeed(
			makeSeed({ themes: [seeded], userDefaultThemeId: "th-y" })
		)

		expect((written.visuals as Visual[]).map((v) => v.id)).toEqual(["seed-1"])
		expect(Object.keys(written.datasets as Record<string, Dataset>)).toEqual([
			"ds-1",
		])
		// A never-initialized theme list is at first run: the bundled system
		// themes go with the seeded one, or the remote list would come back
		// system-theme-less.
		expect((written.themes as { id: string }[]).map((t) => t.id)).toEqual([
			"system-light",
			"system-dark",
			"th-y",
		])
		expect(written.userDefaultThemeId).toBe("th-y")
		// The backend is the store — nothing local was written.
		expect(loadVisuals()).toEqual([])
		expect(idb.store.size).toBe(0)
	})
})

describe("installEphemeralExamples", () => {
	/** The shim's backing map, so the "nothing was persisted" assertions can
	 *  read raw localStorage without a bare global. */
	let local = new Map<string, string>()

	beforeEach(() => {
		local = installInMemoryLocalStorage()
		idb.store.clear()
		idb.setAvailable(true)
		clearExampleOverlay()
		setStorageAdapter(localStorageAdapter)
	})

	it("serves the examples without persisting anything", async () => {
		await installEphemeralExamples(makeSeed())

		expect(loadVisuals().map((v) => v.id)).toEqual(["seed-1"])
		expect(loadFolders().map((f) => f.id)).toEqual(["f1"])
		expect(Object.keys(await loadDatasetsAsync())).toEqual(["ds-1"])
		expect(local.get("vis-components:visuals")).toBeUndefined()
		expect(idb.store.size).toBe(0)
		expect(loadExampleSeedApplied()).toBeNull()
	})

	it("is a no-op for the checked-in empty seed", async () => {
		await installEphemeralExamples(makeSeed({ exportedAt: null, visuals: [] }))
		expect(loadVisuals()).toEqual([])
	})

	it("runs the px→pt font reset on pre-cutover bundles", async () => {
		const stale = makeSeed({
			exportedAt: "2026-07-01T00:00:00.000Z",
			visuals: [
				{
					...makeVisual("seed-1"),
					dataLabelsConfig: { fontSize: 99 },
				} as unknown as Visual,
			],
		})
		await installEphemeralExamples(stale)
		expect(
			(loadVisuals()[0] as unknown as { dataLabelsConfig: { fontSize: number } })
				.dataLabelsConfig.fontSize
		).toBe(11)
	})

	it("does not duplicate examples a library already holds from the old seeding", async () => {
		// The persist-once path ran in this browser before the sandbox existed.
		await applyExampleSeed(makeSeed())
		clearExampleOverlay()
		await installEphemeralExamples(makeSeed())

		expect(loadVisuals().map((v) => v.id)).toEqual(["seed-1"])
		expect(Object.keys(await loadDatasetsAsync())).toEqual(["ds-1"])
		// And they stay the user's: an edit still persists.
		await saveVisuals(loadVisuals().map((v) => ({ ...v, name: "Renamed" })))
		expect(loadVisuals().map((v) => v.name)).toEqual(["Renamed"])
	})
})
