import { describe, expect, it } from "vitest"
import { newLineSegment } from "./annotationsConfig"
import { computeLineSegmentPixels } from "./lineSegmentAnnotationGeometry"
import { makePositionScale } from "./scales"

const inner = { x: 100, y: 50, width: 400, height: 200 }
const noScales = {
	xScale: null,
	yScale: null,
	xType: null,
	yType: null,
}

describe("computeLineSegmentPixels — percent mode", () => {
	it("projects both endpoints with the bottom-up y convention (y flipped)", () => {
		// Default: A=(0.25,0.4) → B=(0.75,0.7).
		const geo = computeLineSegmentPixels(newLineSegment("l1"), inner, noScales)
		expect(geo).not.toBeNull()
		// x1 = 100 + 400*0.25 = 200 ; x2 = 100 + 400*0.75 = 400
		expect(geo?.x1).toBe(200)
		expect(geo?.x2).toBe(400)
		// y is flipped: y1 = 50 + 200*(1-0.4) = 170 ; y2 = 50 + 200*(1-0.7) = 110
		expect(geo?.y1).toBe(170)
		expect(geo?.y2).toBe(110)
	})

	it("supports a horizontal reference line (yMin == yMax)", () => {
		const line = {
			...newLineSegment("l1"),
			xMin: 0,
			xMax: 1,
			yMin: 0.5,
			yMax: 0.5,
		}
		const geo = computeLineSegmentPixels(line, inner, noScales)
		expect(geo?.x1).toBe(100) // left edge
		expect(geo?.x2).toBe(500) // right edge
		expect(geo?.y1).toBe(150) // 50 + 200*0.5
		expect(geo?.y2).toBe(150)
	})
})

describe("computeLineSegmentPixels — values mode", () => {
	// x domain 0..100 over [100, 500] = 4px/unit; y domain 0..50 over the
	// INVERTED range [250, 50] (bottom→top) so larger data values sit higher.
	const xScale = makePositionScale([0, 100], "quantitative", [
		inner.x,
		inner.x + inner.width,
	])
	const yScale = makePositionScale([0, 50], "quantitative", [
		inner.y + inner.height,
		inner.y,
	])
	const ctx = {
		xScale,
		yScale,
		xType: "quantitative" as const,
		yType: "quantitative" as const,
	}

	it("maps endpoints through the position scales", () => {
		const line = {
			...newLineSegment("l1"),
			coordSystem: "values" as const,
			xMin: 0,
			yMin: 0,
			xMax: 100,
			yMax: 50,
		}
		const geo = computeLineSegmentPixels(line, inner, ctx)
		// x: 0→100px, 100→500px
		expect(geo?.x1).toBe(100)
		expect(geo?.x2).toBe(500)
		// y inverted: 0→bottom(250), 50→top(50)
		expect(geo?.y1).toBe(250)
		expect(geo?.y2).toBe(50)
	})

	it("falls back to percent placement when the axis scale is unavailable", () => {
		// values mode but no scales (e.g. a pie's missing axis) → percent math.
		const line = {
			...newLineSegment("l1"),
			coordSystem: "values" as const,
			xMin: 0.5,
			yMin: 0.5,
			xMax: 0.5,
			yMax: 0.5,
		}
		const geo = computeLineSegmentPixels(line, inner, noScales)
		expect(geo?.x1).toBe(300) // 100 + 400*0.5
		expect(geo?.y1).toBe(150) // 50 + 200*(1-0.5)
	})
})
