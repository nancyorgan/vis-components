import { describe, expect, it } from "vitest"

import { DEFAULT_AXIS_CONFIG, type AxisConfig } from "./channelConfig"
import { buildTickFormatter } from "./formatTick"

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
