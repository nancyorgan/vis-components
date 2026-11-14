import { describe, expect, it } from "vitest"

import {
	solveFacetLayout,
	type SolverInput,
	type SolverPanelInput,
} from "./facetLayoutSolver"

/** The x tick labels' angle is decided ONCE, by the solver, from the plot
 *  width it solved (LAYOUT.md §11).
 *
 *  It used to be decided twice: by the caller, from an ESTIMATE of the plot
 *  width, to reserve the room; and again by the axis, from the real width,
 *  to draw. Near the point where labels start to collide the two disagreed:
 *  room reserved for rotated labels that then drew level (a blank strip
 *  under the axis), or level room under labels drawn rotated (they ran into
 *  the axis title). Now a panel says its angle is automatic and the solver
 *  reports the angle it solved for, which the axis draws. */

const LABELS = ["Northeast", "Southeast", "Midwest", "Southwest", "Northwest", "Mountain"]
/** Each label 70 px wide at 16 px: six of them need about 6 × (70 + 4) px. */
const WIDTHS = LABELS.map(() => 70)

const panel = (more: Partial<SolverPanelInput> = {}): SolverPanelInput => ({
	key: "0-0",
	row: 0,
	col: 0,
	xLabels: LABELS,
	yLabels: ["0", "50", "100"],
	xLabelAngleDeg: 0,
	xAutoAngle: { labels: LABELS, labelWidthsPx: WIDTHS },
	xLabelFontSize: 16,
	yLabelFontSize: 16,
	xLabelMaxWidthPx: 70,
	yLabelMaxWidthPx: 30,
	xWeight: 1,
	yWeight: 1,
	...more,
})

const input = (width: number, more: Partial<SolverPanelInput> = {}): SolverInput => ({
	containerWidth: width,
	containerHeight: 500,
	rows: 1,
	cols: 1,
	panels: [panel(more)],
	gapX: 30,
	gapY: 30,
	shareX: true,
	shareY: true,
	proportionalSizing: false,
	minPanelPx: 0,
})

const solved = (width: number, more: Partial<SolverPanelInput> = {}) =>
	solveFacetLayout(input(width, more)).panels[0]!

describe("automatic x tick-label angle — decided by the solver", () => {
	it("stays level while the labels fit the plot it solved", () => {
		expect(solved(900).xLabelAngleDeg).toBe(0)
	})

	it("rotates when neighboring labels would collide at that width", () => {
		expect(solved(380).xLabelAngleDeg).toBe(-45)
	})

	it("reserves the room for the angle it reports", () => {
		// Rotated labels are taller than level ones, so the plot is shorter.
		const level = solved(380, { xAutoAngle: undefined, xLabelAngleDeg: 0 })
		const auto = solved(380)
		expect(auto.xLabelAngleDeg).toBe(-45)
		expect(auto.inner.height).toBeLessThan(level.inner.height)
		// And exactly as much as asking for that angle outright.
		const asked = solved(380, { xAutoAngle: undefined, xLabelAngleDeg: -45 })
		expect(auto.inner.height).toBeCloseTo(asked.inner.height, 5)
		expect(auto.inner.width).toBeCloseTo(asked.inner.width, 5)
	})

	it("flips exactly once as the container narrows, and never back", () => {
		let flips = 0
		let last = solved(900).xLabelAngleDeg
		for (let width = 899; width >= 200; width--) {
			const angle = solved(width).xLabelAngleDeg
			if (angle !== last) flips++
			last = angle
		}
		expect(flips).toBe(1)
		expect(last).toBe(-45)
	})

	it("decides from the SOLVED width, not the container's", () => {
		// The same container, with y tick labels long enough to narrow the
		// plot: labels that fit beside short y labels collide beside long ones.
		const width = 560
		expect(solved(width).xLabelAngleDeg).toBe(0)
		expect(solved(width, { yLabelMaxWidthPx: 160 }).xLabelAngleDeg).toBe(-45)
	})

	it("an explicit angle is left alone, 0 included", () => {
		// No `xAutoAngle`: the panel's angle is the user's.
		expect(solved(380, { xAutoAngle: undefined, xLabelAngleDeg: 0 }).xLabelAngleDeg).toBe(0)
		expect(solved(900, { xAutoAngle: undefined, xLabelAngleDeg: -90 }).xLabelAngleDeg).toBe(-90)
	})

	it("each panel of a grid decides for its own labels", () => {
		const short = ["A", "B", "C", "D", "E", "F"]
		const spec = solveFacetLayout({
			...input(700),
			cols: 2,
			shareX: false,
			panels: [
				panel({ key: "0-0", col: 0 }),
				panel({
					key: "0-1",
					col: 1,
					xLabels: short,
					xAutoAngle: { labels: short, labelWidthsPx: short.map(() => 10) },
					xLabelMaxWidthPx: 10,
				}),
			],
		})
		expect(spec.panels.map((p) => p.xLabelAngleDeg)).toEqual([-45, 0])
	})

})
