import { describe, expect, it } from "vitest"

import { solveFacetLayout, type SolverInput, type SolverPanelInput } from "../../../lib/facetLayoutSolver"
import { BASE_MARGIN } from "../../../lib/plotLayout"

import { plotInsetsOf } from "./plotInsets"

/** Where the solved plot sits in its canvas — what the legend aligns to. */

const panel = (row: number, col: number, more: Partial<SolverPanelInput> = {}): SolverPanelInput => ({
	key: `${row}-${col}`,
	row,
	col,
	xLabels: ["a", "b"],
	yLabels: ["0", "50"],
	xLabelAngleDeg: 0,
	xLabelFontSize: 16,
	yLabelFontSize: 16,
	xLabelMaxWidthPx: 10,
	yLabelMaxWidthPx: 20,
	xWeight: 1,
	yWeight: 1,
	...more,
})

const input = (more: Partial<SolverInput> = {}): SolverInput => ({
	containerWidth: 900,
	containerHeight: 600,
	rows: 1,
	cols: 1,
	panels: [panel(0, 0)],
	gapX: 30,
	gapY: 30,
	shareX: true,
	shareY: true,
	proportionalSizing: false,
	minPanelPx: 0,
	...more,
})

describe("plotInsetsOf", () => {
	it("an untouched chart's plot sits at the base margins", () => {
		const insets = plotInsetsOf(solveFacetLayout(input()))
		expect(insets).toEqual({
			top: BASE_MARGIN.top,
			right: BASE_MARGIN.right,
			bottom: BASE_MARGIN.bottom,
			left: BASE_MARGIN.left,
		})
	})

	it("long y tick labels move the plot's left edge — and the insets with it", () => {
		const insets = plotInsetsOf(
			solveFacetLayout(input({ panels: [panel(0, 0, { yLabelMaxWidthPx: 220 })] }))
		)
		expect(insets!.left).toBeGreaterThan(BASE_MARGIN.left + 100)
		expect(insets!.right).toBe(BASE_MARGIN.right)
	})

	it("a chart title lowers the plot's top", () => {
		const insets = plotInsetsOf(
			solveFacetLayout(
				input({ chartTitle: { text: "Title", fontSize: 26, align: "left", textWidth: 70 } })
			)
		)
		expect(insets!.top).toBeGreaterThan(BASE_MARGIN.top + 20)
	})

	it("a faceted grid counts as one plot: the union of its panels", () => {
		const panels = [panel(0, 0), panel(0, 1), panel(1, 0), panel(1, 1)]
		const spec = solveFacetLayout(input({ rows: 2, cols: 2, panels }))
		const insets = plotInsetsOf(spec)!
		const first = spec.panels.find((p) => p.key === "0-0")!.inner
		const last = spec.panels.find((p) => p.key === "1-1")!.inner
		expect(insets.left).toBe(Math.round(first.x))
		expect(insets.top).toBe(Math.round(first.y))
		expect(insets.right).toBe(Math.round(spec.canvas.width - (last.x + last.width)))
		expect(insets.bottom).toBe(Math.round(spec.canvas.height - (last.y + last.height)))
	})

	it("a fixed aspect ratio's centering is part of where the plot is", () => {
		// A tall narrow ratio leaves the plot centered with room either side.
		const insets = plotInsetsOf(solveFacetLayout(input({ aspectRatio: 2 })))!
		expect(insets.left).toBeGreaterThan(BASE_MARGIN.left)
		expect(insets.right).toBeGreaterThan(BASE_MARGIN.right)
	})
})
