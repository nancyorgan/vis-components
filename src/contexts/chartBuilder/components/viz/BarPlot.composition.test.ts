import { scaleBand, scaleLinear } from "d3-scale"
import { describe, expect, it } from "vitest"

import { buildBarAnchors } from "./BarPlot"

/** Wiring test for per-channel composition: `buildBarAnchors` now sources its
 *  geometry from the shared `layoutSlices` engine, so it must honor a MIXED
 *  layout — group by hue (outer, category axis) while stacking by pattern
 *  (inner, measure axis). We drive a single-category aggregation with
 *  2 hue x 2 pattern slices and read back the anchors' cx / cy to prove the
 *  grouped-outer / stacked-inner wiring reaches the anchors. Before wiring,
 *  the old `stackMode` param couldn't express two channels at all, so this
 *  test would not even compile. */

const cats = ["A"]
// One category, 2 hue x 2 pattern. Slices in encounter order.
const stacks = [
	{
		category: "A",
		slices: [
			{ key: "r1|p1", value: 2, groupValues: { hue: "r1", pattern: "p1" } },
			{ key: "r1|p2", value: 3, groupValues: { hue: "r1", pattern: "p2" } },
			{ key: "r2|p1", value: 4, groupValues: { hue: "r2", pattern: "p1" } },
			{ key: "r2|p2", value: 1, groupValues: { hue: "r2", pattern: "p2" } },
		],
	},
]

const aggregation = {
	kind: "ok" as const,
	mode: "bars-x" as const,
	isVertical: true,
	categoryField: "cat",
	categoryType: "categorical" as const,
	lengthField: "val",
	lengthType: "quantitative" as const,
	stacks,
	categories: cats,
	measureMin: 0,
	// Largest stacked leaf total: r1 stacks 2+3=5, r2 stacks 4+1=5 → 5.
	measureMax: 5,
}

// Vertical layout: x = category band [0,100], y = measure (inverted).
const categoryScale = scaleBand<string>().domain(cats).range([0, 100]).padding(0)
// y range [400, 0] → measureScale(0) = 400 (bottom), measureScale(5) = 0 (top).
const measureScale = scaleLinear().domain([0, 5]).range([400, 0])

describe("buildBarAnchors — grouped-outer (hue) / stacked-inner (pattern)", () => {
	const anchors = buildBarAnchors({
		 
		aggregation: aggregation as any,
		categoryScale,
		measureScale,
		modes: [
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "stack" },
		],
		decimals: null,
	})
	const byKey = Object.fromEntries(anchors.map((a) => [a.key, a]))
	const r1p1 = byKey["A|r1|p1"]
	const r1p2 = byKey["A|r1|p2"]
	const r2p1 = byKey["A|r2|p1"]
	const r2p2 = byKey["A|r2|p2"]

	it("emits one anchor per slice", () => {
		expect(anchors).toHaveLength(4)
		expect(r1p1 && r1p2 && r2p1 && r2p2).toBeTruthy()
	})

	it("groups by hue on the category axis: two distinct sub-band centers", () => {
		// maxLeaves=2 → subBand=50. r1 leaf catPos=0 → center 25; r2 leaf
		// catPos=50 → center 75. Vertical bars put catCenter on cx.
		expect(r1p1.cx).toBeCloseTo(25, 5)
		expect(r1p2.cx).toBeCloseTo(25, 5)
		expect(r2p1.cx).toBeCloseTo(75, 5)
		expect(r2p2.cx).toBeCloseTo(75, 5)
		// The two hue groups occupy distinct x centers; the two pattern
		// slices WITHIN a hue share their hue's center.
		expect(r1p1.cx).toBe(r1p2.cx)
		expect(r2p1.cx).toBe(r2p2.cx)
		expect(r1p1.cx).not.toBe(r2p1.cx)
	})

	it("stacks by pattern on the measure axis within each hue group", () => {
		// r1: p1 = [0,2] mid 1 → measureScale(1) = 320;
		//     p2 = [2,5] mid 3.5 → measureScale(3.5) = 120.
		expect(r1p1.cy).toBeCloseTo(320, 5)
		expect(r1p2.cy).toBeCloseTo(120, 5)
		// r2: p1 = [0,4] mid 2 → 240; p2 = [4,5] mid 4.5 → 40.
		expect(r2p1.cy).toBeCloseTo(240, 5)
		expect(r2p2.cy).toBeCloseTo(40, 5)
		// Distinct cy within a hue (they're stacked, not overlaid), and p2
		// sits ABOVE p1 for vertical bars (smaller y = higher up) because it
		// occupies the upper segment of the cumulative stack.
		expect(r1p2.cy).not.toBe(r1p1.cy)
		expect(r1p2.cy).toBeLessThan(r1p1.cy)
		expect(r2p2.cy).toBeLessThan(r2p1.cy)
	})
})

describe("buildBarAnchors — horizontal (bars-y) mixed composition", () => {
	// Same slices, horizontal orientation: the category band lives on the
	// Y axis and the measure grows rightward on X, so the axis roles swap —
	// hue sub-band centers land on cy, stacked measure midpoints on cx.
	const horizontal = {
		...aggregation,
		mode: "bars-y" as const,
		isVertical: false,
	}
	// y = category band [0,100]; x = measure, 0 at the left edge.
	const catScaleY = scaleBand<string>().domain(cats).range([0, 100]).padding(0)
	const measureScaleX = scaleLinear().domain([0, 5]).range([0, 400])

	const anchors = buildBarAnchors({
		 
		aggregation: horizontal as any,
		categoryScale: catScaleY,
		measureScale: measureScaleX,
		modes: [
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "stack" },
		],
		decimals: null,
	})
	const byKey = Object.fromEntries(anchors.map((a) => [a.key, a]))

	it("groups by hue on cy: two distinct sub-band centers", () => {
		expect(byKey["A|r1|p1"].cy).toBeCloseTo(25, 5)
		expect(byKey["A|r1|p2"].cy).toBeCloseTo(25, 5)
		expect(byKey["A|r2|p1"].cy).toBeCloseTo(75, 5)
		expect(byKey["A|r2|p2"].cy).toBeCloseTo(75, 5)
	})

	it("stacks by pattern on cx within each hue group", () => {
		// r1: p1 = [0,2] mid 1 → 80; p2 = [2,5] mid 3.5 → 280.
		expect(byKey["A|r1|p1"].cx).toBeCloseTo(80, 5)
		expect(byKey["A|r1|p2"].cx).toBeCloseTo(280, 5)
		// r2: p1 = [0,4] mid 2 → 160; p2 = [4,5] mid 4.5 → 360.
		expect(byKey["A|r2|p1"].cx).toBeCloseTo(160, 5)
		expect(byKey["A|r2|p2"].cx).toBeCloseTo(360, 5)
	})
})
