import { describe, expect, it } from "vitest"
import type { Stack } from "../../lib/aggregators/stacks"
import { computeBarMeasureMax, computeBarMeasureMin } from "./BarPlot"

describe("computeBarMeasureMax", () => {
	const stacks: Stack[] = [
		{
			category: "A",
			slices: [
				{ key: "r1|p1", value: 3, groupValues: { hue: "r1", pattern: "p1" } },
				{ key: "r1|p2", value: 4, groupValues: { hue: "r1", pattern: "p2" } },
				{ key: "r2|p1", value: 5, groupValues: { hue: "r2", pattern: "p1" } },
			],
		},
	]

	it("all-stack: sums every slice in the category (one leaf)", () => {
		expect(
			computeBarMeasureMax(stacks, [
				{ channel: "hue", mode: "stack" },
				{ channel: "pattern", mode: "stack" },
			]),
		).toBe(12)
	})

	it("group by hue, stack by pattern: max stacked total per hue leaf", () => {
		expect(
			computeBarMeasureMax(stacks, [
				{ channel: "hue", mode: "group" },
				{ channel: "pattern", mode: "stack" },
			]),
		).toBe(7)
	})

	it("all-group: max single slice (each slice its own leaf)", () => {
		expect(
			computeBarMeasureMax(stacks, [
				{ channel: "hue", mode: "group" },
				{ channel: "pattern", mode: "group" },
			]),
		).toBe(5)
	})

	it("no modes (single solid bar): sums the category", () => {
		const solid: Stack[] = [
			{ category: "A", slices: [{ key: "", value: 9, groupValues: {} }] },
		]
		expect(computeBarMeasureMax(solid, [])).toBe(9)
	})

	it("pure overlay: max single slice across the category (no summing)", () => {
		expect(
			computeBarMeasureMax(stacks, [{ channel: "hue", mode: "overlay" }]),
		).toBe(5)
	})

	it("empty input returns the floor of 1", () => {
		expect(computeBarMeasureMax([], [])).toBe(1)
	})
})

describe("computeBarMeasureMin", () => {
	// One leaf per hue, each mixing a positive and a negative slice.
	const mixed: Stack[] = [
		{
			category: "A",
			slices: [
				{ key: "r1|p1", value: 6, groupValues: { hue: "r1", pattern: "p1" } },
				{ key: "r1|p2", value: -2, groupValues: { hue: "r1", pattern: "p2" } },
				{ key: "r2|p1", value: -3, groupValues: { hue: "r2", pattern: "p1" } },
				{ key: "r2|p2", value: -4, groupValues: { hue: "r2", pattern: "p2" } },
			],
		},
	]

	it("returns 0 for all-positive data — the floor bars have always had", () => {
		const allPositive: Stack[] = [
			{
				category: "A",
				slices: [
					{ key: "r1", value: 3, groupValues: { hue: "r1" } },
					{ key: "r2", value: 7, groupValues: { hue: "r2" } },
				],
			},
		]
		expect(
			computeBarMeasureMin(allPositive, [{ channel: "hue", mode: "group" }])
		).toBe(0)
	})

	it("group: the single most-negative slice sets the floor", () => {
		expect(
			computeBarMeasureMin(mixed, [
				{ channel: "hue", mode: "group" },
				{ channel: "pattern", mode: "group" },
			])
		).toBe(-4)
	})

	it("stack: negative slices in a leaf accumulate downward", () => {
		// Leaf r2 stacks -3 and -4 → -7; leaf r1's lone -2 doesn't reach it.
		expect(
			computeBarMeasureMin(mixed, [
				{ channel: "hue", mode: "group" },
				{ channel: "pattern", mode: "stack" },
			])
		).toBe(-7)
	})

	it("never returns a positive floor", () => {
		expect(
			computeBarMeasureMin(mixed, [
				{ channel: "hue", mode: "stack" },
				{ channel: "pattern", mode: "stack" },
			])
		).toBeLessThanOrEqual(0)
	})

	it("max ignores negatives so a mixed-sign stack isn't clipped", () => {
		// Leaf r1 nets 6 + -2 = 4, but its positive column still reaches 6 —
		// summing both signs together would clip the bar at 4.
		expect(
			computeBarMeasureMax(mixed, [
				{ channel: "hue", mode: "group" },
				{ channel: "pattern", mode: "stack" },
			])
		).toBe(6)
	})
})

describe("computeBarMeasureMax — all-negative data", () => {
	const negative: Stack[] = [
		{
			category: "A",
			slices: [
				{ key: "r1", value: -3, groupValues: { hue: "r1" } },
				{ key: "r2", value: -8, groupValues: { hue: "r2" } },
			],
		},
	]
	const modes = [{ channel: "hue", mode: "group" } as const]

	it("tops the axis out at the zero baseline instead of the usual floor of 1", () => {
		expect(computeBarMeasureMax(negative, [...modes])).toBe(0)
		expect(computeBarMeasureMin(negative, [...modes])).toBe(-8)
	})

	it("keeps the floor of 1 when there is nothing to draw at all", () => {
		expect(computeBarMeasureMax([], [...modes])).toBe(1)
	})
})
