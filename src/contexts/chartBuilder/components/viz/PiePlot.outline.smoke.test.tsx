import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Slice outlines through the production path (ChartCanvas → PlotCanvas →
 *  PiePlot). Opacity → Outline offers "Vary by" on pies; the slices used to
 *  ask for the outline's level without a row, so every slice got the one
 *  level and the Vary by changed the legend only. Each slice now resolves
 *  off its own first row, as its fill does. */

const DATASET_ID = "ds-pie-outline"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "pies",
		filename: "pies.csv",
		fields: [
			{ name: "level", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
		],
		rows: [
			{ level: "a", value: "10" },
			{ level: "b", value: "20" },
			{ level: "c", value: "30" },
		],
	})

const OUTLINE = "#ff0000"

const seed = (
	opacitySlots: Record<string, unknown>,
	/** Further encodings (the Outline variable) and channel configs. */
	more: { encodings?: Record<string, unknown>; configs?: Record<string, unknown> } = {}
) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	// Angle + Color, no position → one pie, a slice per level.
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			angle: { field: "value" },
			hue: { field: "level" },
			...more.encodings,
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			shape: { outlineColor: OUTLINE, outlineWidth: 3 },
			opacitySlots,
			...more.configs,
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

const sliceOutlineOpacities = (container: HTMLElement): (string | null)[] =>
	[...container.querySelectorAll("path")]
		.filter((p) => p.getAttribute("stroke") === OUTLINE)
		.map((p) => p.getAttribute("stroke-opacity"))
		.sort()

/** The strokes of the slices, which are the only paths 3px wide. */
const sliceStrokes = (container: HTMLElement): (string | null)[] =>
	[...container.querySelectorAll("path")]
		.filter((p) => p.getAttribute("stroke-width") === "3")
		.map((p) => p.getAttribute("stroke"))

describe("PiePlot — slice outline color", () => {
	it("Color → Slice outline → Vary by gives each slice its variable's color", () => {
		// The pie built its own list of the channels that key a slice and left
		// the outline color out, so the variable reached the legend only.
		seed({}, { encodings: { outlineHue: { field: "level" } } })
		const { container } = mount()
		const strokes = sliceStrokes(container)
		expect(strokes).toHaveLength(3)
		expect(new Set(strokes).size).toBe(3)
		expect(strokes).not.toContain(OUTLINE)
	})

	it("with no Outline variable every slice takes the one outline color", () => {
		seed({})
		const { container } = mount()
		expect(sliceStrokes(container)).toEqual([OUTLINE, OUTLINE, OUTLINE])
	})

	it("the outline's Saturation shades it, as on a point's outline", () => {
		seed({}, { configs: { saturationSlots: { outline: { field: null, level: 0 } } } })
		const { container } = mount()
		const strokes = sliceStrokes(container)
		expect(strokes).toHaveLength(3)
		// Pure red, fully desaturated, is no longer red.
		for (const stroke of strokes) expect(stroke).not.toBe(OUTLINE)
		expect(new Set(strokes).size).toBe(1)
	})
})

describe("PiePlot — slice outline opacity", () => {
	it("Opacity → Outline → Vary by gives each slice's outline its own opacity", () => {
		seed({
			border: {
				field: "level",
				level: 1,
				opacity: {
					kind: "categorical",
					overrides: { a: 0.2, b: 0.5, c: 0.9 },
				},
			},
		})
		const { container } = mount()
		expect(sliceOutlineOpacities(container)).toEqual(["0.2", "0.5", "0.9"])
	})

	it("with no field, every slice's outline takes the one level", () => {
		seed({ border: { field: null, level: 0.4 } })
		const { container } = mount()
		expect(sliceOutlineOpacities(container)).toEqual(["0.4", "0.4", "0.4"])
	})
})
