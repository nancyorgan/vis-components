import { describe, expect, it } from "vitest"

import { DEFAULT_TEXT_CONFIG } from "./channelConfig"
import { formatTextValue, resolveTextColor } from "./textEncoding"

describe("formatTextValue", () => {
	it("returns null for undefined", () => {
		const undef: unknown = void 0
		expect(formatTextValue(undef, null)).toBeNull()
	})

	it("returns null for null", () => {
		expect(formatTextValue(null, null)).toBeNull()
	})

	it("returns null for empty string", () => {
		// An empty cell shouldn't render a label — callers depend on the
		// null return to skip the `<text>` element entirely.
		expect(formatTextValue("", null)).toBeNull()
	})

	it("returns null for empty string even when decimals is set", () => {
		expect(formatTextValue("", 2)).toBeNull()
	})

	it("stringifies a finite number with no decimals when decimals=null", () => {
		expect(formatTextValue(42, null)).toBe("42")
		expect(formatTextValue(3.14159, null)).toBe("3.14159")
	})

	it("applies decimals to numeric input via toFixed", () => {
		expect(formatTextValue(3.14159, 2)).toBe("3.14")
		expect(formatTextValue(3.14159, 0)).toBe("3")
		expect(formatTextValue(0, 2)).toBe("0.00")
	})

	it("handles negative numbers", () => {
		expect(formatTextValue(-2.5, 1)).toBe("-2.5")
		expect(formatTextValue(-2.5, 3)).toBe("-2.500")
	})

	it("returns String(NaN) when raw is NaN and decimals is null", () => {
		// NaN is not Number.isFinite — falls through to string path.
		// String(NaN) === "NaN".
		expect(formatTextValue(Number.NaN, null)).toBe("NaN")
	})

	it("returns String(Infinity) when raw is non-finite and decimals is null", () => {
		expect(formatTextValue(Number.POSITIVE_INFINITY, null)).toBe("Infinity")
	})

	it("parses numeric strings and applies decimals", () => {
		// Common CSV scenario: numbers arrive as strings.
		expect(formatTextValue("3.14159", 2)).toBe("3.14")
		expect(formatTextValue("42", 0)).toBe("42")
	})

	it("leaves non-numeric strings unchanged regardless of decimals", () => {
		expect(formatTextValue("hello", 2)).toBe("hello")
		expect(formatTextValue("Surgery", null)).toBe("Surgery")
	})

	it("stringifies non-number, non-string values", () => {
		// Boolean, object, etc. — the renderer needs SOMETHING to draw.
		expect(formatTextValue(true, null)).toBe("true")
		expect(formatTextValue(false, null)).toBe("false")
	})

	it("returns String(Date) when raw is a Date", () => {
		// Dates aren't typeof "number" so fall through to String(raw).
		// We don't assert the exact format (locale-dependent), just that
		// SOMETHING non-null is returned.
		const result = formatTextValue(new Date(0), null)
		expect(result).not.toBeNull()
		expect(typeof result).toBe("string")
	})
})

describe("resolveTextColor", () => {
	it("returns the fallback color when raw is null", () => {
		expect(resolveTextColor(null, DEFAULT_TEXT_CONFIG)).toBe(
			DEFAULT_TEXT_CONFIG.color
		)
	})

	it("returns the fallback color when raw is undefined", () => {
		const undef: unknown = void 0
		expect(resolveTextColor(undef, DEFAULT_TEXT_CONFIG)).toBe(
			DEFAULT_TEXT_CONFIG.color
		)
	})

	it("prefers a per-value override over palette and fallback", () => {
		const cfg = {
			...DEFAULT_TEXT_CONFIG,
			color: "#000000",
			colorOverrides: { A: "#ff0000" },
			palette: ["#00ff00", "#0000ff"],
		}
		// Even with palette set and categoryIndex provided, the explicit
		// override wins.
		expect(resolveTextColor("A", cfg, 0)).toBe("#ff0000")
	})

	it("uses the palette when no override exists and categoryIndex is provided", () => {
		const cfg = {
			...DEFAULT_TEXT_CONFIG,
			color: "#000000",
			colorOverrides: {},
			palette: ["#11", "#22", "#33"],
		}
		expect(resolveTextColor("anything", cfg, 0)).toBe("#11")
		expect(resolveTextColor("anything", cfg, 1)).toBe("#22")
		expect(resolveTextColor("anything", cfg, 2)).toBe("#33")
	})

	it("wraps the palette modulo its length for out-of-range indices", () => {
		const cfg = {
			...DEFAULT_TEXT_CONFIG,
			palette: ["#a", "#b"],
		}
		expect(resolveTextColor("x", cfg, 0)).toBe("#a")
		expect(resolveTextColor("x", cfg, 1)).toBe("#b")
		expect(resolveTextColor("x", cfg, 2)).toBe("#a")
		expect(resolveTextColor("x", cfg, 3)).toBe("#b")
	})

	it("falls back to single color when palette is empty (regardless of index)", () => {
		const cfg = {
			...DEFAULT_TEXT_CONFIG,
			color: "#deadbe",
			palette: [],
		}
		expect(resolveTextColor("x", cfg, 5)).toBe("#deadbe")
	})

	it("falls back to single color when categoryIndex is undefined", () => {
		const cfg = {
			...DEFAULT_TEXT_CONFIG,
			color: "#cafe00",
			palette: ["#nope"],
		}
		// `undefined` is part of the function signature — pass via a typed
		// variable to satisfy unicorn/no-useless-undefined (which flags
		// the literal).
		const noIndex: number | undefined = void 0
		expect(resolveTextColor("x", cfg, noIndex)).toBe("#cafe00")
	})

	it("falls back to single color when categoryIndex is negative", () => {
		const cfg = {
			...DEFAULT_TEXT_CONFIG,
			color: "#abc123",
			palette: ["#nope"],
		}
		// Negative index means "no category info available" per caller's
		// contract — guard against unsafe array access.
		expect(resolveTextColor("x", cfg, -1)).toBe("#abc123")
	})

	it("converts the raw value to a string when looking up the override", () => {
		// CSV-y row values often arrive as numbers but overrides are
		// keyed by string. Coercion is the documented behavior.
		const cfg = {
			...DEFAULT_TEXT_CONFIG,
			colorOverrides: { "42": "#numeric" },
		}
		expect(resolveTextColor(42, cfg)).toBe("#numeric")
	})
})
