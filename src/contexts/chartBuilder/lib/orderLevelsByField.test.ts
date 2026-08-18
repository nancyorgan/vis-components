import { describe, expect, it } from "vitest"

import { alphabeticalLevelOrder, orderLevelsByField } from "./orderLevelsByField"

const rows = (pairs: Array<[string, string]>) =>
	pairs.map(([r, v]) => ({ region: r, sales: v }))

describe("orderLevelsByField", () => {
	describe("quantitative", () => {
		it("orders levels by the SUM of their cells, ascending", () => {
			const data = rows([
				["B", "1"],
				["A", "5"],
				["B", "1"],
				["C", "3"],
			])
			expect(
				orderLevelsByField(data, "region", "categorical", "sales", "quantitative", false)
			).toEqual(["B", "C", "A"])
		})

		it("reverses valued levels when decreasing", () => {
			const data = rows([
				["B", "1"],
				["A", "5"],
				["B", "1"],
				["C", "3"],
			])
			expect(
				orderLevelsByField(data, "region", "categorical", "sales", "quantitative", true)
			).toEqual(["A", "C", "B"])
		})

		it("skips blank / non-numeric cells instead of counting them as 0", () => {
			// D's only cells are blank/junk → D is MISSING, not sum 0; it must
			// land last, after E whose sum is a legitimate negative number.
			const data = rows([
				["D", ""],
				["D", "n/a"],
				["E", "-2"],
				["A", "5"],
			])
			expect(
				orderLevelsByField(data, "region", "categorical", "sales", "quantitative", false)
			).toEqual(["E", "A", "D"])
		})

		it("keeps missing levels last even when decreasing", () => {
			const data = rows([
				["D", ""],
				["E", "-2"],
				["A", "5"],
			])
			expect(
				orderLevelsByField(data, "region", "categorical", "sales", "quantitative", true)
			).toEqual(["A", "E", "D"])
		})

		it("appends multiple missing levels in smart-sort order", () => {
			// Ordinal numeric levels smart-sort numerically: 2 before 10.
			const data = rows([
				["10", ""],
				["2", ""],
				["1", "7"],
			])
			expect(
				orderLevelsByField(data, "region", "ordinal", "sales", "quantitative", false)
			).toEqual(["1", "2", "10"])
		})

		it("breaks ties by smart-sort order", () => {
			const data = rows([
				["10", "4"],
				["2", "4"],
				["1", "9"],
			])
			expect(
				orderLevelsByField(data, "region", "ordinal", "sales", "quantitative", false)
			).toEqual(["2", "10", "1"])
		})
	})

	describe("temporal", () => {
		it("orders levels by their EARLIEST parseable date", () => {
			const data = [
				{ region: "A", start: "2024-06-01" },
				{ region: "A", start: "2023-01-15" },
				{ region: "B", start: "2023-06-01" },
				{ region: "C", start: "2022-12-31" },
			]
			expect(
				orderLevelsByField(data, "region", "categorical", "start", "temporal", false)
			).toEqual(["C", "A", "B"])
		})

		it("treats levels with no parseable date as missing (last)", () => {
			const data = [
				{ region: "A", start: "not a date" },
				{ region: "B", start: "2023-06-01" },
			]
			expect(
				orderLevelsByField(data, "region", "categorical", "start", "temporal", true)
			).toEqual(["B", "A"])
		})
	})

	it("discovers levels like the panel: skips blank cells of the field itself", () => {
		const data = rows([
			["", "9"],
			["A", "1"],
			["B", "2"],
		])
		expect(
			orderLevelsByField(data, "region", "categorical", "sales", "quantitative", false)
		).toEqual(["A", "B"])
	})

	describe("scope (\"in the ___ level of ___ variable\")", () => {
		// The dumbbell case: long data, two rows per region; ordering must be
		// able to use ONE year's end, not the sum of both.
		const dumbbell = [
			{ region: "A", year: "2023", sales: "9" },
			{ region: "A", year: "2024", sales: "1" },
			{ region: "B", year: "2023", sales: "2" },
			{ region: "B", year: "2024", sales: "8" },
			{ region: "C", year: "2023", sales: "5" },
			{ region: "C", year: "2024", sales: "5" },
		]

		it("aggregates only the rows matching the scope level", () => {
			// 2024 sales: A=1, B=8, C=5 → A, C, B (the unscoped sums would tie).
			expect(
				orderLevelsByField(dumbbell, "region", "categorical", "sales", "quantitative", false, {
					field: "year",
					value: "2024",
				})
			).toEqual(["A", "C", "B"])
			// 2023 sales: B=2, C=5, A=9.
			expect(
				orderLevelsByField(dumbbell, "region", "categorical", "sales", "quantitative", false, {
					field: "year",
					value: "2023",
				})
			).toEqual(["B", "C", "A"])
		})

		it("respects decreasing within the scope", () => {
			expect(
				orderLevelsByField(dumbbell, "region", "categorical", "sales", "quantitative", true, {
					field: "year",
					value: "2024",
				})
			).toEqual(["B", "C", "A"])
		})

		it("treats levels with no rows in the scope as missing (last)", () => {
			const data = [
				{ region: "A", year: "2023", sales: "9" },
				{ region: "B", year: "2024", sales: "2" },
				{ region: "C", year: "2024", sales: "5" },
			]
			expect(
				orderLevelsByField(data, "region", "categorical", "sales", "quantitative", true, {
					field: "year",
					value: "2024",
				})
			).toEqual(["C", "B", "A"])
		})

		it("scopes temporal aggregation too", () => {
			const data = [
				{ region: "A", phase: "start", when: "2020-01-01" },
				{ region: "A", phase: "end", when: "2025-01-01" },
				{ region: "B", phase: "start", when: "2021-01-01" },
				{ region: "B", phase: "end", when: "2023-01-01" },
			]
			// Unscoped earliest: A=2020 < B=2021; scoped to phase=end: B < A.
			expect(
				orderLevelsByField(data, "region", "categorical", "when", "temporal", false, {
					field: "phase",
					value: "end",
				})
			).toEqual(["B", "A"])
		})
	})

	it("returns the FULL level list and does not mutate rows", () => {
		const data = rows([
			["A", "2"],
			["B", "1"],
		])
		const snapshot = data.map((r) => ({ ...r }))
		const out = orderLevelsByField(
			data,
			"region",
			"categorical",
			"sales",
			"quantitative",
			false
		)
		expect([...out].sort()).toEqual(["A", "B"])
		expect(data).toEqual(snapshot)
	})
})

describe("alphabeticalLevelOrder", () => {
	it("sorts locale-aware with numeric substring awareness", () => {
		expect(
			alphabeticalLevelOrder(["Region 10", "Region 2", "Region 1"], false)
		).toEqual(["Region 1", "Region 2", "Region 10"])
	})

	it("sorts numeric level names naturally (2 before 10)", () => {
		expect(alphabeticalLevelOrder(["10", "2", "1"], false)).toEqual([
			"1",
			"2",
			"10",
		])
	})

	it("reverses when decreasing", () => {
		expect(alphabeticalLevelOrder(["b", "a", "c"], true)).toEqual([
			"c",
			"b",
			"a",
		])
	})

	it("does not mutate the input", () => {
		const input = ["b", "a"]
		const out = alphabeticalLevelOrder(input, false)
		expect(input).toEqual(["b", "a"])
		expect(out).not.toBe(input)
	})
})
