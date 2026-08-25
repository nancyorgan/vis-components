import { describe, expect, it } from "vitest"
import type { Stack } from "../../lib/aggregators/stacks"
import { layoutSlices } from "./BarPlot"

// One category band at catPos=0, width=100. Slices: 2 hue × 2 pattern.
const stack: Stack = {
	category: "A",
	slices: [
		{ key: "r1|p1", value: 2, groupValues: { hue: "r1", pattern: "p1" } },
		{ key: "r1|p2", value: 3, groupValues: { hue: "r1", pattern: "p2" } },
		{ key: "r2|p1", value: 4, groupValues: { hue: "r2", pattern: "p1" } },
		{ key: "r2|p2", value: 1, groupValues: { hue: "r2", pattern: "p2" } },
	],
}

describe("layoutSlices", () => {
	it("group by hue, stack by pattern: 2 sub-bands, stacked within each", () => {
		const geo = layoutSlices(stack, [
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "stack" },
		], 0, 100, 2)
		const byKey = Object.fromEntries(geo.map((g) => [g.key, g]))
		expect(byKey["r1|p1"]).toMatchObject({ catPos: 0, catSize: 50, measureStart: 0, measureEnd: 2 })
		expect(byKey["r1|p2"]).toMatchObject({ catPos: 0, catSize: 50, measureStart: 2, measureEnd: 5 })
		expect(byKey["r2|p1"]).toMatchObject({ catPos: 50, catSize: 50, measureStart: 0, measureEnd: 4 })
		expect(byKey["r2|p2"]).toMatchObject({ catPos: 50, catSize: 50, measureStart: 4, measureEnd: 5 })
	})

	it("all-stack: full-width band, single cumulative column", () => {
		const geo = layoutSlices(stack, [
			{ channel: "hue", mode: "stack" },
			{ channel: "pattern", mode: "stack" },
		], 0, 100, 1)
		for (const g of geo) {
			expect(g.catPos).toBe(0)
			expect(g.catSize).toBe(100)
		}
		expect(geo.map((g) => g.measureEnd)).toEqual([2, 5, 9, 10])
	})

	it("all-group: 4 side-by-side sub-bands from baseline", () => {
		const geo = layoutSlices(stack, [
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "group" },
		], 0, 100, 4)
		expect(geo.map((g) => g.catPos)).toEqual([0, 25, 50, 75])
		expect(geo.every((g) => g.catSize === 25 && g.measureStart === 0)).toBe(true)
	})

	it("overlay pattern within a hue group: each slice from baseline", () => {
		const geo = layoutSlices(stack, [
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "overlay" },
		], 0, 100, 2)
		const byKey = Object.fromEntries(geo.map((g) => [g.key, g]))
		expect(byKey["r1|p1"]).toMatchObject({ measureStart: 0, measureEnd: 2 })
		expect(byKey["r1|p2"]).toMatchObject({ measureStart: 0, measureEnd: 3 })
	})

	it("stack + overlay MIXED in one leaf: everything cumulates (documented degradation)", () => {
		// The engine keys the measure axis on "any stack channel present"
		// (`hasStack`), so an overlay channel sharing a leaf with a stack
		// channel cumulates too — overlay degrades to stack in the mix. The
		// axis bound (`computeBarMeasureMax`) uses the SAME rule, so bars and
		// axis stay consistent. Pinned so any future change to this semantic
		// is deliberate and updates both places together.
		const geo = layoutSlices(stack, [
			{ channel: "hue", mode: "overlay" },
			{ channel: "pattern", mode: "stack" },
		], 0, 100, 1)
		// No group-mode channels → one full-width leaf, cumulative column
		// identical to all-stack.
		for (const g of geo) {
			expect(g.catPos).toBe(0)
			expect(g.catSize).toBe(100)
		}
		expect(geo.map((g) => g.measureEnd)).toEqual([2, 5, 9, 10])
	})

	it("no modes: single solid slice fills the band from baseline", () => {
		const solid: Stack = { category: "A", slices: [{ key: "", value: 7, groupValues: {} }] }
		const geo = layoutSlices(solid, [], 0, 100, 1)
		expect(geo[0]).toMatchObject({ catPos: 0, catSize: 100, measureStart: 0, measureEnd: 7 })
	})

	it("keeps distinct sub-bands when group values could collide under naive concat", () => {
		// Without a delimiter, hue"a"+pattern"bc" and hue"ab"+pattern"c" both → "abc".
		const collidey: Stack = {
			category: "A",
			slices: [
				{ key: "a|bc", value: 1, groupValues: { hue: "a", pattern: "bc" } },
				{ key: "ab|c", value: 1, groupValues: { hue: "ab", pattern: "c" } },
			],
		}
		const geo = layoutSlices(collidey, [
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "group" },
		], 0, 100, 2)
		const byKey = Object.fromEntries(geo.map((g) => [g.key, g]))
		// Two distinct leaves → two distinct sub-band positions, not merged into one.
		expect(byKey["a|bc"].catPos).not.toBe(byKey["ab|c"].catPos)
	})

	it("centers leaves when the category has fewer than the chart-wide max", () => {
		// 2 hue leaves but maxLeaves=4 → subBand=25, centerOffset=(100-2*25)/2=25.
		// Leaves sit at 25 and 50, centered within the 0..100 band.
		const geo = layoutSlices(stack, [
			{ channel: "hue", mode: "group" },
			{ channel: "pattern", mode: "stack" },
		], 0, 100, 4)
		const byKey = Object.fromEntries(geo.map((g) => [g.key, g]))
		expect(byKey["r1|p1"]).toMatchObject({ catPos: 25, catSize: 25 })
		expect(byKey["r1|p2"]).toMatchObject({ catPos: 25, catSize: 25 })
		expect(byKey["r2|p1"]).toMatchObject({ catPos: 50, catSize: 25 })
		expect(byKey["r2|p2"]).toMatchObject({ catPos: 50, catSize: 25 })
	})
})

// Regression guardrail: with only ONE stack channel mapped, the new
// per-channel composition engine must reproduce the exact pre-refactor
// single-channel layout. Band = [0,90] so sub-bands divide evenly by 3.
describe("single-channel regression guardrail", () => {
	const singleHue: Stack = {
		category: "A",
		slices: [
			{ key: "r1", value: 2, groupValues: { hue: "r1" } },
			{ key: "r2", value: 3, groupValues: { hue: "r2" } },
			{ key: "r3", value: 5, groupValues: { hue: "r3" } },
		],
	}

	it("stack: full-width band, single cumulative column (unchanged)", () => {
		// Single group channel in stack mode → no group-mode channels → one
		// leaf → the whole band, slices cumulative on the measure axis.
		const geo = layoutSlices(
			singleHue,
			[{ channel: "hue", mode: "stack" }],
			0,
			90,
			1,
		)
		for (const g of geo) {
			expect(g.catPos).toBe(0)
			expect(g.catSize).toBe(90)
		}
		expect(geo.map((g) => g.measureStart)).toEqual([0, 2, 5])
		expect(geo.map((g) => g.measureEnd)).toEqual([2, 5, 10])
	})

	it("group: three equal side-by-side sub-bands from baseline (unchanged)", () => {
		// One group-mode channel with 3 leaves → subBand = 90/3 = 30, no
		// centering (leaves === maxLeaves). Each slice sits from baseline.
		const geo = layoutSlices(
			singleHue,
			[{ channel: "hue", mode: "group" }],
			0,
			90,
			3,
		)
		expect(geo.map((g) => g.catPos)).toEqual([0, 30, 60])
		expect(geo.every((g) => g.catSize === 30)).toBe(true)
		expect(geo.map((g) => g.measureStart)).toEqual([0, 0, 0])
		expect(geo.map((g) => g.measureEnd)).toEqual([2, 3, 5])
	})

	it("overlay: full-width band, each slice from baseline (unchanged)", () => {
		// Single overlay channel → no group-mode channels → one leaf → full
		// band; overlay draws every slice from baseline (not cumulative).
		const geo = layoutSlices(
			singleHue,
			[{ channel: "hue", mode: "overlay" }],
			0,
			90,
			1,
		)
		for (const g of geo) {
			expect(g.catPos).toBe(0)
			expect(g.catSize).toBe(90)
		}
		expect(geo.map((g) => g.measureStart)).toEqual([0, 0, 0])
		expect(geo.map((g) => g.measureEnd)).toEqual([2, 3, 5])
	})
})

describe("layoutSlices — negative values", () => {
	// One category, one leaf, mixed signs in slice order.
	const mixedStack: Stack = {
		category: "A",
		slices: [
			{ key: "p1", value: 5, groupValues: { pattern: "p1" } },
			{ key: "p2", value: -2, groupValues: { pattern: "p2" } },
			{ key: "p3", value: 3, groupValues: { pattern: "p3" } },
			{ key: "p4", value: -4, groupValues: { pattern: "p4" } },
		],
	}

	it("stack: positives cumulate up and negatives down on separate ledgers", () => {
		const geo = layoutSlices(
			mixedStack,
			[{ channel: "pattern", mode: "stack" }],
			0,
			100,
			1
		)
		const byKey = Object.fromEntries(geo.map((g) => [g.key, g]))
		// Positive column: 0→5 then 5→8. Negative column: 0→-2 then -2→-6.
		// Neither eats into the other.
		expect(byKey.p1).toMatchObject({ measureStart: 0, measureEnd: 5 })
		expect(byKey.p2).toMatchObject({ measureStart: 0, measureEnd: -2 })
		expect(byKey.p3).toMatchObject({ measureStart: 5, measureEnd: 8 })
		expect(byKey.p4).toMatchObject({ measureStart: -2, measureEnd: -6 })
	})

	it("group: every slice runs from the zero baseline to its own value", () => {
		const geo = layoutSlices(
			mixedStack,
			[{ channel: "pattern", mode: "group" }],
			0,
			100,
			4
		)
		expect(geo.every((g) => g.measureStart === 0)).toBe(true)
		expect(geo.map((g) => g.measureEnd)).toEqual([5, -2, 3, -4])
	})
})
