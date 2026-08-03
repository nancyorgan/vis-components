import { describe, expect, it } from "vitest"

import { DEFAULT_PATTERN_CONFIG } from "./channelConfig"
import {
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
