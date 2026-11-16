import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_PATTERN_CONFIG,
	type ChannelConfigs,
	type PatternConfig,
} from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { PatternOptionsPanel } from "./GlyphPickerPanel"

/** The Pattern panel's "Scale" box — a number input under each Color picker
 *  that zooms the category's pattern tile (×0–×4 by 0.1). With a pattern
 *  variable mapped it writes `pattern.scales[category]`; with none mapped
 *  it sits under the default pattern's Ink color and writes
 *  `pattern.defaultScale`. Blank = inherit ×1 (no entry stored). */

const DATASET_ID = "ds-pattern-scale-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
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

/** Fill-form encodings (no connection → SVG fill patterns on the marks). */
const FILL: Encodings = {
	...emptyEncodings(),
	x: { field: "metric" },
	y: { field: "score" },
}

const seed = (encodings: Encodings, configs: Partial<ChannelConfigs>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	return store
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

const type = (input: HTMLElement, value: string) =>
	fireEvent.change(input, { target: { value } })

describe("Pattern panel — Scale (pattern variable mapped)", () => {
	it("shows one Scale box per category, under the Color picker, blank at ×1", async () => {
		seed({ ...FILL, pattern: { field: "team" } }, {})
		const q = await mount()
		const north = q.getByLabelText("Scale for north") as HTMLInputElement
		expect(north.value).toBe("")
		expect(north.placeholder).toBe("1")
		expect(q.getByLabelText("Scale for south")).toBeTruthy()
	})

	it("typing writes pattern.scales[category] and leaves the other categories alone", async () => {
		const store = seed({ ...FILL, pattern: { field: "team" } }, {})
		const q = await mount()
		type(q.getByLabelText("Scale for north"), "2")
		expect(readSavedConfigs(store).pattern?.scales).toEqual({ north: 2 })
		type(q.getByLabelText("Scale for south"), "0.5")
		expect(readSavedConfigs(store).pattern?.scales).toEqual({
			north: 2,
			south: 0.5,
		})
	})

	it("clamps typed values into ×0–×4", async () => {
		const store = seed({ ...FILL, pattern: { field: "team" } }, {})
		const q = await mount()
		type(q.getByLabelText("Scale for north"), "9")
		expect(readSavedConfigs(store).pattern?.scales).toEqual({ north: 4 })
		type(q.getByLabelText("Scale for north"), "-1")
		expect(readSavedConfigs(store).pattern?.scales).toEqual({ north: 0 })
	})

	it("emptying the box drops the entry (back to ×1)", async () => {
		const store = seed(
			{ ...FILL, pattern: { field: "team" } },
			{ pattern: { ...DEFAULT_PATTERN_CONFIG, scales: { north: 2, south: 3 } } }
		)
		const q = await mount()
		const north = q.getByLabelText("Scale for north") as HTMLInputElement
		expect(north.value).toBe("2")
		type(north, "")
		expect(readSavedConfigs(store).pattern?.scales).toEqual({ south: 3 })
	})
})

describe("Pattern panel — Scale (no pattern variable)", () => {
	it("appears under the default pattern's Ink color once a pattern is picked", async () => {
		seed(FILL, {})
		let q = await mount()
		expect(q.queryByLabelText("Scale")).toBeNull()
		cleanup()
		seed(FILL, { defaultPattern: 0 })
		q = await mount()
		expect(q.getByLabelText("Scale")).toBeTruthy()
		expect(q.getByText("Ink color")).toBeTruthy()
	})

	it("writes pattern.defaultScale, and the reset beside it clears it", async () => {
		const store = seed(FILL, { defaultPattern: 0 })
		const q = await mount()
		type(q.getByLabelText("Scale"), "1.5")
		expect(readSavedConfigs(store).pattern?.defaultScale).toBe(1.5)
		// Every setting carries its own reset, beside it; there is no
		// panel-wide link under everything any more.
		expect(q.getAllByText("reset").some((el) => el.className.includes("underline"))).toBe(false)
		fireEvent.click(q.getByLabelText("Reset scale"))
		expect(readSavedConfigs(store).pattern?.defaultScale ?? null).toBeNull()
		// The default pattern has its own, too.
		fireEvent.click(q.getByLabelText("Reset pattern option"))
		expect(readSavedConfigs(store).defaultPattern ?? null).toBeNull()
	})
})
