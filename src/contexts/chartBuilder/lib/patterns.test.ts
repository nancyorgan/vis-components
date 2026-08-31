import { describe, expect, it } from "vitest"

import { DEFAULT_PATTERN_CONFIG } from "./channelConfig"
import {
	buildThemeInkFallback,
	inkForHueColor,
	PATTERN_NONE,
	resolvePatternForCategory,
	resolvePatternForMark,
} from "./patterns"

describe("resolvePatternForMark", () => {
	it("returns a pattern spec for categories without an override", () => {
		const result = resolvePatternForMark("A", 0, "#ff0000", {
			...DEFAULT_PATTERN_CONFIG,
		})
		expect(result).not.toBeNull()
		expect(result?.paletteIdx).toBe(0)
		expect(result?.bgColor).toBe("#ff0000")
		expect(result?.svgId).toMatch(/^vc-pat-/)
	})

	it("returns null when the category override is PATTERN_NONE", () => {
		const result = resolvePatternForMark("A", 0, "#ff0000", {
			...DEFAULT_PATTERN_CONFIG,
			overrides: { A: PATTERN_NONE },
		})
		expect(result).toBeNull()
	})

	it("respects PATTERN_NONE per-category — other categories still get patterns", () => {
		const config = {
			...DEFAULT_PATTERN_CONFIG,
			overrides: { A: PATTERN_NONE, B: 2 } as Record<
				string,
				number | typeof PATTERN_NONE
			>,
		}
		expect(resolvePatternForMark("A", 0, "#fff", config)).toBeNull()
		const b = resolvePatternForMark("B", 1, "#fff", config)
		expect(b).not.toBeNull()
		expect(b?.paletteIdx).toBe(2)
	})
})

describe("resolvePatternForCategory", () => {
	it("returns null when the category override is PATTERN_NONE", () => {
		const result = resolvePatternForCategory("A", 0, {
			...DEFAULT_PATTERN_CONFIG,
			overrides: { A: PATTERN_NONE },
		})
		expect(result).toBeNull()
	})

	it("returns a pattern spec for un-overridden categories", () => {
		const result = resolvePatternForCategory("A", 0, DEFAULT_PATTERN_CONFIG)
		expect(result).not.toBeNull()
		expect(result?.paletteIdx).toBe(0)
	})
})

describe("PATTERN_NONE", () => {
	it('is the literal string "none"', () => {
		expect(PATTERN_NONE).toBe("none")
	})
})

describe("buildThemeInkFallback", () => {
	const pal = (
		id: string,
		colors: string[],
		patternInks?: Array<string | null>
	) => ({ id, name: id, colors, patternInks })

	it("flattens every palette's paired inks, skipping unset entries", () => {
		const table = buildThemeInkFallback({
			categoricalPalettes: [pal("a", ["#111111", "#222222"], ["#aaa", null])],
			ordinalPalettes: [pal("b", ["#333333"], ["#bbb"])],
		})
		expect(table).toEqual({ "#111111": "#aaa", "#333333": "#bbb" })
	})

	it("lowercases keys and keeps the FIRST palette's ink for a duplicated hex", () => {
		const table = buildThemeInkFallback({
			categoricalPalettes: [
				pal("a", ["#ABCDEF"], ["#first"]),
				pal("b", ["#abcdef"], ["#second"]),
			],
			ordinalPalettes: [],
		})
		expect(table).toEqual({ "#abcdef": "#first" })
	})

	it("returns an empty table when no palette pairs inks", () => {
		expect(
			buildThemeInkFallback({
				categoricalPalettes: [pal("a", ["#111111"])],
				ordinalPalettes: [],
			})
		).toEqual({})
	})
})

describe("inkForHueColor", () => {
	const palette = ["#e0f2fe", "#7dd3fc"]
	const inks = ["#ff0000", null]

	it("returns the active palette's paired ink when the color is a swatch", () => {
		expect(inkForHueColor("#E0F2FE", palette, inks)).toBe("#ff0000")
	})

	it("returns null off-palette with no fallback table", () => {
		expect(inkForHueColor("#123456", palette, inks)).toBeNull()
	})

	it("falls back to the cross-palette table for off-palette colors", () => {
		expect(
			inkForHueColor("#123456", palette, inks, { "#123456": "#ababab" })
		).toBe("#ababab")
	})

	it("active palette pairing wins over the fallback table", () => {
		expect(
			inkForHueColor("#e0f2fe", palette, inks, { "#e0f2fe": "#ababab" })
		).toBe("#ff0000")
	})

	it("falls back when the swatch is on-palette but its ink is unset", () => {
		expect(
			inkForHueColor("#7dd3fc", palette, inks, { "#7dd3fc": "#ababab" })
		).toBe("#ababab")
	})
})
