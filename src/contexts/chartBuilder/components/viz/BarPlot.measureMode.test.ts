import { describe, expect, it } from "vitest"
import type { Stack } from "../../lib/aggregators/stacks"
import { computeBarMeasureMax } from "./BarPlot"

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
