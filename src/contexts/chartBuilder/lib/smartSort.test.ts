import { describe, expect, it } from "vitest"

import { applyLevelOrder, orderedLevels, smartSortCategories } from "./smartSort"

describe("smartSortCategories", () => {
	describe("ordinal", () => {
		it("sorts numeric strings numerically (not lexicographically)", () => {
			expect(smartSortCategories(["10", "2", "1", "100"], "ordinal")).toEqual([
				"1",
				"2",
				"10",
				"100",
			])
		})

		it("sorts mixed-numeric strings alphabetically with locale numeric awareness", () => {
			expect(
				smartSortCategories(
					["Region 10", "Region 2", "Region 1", "Region 20"],
					"ordinal"
				)
			).toEqual(["Region 1", "Region 2", "Region 10", "Region 20"])
		})

		it("sorts pure-alpha strings alphabetically", () => {
			expect(
				smartSortCategories(["zebra", "apple", "moose"], "ordinal")
			).toEqual(["apple", "moose", "zebra"])
		})

		it("treats negative numbers correctly", () => {
			expect(
				smartSortCategories(["3", "-1", "0", "-5", "2"], "ordinal")
			).toEqual(["-5", "-1", "0", "2", "3"])
		})
	})

	describe("non-ordinal types", () => {
		it("preserves discovery order for categorical fields", () => {
			expect(
				smartSortCategories(["zebra", "apple", "moose"], "categorical")
			).toEqual(["zebra", "apple", "moose"])
		})

		it("preserves discovery order for quantitative fields", () => {
			// Quantitative shouldn't be sorted as discrete categories at all,
			// but we still preserve the input rather than mutating it.
			expect(smartSortCategories(["10", "2", "1"], "quantitative")).toEqual([
				"10",
				"2",
				"1",
			])
		})

		it("preserves discovery order for temporal fields", () => {
			expect(
				smartSortCategories(["2024-01-15", "2023-06-01"], "temporal")
			).toEqual(["2024-01-15", "2023-06-01"])
		})
	})

	it("does not mutate the input array", () => {
		const input = ["10", "2", "1"]
		const out = smartSortCategories(input, "ordinal")
		expect(input).toEqual(["10", "2", "1"])
		expect(out).not.toBe(input)
	})

	it("handles empty input", () => {
		expect(smartSortCategories([], "ordinal")).toEqual([])
	})

	it("handles single-value input", () => {
		expect(smartSortCategories(["only"], "ordinal")).toEqual(["only"])
	})
})

describe("applyLevelOrder", () => {
	it("falls back to smart-sort when no pinned order is provided", () => {
		expect(applyLevelOrder(["10", "2", "1"], "ordinal", undefined)).toEqual([
			"1",
			"2",
			"10",
		])
		expect(applyLevelOrder(["c", "a", "b"], "categorical", undefined)).toEqual([
			"c",
			"a",
			"b",
		])
	})

	it("places pinned values first in declared order", () => {
		expect(
			applyLevelOrder(["zebra", "apple", "moose", "panda"], "categorical", [
				"panda",
				"moose",
			])
		).toEqual(["panda", "moose", "zebra", "apple"])
	})

	it("appends unpinned values in smart-sort order for ordinal", () => {
		expect(
			applyLevelOrder(["10", "2", "1", "5", "3"], "ordinal", ["10", "1"])
		).toEqual(["10", "1", "2", "3", "5"])
	})

	it("ignores pinned values that aren't present in the discovered list", () => {
		expect(applyLevelOrder(["a", "b"], "categorical", ["x", "a", "y"])).toEqual(
			["a", "b"]
		)
	})

	it("handles empty pinned order array as no override", () => {
		expect(applyLevelOrder(["c", "a", "b"], "categorical", [])).toEqual([
			"c",
			"a",
			"b",
		])
	})
})

describe("orderedLevels", () => {
	it("keeps discovery order (NOT smart-sorted) when no pin, carrying indices", () => {
		// The sidebar's per-value slots key on discovery index and the renderer
		// does not smart-sort — so an unpinned categorical stays as-discovered.
		expect(orderedLevels(["c", "a", "b"], "categorical", undefined)).toEqual([
			{ value: "c", index: 0 },
			{ value: "a", index: 1 },
			{ value: "b", index: 2 },
		])
	})

	it("reorders rows to the pin while each value keeps its discovery index", () => {
		// "high" drawn as scheme[2], "low" as scheme[0] — the index must follow the
		// value across the reorder so the swatch matches the mark.
		expect(
			orderedLevels(["low", "med", "high"], "ordinal", ["high", "low", "med"])
		).toEqual([
			{ value: "high", index: 2 },
			{ value: "low", index: 0 },
			{ value: "med", index: 1 },
		])
	})

	it("appends unpinned values after pinned ones in smart-sort order", () => {
		expect(
			orderedLevels(["10", "2", "1", "5"], "ordinal", ["10", "1"])
		).toEqual([
			{ value: "10", index: 0 },
			{ value: "1", index: 2 },
			{ value: "2", index: 1 },
			{ value: "5", index: 3 },
		])
	})

	it("treats an empty pin as no override (discovery order)", () => {
		expect(orderedLevels(["c", "a"], "categorical", [])).toEqual([
			{ value: "c", index: 0 },
			{ value: "a", index: 1 },
		])
	})
})
