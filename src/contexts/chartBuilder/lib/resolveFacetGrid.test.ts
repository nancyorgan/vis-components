import { describe, expect, it } from "vitest"

import { resolveCrossProduct, resolveFacetGrid } from "./resolveFacetGrid"

describe("resolveFacetGrid", () => {
	it("defaults to a square-ish grid when both rows and cols are null", () => {
		// 5 facets → ceil(sqrt(5)) = 3 cols, ceil(5/3) = 2 rows
		expect(resolveFacetGrid(5, null, null)).toEqual({ rows: 2, cols: 3 })
	})

	it("computes cols from n when only rows is set (n divisible)", () => {
		expect(resolveFacetGrid(4, 2, null)).toEqual({ rows: 2, cols: 2 })
	})

	it("ceils cols so no panels are dropped when n is not divisible by rows", () => {
		// 5 facets in 2 rows: ceil(5/2) = 3 cols, last row has one empty cell.
		expect(resolveFacetGrid(5, 2, null)).toEqual({ rows: 2, cols: 3 })
	})

	it("ceils cols to keep every panel when rows exceeds reasonable cols", () => {
		// 4 facets in 3 rows: ceil(4/3) = 2 cols.
		expect(resolveFacetGrid(4, 3, null)).toEqual({ rows: 3, cols: 2 })
	})

	it("computes rows from n when only cols is set", () => {
		expect(resolveFacetGrid(6, null, 2)).toEqual({ rows: 3, cols: 2 })
	})

	it("honors both dimensions when they fit exactly", () => {
		expect(resolveFacetGrid(6, 2, 3)).toEqual({ rows: 2, cols: 3 })
	})

	it("honors both dimensions even when their product exceeds n (extra cells stay empty)", () => {
		// User explicitly asked for 3×3 = 9 cells with 6 panels — last 3 cells empty.
		expect(resolveFacetGrid(6, 3, 3)).toEqual({ rows: 3, cols: 3 })
	})

	it("returns a 1x1 grid for n=0", () => {
		expect(resolveFacetGrid(0, null, null)).toEqual({ rows: 1, cols: 1 })
	})

	it("returns a 1x1 grid for n=1 with no user overrides", () => {
		expect(resolveFacetGrid(1, null, null)).toEqual({ rows: 1, cols: 1 })
	})

	it("clamps rows when user-specified rows exceeds n", () => {
		// rows pinned to 7 against n=5 → cap rows at 5, ceil(5/5) = 1 col.
		expect(resolveFacetGrid(5, 7, null)).toEqual({ rows: 5, cols: 1 })
	})
})

describe("resolveCrossProduct", () => {
	it("partitions rows by (rowField, colField) into row/col-indexed cells", () => {
		const rows = [
			{ region: "N", year: "2024", v: 1 },
			{ region: "N", year: "2025", v: 2 },
			{ region: "S", year: "2024", v: 3 },
			{ region: "S", year: "2025", v: 4 },
		]
		const result = resolveCrossProduct(rows, "region", "year")
		expect(result.rowValues).toEqual(["N", "S"])
		expect(result.colValues).toEqual(["2024", "2025"])
		expect(result.cellRows.get("N|2024")).toEqual([rows[0]])
		expect(result.cellRows.get("N|2025")).toEqual([rows[1]])
		expect(result.cellRows.get("S|2024")).toEqual([rows[2]])
		expect(result.cellRows.get("S|2025")).toEqual([rows[3]])
	})

	it("returns empty arrays for (row, col) combos with no matching data", () => {
		const rows = [
			{ region: "N", year: "2024", v: 1 },
			{ region: "S", year: "2025", v: 4 },
		]
		const result = resolveCrossProduct(rows, "region", "year")
		expect(result.rowValues).toEqual(["N", "S"])
		expect(result.colValues).toEqual(["2024", "2025"])
		expect(result.cellRows.get("N|2024")).toEqual([rows[0]])
		expect(result.cellRows.get("N|2025")).toEqual([]) // empty cell
		expect(result.cellRows.get("S|2024")).toEqual([]) // empty cell
		expect(result.cellRows.get("S|2025")).toEqual([rows[1]])
	})

	it("preserves dataset-encounter order for row and column values", () => {
		// First seen S, then N for region; first seen 2025, then 2024 for year.
		const rows = [
			{ region: "S", year: "2025", v: 1 },
			{ region: "N", year: "2024", v: 2 },
			{ region: "S", year: "2024", v: 3 },
			{ region: "N", year: "2025", v: 4 },
		]
		const result = resolveCrossProduct(rows, "region", "year")
		expect(result.rowValues).toEqual(["S", "N"])
		expect(result.colValues).toEqual(["2025", "2024"])
	})

	it("skips rows with null/undefined values in either facet field", () => {
		const rows = [
			{ region: "N", year: "2024", v: 1 },
			{ region: null, year: "2024", v: 2 }, // null row value
			{ region: "S", year: undefined, v: 3 }, // undefined col value
			{ region: "S", year: "2024", v: 4 },
		]
		const result = resolveCrossProduct(rows, "region", "year")
		expect(result.rowValues).toEqual(["N", "S"])
		expect(result.colValues).toEqual(["2024"])
		expect(result.cellRows.get("N|2024")).toEqual([rows[0]])
		expect(result.cellRows.get("S|2024")).toEqual([rows[3]])
	})

	it("returns empty result when given an empty rows array", () => {
		const result = resolveCrossProduct([], "region", "year")
		expect(result.rowValues).toEqual([])
		expect(result.colValues).toEqual([])
		expect(result.cellRows.size).toBe(0)
	})

	it("coerces non-string values to strings for cell keys", () => {
		// Numeric / boolean facet values are common when fields haven't
		// been explicitly typed. The keys should be string-comparable.
		const rows = [
			{ region: 1, year: 2024, v: 1 },
			{ region: 2, year: 2024, v: 2 },
		]
		const result = resolveCrossProduct(rows, "region", "year")
		expect(result.rowValues).toEqual(["1", "2"])
		expect(result.colValues).toEqual(["2024"])
		expect(result.cellRows.get("1|2024")).toEqual([rows[0]])
		expect(result.cellRows.get("2|2024")).toEqual([rows[1]])
	})
})
