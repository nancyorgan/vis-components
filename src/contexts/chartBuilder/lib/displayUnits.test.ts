import { describe, expect, it } from "vitest"

import { pxToUnit, unitToPx } from "./displayUnits"

describe("displayUnits", () => {
	it("px passes through unchanged", () => {
		expect(pxToUnit(624, "px")).toBe(624)
		expect(unitToPx(624, "px")).toBe(624)
	})

	it("converts at the CSS-standard 96 px/inch", () => {
		expect(unitToPx(6.5, "in")).toBe(624)
		expect(pxToUnit(624, "in")).toBe(6.5)
		expect(unitToPx(2.54, "cm")).toBe(96)
	})

	it("physical units display at 2-decimal precision", () => {
		expect(pxToUnit(1000, "in")).toBe(10.42)
		expect(pxToUnit(1000, "cm")).toBe(26.46)
	})

	it("round-trips a typed physical value through px storage", () => {
		// Type 6.5 in → store 624px → reopen shows 6.5 in (not 6.49/6.51).
		expect(pxToUnit(unitToPx(6.5, "in"), "in")).toBe(6.5)
		expect(pxToUnit(unitToPx(15, "cm"), "cm")).toBe(15)
	})
})
