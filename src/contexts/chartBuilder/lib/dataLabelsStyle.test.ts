import { describe, expect, it } from "vitest"

import { buildLabelSegments, buildLabelText, formatField } from "./dataLabelsStyle"
import type { DataLabelsEncodings } from "./types"

type Cfg = Parameters<typeof buildLabelText>[2]

const cfg = (over: Partial<Cfg> = {}): Cfg => ({
	decimals: null,
	labelTemplate: "",
	fieldFormats: {},
	...over,
})

const single = (
	field: string | null
): DataLabelsEncodings["value"] => ({ field })
const multi = (fields: string[]): DataLabelsEncodings["value"] => ({
	field: null,
	multiField: true,
	fields,
})

describe("formatField", () => {
	it("applies a d3 percent spec", () => {
		expect(formatField(0.324, ".1%", null)).toBe("32.4%")
	})
	it("applies a d3 currency + grouping spec", () => {
		expect(formatField(1200, "$,.0f", null)).toBe("$1,200")
	})
	it("coerces numeric strings through the spec", () => {
		expect(formatField("0.5", ".0%", null)).toBe("50%")
	})
	it("falls back to decimals when no spec", () => {
		expect(formatField(3.14159, undefined, 2)).toBe("3.14")
	})
	it("returns empty string for null/undefined", () => {
		expect(formatField(null, ".1%", null)).toBe("")
		expect(formatField(undefined, undefined, 2)).toBe("")
	})
})

describe("buildLabelText — single-field (unchanged behavior)", () => {
	it("formats the mapped field with decimals", () => {
		expect(buildLabelText({ v: 3.14159 }, single("v"), cfg({ decimals: 1 }))).toBe(
			"3.1"
		)
	})
	it("falls back to the position field when value is unmapped", () => {
		expect(buildLabelText({ x: "Aug" }, single(null), cfg(), "x")).toBe("Aug")
	})
	it("returns null when nothing is mapped", () => {
		expect(buildLabelText({ x: 1 }, single(null), cfg())).toBeNull()
	})
})

describe("buildLabelText — multi-field", () => {
	const row = { Region: "Northeast", Share: 0.324, Value: 1200 }

	it("joins selected fields with ', ' when no template", () => {
		expect(buildLabelText(row, multi(["Region", "Share"]), cfg())).toBe(
			"Northeast, 0.324"
		)
	})

	it("substitutes {Field} tokens in the template", () => {
		expect(
			buildLabelText(row, multi(["Region", "Share"]), cfg({
				labelTemplate: "{Region} ({Share})",
			}))
		).toBe("Northeast (0.324)")
	})

	it("applies per-field number formats", () => {
		expect(
			buildLabelText(row, multi(["Region", "Share"]), cfg({
				labelTemplate: "{Region} ({Share})",
				fieldFormats: { Share: ".1%" },
			}))
		).toBe("Northeast (32.4%)")
	})

	it("mixes a category with a formatted currency value", () => {
		expect(
			buildLabelText(row, multi(["Region", "Value"]), cfg({
				labelTemplate: "{Value} — {Region}",
				fieldFormats: { Value: "$,.0f" },
			}))
		).toBe("$1,200 — Northeast")
	})

	it("leaves tokens that name a non-selected field literal", () => {
		expect(
			buildLabelText(row, multi(["Region"]), cfg({
				labelTemplate: "{Region} {Share}",
			}))
		).toBe("Northeast {Share}")
	})

	it("returns null when no fields are selected", () => {
		expect(buildLabelText(row, multi([]), cfg())).toBeNull()
	})

	it("falls back to shared decimals for a field without a spec", () => {
		expect(
			buildLabelText(row, multi(["Share"]), cfg({ decimals: 2 }))
		).toBe("0.32")
	})
})

describe("buildLabelSegments", () => {
	const row = { Region: "Northeast", Share: 0.324, Value: 1200 }

	it("single mode → one segment tagged with the field", () => {
		expect(buildLabelSegments({ v: 3 }, single("v"), cfg())).toEqual([
			{ text: "3", field: "v" },
		])
	})

	it("tags value segments with their field and separators as literal", () => {
		expect(
			buildLabelSegments(row, multi(["Region", "Share"]), cfg({
				labelTemplate: "{Region} ({Share})",
				fieldFormats: { Share: ".1%" },
			}))
		).toEqual([
			{ text: "Northeast", field: "Region" },
			{ text: " (", field: null },
			{ text: "32.4%", field: "Share" },
			{ text: ")", field: null },
		])
	})

	it("default template joins fields with a literal ', ' between them", () => {
		expect(
			buildLabelSegments(row, multi(["Region", "Value"]), cfg())
		).toEqual([
			{ text: "Northeast", field: "Region" },
			{ text: ", ", field: null },
			{ text: "1200", field: "Value" },
		])
	})

	it("keeps a non-selected token literal (untagged)", () => {
		expect(
			buildLabelSegments(row, multi(["Region"]), cfg({
				labelTemplate: "{Region} {Share}",
			}))
		).toEqual([
			{ text: "Northeast", field: "Region" },
			{ text: " ", field: null },
			{ text: "{Share}", field: null },
		])
	})

	it("returns null when nothing renders", () => {
		expect(buildLabelSegments(row, multi([]), cfg())).toBeNull()
		expect(buildLabelSegments({ v: null }, single("v"), cfg())).toBeNull()
	})

	it("joins to the same string buildLabelText returns", () => {
		const value = multi(["Region", "Share"])
		const c = cfg({ labelTemplate: "{Region}: {Share}", fieldFormats: { Share: ".0%" } })
		const segs = buildLabelSegments(row, value, c) ?? []
		expect(segs.map((s) => s.text).join("")).toBe(buildLabelText(row, value, c))
	})
})
