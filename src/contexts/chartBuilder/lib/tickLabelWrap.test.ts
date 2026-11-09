import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import {
	naturalWrapAlignFor,
	renderWrappedTickLabel,
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

describe("wrapTickLabel with a character target", () => {
	it("breaks at the space nearest the target, ignoring the pixel budget", () => {
		// Pixel budget alone would keep this on one line.
		expect(wrapTickLabel("Internal Medicine Group", 1000, 10, 10)).toBe(
			"Internal\nMedicine\nGroup"
		)
	})

	it("breaks after an internal hyphen", () => {
		expect(wrapTickLabel("Ear-Nose-Throat", 1000, 10, 4)).toBe(
			"Ear-\nNose-\nThroat"
		)
	})

	it("leaves an over-long word whole instead of splitting it", () => {
		expect(wrapTickLabel("Pneumonoultramicroscopic", 40, 10, 5)).toBe(
			"Pneumonoultramicroscopic"
		)
	})

	it("falls back to the pixel wrap when unset or non-positive", () => {
		for (const chars of [undefined, null, 0]) {
			expect(wrapTickLabel("Cardiothoracic Surgery", 90, 10, chars)).toBe(
				"Cardiothoracic\nSurgery"
			)
		}
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

describe("naturalWrapAlignFor on a flipped axis (x top / y right)", () => {
	it("y on the right anchors 'start' → left-aligned lines", () => {
		expect(naturalWrapAlignFor("y", 0, true)).toBe("left")
		expect(naturalWrapAlignFor("y", -45, true)).toBe("left")
	})

	it("rotated x on top mirrors the anchor; unrotated stays centered", () => {
		expect(naturalWrapAlignFor("x", -45, true)).toBe("left")
		expect(naturalWrapAlignFor("x", 45, true)).toBe("right")
		expect(naturalWrapAlignFor("x", 0, true)).toBe("center")
	})

	it("r ignores the flag; `flipped` defaults to false", () => {
		expect(naturalWrapAlignFor("r", 30, true)).toBe("left")
		expect(naturalWrapAlignFor("x", -45)).toBe(naturalWrapAlignFor("x", -45, false))
	})
})

describe("renderWrappedTickLabel with growUp", () => {
	const lift = (nodes: ReactNode) =>
		(Array.isArray(nodes) ? nodes : [nodes]).map(
			(n) => (n as { props: { dy: unknown } }).props.dy
		)

	it("lifts the first line of a wrapped label by 1.2 × fontSize per extra line", () => {
		const nodes = renderWrappedTickLabel({
			label: "Cardiothoracic\nSurgery",
			x: 0,
			blockAnchor: "middle",
			align: undefined,
			fontSize: 10,
			verticallyCentered: false,
			columnWidth: 100,
			growUp: true,
		})
		expect(lift(nodes)).toEqual([-12, "1.2em"])
	})

	it("keeps the lift when the lines are re-aligned", () => {
		const nodes = renderWrappedTickLabel({
			label: "Cardiothoracic\nSurgery",
			x: 0,
			blockAnchor: "middle",
			align: "left",
			fontSize: 10,
			verticallyCentered: false,
			columnWidth: 100,
			growUp: true,
		})
		expect(lift(nodes)).toEqual([-12, "1.2em"])
	})

	it("single-line labels render as plain text regardless", () => {
		expect(
			renderWrappedTickLabel({
				label: "ENT",
				x: 0,
				blockAnchor: "middle",
				align: undefined,
				fontSize: 10,
				verticallyCentered: false,
				columnWidth: 100,
				growUp: true,
			})
		).toBe("ENT")
	})
})
