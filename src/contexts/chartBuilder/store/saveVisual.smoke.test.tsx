import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ReactNode } from "react"

import { stringifyJsonDangerous } from "../../../lib/json"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { buildDataset as buildDatasetFixture } from "../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_FACET_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "../lib/channelConfig"
import type { ChannelConfigs, DataLabelsConfig } from "../lib/channelConfig"
import type { LabelsConfig } from "../lib/labelsConfig"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { dataLabelsConfigFromTheme, labelsFromTheme } from "../lib/themeConfig"
import { emptyEncodings, type Encodings } from "../lib/types"
import {
	DEFAULT_DATA_TABLE_CONFIG,
	type DataTableConfig,
} from "../lib/dataTableConfig"

import { pieceKey } from "../lib/labelPieces"
import type { Visual } from "../lib/types"
import {
	currentAccessibilityConfigAtom,
	currentAnnotationsAtom,
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataTableConfigAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	currentThemeIdAtom,
	currentVisualIdAtom,
	currentVisualNameAtom,
	foldersAtom,
	newVisualFolderIdAtom,
	visualsAtom,
} from "./atoms"
import { useLoadVisual, useSaveVisual } from "./saveVisual"

let ls: Map<string, string>

beforeEach(() => {
	ls = installInMemoryLocalStorage()
})

afterEach(cleanup)

/** Render a hook against a fresh Jotai store and hand back BOTH the hook
 *  result and the store, so the test can read atoms directly afterwards. */
const renderInStore = <T,>(hook: () => T, seed?: (s: TestStore) => void) => {
	const captured: { store?: TestStore } = {}
	const { result } = renderHook(hook, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<TestProvider
				initializeState={(s) => {
					captured.store = s
					seed?.(s)
				}}
			>
				{children}
			</TestProvider>
		),
	})
	// initializeState runs during the first render, so this is always set.
	return { result, store: captured.store! }
}

/** Drop every editor-draft key, keeping only the saved-visuals blob. Without
 *  this the "fresh" store would bootstrap its current* atoms straight from
 *  the draft the seeding persisted, and the assertions would pass even if
 *  `useLoadVisual` did nothing at all. */
const keepOnlySavedVisuals = () => {
	for (const key of [...ls.keys()]) {
		if (key !== "vis-components:visuals") ls.delete(key)
	}
}

// ── The non-default editor state under test ─────────────────────────────────

const ENCODINGS: Encodings = {
	...emptyEncodings(),
	x: { field: "price" },
	y: { field: "carat" },
	hue: { field: "cut" },
}

const CHANNEL_CONFIGS: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	defaultFill: "#ff0088",
	defaultOpacity: 0.42,
	length: { minLength: 2, maxLength: 88 },
	x: { ...DEFAULT_AXIS_CONFIG, tickCount: 9, customFormat: ".2f" },
}

const LABELS: LabelsConfig = {
	...labelsFromTheme(SYSTEM_LIGHT_THEME),
	title: "Round-trip title",
	subtitle: "and its subtitle",
	yAxisTitleHorizontal: true,
	titleAlignments: { title: "left" },
	titleOffsets: { facetPanelTitle: { x: 12, y: -8 } },
	titleAngles: { facetTitle: 90 },
}

const DATA_LABELS: DataLabelsConfig = {
	...dataLabelsConfigFromTheme(SYSTEM_LIGHT_THEME),
	fontSize: 19,
	xOffset: 7,
	labelTemplate: "{price}",
}

const FIELD_LEVEL_ORDERS = { cut: ["Ideal", "Good", "Fair"] }

const DATA_TABLE: DataTableConfig = {
	...DEFAULT_DATA_TABLE_CONFIG,
	enabled: true,
	placement: "button",
	caption: "Diamond prices",
	maxRows: 20,
	headerBackground: "#eeeeee",
}

const ACCESSIBILITY = { description: "Ideal cuts cost the most." }

const seedEditor = (s: TestStore) => {
	s.set(currentVisualIdAtom, null)
	s.set(currentVisualNameAtom, "Round-trip chart")
	s.set(currentDatasetIdAtom, "ds-roundtrip")
	s.set(currentEncodingsAtom, ENCODINGS)
	s.set(currentChannelConfigsAtom, CHANNEL_CONFIGS)
	s.set(currentLabelsAtom, LABELS)
	s.set(currentDataLabelsConfigAtom, DATA_LABELS)
	s.set(currentFieldLevelOrdersAtom, FIELD_LEVEL_ORDERS)
	s.set(currentDataTableConfigAtom, DATA_TABLE)
	s.set(currentAccessibilityConfigAtom, ACCESSIBILITY)
	s.set(currentThemeIdAtom, "theme-roundtrip")
}

/** Seed → save → wipe the drafts → load into a fresh store. Returns the new
 *  store plus the saved visual id. */
const roundTrip = async () => {
	const saving = renderInStore(() => useSaveVisual(), seedEditor)
	let id = ""
	await act(async () => {
		id = await saving.result.current()
	})
	keepOnlySavedVisuals()

	const loading = renderInStore(() => useLoadVisual())
	// Guard the guard: the fresh store must NOT already hold the seeded state,
	// or the post-load assertions prove nothing.
	expect(loading.store.get(currentEncodingsAtom)).toEqual(emptyEncodings())
	expect(loading.store.get(currentLabelsAtom).title).toBe("")

	let ok = false
	await act(async () => {
		ok = await loading.result.current(id)
	})
	expect(ok).toBe(true)
	return { id, store: loading.store }
}

describe("useSaveVisual → useLoadVisual round-trip", () => {
	it("restores every seeded slice through localStorage into a fresh store", async () => {
		const { id, store } = await roundTrip()

		expect(store.get(currentVisualIdAtom)).toBe(id)
		expect(store.get(currentVisualNameAtom)).toBe("Round-trip chart")
		expect(store.get(currentDatasetIdAtom)).toBe("ds-roundtrip")
		expect(store.get(currentThemeIdAtom)).toBe("theme-roundtrip")
		expect(store.get(currentEncodingsAtom)).toEqual(ENCODINGS)
		expect(store.get(currentChannelConfigsAtom)).toEqual(CHANNEL_CONFIGS)
		expect(store.get(currentDataLabelsConfigAtom)).toEqual(DATA_LABELS)
		expect(store.get(currentFieldLevelOrdersAtom)).toEqual(FIELD_LEVEL_ORDERS)
		expect(store.get(currentDataTableConfigAtom)).toEqual(DATA_TABLE)
		expect(store.get(currentAccessibilityConfigAtom)).toEqual(ACCESSIBILITY)

		expect(store.get(currentLabelsAtom)).toEqual(LABELS)
	})

	it("writes one visual carrying the same slices (the persisted shape)", async () => {
		const { id, store } = await roundTrip()
		const visuals = store.get(visualsAtom)
		expect(visuals).toHaveLength(1)
		const v = visuals[0]!
		expect(v.id).toBe(id)
		expect(v.name).toBe("Round-trip chart")
		expect(v.datasetId).toBe("ds-roundtrip")
		expect(v.themeId).toBe("theme-roundtrip")
		expect(v.encodings).toEqual(ENCODINGS)
		expect(v.channelConfigs).toEqual(CHANNEL_CONFIGS)
		// The SAVE half is lossless (including `titleAngles`) and it survives
		// the localStorage blob — which localizes the drop above squarely to
		// `migrateLabelsConfig` on the load half.
		expect(v.labelsConfig).toEqual(LABELS)
		expect(v.labelsConfig.titleAngles).toEqual({ facetTitle: 90 })
		expect(v.dataLabelsConfig).toEqual(DATA_LABELS)
		expect(v.dataTableConfig).toEqual(DATA_TABLE)
		expect(v.accessibilityConfig).toEqual(ACCESSIBILITY)
		// No chart SVG in the test DOM → capture returns null, and there's no
		// prior thumbnail to preserve. The stamp moves only with a real
		// capture, so it stays absent — which is what marks the preview as
		// stale for the library's automatic refresh.
		expect(v.thumbnail).toBeNull()
		expect(v.thumbnailAt).toBeUndefined()
		expect(v.createdAt).toBeGreaterThan(0)
		expect(v.updatedAt).toBe(v.createdAt)
		// The dataset isn't in the datasets store, so there's no latest version
		// to stamp — but the field must still be present (null, not undefined).
		expect(v.createdAtVersionId).toBeNull()
	})

	it("re-saving updates in place: same id, no duplicate, createdAt preserved", async () => {
		const saving = renderInStore(() => useSaveVisual(), seedEditor)
		let first = ""
		await act(async () => {
			first = await saving.result.current()
		})
		const createdAt = saving.store.get(visualsAtom)[0]!.createdAt

		// Second save from the SAME store — currentVisualIdAtom now holds the id.
		saving.store.set(currentVisualNameAtom, "Renamed")
		let second = ""
		await act(async () => {
			second = await saving.result.current()
		})

		expect(second).toBe(first)
		const visuals = saving.store.get(visualsAtom)
		expect(visuals).toHaveLength(1)
		expect(visuals[0]!.name).toBe("Renamed")
		expect(visuals[0]!.createdAt).toBe(createdAt)
	})

	it("a first save files under the picked destination; later saves keep the stored folder", async () => {
		const saving = renderInStore(() => useSaveVisual(), (s) => {
			seedEditor(s)
			s.set(foldersAtom, [{ id: "fl-q3", name: "Q3", parentId: null, createdAt: 1 }])
			s.set(newVisualFolderIdAtom, "fl-q3")
		})
		await act(async () => {
			await saving.result.current()
		})
		expect(saving.store.get(visualsAtom)[0]!.folderId).toBe("fl-q3")

		// The library moved it (Move / drag) and the draft pick has gone stale:
		// a re-save follows the stored record, not the pick.
		saving.store.set(visualsAtom, (prev) =>
			prev.map((v) => ({ ...v, folderId: null }))
		)
		saving.store.set(newVisualFolderIdAtom, "fl-q3")
		await act(async () => {
			await saving.result.current()
		})
		expect(saving.store.get(visualsAtom)).toHaveLength(1)
		expect(saving.store.get(visualsAtom)[0]!.folderId).toBeNull()
	})

	it("a picked destination the library no longer has saves at the root, not dangling", async () => {
		const saving = renderInStore(() => useSaveVisual(), (s) => {
			seedEditor(s)
			s.set(foldersAtom, [])
			s.set(newVisualFolderIdAtom, "fl-deleted")
		})
		await act(async () => {
			await saving.result.current()
		})
		expect(saving.store.get(visualsAtom)[0]!.folderId).toBeNull()
	})

	it("re-stamps the version pin when the visual moves to another data set", async () => {
		// A fork (first hand edit / reshape of a shared data set) rebinds the
		// editor to a NEW data set with fresh version ids. The pin followed the
		// visual, not the data set, so it named a version the new data set
		// never had — and the export was refused on import.
		const fields = [{ name: "a", inferredType: "quantitative" as const }]
		const dsA = buildDatasetFixture({
			id: "ds-a",
			name: "a",
			fields,
			versions: [{ id: "dv-a1", filename: "a.csv", rows: [], createdAt: 1 }],
		})
		const dsB = buildDatasetFixture({
			id: "ds-b",
			name: "b",
			fields,
			versions: [
				{ id: "dv-b1", filename: "b.csv", rows: [], createdAt: 2 },
				{ id: "dv-b2", filename: "b.csv", rows: [], createdAt: 3 },
			],
		})
		const saving = renderInStore(() => useSaveVisual(), (s) => {
			seedEditor(s)
			s.set(loadedDatasetsAtom, { "ds-a": dsA, "ds-b": dsB })
			s.set(currentDatasetIdAtom, "ds-a")
		})
		await act(async () => {
			await saving.result.current()
		})
		expect(saving.store.get(visualsAtom)[0]!.createdAtVersionId).toBe("dv-a1")

		// Same data set, more saves: the pin holds.
		saving.store.set(currentVisualNameAtom, "Renamed")
		await act(async () => {
			await saving.result.current()
		})
		expect(saving.store.get(visualsAtom)[0]!.createdAtVersionId).toBe("dv-a1")

		// Rebound to another data set: stamped afresh against ITS latest.
		saving.store.set(currentDatasetIdAtom, "ds-b")
		await act(async () => {
			await saving.result.current()
		})
		const saved = saving.store.get(visualsAtom)[0]!
		expect(saved.datasetId).toBe("ds-b")
		expect(saved.createdAtVersionId).toBe("dv-b2")
	})

	it("a blank name saves as 'Untitled' and comes back that way", async () => {
		const saving = renderInStore(() => useSaveVisual(), (s) => {
			seedEditor(s)
			s.set(currentVisualNameAtom, "   ")
		})
		let id = ""
		await act(async () => {
			id = await saving.result.current()
		})
		keepOnlySavedVisuals()

		const loading = renderInStore(() => useLoadVisual())
		await act(async () => {
			await loading.result.current(id)
		})
		expect(loading.store.get(currentVisualNameAtom)).toBe("Untitled")
	})

	it("structures the joined-key shape an older build saved, on load and again on save", async () => {
		// A col-only grid chart as a pre-v7 build (a tab still running it)
		// writes it back: joined panel keys and a control character inside a
		// setting name. Chart saves aren't version-checked, so the editor
		// must take it as is — and never persist it that way again.
		const legacy = {
			id: "vs-legacy",
			name: "Legacy grid",
			folderId: null,
			datasetId: null,
			createdAtVersionId: null,
			fieldTypeOverrides: {},
			encodings: { ...emptyEncodings(), facetCol: { field: "System" } },
			channelConfigs: {
				...EMPTY_CHANNEL_CONFIGS,
				facet: {
					...DEFAULT_FACET_CONFIG,
					panelAxisOverrides: { "__all__|Type of System": { yMin: 0 } },
				},
			},
			labelsConfig: LABELS,
			dataLabelsConfig: {
				...DATA_LABELS,
				facetKeys: ["__all__|Type of System"],
				fieldFonts: { [pieceKey("lbl", "Region")]: { fontWeight: 700 } },
			},
			annotationsConfig: {
				rectangles: [],
				circles: [],
				lineSegments: [],
				texts: [{ id: "t1", facetKeys: ["__all__|Type of System"] }],
			},
			thumbnail: null,
			createdAt: 1,
			updatedAt: 1,
		} as unknown as Visual
		const { result, store } = renderInStore(
			() => ({ load: useLoadVisual(), save: useSaveVisual() }),
			(s) => s.set(visualsAtom, [legacy])
		)
		await act(async () => {
			await result.current.load("vs-legacy")
		})
		const pair = { row: "__all__", col: "Type of System" }
		expect(store.get(currentDataLabelsConfigAtom).facetKeys).toEqual([pair])
		expect(store.get(currentDataLabelsConfigAtom).fieldFonts).toEqual({})
		expect(store.get(currentDataLabelsConfigAtom).pieces).toEqual({
			lbl: { Region: { font: { fontWeight: 700 } } },
		})
		expect(store.get(currentAnnotationsAtom).texts[0]?.facetKeys).toEqual([pair])
		expect(store.get(currentChannelConfigsAtom).facet).toMatchObject({
			panelAxisOverrides: {},
			gridPanelAxisOverrides: { __all__: { "Type of System": { yMin: 0 } } },
		})

		// The save half structures too — a draft slice restored from an older
		// build can still carry the joined shape into the atoms.
		store.set(currentDataLabelsConfigAtom, {
			...store.get(currentDataLabelsConfigAtom),
			fieldSizes: { [pieceKey("lbl", "Region")]: 9 },
		})
		await act(async () => {
			await result.current.save()
		})
		const saved = store.get(visualsAtom).find((v) => v.id === "vs-legacy")!
		expect(saved.dataLabelsConfig?.fieldSizes).toEqual({})
		expect(saved.dataLabelsConfig?.pieces).toEqual({
			lbl: { Region: { font: { fontWeight: 700 }, size: 9 } },
		})
		expect(saved.annotationsConfig?.texts[0]?.facetKeys).toEqual([pair])
		// eslint-disable-next-line no-control-regex
		expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|__all__\|/.test(stringifyJsonDangerous(saved))).toBe(false)
	})

	it("a save resolves a pre-pair grid key against the rendered panels, never by guessing", async () => {
		// Row value "a|b", column value "x": the old key "a|b|x" could split
		// two ways. A migration leaves it alone; the editor, which can see the
		// panels, resolves it exactly.
		const ds = buildDatasetFixture({
			id: "ds-grid",
			name: "grid",
			filename: "grid.csv",
			fields: [
				{ name: "r", inferredType: "categorical" },
				{ name: "c", inferredType: "categorical" },
				{ name: "v", inferredType: "quantitative" },
			],
			rows: [
				{ r: "a|b", c: "x", v: "1" },
				{ r: "c", c: "y", v: "2" },
			],
		})
		const saving = renderInStore(() => useSaveVisual(), (s) => {
			seedEditor(s)
			s.set(currentDatasetIdAtom, "ds-grid")
			s.set(loadedDatasetsAtom, { "ds-grid": ds })
			s.set(previewVersionIdAtom, null)
			s.set(currentEncodingsAtom, {
				...emptyEncodings(),
				x: { field: "v" },
				facetRow: { field: "r" },
				facetCol: { field: "c" },
			})
			s.set(currentAnnotationsAtom, {
				rectangles: [],
				circles: [],
				lineSegments: [],
				texts: [{ id: "t", facetKeys: ["a|b|x", "a|b|x|nope"] } as never],
				images: [],
			})
		})
		await act(async () => {
			await saving.result.current()
		})
		const saved = saving.store.get(visualsAtom)[0]!
		expect(saved.annotationsConfig?.texts[0]?.facetKeys).toEqual([
			{ row: "a|b", col: "x" },
			// Not a rendered panel and more than one pipe: left as it is.
			"a|b|x|nope",
		])
	})

	it("loading an unknown id is a no-op that leaves the editor untouched", async () => {
		const loading = renderInStore(() => useLoadVisual(), seedEditor)
		let ok = true
		await act(async () => {
			ok = await loading.result.current("vs-does-not-exist")
		})
		expect(ok).toBe(false)
		// Nothing was clobbered on the way out.
		expect(loading.store.get(currentEncodingsAtom)).toEqual(ENCODINGS)
		expect(loading.store.get(currentVisualNameAtom)).toBe("Round-trip chart")
	})
})
