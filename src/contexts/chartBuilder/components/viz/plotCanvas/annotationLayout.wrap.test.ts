import { describe, expect, it } from "vitest"
import { newRectangle, newTextAnnotation } from "../../../lib/annotationsConfig"
import {
	annotationDisplayText,
	layoutPanelAnnotations,
	rectangleTextStyle,
} from "./annotationLayout"

const inner = { x: 100, y: 50, width: 400, height: 200 }
const base = {
	rectangles: [],
	circles: [],
	lineSegments: [],
	texts: [],
	inner,
	axisFields: { xField: null, yField: null, xType: null, yType: null },
	levelOrders: {},
	isRadar: false,
	xScaleRows: [],
	yScaleRows: [],
}
const LONG = "Recession begins after the housing market collapses"

describe("annotation Wrap text", () => {
	it("leaves the text alone while off", () => {
		expect(annotationDisplayText({ text: LONG })).toBe(LONG)
		expect(annotationDisplayText({ text: LONG, textWrap: false, textWrapChars: 5 })).toBe(LONG)
	})

	it("folds at the Characters target (20 by default) and keeps typed breaks", () => {
		expect(annotationDisplayText({ text: LONG, textWrap: true }).split("\n")).toEqual([
			"Recession begins after",
			"the housing market",
			"collapses",
		])
		expect(
			annotationDisplayText({ text: "one two\nthree four", textWrap: true, textWrapChars: 4 })
		).toBe("one\ntwo\nthree\nfour")
	})

	it("grows a text annotation's box taller and narrower", () => {
		const anno = { ...newTextAnnotation("t"), text: LONG }
		const [flat] = layoutPanelAnnotations({ ...base, texts: [anno] })
		const [wrapped] = layoutPanelAnnotations({
			...base,
			texts: [{ ...anno, textWrap: true }],
		})
		if (flat?.kind !== "text" || wrapped?.kind !== "text") throw new Error("not text")
		expect(wrapped.box.height).toBeGreaterThan(flat.box.height)
		expect(wrapped.box.width).toBeLessThan(flat.box.width)
	})

	it("wraps a rectangle's label the same way", () => {
		const rect = { ...newRectangle("r"), text: LONG, textWrap: true }
		expect(rectangleTextStyle(rect).text.split("\n")).toHaveLength(3)
	})
})
