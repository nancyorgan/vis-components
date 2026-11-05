import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_DATA_LABELS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
// Axis titles seeded cleared (""): jsdom gives the chart a tiny fallback
// canvas, and the default field-name titles would squeeze the plot area
// these mark-geometry assertions measure down to nothing.
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Bar + marks combo: `x + y + length` with the Length panel's "Draw as" set
 *  to bars renders the bars of `length` AND the `y` variable as scatter
 *  marks on the same measure axis — a polyline when Connection is mapped.
 *  Without the opt-in the same encodings are the line-segment scatter. */

const DATASET_ID = "ds-bar-combo"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "combo",
		filename: "combo.csv",
		fields: [
			{ name: "month", inferredType: "categorical" },
			{ name: "units", inferredType: "quantitative" },
			{ name: "revenue", inferredType: "quantitative" },
			{ name: "series", inferredType: "categorical" },
		],
		rows: [
			{ month: "Jan", units: "10", revenue: "50", series: "a" },
			{ month: "Feb", units: "20", revenue: "60", series: "a" },
			{ month: "Mar", units: "15", revenue: "90", series: "a" },
		],
	})

const BASE: Encodings = {
	...emptyEncodings(),
	x: { field: "month" },
	y: { field: "revenue" },
	length: { field: "units" },
}

const seed = (
	encodings: Encodings,
	configs: Record<string, unknown>,
	dataLabels?: {
		encodings: Record<string, unknown>
		config?: Record<string, unknown>
	}
) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	if (dataLabels) {
		store.set(
			"vis-components:currentDataLabelsEncodings",
			JSON.stringify({ ...emptyDataLabelsEncodings(), ...dataLabels.encodings })
		)
		store.set(
			"vis-components:currentDataLabelsConfig",
			JSON.stringify({ ...DEFAULT_DATA_LABELS_CONFIG, ...(dataLabels.config ?? {}) })
		)
	}
	/* eslint-enable @vc/use-wrapped-json-functions */
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: { ...DEFAULT_LABELS_CONFIG, xAxisTitle: "", yAxisTitle: "" } })
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

const AS_BARS = { length: { minLength: 4, maxLength: 40, render: "bars" } }

/** Mark rects: stroked (bars carry the outline), unlike chrome rects. */
const barRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")].filter(
		(r) => r.getAttribute("stroke") !== null
	)

describe("BarPlot — bar + marks combo (Length drawn as bars)", () => {
	it("draws the bars AND one mark per row for the y variable", () => {
		seed(BASE, AS_BARS)
		const { container } = mount()
		expect(barRects(container).length).toBe(3)
		const layer = container.querySelector("[data-combo-marks]")
		expect(layer).not.toBeNull()
		// One glyph per row; no polyline without a Connection field.
		expect(layer!.querySelectorAll("path, circle").length).toBeGreaterThanOrEqual(3)
		expect(layer!.querySelector("polyline")).toBeNull()
	})

	it("joins the marks into a line when Connection is mapped", () => {
		seed({ ...BASE, connection: { field: "series" } }, AS_BARS)
		const { container } = mount()
		const layer = container.querySelector("[data-combo-marks]")
		expect(layer).not.toBeNull()
		const line = layer!.querySelector("polyline")
		expect(line).not.toBeNull()
		expect(line!.getAttribute("points")!.split(" ")).toHaveLength(3)
	})

	it("extends the measure axis to cover the marks (revenue up to 90 over bars up to 20)", () => {
		seed(BASE, AS_BARS)
		const { container } = mount()
		const ticks = [...container.querySelectorAll("text")]
			.map((t) => Number(t.textContent))
			.filter((n) => Number.isFinite(n))
		// Bounded by the bars alone the y axis would top out at 20; the
		// marks push it past the revenue values (the short test plot draws
		// only every other tick, so the last label may fall short of 90).
		expect(Math.max(...ticks)).toBeGreaterThanOrEqual(80)
		// And every mark sits above the tallest bar's top (SVG y grows down).
		const barTops = barRects(container).map((r) => Number(r.getAttribute("y")))
		const layer = container.querySelector("[data-combo-marks]")!
		const markYs = [...layer.querySelectorAll("path")].map((p) => {
			const m = /translate\([^,]+,([^)]+)\)/.exec(p.getAttribute("transform") ?? "")
			return m ? Number(m[1]) : Number.NaN
		})
		expect(markYs.length).toBe(3)
		expect(Math.max(...markYs)).toBeLessThan(Math.min(...barTops))
	})

	it("without the opt-in the same encodings are the segment scatter (no bars)", () => {
		seed(BASE, {})
		const { container } = mount()
		expect(container.querySelector("[data-combo-marks]")).toBeNull()
		expect(barRects(container).length).toBe(0)
	})
})

/** The marks' glyph fills (the `<path>`s the mark painter emits). */
const markFills = (container: HTMLElement) =>
	[...container.querySelectorAll("[data-combo-marks] path")]
		.map((p) => p.getAttribute("fill"))
		.filter((f): f is string => !!f && f !== "none")

describe("BarPlot — combo point color", () => {
	it("points take their LINE's color, not the bars' Color mapping", () => {
		seed(
			{ ...BASE, hue: { field: "series" }, connection: { field: "series" } },
			{
				...AS_BARS,
				colorSlots: { line: { field: null, singleColor: "#112233" } },
			}
		)
		const { container } = mount()
		const line = container.querySelector("[data-combo-marks] polyline")
		expect(line?.getAttribute("stroke")).toBe("#112233")
		const fills = markFills(container)
		expect(fills.length).toBeGreaterThanOrEqual(3)
		expect(new Set(fills)).toEqual(new Set(["#112233"]))
		// The bars keep the hue color (not the line color).
		const barFills = new Set(barRects(container).map((r) => r.getAttribute("fill")))
		expect(barFills.has("#112233")).toBe(false)
	})

	it("the Point fill slot recolors the points on their own", () => {
		seed(
			{ ...BASE, connection: { field: "series" } },
			{
				...AS_BARS,
				colorSlots: {
					line: { field: null, singleColor: "#112233" },
					comboPointFill: { field: null, singleColor: "#ff00aa" },
				},
			}
		)
		const { container } = mount()
		expect(container.querySelector("[data-combo-marks] polyline")?.getAttribute("stroke")).toBe(
			"#112233"
		)
		expect(new Set(markFills(container))).toEqual(new Set(["#ff00aa"]))
	})
})

describe("BarPlot — combo data labels per layer", () => {
	const labelTexts = (root: ParentNode) =>
		[...root.querySelectorAll("text")].map((t) => t.textContent?.trim() ?? "")
	// Separate labels: one per variable (combined, the arranged "a, 10"
	// label names a marks variable and goes on the marks whole).
	// The Data Labels Y mapping points at the BAR value: the bars never read
	// it, and the marks' labels must sit at the points regardless.
	const LABELS = {
		encodings: {
			y: { field: "units" },
			value: { field: null, multiField: true, fields: ["series", "units"] },
		},
		config: { combineVariables: false },
	}

	it("a label showing the Connection variable draws on the marks; the bar value on the bars", () => {
		seed({ ...BASE, connection: { field: "series" } }, AS_BARS, LABELS)
		const { container } = mount()
		const marks = container.querySelector("[data-combo-marks]")!
		const onMarks = labelTexts(marks)
		expect(onMarks.filter((t) => t === "a").length).toBe(3)
		expect(onMarks.some((t) => /^(10|20|15)$/.test(t))).toBe(false)
		// …at the points (revenue, above every bar), not at the bar values.
		const barTops = barRects(container).map((r) => Number(r.getAttribute("y")))
		const labelYs = [...marks.querySelectorAll("text")].map((t) =>
			Number(t.getAttribute("y"))
		)
		expect(labelYs.length).toBe(3)
		expect(Math.max(...labelYs)).toBeLessThan(Math.min(...barTops))
		// The bars' labels (outside the marks group) carry the units — three
		// labels, plus whichever axis tick happens to share a value.
		const all = labelTexts(container)
		expect(all.filter((t) => t === "a").length).toBe(3)
		expect(all.filter((t) => /^(10|20|15)$/.test(t)).length).toBeGreaterThanOrEqual(3)
	})

	it("an explicit Show-on entry moves a label between the layers", () => {
		seed({ ...BASE, connection: { field: "series" } }, AS_BARS, {
			...LABELS,
			config: {
				combineVariables: false,
				fieldLayers: { series: "bars", units: "marks" },
			},
		})
		const { container } = mount()
		const onMarks = labelTexts(container.querySelector("[data-combo-marks]")!)
		expect(onMarks.filter((t) => t === "a").length).toBe(0)
		expect(onMarks.filter((t) => /^(10|20|15)$/.test(t)).length).toBe(3)
	})
})
