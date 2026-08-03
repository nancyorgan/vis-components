import { describe, expect, it } from "vitest"

import { aggregateBars } from "./aggregateBars"

const rows = [
	{ region: "N", product: "A", sales: "10" },
	{ region: "N", product: "B", sales: "20" },
	{ region: "S", product: "A", sales: "5" },
	{ region: "S", product: "A", sales: "15" },
	{ region: "N", product: "A", sales: "7" },
]

describe("aggregateBars", () => {
	it("counts rows per category when no groups are mapped and length is categorical", () => {
		const result = aggregateBars({
			rows,
			categoryField: "region",
			lengthField: "region",
			categoryType: "categorical",
			lengthType: "categorical",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["N", "S"])
		expect(result.stacks).toEqual([
			{ category: "N", slices: [{ key: "", groupValues: {}, value: 3 }] },
			{ category: "S", slices: [{ key: "", groupValues: {}, value: 2 }] },
		])
	})

	it("sums length values per category when length is quantitative and no groups", () => {
		const result = aggregateBars({
			rows,
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks).toEqual([
			{ category: "N", slices: [{ key: "", groupValues: {}, value: 37 }] },
			{ category: "S", slices: [{ key: "", groupValues: {}, value: 20 }] },
		])
	})

	it("counts rows per (category, hue) when hue is the same categorical field as length", () => {
		const result = aggregateBars({
			rows,
			categoryField: "region",
			lengthField: "product",
			categoryType: "categorical",
			lengthType: "categorical",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["N", "S"])
		expect(result.stacks[0].category).toBe("N")
		expect(result.stacks[0].slices.map((s) => s.value)).toEqual([2, 1])
		expect(result.stacks[0].slices.map((s) => s.groupValues.hue)).toEqual([
			"A",
			"B",
		])
		expect(result.stacks[1].category).toBe("S")
		expect(result.stacks[1].slices.map((s) => s.value)).toEqual([2])
		expect(result.stacks[1].slices[0].groupValues.hue).toBe("A")
	})

	it("sums length values per (category, hue) when hue is categorical and length is quantitative", () => {
		const result = aggregateBars({
			rows,
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].slices.map((s) => s.value)).toEqual([17, 20])
		expect(result.stacks[1].slices.map((s) => s.value)).toEqual([20])
	})

	it("stacks by the combined tuple when multiple group encodings are mapped", () => {
		const multiRows = [
			{ region: "N", product: "A", kind: "X", sales: "1" },
			{ region: "N", product: "A", kind: "Y", sales: "2" },
			{ region: "N", product: "B", kind: "X", sales: "4" },
			{ region: "N", product: "A", kind: "X", sales: "8" },
		]
		const result = aggregateBars({
			rows: multiRows,
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [
				{ channel: "hue", field: "product", type: "categorical" },
				{ channel: "pattern", field: "kind", type: "categorical" },
			],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].category).toBe("N")
		// Encounter order: (A,X), (A,Y), (B,X)
		expect(result.stacks[0].slices.map((s) => s.groupValues)).toEqual([
			{ hue: "A", pattern: "X" },
			{ hue: "A", pattern: "Y" },
			{ hue: "B", pattern: "X" },
		])
		expect(result.stacks[0].slices.map((s) => s.value)).toEqual([9, 2, 4])
	})

	it("returns an error when length is categorical and its field matches no group", () => {
		const result = aggregateBars({
			rows,
			categoryField: "region",
			lengthField: "product",
			categoryType: "categorical",
			lengthType: "categorical",
			groups: [{ channel: "hue", field: "region", type: "categorical" }],
		})
		expect(result).toHaveProperty("error")
	})

	it("skips rows where the category value is missing", () => {
		const result = aggregateBars({
			rows: [...rows, { region: "", product: "A", sales: "99" }],
			categoryField: "region",
			lengthField: "region",
			categoryType: "categorical",
			lengthType: "categorical",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["N", "S"])
	})

	it("skips rows where the length value is non-numeric in quantitative sum mode", () => {
		const result = aggregateBars({
			rows: [...rows, { region: "N", product: "A", sales: "not-a-number" }],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].slices[0].value).toBe(37)
	})
})
