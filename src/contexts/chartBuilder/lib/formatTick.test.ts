import { describe, expect, it } from "vitest"

import { DEFAULT_AXIS_CONFIG, type AxisConfig } from "./channelConfig"
import {
	buildTickFormatter,
	buildTickFormatterWithAuto,
	composeFormatSpec,
	parseFormatSpec,
} from "./formatTick"

/** Build an AxisConfig override on top of the default — cleaner than
 *  spelling out every field per test. */
const cfg = (overrides: Partial<AxisConfig>): AxisConfig => ({
	...DEFAULT_AXIS_CONFIG,
	...overrides,
})

describe("buildTickFormatter", () => {
	it("returns null when customFormat is empty (caller falls back to d3 default)", () => {
		expect(
			buildTickFormatter(cfg({ customFormat: "" }), "quantitative")
		).toBeNull()
	})

	it("returns null when customFormat is only whitespace", () => {
		// The TRIM check is load-bearing — without it, "   " would pass
		// through to d3Format and throw on every tick.
		expect(
			buildTickFormatter(cfg({ customFormat: "   " }), "quantitative")
		).toBeNull()
	})

	it("applies a valid d3-format spec for quantitative", () => {
		const f = buildTickFormatter(cfg({ customFormat: ".2f" }), "quantitative")
		expect(f!(3.14159)).toBe("3.14")
	})

	it("prints an exact zero under an SI-prefix spec as a plain 0", () => {
		// d3's `s` type spends its precision as significant digits, so 0 has
		// nothing to trim into a prefix and rendered as "0.0" beside "3.0k".
		const f = buildTickFormatter(cfg({ customFormat: ".2s" }), "quantitative")
		expect(f!(3000)).toBe("3.0k")
		expect(f!(0)).toBe("0")
		expect(f!(-0)).toBe("0")
		expect(f!("0")).toBe("0")
		// Non-zero values keep d3's SI semantics untouched.
		expect(f!(12500)).toBe("13k")
		// Currency / grouping flags survive on the zero label.
		const money = buildTickFormatter(
			cfg({ customFormat: "$,.3s" }),
			"quantitative"
		)
		expect(money!(0)).toBe("$0")
		expect(money!(1500)).toBe("$1.50k")
		// Non-SI specs are untouched — `.2f` still says 0.00.
		const fixed = buildTickFormatter(cfg({ customFormat: ".2f" }), "quantitative")
		expect(fixed!(0)).toBe("0.00")
	})

	it("applies thousands grouping via the ',' preset", () => {
		const f = buildTickFormatter(cfg({ customFormat: ",.2f" }), "quantitative")
		expect(f!(1234.5)).toBe("1,234.50")
	})

	it("applies a percent preset", () => {
		const f = buildTickFormatter(cfg({ customFormat: ".1%" }), "quantitative")
		expect(f!(0.123)).toBe("12.3%")
	})

	it("applies a scientific preset", () => {
		const f = buildTickFormatter(cfg({ customFormat: ".1e" }), "quantitative")
		expect(f!(1234)).toMatch(/^1\.2e\+[03]/)
	})

	it("applies a currency preset", () => {
		const f = buildTickFormatter(
			cfg({ customFormat: "$,.2f" }),
			"quantitative"
		)
		expect(f!(1234.5)).toBe("$1,234.50")
	})

	it("applies a valid d3-time-format spec for temporal", () => {
		const f = buildTickFormatter(cfg({ customFormat: "%Y" }), "temporal")
		expect(f!(new Date("2024-06-15T00:00:00Z"))).toBe("2024")
	})

	it("detects time-format specs even on a quantitative axis (coerces numeric ms)", () => {
		const f = buildTickFormatter(cfg({ customFormat: "%Y" }), "quantitative")
		// Numeric ms past epoch: pick a value safely inside 2024 in every TZ.
		const ms = Date.UTC(2024, 5, 15, 12) // 2024-06-15 noon UTC
		expect(f!(ms)).toBe("2024")
	})

	it("detects numeric specs even on a temporal axis (Date falls through to String())", () => {
		const f = buildTickFormatter(cfg({ customFormat: ".2f" }), "temporal")
		// .2f is numeric; a Date isn't a number so it falls through. The
		// key invariant is we DON'T silently apply timeFormat to the date.
		const out = f!(new Date("2024-06-15T00:00:00Z"))
		expect(typeof out).toBe("string")
		expect(out).not.toBe("2024")
	})

	it("falls back to String() when an invalid d3 format spec throws", () => {
		// Bogus spec — d3Format throws, safeFormat returns the String() shim.
		const f = buildTickFormatter(
			cfg({ customFormat: "INVALID-SPEC" }),
			"quantitative"
		)
		expect(f).not.toBeNull()
		expect(typeof f!(42)).toBe("string")
	})

	it("non-number values fall through to String() for numeric formatters", () => {
		const f = buildTickFormatter(cfg({ customFormat: ".1f" }), "quantitative")
		expect(f!("abc")).toBe("abc")
		expect(f!(null)).toBe("")
	})

	it("numeric strings are coerced so $,.2f works on ordinal bins like '1','2','3'", () => {
		const f = buildTickFormatter(cfg({ customFormat: "$,.2f" }), "ordinal")
		expect(f!("1")).toBe("$1.00")
		expect(f!("1000")).toBe("$1,000.00")
		// Non-numeric strings still pass through unchanged.
		expect(f!("Cubed")).toBe("Cubed")
	})

	it("prints numeric years verbatim with the 'literal' spec (no date coercion)", () => {
		// The bug this guards: a numeric year axis with a temporal preset ran
		// `new Date(2020)` (2020ms past epoch) and collapsed every tick to 1969.
		const f = buildTickFormatter(cfg({ customFormat: "literal" }), "temporal")
		expect(f!(2020)).toBe("2020")
		expect(f!(1999)).toBe("1999")
	})

	it("'literal' stringifies any value and is case-insensitive", () => {
		const f = buildTickFormatter(cfg({ customFormat: "LITERAL" }), "quantitative")
		expect(f!(1234.5)).toBe("1234.5")
		expect(f!("abc")).toBe("abc")
		expect(f!(null)).toBe("")
	})

	it("non-Date values fall through to String() for temporal formatters", () => {
		const f = buildTickFormatter(cfg({ customFormat: "%Y" }), "temporal")
		expect(f!("not a date")).toBe("not a date")
		expect(f!(null)).toBe("")
	})
})

describe("parseFormatSpec / composeFormatSpec", () => {
	it("treats every preset and pre-existing stored spec as a bare spec", () => {
		for (const raw of ["", ",.0f", ".1%", "$,.2f", "%Y-%m-%d", "%b %Y", "literal", "country-name"]) {
			expect(parseFormatSpec(raw)).toEqual({ prefix: "", spec: raw, suffix: "" })
			expect(composeFormatSpec(parseFormatSpec(raw))).toBe(raw)
		}
	})

	it("reads text around the word literal as prefix / suffix, verbatim", () => {
		expect(parseFormatSpec("literal%")).toEqual({ prefix: "", spec: "literal", suffix: "%" })
		expect(parseFormatSpec("literal units")).toEqual({
			prefix: "",
			spec: "literal",
			suffix: " units",
		})
		expect(parseFormatSpec("€literal")).toEqual({ prefix: "€", spec: "literal", suffix: "" })
		expect(parseFormatSpec("~Literal monkeys")).toEqual({
			prefix: "~",
			spec: "literal",
			suffix: " monkeys",
		})
	})

	it("splits a d3 spec from trailing text at the first whitespace", () => {
		expect(parseFormatSpec(",.0f kg")).toEqual({ prefix: "", spec: ",.0f", suffix: " kg" })
		expect(parseFormatSpec("  .0% pts")).toEqual({ prefix: "", spec: ".0%", suffix: " pts" })
		expect(parseFormatSpec("   ")).toEqual({ prefix: "", spec: "", suffix: "" })
	})

	it("leaves a time-format spec whole — that grammar prints its own text", () => {
		expect(parseFormatSpec("%Y years")).toEqual({ prefix: "", spec: "%Y years", suffix: "" })
	})

	it("splits the explicit prefix{spec}suffix form and round-trips it", () => {
		expect(parseFormatSpec("{literal}%")).toEqual({ prefix: "", spec: "literal", suffix: "%" })
		expect(parseFormatSpec("~{,.0f} monkeys")).toEqual({
			prefix: "~",
			spec: ",.0f",
			suffix: " monkeys",
		})
		expect(parseFormatSpec("{}%")).toEqual({ prefix: "", spec: "", suffix: "%" })
		expect(composeFormatSpec({ prefix: "~", spec: ",.0f", suffix: " monkeys" })).toBe(
			"~{,.0f} monkeys"
		)
	})

	it("stores the spec bare when both affixes are empty (Auto stays '')", () => {
		expect(composeFormatSpec({ prefix: "", spec: "", suffix: "" })).toBe("")
		expect(composeFormatSpec({ prefix: "", spec: ".1%", suffix: "" })).toBe(".1%")
		expect(composeFormatSpec({ prefix: "", spec: "", suffix: "%" })).toBe("{}%")
	})
})

describe("buildTickFormatter with text around the value", () => {
	it("appends a suffix to the literal value — the 3 → '3%' case", () => {
		const f = buildTickFormatter(cfg({ customFormat: "literal%" }), "quantitative")
		expect(f!(3)).toBe("3%")
		expect(f!("3")).toBe("3%")
		expect(buildTickFormatter(cfg({ customFormat: "literal units" }), "quantitative")!(4)).toBe(
			"4 units"
		)
	})

	it("wraps a d3 spec's output, keeping a leading space in the suffix", () => {
		const f = buildTickFormatter(cfg({ customFormat: ",.0f monkeys" }), "quantitative")
		expect(f!(1234.4)).toBe("1,234 monkeys")
		const braced = buildTickFormatter(cfg({ customFormat: "~{,.0f} monkeys" }), "quantitative")
		expect(braced!(1234.4)).toBe("~1,234 monkeys")
	})

	it("affixes-only (Auto spec) wraps the caller's fallback formatter", () => {
		const auto = (v: unknown) => `auto:${String(v)}`
		const f = buildTickFormatter(cfg({ customFormat: "{}%" }), "quantitative", auto)
		expect(f(5)).toBe("auto:5%")
	})

	it("affixes-only without a fallback wraps the literal value", () => {
		const f = buildTickFormatter(cfg({ customFormat: "{}%" }), "quantitative")
		expect(f).not.toBeNull()
		expect(f!(5)).toBe("5%")
	})

	it("returns the fallback itself when the format is fully Auto, null without one", () => {
		const auto = (v: unknown) => `auto:${String(v)}`
		expect(buildTickFormatter(cfg({ customFormat: "" }), "quantitative", auto)).toBe(auto)
		expect(buildTickFormatter(cfg({ customFormat: "" }), "quantitative")).toBeNull()
	})

	it("never affixes an empty value (no bare '%' for a missing label)", () => {
		const f = buildTickFormatter(cfg({ customFormat: "{literal}%" }), "quantitative")
		expect(f!(null)).toBe("")
		expect(f!(undefined)).toBe("")
	})

	it("ignores whitespace around a braced inner spec but not inside the affixes", () => {
		const f = buildTickFormatter(cfg({ customFormat: " { .0% } pts" }), "quantitative")
		expect(f!(0.5)).toBe(" 50% pts")
	})

	it("time-format text is not treated as a suffix", () => {
		const f = buildTickFormatter(cfg({ customFormat: "%Y years" }), "temporal")
		expect(f!(new Date(Date.UTC(2024, 5, 15, 12)))).toBe("2024 years")
	})
})

describe("buildTickFormatterWithAuto", () => {
	it("is null for a fully Auto format", () => {
		expect(buildTickFormatterWithAuto(cfg({ customFormat: "" }))).toBeNull()
	})

	it("uses the per-value auto text only while the spec is Auto", () => {
		const affixOnly = buildTickFormatterWithAuto(cfg({ customFormat: "{} kg" }))!
		expect(affixOnly(20000, "20000")).toBe("20000 kg")
		const si = buildTickFormatterWithAuto(cfg({ customFormat: "{.2s} kg" }))!
		expect(si(20000, "20000")).toBe("20k kg")
		const bare = buildTickFormatterWithAuto(cfg({ customFormat: ".2s" }))!
		expect(bare(20000, "20000")).toBe("20k")
	})
})
