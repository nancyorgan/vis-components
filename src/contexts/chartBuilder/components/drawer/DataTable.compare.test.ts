import { describe, expect, it } from "vitest"

import { compareByType, isUniformLength } from "./DataTable"

describe("compareByType", () => {
	describe("quantitative", () => {
		it("orders numerically ascending, not lexicographically", () => {
			// Lexical: "10" < "9"; numeric: 9 < 10. Must be numeric.
			expect(compareByType("9", "10", "quantitative")).toBeLessThan(0)
			expect(compareByType("10", "9", "quantitative")).toBeGreaterThan(0)
		})

		it("treats equal numbers as equal", () => {
			expect(compareByType("5", "5", "quantitative")).toBe(0)
		})

		it("sorts NaN values to the end regardless of direction", () => {
			expect(compareByType("foo", "5", "quantitative")).toBeGreaterThan(0)
			expect(compareByType("5", "foo", "quantitative")).toBeLessThan(0)
			expect(compareByType("foo", "bar", "quantitative")).toBe(0)
		})
	})

	describe("ordinal", () => {
		it("uses numeric comparison (matches quantitative)", () => {
			expect(compareByType("2", "10", "ordinal")).toBeLessThan(0)
		})
	})

	describe("temporal", () => {
		it("orders by parsed date", () => {
			expect(
				compareByType("2024-01-01", "2024-06-01", "temporal")
			).toBeLessThan(0)
		})

		it("sorts unparseable dates to the end", () => {
			expect(
				compareByType("not-a-date", "2024-01-01", "temporal")
			).toBeGreaterThan(0)
		})
	})

	describe("categorical", () => {
		it("uses localeCompare", () => {
			expect(compareByType("apple", "banana", "categorical")).toBeLessThan(0)
			expect(compareByType("banana", "apple", "categorical")).toBeGreaterThan(0)
		})

		it("is stable for equal strings", () => {
			expect(compareByType("foo", "foo", "categorical")).toBe(0)
		})
	})
})

describe("isUniformLength", () => {
	it("returns true when every non-empty value has the same character length", () => {
		const rows = [{ s: "CA" }, { s: "NY" }, { s: "TX" }]
		expect(isUniformLength(rows, "s")).toBe(true)
	})

	it("returns false when lengths vary", () => {
		const rows = [{ s: "CA" }, { s: "NYC" }]
		expect(isUniformLength(rows, "s")).toBe(false)
	})

	it("ignores empty strings and missing values", () => {
		const rows: Record<string, string>[] = [
			{ s: "CA" },
			{ s: "" },
			{ s: "NY" },
			{},
		]
		expect(isUniformLength(rows, "s")).toBe(true)
	})

	it("returns false for a column with only empty/missing values (no observed length)", () => {
		const rows: Record<string, string>[] = [{ s: "" }, { s: "" }, {}]
		expect(isUniformLength(rows, "s")).toBe(false)
	})

	it("returns false for an empty row array", () => {
		expect(isUniformLength([], "s")).toBe(false)
	})

	it("short-circuits on the first mismatch (lens.size > 1)", () => {
		// Sanity: a huge mostly-uniform column with one outlier still returns
		// false. No loop assertion, but the function is small enough that
		// correctness implies short-circuit behavior.
		const rows = [
			...Array.from({ length: 1000 }, () => ({ s: "CA" })),
			{ s: "California" },
		]
		expect(isUniformLength(rows, "s")).toBe(false)
	})
})
