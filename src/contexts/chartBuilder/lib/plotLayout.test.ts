import { describe, expect, it } from "vitest"

import { BASE_MARGIN, computePlotLayout } from "./plotLayout"

/** Pin the height floor at just-above-margin-sum and verify that the
 *  inner plot area scales linearly with the input bounds.
 *
 *  The floor used to be a hardcoded 200, which clamped small faceted
 *  panels and distorted their inner band/point scales — visible as a
 *  single-category panel's title sitting "2 lines above" its first
 *  gridline while a multi-category panel's title sat "1 line above".
 *
 *  These tests would FAIL if the floor were raised back to 200: a 120px
 *  panel's inner height would jump to 120 instead of 40. */
describe("computePlotLayout — height floor", () => {
	it("uses the actual bounds.height when it exceeds the floor", () => {
		const layout = computePlotLayout({ width: 600, height: 220 }, false, false)
		expect(layout.height).toBe(220)
		// inner.y0 = BASE_MARGIN.top, inner.y1 = height - BASE_MARGIN.bottom
		expect(layout.inner.y0).toBe(BASE_MARGIN.top)
		expect(layout.inner.y1).toBe(220 - BASE_MARGIN.bottom)
		// Plot area = 220 - 16 - 64 = 140
		expect(layout.inner.y1 - layout.inner.y0).toBe(140)
	})

	it("does NOT clamp a 120px panel up to 200 (this was the faceted-chart bug)", () => {
		const layout = computePlotLayout({ width: 600, height: 120 }, false, false)
		// Old behavior: height = max(200, 120) = 200. Plot area = 120.
		// New behavior: height = max(100, 120) = 120. Plot area = 40.
		expect(layout.height).toBeLessThan(200)
		expect(layout.height).toBe(120)
		expect(layout.inner.y1 - layout.inner.y0).toBe(40)
	})

	it("inner plot area scales linearly with bounds.height across faceted-panel-like sizes", () => {
		// Three panels of varying heights — like a 3×1 facet with weights
		// [6, 3, 1] under proportional sizing. Plot area should be the
		// panel height minus a constant (the axis margins). If the floor
		// kicks in for any panel, that linearity breaks.
		const heights = [120, 160, 220]
		const innerHeights = heights.map(
			(h) =>
				computePlotLayout({ width: 600, height: h }, false, false).inner.y1 -
				computePlotLayout({ width: 600, height: h }, false, false).inner.y0
		)
		// Each pair of adjacent inner heights should differ by the same
		// amount as the bounds heights — linearity check.
		expect(innerHeights[1]! - innerHeights[0]!).toBe(heights[1]! - heights[0]!)
		expect(innerHeights[2]! - innerHeights[1]!).toBe(heights[2]! - heights[1]!)
	})

	it("falls back to the floor when bounds.height is 0 (pre-measurement state)", () => {
		// Initial render before useMeasure resolves: bounds is {0, 0}.
		// We must still produce non-negative inner dimensions.
		const layout = computePlotLayout({ width: 0, height: 0 }, false, false)
		expect(layout.height).toBeGreaterThan(BASE_MARGIN.top + BASE_MARGIN.bottom)
		expect(layout.inner.y1).toBeGreaterThan(layout.inner.y0)
	})
})
