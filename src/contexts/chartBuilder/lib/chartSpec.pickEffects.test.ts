import { describe, expect, it } from "vitest"

import { applySettings } from "./applySettings"
import { composeVisual, editVisual, type ChartSpec } from "./chartSpec"
import { LIGHT_THEME_BASE as theme } from "./systemThemes"
import type { Visual } from "./types"

/** The editor's pick effects reached through a chart spec: lines follow
 * Color, and bar labels sit on the Length variable. */

const deps = {
	theme,
	fields: [
		{ name: "Quarter", type: "categorical" },
		{ name: "Region", type: "categorical" },
		{ name: "Size", type: "ordinal" },
		{ name: "rate", type: "quantitative" },
		{ name: "year", type: "categorical" },
		{ name: "sales", type: "quantitative" },
		{ name: "profit", type: "quantitative" },
	] as const,
	now: 1000,
}

const spec = (over: Partial<ChartSpec>): ChartSpec => ({
	datasetId: "ds-1",
	folderId: null,
	encodings: {},
	...over,
})

const compose = (over: Partial<ChartSpec>) => {
	const result = composeVisual(spec(over), deps)
	expect(result.problems).toEqual([])
	return result
}

const LINE = { x: "Quarter", y: "rate", hue: "Region", connection: "Region" }
const otherPalette = theme.categoricalPalettes.find((p) => p.id !== theme.defaultCategoricalPaletteId)!

describe("chart spec: lines follow Color", () => {
	it("a line chart stores the Line slot varying by Region on the Color palette, with a note", () => {
		const { visual, warnings } = compose({ encodings: LINE })
		const line = visual.channelConfigs.colorSlots?.line
		expect(line?.field).toBe("Region")
		expect(line?.palette).toEqual(visual.channelConfigs.categoricalPalette)
		expect(line?.paletteId).toBe(visual.channelConfigs.categoricalPaletteId)
		expect(warnings.some((w) => w.includes('"Region"') && w.includes("lines"))).toBe(true)
		expect(warnings.join(" ")).not.toContain("—")
	})

	it("a Color palette picked in settings is the one the lines take", () => {
		const { visual } = compose({
			encodings: LINE,
			settings: { channelConfigs: { categoricalPaletteId: otherPalette.id } },
		})
		expect(visual.channelConfigs.colorSlots?.line?.paletteId).toBe(otherPalette.id)
		expect(visual.channelConfigs.colorSlots?.line?.palette).toEqual(otherPalette.colors)
	})

	it("an explicit line color in settings is kept", () => {
		const { visual, warnings } = compose({
			encodings: LINE,
			settings: { channelConfigs: { colorSlots: { line: { singleColor: "#ff0000" } } } },
		})
		expect(visual.channelConfigs.colorSlots?.line).toMatchObject({ field: null, singleColor: "#ff0000" })
		expect(warnings.some((w) => w.includes("lines"))).toBe(false)
	})

	it("a dumbbell and bars with Color are left alone", () => {
		const dumbbell = compose({ encodings: { x: "rate", y: "Quarter", hue: "Region", connection: "Quarter" } })
		expect(dumbbell.visual.channelConfigs.colorSlots?.line).toBeUndefined()
		const bars = compose({ encodings: { x: "Quarter", length: "rate", hue: "Region" } })
		expect(bars.visual.channelConfigs.colorSlots?.line).toBeUndefined()
	})

	it("an edit mapping Connection onto a chart with Color makes the lines follow", () => {
		const { visual: scatter } = compose({ encodings: { x: "Quarter", y: "rate", hue: "Size" } })
		expect(scatter.channelConfigs.colorSlots?.line).toBeUndefined()
		const { visual, warnings } = editVisual(scatter, { encodings: { connection: "Region" } }, deps)
		const line = visual.channelConfigs.colorSlots?.line
		expect(line?.field).toBe("Size")
		expect(line?.palette).toEqual(visual.channelConfigs.ordinalPalette)
		expect(warnings.some((w) => w.includes('"Size"'))).toBe(true)
	})

	it("an edit that maps neither Color nor Connection leaves the line alone", () => {
		const { visual: lineChart } = compose({ encodings: LINE })
		const cleared: Visual = {
			...lineChart,
			channelConfigs: { ...lineChart.channelConfigs, colorSlots: {} },
		}
		const { visual } = editVisual(cleared, { title: "Rates" }, deps)
		expect(visual.channelConfigs.colorSlots?.line).toBeUndefined()
	})
})

describe("chart spec: an edit moving Color", () => {
	it("lines that followed the old Color variable follow the new one", () => {
		const { visual: lineChart } = compose({ encodings: LINE })
		const { visual } = editVisual(lineChart, { encodings: { hue: "Size" } }, deps)
		const line = visual.channelConfigs.colorSlots?.line
		expect(line?.field).toBe("Size")
		expect(line?.palette).toEqual(visual.channelConfigs.ordinalPalette)
	})

	it("a Line slot edited on the old variable stays on it", () => {
		const { visual: lineChart } = compose({ encodings: LINE })
		const slot = lineChart.channelConfigs.colorSlots!.line!
		const edited: Visual = {
			...lineChart,
			channelConfigs: {
				...lineChart.channelConfigs,
				colorSlots: { line: { ...slot, paletteId: otherPalette.id, palette: [...otherPalette.colors] } },
			},
		}
		const { visual } = editVisual(edited, { encodings: { hue: "Size" } }, deps)
		expect(visual.channelConfigs.colorSlots?.line?.field).toBe("Region")
		expect(visual.channelConfigs.colorSlots?.line?.palette).toEqual(otherPalette.colors)
	})

	it("unmapping Color leaves the slot as it is", () => {
		const { visual: lineChart } = compose({ encodings: LINE })
		const { visual } = editVisual(lineChart, { encodings: { hue: null } }, deps)
		expect(visual.channelConfigs.colorSlots?.line).toEqual(lineChart.channelConfigs.colorSlots?.line)
	})
})

describe("chart spec: bar labels sit on the Length variable", () => {
	it("vertical bars with a label value store y = the Length variable, with a note", () => {
		const { visual, warnings } = compose({
			encodings: { x: "Quarter", length: "sales" },
			settings: { dataLabelsEncodings: { value: { field: "sales" } } },
		})
		expect(visual.dataLabelsEncodings?.y).toEqual({ field: "sales" })
		expect(visual.dataLabelsEncodings?.x).toEqual({ field: "Quarter" })
		expect(warnings.some((w) => w.includes("dataLabelsConfig.barLabelPosition"))).toBe(true)
	})

	it("horizontal stacked bars store x = the Length variable", () => {
		const { visual } = compose({
			encodings: { y: "Quarter", length: "sales", hue: "Region" },
			stack: "stack",
			settings: { dataLabelsEncodings: { value: { field: "sales" } } },
		})
		expect(visual.dataLabelsEncodings?.x).toEqual({ field: "sales" })
	})

	it("a position the request sets is kept", () => {
		const { visual, warnings } = compose({
			encodings: { x: "Quarter", length: "sales" },
			settings: { dataLabelsEncodings: { value: { field: "sales" }, y: { field: null, none: true } } },
		})
		expect(visual.dataLabelsEncodings?.y).toEqual({ field: null, none: true })
		expect(warnings.some((w) => w.includes("barLabelPosition"))).toBe(false)
	})

	it("a vector field keeps y = its y variable", () => {
		const { visual } = compose({
			encodings: { x: "year", y: "sales", length: "profit", angle: "profit" },
			settings: { dataLabelsEncodings: { value: { field: "profit" } } },
		})
		expect(visual.dataLabelsEncodings?.y).toEqual({ field: "sales" })
	})
})

describe("settings patch: bar labels", () => {
	it("applySettings seeds the value axis the way the panel does", () => {
		const { visual: bars } = compose({ encodings: { x: "Quarter", length: "sales" } })
		const { visual, problems } = applySettings(
			bars,
			{ dataLabelsEncodings: { value: { field: null, multiField: true, fields: ["sales"] } } },
			{ theme, fields: deps.fields }
		)
		expect(problems).toEqual([])
		expect(visual.dataLabelsEncodings?.y).toEqual({ field: "sales" })
	})
})

describe("chart spec: a new Color palette on an edit", () => {
	it("lines that followed Color take the new palette", () => {
		const { visual: line } = compose({ encodings: LINE })
		const { visual, problems } = editVisual(
			line,
			{ settings: { channelConfigs: { categoricalPaletteId: otherPalette.id } } },
			deps
		)
		expect(problems).toEqual([])
		expect(visual.channelConfigs.categoricalPalette).toEqual(otherPalette.colors)
		expect(visual.channelConfigs.colorSlots?.line?.field).toBe("Region")
		expect(visual.channelConfigs.colorSlots?.line?.palette).toEqual(otherPalette.colors)
	})

	it("a line color the chart already chose stays", () => {
		const { visual: line } = compose({
			encodings: LINE,
			settings: { channelConfigs: { colorSlots: { line: { singleColor: "#ff0000" } } } },
		})
		const { visual } = editVisual(
			line,
			{ settings: { channelConfigs: { categoricalPaletteId: otherPalette.id } } },
			deps
		)
		expect(visual.channelConfigs.colorSlots?.line).toMatchObject({ field: null, singleColor: "#ff0000" })
	})
})
