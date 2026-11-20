import { describe, expect, it } from "vitest"
import {
	compileFilter,
	emptyFilterFor,
	filterRows,
	isFilterActive,
	normalizeFilter,
	parseFilterDate,
	parseFilterNumber,
	renameFieldInFilters,
	sameFilter,
	type ColumnFilter,
	type FilterOp,
} from "./columnFilter"

const conditions = (
	join: "and" | "or",
	...list: Array<[FilterOp, string]>
): ColumnFilter => ({
	kind: "conditions",
	as: "number",
	join,
	conditions: list.map(([op, value]) => ({ op, value })),
})

describe("columnFilter", () => {
	it("starts each column type with a filter that removes nothing", () => {
		expect(emptyFilterFor("categorical")).toEqual({ kind: "values", excluded: [] })
		expect(emptyFilterFor("ordinal").kind).toBe("values")
		expect(emptyFilterFor("quantitative")).toMatchObject({ kind: "conditions", as: "number" })
		expect(emptyFilterFor("temporal")).toMatchObject({ kind: "conditions", as: "date" })
		for (const type of ["categorical", "quantitative", "temporal"] as const) {
			expect(isFilterActive(emptyFilterFor(type))).toBe(false)
			expect(normalizeFilter(emptyFilterFor(type))).toBeNull()
		}
	})

	it("takes deselected categories out and keeps ones it has never seen", () => {
		const test = compileFilter({ kind: "values", excluded: ["Quito", ""] })
		expect(test("Lima")).toBe(true)
		expect(test("Quito")).toBe(false)
		expect(test("")).toBe(false)
		expect(test("Cusco")).toBe(true)
	})

	it("reads numbers however the column writes them", () => {
		expect(parseFilterNumber("1234.5")).toBe(1234.5)
		expect(parseFilterNumber("$1,234.50")).toBe(1234.5)
		expect(parseFilterNumber("(1,234)")).toBe(-1234)
		expect(parseFilterNumber("14%")).toBe(0.14)
		expect(parseFilterNumber("")).toBeNull()
		expect(parseFilterNumber("n/a")).toBeNull()
	})

	it("compares numbers, joined by AND or OR", () => {
		const between = compileFilter(conditions("and", ["gte", "10"], ["lt", "20"]))
		expect(["5", "10", "15", "20"].map(between)).toEqual([false, true, true, false])
		const outside = compileFilter(conditions("or", ["lt", "10"], ["gt", "20"]))
		expect(["5", "10", "25"].map(outside)).toEqual([true, false, true])
		const exact = compileFilter(conditions("and", ["eq", "$1,000"]))
		expect(exact("1000")).toBe(true)
		expect(compileFilter(conditions("and", ["neq", "0"]))("0")).toBe(false)
	})

	it("ignores a condition with no value, and fails cells that aren't numbers", () => {
		const half = conditions("and", ["gt", "10"], ["lt", ""])
		expect(isFilterActive(half)).toBe(true)
		expect(compileFilter(half)("50")).toBe(true)
		expect(compileFilter(half)("")).toBe(false)
		expect(compileFilter(half)("n/a")).toBe(false)
		expect(normalizeFilter(half)).toEqual(conditions("and", ["gt", "10"]))
		expect(isFilterActive(conditions("and", ["gt", "abc"]))).toBe(false)
	})

	it("compares dates by calendar day", () => {
		const on: ColumnFilter = {
			kind: "conditions",
			as: "date",
			join: "and",
			conditions: [{ op: "eq", value: "2024-03-05" }],
		}
		const test = compileFilter(on)
		expect(test("2024-03-05")).toBe(true)
		expect(test("2024-03-05T15:30:00")).toBe(true)
		expect(test("2024-03-06")).toBe(false)
		expect(test("not a date")).toBe(false)
		expect(parseFilterDate("2010")).toBe(parseFilterDate("2010-01-01"))
		const after = compileFilter({ ...on, conditions: [{ op: "gt", value: "2024-03-05" }] })
		expect(test("2024-03-05T23:00:00") && !after("2024-03-05T23:00:00")).toBe(true)
		expect(after("2024-03-06")).toBe(true)
	})

	it("filters rows by every active filter and returns the same rows when none is", () => {
		const rows = [
			{ city: "Lima", sales: "10" },
			{ city: "Quito", sales: "20" },
			{ city: "Bogotá", sales: "30" },
		]
		expect(filterRows(rows, [])).toBe(rows)
		expect(
			filterRows(rows, [{ field: "city", filter: { kind: "values", excluded: [] } }])
		).toBe(rows)
		expect(
			filterRows(rows, [
				{ field: "city", filter: { kind: "values", excluded: ["Lima"] } },
				{ field: "sales", filter: conditions("and", ["lt", "30"]) },
			])
		).toEqual([{ city: "Quito", sales: "20" }])
	})

	it("compares and renames", () => {
		const a = conditions("and", ["gt", "1"])
		expect(sameFilter(a, conditions("and", ["gt", "1"]))).toBe(true)
		expect(sameFilter(a, conditions("or", ["gt", "1"]))).toBe(false)
		expect(sameFilter(null, undefined)).toBe(true)
		expect(sameFilter(a, null)).toBe(false)
		const filters = [{ field: "city", filter: a }]
		expect(renameFieldInFilters(filters, "x", "y")).toBe(filters)
		expect(renameFieldInFilters(filters, "city", "town")[0]?.field).toBe("town")
	})
})
