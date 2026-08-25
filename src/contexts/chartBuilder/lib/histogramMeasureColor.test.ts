import { describe, expect, it } from "vitest"

import { DEFAULT_AXIS_CONFIG, type ChannelConfigs } from "./channelConfig"
import { histogramMeasureColorDomain } from "./histogramMeasureColor"
import { emptyEncodings, type DatasetView, type Field } from "./types"

/** Histogram over `v` (x, quantitative, binned) faceted by `panel`.
 *  Two 0–20 panels, two bins (0–10 / 10–20):
 *    panel A counts [5, 3]  (total 8)
 *    panel B counts [4, 6]  (total 10)
 *  Pooled counts are [9, 9] — the legend/bars domain must top out at the
 *  largest PER-PANEL bin (6, panel B's tallest bar), never the pooled 9. */
const FIELDS: Field[] = [
	{ name: "v", inferredType: "quantitative" },
	{ name: "panel", inferredType: "categorical" },
]
const row = (v: number, panel: string) => ({ v: String(v), panel })
const ROWS = [
	...[1, 2, 3, 4, 5, 15, 16, 17].map((v) => row(v, "A")),
	...[1, 2, 3, 4, 11, 12, 13, 14, 15, 16].map((v) => row(v, "B")),
]
const view = (rows: Array<Record<string, string>>): DatasetView => ({
	id: "ds-1",
	name: "hist",
	filename: "hist.csv",
	fields: FIELDS,
	rows,
	createdAt: 0,
	versionId: "dv-1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

const encodings = (facet?: "facet" | "facetCol") => {
	const e = emptyEncodings()
	e.x = { field: "v" }
	e.hue = { field: null, measureSource: "count" }
	if (facet) e[facet] = { field: "panel" }
	return e
}

const configs = (
	mode: "count" | "density" = "count"
): ChannelConfigs => ({
	x: {
		...DEFAULT_AXIS_CONFIG,
		histogram: {
			enabled: true,
			binCount: 2,
			mode,
			labelMode: "range",
			showRug: false,
			rugColor: "#000000",
		},
	},
})

describe("histogramMeasureColorDomain (shared bars + legend seam)", () => {
	it("non-faceted: equals the full-dataset max bin count", () => {
		const dom = histogramMeasureColorDomain(
			view(ROWS),
			encodings(),
			configs(),
			{},
			{}
		)
		// Un-faceted, pooled counts [9, 9] ARE the drawn bars.
		expect(dom).toEqual({ min: 0, max: 9 })
	})

	it("wrap-faceted: tops out at the largest per-panel bin, not the pooled sum", () => {
		const dom = histogramMeasureColorDomain(
			view(ROWS),
			encodings("facet"),
			configs(),
			{},
			{}
		)
		expect(dom).toEqual({ min: 0, max: 6 })
	})

	it("grid-faceted (facetCol): same per-panel max", () => {
		const dom = histogramMeasureColorDomain(
			view(ROWS),
			encodings("facetCol"),
			configs(),
			{},
			{}
		)
		expect(dom).toEqual({ min: 0, max: 6 })
	})

	it("density mode: largest per-panel share with panel-local totals", () => {
		const dom = histogramMeasureColorDomain(
			view(ROWS),
			encodings("facet"),
			configs("density"),
			{},
			{}
		)!
		// Panel shares: A → 5/8, B → 6/10; A's wins.
		expect(dom.min).toBe(0)
		expect(dom.max).toBeCloseTo(5 / 8)
	})

	it("returns null when the chart isn't an active histogram", () => {
		// histogram.enabled absent → getChartMode never yields a histogram.
		expect(
			histogramMeasureColorDomain(view(ROWS), encodings(), {}, {}, {})
		).toBeNull()
	})
})
