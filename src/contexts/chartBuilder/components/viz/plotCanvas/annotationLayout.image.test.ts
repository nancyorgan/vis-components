import { describe, expect, it } from "vitest"
import { newImageAnnotation } from "../../../lib/annotationsConfig"
import { layoutPanelAnnotations } from "./annotationLayout"

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
const PNG = "data:image/png;base64,iVBORw0KGgo="

describe("layoutPanelAnnotations — images", () => {
	it("skips an image annotation with no picture chosen yet", () => {
		expect(layoutPanelAnnotations({ ...base, images: [newImageAnnotation("m")] })).toEqual([])
	})

	it("places a picture by its anchor, width and aspect, with a stroke-free bbox", () => {
		const placed = layoutPanelAnnotations({
			...base,
			images: [
				{
					...newImageAnnotation("m"),
					href: PNG,
					aspect: 2,
					naturalWidth: 400,
					width: 100,
					height: 50,
					sizeUnit: "px",
					anchorH: "right",
					anchorV: "bottom",
					coordSystem: "pixelsBottomRight",
					x: 0,
					y: 0,
				},
			],
		})
		expect(placed).toHaveLength(1)
		const m = placed[0]!
		expect(m.kind).toBe("image")
		if (m.kind !== "image") return
		// Bottom-right corner of the plot, 100 × 50, tucked inside it.
		expect(m).toMatchObject({ left: 400, top: 200, width: 100, height: 50 })
		expect(m.bbox).toEqual({ left: 400, top: 200, right: 500, bottom: 250 })
	})

	it("reads a percent size against the picture's natural size", () => {
		const placed = layoutPanelAnnotations({
			...base,
			images: [
				{
					...newImageAnnotation("m"),
					href: PNG,
					aspect: 2,
					naturalWidth: 400,
					width: 50,
					height: 50,
					sizeUnit: "percent",
				},
			],
		})
		expect(placed[0]).toMatchObject({ kind: "image", width: 200, height: 100 })
	})

	it("stretches to both dimensions when the aspect ratio is unlocked", () => {
		const placed = layoutPanelAnnotations({
			...base,
			images: [
				{ ...newImageAnnotation("m"), href: PNG, aspect: 2, width: 100, height: 100, lockAspect: false },
			],
		})
		expect(placed[0]).toMatchObject({ kind: "image", width: 100, height: 100 })
	})

	it("skips value-mode images on radar, where there are no cartesian scales", () => {
		const placed = layoutPanelAnnotations({
			...base,
			isRadar: true,
			images: [{ ...newImageAnnotation("m"), href: PNG, coordSystem: "values" }],
		})
		expect(placed).toEqual([])
	})
})
