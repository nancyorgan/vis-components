import { describe, expect, it } from "vitest"

import { inferFieldType } from "./inferFieldType"

describe("inferFieldType", () => {
	it("returns 'categorical' for an empty input", () => {
		// No data means we can't infer — fall back to the safest, most
		// permissive type. (Pinning this as the contract so callers can
		// rely on it.)
		expect(inferFieldType([])).toBe("categorical")
	})

	it("returns 'categorical' when every value is empty / whitespace", () => {
		expect(inferFieldType(["", "   ", "\t"])).toBe("categorical")
	})

	it("returns 'quantitative' when every value parses as a finite number", () => {
		expect(inferFieldType(["1", "2", "3", "4"])).toBe("quantitative")
		expect(inferFieldType(["1.5", "-2.5", "0"])).toBe("quantitative")
	})

	it("returns 'quantitative' even with scientific notation", () => {
		// Number("1e3") === 1000 — counts as numeric.
		expect(inferFieldType(["1e3", "1.5e-2"])).toBe("quantitative")
	})

	it("returns 'categorical' if any value isn't numeric (one non-number poisons the inference)", () => {
		// "Surgery" forces a fallback to categorical even with mostly-numeric data.
		expect(inferFieldType(["1", "2", "Surgery", "4"])).toBe("categorical")
	})

	it("returns 'temporal' when every value parses as a Date (and none is purely numeric)", () => {
		expect(inferFieldType(["2024-01-01", "2024-02-15", "2024-12-31"])).toBe(
			"temporal"
		)
	})

	it("does NOT classify pure numbers as temporal even though `new Date(n)` would succeed", () => {
		// Critical: the isTemporal helper explicitly rejects numeric strings
		// because Date() would happily parse them as epoch ms, giving
		// quantitative-looking data a spurious "temporal" tag.
		expect(inferFieldType(["100", "200", "300"])).toBe("quantitative")
	})

	it("returns 'categorical' when most values are dates but one isn't", () => {
		expect(
			inferFieldType(["2024-01-01", "2024-02-15", "not a date", "2024-12-31"])
		).toBe("categorical")
	})

	it("returns 'temporal' with ISO timestamps including time", () => {
		expect(
			inferFieldType(["2024-01-01T12:00:00Z", "2024-02-15T08:30:00Z"])
		).toBe("temporal")
	})

	it("returns 'categorical' for boolean-like strings (not numeric, not dates)", () => {
		expect(inferFieldType(["true", "false", "true"])).toBe("categorical")
	})

	it("ignores blank rows interspersed with real values when inferring", () => {
		// Empty cells should not poison numeric inference — they're filtered
		// out before the every-is-numeric check.
		expect(inferFieldType(["1", "", "  ", "2", "3"])).toBe("quantitative")
		expect(inferFieldType(["2024-01-01", "", "2024-02-01"])).toBe("temporal")
	})

	it("only samples the first 50 values (for big columns)", () => {
		// Generate 100 numeric values then a string — the string is past
		// the sample window, so inference should still come back numeric.
		const values = Array.from({ length: 100 }, (_, i) => String(i))
		values.push("not-a-number")
		expect(inferFieldType(values)).toBe("quantitative")
	})

	it("string '0' parses as a finite number", () => {
		expect(inferFieldType(["0"])).toBe("quantitative")
	})

	it("returns 'quantitative' for negative numbers", () => {
		expect(inferFieldType(["-1", "-2.5", "0"])).toBe("quantitative")
	})

	it("returns 'categorical' for mixed types (one of each)", () => {
		expect(inferFieldType(["1", "Surgery", "2024-01-01"])).toBe("categorical")
	})

	it("does NOT classify category labels that merely end in a number as temporal", () => {
		// `new Date("MS-DRG 235")` yanks "235" out as year 235 — these are
		// categories, not dates. Require a real date shape, not just a parseable
		// number buried in text.
		expect(inferFieldType(["MS-DRG 235", "MS-DRG 470", "MS-DRG 291"])).toBe(
			"categorical"
		)
		expect(inferFieldType(["Region 5", "Region 12", "Region 3"])).toBe(
			"categorical"
		)
		expect(inferFieldType(["Sales 2023", "Sales 2024"])).toBe("categorical")
	})

	it("still recognizes common real date formats", () => {
		expect(inferFieldType(["2024-01", "2024-02", "2024-03"])).toBe("temporal")
		expect(inferFieldType(["01/15/2024", "02/20/2024"])).toBe("temporal")
		expect(inferFieldType(["Mar 2024", "Apr 2024"])).toBe("temporal")
		expect(inferFieldType(["Jan 1, 2024", "Feb 15, 2024"])).toBe("temporal")
		expect(inferFieldType(["1 Mar 2024", "15 Apr 2024"])).toBe("temporal")
	})
})
