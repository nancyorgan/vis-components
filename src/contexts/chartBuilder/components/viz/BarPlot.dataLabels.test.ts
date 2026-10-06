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

	it("carries the RAW labelValue alongside the formatted label so text-color / position rules can compare numerically", () => {
		// Regression: bar anchors used to omit `labelValue`, so
		// `resolveLabelFill` saw `undefined` and no conditional rule ever fired
		// on bar charts (while scatter / lollipop labels, which go through the
		// per-row path, worked).
		const anchors = buildBarAnchors({
			aggregation: sparseAggregation as any,
			categoryScale,
			measureScale,
			modes: [],
			decimals: null,
		})
		expect(anchors.find((a) => a.key === "A|")?.labelValue).toBe("call-out")
		expect(anchors.find((a) => a.key === "B|")?.labelValue).toBe(20)
	})
})

describe("buildBarAnchors — negative slices", () => {
	// One category, one positive and one negative slice, grouped so each
	// runs from the zero baseline in its own direction.
	const mixed = [
		{
			category: "A",
			slices: [
				{ key: "up", groupValues: { hue: "up" }, value: 20 },
				{ key: "down", groupValues: { hue: "down" }, value: -20 },
			],
		},
	]
	const mixedAggregation = {
		...aggregation,
		stacks: mixed,
		categories: ["A"],
		measureMin: -100,
	}
	// Domain now spans both signs: measureScale(0) = 200 (mid-plot),
	// measureScale(20) = 160 (above), measureScale(-20) = 240 (below).
	const divergingScale = scaleLinear().domain([-100, 100]).range([400, 0])
	const anchorsAt = (position: "center" | "inside-base" | "inside-end" | "outside-end") =>
		Object.fromEntries(
			buildBarAnchors({
				aggregation: mixedAggregation as any,
				categoryScale: scaleBand<string>().domain(["A"]).range([0, 100]).padding(0),
				measureScale: divergingScale,
				modes: [{ channel: "hue", mode: "group" }],
				decimals: null,
				position,
				outsideOffsetPx: 4,
			}).map((a) => [a.key, a])
		)

	it("centers each label inside its own bar, above or below the baseline", () => {
		const at = anchorsAt("center")
		expect(at["A|up"].cy).toBeCloseTo(180, 5) // midpoint of 200→160
		expect(at["A|down"].cy).toBeCloseTo(220, 5) // midpoint of 200→240
	})

	it("inside-base sits just inside the baseline on the bar's own side", () => {
		const at = anchorsAt("inside-base")
		// Positive bar grows up, so "inside" is above the baseline; the
		// negative bar's inside is below it.
		expect(at["A|up"].cy).toBeCloseTo(196, 5)
		expect(at["A|down"].cy).toBeCloseTo(204, 5)
	})

	it("outside-end clears the far tip in the direction the bar points", () => {
		const at = anchorsAt("outside-end")
		expect(at["A|up"].cy).toBeCloseTo(156, 5) // above the +20 tip
		expect(at["A|down"].cy).toBeCloseTo(244, 5) // below the -20 tip
	})
})

describe("buildBarAnchors — multi-field label rows (labelFields)", () => {
	const rows = [
		{ cat: "A", val: "10", region: "north", note: "n-a" },
		{ cat: "A", val: "30", region: "south", note: "s-a" },
		{ cat: "B", val: "20", region: "north", note: "" },
		{ cat: "B", val: "40", region: "south", note: "s-b" },
	]
	const encodings = { x: { field: "cat" }, length: { field: "val" }, hue: { field: "region" } }

	it("carries a synthetic row per slice: category, group values, measure, and each label field aggregated", () => {
		const anchors = buildBarAnchors({
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			modes: [{ channel: "hue", mode: "stack" }],
			decimals: null,
			labelFields: ["val", "region", "note"],
			encodings: encodings as any,
			rows,
		})
		const aSouth = anchors.find((a) => a.key === "A|south")
		expect(aSouth?.row).toEqual({
			cat: "A",
			region: "south",
			val: 30,
			note: "s-a",
		})
		// A blank text cell aggregates to nothing (undefined), never "".
		expect(anchors.find((a) => a.key === "B|north")?.row?.note).toBeUndefined()
	})

	it("omits the row when no label fields are requested (single-field anchors stay pre-formatted)", () => {
		const anchors = buildBarAnchors({
			aggregation: aggregation as any,
			categoryScale,
			measureScale,
			modes: [{ channel: "hue", mode: "stack" }],
			decimals: null,
			encodings: encodings as any,
			rows,
		})
		expect(anchors.every((a) => a.row === undefined)).toBe(true)
	})
})

/** "Which labels" scope — the series identity and in-series rank each bar
 *  anchor hands the label layer. The CCI shape: x = Setting, hue = Setting
 *  (purely cosmetic — it IS the category), brightness = level, grouped.
 *  Before the scope existed the layer used the hue value as the series, so
 *  "First" labeled the leftmost bar of EVERY setting instead of every bar
 *  of the FIRST setting. */
describe("buildBarAnchors — label series + rank per scope", () => {
	const settings = ["Home", "Away"]
	const levels = ["a", "b", "c"]
	const groupedStacks = settings.map((s) => ({
		category: s,
		slices: levels.map((l) => ({
			key: `${s}|${l}`,
			groupValues: { hue: s, brightness: l },
			value: 10,
		})),
	}))
	const groupedAgg = {
		...aggregation,
		categoryField: "Setting",
		stacks: groupedStacks,
		categories: settings,
	}
	const groupedScale = scaleBand<string>()
		.domain(settings)
		.range([0, 200])
		.padding(0)
	const modes = [
		{ channel: "hue" as const, mode: "group" as const },
		{ channel: "brightness" as const, mode: "group" as const },
	]
	const encodings = {
		x: { field: "Setting" },
		length: { field: "val" },
		hue: { field: "Setting" },
		brightness: { field: "level" },
	}
	const build = (scope: "series" | "group" | "stack" | undefined) =>
		buildBarAnchors({
			 
			aggregation: groupedAgg as any,
			categoryScale: groupedScale,
			measureScale,
			modes,
			decimals: null,
			 
			encodings: encodings as any,
			labelPointsScope: scope,
		})
	const find = (anchors: ReturnType<typeof build>, key: string) =>
		anchors.find((a) => a.key === key)

	it("'series' (default) drops the channel mapped to the category field — the level is the series", () => {
		const anchors = build(undefined)
		// Home|a and Away|a share a series (the level), ranked by band position.
		expect(find(anchors, "Home|Home|a")?.series).toBe(
			find(anchors, "Away|Away|a")?.series
		)
		expect(find(anchors, "Home|Home|a")?.series).not.toBe(
			find(anchors, "Home|Home|b")?.series
		)
		expect(find(anchors, "Home|Home|a")?.rank).toBeLessThan(
			find(anchors, "Away|Away|a")?.rank ?? -Infinity
		)
	})

	it("'group' keys on the category so every bar of a band is one series, ranked by sub-band", () => {
		const anchors = build("group")
		const a = find(anchors, "Home|Home|a")
		const c = find(anchors, "Home|Home|c")
		expect(a?.series).toBe(c?.series)
		expect(a?.series).not.toBe(find(anchors, "Away|Away|a")?.series)
		expect(a?.rank).toBe(0)
		expect(c?.rank).toBe(2)
	})

	it("'stack' keys on the physical bar, ranked from the baseline", () => {
		const stackedStacks = settings.map((s) => ({
			category: s,
			slices: levels.map((l) => ({
				key: l,
				groupValues: { hue: l },
				value: 10,
			})),
		}))
		const anchors = buildBarAnchors({
			 
			aggregation: { ...groupedAgg, stacks: stackedStacks } as any,
			categoryScale: groupedScale,
			measureScale,
			modes: [{ channel: "hue", mode: "stack" }],
			decimals: null,
			labelPointsScope: "stack",
		})
		const base = find(anchors, "Home|a")
		const top = find(anchors, "Home|c")
		expect(base?.series).toBe(top?.series)
		expect(base?.series).not.toBe(find(anchors, "Away|a")?.series)
		expect(base?.rank).toBe(0)
		expect(top?.rank).toBe(2)
	})

	it("a scope whose channel isn't mapped falls back to 'series'", () => {
		// Grouped bars have no stack channel: "stack" reads as "series".
		const stackScoped = build("stack")
		const series = build("series")
		for (const a of stackScoped) {
			const ref = find(series, a.key)
			expect(a.series).toBe(ref?.series)
			expect(a.rank).toBe(ref?.rank)
		}
	})

	it("a mirrored (negative) layer is its own stack side", () => {
		const diverging = [
			{
				category: "Home",
				slices: [
					{ key: "pos", groupValues: { hue: "pos" }, value: 10 },
					{ key: "neg", groupValues: { hue: "neg" }, value: -10 },
				],
			},
		]
		const anchors = buildBarAnchors({
			 
			aggregation: { ...groupedAgg, stacks: diverging, measureMin: -100 } as any,
			categoryScale: groupedScale,
			measureScale: scaleLinear().domain([-100, 100]).range([400, 0]),
			modes: [{ channel: "hue", mode: "stack" }],
			decimals: null,
			labelPointsScope: "stack",
		})
		expect(find(anchors, "Home|pos")?.series).not.toBe(
			find(anchors, "Home|neg")?.series
		)
		expect(find(anchors, "Home|pos")?.rank).toBe(0)
		expect(find(anchors, "Home|neg")?.rank).toBe(0)
	})
})
