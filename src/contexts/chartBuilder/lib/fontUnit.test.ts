import { describe, expect, it } from "vitest"
import { PT_TO_PX, ptToPx, resolveTickFontSizePx } from "./fontUnit"

describe("ptToPx", () => {
	it("converts at the CSS-standard 1pt = 4/3px", () => {
		expect(PT_TO_PX).toBe(4 / 3)
		expect(ptToPx(12)).toBe(16)
		expect(ptToPx(0)).toBe(0)
	})

	it("does not round — fractional px keep the exact pt contract", () => {
		expect(ptToPx(13)).toBeCloseTo(17.333, 3)
	})
})

describe("resolveTickFontSizePx", () => {
	it("converts a pt override, ignoring the base", () => {
		expect(resolveTickFontSizePx(9, 16)).toBe(12)
	})

	it("falls through to the already-resolved base px size", () => {
		expect(resolveTickFontSizePx(undefined, 16)).toBe(16)
	})
})
