import { describe, expect, it } from "vitest"

import {
	firstMatchingRule,
	parseCondition,
	parseRule,
	resolveRuleColor,
} from "./textColorRules"

describe("parseRule", () => {
	it("parses each operator with and without whitespace", () => {
		expect(parseRule(">5")).toEqual({ op: ">", num: 5, text: "5" })
		expect(parseRule("> 5")).toEqual({ op: ">", num: 5, text: "5" })
		expect(parseRule(">=10")).toEqual({ op: ">=", num: 10, text: "10" })
		expect(parseRule("<= -2")).toEqual({ op: "<=", num: -2, text: "-2" })
		expect(parseRule("==0")).toEqual({ op: "==", num: 0, text: "0" })
		expect(parseRule("!=  3")).toEqual({ op: "!=", num: 3, text: "3" })
	})

	it("parses non-numeric operands (num null) and strips surrounding quotes", () => {
		expect(parseRule('=="A"')).toEqual({ op: "==", num: null, text: "A" })
		expect(parseRule("== A")).toEqual({ op: "==", num: null, text: "A" })
		expect(parseRule(">abc")).toEqual({ op: ">", num: null, text: "abc" })
	})

	it("returns null when the operator is missing or the condition is empty", () => {
		expect(parseRule("")).toBeNull()
		expect(parseRule("5")).toBeNull() // no operator
		expect(parseRule(">")).toBeNull()
	})
})

describe("resolveRuleColor", () => {
	const rules = [
		{ condition: "> 50", color: "#fff" },
		{ condition: "< 10", color: "#000" },
	]

	it("returns the first matching rule's color", () => {
		expect(resolveRuleColor(rules, 75)).toBe("#fff")
		expect(resolveRuleColor(rules, 5)).toBe("#000")
	})

	it("returns null when no rule matches", () => {
		expect(resolveRuleColor(rules, 30)).toBeNull()
	})

	it("returns null for ordering rules against non-numeric / null / undefined values", () => {
		const nothing: unknown = void 0
		expect(resolveRuleColor(rules, "hello")).toBeNull()
		expect(resolveRuleColor(rules, null)).toBeNull()
		expect(resolveRuleColor(rules, nothing)).toBeNull()
		expect(resolveRuleColor(rules, Number.NaN)).toBeNull()
	})

	it("matches categorical values via == / != string equality", () => {
		const catRules = [
			{ condition: '=="A"', color: "#aaa" },
			{ condition: "!= B", color: "#ccc" },
		]
		// First rule wins for "A".
		expect(resolveRuleColor(catRules, "A")).toBe("#aaa")
		// "C" fails the == rule but passes "!= B".
		expect(resolveRuleColor(catRules, "C")).toBe("#ccc")
		// "B" fails both (== A no, != B no).
		expect(resolveRuleColor(catRules, "B")).toBeNull()
		// Nullish values never trigger, even with a != rule.
		expect(resolveRuleColor(catRules, null)).toBeNull()
	})

	it("coerces numeric strings — heatmap valueByCell sometimes carries them", () => {
		expect(resolveRuleColor(rules, "75")).toBe("#fff")
	})

	it("skips unparseable rules and falls through to the next", () => {
		const mixed = [
			{ condition: "not a comparison", color: "#bad" },
			{ condition: "> 0", color: "#good" },
		]
		expect(resolveRuleColor(mixed, 5)).toBe("#good")
	})

	it("returns null for an empty / undefined rules list", () => {
		expect(resolveRuleColor([], 5)).toBeNull()
		expect(resolveRuleColor(undefined, 5)).toBeNull()
	})
})

describe("firstMatchingRule", () => {
	// Position-rule-shaped payloads — the generic must hand back the WHOLE
	// rule so callers can read offsets (or any other payload) off the match.
	const rules = [
		{ condition: "< 0", xOffset: 0, yOffset: 12 },
		{ condition: ">= 100", xOffset: 5, yOffset: -12 },
	]

	it("returns the first matching rule object", () => {
		expect(firstMatchingRule(rules, -3)).toBe(rules[0])
		expect(firstMatchingRule(rules, 150)).toBe(rules[1])
	})

	it("returns null when no rule matches or the value is nullish", () => {
		expect(firstMatchingRule(rules, 50)).toBeNull()
		expect(firstMatchingRule(rules, null)).toBeNull()
		expect(firstMatchingRule(rules, undefined)).toBeNull()
	})

	it("coerces numeric strings like resolveRuleColor does", () => {
		expect(firstMatchingRule(rules, "-3")).toBe(rules[0])
	})
})

describe("{Variable} rules", () => {
	it("parses a leading {Variable} token into `field`", () => {
		expect(parseRule("{Region} == West")).toEqual({
			field: "Region",
			op: "==",
			num: null,
			text: "West",
		})
		expect(parseRule('  {Unit price}>= "2.5"')).toEqual({
			field: "Unit price",
			op: ">=",
			num: 2.5,
			text: "2.5",
		})
		// Unclosed / empty token, or a token with no comparison → no rule.
		expect(parseRule("{Region == West")).toBeNull()
		expect(parseRule("{} == West")).toBeNull()
		expect(parseRule("{Region}")).toBeNull()
		expect(parseRule("{Region} ==")).toBeNull()
	})

	const rules = [
		{ condition: "{Region} == West", color: "#00f" },
		{ condition: "{Profit} < 0", color: "#f00" },
		{ condition: "> 100", color: "#0f0" },
	]

	it("tests the referenced variable in the mark's row, not the labeled value", () => {
		expect(resolveRuleColor(rules, 5, [{ Region: "West", Profit: "3" }])).toBe(
			"#00f"
		)
		expect(resolveRuleColor(rules, 5, [{ Region: "East", Profit: "-3" }])).toBe(
			"#f00"
		)
		// Neither variable rule matches → the implicit rule still reads `value`.
		expect(
			resolveRuleColor(rules, 150, [{ Region: "East", Profit: "3" }])
		).toBe("#0f0")
	})

	it("passes only when EVERY row of a multi-row mark passes", () => {
		const allWest = [
			{ Region: "West", Profit: "1" },
			{ Region: "West", Profit: "2" },
		]
		const mixed = [
			{ Region: "West", Profit: "1" },
			{ Region: "East", Profit: "-2" },
		]
		expect(resolveRuleColor(rules, 5, allWest)).toBe("#00f")
		// One East row spoils `{Region} == West`; one positive row spoils
		// `{Profit} < 0`.
		expect(resolveRuleColor(rules, 5, mixed)).toBeNull()
	})

	it("never fires without rows (legend swatches) or on a blank cell", () => {
		expect(resolveRuleColor(rules, 5)).toBeNull()
		expect(resolveRuleColor(rules, 5, [])).toBeNull()
		const ne = [{ condition: "{Region} != West", color: "#ccc" }]
		expect(resolveRuleColor(ne, 5, [{ Region: "" }])).toBeNull()
		expect(resolveRuleColor(ne, 5, [{}])).toBeNull()
	})

	it("fires for a nullish labeled value — the variable carries the test", () => {
		expect(resolveRuleColor(rules, null, [{ Region: "West" }])).toBe("#00f")
	})
})

describe("AND / OR compound conditions", () => {
	const cmp = (field: string | undefined, op: string, text: string) => ({
		kind: "compare",
		cmp: {
			...(field === undefined ? {} : { field }),
			op,
			num: Number.isFinite(Number(text)) ? Number(text) : null,
			text,
		},
	})

	it("parses AND / OR (any case) with AND binding before OR", () => {
		expect(parseCondition("{A} == a AND {B} == b")).toEqual({
			kind: "and",
			parts: [cmp("A", "==", "a"), cmp("B", "==", "b")],
		})
		expect(parseCondition("> 5 and < 10")).toEqual({
			kind: "and",
			parts: [cmp(undefined, ">", "5"), cmp(undefined, "<", "10")],
		})
		// a OR b AND c → a OR (b AND c)
		expect(parseCondition("{A} == a OR {B} == b AND {C} > 3")).toEqual({
			kind: "or",
			parts: [
				cmp("A", "==", "a"),
				{ kind: "and", parts: [cmp("B", "==", "b"), cmp("C", ">", "3")] },
			],
		})
		// A single comparison is just that comparison.
		expect(parseCondition("{A} == a")).toEqual(cmp("A", "==", "a"))
	})

	it("keeps a text operand that merely contains the word, quoted or not", () => {
		// Unquoted: the right-hand piece isn't a comparison, so the whole
		// string stays one comparison against the text "Black and White".
		expect(parseCondition("== Black and White")).toEqual(
			cmp(undefined, "==", "Black and White")
		)
		expect(parseCondition('{Region} == "North or South"')).toEqual(
			cmp("Region", "==", "North or South")
		)
		// An apostrophe inside an operand doesn't open a quote.
		expect(parseCondition("{Name} == O'Brien AND {Profit} > 0")).toEqual({
			kind: "and",
			parts: [cmp("Name", "==", "O'Brien"), cmp("Profit", ">", "0")],
		})
		// `&` / `|` are not connectives — nothing parses, so nothing fires.
		expect(parseCondition("{A} == a & {B} == b")).toEqual(
			cmp("A", "==", "a & {B} == b")
		)
	})

	it("never fires an unfinished compound rule", () => {
		// A dangling connective or an operand-less piece falls back to ONE
		// comparison against the literal text, which no value equals.
		const row = [{ A: "a", B: "b" }]
		for (const condition of ["{A} == a AND", "{A} == a OR", "{A} == a AND {B}"]) {
			expect(resolveRuleColor([{ condition, color: "#bad" }], 1, row)).toBeNull()
		}
		// A leading connective has no comparison at all.
		expect(parseCondition("AND {A} == a")).toBeNull()
	})

	const rules = [
		{ condition: "{Region} == West AND {Profit} < 0", color: "#f00" },
		{ condition: "{Region} == West OR {Region} == East", color: "#00f" },
		{ condition: "> 5 AND < 10", color: "#0f0" },
	]

	it("requires every AND piece and any OR piece, per row", () => {
		expect(resolveRuleColor(rules, 1, [{ Region: "West", Profit: -1 }])).toBe(
			"#f00"
		)
		expect(resolveRuleColor(rules, 1, [{ Region: "West", Profit: 1 }])).toBe(
			"#00f"
		)
		expect(resolveRuleColor(rules, 1, [{ Region: "East", Profit: -1 }])).toBe(
			"#00f"
		)
		expect(resolveRuleColor(rules, 1, [{ Region: "North", Profit: -1 }])).toBeNull()
	})

	it("mixes implicit and {Variable} pieces, and tests the implicit value alone", () => {
		expect(resolveRuleColor(rules, 7, [{ Region: "North" }])).toBe("#0f0")
		expect(resolveRuleColor(rules, 12, [{ Region: "North" }])).toBeNull()
		// No rows: only the implicit rule can fire.
		expect(resolveRuleColor(rules, 7)).toBe("#0f0")
		const mixed = [{ condition: "{Region} == West AND > 100", color: "#abc" }]
		expect(resolveRuleColor(mixed, 150, [{ Region: "West" }])).toBe("#abc")
		expect(resolveRuleColor(mixed, 50, [{ Region: "West" }])).toBeNull()
		expect(resolveRuleColor(mixed, 150)).toBeNull()
	})

	it("needs EVERY row of a multi-row mark to satisfy the whole condition", () => {
		const westAndEast = [
			{ Region: "West", Profit: -1 },
			{ Region: "East", Profit: -1 },
		]
		// Each row is West or East → the OR rule fires for the whole bar…
		expect(resolveRuleColor(rules, 1, westAndEast)).toBe("#00f")
		// …but the AND rule wants West on every row, and one row is East.
		expect(resolveRuleColor([rules[0]], 1, westAndEast)).toBeNull()
	})
})
