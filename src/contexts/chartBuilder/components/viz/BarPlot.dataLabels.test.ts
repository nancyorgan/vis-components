import { scaleBand, scaleLinear } from "d3-scale"
import { describe, expect, it } from "vitest"

import { buildBarAnchors } from "./BarPlot"

/** Phase-1 evidence test for "data labels not respecting stack/overlay
 *  in Hue". Anchors are pure logic — no React or Jotai — so we can
 *  drive `buildBarAnchors` directly with synthetic stacks and read back
 *  the label positions in stack vs. overlay mode. The position math
 *  diverges between the two modes; if a label is at the same place in
 *  both, the bug the user reported is back. */

const cats = ["A", "B"]
// Two stacks per category. Slices are emitted in the order the user's
// data introduces them (the aggregator preserves encounter order); the
// test pins them so we can reason about specific anchor positions.
const stacks = [
	{
		category: "A",
		slices: [
			{ key: "north", groupValues: { hue: "north" }, value: 10 },
			{ key: "south", groupValues: { hue: "south" }, value: 30 },
		],
	},
	{
		category: "B",
		slices: [
			{ key: "north", groupValues: { hue: "north" }, value: 20 },
			{ key: "south", groupValues: { hue: "south" }, value: 40 },
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
	measureMax: 100,
}

// Vertical layout: x=category band, y=measure (inverted: y=0 at top).
const categoryScale = scaleBand<string>()
	.domain(cats)
	.range([0, 200])
	.padding(0)
// y range [400, 0] → measureScale(0) = 400 (bottom), measureScale(100) = 0 (top).
const measureScale = scaleLinear().domain([0, 100]).range([400, 0])

describe("buildBarAnchors — stack vs. overlay mode positions", () => {
	it("STACK mode places labels at cumulative slice midpoints (north below, south above)", () => {
		// In stack mode, each slice's measurePoint = midpoint of [runningTotal,
		// runningTotal + value]. For category A:
		//   north: [0, 10]   → mid 5  → measureScale(5)  = 380
		//   south: [10, 40]  → mid 25 → measureScale(25) = 300
		const anchors = buildBarAnchors({
			 
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			modes: [{ channel: "hue", mode: "stack" }],
			decimals: null,
		})
		const aNorth = anchors.find((a) => a.key === "A|north")
		const aSouth = anchors.find((a) => a.key === "A|south")
		expect(aNorth?.cy).toBeCloseTo(380, 0) // y of midpoint 5
		expect(aSouth?.cy).toBeCloseTo(300, 0) // y of midpoint 25
		// south is ABOVE north in y-coords (smaller y) — that's the
		// stacking signature. If they collapse to the same y, labels
		// stopped respecting stack.
		expect(aSouth?.cy).toBeLessThan(aNorth?.cy ?? 0)
	})

	it("OVERLAY mode places labels at each slice's own midpoint (independent of running total)", () => {
		// In overlay mode, sliceStart=0 for every slice → midpoint =
		// value/2. For category A:
		//   north: [0, 10] → mid 5  → measureScale(5)  = 380
		//   south: [0, 30] → mid 15 → measureScale(15) = 340
		const anchors = buildBarAnchors({
			 
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			modes: [{ channel: "hue", mode: "overlay" }],
			decimals: null,
		})
		const aNorth = anchors.find((a) => a.key === "A|north")
		const aSouth = anchors.find((a) => a.key === "A|south")
		expect(aNorth?.cy).toBeCloseTo(380, 0)
		expect(aSouth?.cy).toBeCloseTo(340, 0)
	})

	it("the same slice key has DIFFERENT y in stack vs overlay (proves the mode toggle reaches the anchors)", () => {
		// Direct comparison: south slice in category A.
		//   stack:   mid 25 → y 300
		//   overlay: mid 15 → y 340
		// Same data, different mode → different y. Without this, the
		// labels would sit on top of the same pixel regardless of mode
		// — the user's "not respecting stack/overlay" report.
		 
		const stackArgs = {
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			decimals: null,
		}
		const stack = buildBarAnchors({
			...stackArgs,
			modes: [{ channel: "hue", mode: "stack" }],
		})
		const overlay = buildBarAnchors({
			...stackArgs,
			modes: [{ channel: "hue", mode: "overlay" }],
		})
		const stackSouth = stack.find((a) => a.key === "A|south")?.cy ?? 0
		const overlaySouth = overlay.find((a) => a.key === "A|south")?.cy ?? 0
		expect(stackSouth).not.toBe(overlaySouth)
	})
})

describe("buildBarAnchors — sparse value column (valueFieldMapped)", () => {
	// A mapped value column is authoritative: slices where it's blank get NO
	// label — sparse columns are the mechanism for labeling one arbitrary
	// point, so blanks mean "do not fill in this spot", never "show the
	// measure instead".
	const sparseStacks = [
		{
			category: "A",
			slices: [
				{ key: "", groupValues: {}, value: 10, textValue: "call-out" },
			],
		},
		{
			category: "B",
			slices: [{ key: "", groupValues: {}, value: 20 }], // label column blank
		},
	]
	const sparseAggregation = {
		...aggregation,
		stacks: sparseStacks,
	}

	it("with valueFieldMapped, a slice without textValue gets a null label (no measure fallback)", () => {
		const anchors = buildBarAnchors({
			aggregation: sparseAggregation as any,
			categoryScale,
			measureScale,
			modes: [],
			decimals: null,
			valueFieldMapped: true,
		})
		expect(anchors.find((a) => a.key === "A|")?.label).toBe("call-out")
		expect(anchors.find((a) => a.key === "B|")?.label).toBeNull()
	})

	it("without valueFieldMapped, the measure fallback still applies (labels show slice.value)", () => {
		const anchors = buildBarAnchors({
			aggregation: sparseAggregation as any,
			categoryScale,
			measureScale,
			modes: [],
			decimals: null,
		})
		expect(anchors.find((a) => a.key === "A|")?.label).toBe("call-out")
		expect(anchors.find((a) => a.key === "B|")?.label).toBe("20")
	})
})
