import { describe, expect, it } from "vitest"
import { BASE_MARGIN } from "../../lib/plotLayout"
import { EDGE_BUFFER, computeInsideExtras } from "./ChartCanvas"

const CHART_PAD = 12

/** Recompute the legend's far-edge pixel position given the extras the layout
 *  reserved, mirroring `Legend.insideStyle`'s calc(): the legend is anchored
 *  by its TOP-LEFT corner and extends right / down. Used to assert the
 *  reservation lands the legend flush against the canvas edge (no clip). */
const legendRightEdge = (
	insideX: number,
	canvasW: number,
	legendW: number,
	rightExtra: number
): number => {
	const plotLeftPx = CHART_PAD + BASE_MARGIN.left // extras.left = 0 here
	const horizontalReserve =
		CHART_PAD + BASE_MARGIN.left + (CHART_PAD + BASE_MARGIN.right + rightExtra)
	const plotW = canvasW - horizontalReserve
	return plotLeftPx + insideX * plotW + legendW
}

const base = {
	canvasW: 1000,
	canvasH: 600,
	legendW: 140,
	legendH: 120,
	titleReserves: 0,
}

describe("computeInsideExtras", () => {
	it("reserves nothing before measurement (zero canvas)", () => {
		expect(
			computeInsideExtras({ ...base, canvasW: 0, canvasH: 0, insideX: 0.96, insideY: 0.98 })
		).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
	})

	it("is a no-op for a comfortably-inside legend", () => {
		// insideX 0.5 with a small legend fits with room to spare — the chart
		// must not be shrunk on any side.
		expect(
			computeInsideExtras({ ...base, insideX: 0.5, insideY: 0.5 })
		).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
	})

	it("reserves right room for an in-bounds top-right legend (regression)", () => {
		// The reported bug: X=0.96, Y=0.98 (both in [0,1]) previously reserved
		// nothing because `right` only fired for insideX > 1, so the top-left-
		// anchored legend spilled off the right edge and clipped.
		const extras = computeInsideExtras({ ...base, insideX: 0.96, insideY: 0.98 })
		expect(extras.right).toBeGreaterThan(0)
		expect(extras.left).toBe(0)
		expect(extras.top).toBe(0)
		expect(extras.bottom).toBe(0)
		// With the reserved room, the legend's right edge lands an EDGE_BUFFER
		// gap short of the canvas edge instead of overflowing (or sitting flush).
		expect(
			legendRightEdge(0.96, base.canvasW, base.legendW, extras.right)
		).toBeCloseTo(base.canvasW - EDGE_BUFFER, 5)
	})

	it("still handles the out-of-plot coord (insideX > 1) as before", () => {
		const extras = computeInsideExtras({ ...base, insideX: 1.2, insideY: 0.98 })
		expect(extras.right).toBeGreaterThan(0)
		expect(
			legendRightEdge(1.2, base.canvasW, base.legendW, extras.right)
		).toBeCloseTo(base.canvasW - EDGE_BUFFER, 5)
	})

	it("reserves bottom room for a tall legend anchored low (in-bounds)", () => {
		// Symmetric vertical case: a tall legend at a low insideY runs off the
		// canvas bottom even though the coord is in [0,1]. `bottom` now fires
		// for insideY < 1, not just insideY < 0.
		const extras = computeInsideExtras({
			...base,
			legendH: 500,
			insideX: 0.02,
			insideY: 0.1,
		})
		expect(extras.bottom).toBeGreaterThan(0)
		expect(extras.top).toBe(0)
	})

	it("does not divide by zero at the guard boundaries", () => {
		const atZeroX = computeInsideExtras({ ...base, insideX: 0, insideY: 0.5 })
		const atOneY = computeInsideExtras({ ...base, insideX: 0.5, insideY: 1 })
		for (const e of [atZeroX, atOneY]) {
			for (const v of Object.values(e)) {
				expect(Number.isFinite(v)).toBe(true)
				expect(v).toBeGreaterThanOrEqual(0)
			}
		}
	})
})
