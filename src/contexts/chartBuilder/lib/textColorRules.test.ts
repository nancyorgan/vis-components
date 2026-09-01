import { describe, expect, it } from "vitest"

import { firstMatchingRule, parseRule, resolveRuleColor } from "./textColorRules"

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
