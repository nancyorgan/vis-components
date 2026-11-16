/** Inside-legend reservation invariants (`computeInsideExtras`): swept over
 *  positions and legend sizes rather than checked at single points.
 *
 *  An inside legend is placed at plot-relative X / Y; when it would spill
 *  off the canvas the chart is padded on that side so it stays in view.
 *  The padding must be BOUNDED (the chart cannot give up more than the
 *  canvas) and SMOOTH (a legend one pixel taller, or nudged one pixel, must
 *  not move the chart by hundreds).
 *
 *  Each rule has a ceiling: the number of swept cases that break it today.
 *  The assertions are exact — up means a regression, down means a fix
 *  landed and the ceiling should be lowered to keep it. See
 *  `lib/facetLayoutSolver.invariants.test.ts` for the same pattern. */

import { describe, expect, it } from "vitest"

import { computeInsideExtras } from "./ChartCanvas"

const CANVASES = [
	{ w: 900, h: 600 },
	{ w: 500, h: 400 },
	{ w: 1400, h: 900 },
] as const

/** A one-line chart title's band, as ChartCanvas passes it. */
const TITLE_RESERVES = 36

const steps = (lo: number, hi: number, step: number): number[] => {
	const out: number[] = []
	for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
	return out
}

const extras = (
	canvas: { w: number; h: number },
	insideX: number | null,
	insideY: number,
	legendW: number,
	legendH: number
) =>
	computeInsideExtras({
		insideX,
		insideY,
		canvasW: canvas.w,
		canvasH: canvas.h,
		legendW,
		legendH,
		titleReserves: TITLE_RESERVES,
	})

const expectCeiling = (count: number, ceiling: number, what: string): void => {
	expect(
		count,
		count > ceiling
			? `${count} ${what}, up from ${ceiling}: a change made the inside-legend reserve worse`
			: `${count} ${what}, down from ${ceiling}: lower the ceiling to ${count} to keep the gain`
	).toBe(ceiling)
}

/** A 1 px change in the legend's size or position should not move any side's
 *  padding by more than this. */
const MAX_STEP_PX = 4

// What these rules caught (all five were broken until 2026-11): the legend's
// position is a FRACTION of the plot, and the plot's size depends on the
// room the legend is given, so the reservation solves a circular equation.
// Its exact solution divides by (1 − Y) and by X: near Y = 1 (the default is
// 0.98) one more pixel of legend needed fifty more pixels of padding, with
// no upper bound. Each side was also switched on by a threshold (Y > 1,
// X < 0), so crossing it stepped the padding from nothing to a whole legend.
// `computeInsideExtras` now uses the exact solution only where padding is
// efficient, tapers it to nothing where it is not, and has no thresholds.
describe("inside-legend reservation invariants", () => {
	it("never pads a side by more than the canvas", () => {
		let over = 0
		for (const canvas of CANVASES)
			for (const [legendW, legendH] of [
				[140, 120],
				[300, 300],
				[140, canvas.h - 40],
				[canvas.w - 40, 100],
			] as const)
				for (const x of [null, ...steps(-0.5, 1.5, 0.05)])
					for (const y of steps(-0.5, 1.5, 0.05)) {
						const e = extras(canvas, x, y, legendW, legendH)
						if (e.left > canvas.w || e.right > canvas.w || e.top > canvas.h || e.bottom > canvas.h)
							over++
					}
		expectCeiling(over, 0, "swept placements pad a side by more than the whole canvas")
	})

	it("a legend one pixel taller never jumps the vertical padding", () => {
		let jumpy = 0
		for (const canvas of CANVASES)
			for (const y of steps(-0.5, 1.5, 0.02)) {
				let prev = extras(canvas, null, y, 140, 20)
				let jumped = false
				for (let h = 21; h <= canvas.h; h++) {
					const now = extras(canvas, null, y, 140, h)
					if (
						Math.abs(now.bottom - prev.bottom) > MAX_STEP_PX ||
						Math.abs(now.top - prev.top) > MAX_STEP_PX
					)
						jumped = true
					prev = now
				}
				if (jumped) jumpy++
			}
		expectCeiling(jumpy, 0, "(canvas, Y) sweeps jump as the legend grows taller")
	})

	it("a legend one pixel wider never jumps the horizontal padding", () => {
		let jumpy = 0
		for (const canvas of CANVASES)
			for (const x of steps(-0.5, 1.5, 0.02)) {
				let prev = extras(canvas, x, 0.5, 20, 100)
				let jumped = false
				for (let w = 21; w <= canvas.w; w++) {
					const now = extras(canvas, x, 0.5, w, 100)
					if (
						Math.abs(now.left - prev.left) > MAX_STEP_PX ||
						Math.abs(now.right - prev.right) > MAX_STEP_PX
					)
						jumped = true
					prev = now
				}
				if (jumped) jumpy++
			}
		expectCeiling(jumpy, 0, "(canvas, X) sweeps jump as the legend grows wider")
	})

	it("nudging the legend one pixel vertically never jumps the padding", () => {
		let jumpy = 0
		for (const canvas of CANVASES)
			for (const legendH of [80, 200, 400]) {
				// One pixel of plot height, in plot-relative units.
				const step = 1 / (canvas.h - 140)
				let prev = extras(canvas, null, -0.5, 140, legendH)
				let jumped = false
				for (const y of steps(-0.5 + step, 1.5, step)) {
					const now = extras(canvas, null, y, 140, legendH)
					if (
						Math.abs(now.bottom - prev.bottom) > MAX_STEP_PX ||
						Math.abs(now.top - prev.top) > MAX_STEP_PX
					)
						jumped = true
					prev = now
				}
				if (jumped) jumpy++
			}
		expectCeiling(jumpy, 0, "(canvas, legend height) sweeps jump as Y moves")
	})

	it("nudging the legend one pixel horizontally never jumps the padding", () => {
		let jumpy = 0
		for (const canvas of CANVASES)
			for (const legendW of [80, 200, 400]) {
				const step = 1 / (canvas.w - 124)
				let prev = extras(canvas, -0.5, 0.5, legendW, 100)
				let jumped = false
				for (const x of steps(-0.5 + step, 1.5, step)) {
					const now = extras(canvas, x, 0.5, legendW, 100)
					if (
						Math.abs(now.left - prev.left) > MAX_STEP_PX ||
						Math.abs(now.right - prev.right) > MAX_STEP_PX
					)
						jumped = true
					prev = now
				}
				if (jumped) jumpy++
			}
		expectCeiling(jumpy, 0, "(canvas, legend width) sweeps jump as X moves")
	})
})

describe("inside-legend reservation — over the solved plot", () => {
	// The legend's coordinates are fractions of the PLOT. The reservation used
	// to assume the base margins (76 px on the left, 64 below); a chart whose
	// y tick labels need 200 px has its plot elsewhere, so the room reserved
	// was for a legend somewhere the legend was not.
	const canvas = { w: 900, h: 600 }
	const legend = { w: 160, h: 120 }
	const reserve = (plotMargins: { top: number; right: number; bottom: number; left: number } | null) =>
		computeInsideExtras({
			insideX: 1,
			insideY: 0,
			canvasW: canvas.w,
			canvasH: canvas.h,
			legendW: legend.w,
			legendH: legend.h,
			titleReserves: 0,
			plotMargins,
		})

	it("with no solved plot it assumes the base margins", () => {
		const base = reserve(null)
		const same = reserve({ top: 16, right: 24, bottom: 64, left: 76 })
		expect(base).toEqual(same)
	})

	it("a plot with a wider right margin needs less room on the right", () => {
		// The legend hangs right and down from the plot's bottom-right corner.
		// With the plot's right edge further from the canvas edge, less of the
		// legend passes it.
		const narrow = reserve({ top: 16, right: 24, bottom: 64, left: 76 })
		const wide = reserve({ top: 16, right: 120, bottom: 64, left: 76 })
		expect(narrow.right).toBeGreaterThan(0)
		expect(wide.right).toBeLessThan(narrow.right)
	})

	it("a plot with a taller bottom margin needs less room below", () => {
		const short = reserve({ top: 16, right: 24, bottom: 64, left: 76 })
		const tall = reserve({ top: 16, right: 24, bottom: 200, left: 76 })
		expect(short.bottom).toBeGreaterThan(0)
		expect(tall.bottom).toBeLessThan(short.bottom)
	})

	it("reserves exactly what brings the legend to the edge buffer", () => {
		// insideX = 1: padding the right side moves the legend 1 px per px,
		// so the room is exactly the spill.
		const margins = { top: 16, right: 24, bottom: 64, left: 76 }
		const { right } = reserve(margins)
		const plotRight = canvas.w - 12 - margins.right
		expect(right).toBeCloseTo(plotRight + legend.w - (canvas.w - 10), 5)
	})
})
