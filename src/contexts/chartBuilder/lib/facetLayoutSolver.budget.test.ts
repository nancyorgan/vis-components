import { describe, expect, it } from "vitest"

import {
	solveFacetLayout,
	type FacetLayoutSpec,
	type SolverInput,
	type SolverPanelInput,
} from "./facetLayoutSolver"

/** One budget (LAYOUT.md §2): in fit mode the canvas is the container.
 *  Everything around the plot asks for room and the plot gets what is left,
 *  down to nothing; past that the asks themselves give way, so nothing
 *  scrolls and nothing leaves the page. With "Allow scrolling" on, the
 *  canvas grows instead.
 *
 *  One example per kind of ask. `facetLayoutSolver.invariants.test.ts`
 *  checks the same rules over thousands of generated layouts. */

const panelAt = (row: number, col: number, more: Partial<SolverPanelInput> = {}): SolverPanelInput => ({
	key: `${row}-${col}`,
	row,
	col,
	xLabels: ["Jan", "Feb", "Mar", "Apr"],
	yLabels: ["0", "50", "100"],
	xLabelAngleDeg: 0,
	xLabelFontSize: 16,
	yLabelFontSize: 16,
	xLabelMaxWidthPx: 28,
	yLabelMaxWidthPx: 30,
	xWeight: 1,
	yWeight: 1,
	...more,
})

const W = 800
const H = 500

const fit = (overrides: Partial<SolverInput> = {}): SolverInput => ({
	containerWidth: W,
	containerHeight: H,
	rows: 1,
	cols: 1,
	panels: [panelAt(0, 0)],
	chartTitle: { text: "Title", fontSize: 26, align: "left", textWidth: 70 },
	xTitle: { text: "X", fontSize: 18, align: "center", textWidth: 12 },
	yTitle: { text: "Y", fontSize: 18, align: "center", textWidth: 12, horizontal: false },
	gapX: 30,
	gapY: 30,
	shareX: true,
	shareY: true,
	proportionalSizing: false,
	minPanelPx: 0,
	...overrides,
})

const staysInContainer = (spec: FacetLayoutSpec): void => {
	expect(spec.scroll).toBeNull()
	expect(spec.canvas.width).toBeCloseTo(W, 5)
	expect(spec.canvas.height).toBeCloseTo(H, 5)
	for (const p of spec.panels) {
		expect(p.inner.x).toBeGreaterThanOrEqual(-0.5)
		expect(p.inner.y).toBeGreaterThanOrEqual(-0.5)
		expect(p.inner.x + p.inner.width).toBeLessThanOrEqual(W + 0.5)
		expect(p.inner.y + p.inner.height).toBeLessThanOrEqual(H + 0.5)
	}
}
const plotHeight = (spec: FacetLayoutSpec): number => spec.panels[0]!.inner.height
const plotWidth = (spec: FacetLayoutSpec): number => spec.panels[0]!.inner.width

describe("one budget — a title pushed away from the plot", () => {
	const titleUp = (offsetY: number): SolverInput =>
		fit({ chartTitle: { text: "Title", fontSize: 26, align: "left", textWidth: 70, offsetY } })

	it("squeezes the plot, one pixel per pixel, while there is plot left", () => {
		const rest = solveFacetLayout(fit())
		const pushed = solveFacetLayout(titleUp(-100))
		expect(plotHeight(rest) - plotHeight(pushed)).toBeCloseTo(100, 5)
		staysInContainer(pushed)
	})

	it("squeezes the plot to nothing and then stops: no scrollbar, the title still on the page", () => {
		const spec = solveFacetLayout(titleUp(-2000))
		staysInContainer(spec)
		// (To within floating-point noise: the reserves are scaled to fit.)
		expect(plotHeight(spec)).toBeCloseTo(0, 6)
		expect(spec.title!.y).toBeGreaterThan(0)
		expect(spec.title!.y).toBeLessThan(H)
	})

	it("never grows the plot back, and never jumps, on the way down", () => {
		let last = plotHeight(solveFacetLayout(titleUp(0)))
		for (let push = 1; push <= 700; push++) {
			const spec = solveFacetLayout(titleUp(-push))
			const h = plotHeight(spec)
			expect(h).toBeLessThanOrEqual(last + 1e-9)
			expect(last - h).toBeLessThanOrEqual(1 + 1e-9)
			expect(spec.canvas.height).toBeCloseTo(H, 5)
			last = h
		}
		expect(last).toBeCloseTo(0, 6)
	})

	it("with Allow scrolling on, the canvas grows instead", () => {
		const spec = solveFacetLayout({ ...titleUp(-2000), minPanelPx: 200 })
		expect(spec.canvas.height).toBeGreaterThan(H)
		expect(spec.scroll).not.toBeNull()
		expect(plotHeight(spec)).toBeGreaterThan(0)
	})
})

describe("one budget — the other asks", () => {
	it("an x-title pushed far below the plot", () => {
		const spec = solveFacetLayout(
			fit({ xTitle: { text: "X", fontSize: 18, align: "center", textWidth: 12, offsetY: 2000 } })
		)
		staysInContainer(spec)
		expect(spec.xTitle!.y).toBeLessThan(H)
	})

	it("a y-title pushed far to the left", () => {
		const spec = solveFacetLayout(
			fit({
				yTitle: {
					text: "Y",
					fontSize: 18,
					align: "center",
					textWidth: 12,
					horizontal: false,
					offsetX: -3000,
				},
			})
		)
		staysInContainer(spec)
		expect(plotWidth(spec)).toBeCloseTo(0, 6)
		expect(spec.yTitle!.x).toBeGreaterThan(0)
	})

	it("caption, annotation and data-label margins larger than the page", () => {
		const spec = solveFacetLayout(
			fit({
				extraTopMargin: 900,
				extraBottomMargin: 900,
				extraLeftMargin: 1200,
				extraRightMargin: 1200,
			})
		)
		staysInContainer(spec)
	})

	it("two over-large margins share what room there is in proportion", () => {
		const even = solveFacetLayout(fit({ extraTopMargin: 900, extraBottomMargin: 900 }))
		const lopsided = solveFacetLayout(fit({ extraTopMargin: 1500, extraBottomMargin: 300 }))
		// The (zero-height) plot sits lower when the top asked for more.
		expect(lopsided.panels[0]!.inner.y).toBeGreaterThan(even.panels[0]!.inner.y)
		staysInContainer(lopsided)
	})

	it("tick labels longer than the page: the plot stays on it", () => {
		const spec = solveFacetLayout(
			fit({ panels: [panelAt(0, 0, { yLabelMaxWidthPx: 2000 })] })
		)
		staysInContainer(spec)
	})

	it("rotated tick labels taller than the page", () => {
		const spec = solveFacetLayout(
			fit({ panels: [panelAt(0, 0, { xLabelAngleDeg: -90, xLabelMaxWidthPx: 2000 })] })
		)
		staysInContainer(spec)
	})

	it("a grid of panels whose axes are not shared", () => {
		const panels = [0, 1, 2].flatMap((r) =>
			[0, 1, 2].map((c) => panelAt(r, c, { yLabelMaxWidthPx: 240, xLabelMaxWidthPx: 240 }))
		)
		const spec = solveFacetLayout(fit({ rows: 3, cols: 3, panels, shareX: false, shareY: false }))
		staysInContainer(spec)
	})
})

describe("one budget — the smallest container the chart still fits", () => {
	// `fitFloor` is what the page layout holds the chart area to beside a
	// legend: the legend gives way before the chart is squeezed under it.
	it("at the floor the canvas is still the container, with the plot at nothing", () => {
		const { fitFloor } = solveFacetLayout(fit())
		expect(fitFloor.height).toBeGreaterThan(0)
		expect(fitFloor.height).toBeLessThan(H)
		const atFloor = solveFacetLayout(fit({ containerHeight: Math.ceil(fitFloor.height) }))
		expect(atFloor.scroll).toBeNull()
		expect(atFloor.canvas.height).toBe(Math.ceil(fitFloor.height))
		expect(plotHeight(atFloor)).toBeLessThan(1.5)
	})

	it("one pixel under the floor the canvas can no longer be the container", () => {
		const { fitFloor } = solveFacetLayout(fit())
		const under = Math.floor(fitFloor.height) - 1
		const spec = solveFacetLayout(fit({ containerHeight: under }))
		expect(spec.canvas.height).toBeGreaterThan(under)
	})

	it("does not depend on how much room there is", () => {
		const roomy = solveFacetLayout(fit())
		const tight = solveFacetLayout(fit({ containerHeight: 120, containerWidth: 160 }))
		expect(tight.fitFloor).toEqual(roomy.fitFloor)
	})

	it("grows with the title band and ignores soft asks", () => {
		const plain = solveFacetLayout(fit())
		const bigTitle = solveFacetLayout(
			fit({ chartTitle: { text: "Title", fontSize: 60, align: "left", textWidth: 160 } })
		)
		expect(bigTitle.fitFloor.height).toBeGreaterThan(plain.fitFloor.height)
		// Caption / annotation / data-label margins are given up before the
		// floor is reached, so they do not raise it.
		const softAsks = solveFacetLayout(fit({ extraTopMargin: 300, extraBottomMargin: 300 }))
		expect(softAsks.fitFloor.height).toBeCloseTo(plain.fitFloor.height, 5)
	})

	it("is 0 on an axis that does not fit the container to begin with", () => {
		// Allow scrolling: the canvas grows instead.
		expect(solveFacetLayout({ ...fit(), minPanelPx: 200 }).fitFloor).toEqual({ width: 0, height: 0 })
		// A pixel panel height: that axis only.
		const fixedH = solveFacetLayout(fit({ panelHeightOverride: 300 })).fitFloor
		expect(fixedH.height).toBe(0)
		expect(fixedH.width).toBeGreaterThan(0)
	})
})

describe("one budget — what it leaves alone", () => {
	it("a layout whose asks fit is solved exactly as before", () => {
		// Nothing in the budget runs unless the asks exceed the container, so
		// an ordinary layout's plot is the container minus its chrome.
		const spec = solveFacetLayout(fit())
		expect(spec.canvas).toEqual({ width: W, height: H })
		expect(plotHeight(spec)).toBeGreaterThan(300)
		expect(plotWidth(spec)).toBeGreaterThan(600)
	})

	it("a pixel-precise panel size still grows the canvas (the user asked for that size)", () => {
		const spec = solveFacetLayout(fit({ panelHeightOverride: 900 }))
		expect(spec.canvas.height).toBeGreaterThan(H)
		expect(plotHeight(spec)).toBe(900)
	})

	it("a container too small for even the title band and base margins keeps a positive canvas", () => {
		const spec = solveFacetLayout({ ...fit(), containerWidth: 0, containerHeight: 0 })
		expect(spec.canvas.width).toBeGreaterThan(0)
		expect(spec.canvas.height).toBeGreaterThan(0)
	})
})
