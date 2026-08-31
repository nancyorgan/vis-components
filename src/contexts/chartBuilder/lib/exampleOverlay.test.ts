/** The ephemeral-examples overlay, exercised through the storage seam it
 *  hooks into — the point of the feature is what does and doesn't land in
 *  durable storage, so almost every assertion here reads the raw store. */

import { beforeEach, describe, expect, it, vi } from "vitest"

import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { DEFAULT_LABELS_CONFIG } from "./labelsConfig"
import { emptyEncodings, type Dataset, type Folder, type Visual } from "./types"

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

import { sweepOrphanDatasets } from "./datasetSweep"
import {
	clearExampleOverlay,
	installExampleOverlay,
	isEphemeralSeedId,
	overlayThemes,
	seedUserDefaultThemeId,
	type ExampleOverlayContent,
} from "./exampleOverlay"
import {
	loadDatasetsAsync,
	loadFolders,
	loadThemes,
	loadVisuals,
	saveDatasetsAsync,
	saveFolders,
	saveThemes,
	saveVisuals,
} from "./storage"
import { SYSTEM_THEMES } from "./systemThemes"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"

const makeVisual = (
	id: string,
	overrides: Partial<Visual> = {}
): Visual => ({
	id,
	name: `Visual ${id}`,
	folderId: null,
	datasetId: "ds-seed",
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 0,
	updatedAt: 0,
	...overrides,
})

const makeDataset = (id: string): Dataset => ({
	id,
	name: id,
	fields: [{ name: "a", inferredType: "quantitative" }],
	versions: [
		{ id: `${id}-v1`, filename: `${id}.csv`, rows: [{ a: "1" }], createdAt: 0 },
	],
	latestVersionId: `${id}-v1`,
	createdAt: 0,
})

const seedTheme = {
	...SYSTEM_THEMES[0]!,
	id: "th-seed",
	name: "Seed theme",
	isSystem: false,
}

const seedFolder: Folder = {
	id: "f-seed",
	name: "Examples",
	parentId: null,
	createdAt: 0,
}

const content = (
	overrides: Partial<ExampleOverlayContent> = {}
): ExampleOverlayContent => ({
	visuals: [
		makeVisual("seed-1", {
			folderId: "f-seed",
			themeId: "th-seed",
			thumbnail: "data:image/png;base64,AAA",
		}),
	],
	folders: [seedFolder],
	datasets: { "ds-seed": makeDataset("ds-seed") },
	themes: [seedTheme],
	userDefaultThemeId: "th-seed",
	...overrides,
})

/** The shim's backing map — read durable localStorage without tripping the
 *  "no bare localStorage" lint rule the app code lives under. */
let local = new Map<string, string>()

const raw = <T>(key: string): T | null => {
	const stored = local.get(key)
	return stored === undefined ? null : (JSON.parse(stored) as T)
}

const storedVisuals = (): Visual[] | null =>
	raw<{ data: Visual[] }>("vis-components:visuals")?.data ?? null

const storedFolderIds = (): string[] =>
	(raw<Folder[]>("vis-components:folders") ?? []).map((f) => f.id)

// Datasets persist as one key per body plus a shared metadata index; the
// index is the authoritative list of what's stored.
const storedDatasetIds = (): string[] => {
	const wrapper = idb.store.get("vis-components:datasetIndex") as
		| { data: Record<string, unknown> }
		| undefined
	return Object.keys(wrapper?.data ?? {})
}

beforeEach(() => {
	local = installInMemoryLocalStorage()
	idb.store.clear()
	idb.setAvailable(true)
	clearExampleOverlay()
})

describe("reading through the overlay", () => {
	it("serves the bundled examples without writing them anywhere", async () => {
		installExampleOverlay(content())

		expect(loadVisuals().map((v) => v.id)).toEqual(["seed-1"])
		expect(loadFolders().map((f) => f.id)).toEqual(["f-seed"])
		expect(Object.keys(await loadDatasetsAsync())).toEqual(["ds-seed"])
		expect(overlayThemes([]).map((t) => t.id)).toEqual(["th-seed"])
		expect(seedUserDefaultThemeId()).toBe("th-seed")

		// Nothing durable was touched.
		expect(storedVisuals()).toBeNull()
		expect(local.get("vis-components:folders")).toBeUndefined()
		expect(idb.store.size).toBe(0)
	})

	it("keeps the seed visual's thumbnail in memory (never in the side-table)", () => {
		installExampleOverlay(content())
		expect(loadVisuals()[0]?.thumbnail).toBe("data:image/png;base64,AAA")
		expect(idb.store.get("vis-components:thumbnails")).toBeUndefined()
	})

	it("is inert when no overlay is installed", async () => {
		expect(loadVisuals()).toEqual([])
		expect(await loadDatasetsAsync()).toEqual({})
		expect(isEphemeralSeedId("seed-1")).toBe(false)
	})
})

describe("writing through the overlay", () => {
	it("does not persist an edited example", async () => {
		installExampleOverlay(content())
		const edited = loadVisuals().map((v) => ({ ...v, name: "Renamed" }))
		await saveVisuals(edited)

		expect(storedVisuals()).toEqual([])
		// A "reload" (fresh overlay install over the same store) restores it.
		clearExampleOverlay()
		installExampleOverlay(content())
		expect(loadVisuals().map((v) => v.name)).toEqual(["Visual seed-1"])
	})

	it("makes deleting an example session-only", async () => {
		installExampleOverlay(content())
		await saveVisuals([])
		clearExampleOverlay()
		installExampleOverlay(content())
		expect(loadVisuals().map((v) => v.id)).toEqual(["seed-1"])
	})

	it("persists the user's own work alongside the examples", async () => {
		installExampleOverlay(content())
		await saveVisuals([makeVisual("mine", { datasetId: "ds-mine" }), ...loadVisuals()])

		expect(storedVisuals()?.map((v) => v.id)).toEqual(["mine"])
		expect(loadVisuals().map((v) => v.id)).toEqual(["mine", "seed-1"])
	})

	it("strips seed datasets and seed folders from whole-collection saves", async () => {
		installExampleOverlay(content())
		await saveDatasetsAsync({
			...(await loadDatasetsAsync()),
			"ds-mine": makeDataset("ds-mine"),
		})
		saveFolders([...loadFolders(), { ...seedFolder, id: "f-mine", name: "Mine" }])

		expect(storedDatasetIds()).toEqual(["ds-mine"])
		expect(storedFolderIds()).toEqual(["f-mine"])
	})

	it("strips seed themes but keeps the user's", () => {
		installExampleOverlay(content())
		saveThemes(overlayThemes([SYSTEM_THEMES[0]!]))
		expect((loadThemes() ?? []).map((t) => t.id)).toEqual(["system-light"])
	})
})

describe("promotion — a copy of an example is real work", () => {
	it("persists the seed dataset, theme and folder a copy still points at", async () => {
		installExampleOverlay(content())
		const copy = { ...loadVisuals()[0]!, id: "vs-copy", name: "Visual seed-1 (copy)" }
		await saveVisuals([copy, ...loadVisuals()])

		expect(storedVisuals()?.map((v) => v.id)).toEqual(["vs-copy"])
		expect(storedDatasetIds()).toEqual(["ds-seed"])
		expect((loadThemes() ?? []).map((t) => t.id)).toEqual(["th-seed"])
		expect(storedFolderIds()).toEqual(["f-seed"])
	})

	it("leaves exactly one copy of the promoted rows after a reload", async () => {
		installExampleOverlay(content())
		const copy = { ...loadVisuals()[0]!, id: "vs-copy" }
		await saveVisuals([copy, ...loadVisuals()])

		// Reload: the installer adopts every bundled id already in storage.
		clearExampleOverlay()
		installExampleOverlay(content(), [
			...loadVisuals().map((v) => v.id),
			...loadFolders().map((f) => f.id),
			...(loadThemes() ?? []).map((t) => t.id),
			...Object.keys(await loadDatasetsAsync()),
		])

		expect(Object.keys(await loadDatasetsAsync())).toEqual(["ds-seed"])
		expect(loadFolders().map((f) => f.id)).toEqual(["f-seed"])
		expect(loadVisuals().map((v) => v.id)).toEqual(["vs-copy", "seed-1"])
		// The promoted dataset is the user's now — a later save keeps it.
		await saveDatasetsAsync(await loadDatasetsAsync())
		expect(storedDatasetIds()).toEqual(["ds-seed"])
	})

	it("promotes the parent chain of a seed folder a user folder nests under", () => {
		installExampleOverlay(
			content({
				folders: [
					seedFolder,
					{ id: "f-seed-child", name: "Bars", parentId: "f-seed", createdAt: 0 },
				],
			})
		)
		saveFolders([
			...loadFolders(),
			{ id: "f-mine", name: "Mine", parentId: "f-seed-child", createdAt: 0 },
		])

		expect(storedFolderIds().sort()).toEqual([
			"f-mine",
			"f-seed",
			"f-seed-child",
		])
	})

	it("does not promote through an example the user merely edited", async () => {
		installExampleOverlay(content())
		await saveVisuals(loadVisuals().map((v) => ({ ...v, name: "Renamed" })))
		expect(storedDatasetIds()).toEqual([])
		expect(loadThemes()).toBeNull()
	})
})

describe("a library that already holds the seed durably", () => {
	it("shows one copy of each row and keeps saving them", async () => {
		// Pre-overlay state: the examples were written in by the old
		// persist-once seeding.
		await saveVisuals(content().visuals)
		saveFolders(content().folders)
		saveThemes([SYSTEM_THEMES[0]!, seedTheme])
		await saveDatasetsAsync(content().datasets)

		installExampleOverlay(content(), [
			...loadVisuals().map((v) => v.id),
			...loadFolders().map((f) => f.id),
			...(loadThemes() ?? []).map((t) => t.id),
			...Object.keys(await loadDatasetsAsync()),
		])

		expect(loadVisuals().map((v) => v.id)).toEqual(["seed-1"])
		expect(loadFolders().map((f) => f.id)).toEqual(["f-seed"])
		expect(Object.keys(await loadDatasetsAsync())).toEqual(["ds-seed"])
		expect(isEphemeralSeedId("seed-1")).toBe(false)

		// Adopted rows still persist normally — including a rename.
		await saveVisuals(loadVisuals().map((v) => ({ ...v, name: "Renamed" })))
		await saveDatasetsAsync(await loadDatasetsAsync())
		expect(storedVisuals()?.map((v) => v.name)).toEqual(["Renamed"])
		expect(storedDatasetIds()).toEqual(["ds-seed"])
	})
})

describe("orphan GC", () => {
	it("does not sweep seed datasets that seed visuals reference", async () => {
		installExampleOverlay(content())
		const swept = sweepOrphanDatasets({
			datasets: await loadDatasetsAsync(),
			visuals: loadVisuals(),
		})
		expect(swept.removedIds).toEqual([])
	})

	it("keeps a swept store free of seed rows when it is written back", async () => {
		installExampleOverlay(content())
		const swept = sweepOrphanDatasets({
			datasets: {
				...(await loadDatasetsAsync()),
				"ds-mine": makeDataset("ds-mine"),
			},
			visuals: [...loadVisuals(), makeVisual("mine", { datasetId: "ds-mine" })],
		})
		await saveDatasetsAsync(swept.datasets)
		expect(storedDatasetIds()).toEqual(["ds-mine"])
	})
})
