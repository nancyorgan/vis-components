import { describe, expect, it } from "vitest"

import { buildPieAnchors } from "./PiePlot"

/** Pie data-label anchors are pure polar geometry, so we drive
 *  `buildPieAnchors` directly with a synthetic stack and read back where
 *  each slice's label lands. These tests pin the two polar knobs exposed in
 *  the Data Labels panel — `labelRadiusPct` (distance from center) and
 *  `labelAngleDeg` (angular nudge) — so a regression in the wiring or the
 *  d3 arc convention shows up here instead of only on screen. */

const CENTER = { stackKey: "A", cx: 100, cy: 100 }
const PIE_RADIUS = 100

// One pie, four equal slices → each spans a quarter turn. Equal values keep
// the midpoint angles at the obvious 45°/135°/225°/315° marks.
const stacks = [
	{
		category: "A",
		slices: [
			{ key: "n", groupValues: { hue: "n" }, value: 1 },
			{ key: "e", groupValues: { hue: "e" }, value: 1 },
			{ key: "s", groupValues: { hue: "s" }, value: 1 },
			{ key: "w", groupValues: { hue: "w" }, value: 1 },
		],
	},
]

const baseArgs = {
	 
	stacks: stacks as any,
	pieCenters: [CENTER],
	pieRadius: PIE_RADIUS,
	measureField: "val",
	categoryField: "cat",
	decimals: null,
}

const distFromCenter = (a: { cx: number; cy: number }) =>
	Math.hypot(a.cx - CENTER.cx, a.cy - CENTER.cy)

describe("buildPieAnchors — polar label placement", () => {
	it("defaults to the pie border (100% of the radius) when no distance is given", () => {
		const anchors = buildPieAnchors(baseArgs)
		// Every label sits the same distance out regardless of slice angle.
		anchors.forEach((a) => expect(distFromCenter(a)).toBeCloseTo(100, 1))
	})

	it("labelRadiusPct scales the distance from center (100% lands on the rim, >100% outside)", () => {
		const onRim = buildPieAnchors({ ...baseArgs, labelRadiusPct: 100 })
		onRim.forEach((a) => expect(distFromCenter(a)).toBeCloseTo(100, 1))

		const outside = buildPieAnchors({ ...baseArgs, labelRadiusPct: 130 })
		outside.forEach((a) => expect(distFromCenter(a)).toBeCloseTo(130, 1))
	})

	it("labelAngleDeg rotates every label off its slice midpoint without changing its distance", () => {
		const base = buildPieAnchors({ ...baseArgs, labelRadiusPct: 100 })
		const rotated = buildPieAnchors({
			...baseArgs,
			labelRadiusPct: 100,
			labelAngleDeg: 90,
		})
		// A 90° (quarter-turn) nudge maps each slice onto the next slice's
		// original midpoint — same set of positions, shifted by one.
		const baseFirst = base[0]
		const rotatedFirst = rotated[0]
		expect(distFromCenter(rotatedFirst)).toBeCloseTo(100, 1)
		// The first label moved (it's no longer where it was at 0°)...
		expect(rotatedFirst.cy).not.toBeCloseTo(baseFirst.cy, 1)
		// ...and landed on the second slice's original midpoint.
		expect(rotatedFirst.cx).toBeCloseTo(base[1].cx, 1)
		expect(rotatedFirst.cy).toBeCloseTo(base[1].cy, 1)
	})
})

describe("buildPieAnchors — size aggregation", () => {
	// Single-pie mode (incl. faceted single pies) passes categoryField=null —
	// all rows pool into one pie and slices are matched by group values alone.
	// Regression guard: this used to be skipped entirely (the size aggregation
	// was gated on categoryField), so every label fell back to the default
	// font size.
	const singlePieStack = [
		{
			category: "__single__",
			slices: [
				{ key: "n", groupValues: { hue: "north" }, value: 1 },
				{ key: "s", groupValues: { hue: "south" }, value: 1 },
			],
		},
	]
	const rows = [
		{ region: "north", count: 10 },
		{ region: "north", count: 5 },
		{ region: "south", count: 30 },
	]

	it("aggregates the size field per slice when categoryField is null (single pie)", () => {
		const anchors = buildPieAnchors({
			 
			stacks: singlePieStack as any,
			pieCenters: [{ stackKey: null, cx: 100, cy: 100 }],
			pieRadius: PIE_RADIUS,
			measureField: "val",
			categoryField: null,
			decimals: null,
			sizeField: "count",
			 
			encodings: { hue: { field: "region" } } as any,
			rows,
		})
		const north = anchors.find((a) => a.key === "__single__|n")
		const south = anchors.find((a) => a.key === "__single__|s")
		// north sums its two rows (10 + 5), south its one (30) — distinct per
		// slice, which is the whole point of a size encoding.
		expect(north?.sizeValue).toBe(15)
		expect(south?.sizeValue).toBe(30)
	})
})
