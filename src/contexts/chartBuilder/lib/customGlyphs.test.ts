import { describe, expect, it } from "vitest"
import type { CustomGlyph } from "./channelConfig"
import {
	CUSTOM_GLYPH_BASE,
	glyphCharCount,
	MAX_TEXT_GLYPH_CHARS,
	resolveGlyph,
	sanitizeGlyphText,
	stripNudge,
	textGlyphFontSize,
} from "./customGlyphs"
import { SHAPE_PALETTE } from "./scales"

const TEXT_GLYPH: CustomGlyph = { kind: "text", text: "Rx" }
const IMAGE_GLYPH: CustomGlyph = {
	kind: "image",
	href: "data:image/png;base64,abc",
	aspect: 2,
}

describe("resolveGlyph", () => {
	it("maps built-in indices to their symbol", () => {
		for (let i = 0; i < SHAPE_PALETTE.length; i++) {
			expect(resolveGlyph(i, [TEXT_GLYPH])).toEqual({
				kind: "symbol",
				idx: i,
			})
		}
	})

	it("maps indices past the palette into the custom glyph list", () => {
		const glyphs = [TEXT_GLYPH, IMAGE_GLYPH]
		expect(resolveGlyph(CUSTOM_GLYPH_BASE, glyphs)).toEqual(TEXT_GLYPH)
		expect(resolveGlyph(CUSTOM_GLYPH_BASE + 1, glyphs)).toEqual(IMAGE_GLYPH)
	})

	it("falls back to the circle for tombstoned slots", () => {
		expect(resolveGlyph(CUSTOM_GLYPH_BASE, [null, TEXT_GLYPH])).toEqual({
			kind: "symbol",
			idx: 0,
		})
	})

	it("falls back to the circle for out-of-range or missing lists", () => {
		expect(resolveGlyph(CUSTOM_GLYPH_BASE, undefined)).toEqual({
			kind: "symbol",
			idx: 0,
		})
		expect(resolveGlyph(CUSTOM_GLYPH_BASE + 5, [TEXT_GLYPH])).toEqual({
			kind: "symbol",
			idx: 0,
		})
		expect(resolveGlyph(-1, [TEXT_GLYPH])).toEqual({ kind: "symbol", idx: 0 })
	})
})

describe("stripNudge", () => {
	it("drops a text glyph's creation-time nudge (previews render centered)", () => {
		expect(stripNudge({ kind: "text", text: "_", dx: -0.6, dy: 0.25 })).toEqual(
			{ kind: "text", text: "_" }
		)
	})

	it("returns un-nudged glyphs unchanged (same reference)", () => {
		const symbol = { kind: "symbol", idx: 3 } as const
		expect(stripNudge(symbol)).toBe(symbol)
		expect(stripNudge(TEXT_GLYPH)).toBe(TEXT_GLYPH)
		expect(stripNudge(IMAGE_GLYPH)).toBe(IMAGE_GLYPH)
	})

	it("resolveGlyph passes a nudge through untouched (marks apply it)", () => {
		const nudged: CustomGlyph = { kind: "text", text: "_", dx: 1, dy: -0.5 }
		expect(resolveGlyph(CUSTOM_GLYPH_BASE, [nudged])).toEqual(nudged)
	})
})

describe("text glyph helpers", () => {
	it("counts user-perceived characters, not UTF-16 units or code points", () => {
		expect(glyphCharCount("🔥")).toBe(1)
		expect(glyphCharCount("Rx")).toBe(2)
		// Multi-code-point emoji (skin tone modifier, ZWJ family) = 1 each,
		// so a converted emoji shortcode never trips the length cap.
		expect(glyphCharCount("👍🏽")).toBe(1)
		expect(glyphCharCount("👨‍👩‍👧")).toBe(1)
	})

	it("sanitize caps at the max length (emoji count once)", () => {
		expect(sanitizeGlyphText("ABCD")).toBe("ABC")
		expect(glyphCharCount(sanitizeGlyphText("🔥🔥🔥🔥"))).toBe(
			MAX_TEXT_GLYPH_CHARS
		)
	})

	it("sanitize keeps spaces — position matters and a lone space is a blank mark", () => {
		expect(sanitizeGlyphText(" ")).toBe(" ")
		expect(sanitizeGlyphText(" _")).toBe(" _")
		expect(sanitizeGlyphText("_ ")).toBe("_ ")
		expect(sanitizeGlyphText("  A ")).toBe("  A")
	})

	it("font size shrinks for longer strings and scales with radius", () => {
		const r = 5
		const one = textGlyphFontSize("A", r)
		const three = textGlyphFontSize("abc", r)
		expect(one).toBeCloseTo(2.4 * r)
		expect(three).toBeLessThan(one)
		expect(textGlyphFontSize("A", 10)).toBeCloseTo(2 * one)
	})
})
