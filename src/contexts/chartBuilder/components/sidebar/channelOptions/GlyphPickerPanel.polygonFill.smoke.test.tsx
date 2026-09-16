import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_CONNECTION_CONFIG,
	type ChannelConfigs,
	type PatternConfig,
} from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { PatternOptionsPanel } from "./GlyphPickerPanel"

/** The Pattern panel's "Polygon fill" subsection — filled radar only. Its
 *  picks are SEPARATE from the Point-fill ones: they write
 *  `pattern.defaultPolygonPattern` / `pattern.polygonOverrides`, never
 *  `defaultPattern` / `pattern.overrides`. */

const DATASET_ID = "ds-polygon-fill-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "radar",
		filename: "radar.csv",
		fields: [
			{ name: "metric", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
			{ name: "team", inferredType: "categorical" },
		],
		rows: ["A", "B", "C", "D"].flatMap((metric, i) => [
			{ metric, score: String(10 + i), team: "north" },
			{ metric, score: String(20 - i), team: "south" },
		]),
	})

const RADAR: Encodings = {
	...emptyEncodings(),
	r: { field: "score" },
	angle: { field: "metric" },
	connection: { field: "team" },
}

const seed = (encodings: Encodings, configs: Partial<ChannelConfigs>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	return store
}

const FILLED: Partial<ChannelConfigs> = {
	connection: { ...DEFAULT_CONNECTION_CONFIG, fillPolygon: true },
}

// Datasets hydrate asynchronously — settle a tick before asserting.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<PatternOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

type SavedConfigs = { defaultPattern?: number | null; pattern?: Partial<PatternConfig> }
const readSavedConfigs = (store: Map<string, string>): SavedConfigs => {
	const parsed = JSON.parse(
		store.get("vis-components:currentChannelConfigs") ?? "{}"
	) as { _v?: number; data?: SavedConfigs }
	return parsed.data ?? (parsed as SavedConfigs)
}

describe("Pattern panel — radar 'Polygon fill' (no pattern variable)", () => {
	it("appears only while the radar polygon is filled", async () => {
		seed(RADAR, {})
		let q = await mount()
		expect(q.queryByText("Polygon fill")).toBeNull()
		cleanup()
		seed(RADAR, FILLED)
		q = await mount()
		expect(q.queryByText("Polygon fill")).not.toBeNull()
		// The point-fill and line-dash subsections are still there beside it.
		expect(q.queryByText("Point fill")).not.toBeNull()
		expect(q.queryByText("Line dash")).not.toBeNull()
	})

	it("a polygon swatch writes pattern.defaultPolygonPattern and leaves the point-fill defaultPattern alone", async () => {
		const store = seed(RADAR, FILLED)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Polygon pattern option 3"))
		const configs = readSavedConfigs(store)
		expect(configs.pattern?.defaultPolygonPattern).toBe(2)
		expect(configs.defaultPattern ?? null).toBeNull()
	})

	it("a Point-fill swatch keeps writing defaultPattern, not the polygon pick", async () => {
		const store = seed(RADAR, FILLED)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Pattern option 1"))
		const configs = readSavedConfigs(store)
		expect(configs.defaultPattern).toBe(0)
		expect(configs.pattern?.defaultPolygonPattern ?? null).toBeNull()
	})

	it("stays available with points hidden (dash-only form) — the polygons remain", async () => {
		seed(RADAR, {
			connection: {
				...DEFAULT_CONNECTION_CONFIG,
				fillPolygon: true,
				pointSampling: "none",
			},
		})
		const q = await mount()
		expect(q.queryByText("Polygon fill")).not.toBeNull()
		expect(q.queryByText("Point fill")).toBeNull()
	})
})

describe("Pattern panel — radar 'Polygon fill' (pattern variable mapped)", () => {
	it("lists a polygon row per category, separate from the point-fill row", async () => {
		const store = seed({ ...RADAR, pattern: { field: "team" } }, FILLED)
		const q = await mount()
		expect(q.getAllByLabelText("No polygon pattern for north").length).toBe(1)
		// Line dash + Point fill each keep their plain "No pattern" button.
		expect(q.getAllByLabelText("No pattern for north").length).toBe(2)
		fireEvent.click(q.getAllByLabelText("Polygon pattern option 2")[0]!)
		const configs = readSavedConfigs(store)
		expect(configs.pattern?.polygonOverrides).toEqual({ north: 1 })
		expect(configs.pattern?.overrides ?? {}).toEqual({})
	})
})
