import { describe, expect, it } from "vitest"

import { sortPanelValues } from "./facetOrder"

describe("sortPanelValues", () => {
	it("returns the input unchanged when the order map is empty", () => {
		expect(sortPanelValues(["A", "B", "C"], {})).toEqual(["A", "B", "C"])
	})

	it("sorts all values ascending by their rank when every value has one", () => {
		expect(sortPanelValues(["A", "B", "C"], { A: 3, B: 1, C: 2 })).toEqual([
			"B",
			"C",
			"A",
		])
	})

	it("pins ranked values to the front and preserves natural order for the rest", () => {
		expect(sortPanelValues(["A", "B", "C", "D"], { C: 1, A: 2 })).toEqual([
			"C",
			"A",
			"B",
			"D",
		])
	})

	it("breaks ties by original input order (stable sort)", () => {
		// Two values with the same rank — input order must be preserved.
		expect(sortPanelValues(["A", "B", "C"], { A: 1, B: 1, C: 1 })).toEqual([
			"A",
			"B",
			"C",
		])
	})

	it("supports non-contiguous ranks (gaps in numbering)", () => {
		expect(sortPanelValues(["A", "B", "C"], { A: 10, B: 100, C: 5 })).toEqual([
			"C",
			"A",
			"B",
		])
	})

	it("supports negative ranks and orders them correctly", () => {
		expect(sortPanelValues(["A", "B", "C"], { A: -5, B: 1, C: 0 })).toEqual([
			"A",
			"C",
			"B",
		])
	})

	it("ignores order keys that don't match any input value", () => {
		expect(sortPanelValues(["A", "B"], { Z: 1, A: 2 })).toEqual(["A", "B"])
	})

	it("returns empty for empty input", () => {
		expect(sortPanelValues([], { A: 1 })).toEqual([])
	})
})
