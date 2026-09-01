import { describe, expect, it } from "vitest"

import { applyDollarConversionToView, parseDollarCell } from "./dollarCells"
import type { DatasetView, FieldType } from "./types"

describe("parseDollarCell", () => {
	it("parses dollar-formatted cells", () => {
		expect(parseDollarCell("$1,234.56")).toEqual({
			value: 1234.56,
			dollar: true,
		})
		expect(parseDollarCell("$1234.56")).toEqual({
			value: 1234.56,
			dollar: true,
		})
		expect(parseDollarCell("$5")).toEqual({ value: 5, dollar: true })
		expect(parseDollarCell("$ 1,234")).toEqual({ value: 1234, dollar: true })
		expect(parseDollarCell("$.50")).toEqual({ value: 0.5, dollar: true })
		expect(parseDollarCell(" $1,234,567.89 ")).toEqual({
			value: 1234567.89,
			dollar: true,
		})
	})

	it("parses comma-grouped plain numbers (dollar: false)", () => {
		expect(parseDollarCell("1,234")).toEqual({ value: 1234, dollar: false })
		expect(parseDollarCell("1,234.5")).toEqual({
			value: 1234.5,
			dollar: false,
		})
		expect(parseDollarCell("12,345,678")).toEqual({
			value: 12345678,
			dollar: false,
		})
	})

	it("handles negatives: leading sign, sign after $, accounting parens", () => {
		expect(parseDollarCell("-$1,234")).toEqual({ value: -1234, dollar: true })
		expect(parseDollarCell("$-1,234")).toEqual({ value: -1234, dollar: true })
		expect(parseDollarCell("($1,234.56)")).toEqual({
			value: -1234.56,
			dollar: true,
		})
		expect(parseDollarCell("(1,234)")).toEqual({ value: -1234, dollar: false })
		expect(parseDollarCell("-1,234")).toEqual({ value: -1234, dollar: false })
		expect(parseDollarCell("+$5")).toEqual({ value: 5, dollar: true })
	})

	it("returns null for plain numbers — they need no conversion", () => {
		expect(parseDollarCell("1234")).toBeNull()
		expect(parseDollarCell("1234.56")).toBeNull()
		expect(parseDollarCell("-5")).toBeNull()
		expect(parseDollarCell("1e3")).toBeNull()
	})

	it("rejects malformed grouping (European decimal commas included)", () => {
		expect(parseDollarCell("1,23")).toBeNull()
		expect(parseDollarCell("12,34,56")).toBeNull()
		expect(parseDollarCell("1.234,56")).toBeNull()
		expect(parseDollarCell("$1,2345")).toBeNull()
	})

	it("rejects non-numeric and degenerate values", () => {
		expect(parseDollarCell("Surgery")).toBeNull()
		expect(parseDollarCell("$")).toBeNull()
		expect(parseDollarCell("$$5")).toBeNull()
		expect(parseDollarCell("$abc")).toBeNull()
		expect(parseDollarCell("14%")).toBeNull()
		expect(parseDollarCell("-$-5")).toBeNull()
		expect(parseDollarCell("(-$5)")).toBeNull()
		expect(parseDollarCell("")).toBeNull()
		expect(parseDollarCell(null)).toBeNull()
		expect(parseDollarCell(undefined)).toBeNull()
		expect(parseDollarCell(1234)).toBeNull()
	})
})

const makeView = (
	rows: Array<Record<string, string>>,
	fields: Array<{ name: string; inferredType: FieldType }>
): DatasetView => ({
	id: "d1",
	name: "test",
	filename: "test.csv",
	fields,
	rows,
	createdAt: 0,
	versionId: "dv1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

describe("applyDollarConversionToView", () => {
	it("converts dollar cells in an inferred-quantitative column and tags the hint", () => {
		const view = makeView(
			[
				{ Region: "East", Revenue: "$1,234.56" },
				{ Region: "West", Revenue: "$789" },
			],
			[
				{ name: "Region", inferredType: "categorical" },
				{ name: "Revenue", inferredType: "quantitative" },
			]
		)
		const out = applyDollarConversionToView(view, {})
		expect(out?.rows).toEqual([
			{ Region: "East", Revenue: "1234.56" },
			{ Region: "West", Revenue: "789" },
		])
		expect(out?.fields.find((f) => f.name === "Revenue")?.formatHint).toBe(
			"dollar"
		)
		expect(out?.fields.find((f) => f.name === "Region")?.formatHint)
			.toBeUndefined()
	})

	it("converts comma-only columns WITHOUT the dollar hint", () => {
		const view = makeView(
			[{ Count: "1,234" }, { Count: "56" }],
			[{ name: "Count", inferredType: "quantitative" }]
		)
		const out = applyDollarConversionToView(view, {})
		expect(out?.rows).toEqual([{ Count: "1234" }, { Count: "56" }])
		expect(out?.fields[0]?.formatHint).toBeUndefined()
	})

	it("skips a dollar column the user has overridden to categorical", () => {
		const view = makeView(
			[{ Revenue: "$1,234" }],
			[{ name: "Revenue", inferredType: "quantitative" }]
		)
		const out = applyDollarConversionToView(view, { Revenue: "categorical" })
		expect(out).toBe(view)
	})

	it("converts a legacy categorical dollar column once overridden to quantitative", () => {
		const view = makeView(
			[{ Revenue: "$1,234" }],
			[{ name: "Revenue", inferredType: "categorical" }]
		)
		const out = applyDollarConversionToView(view, { Revenue: "quantitative" })
		expect(out?.rows).toEqual([{ Revenue: "1234" }])
		expect(out?.fields[0]?.formatHint).toBe("dollar")
	})

	it("passes plain and empty cells through untouched in a converted column", () => {
		const view = makeView(
			[{ Revenue: "$5" }, { Revenue: "12.5" }, { Revenue: "" }],
			[{ name: "Revenue", inferredType: "quantitative" }]
		)
		const out = applyDollarConversionToView(view, {})
		expect(out?.rows).toEqual([
			{ Revenue: "5" },
			{ Revenue: "12.5" },
			{ Revenue: "" },
		])
	})

	it("returns the same view object when nothing converts", () => {
		const view = makeView(
			[{ Value: "12", Name: "a" }],
			[
				{ name: "Value", inferredType: "quantitative" },
				{ name: "Name", inferredType: "categorical" },
			]
		)
		expect(applyDollarConversionToView(view, {})).toBe(view)
		expect(applyDollarConversionToView(undefined, {})).toBeUndefined()
	})
})
