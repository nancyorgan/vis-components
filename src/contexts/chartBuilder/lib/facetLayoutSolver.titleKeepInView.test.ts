import { describe, expect, it } from "vitest"

import {
	solveFacetLayout,
	type SolverInput,
	type SolverPanelInput,
} from "./facetLayoutSolver"

/** Axis titles stay on the page ALONG their own direction (LAYOUT.md §8).
 *
 *  Each title was already held on the canvas across its direction (the
 *  x-title's baseline, the rotated y-title's x). "Adjust position" also
 *  slides an x-title sideways and a y-title up and down, and nothing held
 *  those: the title left the page. These pin the fix with one example each;
 *  `facetLayoutSolver.invariants.test.ts` checks the same rule over
 *  thousands of generated layouts. */

const BUFFER = 10

const panel: SolverPanelInput = {
	key: "0-0",
	row: 0,
	col: 0,
	xLabels: ["Jan", "Feb", "Mar", "Apr"],
	yLabels: ["0", "50", "100"],
	xLabelAngleDeg: 0,
	xLabelFontSize: 16,
	yLabelFontSize: 16,
	xLabelMaxWidthPx: 28,
	yLabelMaxWidthPx: 30,
	xWeight: 1,
	yWeight: 1,
}

const base = (overrides: Partial<SolverInput> = {}): SolverInput => ({
	containerWidth: 900,
	containerHeight: 600,
	rows: 1,
	cols: 1,
	panels: [panel],
	xTitle: { text: "Month of the year", fontSize: 18, align: "center", textWidth: 160 },
	yTitle: {
		text: "Sales in dollars",
		fontSize: 18,
		align: "center",
		textWidth: 140,
		horizontal: false,
	},
	gapX: 30,
	gapY: 30,
	shareX: true,
	shareY: true,
	proportionalSizing: false,
	minPanelPx: 0,
	...overrides,
})

const withXTitle = (patch: Partial<NonNullable<SolverInput["xTitle"]>>): SolverInput => {
	const input = base()
	return { ...input, xTitle: { ...input.xTitle!, ...patch } }
}
const withYTitle = (patch: Partial<NonNullable<SolverInput["yTitle"]>>): SolverInput => {
	const input = base()
	return { ...input, yTitle: { ...input.yTitle!, ...patch } }
}

describe("x-axis title — kept in view sideways", () => {
	it("is where it is aligned while it fits", () => {
		const rest = solveFacetLayout(base())
		const nudged = solveFacetLayout(withXTitle({ offsetX: 40 }))
		expect(nudged.xTitle!.x).toBeCloseTo(rest.xTitle!.x + 40, 5)
	})

	it("stops at the right edge instead of leaving the page", () => {
		const spec = solveFacetLayout(withXTitle({ offsetX: 5000 }))
		// Centered text: half its width lies past the anchor.
		expect(spec.xTitle!.x).toBeCloseTo(spec.canvas.width - BUFFER - 80, 5)
	})

	it("stops at the left edge too", () => {
		const spec = solveFacetLayout(withXTitle({ offsetX: -5000 }))
		expect(spec.xTitle!.x).toBeCloseTo(BUFFER + 80, 5)
	})

	it("accounts for the side the text runs to", () => {
		// Left-aligned text starts at its anchor and runs right.
		const left = solveFacetLayout(withXTitle({ align: "left", offsetX: 5000 }))
		expect(left.xTitle!.x).toBeCloseTo(left.canvas.width - BUFFER - 160, 5)
		// Right-aligned text ends at its anchor.
		const right = solveFacetLayout(withXTitle({ align: "right", offsetX: 5000 }))
		expect(right.xTitle!.x).toBeCloseTo(right.canvas.width - BUFFER, 5)
	})

	it("moves one pixel at a time on the way to the edge, then stays", () => {
		let last = solveFacetLayout(withXTitle({ offsetX: 0 })).xTitle!.x
		for (let offset = 1; offset <= 600; offset++) {
			const x = solveFacetLayout(withXTitle({ offsetX: offset })).xTitle!.x
			expect(x - last).toBeGreaterThanOrEqual(0)
			expect(x - last).toBeLessThanOrEqual(1 + 1e-9)
			last = x
		}
	})

	it("an unmeasured title is left as aligned", () => {
		const spec = solveFacetLayout(withXTitle({ textWidth: undefined, offsetX: 5000 }))
		expect(spec.xTitle!.x).toBeGreaterThan(spec.canvas.width)
	})
})

describe("rotated y-axis title — kept in view along the axis", () => {
	// Rotated -90° the text reads bottom-to-top, centered on its anchor here:
	// half its width above the anchor, half below.
	it("stops at the bottom edge instead of leaving the page", () => {
		const spec = solveFacetLayout(withYTitle({ offsetY: 5000 }))
		expect(spec.yTitle!.y).toBeCloseTo(spec.canvas.height - BUFFER - 70, 5)
	})

	it("stops at the top edge too", () => {
		const spec = solveFacetLayout(withYTitle({ offsetY: -5000 }))
		expect(spec.yTitle!.y).toBeCloseTo(BUFFER + 70, 5)
	})

	it("accounts for which way the text runs from its anchor", () => {
		// "left" starts at the panel floor and runs UP: all of it is above.
		const fromFloor = solveFacetLayout(withYTitle({ align: "left", offsetY: -5000 }))
		expect(fromFloor.yTitle!.y).toBeCloseTo(BUFFER + 140, 5)
		const fromFloorDown = solveFacetLayout(withYTitle({ align: "left", offsetY: 5000 }))
		expect(fromFloorDown.yTitle!.y).toBeCloseTo(fromFloorDown.canvas.height - BUFFER, 5)
	})

	it("an unmeasured title is left as aligned", () => {
		const spec = solveFacetLayout(withYTitle({ textWidth: undefined, offsetY: 5000 }))
		expect(spec.yTitle!.y).toBeGreaterThan(spec.canvas.height)
	})
})

describe("upright y-axis title — kept in view up and down", () => {
	const upright = { horizontal: true, textWidth: 140 }

	it("stops at the bottom edge by its descender", () => {
		const spec = solveFacetLayout(withYTitle({ ...upright, offsetY: 5000 }))
		expect(spec.yTitle!.y).toBeCloseTo(spec.canvas.height - BUFFER - 18 * 0.2, 5)
	})

	it("stops at the top edge by its ascender", () => {
		const spec = solveFacetLayout(withYTitle({ ...upright, offsetY: -5000 }))
		expect(spec.yTitle!.y).toBeCloseTo(BUFFER + 18 * 0.8, 5)
	})

	it("keeps every line of a wrapped title above the bottom edge", () => {
		const oneLine = solveFacetLayout(withYTitle({ ...upright, offsetY: 5000 }))
		const twoLines = solveFacetLayout(
			withYTitle({ ...upright, text: "Sales in\ndollars", offsetY: 5000 })
		)
		// The second line hangs one line step below the first baseline.
		expect(oneLine.yTitle!.y - twoLines.yTitle!.y).toBeGreaterThan(18)
	})

	it("reserves its band from the measured width, not a character count", () => {
		const narrow = solveFacetLayout(withYTitle({ ...upright, textWidth: 60 }))
		const wide = solveFacetLayout(withYTitle({ ...upright, textWidth: 200 }))
		// The same text measured wider pushes the plot further right, by the
		// difference.
		expect(wide.panels[0]!.inner.x - narrow.panels[0]!.inner.x).toBeCloseTo(140, 5)
	})
})

describe("a title pulled toward the plot — the plot grows, but not over its tick labels", () => {
	// Moving an axis title toward the plot hands the plot the room the title
	// left (§8). The plot's edge used to run all the way to the canvas
	// buffer, so the tick labels hanging from that edge were cut off by a few
	// pixels (found by the browser layout sweep on every cartesian chart).
	// The labels' band is 16 px text: 6 px pad + one 22.4 px line below the
	// x axis; a 30 px label plus its 8 px inset (the 4 px tick and a 4 px
	// pad) left of the y axis.
	const X_LABEL_BAND = 6 + 16 * 1.4
	const Y_LABEL_BAND = 30 + 8

	it("an x-title pulled up: the plot's bottom keeps the x tick labels on the page", () => {
		const rest = solveFacetLayout(base())
		const pulled = solveFacetLayout(withXTitle({ offsetY: -2000 }))
		const bottom = (spec: typeof rest) => spec.panels[0]!.inner.y + spec.panels[0]!.inner.height
		// It did grow…
		expect(bottom(pulled)).toBeGreaterThan(bottom(rest))
		// …and stopped where the labels still fit above the buffer.
		expect(bottom(pulled)).toBeCloseTo(pulled.canvas.height - BUFFER - X_LABEL_BAND, 5)
	})

	it("a y-title pulled right: the plot's left edge keeps the y tick labels on the page", () => {
		const rest = solveFacetLayout(base())
		const pulled = solveFacetLayout(withYTitle({ offsetX: 2000 }))
		expect(pulled.panels[0]!.inner.x).toBeLessThan(rest.panels[0]!.inner.x)
		expect(pulled.panels[0]!.inner.x).toBeCloseTo(BUFFER + Y_LABEL_BAND, 5)
	})

	it("a small pull still moves the plot one pixel per pixel", () => {
		const rest = solveFacetLayout(base())
		const pulled = solveFacetLayout(withXTitle({ offsetY: -10 }))
		expect(pulled.panels[0]!.inner.height - rest.panels[0]!.inner.height).toBeCloseTo(10, 5)
	})
})
