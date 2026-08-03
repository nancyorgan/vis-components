import { scaleBand, scaleLinear } from "d3-scale"
import { describe, expect, it } from "vitest"

import { buildAreaAnchors } from "./AreaPlot"

/** Companion to BarPlot.dataLabels.test.ts. AreaPlot was the place the
 *  user actually saw "labels not respecting stack/overlay" — bars had
 *  always passed `stackMode` through, but areas didn't have a per-row
 *  anchor builder until recently. This test pins the AreaPlot anchor
 *  positions in stack vs. overlay so a regression flips loudly. */

const stacks = [
	{
		category: "1",
		slices: [
			{ key: "A", groupValues: { hue: "A" }, value: 10 },
			{ key: "B", groupValues: { hue: "B" }, value: 30 },
		],
	},
	{
		category: "2",
		slices: [
			{ key: "A", groupValues: { hue: "A" }, value: 20 },
			{ key: "B", groupValues: { hue: "B" }, value: 40 },
		],
	},
]

const aggregation = {
	kind: "ok" as const,
	mode: "areas-x" as const,
	isVertical: true,
	categoryField: "month",
	categoryType: "quantitative" as const,
	measureField: "val",
	measureType: "quantitative" as const,
	stacks,
	scaleCategories: ["1", "2"],
	categories: ["1", "2"],
	measureMin: 0,
	measureMax: 100,
}

// Areas-x: x-axis is the category axis. Use a band scale (mirrors what
// AreaPlot does for ordinal-string categories) so anchor `px` lookups
// resolve to a known position.
const categoryScale = scaleBand<string>().domain(["1", "2"]).range([0, 200])
const measureScale = scaleLinear().domain([0, 100]).range([400, 0])

describe("buildAreaAnchors — stack vs. overlay mode positions", () => {
	it("STACK mode: layer B sits ABOVE layer A in pixel y (cumulative tops)", () => {
		// Stack: per category, B's top = A.value + B.value.
		// Category 1: A top=10 → cy=measureScale(10)=360. B top=40 → cy=240.
		// Category 2: A top=20 → cy=320. B top=60 → cy=160.
		const anchors = buildAreaAnchors({
			 
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			stackMode: "stack",
			decimals: null,
		})
		const a1 = anchors.find((a) => a.key === "1|A")?.cy ?? 0
		const b1 = anchors.find((a) => a.key === "1|B")?.cy ?? 0
		expect(a1).toBeCloseTo(360, 0)
		expect(b1).toBeCloseTo(240, 0)
		// B above A in stack mode = smaller cy (svg y origin top-left).
		expect(b1).toBeLessThan(a1)
	})

	it("OVERLAY mode: each layer's top = its own value (independent of others)", () => {
		// Overlay: top = 0 + value, so cy = measureScale(value).
		// Category 1: A → cy=measureScale(10)=360. B → cy=measureScale(30)=280.
		const anchors = buildAreaAnchors({
			 
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			stackMode: "overlay",
			decimals: null,
		})
		const a1 = anchors.find((a) => a.key === "1|A")?.cy ?? 0
		const b1 = anchors.find((a) => a.key === "1|B")?.cy ?? 0
		expect(a1).toBeCloseTo(360, 0)
		expect(b1).toBeCloseTo(280, 0)
	})

	it("the SAME slice key has different cy in stack vs overlay (proves the mode toggle reaches the anchors)", () => {
		// Layer B in category 1:
		//   stack:   top 40 → cy 240
		//   overlay: top 30 → cy 280
		 
		const args = {
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			decimals: null,
		}
		const stack = buildAreaAnchors({ ...args, stackMode: "stack" })
		const overlay = buildAreaAnchors({ ...args, stackMode: "overlay" })
		const stackB1 = stack.find((a) => a.key === "1|B")?.cy ?? 0
		const overlayB1 = overlay.find((a) => a.key === "1|B")?.cy ?? 0
		expect(stackB1).not.toBe(overlayB1)
	})
})
