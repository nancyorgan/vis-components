import { describe, expect, it } from "vitest"
import {
	applyDerivedVariablesToView,
	buildDerivedCompute,
	derivedMathTypeIssues,
	derivedVariableIssues,
	firstNonNumericCell,
	makeNonNumericLookup,
	effectiveDerivedName,
	nextDefaultDerivedName,
	type DerivedVariable,
	type DerivedVariablesConfig,
} from "./derivedVariables"
import type { DatasetView, Field } from "./types"

const view = (
	fields: Field[],
	rows: Array<Record<string, string>>
): DatasetView => ({
	id: "ds-derived",
	name: "derived",
	filename: "derived.csv",
	fields,
	rows,
	createdAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

const q = (name: string): Field => ({ name, inferredType: "quantitative" })
const c = (name: string): Field => ({ name, inferredType: "categorical" })

const BASE = view(
	[c("region"), q("sales"), q("count")],
	[
		{ region: "West", sales: "10", count: "2" },
		{ region: "East", sales: "9", count: "3" },
		{ region: "West", sales: "", count: "4" },
	]
)

let seq = 0
const variable = (v: Partial<DerivedVariable>): DerivedVariable => ({
	id: `dvr-${++seq}`,
	name: "derived",
	kind: "math",
	...v,
})

const config = (...variables: DerivedVariable[]): DerivedVariablesConfig => ({
	variables,
})

describe("applyDerivedVariablesToView — identity", () => {
	it("passes the view through by identity when the config is empty", () => {
		expect(applyDerivedVariablesToView(BASE, config())).toBe(BASE)
	})

	it("passes the view through by identity when every variable is skipped", () => {
		const broken = config(
			variable({ name: "a", math: { formula: "{missing} + 1" } }),
			variable({ name: "b", math: { formula: "{sales +" } }),
			variable({ name: "region", math: { formula: "{sales} + 1" } })
		)
		expect(applyDerivedVariablesToView(BASE, broken)).toBe(BASE)
	})

	it("passes undefined through", () => {
		expect(
			applyDerivedVariablesToView(undefined, config(variable({})))
		).toBeUndefined()
	})
})

describe("applyDerivedVariablesToView — math", () => {
	it("appends a computed quantitative column, blanking bad rows", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({ name: "per unit", math: { formula: "{sales} / {count}" } })
			)
		)
		expect(next).not.toBe(BASE)
		const added = next?.fields.at(-1)
		expect(added).toMatchObject({
			name: "per unit",
			inferredType: "quantitative",
			derived: true,
		})
		expect(next?.rows.map((r) => r["per unit"])).toEqual(["5", "3", ""])
		// Upstream fields and cells are untouched.
		expect(next?.fields.slice(0, 3)).toEqual(BASE.fields)
		expect(next?.rows[0].sales).toBe("10")
	})
})

describe("applyDerivedVariablesToView — concat", () => {
	it("substitutes known tokens and keeps unknown tokens literal", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({
					name: "label",
					kind: "concat",
					concat: { template: "{region}: {sales} ({typo})" },
				})
			)
		)
		expect(next?.rows[0].label).toBe("West: 10 ({typo})")
		// Blank cell substitutes as empty string, not skipped.
		expect(next?.rows[2].label).toBe("West:  ({typo})")
		expect(next?.fields.at(-1)?.inferredType).toBe("categorical")
	})
})

describe("applyDerivedVariablesToView — rules", () => {
	it("first true condition wins; no match falls back", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({
					name: "tier",
					kind: "rules",
					rules: {
						rules: [
							{ condition: "{sales} >= 10", output: "high" },
							{ condition: '{region} == "East" AND {count} > 1', output: "east+" },
						],
						fallback: "other",
					},
				})
			)
		)
		expect(next?.rows.map((r) => r.tier)).toEqual(["high", "east+", "other"])
	})

	it("skips unparseable rules without killing the parseable ones", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({
					name: "tier",
					kind: "rules",
					rules: {
						rules: [
							{ condition: "{sales} >", output: "broken" },
							{ condition: "{sales} > 0", output: "ok" },
						],
						fallback: "none",
					},
				})
			)
		)
		expect(next?.rows.map((r) => r.tier)).toEqual(["ok", "ok", "none"])
	})
})

describe("applyDerivedVariablesToView — ordering and collisions", () => {
	it("lets a later variable reference an earlier one", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({ name: "double", math: { formula: "{sales} * 2" } }),
				variable({ name: "quadruple", math: { formula: "{double} * 2" } })
			)
		)
		expect(next?.rows[0].quadruple).toBe("40")
	})

	it("skips a forward reference (the referenced variable comes later)", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({ name: "quadruple", math: { formula: "{double} * 2" } }),
				variable({ name: "double", math: { formula: "{sales} * 2" } })
			)
		)
		expect(next?.fields.map((f) => f.name)).not.toContain("quadruple")
		expect(next?.rows[0].double).toBe("20")
	})

	it("skips a variable whose name collides with a real column — data wins", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(variable({ name: "sales", math: { formula: "{count} * 2" } }))
		)
		expect(next).toBe(BASE)
	})

	it("first variable wins a name collision between two derived variables", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({ name: "calc", math: { formula: "{sales} * 2" } }),
				variable({ name: "calc", math: { formula: "{sales} * 3" } })
			)
		)
		expect(next?.rows[0].calc).toBe("20")
		expect(next?.fields.filter((f) => f.name === "calc")).toHaveLength(1)
	})

	it("falls back to a positional name for a blank name box", () => {
		const next = applyDerivedVariablesToView(
			BASE,
			config(
				variable({ name: "first", math: { formula: "{sales} * 2" } }),
				variable({ name: "   ", math: { formula: "{sales} * 3" } })
			)
		)
		expect(next?.rows[0]["Variable 2"]).toBe("30")
	})
})

describe("derivedVariableIssues", () => {
	const names = new Set(["region", "sales"])

	it("flags a name collision", () => {
		expect(
			derivedVariableIssues(
				variable({ name: "sales", math: { formula: "1 + 1" } }),
				0,
				names
			)
		).toEqual(['"sales" is already the name of a variable in the data.'])
	})

	it("flags formula parse errors and unknown fields", () => {
		expect(
			derivedVariableIssues(
				variable({ name: "x", math: { formula: "{sales} +" } }),
				0,
				names
			)
		).toHaveLength(1)
		expect(
			derivedVariableIssues(
				variable({ name: "x", math: { formula: "{profit} + 1" } }),
				0,
				names
			)
		).toEqual(["{profit} isn't a variable in the data."])
	})

	it("flags an empty concat template and an empty rule list", () => {
		expect(
			derivedVariableIssues(
				variable({ name: "x", kind: "concat", concat: { template: "  " } }),
				0,
				names
			)
		).toEqual(["The text template is empty."])
		expect(
			derivedVariableIssues(
				variable({ name: "x", kind: "rules", rules: { rules: [], fallback: "" } }),
				0,
				names
			)
		).toEqual(["Add at least one rule."])
	})

	it("is empty for a well-formed variable", () => {
		expect(
			derivedVariableIssues(
				variable({ name: "x", math: { formula: "{sales} * 2" } }),
				0,
				names
			)
		).toEqual([])
	})
})

describe("derivedMathTypeIssues", () => {
	const names = new Set(["region", "sales", "count"])
	const lookup = makeNonNumericLookup(BASE.rows)

	it("errors on math over a column holding text, naming the row and value", () => {
		expect(
			derivedMathTypeIssues(
				variable({ math: { formula: "{sales} / {region}" } }),
				names,
				lookup
			)
		).toEqual([
			'{region} isn\'t a number in every row — row 1 is "West". Math needs numeric variables.',
		])
	})

	it("reports every non-numeric field the formula references", () => {
		const rows = [{ a: "x", b: "y", c: "1" }]
		expect(
			derivedMathTypeIssues(
				variable({ math: { formula: "{a} + {b} + {c}" } }),
				new Set(["a", "b", "c"]),
				makeNonNumericLookup(rows)
			)
		).toHaveLength(2)
	})

	it("passes numeric columns, blanks included", () => {
		expect(
			derivedMathTypeIssues(
				variable({ math: { formula: "{sales} + {count}" } }),
				names,
				lookup
			)
		).toEqual([])
	})

	it("stays quiet for the other kinds, unparseable formulas, and unknown fields", () => {
		expect(
			derivedMathTypeIssues(
				variable({ kind: "concat", concat: { template: "{region}" } }),
				names,
				lookup
			)
		).toEqual([])
		expect(
			derivedMathTypeIssues(
				variable({ math: { formula: "{region} +" } }),
				names,
				lookup
			)
		).toEqual([])
		expect(
			derivedMathTypeIssues(
				variable({ math: { formula: "{nope} + 1" } }),
				names,
				lookup
			)
		).toEqual([])
	})

	it("truncates a long offending value", () => {
		const long = "a".repeat(40)
		const issue = derivedMathTypeIssues(
			variable({ math: { formula: "{a} * 2" } }),
			new Set(["a"]),
			makeNonNumericLookup([{ a: long }])
		)[0]
		expect(issue).toContain(`"${"a".repeat(24)}…"`)
	})
})

describe("firstNonNumericCell", () => {
	it("skips blanks and returns the first text cell with a 1-based row", () => {
		expect(
			firstNonNumericCell([{ a: "1" }, { a: "  " }, { a: " 2 " }, { a: "n/a" }], "a")
		).toEqual({ rowNumber: 4, value: "n/a" })
	})

	it("is null for an all-numeric or all-blank column, and a missing one", () => {
		expect(firstNonNumericCell([{ a: "1" }, { a: "-2.5" }], "a")).toBeNull()
		expect(firstNonNumericCell([{ a: "" }, {}], "a")).toBeNull()
		expect(firstNonNumericCell([{ a: "1" }], "b")).toBeNull()
	})

	it("scans each column once through the memoizing lookup", () => {
		let scanned = 0
		const rows = new Proxy([{ a: "x" }] as Array<Record<string, string>>, {
			get(target, prop, receiver) {
				if (prop === "0") scanned++
				return Reflect.get(target, prop, receiver) as unknown
			},
		})
		const lookup = makeNonNumericLookup(rows)
		lookup("a")
		lookup("a")
		expect(scanned).toBe(1)
	})
})

describe("name helpers", () => {
	it("effectiveDerivedName falls back positionally", () => {
		expect(effectiveDerivedName(variable({ name: " " }), 1)).toBe("Variable 2")
		expect(effectiveDerivedName(variable({ name: "profit" }), 1)).toBe("profit")
	})

	it("nextDefaultDerivedName skips taken defaults", () => {
		expect(nextDefaultDerivedName([])).toBe("Variable 1")
		expect(nextDefaultDerivedName(["Variable 1", "Variable 2"])).toBe(
			"Variable 3"
		)
	})
})

describe("buildDerivedCompute", () => {
	it("returns null for a payload that can't produce a column", () => {
		const names = new Set(["sales"])
		expect(
			buildDerivedCompute(variable({ math: { formula: "{x +" } }), names)
		).toBeNull()
		expect(
			buildDerivedCompute(
				variable({ kind: "concat", concat: { template: "" } }),
				names
			)
		).toBeNull()
		expect(
			buildDerivedCompute(
				variable({ kind: "rules", rules: { rules: [], fallback: "x" } }),
				names
			)
		).toBeNull()
	})
})
