import { describe, expect, it } from "vitest"
import { newTextAnnotation } from "./annotationsConfig"
import { makePositionScale } from "./scales"
import {
	computeTextAnnotationAnchor,
	layoutTextAnnotationBox,
} from "./textAnnotationGeometry"

const inner = { x: 100, y: 50, width: 400, height: 200 }

/** A single-line label 60px wide at 10px font, padded by 4 on every side —
 *  so the box is 68 × (12 + 8) = 68 × 20. */
const box = (align: "left" | "center" | "right", lines = 1) =>
	layoutTextAnnotationBox({
		anchorX: 200,
		anchorY: 150,
		textWidthPx: 60,
		lines,
		fontSizePx: 10,
		padding: 4,
		align,
	})

describe("layoutTextAnnotationBox", () => {
	it("sizes the box to the text plus padding on all four sides", () => {
		const b = box("center")
		expect(b.width).toBe(68) // 60 + 4 * 2
		expect(b.height).toBe(20) // 1 line * (10 * 1.2) + 4 * 2
	})

	it("grows the box by one line height per extra line", () => {
		expect(box("center", 3).height).toBe(44) // 3 * 12 + 8
		// Extra lines never change the width — that's the widest LINE.
		expect(box("center", 3).width).toBe(68)
	})

	it("always centers the box vertically on the anchor", () => {
		for (const align of ["left", "center", "right"] as const) {
			const b = box(align)
			expect(b.top + b.height / 2).toBe(150)
		}
	})

	it("anchors the box's left edge at x when aligned left", () => {
		const b = box("left")
		expect(b.left).toBe(200)
		expect(b.anchor).toBe("start")
		expect(b.textX).toBe(204) // inset by the padding
	})

	it("straddles x when aligned center", () => {
		const b = box("center")
		expect(b.left).toBe(166) // 200 - 68/2
		expect(b.anchor).toBe("middle")
		expect(b.textX).toBe(200)
	})

	it("anchors the box's right edge at x when aligned right", () => {
		const b = box("right")
		expect(b.left).toBe(132) // 200 - 68
		expect(b.left + b.width).toBe(200)
		expect(b.anchor).toBe("end")
		expect(b.textX).toBe(196)
	})

	it("puts the first baseline one font size below the padded top", () => {
		const b = box("center", 2)
		expect(b.firstBaseline).toBe(b.top + 4 + 10)
	})
})

describe("computeTextAnnotationAnchor", () => {
	it("maps percent coords across the panel, with y flipped to SVG top-down", () => {
		const anno = { ...newTextAnnotation("t1"), x: 0.25, y: 0.25 }
		expect(computeTextAnnotationAnchor(anno, inner, emptyScales)).toEqual({
			x: 200, // 100 + 400 * 0.25
			y: 200, // 50 + 200 * (1 - 0.25) — percent y=0 is the BOTTOM
		})
	})

	it("projects value coords through the position scales", () => {
		const xScale = makePositionScale(
			[0, 100],
			"quantitative",
			[inner.x, inner.x + inner.width]
		)
		const yScale = makePositionScale(
			[0, 100],
			"quantitative",
			[inner.y + inner.height, inner.y]
		)
		const anno = {
			...newTextAnnotation("t1"),
			coordSystem: "values" as const,
			x: 50,
			y: 100,
		}
		expect(
			computeTextAnnotationAnchor(anno, inner, {
				xScale,
				yScale,
				xType: "quantitative",
				yType: "quantitative",
			})
		).toEqual({ x: 300, y: 50 })
	})

	it("falls back to percent placement per axis when a scale is missing", () => {
		// A pie chart has no y axis: the y coord still places by percent.
		const xScale = makePositionScale(
			[0, 100],
			"quantitative",
			[inner.x, inner.x + inner.width]
		)
		const anno = {
			...newTextAnnotation("t1"),
			coordSystem: "values" as const,
			x: 25,
			y: 0.5,
		}
		expect(
			computeTextAnnotationAnchor(anno, inner, {
				xScale,
				yScale: null,
				xType: "quantitative",
				yType: null,
			})
		).toEqual({ x: 200, y: 150 })
	})

	it("returns null when a value coord can't be projected", () => {
		const xScale = makePositionScale(
			["a", "b"],
			"categorical",
			[inner.x, inner.x + inner.width]
		)
		const anno = {
			...newTextAnnotation("t1"),
			coordSystem: "values" as const,
			x: "not-a-category",
			y: 0.5,
		}
		expect(
			computeTextAnnotationAnchor(anno, inner, {
				xScale,
				yScale: null,
				xType: "categorical",
				yType: null,
			})
		).toBeNull()
	})
})

const emptyScales = {
	xScale: null,
	yScale: null,
	xType: null,
	yType: null,
}
