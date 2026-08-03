import { describe, expect, it } from "vitest"

import { aggregateDistributions } from "./distributions"

const rowsForCategory = (category: string, values: number[]) =>
	values.map((v) => ({ group: category, val: String(v) }))

describe("aggregateDistributions", () => {
	it("treats all rows as one group when categoryField is empty (single variable)", () => {
		const result = aggregateDistributions({
			rows: [1, 2, 3, 4, 5].map((v) => ({ val: String(v) })),
			categoryField: "", // single-variable distribution
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		expect("error" in result).toBe(false)
		if ("error" in result) return
		expect(result.stats).toHaveLength(1)
		expect(result.stats[0]!.values).toEqual([1, 2, 3, 4, 5])
		expect(result.stats[0]!.box.median).toBe(3)
	})

	it("rejects non-quantitative value axes", () => {
		const result = aggregateDistributions({
			rows: [{ group: "A", val: "foo" }],
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "categorical",
		})
		expect("error" in result).toBe(true)
	})

	it("rejects datasets where every row has a missing value", () => {
		const result = aggregateDistributions({
			rows: [
				{ group: "A", val: "" },
				{ group: "B", val: null },
			],
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		expect("error" in result).toBe(true)
	})

	it("returns one stats entry per category in encounter order", () => {
		const result = aggregateDistributions({
			rows: [
				...rowsForCategory("B", [1, 2, 3]),
				...rowsForCategory("A", [10, 20, 30]),
			],
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["B", "A"])
		expect(result.stats.map((s) => s.category)).toEqual(["B", "A"])
	})

	it("computes Tukey box stats correctly on a known distribution", () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
		const result = aggregateDistributions({
			rows: rowsForCategory("A", values),
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const stats = result.stats[0]
		expect(stats?.box.median).toBeCloseTo(5.5)
		expect(stats?.box.q1).toBeCloseTo(3.25)
		expect(stats?.box.q3).toBeCloseTo(7.75)
		expect(stats?.box.outliers).toEqual([100])
		// Upper whisker is the largest non-outlier (9), not q3 + 1.5*IQR.
		expect(stats?.box.upperWhisker).toBe(9)
		expect(stats?.box.lowerWhisker).toBe(1)
	})

	it("flags no outliers when all values fall within Tukey fences", () => {
		const result = aggregateDistributions({
			rows: rowsForCategory("A", [1, 2, 3, 4, 5]),
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stats[0]?.box.outliers).toEqual([])
	})

	it("normalizes per-category KDE peak to 1.0 (so equal categories render at equal width)", () => {
		const result = aggregateDistributions({
			rows: [
				...rowsForCategory(
					"A",
					Array.from({ length: 50 }, (_, i) => i)
				),
				...rowsForCategory(
					"B",
					Array.from({ length: 5 }, (_, i) => i)
				),
			],
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		for (const s of result.stats) {
			const peak = Math.max(...s.kde.density)
			expect(peak).toBeCloseTo(1)
		}
	})

	it("uses one shared KDE grid across all categories", () => {
		const result = aggregateDistributions({
			rows: [
				...rowsForCategory("A", [1, 2, 3]),
				...rowsForCategory("B", [50, 60, 70]),
			],
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const a = result.stats[0]?.kde.grid
		const b = result.stats[1]?.kde.grid
		expect(a).toEqual(b)
		// Shared grid spans the global value range [1, 70].
		expect(a?.[0]).toBeCloseTo(1)
		expect(a?.at(-1)).toBeCloseTo(70)
	})

	it("returns the global value domain across all categories", () => {
		const result = aggregateDistributions({
			rows: [
				...rowsForCategory("A", [-5, 0, 5]),
				...rowsForCategory("B", [10, 20, 30]),
			],
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.valueDomain).toEqual([-5, 30])
	})

	it("does not crash on a category with all-equal values (zero std)", () => {
		const result = aggregateDistributions({
			rows: [
				...rowsForCategory("A", [5, 5, 5, 5]),
				...rowsForCategory("B", [1, 5, 9]),
			],
			categoryField: "group",
			valueField: "val",
			categoryType: "categorical",
			valueType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const peak = Math.max(...(result.stats[0]?.kde.density ?? [0]))
		expect(peak).toBeCloseTo(1)
	})
})
