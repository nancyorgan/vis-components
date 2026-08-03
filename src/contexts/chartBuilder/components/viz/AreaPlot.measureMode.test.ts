import { describe, expect, it } from "vitest"
import type { Stack } from "../../lib/aggregators/stacks"

import { computeAreaMeasureMax, resolveAreaMeasureField } from "./AreaPlot"

describe("resolveAreaMeasureField", () => {
	it("areas-x uses length when mapped", () => {
		const enc = { length: { field: "L" }, y: { field: "Y" } }
		expect(resolveAreaMeasureField("areas-x", enc)).toBe("L")
	})

	it("areas-x falls back to y when length is unmapped", () => {
		const enc = { length: { field: null }, y: { field: "Y" } }
		expect(resolveAreaMeasureField("areas-x", enc)).toBe("Y")
	})

	it("areas-x returns null when neither length nor y is mapped", () => {
		const enc = { length: { field: null }, y: { field: null } }
		expect(resolveAreaMeasureField("areas-x", enc)).toBeNull()
	})

	it("areas-y only uses length (orientation-fixed, even if y is mapped)", () => {
		const enc = { length: { field: "L" }, y: { field: "Y" } }
		expect(resolveAreaMeasureField("areas-y", enc)).toBe("L")
	})

	it("areas-y returns null when length is unmapped", () => {
		const enc = { length: { field: null }, y: { field: "Y" } }
		expect(resolveAreaMeasureField("areas-y", enc)).toBeNull()
	})
})

describe("computeAreaMeasureMax", () => {
	const stacks: Stack[] = [
		{
			category: "A",
			slices: [
				{ key: "1", value: 3, groupValues: {} },
				{ key: "2", value: 4, groupValues: {} },
			],
		},
		{
			category: "B",
			slices: [
				{ key: "1", value: 5, groupValues: {} },
				{ key: "2", value: 2, groupValues: {} },
			],
		},
	]

	it("stack mode returns max sum-per-stack", () => {
		// A total = 7, B total = 7 → max = 7
		expect(computeAreaMeasureMax(stacks, "stack")).toBe(7)
	})

	it("overlay mode returns max individual slice across stacks", () => {
		// all slice values: [3, 4, 5, 2] → max = 5
		expect(computeAreaMeasureMax(stacks, "overlay")).toBe(5)
	})

	it("group mode (degrades to overlay for areas) returns max individual slice", () => {
		expect(computeAreaMeasureMax(stacks, "group")).toBe(5)
	})

	it("empty input returns the floor of 1", () => {
		expect(computeAreaMeasureMax([], "stack")).toBe(1)
		expect(computeAreaMeasureMax([], "overlay")).toBe(1)
	})
})
