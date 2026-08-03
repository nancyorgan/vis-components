import { describe, expect, it } from "vitest"

import {
	naturalWrapAlignFor,
	tickWrapMaxPx,
	wrapTickLabel,
} from "./tickLabelWrap"

describe("wrapTickLabel", () => {
	it("returns short labels unchanged", () => {
		expect(wrapTickLabel("42", 100, 10)).toBe("42")
		expect(wrapTickLabel("Surgery", 100, 10)).toBe("Surgery")
	})

	it("wraps on spaces into a \\n-joined string", () => {
		// 10px → 5.5px/char, 90px → 16 chars/line.
		expect(wrapTickLabel("Cardiothoracic Surgery", 90, 10)).toBe(
			"Cardiothoracic\nSurgery"
		)
	})

	it("hard-breaks a word too long for any line", () => {
		const wrapped = wrapTickLabel("Pneumonoultramicroscopic", 40, 10)
		expect(wrapped).toContain("\n")
		expect(wrapped.replaceAll("\n", "")).toBe("Pneumonoultramicroscopic")
	})

	it("is a no-op for non-positive widths (empty axis slots)", () => {
		expect(wrapTickLabel("Cardiothoracic Surgery", 0, 10)).toBe(
			"Cardiothoracic Surgery"
		)
		expect(wrapTickLabel("Cardiothoracic Surgery", -5, 10)).toBe(
			"Cardiothoracic Surgery"
		)
	})
})

describe("tickWrapMaxPx", () => {
	it("scales with the tick font size", () => {
		expect(tickWrapMaxPx(20)).toBe(tickWrapMaxPx(10) * 2)
	})
})

describe("naturalWrapAlignFor", () => {
	it("y is right-aligned, r is left-aligned, regardless of angle", () => {
		expect(naturalWrapAlignFor("y", 0)).toBe("right")
		expect(naturalWrapAlignFor("y", -45)).toBe("right")
		expect(naturalWrapAlignFor("r", 0)).toBe("left")
		expect(naturalWrapAlignFor("r", 30)).toBe("left")
	})

	it("x follows the rotation-dependent anchor", () => {
		expect(naturalWrapAlignFor("x", 0)).toBe("center")
		// Rotated labels anchor away from the axis: negative angles anchor
		// "end" (right-aligned lines), positive anchor "start" (left).
		// The panel's Center button must NOT treat these as center — that
		// made Center store `undefined` and render right-aligned, identical
		// to Right (user-reported July 2026).
		expect(naturalWrapAlignFor("x", -45)).toBe("right")
		expect(naturalWrapAlignFor("x", 45)).toBe("left")
	})
})
