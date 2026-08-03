import { describe, expect, it } from "vitest"
import {
	solveFacetLayout,
	type FacetLabelInput,
	type SolverInput,
	type SolverPanelInput,
} from "./facetLayoutSolver"
import { BASE_MARGIN, POLAR_MARGIN } from "./plotLayout"

/** Build a baseline input. Specific tests override individual fields. */
const makePanels = (
	rows: number,
	cols: number,
	overrides: Partial<SolverPanelInput> = {}
): SolverPanelInput[] => {
	const panels: SolverPanelInput[] = []
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			panels.push({
				key: `${r}-${c}`,
				row: r,
				col: c,
				xLabels: [],
				yLabels: [],
				xLabelAngleDeg: 0,
				xLabelFontSize: 12,
				yLabelFontSize: 12,
				xWeight: 1,
				yWeight: 1,
				...overrides,
			})
		}
	}
	return panels
}

const FACET_LABEL: FacetLabelInput = {
	fontSize: 14,
	height: 20,
	align: "center",
}

const baseline = (overrides: Partial<SolverInput> = {}): SolverInput => ({
	containerWidth: 800,
	containerHeight: 600,
	rows: 1,
	cols: 1,
	panels: makePanels(1, 1),
	facetLabel: FACET_LABEL,
	gapX: 30,
	gapY: 60,
	shareX: false,
	shareY: false,
	proportionalSizing: false,
	...overrides,
})

describe("solveFacetLayout — basic invariants", () => {
	it("emits one panel per input panel", () => {
		const spec = solveFacetLayout(baseline({ rows: 2, cols: 3, panels: makePanels(2, 3) }))
		expect(spec.panels.length).toBe(6)
	})

	it("preserves panel keys, rows, cols in output", () => {
		const spec = solveFacetLayout(baseline({ rows: 2, cols: 2, panels: makePanels(2, 2) }))
		for (const p of spec.panels) {
			expect(p.key).toBe(`${p.row}-${p.col}`)
		}
	})

	it("emits canvas dimensions ≥ container dimensions", () => {
		const spec = solveFacetLayout(baseline({ containerWidth: 800, containerHeight: 600 }))
		expect(spec.canvas.width).toBeGreaterThanOrEqual(800)
		expect(spec.canvas.height).toBeGreaterThanOrEqual(600)
	})

	it("returns scroll=null when container is large enough", () => {
		const spec = solveFacetLayout(baseline({ containerWidth: 1200, containerHeight: 900 }))
		expect(spec.scroll).toBeNull()
	})
})

describe("solveFacetLayout — alignment across grid", () => {
	it("all panels in a row have the same inner.y and inner.height (uniform sizing)", () => {
		const spec = solveFacetLayout(
			baseline({ rows: 2, cols: 3, panels: makePanels(2, 3) })
		)
		for (let r = 0; r < 2; r++) {
			const inRow = spec.panels.filter((p) => p.row === r)
			const ys = new Set(inRow.map((p) => p.inner.y))
			const hs = new Set(inRow.map((p) => p.inner.height))
			expect(ys.size).toBe(1)
			expect(hs.size).toBe(1)
		}
	})

	it("all panels in a column have the same inner.x and inner.width (uniform sizing)", () => {
		const spec = solveFacetLayout(
			baseline({ rows: 2, cols: 3, panels: makePanels(2, 3) })
		)
		for (let c = 0; c < 3; c++) {
			const inCol = spec.panels.filter((p) => p.col === c)
			const xs = new Set(inCol.map((p) => p.inner.x))
			const ws = new Set(inCol.map((p) => p.inner.width))
			expect(xs.size).toBe(1)
			expect(ws.size).toBe(1)
		}
	})

	it("inner.width is identical across every panel", () => {
		const spec = solveFacetLayout(
			baseline({ rows: 3, cols: 3, panels: makePanels(3, 3) })
		)
		const widths = new Set(spec.panels.map((p) => p.inner.width))
		expect(widths.size).toBe(1)
	})

	it("inner.height is identical across every panel", () => {
		const spec = solveFacetLayout(
			baseline({ rows: 3, cols: 3, panels: makePanels(3, 3) })
		)
		const heights = new Set(spec.panels.map((p) => p.inner.height))
		expect(heights.size).toBe(1)
	})

	it("inner.height is identical across every panel under shareX", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 3,
				cols: 2,
				panels: makePanels(3, 2),
				shareX: true,
			})
		)
		const heights = new Set(spec.panels.map((p) => p.inner.height))
		expect(heights.size).toBe(1)
	})

	it("inner.width is identical across every panel under shareY", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 3,
				panels: makePanels(2, 3),
				shareY: true,
			})
		)
		const widths = new Set(spec.panels.map((p) => p.inner.width))
		expect(widths.size).toBe(1)
	})
})

describe("solveFacetLayout — gap math", () => {
	it("positive gapX puts whitespace between cells horizontally", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 3,
				panels: makePanels(1, 3),
				gapX: 30,
				containerWidth: 1200,
			})
		)
		const cells = spec.panels.map((p) => p.cell).sort((a, b) => a.x - b.x)
		// gap between cell[0] and cell[1] = cell[1].x - (cell[0].x + cell[0].width) = 30
		const gap1 = cells[1]!.x - (cells[0]!.x + cells[0]!.width)
		const gap2 = cells[2]!.x - (cells[1]!.x + cells[1]!.width)
		expect(gap1).toBeCloseTo(30, 3)
		expect(gap2).toBeCloseTo(30, 3)
	})

	it("positive gapY puts whitespace between cells vertically", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 3,
				cols: 1,
				panels: makePanels(3, 1),
				gapY: 40,
				containerHeight: 1200,
			})
		)
		const cells = spec.panels.map((p) => p.cell).sort((a, b) => a.y - b.y)
		const gap1 = cells[1]!.y - (cells[0]!.y + cells[0]!.height)
		const gap2 = cells[2]!.y - (cells[1]!.y + cells[1]!.height)
		expect(gap1).toBeCloseTo(40, 3)
		expect(gap2).toBeCloseTo(40, 3)
	})

	it("negative gapY overlaps cells cumulatively (ridgeline)", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 5,
				cols: 1,
				panels: makePanels(5, 1),
				gapY: -50,
				containerHeight: 1500,
			})
		)
		const cells = spec.panels.map((p) => p.cell).sort((a, b) => a.y - b.y)
		// Each successive cell starts 50px earlier than where the previous ended.
		for (let i = 1; i < cells.length; i++) {
			const delta = cells[i]!.y - (cells[i - 1]!.y + cells[i - 1]!.height)
			expect(delta).toBeCloseTo(-50, 3)
		}
	})

	it("LAYOUT.md §10: panel size FREEZES at gap=0 value when gapY < 0", () => {
		// Once gap turns negative, further negative-gap changes should NOT
		// inflate panel heights (that produced odd visual proportions as
		// the user dragged the slider further negative). Compare inner
		// heights at gapY=0 vs gapY=-50.
		const zeroGap = solveFacetLayout(
			baseline({
				rows: 5,
				cols: 1,
				panels: makePanels(5, 1),
				gapY: 0,
				containerHeight: 1500,
			})
		)
		const negativeGap = solveFacetLayout(
			baseline({
				rows: 5,
				cols: 1,
				panels: makePanels(5, 1),
				gapY: -50,
				containerHeight: 1500,
			})
		)
		expect(negativeGap.panels[0]!.inner.height).toBeCloseTo(
			zeroGap.panels[0]!.inner.height,
			3,
		)
	})

	it("LAYOUT.md §10: panel size FREEZES at gap=0 value when gapX < 0", () => {
		const zeroGap = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 4,
				panels: makePanels(1, 4),
				gapX: 0,
				containerWidth: 1500,
			})
		)
		const negativeGap = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 4,
				panels: makePanels(1, 4),
				gapX: -30,
				containerWidth: 1500,
			})
		)
		expect(negativeGap.panels[0]!.inner.width).toBeCloseTo(
			zeroGap.panels[0]!.inner.width,
			3,
		)
	})

	it("LAYOUT.md §10: extreme negative gapY grows canvas at top so all panels stay visible", () => {
		// With gapY = -120 and cellHeights ~64, naive cumulative
		// positioning puts later rows at negative y (off-canvas). The
		// solver should detect this and extend canvasH (+ shift the
		// grid origin) so every panel stays on-canvas.
		const spec = solveFacetLayout(
			baseline({
				rows: 5,
				cols: 1,
				panels: makePanels(5, 1),
				gapY: -120,
				containerHeight: 400,
			}),
		)
		for (const p of spec.panels) {
			expect(p.cell.y).toBeGreaterThanOrEqual(0)
			expect(p.cell.y).toBeLessThanOrEqual(spec.canvas.height)
		}
		// Canvas grew to accommodate (scroll triggers if it exceeds
		// container).
		expect(spec.canvas.height).toBeGreaterThan(400)
	})

	it("LAYOUT.md §10: moderate negative gapY does NOT grow canvas via ridgeline overflow", () => {
		// `minPanelPx: 0` forces fit mode so we isolate the ridgeline-
		// overflow growth path from the scroll-mode growth path. With
		// gapY = -20 and cellHeights >> 20, no row goes negative → no
		// canvas growth from the ridgeline branch.
		const spec = solveFacetLayout(
			baseline({
				rows: 5,
				cols: 1,
				panels: makePanels(5, 1),
				gapY: -20,
				containerHeight: 800,
				minPanelPx: 0,
			}),
		)
		// In fit mode with moderate negative gap, canvas matches the
		// container exactly — no ridgeline overflow growth.
		expect(spec.canvas.height).toBeCloseTo(800, 3)
	})

	it("negative gapX overlaps cells cumulatively", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 4,
				panels: makePanels(1, 4),
				gapX: -30,
				containerWidth: 1500,
			})
		)
		const cells = spec.panels.map((p) => p.cell).sort((a, b) => a.x - b.x)
		for (let i = 1; i < cells.length; i++) {
			const delta = cells[i]!.x - (cells[i - 1]!.x + cells[i - 1]!.width)
			expect(delta).toBeCloseTo(-30, 3)
		}
	})
})

describe("solveFacetLayout — shared axes", () => {
	it("only the bottom row reports showXTicks=true when shareX", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 3,
				cols: 2,
				panels: makePanels(3, 2),
				shareX: true,
			})
		)
		for (const p of spec.panels) {
			expect(p.showXTicks).toBe(p.row === 2)
		}
	})

	it("only the leftmost column reports showYTicks=true when shareY", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 3,
				panels: makePanels(2, 3),
				shareY: true,
			})
		)
		for (const p of spec.panels) {
			expect(p.showYTicks).toBe(p.col === 0)
		}
	})

	it("every panel reports showXTicks=true when shareX is false", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 3,
				cols: 2,
				panels: makePanels(3, 2),
				shareX: false,
			})
		)
		for (const p of spec.panels) {
			expect(p.showXTicks).toBe(true)
		}
	})

	it("under shareX, interior rows have smaller cell heights than bottom row", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 3,
				cols: 1,
				panels: makePanels(3, 1),
				shareX: true,
				containerHeight: 1200,
			})
		)
		const bottomRow = spec.panels.find((p) => p.row === 2)!
		const interior = spec.panels.find((p) => p.row === 0)!
		expect(interior.cell.height).toBeLessThan(bottomRow.cell.height)
		// The diff = the saved x-axis chrome.
		const diff = bottomRow.cell.height - interior.cell.height
		expect(diff).toBeGreaterThan(BASE_MARGIN.bottom / 2)
	})

	it("under shareY, interior cols have smaller cell widths than leftmost col", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 3,
				panels: makePanels(1, 3),
				shareY: true,
				containerWidth: 1200,
			})
		)
		const leftmost = spec.panels.find((p) => p.col === 0)!
		const interior = spec.panels.find((p) => p.col === 1)!
		expect(interior.cell.width).toBeLessThan(leftmost.cell.width)
		const diff = leftmost.cell.width - interior.cell.width
		expect(diff).toBeGreaterThan(BASE_MARGIN.left / 2)
	})

	it("under shareX, interior rows still have full inner.height (only chrome shrinks)", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 3,
				cols: 1,
				panels: makePanels(3, 1),
				shareX: true,
				containerHeight: 1200,
			})
		)
		const heights = new Set(spec.panels.map((p) => p.inner.height))
		expect(heights.size).toBe(1)
	})
})

describe("solveFacetLayout — shared titles", () => {
	const tt = { text: "Title", fontSize: 18, align: "center" as const }
	const xt = { text: "x", fontSize: 14, align: "center" as const }
	const yt = {
		text: "y",
		fontSize: 14,
		align: "center" as const,
		horizontal: false,
	}

	it("returns title=null when chartTitle not provided", () => {
		const spec = solveFacetLayout(baseline())
		expect(spec.title).toBeNull()
	})

	it("title.textAnchor reflects alignment", () => {
		const spec = solveFacetLayout(
			baseline({ chartTitle: { ...tt, align: "left" } })
		)
		expect(spec.title?.textAnchor).toBe("start")
		const spec2 = solveFacetLayout(
			baseline({ chartTitle: { ...tt, align: "right" } })
		)
		expect(spec2.title?.textAnchor).toBe("end")
	})

	it("title.x aligns to plot-grid span (left edge of leftmost panel inner)", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 3,
				panels: makePanels(1, 3),
				chartTitle: { ...tt, align: "left" },
			})
		)
		const leftmost = spec.panels.find((p) => p.col === 0)!
		expect(spec.title?.x).toBe(leftmost.inner.x)
	})

	it("title.x aligns to right edge of rightmost panel inner when align=right", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 3,
				panels: makePanels(1, 3),
				chartTitle: { ...tt, align: "right" },
			})
		)
		const rightmost = spec.panels.find((p) => p.col === 2)!
		expect(spec.title?.x).toBe(rightmost.inner.x + rightmost.inner.width)
	})

	it("x-title sits BELOW the bottom row's plot inner", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 1,
				panels: makePanels(2, 1),
				xTitle: xt,
			})
		)
		const bottomRow = spec.panels.find((p) => p.row === 1)!
		expect(spec.xTitle?.y).toBeGreaterThan(bottomRow.inner.y + bottomRow.inner.height)
	})

	it("y-title (rotated) has rotation=-90", () => {
		const spec = solveFacetLayout(baseline({ yTitle: yt }))
		expect(spec.yTitle?.rotation).toBe(-90)
	})

	it("y-title (horizontal) has rotation=0", () => {
		const spec = solveFacetLayout(
			baseline({ yTitle: { ...yt, horizontal: true } })
		)
		expect(spec.yTitle?.rotation).toBe(0)
	})

	it("horizontal y-title reserves more left space than rotated", () => {
		const longYT = { ...yt, text: "Sales (USD millions)", horizontal: true }
		const specHorizontal = solveFacetLayout(baseline({ yTitle: longYT }))
		const specRotated = solveFacetLayout(
			baseline({ yTitle: { ...longYT, horizontal: false } })
		)
		const leftmostHoriz = specHorizontal.panels[0]!
		const leftmostRot = specRotated.panels[0]!
		// Horizontal y-title pushes plots rightward by the text width.
		expect(leftmostHoriz.inner.x).toBeGreaterThan(leftmostRot.inner.x)
	})
})

describe("solveFacetLayout — title position offsets", () => {
	// Per APPLICATION.md §6.4, title offsets are ASYMMETRIC:
	//   - TOWARD the plot: pure shift, no plot adjustment (title can
	//     overlap axes / plot as the user requests).
	//   - AWAY from the plot: outer reserve grows by |offset|, so the
	//     plot shrinks to give the title room. The title's on-canvas
	//     position stays put; what the user "sees" is the plot moving
	//     away (equivalent to a widened gap between title and plot).
	//
	// Toward direction by edge:
	//   - chart title (top edge): offsetY > 0 (down, into plot region)
	//   - subtitle: same as chart title
	//   - x-title (bottom edge): offsetY < 0 (up, into plot region)
	//   - y-title (left edge): offsetX > 0 (right, into plot region)
	const tt = { text: "Title", fontSize: 18, align: "center" as const }
	const st = { text: "Sub", fontSize: 14, align: "center" as const }
	const xt = { text: "x", fontSize: 14, align: "center" as const }
	const yt = {
		text: "y",
		fontSize: 14,
		align: "center" as const,
		horizontal: false,
	}

	it("LAYOUT.md §8 Phase 1: small POSITIVE y-title offsetX extends plot LEFT; title stays at natural x", () => {
		// Symmetric to x-title Phase 1: y-title moving toward plot
		// (positive offsetX) → plot's left edge moves LEFT to close
		// the gap. Title stays at natural screen x.
		const without = solveFacetLayout(baseline({ yTitle: yt }))
		const withOffset = solveFacetLayout(
			baseline({ yTitle: { ...yt, offsetX: 12 } }),
		)
		// Plot's left edge shifts LEFT by 12 → inner.x decreases by 12.
		expect(withOffset.panels[0]!.inner.x).toBe(
			without.panels[0]!.inner.x - 12,
		)
		// Inner width grows by 12 (plot extends into the natural left chrome).
		expect(withOffset.panels[0]!.inner.width).toBe(
			without.panels[0]!.inner.width + 12,
		)
		// Title's screen x unchanged (plot moved toward title; title stayed).
		expect(withOffset.yTitle!.x).toBeCloseTo(without.yTitle!.x, 1)
	})

	it("y-title offsetX away from plot preserves canvas size", () => {
		const without = solveFacetLayout(baseline({ yTitle: yt }))
		const withOffset = solveFacetLayout(
			baseline({ yTitle: { ...yt, offsetX: -20 } })
		)
		// Container is big enough to absorb the grow: canvas dims stay.
		expect(withOffset.canvas.width).toBe(without.canvas.width)
		expect(withOffset.canvas.height).toBe(without.canvas.height)
	})

	it("y-title offsetX away from plot shrinks plot.width and shifts plot.x", () => {
		const without = solveFacetLayout(baseline({ yTitle: yt }))
		const withOffset = solveFacetLayout(
			baseline({ yTitle: { ...yt, offsetX: -20 } })
		)
		// outerReserves.left grew by 20 — plot starts 20px further right
		// (left chrome got bigger) and is 20px narrower.
		expect(withOffset.panels[0]!.inner.x).toBe(
			without.panels[0]!.inner.x + 20
		)
		expect(withOffset.panels[0]!.inner.width).toBe(
			without.panels[0]!.inner.width - 20
		)
		// yTitle's on-canvas x is unchanged — plot moved away from it,
		// not the other way around.
		expect(withOffset.yTitle!.x).toBe(without.yTitle!.x)
	})

	it("LAYOUT.md §8 Phase 1: small NEGATIVE x-title offsetY extends plot DOWN; title stays at natural y", () => {
		// User moves the x-title toward the plot by a small amount.
		// The plot's bottom edge extends DOWN by |offsetY| (eating
		// into the natural BASE_MARGIN.bottom + bottomFloor chrome
		// area). Title stays at its natural screen position.
		const without = solveFacetLayout(baseline({ xTitle: xt }))
		const withNeg = solveFacetLayout(
			baseline({ xTitle: { ...xt, offsetY: -15 } }),
		)
		// Plot.top unchanged; plot height grows by 15.
		expect(withNeg.panels[0]!.inner.y).toBe(without.panels[0]!.inner.y)
		expect(withNeg.panels[0]!.inner.height).toBe(
			without.panels[0]!.inner.height + 15,
		)
		// Title's screen y unchanged.
		expect(withNeg.xTitle!.y).toBeCloseTo(without.xTitle!.y, 1)
	})

	it("LAYOUT.md §8 Phase 3: extreme NEGATIVE x-title offsetY clamps title at top AND shrinks plot from top", () => {
		// Phase 3 triggers when bottomGrow has clamped (Phase 2 maxed)
		// AND the title's desired y would clip the viewport top. The
		// solver should detect this and add to topGrow so the plot
		// ALSO shrinks from the top — keeping title + plot visually
		// separated rather than just overlapping.
		const without = solveFacetLayout(
			baseline({ xTitle: xt, containerHeight: 600 }),
		)
		const withExtremeNeg = solveFacetLayout(
			baseline({
				xTitle: { ...xt, offsetY: -800 },
				containerHeight: 600,
			}),
		)
		// Plot's top edge shifted DOWN (plot shrunk from top).
		expect(withExtremeNeg.panels[0]!.inner.y).toBeGreaterThan(
			without.panels[0]!.inner.y,
		)
		// Title clamped at the viewport top buffer.
		expect(withExtremeNeg.xTitle!.y).toBeLessThanOrEqual(50)
	})

	it("LAYOUT.md §8 Phase 2: large NEGATIVE x-title offsetY caps plot at viewport edge; title moves up over plot", () => {
		// With offsetY < -extensionRoom, plot's growth is clamped at
		// viewport-bottom-minus-buffer. The excess offset moves the
		// title UP into / above the plot area.
		const without = solveFacetLayout(
			baseline({ xTitle: xt, containerHeight: 600 }),
		)
		const withLargeNeg = solveFacetLayout(
			baseline({
				xTitle: { ...xt, offsetY: -300 },
				containerHeight: 600,
			}),
		)
		// Plot grew but is capped at the extension limit. With this
		// title's bottomFloor ~21 px, extensionRoom = BASE.bottom (64)
		// + bottomFloor (21) - VIEWPORT_BUFFER_PX (10) ≈ 75 px past natural.
		const growth =
			withLargeNeg.panels[0]!.inner.height - without.panels[0]!.inner.height
		expect(growth).toBeLessThanOrEqual(100) // capped, not unbounded (offsetY=-300)
		expect(growth).toBeGreaterThanOrEqual(40)
		// Title moved UP from natural position (Phase 2 / 3 effect).
		expect(withLargeNeg.xTitle!.y).toBeLessThan(without.xTitle!.y)
	})

	it("x-title offsetY away from plot SHRINKS the plot; xTitle stays at natural screen y (LAYOUT.md §8)", () => {
		// Per LAYOUT.md §8: positive offsetY (title moves "away" from
		// plot) keeps the title at its natural screen position; the
		// plot's bottom edge moves UP to give the offset its visual
		// effect. The canvas stays at container size — no growth.
		const without = solveFacetLayout(baseline({ xTitle: xt }))
		const withOffset = solveFacetLayout(
			baseline({ xTitle: { ...xt, offsetY: 15 } })
		)
		// Plot's top unchanged; height SHRINKS by 15.
		expect(withOffset.panels[0]!.inner.y).toBe(without.panels[0]!.inner.y)
		expect(withOffset.panels[0]!.inner.height).toBe(
			without.panels[0]!.inner.height - 15
		)
		// xTitle's screen-y stays the same (because plot shrunk by 15 AND
		// the formula adds +15 — the two cancel).
		expect(withOffset.xTitle!.y).toBe(without.xTitle!.y)
		// Canvas does NOT grow.
		expect(withOffset.canvas.height).toBe(without.canvas.height)
	})

	it("chart title offsetY toward plot shifts the title without altering plot.y", () => {
		const without = solveFacetLayout(baseline({ chartTitle: tt }))
		const withOffset = solveFacetLayout(
			baseline({ chartTitle: { ...tt, offsetY: 10 } })
		)
		expect(withOffset.panels[0]!.inner.y).toBe(without.panels[0]!.inner.y)
		expect(withOffset.title!.y).toBe(without.title!.y + 10)
	})

	it("chart title offsetY away from plot shrinks plot.height, title stays in place", () => {
		const without = solveFacetLayout(baseline({ chartTitle: tt }))
		const withOffset = solveFacetLayout(
			baseline({ chartTitle: { ...tt, offsetY: -10 } })
		)
		// outerReserves.top grew by 10 → plot.inner.y shifts DOWN by 10,
		// plot.inner.height shrinks by 10. Title's on-canvas y is
		// unchanged (the title cancels its own away-offset; the plot is
		// what visibly moves).
		expect(withOffset.panels[0]!.inner.y).toBe(
			without.panels[0]!.inner.y + 10
		)
		expect(withOffset.panels[0]!.inner.height).toBe(
			without.panels[0]!.inner.height - 10
		)
		expect(withOffset.title!.y).toBe(without.title!.y)
	})

	it("subtitle offsetY toward plot shifts the subtitle without altering plot.y", () => {
		const without = solveFacetLayout(
			baseline({ chartTitle: tt, chartSubtitle: st })
		)
		const withOffset = solveFacetLayout(
			baseline({
				chartTitle: tt,
				chartSubtitle: { ...st, offsetY: 7 },
			})
		)
		expect(withOffset.panels[0]!.inner.y).toBe(without.panels[0]!.inner.y)
		expect(withOffset.subtitle!.y).toBe(without.subtitle!.y + 7)
	})

	it("subtitle offsetY away from plot grows top reserve independently of title", () => {
		// Regression guard: only one of title/subtitle moves away; the
		// other's on-canvas position must NOT shift. The grow is the MAX
		// of titleAwayGrow and subtitleAwayGrow, but each title cancels
		// its OWN negative offset so the non-moving one stays put.
		const without = solveFacetLayout(
			baseline({ chartTitle: tt, chartSubtitle: st })
		)
		const withSubAway = solveFacetLayout(
			baseline({
				chartTitle: tt,
				chartSubtitle: { ...st, offsetY: -8 },
			})
		)
		// Subtitle's screen y is unchanged (cancels own -8).
		expect(withSubAway.subtitle!.y).toBe(without.subtitle!.y)
		// Title's screen y is unchanged (its own offset is 0; no grow
		// applied to its position).
		expect(withSubAway.title!.y).toBe(without.title!.y)
		// Plot shifts down 8 to give the subtitle room.
		expect(withSubAway.panels[0]!.inner.y).toBe(
			without.panels[0]!.inner.y + 8
		)
	})

	it("offsetX on a title shifts text by exactly the offset (no double-counting)", () => {
		// Regression guard: an early implementation applied the offset to
		// both the title's x AND the plot-edge anchor it was computed from,
		// double-counting the shift. Title x-shift must equal the offset.
		const without = solveFacetLayout(baseline({ chartTitle: tt }))
		const withOffset = solveFacetLayout(
			baseline({ chartTitle: { ...tt, offsetX: 8 } })
		)
		expect(withOffset.title!.x - without.title!.x).toBe(8)
	})
})

describe("solveFacetLayout — facet labels", () => {
	it("facet label x aligns to inner span", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 2,
				panels: makePanels(1, 2),
				facetLabel: { ...FACET_LABEL, align: "left" },
			})
		)
		for (const p of spec.panels) {
			expect(p.facetLabel?.x).toBe(p.inner.x)
			expect(p.facetLabel?.textAnchor).toBe("start")
		}
	})

	it("facet label sits ABOVE the panel's inner plot", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 1,
				panels: makePanels(2, 1),
				facetLabel: FACET_LABEL,
			})
		)
		for (const p of spec.panels) {
			expect(p.facetLabel!.y).toBeLessThan(p.inner.y)
		}
	})

	it("facet label is null when facetLabel input is omitted (single-panel case)", () => {
		const spec = solveFacetLayout(baseline({ facetLabel: undefined }))
		expect(spec.panels[0]?.facetLabel).toBeNull()
	})

	it("polar wrap: facet label drops down to hug the centered mark instead of the cell top", () => {
		const polar = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 4,
				panels: makePanels(1, 4),
				facetLabel: { ...FACET_LABEL, height: 16 },
				isPolar: true,
			})
		)
		const cartesian = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 4,
				panels: makePanels(1, 4),
				facetLabel: { ...FACET_LABEL, height: 16 },
			})
		)
		const p = polar.panels[0]!
		const markTop =
			p.inner.y + p.inner.height / 2 - Math.min(p.inner.width, p.inner.height) * 0.5
		// Hugs the mark's top edge, well below the cell-top band where the
		// cartesian label sits.
		expect(p.facetLabel!.y).toBeCloseTo(markTop - 8, 0)
		expect(p.facetLabel!.y).toBeGreaterThan(cartesian.panels[0]!.facetLabel!.y)
	})

	it("polar wrap: never pushes the facet label above its natural band position", () => {
		// Wide-but-short panels: the mark fills the height, so the natural
		// top-band position wins (no upward push).
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 1600,
				containerHeight: 200,
				rows: 1,
				cols: 2,
				panels: makePanels(1, 2),
				facetLabel: { ...FACET_LABEL, height: 16 },
				isPolar: true,
			})
		)
		const p = spec.panels[0]!
		const naturalY = p.cell.y + 16 * 0.75
		expect(p.facetLabel!.y).toBeGreaterThanOrEqual(naturalY - 0.001)
	})
})

describe("solveFacetLayout — fit-to-viewport mode", () => {
	it("minPanelPx=0 forces canvas to match container (no scroll, no overflow)", () => {
		// User-driven setting: when scrollMode='fit', the caller passes
		// minPanelPx=0 and the chart should fit the container regardless
		// of how many panels there are.
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 600,
				rows: 10,
				cols: 1,
				panels: makePanels(10, 1),
				minPanelPx: 0,
			})
		)
		expect(spec.scroll).toBeNull()
		expect(spec.canvas.width).toBe(800)
		expect(spec.canvas.height).toBe(600)
	})

	it("minPanelPx=0 suppresses the label-overlap canvas floors (labels bunch; NO scroll)", () => {
		// Scroll is opt-in ("Allow scrolling" in Aesthetics → minPanelPx>0).
		// In fit mode, even panels with many WIDE categorical labels must
		// compress into the container — labels crowd/overlap rather than
		// silently growing the canvas past the container and scrolling.
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 600,
				rows: 2,
				cols: 2,
				proportionalSizing: true,
				panels: makePanels(2, 2, {
					xLabels: Array.from({ length: 12 }, (_, i) => `category-${i}`),
					yLabels: Array.from({ length: 12 }, (_, i) => `level-${i}`),
					xLabelMaxWidthPx: 120,
					xWeight: 12,
					yWeight: 12,
				}),
				minPanelPx: 0,
			})
		)
		expect(spec.scroll).toBeNull()
		expect(spec.canvas.width).toBe(800)
		expect(spec.canvas.height).toBe(600)
	})

	it("minPanelPx>0 keeps the label-overlap floors (scroll mode honors them)", () => {
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 600,
				rows: 2,
				cols: 2,
				proportionalSizing: true,
				panels: makePanels(2, 2, {
					xLabels: Array.from({ length: 12 }, (_, i) => `category-${i}`),
					xLabelMaxWidthPx: 120,
					xWeight: 12,
				}),
				minPanelPx: 200,
			})
		)
		// 12 wide labels per column × 2 cols cannot fit 800px — scroll mode
		// grows the canvas so the labels never overlap.
		expect(spec.canvas.width).toBeGreaterThan(800)
	})

	it("minPanelPx=0 still produces non-negative inner rects when cells are tiny", () => {
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 400,
				containerHeight: 300,
				rows: 8,
				cols: 1,
				panels: makePanels(8, 1),
				minPanelPx: 0,
			})
		)
		for (const p of spec.panels) {
			expect(p.inner.width).toBeGreaterThanOrEqual(0)
			expect(p.inner.height).toBeGreaterThanOrEqual(0)
		}
	})
})

describe("solveFacetLayout — proportional sizing and scroll", () => {
	it("emits scroll dims when natural canvas exceeds container", () => {
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 400,
				containerHeight: 300,
				rows: 1,
				cols: 5,
				panels: makePanels(1, 5),
				minPanelPx: 200,
			})
		)
		// 5 panels × 200px minimum = 1000px just for cells, plus chrome —
		// well beyond 400px container.
		expect(spec.scroll).not.toBeNull()
		expect(spec.canvas.width).toBeGreaterThan(spec.scroll!.width)
	})

	it("scroll dims equal the container dims (not the canvas)", () => {
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 400,
				containerHeight: 300,
				rows: 1,
				cols: 5,
				panels: makePanels(1, 5),
				minPanelPx: 200,
			})
		)
		expect(spec.scroll!.width).toBe(400)
		expect(spec.scroll!.height).toBe(300)
	})

	it("proportional sizing distributes ROW HEIGHTS by yWeight (1-col case)", () => {
		// 4 panels stacked in 1 column with yWeights [1, 2, 3, 6] (e.g.
		// dumbbelldat2 faceted by Facet with Group on Y). Heights should
		// be proportional: weight-6 panel ≈ 6× weight-1, weight-3 ≈ 3×.
		// The whole point of "size by category count" is that per-category
		// spacing stays constant across panels.
		const panels: SolverPanelInput[] = [1, 2, 3, 6].map((w, r) => ({
			key: `row-${r}`,
			row: r,
			col: 0,
			xLabels: [],
			yLabels: Array.from({ length: w }, (_, i) => `cat-${i}`),
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: 1,
			yWeight: w,
		}))
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 1200,
				rows: 4,
				cols: 1,
				panels,
				proportionalSizing: true,
			})
		)
		const innerHs = spec.panels.map((p) => p.inner.height)
		// Per-category spacing should be roughly constant. Compute
		// height-per-yWeight for each panel and assert they're all close.
		const perCat = innerHs.map((h, i) => h / [1, 2, 3, 6][i]!)
		for (let i = 1; i < perCat.length; i++) {
			expect(perCat[i]!).toBeCloseTo(perCat[0]!, 1)
		}
		// And weight-6 panel really is much taller than weight-1.
		expect(innerHs[3]! / innerHs[0]!).toBeGreaterThan(4)
	})

	it("proportional sizing distributes COL WIDTHS by xWeight (1-row case)", () => {
		// 3 panels in a row with xWeights [1, 2, 6]. Widths proportional.
		const panels: SolverPanelInput[] = [1, 2, 6].map((w, c) => ({
			key: `col-${c}`,
			row: 0,
			col: c,
			xLabels: Array.from({ length: w }, (_, i) => `cat-${i}`),
			yLabels: [],
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: w,
			yWeight: 1,
		}))
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 1200,
				containerHeight: 600,
				rows: 1,
				cols: 3,
				panels,
				proportionalSizing: true,
			})
		)
		const innerWs = spec.panels.map((p) => p.inner.width)
		const perCat = innerWs.map((w, i) => w / [1, 2, 6][i]!)
		for (let i = 1; i < perCat.length; i++) {
			expect(perCat[i]!).toBeCloseTo(perCat[0]!, 1)
		}
		expect(innerWs[2]! / innerWs[0]!).toBeGreaterThan(4)
	})

	it("solver distributes by xWeight regardless of share-axis flags (caller pre-uniforms via full-dataset weights)", () => {
		// Post-LAYOUT-§6 design: the solver no longer special-cases
		// shareX / shareY. The caller (PlotCanvas) is responsible for
		// feeding uniform weights along the shared axis (via full-dataset
		// rows) so panels in the shared direction get identical weights
		// → distribution naturally uniform. Here we pass varying xWeights
		// (as if PlotCanvas had NOT done the uniformization) and confirm
		// the solver does the proportional split — i.e. the solver is
		// dumb about share-axes.
		const panels: SolverPanelInput[] = [1, 2, 6].map((w, c) => ({
			key: `col-${c}`,
			row: 0,
			col: c,
			xLabels: Array.from({ length: w }, (_, i) => `cat-${i}`),
			yLabels: [],
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: w,
			yWeight: 1,
		}))
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 1200,
				containerHeight: 600,
				rows: 1,
				cols: 3,
				panels,
				proportionalSizing: true,
				shareY: true, // ← no effect on weights now
			})
		)
		const innerWs = spec.panels.map((p) => p.inner.width)
		expect(innerWs[2]! / innerWs[0]!).toBeGreaterThan(4)
	})

	it("when caller pre-uniforms xWeights (simulating PlotCanvas under shareY), cols come out uniform", () => {
		// This is the post-LAYOUT-§6 mechanism: under shareY, PlotCanvas
		// computes xWeight from full-dataset rows → all panels see the
		// same xWeight → solver distribution is naturally uniform.
		const panels: SolverPanelInput[] = [0, 1, 2].map((_, c) => ({
			key: `col-${c}`,
			row: 0,
			col: c,
			xLabels: ["a", "b", "c"],
			yLabels: [],
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: 3, // ← uniform across panels (PlotCanvas behavior under shareY)
			yWeight: 1,
		}))
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 1200,
				containerHeight: 600,
				rows: 1,
				cols: 3,
				panels,
				proportionalSizing: true,
				shareY: true,
			})
		)
		const widths = new Set(spec.panels.map((p) => p.inner.width))
		expect(widths.size).toBe(1)
	})

	it("proportional row heights work under shareX (1-col case)", () => {
		// Regression guard for the original "1-col tall stack with
		// proportional row heights" feature. Default shareX=true; rows
		// should still distribute by yWeight (because PlotCanvas
		// uniforms WEIGHTS only on the shared axis, and shareX is the
		// X axis — leaves yWeight alone per panel).
		const panels: SolverPanelInput[] = [1, 2, 3, 6].map((w, r) => ({
			key: `row-${r}`,
			row: r,
			col: 0,
			xLabels: [],
			yLabels: Array.from({ length: w }, (_, i) => `cat-${i}`),
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: 1,
			yWeight: w,
		}))
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 1200,
				rows: 4,
				cols: 1,
				panels,
				proportionalSizing: true,
				shareX: true,
			})
		)
		const heights = spec.panels.map((p) => p.inner.height)
		expect(heights[3]! / heights[0]!).toBeGreaterThan(4)
	})

	it("shareX leaves col widths free to vary by xWeight (axis-aware override is one-sided)", () => {
		// shareX shares the x-axis across rows — it should NOT affect
		// col widths. With xWeights [1, 6] in a 1-row layout, cols
		// should still distribute 1:6 even when shareX=true.
		const panels: SolverPanelInput[] = [1, 6].map((w, c) => ({
			key: `col-${c}`,
			row: 0,
			col: c,
			xLabels: Array.from({ length: w }, (_, i) => `cat-${i}`),
			yLabels: [],
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: w,
			yWeight: 1,
		}))
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 1200,
				containerHeight: 600,
				rows: 1,
				cols: 2,
				panels,
				proportionalSizing: true,
				shareX: true,
				shareY: false,
			})
		)
		const innerWs = spec.panels.map((p) => p.inner.width)
		// col 1 should be much wider than col 0 (weight 6 vs 1).
		expect(innerWs[1]! / innerWs[0]!).toBeGreaterThan(4)
	})

	it("proportionalSizing=false yields equal-sized panels regardless of weights", () => {
		// Same uneven yWeights as the prop-on test above, but the flag is
		// off — the solver must give every panel the same inner height
		// (regression guard so uniform mode keeps current behavior).
		const panels: SolverPanelInput[] = [1, 2, 3, 6].map((w, r) => ({
			key: `row-${r}`,
			row: r,
			col: 0,
			xLabels: [],
			yLabels: [],
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: 1,
			yWeight: w,
		}))
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 1200,
				rows: 4,
				cols: 1,
				panels,
				proportionalSizing: false,
			})
		)
		const heights = new Set(spec.panels.map((p) => p.inner.height))
		expect(heights.size).toBe(1)
	})

	it("proportional sizing grows the natural canvas for high-weight panels", () => {
		const heavy = solveFacetLayout(
			baseline({
				containerWidth: 100,
				containerHeight: 100,
				rows: 1,
				cols: 2,
				panels: makePanels(1, 2, { xWeight: 50, yWeight: 50 }),
				proportionalSizing: true,
				minPxPerCategory: 20,
			})
		)
		const light = solveFacetLayout(
			baseline({
				containerWidth: 100,
				containerHeight: 100,
				rows: 1,
				cols: 2,
				panels: makePanels(1, 2, { xWeight: 1, yWeight: 1 }),
				proportionalSizing: true,
				minPxPerCategory: 20,
			})
		)
		expect(heavy.canvas.width).toBeGreaterThan(light.canvas.width)
	})
})

describe("solveFacetLayout — unmeasured render (0×0)", () => {
	it("returns sane positive canvas dims when container is 0×0", () => {
		const spec = solveFacetLayout(
			baseline({ containerWidth: 0, containerHeight: 0 })
		)
		expect(spec.canvas.width).toBeGreaterThan(0)
		expect(spec.canvas.height).toBeGreaterThan(0)
	})

	it("inner rects are non-negative when container is 0×0", () => {
		const spec = solveFacetLayout(
			baseline({ containerWidth: 0, containerHeight: 0 })
		)
		for (const p of spec.panels) {
			expect(p.inner.width).toBeGreaterThanOrEqual(0)
			expect(p.inner.height).toBeGreaterThanOrEqual(0)
		}
	})
})

describe("solveFacetLayout — title positioning vs tick labels", () => {
	it("y-title is positioned LEFT of the tick label area (no horizontal overlap)", () => {
		// User-reported: in a 6×1 bars-y chart with long categorical labels
		// ("Skateboarding", "Salsa Dancing"), the rotated y-title visually
		// landed on top of the tick labels. The solver must position the
		// y-title BEFORE the leftmost edge of the tick labels.
		const longLabels = ["Yoga", "Skateboarding", "Karaoke", "Knitting", "Salsa Dancing"]
		const panels: SolverPanelInput[] = Array.from({ length: 6 }, (_, i) => ({
			key: `p${i}`,
			row: i,
			col: 0,
			xLabels: [],
			yLabels: longLabels,
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: 5,
			yWeight: 5,
		}))
		const spec = solveFacetLayout({
			containerWidth: 700,
			containerHeight: 1200,
			rows: 6,
			cols: 1,
			panels,
			facetLabel: FACET_LABEL,
			yTitle: { text: "activity", fontSize: 14, align: "center", horizontal: false },
			xTitle: { text: "silliness_score", fontSize: 14, align: "center" },
			gapX: 30,
			gapY: 60,
			shareX: true,
			shareY: true,
			proportionalSizing: true,
		})
		const yTitle = spec.yTitle!
		// y-title is rotated -90°. Its rendered horizontal extent is roughly
		// [yTitle.x - fontSize/2, yTitle.x + fontSize/2].
		const titleRightEdge = yTitle.x + 14 / 2
		// Leftmost panel's plot x0 = leftmost edge of plot rect. Tick labels
		// render to the LEFT of this (right-anchored), with width = longest
		// label estimate (13 chars × 12px × 0.55 + 4 ≈ 90px).
		const leftmost = spec.panels[0]!
		const longestPx = 13 * 12 * 0.55 + 4
		const tickLabelsLeftEdge = leftmost.inner.x - longestPx - 6
		expect(titleRightEdge).toBeLessThanOrEqual(tickLabelsLeftEdge)
	})

	it("x-title sits BELOW every panel's plot rect AND below the last facet label", () => {
		const panels: SolverPanelInput[] = Array.from({ length: 6 }, (_, i) => ({
			key: `p${i}`,
			row: i,
			col: 0,
			xLabels: [],
			yLabels: ["Yoga", "Salsa Dancing"],
			xLabelAngleDeg: 0,
			xLabelFontSize: 12,
			yLabelFontSize: 12,
			xWeight: 2,
			yWeight: 2,
		}))
		const spec = solveFacetLayout({
			containerWidth: 700,
			containerHeight: 1200,
			rows: 6,
			cols: 1,
			panels,
			facetLabel: FACET_LABEL,
			xTitle: { text: "silliness_score", fontSize: 14, align: "center" },
			yTitle: { text: "activity", fontSize: 14, align: "center", horizontal: false },
			gapX: 30,
			gapY: 60,
			shareX: true,
			shareY: true,
			proportionalSizing: true,
		})
		for (const p of spec.panels) {
			expect(spec.xTitle!.y).toBeGreaterThan(p.inner.y + p.inner.height)
		}
		const lastPanel = spec.panels[spec.panels.length - 1]!
		expect(spec.xTitle!.y).toBeGreaterThan(lastPanel.facetLabel!.y)
	})
})

describe("solveFacetLayout — margin estimation flows through", () => {
	it("long y-axis tick labels grow the leftmost cell's chrome", () => {
		const shortLabels = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, { yLabels: ["1", "2", "3"] }),
			})
		)
		const longLabels = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					yLabels: ["Cardiothoracic Surgery", "Family Medicine"],
				}),
			})
		)
		expect(longLabels.panels[0]!.inner.x).toBeGreaterThan(
			shortLabels.panels[0]!.inner.x
		)
	})

	it("rotated x-axis labels grow the bottom row's chrome", () => {
		const flat = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					xLabels: ["a-long-category-name"],
					xLabelAngleDeg: 0,
				}),
			})
		)
		const tilted = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					xLabels: ["a-long-category-name"],
					xLabelAngleDeg: 45,
				}),
			})
		)
		const flatHeight = flat.panels[0]!.inner.height
		const tiltedHeight = tilted.panels[0]!.inner.height
		expect(tiltedHeight).toBeLessThan(flatHeight)
	})

	it("each column sizes its own left chrome to its panel's labels (no global inflation)", () => {
		// Three panels in a row, one has long labels. Under shareY=OFF
		// (baseline default), each column has its OWN y-axis — so the
		// column with short labels reserves only the chrome its labels
		// need. A long label in col-2 should NOT inflate cols 0/1's chrome
		// (the previous "global floor" behavior wasted space).
		const panels: SolverPanelInput[] = [
			{
				key: "0-0",
				row: 0,
				col: 0,
				xLabels: [],
				yLabels: ["short"],
				xLabelAngleDeg: 0,
				xLabelFontSize: 12,
				yLabelFontSize: 12,
				xWeight: 1,
				yWeight: 1,
			},
			{
				key: "0-1",
				row: 0,
				col: 1,
				xLabels: [],
				yLabels: ["short"],
				xLabelAngleDeg: 0,
				xLabelFontSize: 12,
				yLabelFontSize: 12,
				xWeight: 1,
				yWeight: 1,
			},
			{
				key: "0-2",
				row: 0,
				col: 2,
				xLabels: [],
				yLabels: ["A REALLY LONG CATEGORY NAME THAT TAKES MUCH WIDTH"],
				xLabelAngleDeg: 0,
				xLabelFontSize: 12,
				yLabelFontSize: 12,
				xWeight: 1,
				yWeight: 1,
			},
		]
		const spec = solveFacetLayout(baseline({ rows: 1, cols: 3, panels }))
		const leftMargins = spec.panels.map((p) => p.inner.x - p.cell.x)
		// Leftmost col reserves BASE_MARGIN.left (holds the shared y-title
		// if any) plus its own label space — at least as much as an
		// interior col with the same labels.
		expect(leftMargins[0]!).toBeGreaterThanOrEqual(leftMargins[1]!)
		// Col 2's long label inflates its own chrome but NOT col 0's or 1's.
		expect(leftMargins[2]!).toBeGreaterThan(leftMargins[0]!)
		expect(leftMargins[2]!).toBeGreaterThan(leftMargins[1]!)
	})
})

describe("solveFacetLayout — pixel-precise panel size overrides", () => {
	it("panelWidthOverride sets every panel's inner.width to the exact value", () => {
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 2000,
				containerHeight: 600,
				rows: 1,
				cols: 4,
				panels: makePanels(1, 4),
				panelWidthOverride: 200,
			}),
		)
		for (const p of spec.panels) {
			expect(p.inner.width).toBeCloseTo(200, 3)
		}
	})

	it("panelHeightOverride sets every panel's inner.height to the exact value", () => {
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 2000,
				rows: 4,
				cols: 1,
				panels: makePanels(4, 1),
				panelHeightOverride: 150,
			}),
		)
		for (const p of spec.panels) {
			expect(p.inner.height).toBeCloseTo(150, 3)
		}
	})

	it("canvas grows + emits scroll when override > container", () => {
		// 4 cols × 500px wide = 2000+ chrome, but container is only 800.
		// Canvas should grow; scroll wrapper appears.
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 800,
				containerHeight: 600,
				rows: 1,
				cols: 4,
				panels: makePanels(1, 4),
				panelWidthOverride: 500,
			}),
		)
		expect(spec.canvas.width).toBeGreaterThan(800)
		expect(spec.scroll).not.toBeNull()
		expect(spec.scroll!.width).toBe(800)
	})

	it("override overrides proportional sizing", () => {
		// Even with proportional + varying weights, the override wins.
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 2000,
				containerHeight: 600,
				rows: 1,
				cols: 3,
				panels: [1, 2, 6].map((w, c) => ({
					key: `col-${c}`,
					row: 0,
					col: c,
					xLabels: Array.from({ length: w }, (_, i) => `${i}`),
					yLabels: [],
					xLabelAngleDeg: 0,
					xLabelFontSize: 12,
					yLabelFontSize: 12,
					xWeight: w,
					yWeight: 1,
				})),
				proportionalSizing: true,
				panelWidthOverride: 250,
			}),
		)
		const widths = new Set(spec.panels.map((p) => p.inner.width.toFixed(3)))
		expect(widths.size).toBe(1)
		expect(spec.panels[0]!.inner.width).toBeCloseTo(250, 3)
	})

	it("null override falls back to auto distribution (regression guard)", () => {
		const spec = solveFacetLayout(
			baseline({
				containerWidth: 1200,
				containerHeight: 600,
				rows: 1,
				cols: 3,
				panels: makePanels(1, 3),
				panelWidthOverride: null,
			}),
		)
		// Should auto-distribute. No assertion on exact value; just confirm
		// it doesn't crash and produces positive widths.
		for (const p of spec.panels) {
			expect(p.inner.width).toBeGreaterThan(0)
		}
	})
})

describe("solveFacetLayout — 10px viewport buffer (LAYOUT.md §8)", () => {
	const tt = { text: "Title", fontSize: 18, align: "center" as const }
	const xt = { text: "x", fontSize: 14, align: "center" as const }

	it("chart title with extreme negative offsetY clamps to top buffer", () => {
		// User offsets title way off the top of the canvas. Without the
		// clamp it would render at negative y (clipping into the
		// browser's SVG bounds). With the clamp it sits at
		// BUFFER + ascender ≈ 10 + 14 = ~24 px from the top.
		const spec = solveFacetLayout(
			baseline({
				chartTitle: { ...tt, offsetY: -10000 },
			}),
		)
		expect(spec.title!.y).toBeGreaterThanOrEqual(10) // at least the buffer
		expect(spec.title!.y).toBeLessThan(50) // close to the top edge
	})

	it("chart title with extreme positive offsetY clamps to bottom buffer", () => {
		const spec = solveFacetLayout(
			baseline({
				chartTitle: { ...tt, offsetY: 100000 },
				containerHeight: 600,
			}),
		)
		// Baseline + descender <= canvasH - BUFFER.
		expect(spec.title!.y).toBeLessThanOrEqual(spec.canvas.height - 10)
	})

	it("x-title with extreme positive offsetY clamps to bottom buffer", () => {
		const spec = solveFacetLayout(
			baseline({
				xTitle: { ...xt, offsetY: 100000 },
				containerHeight: 600,
			}),
		)
		// x-title baseline + descender <= canvasH - BUFFER
		expect(spec.xTitle!.y).toBeLessThanOrEqual(spec.canvas.height - 10)
	})

	it("y-title rotated with extreme negative offsetX clamps to left buffer", () => {
		const spec = solveFacetLayout(
			baseline({
				yTitle: {
					text: "y",
					fontSize: 14,
					align: "center" as const,
					horizontal: false,
					offsetX: -10000,
				},
				containerWidth: 800,
			}),
		)
		// Rotated text bbox left = center.x - fontSize/2. Clamped so
		// left edge >= BUFFER → center.x >= BUFFER + fontSize/2 = 17.
		expect(spec.yTitle!.x).toBeGreaterThanOrEqual(10)
	})

	it("normal layouts (no extreme offset) unaffected by buffer clamp", () => {
		const without = solveFacetLayout(baseline({ chartTitle: tt }))
		const withClamp = solveFacetLayout(
			baseline({ chartTitle: { ...tt, offsetY: 0 } }),
		)
		// Identical positions — buffer is a no-op for sane offsets.
		expect(withClamp.title!.y).toBeCloseTo(without.title!.y, 3)
	})
})

describe("solveFacetLayout — grid mode header strips", () => {
	it("emits column header rects above row 0, one per column", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 2,
				panels: makePanels(2, 2),
				columnHeaders: [
					{
						text: "2024",
						fontSize: 13,
						align: "center" as const,
						offsetX: 0,
						offsetY: 0,
					},
					{
						text: "2025",
						fontSize: 13,
						align: "center" as const,
						offsetX: 0,
						offsetY: 0,
					},
				],
			})
		)
		expect(spec.columnHeaders).toHaveLength(2)
		expect(spec.columnHeaders[0]!.text).toBe("2024")
		expect(spec.columnHeaders[1]!.text).toBe("2025")
		// Column 0's header sits above col-0's cell.
		const col0Panel = spec.panels.find((p) => p.col === 0 && p.row === 0)!
		expect(spec.columnHeaders[0]!.y).toBeLessThan(col0Panel.cell.y)
		// Column 0's header x aligns with the horizontal center of col 0's
		// INNER rect (where the plot actually sits), not the cell center —
		// asymmetric chrome (e.g. wider left chrome for the y-axis) would
		// otherwise put the header off-axis from the plot.
		const col0InnerCenter = col0Panel.inner.x + col0Panel.inner.width / 2
		expect(spec.columnHeaders[0]!.x).toBeCloseTo(col0InnerCenter, 0)
	})

	it("emits row header rects left of col 0, one per row", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 2,
				panels: makePanels(2, 2),
				rowHeaders: [
					{
						text: "N",
						fontSize: 13,
						align: "center" as const,
						offsetX: 0,
						offsetY: 0,
					},
					{
						text: "S",
						fontSize: 13,
						align: "center" as const,
						offsetX: 0,
						offsetY: 0,
					},
				],
			})
		)
		expect(spec.rowHeaders).toHaveLength(2)
		expect(spec.rowHeaders[0]!.text).toBe("N")
		expect(spec.rowHeaders[1]!.text).toBe("S")
		// Row 0's header sits left of col-0-row-0's cell.
		const row0Panel = spec.panels.find((p) => p.col === 0 && p.row === 0)!
		expect(spec.rowHeaders[0]!.x).toBeLessThan(row0Panel.cell.x)
	})

	it("aligns a quantitative-y row header to the plot edges (no inset)", () => {
		// Quantitative y (empty yLabels) lands its extreme ticks at the plot
		// edges, so top/bottom sit exactly at the inner rect's top/bottom and
		// every header is centred on its y (matches the y-tick label baseline).
		const rowHeaderFor = (verticalAlign: "top" | "middle" | "bottom") =>
			solveFacetLayout(
				baseline({
					rows: 2,
					cols: 2,
					panels: makePanels(2, 2), // yLabels: [] → quantitative
					rowHeaders: [
						{ text: "N", fontSize: 13, align: "center", verticalAlign },
						{ text: "S", fontSize: 13, align: "center", verticalAlign },
					],
				})
			).rowHeaders[0]!
		const top = rowHeaderFor("top")
		const middle = rowHeaderFor("middle")
		const bottom = rowHeaderFor("bottom")
		const row0Inner = solveFacetLayout(
			baseline({ rows: 2, cols: 2, panels: makePanels(2, 2) })
		).panels.find((p) => p.col === 0 && p.row === 0)!.inner

		expect(top.y).toBeCloseTo(row0Inner.y, 0)
		expect(middle.y).toBeCloseTo(row0Inner.y + row0Inner.height / 2, 0)
		expect(bottom.y).toBeCloseTo(row0Inner.y + row0Inner.height, 0)
		// Centred on the tick position, like the y-tick labels themselves.
		expect(top.verticalAnchor).toBe("middle")
		expect(middle.verticalAnchor).toBe("middle")
		expect(bottom.verticalAnchor).toBe("middle")
	})

	it("insets a categorical-y row header to the extreme category labels", () => {
		// A categorical y-axis (scalePoint, padding 0.5) places its N labels
		// half a step (height / 2N) inside each plot edge. Top/bottom-aligned
		// row titles must land on those extreme labels, not the plot edge — so
		// the title reads level with the top-most / bottom-most category label.
		const cats = ["Other", "Cardiology", "Oncology", "Immunology", "Rare"]
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 1,
				panels: makePanels(2, 1, { yLabels: cats }),
				rowHeaders: [
					{ text: "N", fontSize: 13, align: "center", verticalAlign: "top" },
					{ text: "S", fontSize: 13, align: "center", verticalAlign: "top" },
				],
			})
		)
		const specBottom = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 1,
				panels: makePanels(2, 1, { yLabels: cats }),
				rowHeaders: [
					{ text: "N", fontSize: 13, align: "center", verticalAlign: "bottom" },
					{ text: "S", fontSize: 13, align: "center", verticalAlign: "bottom" },
				],
			})
		)
		const inner = spec.panels.find((p) => p.row === 0 && p.col === 0)!.inner
		const expectedInset = inner.height / (2 * cats.length)
		// Top row header sits half a step below the plot's top edge.
		expect(spec.rowHeaders[0]!.y).toBeCloseTo(inner.y + expectedInset, 0)
		// Bottom-aligned header sits half a step above the plot's bottom edge.
		expect(specBottom.rowHeaders[0]!.y).toBeCloseTo(
			inner.y + inner.height - expectedInset,
			0
		)
		expect(expectedInset).toBeGreaterThan(1)
	})

	it("combines per-panel facetLabel bands with a column-header strip (hide-empty grid mode)", () => {
		// Grid mode historically passed EITHER facetLabel OR strip headers,
		// never both. Hide-empty-panels compaction passes one surviving strip
		// PLUS per-panel labels (the panel titles carry the compacted
		// dimension's value) — prove the two bands reserve space independently.
		const facetLabel: FacetLabelInput = {
			fontSize: 11,
			height: 20,
			align: "center",
		}
		const columnHeaderHeight = 20
		const header = (text: string) => ({
			text,
			fontSize: 13,
			align: "center" as const,
			offsetX: 0,
			offsetY: 0,
		})
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 3,
				panels: makePanels(2, 3),
				facetLabel,
				columnHeaders: [header("x"), header("y"), header("z")],
				columnHeaderHeight,
			})
		)
		expect(spec.columnHeaders).toHaveLength(3)
		// Every panel keeps its per-panel label despite the strip.
		for (const p of spec.panels) {
			expect(p.facetLabel).not.toBeNull()
		}
		const row0 = spec.panels.filter((p) => p.row === 0)
		expect(row0).toHaveLength(3)
		for (const p of row0) {
			// Both bands are reserved above the plot rect.
			expect(p.inner.y).toBeGreaterThanOrEqual(
				columnHeaderHeight + facetLabel.height
			)
			// The per-panel label sits BELOW the column-header strip — the
			// bands stack, they don't overlap.
			expect(p.facetLabel!.y).toBeGreaterThan(spec.columnHeaders[p.col]!.y)
		}
	})

	it("when columnHeaders is undefined or empty, spec.columnHeaders is an empty array", () => {
		const spec = solveFacetLayout(baseline({ rows: 1, cols: 1 }))
		expect(spec.columnHeaders).toEqual([])
		expect(spec.rowHeaders).toEqual([])
	})

	it("polar single-column: row header hugs the pie's left edge instead of the far-left strip", () => {
		const header = {
			text: "Watermelon",
			fontSize: 13,
			align: "center" as const,
			offsetX: 0,
			offsetY: 0,
		}
		const polar = solveFacetLayout(
			baseline({
				rows: 4,
				cols: 1,
				panels: makePanels(4, 1),
				isPolar: true,
				rowHeaders: [header, header, header, header],
			})
		)
		const cartesian = solveFacetLayout(
			baseline({
				rows: 4,
				cols: 1,
				panels: makePanels(4, 1),
				rowHeaders: [header, header, header, header],
			})
		)
		const p0 = polar.panels.find((p) => p.row === 0)!
		const markLeft =
			p0.inner.x + p0.inner.width / 2 - Math.min(p0.inner.width, p0.inner.height) * 0.5
		// Right-anchored just outside the mark's bounding box, not centered
		// in the fixed left strip.
		expect(polar.rowHeaders[0]!.textAnchor).toBe("end")
		expect(polar.rowHeaders[0]!.x).toBeCloseTo(markLeft - 8, 0)
		// Materially closer to the pie than the cartesian strip-band position.
		expect(polar.rowHeaders[0]!.x).toBeGreaterThan(cartesian.rowHeaders[0]!.x)
	})

	it("polar single-row: column header drops down to hug the pie's top edge", () => {
		const header = {
			text: "Boiled",
			fontSize: 13,
			align: "center" as const,
			offsetX: 0,
			offsetY: 0,
		}
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 3,
				panels: makePanels(1, 3),
				isPolar: true,
				columnHeaders: [header, header, header],
			})
		)
		const p0 = spec.panels.find((p) => p.col === 0)!
		const markTop =
			p0.inner.y + p0.inner.height / 2 - Math.min(p0.inner.width, p0.inner.height) * 0.5
		// Header centered on the mark, pulled down to just above its top edge.
		expect(spec.columnHeaders[0]!.y).toBeCloseTo(markTop - 8, 0)
		// Below the grid's top reserve (where a cartesian header would sit).
		expect(spec.columnHeaders[0]!.y).toBeGreaterThan(p0.cell.y)
	})

	it("polar multi-column / multi-row keeps the default strip-band header position", () => {
		const header = {
			text: "x",
			fontSize: 13,
			align: "center" as const,
			offsetX: 0,
			offsetY: 0,
		}
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 2,
				panels: makePanels(2, 2),
				isPolar: true,
				rowHeaders: [header, header],
				columnHeaders: [header, header],
			})
		)
		// Multi-column: row headers stay middle-anchored in the strip band.
		expect(spec.rowHeaders[0]!.textAnchor).toBe("middle")
		// Multi-row: column header stays above its cell, not inside the panel.
		const col0 = spec.panels.find((p) => p.col === 0 && p.row === 0)!
		expect(spec.columnHeaders[0]!.y).toBeLessThan(col0.cell.y)
	})
})

describe("solveFacetLayout — polar (radar / pie) cell chrome", () => {
	const xt = { text: "x", fontSize: 14, align: "center" as const }
	const yt = {
		text: "y",
		fontSize: 14,
		align: "center" as const,
		horizontal: false,
	}

	it("collapses cell chrome to POLAR_MARGIN on every side when no shared axis titles", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 2,
				panels: makePanels(2, 2),
				isPolar: true,
			})
		)
		// Bottom-row panel's chrome below inner = cellMargin.bottom = POLAR_MARGIN.bottom
		const bottomPanel = spec.panels.find((p) => p.row === 1 && p.col === 0)!
		const innerBottomToCellBottom =
			bottomPanel.cell.y + bottomPanel.cell.height - (bottomPanel.inner.y + bottomPanel.inner.height)
		expect(innerBottomToCellBottom).toBe(POLAR_MARGIN.bottom)
		// Leftmost-col panel's chrome left of inner = cellMargin.left + facet label gap
		const leftPanel = spec.panels.find((p) => p.col === 0 && p.row === 0)!
		const innerLeftToCellLeft = leftPanel.inner.x - leftPanel.cell.x
		expect(innerLeftToCellLeft).toBe(POLAR_MARGIN.left)
	})

	it("polar panels are larger than cartesian panels in the same container", () => {
		const polar = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 2,
				panels: makePanels(2, 2),
				isPolar: true,
			})
		)
		const cartesian = solveFacetLayout(
			baseline({ rows: 2, cols: 2, panels: makePanels(2, 2) })
		)
		const polarInner = polar.panels[0]!.inner
		const cartInner = cartesian.panels[0]!.inner
		// Saved horizontal chrome: (BASE.left - POLAR.left) + (BASE.right - POLAR.right) per col.
		expect(polarInner.width).toBeGreaterThan(cartInner.width)
		expect(polarInner.height).toBeGreaterThan(cartInner.height)
	})

	it("polar with shared x-title keeps full BASE_MARGIN.bottom (so title fits)", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 2,
				panels: makePanels(1, 2),
				isPolar: true,
				xTitle: xt,
			})
		)
		const p = spec.panels[0]!
		const innerBottomToCellBottom =
			p.cell.y + p.cell.height - (p.inner.y + p.inner.height)
		// Bottom keeps BASE_MARGIN (plus any bottomFloor delta) when xTitle is set.
		expect(innerBottomToCellBottom).toBeGreaterThanOrEqual(BASE_MARGIN.bottom)
		// Left still drops to POLAR_MARGIN because no yTitle.
		expect(p.inner.x - p.cell.x).toBe(POLAR_MARGIN.left)
	})

	it("polar with shared y-title keeps full BASE_MARGIN.left (so title fits)", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 1,
				cols: 2,
				panels: makePanels(1, 2),
				isPolar: true,
				yTitle: yt,
			})
		)
		// Leftmost col carries the y-title chrome; both panels share its full
		// horizontal reserve via the per-col chrome uniformity rule.
		const left = spec.panels.find((p) => p.col === 0)!
		expect(left.inner.x - left.cell.x).toBeGreaterThanOrEqual(BASE_MARGIN.left)
		// Bottom still drops to POLAR_MARGIN because no xTitle (the bottom row
		// is also the only row, so it carries the full bottom chrome).
		const bottomChrome =
			left.cell.y + left.cell.height - (left.inner.y + left.inner.height)
		expect(bottomChrome).toBe(POLAR_MARGIN.bottom)
	})

	it("isPolar undefined / false preserves existing cartesian chrome", () => {
		const polarOff = solveFacetLayout(
			baseline({ rows: 2, cols: 2, panels: makePanels(2, 2) })
		)
		const explicitFalse = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 2,
				panels: makePanels(2, 2),
				isPolar: false,
			})
		)
		expect(explicitFalse.panels[0]!.inner.width).toBe(
			polarOff.panels[0]!.inner.width
		)
		expect(explicitFalse.panels[0]!.inner.height).toBe(
			polarOff.panels[0]!.inner.height
		)
		// And a sanity check that cartesian cells still apply BASE_MARGIN.left.
		const p = polarOff.panels.find((pp) => pp.col === 0)!
		expect(p.inner.x - p.cell.x).toBeGreaterThanOrEqual(BASE_MARGIN.left)
	})
})

describe("solveFacetLayout — fixed aspect ratio", () => {
	const innerOf = (spec: ReturnType<typeof solveFacetLayout>) =>
		spec.panels[0]!.inner

	it("1:1 in a wide container: width shrinks to match height", () => {
		const free = innerOf(solveFacetLayout(baseline()))
		const spec = solveFacetLayout(baseline({ aspectRatio: 1 }))
		const inner = innerOf(spec)
		expect(inner.width).toBeCloseTo(inner.height, 5)
		// The wide container's height was the binding dimension.
		expect(inner.height).toBeCloseTo(free.height, 5)
		expect(inner.width).toBeLessThan(free.width)
	})

	it("1:1 in a tall container: height shrinks to match width", () => {
		const tall = { containerWidth: 400, containerHeight: 900 }
		const free = innerOf(solveFacetLayout(baseline(tall)))
		const inner = innerOf(
			solveFacetLayout(baseline({ ...tall, aspectRatio: 1 }))
		)
		expect(inner.width).toBeCloseTo(inner.height, 5)
		expect(inner.width).toBeCloseTo(free.width, 5)
		expect(inner.height).toBeLessThan(free.height)
	})

	it("applies the ratio to EVERY panel of a faceted grid (2:3 → h = w·2/3)", () => {
		const spec = solveFacetLayout(
			baseline({
				rows: 2,
				cols: 2,
				panels: makePanels(2, 2),
				aspectRatio: 2 / 3,
			})
		)
		expect(spec.panels).toHaveLength(4)
		for (const p of spec.panels) {
			expect(p.inner.height).toBeCloseTo((p.inner.width * 2) / 3, 5)
		}
	})

	it("ratio wins over pixel panel overrides", () => {
		const inner = innerOf(
			solveFacetLayout(
				baseline({
					aspectRatio: 1,
					panelWidthOverride: 300,
					panelHeightOverride: 100,
				})
			)
		)
		expect(inner.width).toBeCloseTo(inner.height, 5)
		expect(inner.height).not.toBeCloseTo(100, 0)
		// Guard against a half-normalized input (e.g. only the height
		// override nulled): must match the no-override aspect solve exactly.
		const noOverrides = innerOf(solveFacetLayout(baseline({ aspectRatio: 1 })))
		expect(inner.width).toBeCloseTo(noOverrides.width, 5)
		expect(inner.height).toBeCloseTo(noOverrides.height, 5)
	})

	it("ratio wins over proportional sizing weights", () => {
		const panels = makePanels(1, 2)
		// Unequal weights would give unequal columns without the ratio.
		const weighted = panels.map((p, i) => ({ ...p, xWeight: i === 0 ? 1 : 3 }))
		const spec = solveFacetLayout(
			baseline({
				cols: 2,
				panels: weighted,
				proportionalSizing: true,
				aspectRatio: 1,
			})
		)
		const [a, b] = spec.panels
		expect(a!.inner.width).toBeCloseTo(b!.inner.width, 5)
		expect(a!.inner.width).toBeCloseTo(a!.inner.height, 5)
	})

	it("ratio wins over scroll-mode panel minimums (no blank scroll canvas)", () => {
		// Small container + minPanelPx would normally grow the canvas and
		// emit scroll; with a fixed ratio the panels shrink to fit instead.
		const small = { containerWidth: 400, containerHeight: 300 }
		const spec = solveFacetLayout(
			baseline({ ...small, minPanelPx: 600, aspectRatio: 1 })
		)
		expect(spec.scroll).toBeNull()
		expect(spec.canvas.width).toBe(400)
		expect(spec.canvas.height).toBe(300)
		const inner = spec.panels[0]!.inner
		expect(inner.width).toBeCloseTo(inner.height, 5)
	})

	it("absent / non-positive aspectRatio is a no-op", () => {
		const free = solveFacetLayout(baseline())
		const zero = solveFacetLayout(baseline({ aspectRatio: 0 }))
		const nul = solveFacetLayout(baseline({ aspectRatio: null }))
		const neg = solveFacetLayout(baseline({ aspectRatio: -1 }))
		expect(zero).toEqual(free)
		expect(nul).toEqual(free)
		expect(neg).toEqual(free)
	})

	it("centers the shrunk grid: the panel shifts right by half the width reduction", () => {
		const free = solveFacetLayout(baseline())
		const spec = solveFacetLayout(baseline({ aspectRatio: 1 }))
		const freeInner = free.panels[0]!.inner
		const inner = spec.panels[0]!.inner
		// Wide container → width shrank; the freed pixels split evenly.
		const reduction = freeInner.width - inner.width
		expect(reduction).toBeGreaterThan(0)
		expect(inner.x - freeInner.x).toBeCloseTo(reduction / 2, 5)
		// The unshrunk axis doesn't move.
		expect(inner.y).toBeCloseTo(freeInner.y, 5)
	})

	it("centers vertically in a tall container", () => {
		const tall = { containerWidth: 400, containerHeight: 900 }
		const free = solveFacetLayout(baseline(tall))
		const spec = solveFacetLayout(baseline({ ...tall, aspectRatio: 1 }))
		const freeInner = free.panels[0]!.inner
		const inner = spec.panels[0]!.inner
		const reduction = freeInner.height - inner.height
		expect(reduction).toBeGreaterThan(0)
		expect(inner.y - freeInner.y).toBeCloseTo(reduction / 2, 5)
		expect(inner.x).toBeCloseTo(freeInner.x, 5)
	})

	it("centers a faceted grid as one block", () => {
		const grid = { rows: 2, cols: 2, panels: makePanels(2, 2) }
		const free = solveFacetLayout(baseline(grid))
		const spec = solveFacetLayout(baseline({ ...grid, aspectRatio: 1 }))
		// Every column shrank uniformly; the whole block shifts by half the
		// TOTAL width reduction (2 cols × per-panel reduction).
		const perPanel =
			free.panels[0]!.inner.width - spec.panels[0]!.inner.width
		expect(perPanel).toBeGreaterThan(0)
		expect(spec.panels[0]!.cell.x - free.panels[0]!.cell.x).toBeCloseTo(
			perPanel,
			5
		) // 2 * perPanel / 2
		// Relative spacing between panels is preserved (uniform shift + shrink).
		const gapFree = free.panels[1]!.cell.x - free.panels[0]!.cell.x
		const gapSpec = spec.panels[1]!.cell.x - spec.panels[0]!.cell.x
		expect(gapFree - gapSpec).toBeCloseTo(perPanel, 5)
	})

	it("strip headers follow the centered grid", () => {
		// Build the same grid solve twice (ratio off/on) and assert each
		// header band keeps its distance to the grid — i.e. it shifts by
		// exactly the same offset as the panels.
		const header = {
			text: "h",
			fontSize: 13,
			align: "center" as const,
			offsetX: 0,
			offsetY: 0,
		}
		const grid = {
			rows: 2,
			cols: 2,
			panels: makePanels(2, 2),
			columnHeaders: [header, header],
			rowHeaders: [header, header],
		}
		// Wide container → horizontal slack; tall container → vertical slack,
		// so both header bands get exercised on their pinned axis.
		const shapes = [
			{ containerWidth: 800, containerHeight: 600 },
			{ containerWidth: 400, containerHeight: 900 },
		]
		let shiftedAxes = 0
		for (const shape of shapes) {
			const specOff = solveFacetLayout(baseline({ ...grid, ...shape }))
			const specOn = solveFacetLayout(
				baseline({ ...grid, ...shape, aspectRatio: 1 })
			)
			const dx = specOn.panels[0]!.cell.x - specOff.panels[0]!.cell.x
			const dy = specOn.panels[0]!.cell.y - specOff.panels[0]!.cell.y
			if (dx > 0.001) shiftedAxes++
			if (dy > 0.001) shiftedAxes++
			// Column headers follow the grid's vertical shift…
			expect(
				specOn.columnHeaders[0]!.y - specOff.columnHeaders[0]!.y
			).toBeCloseTo(dy, 5)
			// …and row headers follow the grid's horizontal shift.
			expect(specOn.rowHeaders[0]!.x - specOff.rowHeaders[0]!.x).toBeCloseTo(
				dx,
				5
			)
		}
		// Sanity: the ratio actually shifted the grid somewhere.
		expect(shiftedAxes).toBeGreaterThan(0)
	})

	it("exposes figureSlack matching the shrink; zero when the ratio is off", () => {
		const free = solveFacetLayout(baseline())
		const spec = solveFacetLayout(baseline({ aspectRatio: 1 }))
		const reduction = free.panels[0]!.inner.width - spec.panels[0]!.inner.width
		expect(spec.figureSlack.x).toBeCloseTo(reduction, 5)
		expect(spec.figureSlack.y).toBeCloseTo(0, 5)
		expect(free.figureSlack).toEqual({ x: 0, y: 0 })
	})
})

describe("solveFacetLayout — polar mode with a cartesian axis (pies-y / pies-x)", () => {
	it("reserves left margin for long y-tick labels even though the base margin is collapsed to POLAR_MARGIN", () => {
		// pies-y is flagged isPolar (angle mapped) but still draws a real
		// cartesian categorical y-axis. The base left margin collapses to
		// POLAR_MARGIN.left (8), so the label reserve must grow off that 8,
		// not the cartesian 76 — otherwise long category names clip left.
		const labelWidth = 90
		const spec = solveFacetLayout(
			baseline({
				isPolar: true,
				panels: makePanels(1, 1, {
					yLabels: ["Grapefruit", "Cantaloupe", "Watermelon"],
					yLabelMaxWidthPx: labelWidth,
				}),
			})
		)
		// The plot's left edge must sit far enough right that the ~90px labels
		// fit between the canvas edge and the spine. Pre-fix this was ~46px.
		expect(spec.panels[0]!.inner.x).toBeGreaterThanOrEqual(labelWidth)
	})

	it("reserves bottom margin for long x-tick labels under a collapsed polar base", () => {
		const labelWidth = 90
		const spec = solveFacetLayout(
			baseline({
				isPolar: true,
				panels: makePanels(1, 1, {
					xLabels: ["Grapefruit", "Cantaloupe", "Watermelon"],
					xLabelMaxWidthPx: labelWidth,
					xLabelAngleDeg: -90, // rotated → full width projects downward
				}),
			})
		)
		const p = spec.panels[0]!
		const bottomReserve = spec.canvas.height - (p.inner.y + p.inner.height)
		expect(bottomReserve).toBeGreaterThanOrEqual(labelWidth)
	})

	it("does not reserve axis-label margin for a true polar chart with no tick labels", () => {
		// A plain pie / radar has no cartesian axis labels — yLabels/xLabels
		// empty — so the collapsed POLAR_MARGIN stays put (no spurious grow).
		const spec = solveFacetLayout(
			baseline({ isPolar: true, panels: makePanels(1, 1) })
		)
		// inner.x stays at the tiny polar left reserve (POLAR_MARGIN.left = 8),
		// nowhere near a cartesian 76.
		expect(spec.panels[0]!.inner.x).toBeLessThan(20)
	})
})

describe("solveFacetLayout — continuous x-tick right overhang", () => {
	const rightGap = (spec: ReturnType<typeof solveFacetLayout>): number => {
		const p = spec.panels[0]!
		return spec.canvas.width - (p.inner.x + p.inner.width)
	}

	it("reserves room past the plot edge for the centered rightmost x label", () => {
		// A wide continuous-axis label (e.g. "$140,000") is centered on the
		// last tick at inner.x1; half of it must fit in the right margin.
		const wide = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					xAxisContinuous: true,
					xLabelMaxWidthPx: 100,
					xLabelAngleDeg: 0,
				}),
			})
		)
		// Half the 100px label = 50px must clear inner.x1.
		expect(rightGap(wide)).toBeGreaterThanOrEqual(50)
	})

	it("does not reserve the overhang for categorical (band) x-axes", () => {
		const continuous = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					xAxisContinuous: true,
					xLabelMaxWidthPx: 100,
					xLabelAngleDeg: 0,
				}),
			})
		)
		const band = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					xAxisContinuous: false,
					xLabelMaxWidthPx: 100,
					xLabelAngleDeg: 0,
				}),
			})
		)
		// Band axes inset their edge ticks by half a step, so no extra right
		// reserve — the plot stays wider than the continuous case.
		expect(band.panels[0]!.inner.width).toBeGreaterThan(
			continuous.panels[0]!.inner.width
		)
		expect(rightGap(band)).toBeLessThan(rightGap(continuous))
	})

	it("no extra reserve when the label already fits in the base right margin", () => {
		// Half of a 40px label (20px) is under BASE_MARGIN.right (24) → no grow.
		const narrow = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					xAxisContinuous: true,
					xLabelMaxWidthPx: 40,
					xLabelAngleDeg: 0,
				}),
			})
		)
		expect(rightGap(narrow)).toBeCloseTo(BASE_MARGIN.right, 5)
	})

	it("does not reserve right overhang for up-left rotated labels", () => {
		// Negative angle → end-anchored, leaning away from the right edge.
		const rotated = solveFacetLayout(
			baseline({
				panels: makePanels(1, 1, {
					xAxisContinuous: true,
					xLabelMaxWidthPx: 100,
					xLabelAngleDeg: -45,
				}),
			})
		)
		expect(rightGap(rotated)).toBeCloseTo(BASE_MARGIN.right, 5)
	})
})
