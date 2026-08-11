import { describe, expect, it } from "vitest"

import { aggregateBars, aggregateStacks } from "./stacks"

describe("aggregateStacks (primary export)", () => {
	it("returns one slice per category with sum = value for quantitative length, no groups", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", sales: "10" },
				{ region: "N", sales: "5" },
				{ region: "S", sales: "3" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["N", "S"])
		expect(result.stacks).toEqual([
			{ category: "N", slices: [{ key: "", groupValues: {}, value: 15 }] },
			{ category: "S", slices: [{ key: "", groupValues: {}, value: 3 }] },
		])
	})

	it("returns an error when length is categorical and no group encoding references the length field", () => {
		const result = aggregateStacks({
			rows: [{ region: "N", product: "A" }],
			categoryField: "region",
			lengthField: "product",
			categoryType: "categorical",
			lengthType: "categorical",
			groups: [{ channel: "hue", field: "region", type: "categorical" }],
		})
		expect("error" in result).toBe(true)
	})

	it("counts rows per (category, tuple) when length is categorical and its field matches a group field", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", product: "A" },
				{ region: "N", product: "A" },
				{ region: "N", product: "B" },
				{ region: "S", product: "A" },
			],
			categoryField: "region",
			lengthField: "product",
			categoryType: "categorical",
			lengthType: "categorical",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].category).toBe("N")
		expect(result.stacks[0].slices.map((s) => s.value)).toEqual([2, 1])
		expect(result.stacks[1].category).toBe("S")
		expect(result.stacks[1].slices.map((s) => s.value)).toEqual([1])
	})

	it("indexes slices by the tuple of all group channels when multiple are mapped", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", product: "A", kind: "X", sales: "1" },
				{ region: "N", product: "A", kind: "X", sales: "2" },
				{ region: "N", product: "A", kind: "Y", sales: "4" },
				{ region: "N", product: "B", kind: "X", sales: "8" },
			],
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
		expect(result.stacks[0].slices.map((s) => s.groupValues)).toEqual([
			{ hue: "A", pattern: "X" },
			{ hue: "A", pattern: "Y" },
			{ hue: "B", pattern: "X" },
		])
		expect(result.stacks[0].slices.map((s) => s.value)).toEqual([3, 4, 8])
	})

	it("orders slices by the group field's pinned level order when groupOrders is supplied", () => {
		// Data encounter order is A, B, C — but the user reordered the hue
		// field to C, A, B in the Fields UI. Slices should stack in that order
		// so the bars line up with the legend.
		const result = aggregateStacks({
			rows: [
				{ region: "N", product: "A", sales: "1" },
				{ region: "N", product: "B", sales: "2" },
				{ region: "N", product: "C", sales: "4" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
			groupOrders: { hue: ["C", "A", "B"] },
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].slices.map((s) => s.groupValues.hue)).toEqual([
			"C",
			"A",
			"B",
		])
	})

	it("falls back to encounter order for an unpinned categorical group field", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", product: "B", sales: "1" },
				{ region: "N", product: "A", sales: "2" },
				{ region: "N", product: "C", sales: "4" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].slices.map((s) => s.groupValues.hue)).toEqual([
			"B",
			"A",
			"C",
		])
	})

	it("partially-pinned group values come first, the rest follow in encounter order", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", product: "A", sales: "1" },
				{ region: "N", product: "B", sales: "2" },
				{ region: "N", product: "C", sales: "4" },
				{ region: "N", product: "D", sales: "8" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
			// Only C and A are pinned; B and D keep their encounter order after.
			groupOrders: { hue: ["C", "A"] },
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].slices.map((s) => s.groupValues.hue)).toEqual([
			"C",
			"A",
			"B",
			"D",
		])
	})

	it("orders multi-channel slices by each channel's pinned order, primary channel first", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", product: "A", kind: "X", sales: "1" },
				{ region: "N", product: "A", kind: "Y", sales: "2" },
				{ region: "N", product: "B", kind: "X", sales: "4" },
				{ region: "N", product: "B", kind: "Y", sales: "8" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [
				{ channel: "hue", field: "product", type: "categorical" },
				{ channel: "pattern", field: "kind", type: "categorical" },
			],
			groupOrders: { hue: ["B", "A"], pattern: ["Y", "X"] },
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0].slices.map((s) => s.groupValues)).toEqual([
			{ hue: "B", pattern: "Y" },
			{ hue: "B", pattern: "X" },
			{ hue: "A", pattern: "Y" },
			{ hue: "A", pattern: "X" },
		])
	})

	it("returns empty categories and no error when rows is empty", () => {
		const result = aggregateStacks({
			rows: [],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual([])
		expect(result.stacks).toEqual([])
	})

	it("is re-exported as aggregateBars (backwards-compatible alias)", () => {
		expect(aggregateBars).toBe(aggregateStacks)
	})

	it("sorts categories numerically when categoryType is quantitative, regardless of row order", () => {
		const result = aggregateStacks({
			rows: [
				{ x: "3", sales: "1" },
				{ x: "1", sales: "1" },
				{ x: "5", sales: "1" },
				{ x: "2", sales: "1" },
				{ x: "4", sales: "1" },
			],
			categoryField: "x",
			lengthField: "sales",
			categoryType: "quantitative",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["1", "2", "3", "4", "5"])
		expect(result.stacks.map((s) => s.category)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
		])
	})

	it("sorts categories numerically when categoryType is ordinal with numeric values", () => {
		const result = aggregateStacks({
			rows: [
				{ rank: "10", sales: "1" },
				{ rank: "2", sales: "1" },
				{ rank: "1", sales: "1" },
			],
			categoryField: "rank",
			lengthField: "sales",
			categoryType: "ordinal",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["1", "2", "10"])
	})

	it("sorts categories chronologically when categoryType is temporal", () => {
		const result = aggregateStacks({
			rows: [
				{ d: "2024-03-01", sales: "1" },
				{ d: "2024-01-01", sales: "1" },
				{ d: "2024-02-01", sales: "1" },
			],
			categoryField: "d",
			lengthField: "sales",
			categoryType: "temporal",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual([
			"2024-01-01",
			"2024-02-01",
			"2024-03-01",
		])
	})

	it("preserves encounter order for categorical (string) categoryType", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", sales: "1" },
				{ region: "S", sales: "1" },
				{ region: "E", sales: "1" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.categories).toEqual(["N", "S", "E"])
	})
})

describe("aggregateStacks textField (data-labels value aggregation)", () => {
	it("sums a numeric textField per slice when it differs from length", () => {
		// Two regions, with a separate `units` quantitative field that the
		// user wants displayed on labels. Verify per-slice `textValue` is
		// the sum of `units` (NOT the sum of the length field).
		const result = aggregateStacks({
			rows: [
				{ region: "N", sales: "10", units: "3" },
				{ region: "N", sales: "5", units: "7" },
				{ region: "S", sales: "3", units: "9" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
			textField: "units",
			textType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const N = result.stacks.find((s) => s.category === "N")?.slices[0]
		const S = result.stacks.find((s) => s.category === "S")?.slices[0]
		expect(N?.value).toBe(15) // sum of sales
		expect(N?.textValue).toBe(10) // sum of units
		expect(S?.value).toBe(3)
		expect(S?.textValue).toBe(9)
	})

	it("skips blank cells in a numeric textField instead of counting them as 0", () => {
		// Regression: `Number("")` is 0, so blank cells used to contribute 0
		// to the sum — and a slice whose label-field rows were ALL blank got
		// textValue 0, rendering a spurious "0" label.
		const result = aggregateStacks({
			rows: [
				{ region: "N", sales: "10", units: "3" },
				{ region: "N", sales: "5", units: "" },
				{ region: "S", sales: "3", units: "" },
				{ region: "S", sales: "2", units: "  " },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
			textField: "units",
			textType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const N = result.stacks.find((s) => s.category === "N")?.slices[0]
		const S = result.stacks.find((s) => s.category === "S")?.slices[0]
		expect(N?.textValue).toBe(3) // blank skipped, not summed as 0
		expect(S?.textValue).toBeUndefined() // all blank → no label, not "0"
	})

	it("uses the first non-empty value for non-numeric textField", () => {
		const result = aggregateStacks({
			rows: [
				{ region: "N", sales: "10", note: "" },
				{ region: "N", sales: "5", note: "first" },
				{ region: "N", sales: "1", note: "second" },
				{ region: "S", sales: "3", note: "south" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
			textField: "note",
			textType: "categorical",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const N = result.stacks.find((s) => s.category === "N")?.slices[0]
		const S = result.stacks.find((s) => s.category === "S")?.slices[0]
		// Skipped the empty string and picked the first real value.
		expect(N?.textValue).toBe("first")
		expect(S?.textValue).toBe("south")
	})

	it("doesn't compute textValue when textField equals lengthField (label uses slice.value)", () => {
		// Same field for length and text — the renderer should display
		// slice.value directly rather than a redundant aggregation.
		const result = aggregateStacks({
			rows: [
				{ region: "N", sales: "10" },
				{ region: "N", sales: "5" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
			textField: "sales",
			textType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const slice = result.stacks[0]?.slices[0]
		expect(slice?.value).toBe(15)
		expect(slice?.textValue).toBeUndefined()
	})

	it("respects group-channel slicing — textValue aggregates per (category, group) bucket", () => {
		// hue groups split each region's stack into per-product slices;
		// units should sum per slice, not per category.
		const result = aggregateStacks({
			rows: [
				{ region: "N", product: "A", sales: "10", units: "3" },
				{ region: "N", product: "B", sales: "5", units: "7" },
				{ region: "N", product: "A", sales: "2", units: "1" },
			],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
			textField: "units",
			textType: "quantitative",
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		const slices = result.stacks[0]?.slices ?? []
		const sliceA = slices.find((s) => s.groupValues.hue === "A")
		const sliceB = slices.find((s) => s.groupValues.hue === "B")
		expect(sliceA?.textValue).toBe(4) // 3 + 1
		expect(sliceB?.textValue).toBe(7)
	})

	it("leaves textValue undefined on slices when no textField is supplied", () => {
		const result = aggregateStacks({
			rows: [{ region: "N", sales: "10" }],
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [],
		})
		if ("error" in result) throw new Error("unexpected error: " + result.error)
		expect(result.stacks[0]?.slices[0]?.textValue).toBeUndefined()
	})
})
