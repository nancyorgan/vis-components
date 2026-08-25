import { describe, expect, it } from "vitest"
import { BarsXMode } from "../../../lib/chartModes/barsX"
import { AreasXMode } from "../../../lib/chartModes/areasX"
import { emptyEncodings, type DatasetView, type Encodings } from "../../../lib/types"
import { DEFAULT_FACET_CONFIG } from "../../../lib/channelConfig"
import { resolveFacetPanels } from "../../../lib/resolveFacetPanels"
import { computePanelMeasureMin } from "./panelGrouping"
import { computeGroupMeasureMin } from "./shareScales"

const rows = [
	// panel g1 dips to -3; panel g2 is all-positive.
	{ cat: "A", val: "5", g: "g1" },
	{ cat: "B", val: "-3", g: "g1" },
	{ cat: "A", val: "7", g: "g2" },
	{ cat: "B", val: "2", g: "g2" },
]

const view = (): DatasetView => ({
	id: "ds",
	name: "d",
	filename: "d.csv",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	rows,
	createdAt: 0,
	versionCreatedAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
})

const encodings = (): Encodings => {
	const e = emptyEncodings()
	e.x = { field: "cat" }
	e.length = { field: "val" }
	e.facet = { field: "g" }
	return e
}

const run = (mode: typeof BarsXMode, shareYMode: "none" | "perGroup" | "all") =>
	computeGroupMeasureMin({
		mode,
		measureAxis: mode.canvas.measureAxis,
		shareXMode: "none",
		shareYMode,
		encodings: encodings(),
		channelConfigs: {},
		panelData: resolveFacetPanels(view(), encodings(), {}, {}, {
			...DEFAULT_FACET_CONFIG,
		}),
		getType: (name) => (name === "val" ? "quantitative" : "categorical"),
	})

describe("computePanelMeasureMin (leaf-aware)", () => {
	const raw = [
		{ cat: "A", hue: "r1", val: 3 },
		{ cat: "A", hue: "r1", val: -4 },
		{ cat: "A", hue: "r2", val: -5 },
	]

	it("all-stack: negatives in a category accumulate downward", () => {
		expect(
			computePanelMeasureMin(raw, "cat", "val", [{ channel: "hue", mode: "stack" }], [])
		).toBe(-9)
	})

	it("group by hue: the most negative leaf sets the floor", () => {
		expect(
			computePanelMeasureMin(raw, "cat", "val", [{ channel: "hue", mode: "group" }], ["hue"])
		).toBe(-5)
	})

	it("all-positive rows keep the zero floor", () => {
		const positive = raw.map((r) => ({ ...r, val: Math.abs(r.val) }))
		expect(
			computePanelMeasureMin(positive, "cat", "val", [{ channel: "hue", mode: "group" }], ["hue"])
		).toBe(0)
	})

	it("empty rows / missing fields return the zero floor", () => {
		expect(computePanelMeasureMin([], "cat", "val", [], [])).toBe(0)
		expect(computePanelMeasureMin(raw, null, "val", [], [])).toBe(0)
		expect(computePanelMeasureMin(raw, "cat", null, [], [])).toBe(0)
	})
})

describe("computeGroupMeasureMin (shared measure floor)", () => {
	it("share 'all': every panel gets the deepest floor in the chart", () => {
		const byKey = run(BarsXMode, "all")
		// g2 has no negative values but still sits on g1's floor — otherwise
		// the shared axis would be shared in name only.
		expect(byKey.get("g1")).toBe(-3)
		expect(byKey.get("g2")).toBe(-3)
	})

	it("share 'none': no override — each panel keeps its own floor", () => {
		expect(run(BarsXMode, "none").size).toBe(0)
	})

	it("modes without supportsNegativeMeasure get no floor override", () => {
		// Areas still clamp at zero; handing them a negative floor would drop
		// marks below a baseline their path builder doesn't draw.
		expect(AreasXMode.canvas.supportsNegativeMeasure).toBeFalsy()
		expect(run(AreasXMode, "all").size).toBe(0)
	})
})
