import { describe, expect, it } from "vitest"
import {
	evaluateExpression,
	evaluateToCell,
	formatNumericCell,
	parseExpression,
} from "./derivedExpression"

/** Parse-or-fail helper: asserts the expression parses, then evaluates it to
 * a cell string against the given row. */
const cell = (src: string, row: Record<string, string> = {}): string => {
	const parsed = parseExpression(src)
	if (!parsed.ok) throw new Error(`expected parse: ${parsed.error}`)
	return evaluateToCell(parsed.expr, row)
}

/** Same, evaluating to the raw ExprValue (for boolean conditions). */
const value = (src: string, row: Record<string, string> = {}) => {
	const parsed = parseExpression(src)
	if (!parsed.ok) throw new Error(`expected parse: ${parsed.error}`)
	return evaluateExpression(parsed.expr, row)
}

const error = (src: string): string => {
	const parsed = parseExpression(src)
	if (parsed.ok) throw new Error("expected a parse failure")
	return parsed.error
}

describe("parseExpression — arithmetic", () => {
	it("applies multiplicative-over-additive precedence", () => {
		expect(cell("1 + 2 * 3")).toBe("7")
		expect(cell("{A} + {B} / {C}", { A: "1", B: "6", C: "3" })).toBe("3")
	})

	it("parenthesizes", () => {
		expect(cell("({A} - {B}) * 100", { A: "0.75", B: "0.5" })).toBe("25")
		expect(cell("(1 + 2) * 3")).toBe("9")
	})

	it("handles unary minus", () => {
		expect(cell("-{A} + 5", { A: "2" })).toBe("3")
		expect(cell("-(1 + 2)")).toBe("-3")
		expect(cell("2 - -3")).toBe("5")
	})

	it("collects referenced fields, deduplicated", () => {
		const parsed = parseExpression("{A} + {B} * {A}")
		expect(parsed.ok && parsed.fields).toEqual(["A", "B"])
	})
})

describe("evaluate — blank poisoning", () => {
	it("blanks the row on a non-numeric operand", () => {
		expect(cell("{A} + 1", { A: "hello" })).toBe("")
	})

	it("blanks the row on a blank or missing cell", () => {
		expect(cell("{A} + 1", { A: "" })).toBe("")
		expect(cell("{A} + 1", { A: "   " })).toBe("")
		expect(cell("{Missing} + 1", {})).toBe("")
	})

	it("blanks the row on division by zero", () => {
		expect(cell("{A} / {B}", { A: "1", B: "0" })).toBe("")
		expect(cell("{A} / {B}", { A: "0", B: "0" })).toBe("")
	})

	it("trims float noise", () => {
		expect(cell("{A} + {B}", { A: "0.1", B: "0.2" })).toBe("0.3")
		expect(formatNumericCell(0.30000000000000004)).toBe("0.3")
		expect(formatNumericCell(3)).toBe("3")
	})
})

describe("evaluate — comparisons", () => {
	it("compares numerically when both sides read as numbers", () => {
		expect(value("{B} > 3", { B: "10" })).toBe(true)
		expect(value("{B} > 3", { B: "2" })).toBe(false)
		expect(value("{B} == 1", { B: "1.0" })).toBe(true)
		expect(value("{B} != 1", { B: "2" })).toBe(true)
	})

	it("falls back to string equality (quotes optional, both styles)", () => {
		expect(value('{Region} == "West"', { Region: "West" })).toBe(true)
		expect(value("{Region} == 'West'", { Region: "West" })).toBe(true)
		expect(value('{Region} != "West"', { Region: "East" })).toBe(true)
	})

	it("ordering operators are numeric-only", () => {
		expect(value('{Region} > "Alpha"', { Region: "Beta" })).toBe(false)
	})

	it("blank cells never satisfy any comparison, != included", () => {
		expect(value("{B} > 0", { B: "" })).toBe(false)
		expect(value("{B} == 1", { B: "" })).toBe(false)
		expect(value("{B} != 1", { B: "" })).toBe(false)
		expect(value("{Missing} != 1", {})).toBe(false)
	})
})

describe("evaluate — AND / OR", () => {
	it("evaluates Nancy's examples", () => {
		expect(value("1 < {B} OR {B} < 2", { B: "5" })).toBe(true)
		expect(value("1 < {B} OR {B} < 2", { B: "1.5" })).toBe(true)
		expect(value("{B} == 1 AND {C} > 3", { B: "1", C: "4" })).toBe(true)
		expect(value("{B} == 1 AND {C} > 3", { B: "1", C: "2" })).toBe(false)
		expect(value("{B} == 1 AND {C} > 3", { B: "2", C: "9" })).toBe(false)
	})

	it("binds AND tighter than OR", () => {
		// a OR (b AND c), not (a OR b) AND c
		expect(value("{A} == 1 OR {A} == 2 AND {B} == 9", { A: "1", B: "0" })).toBe(
			true
		)
		expect(value("{A} == 1 OR {A} == 2 AND {B} == 9", { A: "2", B: "0" })).toBe(
			false
		)
	})

	it("accepts lowercase keywords and parenthesized logic", () => {
		expect(value("{A} == 1 and {B} == 2", { A: "1", B: "2" })).toBe(true)
		expect(value("({A} == 1 or {A} == 2) AND {B} == 9", { A: "2", B: "9" })).toBe(
			true
		)
	})

	it("treats non-boolean logic operands as false rather than truthy", () => {
		expect(value("{A} AND {B} == 2", { A: "1", B: "2" })).toBe(false)
	})
})

describe("parseExpression — failures", () => {
	it("rejects empty and unfinished expressions", () => {
		expect(error("")).toMatch(/empty/i)
		expect(error("{A} +")).toMatch(/Expected a value/)
	})

	it("rejects unterminated tokens", () => {
		expect(error("{A + 1")).toMatch(/Missing "}"/)
		expect(error('{A} == "West')).toMatch(/Missing closing/)
		expect(error("{} + 1")).toMatch(/Empty {}/)
	})

	it("points a single = at ==", () => {
		expect(error("{A} = 1")).toMatch(/Use "=="/)
	})

	it("rejects bare words with a braces hint", () => {
		expect(error("A + 1")).toMatch(/braces, like \{A\}/)
	})

	it("rejects trailing junk and chained comparisons", () => {
		expect(error("1 2")).toMatch(/Unexpected/)
		expect(error("1 < {B} < 2")).toMatch(/Unexpected "<"/)
	})
})

describe("evaluateToCell — non-numeric results", () => {
	it("spells out booleans and passes strings through", () => {
		expect(cell("{A} > 1", { A: "5" })).toBe("true")
		expect(cell('"label"')).toBe("label")
	})
})
