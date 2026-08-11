/** Pure layout solver for the unified PlotCanvas renderer.
 *
 *  Emits exact rectangles for every visual element on the canvas:
 *  per-panel inner rects, shared titles, facet labels, gap regions.
 *  Single-panel charts are the rows=cols=1 case with no facet label.
 *
 *  Alignment-by-construction: shared titles position themselves against
 *  cell/inner rects in the spec, not against reverse-engineered constants.
 *  As long as the cell positions are correct, the titles can't drift.
 *
 *  All math is pure — no React, no DOM, no measurement. Text dimensions
 *  come from `estimateMargins.ts` (character-count heuristic); the
 *  caller may pre-measure widths via canvas.measureText and pass them in
 *  to tighten the result. */

import {
	estimateExtraBottomMargin,
	estimateExtraLeftMargin,
	estimateInteriorBottomChrome,
	estimateInteriorLeftChrome,
} from "./estimateMargins"
import { lineCount } from "./multilineText"
import {
	BASE_MARGIN,
	POLAR_MARGIN,
	subtitleReserve,
	TITLE_RESERVE,
	titleReserve,
} from "./plotLayout"

/** Per-side cell chrome resolved at the top of `solveFacetLayout` and
 *  threaded through the helpers that previously read `BASE_MARGIN`
 *  directly. For cartesian charts this collapses to `BASE_MARGIN` on
 *  every side; for polar charts (radar / pie) axis-less sides switch to
 *  `POLAR_MARGIN`, while sides that still carry a shared axis title
 *  (pies-x / pies-y) fall back to `BASE_MARGIN` so the title has room. */
type CellMargin = {
	readonly top: number
	readonly right: number
	readonly bottom: number
	readonly left: number
}

/** Axis-aligned rectangle in canvas coordinates. {x, y} is the top-left
 *  corner; {width, height} is the size. SVG <rect>/<g transform> use the
 *  same convention. */
export type Rect = {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export type Alignment = "left" | "center" | "right"
export type VerticalAlignment = "top" | "middle" | "bottom"
export type TextAnchorSpec = "start" | "middle" | "end"

/** Position and styling for a single SVG <text> element. The renderer
 *  places `<text>` at (x, y) with `text-anchor=textAnchor`; rotation
 *  (currently 0 or -90) drives an outer transform. width/height are
 *  reserved layout bounds based on the estimate — actual rendered text
 *  may differ slightly. */
export type TextRect = {
	readonly x: number
	readonly y: number
	readonly textAnchor: TextAnchorSpec
	readonly rotation: 0 | -90
	readonly width: number
	readonly height: number
}

export type SharedTitleInput = {
	readonly text: string
	readonly fontSize: number
	readonly align: Alignment
	/** Pixel shift from the natural position. `+x` moves the title right,
	 *  `+y` moves it down (SVG convention). The solver grows outer
	 *  reserves to accommodate the shift so the title doesn't clip and
	 *  the plot adjusts to keep neighbors from overlapping. */
	readonly offsetX?: number
	readonly offsetY?: number
	/** Vertical placement within the reserved band / strip. Only the row-header
	 *  strip honors this today (it positions the title at the top / center /
	 *  bottom of the row's plot rect). Omit = "middle" (legacy centering). */
	readonly verticalAlign?: VerticalAlignment
}

export type SharedYTitleInput = SharedTitleInput & {
	/** When true the title reads upright (one line of horizontal text);
	 *  when false the title is rotated -90° next to the y-axis. */
	readonly horizontal: boolean
}

export type FacetLabelInput = {
	readonly fontSize: number
	/** Pinned cell height for the facet label band in px. Today's code uses
	 *  20 to defeat browser font-metric drift; keeping it explicit lets
	 *  callers tweak without re-deriving the PROPORTIONAL_MIN_FIXED_CHROME
	 *  formula. */
	readonly height: number
	readonly align: Alignment
}

export type SolverPanelInput = {
	readonly key: string
	readonly row: number
	readonly col: number
	/** Sample of x-axis tick labels for margin estimation. Empty for
	 *  quantitative axes (the scale generates labels later). */
	readonly xLabels: readonly string[]
	readonly yLabels: readonly string[]
	readonly xLabelAngleDeg: number
	readonly xLabelFontSize: number
	readonly yLabelFontSize: number
	/** Optional pre-measured widths (canvas measureText, in px) for the
	 *  longest label per axis. When provided, the solver uses these
	 *  instead of its character-count-based estimate — accurate widths
	 *  matter most for y-title positioning (the title sits a fixed gap
	 *  from the *actual* label edge, not the estimated one). */
	readonly xLabelMaxWidthPx?: number
	readonly yLabelMaxWidthPx?: number
	/** Proportional-sizing weight along the X axis. Under "size by
	 *  category count" this is the panel's x-category count (so panels
	 *  with more categories on x get proportionally wider cells). Under
	 *  "size by unit" it's the panel's quantitative range on x. Use 1
	 *  for axes that shouldn't drive sizing (e.g. a quantitative y on a
	 *  by-category-count config). Ignored when proportionalSizing=false. */
	readonly xWeight: number
	/** Mirror of `xWeight` for the Y axis. Drives per-row height
	 *  distribution under proportionalSizing. */
	readonly yWeight: number
	/** True when the x-axis is continuous (quantitative / temporal): d3
	 *  lands ticks at (or near) the domain edges, so the CENTERED rightmost
	 *  tick label's right half overhangs the plot rect. The solver reserves
	 *  right-margin room for that overhang (see `computeXTickRightOverhang`).
	 *  Categorical/ordinal band axes inset their edge ticks by half a step,
	 *  so their labels don't overhang — this stays false for them. */
	readonly xAxisContinuous?: boolean
}

export type SolverInput = {
	readonly containerWidth: number
	readonly containerHeight: number

	readonly rows: number
	readonly cols: number

	readonly panels: readonly SolverPanelInput[]

	readonly chartTitle?: SharedTitleInput
	readonly chartSubtitle?: SharedTitleInput
	readonly xTitle?: SharedTitleInput
	readonly yTitle?: SharedYTitleInput

	/** Per-panel facet label band. Omit for single-panel charts. */
	readonly facetLabel?: FacetLabelInput

	/** Per-column header text (grid-mode top strip). One entry per column,
	 *  in display order. Strips and `facetLabel` MAY be combined: the bands
	 *  are geometrically independent (strips are outer bands at the grid
	 *  edge; `facetLabel` is a per-cell band above each panel's plot rect),
	 *  and hide-empty grid mode passes ONE surviving strip plus per-panel
	 *  labels — the per-panel titles carry the compacted dimension's value.
	 *  Plain grid mode still passes strips alone. The solver reserves space
	 *  at the top of the canvas; the renderer in PlotCanvas draws the
	 *  actual <text> elements. */
	readonly columnHeaders?: readonly SharedTitleInput[]
	/** Per-row header text (grid-mode left strip). Symmetric to
	 *  `columnHeaders` but down the left side. */
	readonly rowHeaders?: readonly SharedTitleInput[]
	/** Height of the column-header band in px. Default 20 (matches
	 *  FACET_LABEL_HEIGHT_PX in PlotCanvas). */
	readonly columnHeaderHeight?: number
	/** Width of the row-header band in px. Default 80. */
	readonly rowHeaderWidth?: number

	/** Plot-edge-to-plot-edge whitespace. Negative = ridgeline overlap. */
	readonly gapX: number
	readonly gapY: number

	/** Optional pixel-precise overrides for EVERY panel's inner rect.
	 *  When set, all panels get the specified inner width / height
	 *  (proportional + equal-split distribution are both bypassed for
	 *  that dimension). If the override × cols/rows + chrome exceeds
	 *  the container, the canvas grows and the renderer wraps in a
	 *  scroll container. `null` / `undefined` = use auto distribution. */
	readonly panelWidthOverride?: number | null
	readonly panelHeightOverride?: number | null

	/** Fixed panel shape as height/width (Aesthetics "Fix aspect ratio",
	 * LAYOUT.md §15). When set (> 0), every panel's inner rect is SHRUNK to
	 * this ratio, and it overrides panelWidthOverride / panelHeightOverride
	 * and proportionalSizing (a uniform per-panel shape can't coexist with
	 * differently sized panels sharing row/col tracks). Never grows a
	 * dimension. Null / undefined = off. */
	readonly aspectRatio?: number | null

	readonly shareX: boolean
	readonly shareY: boolean

	readonly proportionalSizing: boolean

	/** Floor px-per-category when proportional sizing is on. Default 20
	 *  matches the legacy PROPORTIONAL_MIN_PER_CATEGORY constant. */
	readonly minPxPerCategory?: number
	/** Cell-dimension floor when proportional sizing is off. Default 200
	 *  matches legacy NONPROPORTIONAL_MIN_PX (illegibility threshold). */
	readonly minPanelPx?: number
	/** Extra pixels reserved on the right of the plot grid. Callers pass
	 *  this when something OUTSIDE the normal plot chrome — most commonly
	 *  data labels rendered just past the last data point (last-label
	 *  with left alignment + positive xOffset) — needs room. Adds to
	 *  outerReserves.right so the plot rect shrinks (or the canvas grows
	 *  in scroll mode) to keep the labels in view. */
	readonly extraRightMargin?: number
	/** Mirror of `extraRightMargin` for the left side. Right-aligned data
	 *  labels grow LEFT from their anchor, so the leftmost data point's
	 *  label can poke into / past the y-axis tick-label band. */
	readonly extraLeftMargin?: number
	/** Extra pixels reserved BELOW the plot grid. The caption box passes its
	 *  measured height here so the plot shrinks to make room and the caption
	 *  sits in a reserved band at the bottom of the canvas — instead of
	 *  growing the canvas past the viewport. Adds to outerReserves.bottom. */
	readonly extraBottomMargin?: number

	/** True for polar chart modes (radar, pies, pies-x, pies-y). Polar
	 *  charts don't draw cartesian axes — angle/r ticks sit inside the
	 *  inner rect with the renderer's own perimeter padding — so the
	 *  per-cell chrome can drop from `BASE_MARGIN` (64/76 on bottom/left)
	 *  to `POLAR_MARGIN` (~16). Sides with a shared axis title still set
	 *  (pies-x bottom, pies-y left) keep the cartesian reserve so the
	 *  title has room; this is per-side and resolved internally. */
	readonly isPolar?: boolean
}

export type SolverPanelOutput = {
	readonly key: string
	readonly row: number
	readonly col: number
	readonly cell: Rect
	readonly inner: Rect
	readonly facetLabel: TextRect | null
	readonly showXTicks: boolean
	readonly showYTicks: boolean
	readonly showXAxisTitle: false
	readonly showYAxisTitle: false
}

/** Strip-header rect carries its own text since the renderer pairs the
 *  resolved geometry with the label string directly (no per-column input
 *  lookup at render time). All other text rects (title, x/y title, facet
 *  label) keep text in their `SolverInput` source. */
export type StripHeaderRect = TextRect & {
	readonly text: string
	/** Vertical anchoring the renderer should apply via SVG dominant-baseline.
	 *  Set on row headers when a non-default (top / bottom) vertical alignment
	 *  is chosen; omitted (→ renderer defaults to center) otherwise. */
	readonly verticalAnchor?: VerticalAlignment
}

export type FacetLayoutSpec = {
	readonly canvas: { readonly width: number; readonly height: number }
	/** When non-null, the renderer wraps the SVG in an overflow-auto
	 *  container of {scroll.width, scroll.height} (= containerWidth/Height);
	 *  the SVG itself renders at canvas dimensions (≥ scroll dimensions).
	 *  Null when the canvas fits the container. */
	readonly scroll: { readonly width: number; readonly height: number } | null
	readonly title: TextRect | null
	readonly subtitle: TextRect | null
	readonly xTitle: TextRect | null
	readonly yTitle: TextRect | null
	readonly panels: readonly SolverPanelOutput[]
	/** Column header text rects (grid-mode top strip). Always present;
	 *  empty when no `columnHeaders` were provided. */
	readonly columnHeaders: readonly StripHeaderRect[]
	/** Row header text rects (grid-mode left strip). Empty when no
	 *  `rowHeaders` were provided. */
	readonly rowHeaders: readonly StripHeaderRect[]
	/** Inner-grid space left unused by the placed grid when the fixed aspect
	 * ratio is active (the shrink, plus any ridgeline overlap). 0 when the
	 * ratio is off. The grid is shifted by HALF of this
	 * (centered); ChartCanvas uses it to pull edge legends flush against
	 * the figure so the [figure][legend] ensemble centers in the viewport. */
	readonly figureSlack: { readonly x: number; readonly y: number }
}

const DEFAULT_MIN_PX_PER_CATEGORY = 20
const DEFAULT_MIN_PANEL_PX = 200
/** Minimal vertical reserve for an interior shared-axis row: enough room
 *  for the spine plus a hair of breathing space. The full BASE_MARGIN.bottom
 *  reserve goes only to the bottom row (which actually draws ticks/labels). */
const SHARED_INTERIOR_AXIS_RESERVE = 4

/** Polar single-strip header hug. When a polar (radar / pie) grid has just
 *  one column (row-header strip down the side) or one row (column-header
 *  strip across the top), the panel's inner rect is far wider / taller than
 *  the centered circular mark, so a header pinned to the fixed strip band
 *  floats off in dead whitespace (user-reported June 2026: "facet titles
 *  really far away from the pies"). In those single-strip cases we instead
 *  anchor the header right up against the mark's bounding box.
 *
 *  `POLAR_MARK_HALF_FRAC` is the mark's bounding-box half-extent as a
 *  fraction of min(inner.w, inner.h): pies draw at radius 0.45·min and
 *  radar fills up to ~0.5·min including its angle-tick labels, so 0.5 is a
 *  safe outer bound for both. `POLAR_HEADER_GAP` is the breathing space
 *  between that edge and the header text. */
const POLAR_MARK_HALF_FRAC = 0.5
const POLAR_HEADER_GAP = 8

/** Per LAYOUT.md §8: titles never visually touch the viewport edge.
 *  Each title's primary-axis screen position is clamped so its bounding
 *  box stays at least `VIEWPORT_BUFFER_PX` from the corresponding canvas
 *  edge. Only kicks in at extreme user-offsets; normal layouts are
 *  comfortably within this bound. */
const VIEWPORT_BUFFER_PX = 10

/** Clamp a baseline-anchored text's y coordinate so its bounding box
 *  (ascender + descender) doesn't cross the viewport edge with buffer.
 *  Used by chart title / subtitle / x-title. */
const clampBaselineY = (
	y: number,
	fontSize: number,
	canvasH: number,
): number => {
	const ascender = fontSize * 0.8
	const descender = fontSize * 0.2
	const minY = VIEWPORT_BUFFER_PX + ascender
	const maxY = canvasH - VIEWPORT_BUFFER_PX - descender
	// Guard against degenerate (very small) canvases where minY > maxY.
	if (minY > maxY) return Math.max(0, (minY + maxY) / 2)
	return Math.max(minY, Math.min(maxY, y))
}

/** Clamp a rotated y-title's center.x (text-anchor="middle") so its
 *  bounding box (extending ±fontSize/2 horizontally around the anchor)
 *  doesn't clip the canvas left/right edge. */
const clampRotatedTitleX = (
	x: number,
	fontSize: number,
	canvasW: number,
): number => {
	const halfBbox = fontSize / 2
	const minX = VIEWPORT_BUFFER_PX + halfBbox
	const maxX = canvasW - VIEWPORT_BUFFER_PX - halfBbox
	if (minX > maxX) return Math.max(0, (minX + maxX) / 2)
	return Math.max(minX, Math.min(maxX, x))
}

/** Clamp a horizontal y-title's anchor.x (text-anchor="end", text
 *  extends LEFT from anchor) so the leftmost rendered character
 *  doesn't clip the canvas left edge. */
const clampHorizontalYTitleX = (
	anchorX: number,
	textWidth: number,
	canvasW: number,
): number => {
	const minX = VIEWPORT_BUFFER_PX + textWidth
	const maxX = canvasW - VIEWPORT_BUFFER_PX
	if (minX > maxX) return Math.max(0, (minX + maxX) / 2)
	return Math.max(minX, Math.min(maxX, anchorX))
}

const textAnchorFor = (align: Alignment): TextAnchorSpec =>
	align === "left" ? "start" : align === "right" ? "end" : "middle"

const xForAlignment = (
	align: Alignment,
	left: number,
	right: number
): number => (align === "left" ? left : align === "right" ? right : (left + right) / 2)

/** Compute the per-side global margin floors that hold the SHARED axis
 *  titles. The left floor holds the y-title (lives to the left of the
 *  leftmost column); the bottom floor holds the x-title (lives below
 *  the bottom row). Only panels in the leftmost column / bottom row are
 *  visited, so a tall y-label inside an interior column doesn't inflate
 *  the title-to-plot gap of the leftmost panel (under shareY=ON every
 *  panel sees the full-dataset labels anyway, so the leftmost panel's
 *  labels already represent the widest label — taking the max here vs.
 *  the global max produces the same value). */
/** For a sparse panel list (wrap mode can have an uneven last row), find
 *  the bottom-most filled row per column and leftmost filled col per row.
 *  Used to decide which panels carry the shared X / Y axis when the grid
 *  isn't fully populated — without this, a column whose bottom-most panel
 *  isn't on `row === rows-1` would lose its x-axis entirely.
 *
 *  For grid mode (cross-product), every cell is present so this collapses
 *  to `{rows-1 for every col}` / `{0 for every row}` — same as the old
 *  `p.row === rows-1` / `p.col === 0` checks. */
const computeEdgePositions = (panels: readonly SolverPanelInput[]) => {
	const bottomMostRowPerCol = new Map<number, number>()
	const leftmostColPerRow = new Map<number, number>()
	for (const p of panels) {
		const curBottom = bottomMostRowPerCol.get(p.col)
		if (curBottom == null || p.row > curBottom)
			bottomMostRowPerCol.set(p.col, p.row)
		const curLeft = leftmostColPerRow.get(p.row)
		if (curLeft == null || p.col < curLeft)
			leftmostColPerRow.set(p.row, p.col)
	}
	const rowsNeedingFullBottomChrome = new Set<number>()
	for (const r of bottomMostRowPerCol.values()) rowsNeedingFullBottomChrome.add(r)
	const colsNeedingFullLeftChrome = new Set<number>()
	for (const c of leftmostColPerRow.values()) colsNeedingFullLeftChrome.add(c)
	return {
		bottomMostRowPerCol,
		leftmostColPerRow,
		rowsNeedingFullBottomChrome,
		colsNeedingFullLeftChrome,
	}
}

const estimateGlobalFloors = (
	panels: readonly SolverPanelInput[],
	edges: ReturnType<typeof computeEdgePositions>,
	yTitleHorizontal: boolean,
	yTitleText: string,
	yTitleFontSize: number,
	xTitleText: string,
	xTitleFontSize: number,
	xTitleLineCount: number,
	// The base margins the solver actually reserves per cell (cartesian 76/64,
	// or the collapsed POLAR_MARGIN values). The floor helpers return a delta
	// above these — passing the real base keeps polar modes that still draw a
	// cartesian axis (pies-y left, pies-x bottom) from under-reserving.
	leftBaseMargin: number,
	bottomBaseMargin: number
) => {
	let left = 0
	let bottom = 0
	for (const p of panels) {
		if (p.col === edges.leftmostColPerRow.get(p.row)) {
			const l = estimateExtraLeftMargin({
				yLabels: p.yLabels,
				yLabelFontSize: p.yLabelFontSize,
				yLabelMaxWidthPx: p.yLabelMaxWidthPx,
				yTitleRotated: !yTitleHorizontal,
				yTitleText,
				yTitleFontSize,
				baseMarginPx: leftBaseMargin,
			})
			if (l > left) left = l
		}
		if (p.row === edges.bottomMostRowPerCol.get(p.col)) {
			const b = estimateExtraBottomMargin({
				xLabels: p.xLabels,
				xLabelFontSize: p.xLabelFontSize,
				xLabelAngleDeg: p.xLabelAngleDeg,
				xLabelMaxWidthPx: p.xLabelMaxWidthPx,
				xTitleText,
				xTitleFontSize,
				baseMarginPx: bottomBaseMargin,
				xTitleLineCount,
			})
			if (b > bottom) bottom = b
		}
	}
	return { left, bottom }
}

/** Compute the canvas reserves above/around the plot grid.
 *
 *  - TOP: reserves space for the chart title + subtitle (legacy convention).
 *  - LEFT / BOTTOM / RIGHT: ZERO. Shared x-title and y-title render INSIDE
 *    the cell's BASE_MARGIN.bottom / BASE_MARGIN.left chrome (matches the
 *    legacy Axes component behavior). The chrome is sized to hold both
 *    the tick labels AND the title; `estimateExtraLeftMargin` /
 *    `estimateExtraBottomMargin` grow leftFloor / bottomFloor when the
 *    title text demands more room than the default reserve.
 *
 *  This eliminates the extra whitespace the v1 solver produced — y-title
 *  sat outside BASE_MARGIN.left in its own strip, x-title sat below the
 *  bottom row at canvasH. */
const computeOuterReserves = (
	input: SolverInput,
	cellMargin: CellMargin,
	bottomFloor: number = 0,
	leftFloor: number = 0,
) => {
	const titleHeight = input.chartTitle
		? titleReserve(input.chartTitle.fontSize)
		: 0
	const subtitleHeight = input.chartSubtitle
		? subtitleReserve(input.chartSubtitle.fontSize)
		: 0
	const xTitleLines = input.xTitle ? lineCount(input.xTitle.text) : 0
	// Multiplier 1.4 matches the line-box height the browser actually
	// paints (ascender + descender + leading). 1.2 underestimated and
	// let the descender of larger title fonts poke past the SVG bottom.
	const xTitleHeight = input.xTitle
		? input.xTitle.fontSize * 1.4 * xTitleLines + 6
		: 0
	// Per APPLICATION.md §6.4: title position offsets ASYMMETRICALLY
	// auto-grow the outer reserves. Moving a title AWAY from the plot
	// (negative offsetY for top titles, positive for x-title, negative
	// offsetX for y-title) grows the reserve on that side so the plot
	// shrinks to give the title room; moving TOWARD the plot is a pure
	// shift with no grow (the user can intentionally overlap an axis
	// title with the plot — per spec).
	//
	// Title and subtitle share the top reserve. The grow is the MAX of
	// the two so a single negative offset doesn't double-count, but each
	// title cancels its OWN negative offset below (see title.y / subtitle.y)
	// so they stay at their natural on-canvas position; the plot is what
	// actually moves.
	const titleAwayGrow = input.chartTitle
		? Math.max(0, -(input.chartTitle.offsetY ?? 0))
		: 0
	const subtitleAwayGrow = input.chartSubtitle
		? Math.max(0, -(input.chartSubtitle.offsetY ?? 0))
		: 0
	const topGrow = Math.max(titleAwayGrow, subtitleAwayGrow)
	// LAYOUT.md §8 multi-phase x-title offset.
	// - Positive offsetY (title away from plot): bottomGrow > 0 → plot
	//   shrinks (Phase A — was Bug #5's behavior).
	// - Negative offsetY (title toward plot, then over plot): allow
	//   bottomGrow to be NEGATIVE so the plot's bottom edge extends
	//   DOWN past its natural position (Phase 1). Clamped to
	//   `-extensionRoom` so plot.bottom doesn't pass the viewport
	//   bottom (with VIEWPORT_BUFFER_PX). Past that clamp, additional
	//   negative offsetY moves the title up over the plot (Phase 2),
	//   which emerges automatically from the title.y formula.
	const extensionRoom = Math.max(
		0,
		cellMargin.bottom + bottomFloor - VIEWPORT_BUFFER_PX,
	)
	const rawXTitleOffsetY = input.xTitle?.offsetY ?? 0
	const bottomGrow = input.xTitle
		? Math.max(-extensionRoom, rawXTitleOffsetY)
		: 0
	// LAYOUT.md §8 multi-phase y-title offset (symmetric to x-title).
	// - Negative offsetX (title away from plot, to the left): leftGrow
	//   positive → plot shrinks from left.
	// - Positive offsetX (title toward / over plot): leftGrow can be
	//   negative → plot extends LEFT past natural edge, clamped so
	//   plot.left doesn't pass viewport-left + VIEWPORT_BUFFER_PX.
	const leftExtensionRoom = Math.max(
		0,
		cellMargin.left + leftFloor - VIEWPORT_BUFFER_PX,
	)
	const rawYTitleOffsetX = input.yTitle?.offsetX ?? 0
	const leftGrow = input.yTitle
		? Math.max(-leftExtensionRoom, -rawYTitleOffsetX)
		: 0
	// Grid-mode header strips (Task 1.7). Column headers run across the
	// top above row 0; row headers run down the left of col 0. The bands
	// reserve canvas space ADDITIVELY on top of any other top/left
	// reserves so existing title-offset logic stays intact.
	const columnHeaderBand =
		input.columnHeaders && input.columnHeaders.length > 0
			? (input.columnHeaderHeight ?? 20)
			: 0
	const rowHeaderBand =
		input.rowHeaders && input.rowHeaders.length > 0
			? (input.rowHeaderWidth ?? 80)
			: 0
	// `extraRightMargin` / `extraLeftMargin` reserve room on the right /
	// left for data labels that extend past the plot's natural edge.
	// Right-aligned labels grow LEFT from their anchor (eating into the
	// y-tick label band), so the left reservation matches the right
	// one but in the opposite direction.
	//
	// Title-offset semantics (LAYOUT.md §8): canvas matches the
	// container; the user's offset is interpreted as "shift the
	// plot/title distance". For positive x-title offsetY (title moves
	// away/down), the plot SHRINKS — its bottom edge moves up — while
	// the title stays at its natural screen position. We accomplish
	// this by adding `bottomGrow` to `outerReserves.bottom`, which
	// subtracts from inner.height in the main solver.
	return {
		top: titleHeight + subtitleHeight + topGrow + columnHeaderBand,
		bottom: bottomGrow + (input.extraBottomMargin ?? 0),
		left: leftGrow + (input.extraLeftMargin ?? 0) + rowHeaderBand,
		right: input.extraRightMargin ?? 0,
		titleHeight,
		subtitleHeight,
		xTitleHeight,
		xTitleLines,
		titleAwayGrow,
		subtitleAwayGrow,
		topGrow,
		bottomGrow,
		leftGrow,
		columnHeaderBand,
		rowHeaderBand,
	}
}

/** Resolve total chrome per cell side. Three regimes:
 *  - Bottom row / leftmost column: full margin (BASE_MARGIN + floor) because
 *    these rows/cols hold the shared axis title plus their own ticks+labels.
 *  - Interior + shared: small SHARED_INTERIOR_AXIS_RESERVE (axis spine only).
 *  - Interior + un-shared: just enough room for ticks + tick labels — NO
 *    title space, since the shared title is reserved by the edge row/col. */
const cellMargins = (
	row: number,
	col: number,
	_rows: number,
	_cols: number,
	shareX: boolean,
	shareY: boolean,
	facetLabelHeight: number,
	leftFloor: number,
	bottomFloor: number,
	interiorBottomChromePerRow: readonly number[],
	interiorLeftChromePerCol: readonly number[],
	edges: ReturnType<typeof computeEdgePositions>,
	cellMargin: CellMargin
): { top: number; right: number; bottom: number; left: number } => {
	// Chrome is uniform across each row (height) and each col (width) so
	// cells stay regular. A row carries full bottom chrome whenever ANY
	// column's bottom-most-filled panel lands on it (e.g. uneven wrap
	// where row 3 col 1 is the last filled panel of col 1 but row 4 col
	// 0 still exists for col 0 — both rows 3 and 4 carry the axis).
	const rowCarriesBottomAxis = edges.rowsNeedingFullBottomChrome.has(row)
	const colCarriesLeftAxis = edges.colsNeedingFullLeftChrome.has(col)
	const top = facetLabelHeight + cellMargin.top
	const right = cellMargin.right
	const bottom = rowCarriesBottomAxis
		? cellMargin.bottom + bottomFloor
		: shareX
			? SHARED_INTERIOR_AXIS_RESERVE
			: (interiorBottomChromePerRow[row] ?? 0)
	const left = colCarriesLeftAxis
		? cellMargin.left + leftFloor
		: shareY
			? SHARED_INTERIOR_AXIS_RESERVE
			: (interiorLeftChromePerCol[col] ?? 0)
	return { top, right, bottom, left }
}

/** Compute per-column inner widths and per-row inner heights. With
 *  uniform weights (the proportionalSizing=false case), every column gets
 *  the same width and every row gets the same height — identical to the
 *  previous solver behavior.
 *
 *  Under proportional sizing, available inner width is distributed across
 *  columns in proportion to each column's `colWeight` (the max xWeight
 *  among panels in that column); height across rows in proportion to
 *  `rowWeight`. This makes per-category spacing consistent across panels
 *  even when they have different category counts.
 *
 *  Chrome (the BASE_MARGIN + leftFloor/bottomFloor reserves around each
 *  cell's plot rect) is subtracted FIRST, so weights govern the *inner*
 *  rect distribution — every column reserves the same per-side chrome
 *  regardless of how wide its plot rect ends up.
 *
 *  Negative gaps (ridgeline overlap, LAYOUT.md §10): once a gap turns
 *  negative the panel SIZE freezes at its gap=0 value. The negative
 *  gap then drives cumulative cell-position overlap (see
 *  `cellYForRow` / `cellXForCol`) WITHOUT inflating the per-panel
 *  height/width. Previously a more-negative gap also grew the panel
 *  ("gives back space"), which produced odd visual proportions as the
 *  user dragged the gap slider further negative. */
const computeInnerDimsArrays = (
	innerGrid: { width: number; height: number },
	rows: number,
	cols: number,
	gapX: number,
	gapY: number,
	shareX: boolean,
	shareY: boolean,
	facetLabelHeight: number,
	leftFloor: number,
	bottomFloor: number,
	interiorBottomChromePerRow: readonly number[],
	interiorLeftChromePerCol: readonly number[],
	colWeights: readonly number[],
	rowWeights: readonly number[],
	edges: ReturnType<typeof computeEdgePositions>,
	cellMargin: CellMargin,
	panelWidthOverride?: number | null,
	panelHeightOverride?: number | null
): { innerWidths: number[]; innerHeights: number[] } => {
	// Per-column horizontal chrome. A col contributes full left chrome
	// (BASE_MARGIN.left + leftFloor) whenever ANY row would put a
	// leftmost-filled panel here; otherwise interior chrome. For grid
	// mode (fully populated) this reduces to "col 0 = full, others =
	// interior" — same as before. For wrap with uneven rows it lets an
	// interior column carry y-axis chrome when its row's left edge
	// shifted into it.
	let totalHorizChrome = 0
	for (let c = 0; c < cols; c++) {
		const carriesLeftAxis = edges.colsNeedingFullLeftChrome.has(c)
		const leftChrome = carriesLeftAxis
			? cellMargin.left + leftFloor
			: shareY
				? SHARED_INTERIOR_AXIS_RESERVE
				: (interiorLeftChromePerCol[c] ?? 0)
		totalHorizChrome += leftChrome + cellMargin.right
	}
	// LAYOUT.md §10: clamp negative gaps to 0 when sizing panels, so
	// panels stay the SAME width they'd be at gap=0 once we cross into
	// overlap territory. The cumulative overlap is applied at cell-
	// positioning time (`cellXForCol` / `cellYForRow`), not here.
	const horizGapsForSizing = Math.max(0, gapX) * (cols - 1)
	const availableInnerW = innerGrid.width - totalHorizChrome - horizGapsForSizing
	const colWeightSum =
		colWeights.reduce((a, b) => a + b, 0) || cols || 1
	// Pixel override (LAYOUT.md §10b): when the user has explicitly
	// specified an inner width per panel, EVERY col gets that exact
	// width — proportional and equal-split distributions are both
	// bypassed. The caller (estimateNaturalDims / canvasH) ensures the
	// canvas is wide enough.
	const innerWidths: number[] =
		panelWidthOverride != null && panelWidthOverride > 0
			? new Array(cols).fill(Math.max(0, panelWidthOverride))
			: colWeights.map((w) =>
					Math.max(0, availableInnerW * (w / colWeightSum)),
				)

	// Per-row vertical chrome. Three regimes (see cellMargins): bottom row
	// gets full chrome; interior+shareX gets a tiny spine reserve;
	// interior+!shareX gets just ticks+labels (no title space, sized to
	// that row's actual labels).
	const facetBand = facetLabelHeight + cellMargin.top
	let totalVertChrome = 0
	for (let r = 0; r < rows; r++) {
		// A row contributes full bottom chrome whenever it's the last
		// filled row in any column — that panel needs the title's
		// reserve plus its own ticks/labels. Falls through to interior
		// chrome for fully-interior rows.
		const carriesBottomAxis = edges.rowsNeedingFullBottomChrome.has(r)
		const bottomChrome = carriesBottomAxis
			? cellMargin.bottom + bottomFloor
			: shareX
				? SHARED_INTERIOR_AXIS_RESERVE
				: (interiorBottomChromePerRow[r] ?? 0)
		totalVertChrome += facetBand + bottomChrome
	}
	const vertGapsForSizing = Math.max(0, gapY) * (rows - 1)
	const availableInnerH = innerGrid.height - totalVertChrome - vertGapsForSizing
	const rowWeightSum =
		rowWeights.reduce((a, b) => a + b, 0) || rows || 1
	const innerHeights: number[] =
		panelHeightOverride != null && panelHeightOverride > 0
			? new Array(rows).fill(Math.max(0, panelHeightOverride))
			: rowWeights.map((w) =>
					Math.max(0, availableInnerH * (w / rowWeightSum)),
				)

	return { innerWidths, innerHeights }
}

/** Sum of cell widths up to (but not including) `col`, then optionally
 *  plus visible gaps and cumulative negative gap (ridgeline). */
const cellXForCol = (
	col: number,
	cellWidths: readonly number[],
	gapX: number
): number => {
	let x = 0
	for (let i = 0; i < col; i++) {
		x += cellWidths[i] + gapX
	}
	return x
}

const cellYForRow = (
	row: number,
	cellHeights: readonly number[],
	gapY: number
): number => {
	let y = 0
	for (let i = 0; i < row; i++) {
		y += cellHeights[i] + gapY
	}
	return y
}

/** Estimate the natural canvas dims demanded by proportional sizing or
 *  the NONPROPORTIONAL_MIN_PX floor. Used to drive scroll emission. */
const estimateNaturalDims = (
	input: SolverInput,
	outerReserves: { top: number; bottom: number; left: number; right: number },
	leftFloor: number,
	bottomFloor: number,
	facetLabelHeight: number,
	cellMargin: CellMargin
): { width: number; height: number } => {
	const cols = input.cols
	const rows = input.rows
	const minPanelPx = input.minPanelPx ?? DEFAULT_MIN_PANEL_PX
	const minPxPerCat = input.minPxPerCategory ?? DEFAULT_MIN_PX_PER_CATEGORY
	// Per-cell horizontal chrome (using leftmost-col chrome as a floor —
	// scroll computation is a worst-case sizing).
	const horizChrome = cellMargin.left + leftFloor + cellMargin.right
	const vertChrome =
		facetLabelHeight + cellMargin.top + cellMargin.bottom + bottomFloor
	// Natural inner widths/heights, per cell. Axis-aware: x weights only
	// influence width, y weights only influence height. The max across all
	// panels is what determines the per-cell floor (every cell reserves
	// enough room for the heaviest panel on each axis — actual cell sizes
	// can then differ within that envelope via colWeights/rowWeights).
	const xWeights = input.panels.map((p) => Math.max(1, p.xWeight))
	const yWeights = input.panels.map((p) => Math.max(1, p.yWeight))
	const maxXWeight = xWeights.length > 0 ? Math.max(...xWeights) : 1
	const maxYWeight = yWeights.length > 0 ? Math.max(...yWeights) : 1
	const weightedInnerW = maxXWeight * minPxPerCat
	const weightedInnerH = maxYWeight * minPxPerCat
	// When scroll mode is on (minPanelPx > 0), enforce BOTH the per-panel
	// floor (so panels don't shrink below illegibility) AND the per-category
	// floor (so a non-faceted chart with many categories also scrolls).
	// Without the weighted contribution, a single-panel bars-y with 50
	// activities would squish them all into ~600px of vertical space.
	const naturalInnerW = Math.max(0, minPanelPx - horizChrome, weightedInnerW)
	const naturalInnerH = Math.max(0, minPanelPx - vertChrome, weightedInnerH)
	const naturalCellW = naturalInnerW + horizChrome
	const naturalCellH = naturalInnerH + vertChrome
	// FIT MODE: when minPanelPx == 0 the caller has opted in to "shrink
	// panels to fit the container; never emit scroll". Return zeros so
	// canvasW/canvasH collapse to the container dimensions (cells get
	// whatever space is left, however small).
	//
	// PIXEL OVERRIDES: when the user has specified `panelWidthOverride`
	// or `panelHeightOverride`, that fixed inner size REPLACES the
	// natural-cell floor so the canvas grows to honor the override even
	// in fit mode. Otherwise a user typing "300" into Panel width on a
	// 4-col layout in a narrow container would have their override
	// silently compressed.
	const fitMode = minPanelPx === 0
	const widthOverride = input.panelWidthOverride
	const heightOverride = input.panelHeightOverride
	const overrideCellW =
		widthOverride != null && widthOverride > 0
			? widthOverride + horizChrome
			: 0
	const overrideCellH =
		heightOverride != null && heightOverride > 0
			? heightOverride + vertChrome
			: 0
	// Use the real gap (including negative) so ridgeline mode doesn't
	// over-grow the canvas. With gapY=-40 and 3 rows of 200px cells, the
	// last cell's BOTTOM sits at 3*200 + 2*-40 = 520, not 600. Using
	// `max(0, gap)` would overestimate by 80px → canvas exceeds container
	// → scrollbar appears even though the ridgeline visually fits.
	//
	// When the gap is NEGATIVE (ridgeline), the user has explicitly opted
	// into overlap; cells should compress to fit the container rather
	// than enforcing minPanelPx and emitting scroll. Suppress the natural
	// floor for the affected dimension.
	const naturalGridW =
		fitMode || input.gapX < 0
			? 0
			: Math.max(naturalCellW, cols * naturalCellW + (cols - 1) * input.gapX)
	const naturalGridH =
		fitMode || input.gapY < 0
			? 0
			: Math.max(naturalCellH, rows * naturalCellH + (rows - 1) * input.gapY)
	// When the user has specified pixel-precise panel dimensions, the
	// canvas MUST grow to honor them (even in fit mode). Take the
	// override-driven grid as a separate floor and use the larger.
	const gridFromOverrideW =
		overrideCellW > 0
			? cols * overrideCellW + (cols - 1) * Math.max(0, input.gapX)
			: 0
	const gridFromOverrideH =
		overrideCellH > 0
			? rows * overrideCellH + (rows - 1) * Math.max(0, input.gapY)
			: 0
	const finalGridW = Math.max(naturalGridW, gridFromOverrideW)
	const finalGridH = Math.max(naturalGridH, gridFromOverrideH)
	return {
		width: finalGridW + outerReserves.left + outerReserves.right,
		height: finalGridH + outerReserves.top + outerReserves.bottom,
	}
}

/** The big one. Pure function: SolverInput → FacetLayoutSpec. */
export const solveFacetLayout = (rawInput: SolverInput): FacetLayoutSpec => {
	// Fixed aspect ratio: RATIO WINS (see SolverInput.aspectRatio). Shadow
	// the input once so every downstream reader — including
	// estimateNaturalDims — sees the pixel overrides, proportional flags,
	// and scroll-mode panel minimums (a shrunk-to-ratio panel can't honor
	// them; fit mode avoids scrolling over blank canvas) already
	// neutralized.
	const aspectRatio =
		rawInput.aspectRatio != null && rawInput.aspectRatio > 0
			? rawInput.aspectRatio
			: null
	const input =
		aspectRatio != null
			? {
					...rawInput,
					panelWidthOverride: null,
					panelHeightOverride: null,
					proportionalSizing: false,
					minPanelPx: 0,
				}
			: rawInput
	const facetLabelHeight = input.facetLabel?.height ?? 0
	const yTitleHorizontal = input.yTitle?.horizontal ?? false
	const yTitleText = input.yTitle?.text ?? ""
	const yTitleFontSize = input.yTitle?.fontSize ?? 0
	const xTitleText = input.xTitle?.text ?? ""
	const xTitleFontSize = input.xTitle?.fontSize ?? 0
	const xTitleLines = xTitleText ? lineCount(xTitleText) : 0

	// Per-side cell chrome. Polar modes (radar / pie) drop to a tight
	// `POLAR_MARGIN` because there's no cartesian axis chrome to reserve —
	// the renderer lays out angle / r ticks inside the inner rect with
	// its own perimeter padding. Sides that still carry a SHARED axis
	// title (pies-x bottom, pies-y left) keep the cartesian reserve so
	// the title has room to render — resolved per-side here.
	const isPolarMode = input.isPolar === true
	const cellMargin: CellMargin = {
		top: isPolarMode ? POLAR_MARGIN.top : BASE_MARGIN.top,
		right: isPolarMode ? POLAR_MARGIN.right : BASE_MARGIN.right,
		bottom:
			isPolarMode && !input.xTitle ? POLAR_MARGIN.bottom : BASE_MARGIN.bottom,
		left:
			isPolarMode && !input.yTitle ? POLAR_MARGIN.left : BASE_MARGIN.left,
	}

	const edges = computeEdgePositions(input.panels)

	const { left: estimatedLeftFloor, bottom: bottomFloor } =
		estimateGlobalFloors(
			input.panels,
			edges,
			yTitleHorizontal,
			yTitleText,
			yTitleFontSize,
			xTitleText,
			xTitleFontSize,
			xTitleLines,
			cellMargin.left,
			cellMargin.bottom
		)

	// Tick+label chrome (no title space) for interior rows/cols when an
	// axis isn't shared. Each panel renders its own x-axis ticks+labels
	// but the shared title lives in the bottom row's reserve, not the
	// interior rows'.
	//
	// Per-column / per-row, not a single global max: a wide-label panel in
	// one column shouldn't inflate the chrome of an unrelated column with
	// short labels. In a column with multiple panels (e.g. 2×4 grid) we
	// still take the max within the column so the y-axis spines stay
	// aligned vertically. Mirror logic for rows.
	const interiorBottomChromePerRow: number[] = []
	for (let r = 0; r < input.rows; r++) {
		let max = 0
		for (const p of input.panels) {
			if (p.row !== r) continue
			const v = estimateInteriorBottomChrome({
				xLabels: p.xLabels,
				xLabelFontSize: p.xLabelFontSize,
				xLabelAngleDeg: p.xLabelAngleDeg,
				xLabelMaxWidthPx: p.xLabelMaxWidthPx,
			})
			if (v > max) max = v
		}
		interiorBottomChromePerRow.push(max)
	}
	const interiorLeftChromePerCol: number[] = []
	for (let c = 0; c < input.cols; c++) {
		let max = 0
		for (const p of input.panels) {
			if (p.col !== c) continue
			const v = estimateInteriorLeftChrome({
				yLabels: p.yLabels,
				yLabelFontSize: p.yLabelFontSize,
				yLabelMaxWidthPx: p.yLabelMaxWidthPx,
			})
			if (v > max) max = v
		}
		interiorLeftChromePerCol.push(max)
	}

	// Tick-font sizes used by both leftFloor adjustment (here) and the
	// title-position math (later in this function). Inputs arrive in px
	// (already pt→px resolved); the fallback mirrors the base text default
	// (12pt → 16px, lib/fontUnit).
	const xTickFontSize = input.panels[0]?.xLabelFontSize ?? 16
	const yTickFontSize = input.panels[0]?.yLabelFontSize ?? 16
	// The y-title sits to the left of the LEFTMOST column, so its gap to
	// the plot is sized by that column's labels — not by a long label
	// hiding in an interior column the title doesn't sit next to.
	const longestYLabelChars = (() => {
		let max = 0
		for (const p of input.panels) {
			if (p.col !== 0) continue
			// Wrapped labels arrive `\n`-joined; their rendered width is the
			// widest LINE, so count per line rather than the joined string.
			for (const l of p.yLabels)
				for (const line of l.split("\n"))
					if (line.length > max) max = line.length
		}
		return max
	})()
	// Prefer the caller's pre-measured (canvas measureText) width when
	// provided — accurate label widths put the y-title at exactly
	// `TITLE_LABEL_GAP_PX` from the rendered label edge. The 0.55-char
	// estimate is 20-30% over for narrow fonts (DM Sans, Inter, etc.)
	// and the slop manifested as a "weird gap" between title and labels.
	const measuredYLabelMaxPx = (() => {
		let max = 0
		for (const p of input.panels) {
			if (p.col !== 0) continue
			if (p.yLabelMaxWidthPx != null && p.yLabelMaxWidthPx > max) {
				max = p.yLabelMaxWidthPx
			}
		}
		return max
	})()
	const longestYLabelPx =
		measuredYLabelMaxPx > 0
			? measuredYLabelMaxPx
			: longestYLabelChars * yTickFontSize * 0.55 + 4
	// Axis-title positioning is RELATIVE to the tick labels on that axis:
	// the title defaults to a fixed gap from the labels' edge, so the
	// title's absolute position floats outward as labels get longer.
	// `TITLE_LABEL_GAP_PX` is that gap.
	//
	// Y-title geometry differs by orientation:
	//   - Rotated  (-90°, anchor=middle): title's horizontal extent is
	//     ±titleFontSize/2 around its anchor, so the anchor sits
	//     titleFontSize/2 deeper than the gap requirement.
	//   - Horizontal (anchor=end): title's RIGHT edge IS its anchor (text
	//     extends LEFT from there), so no extra extent to account for.
	//
	// X-title is always horizontal (anchor=middle, y=baseline). Title's
	// TOP edge ≈ y - titleFontSize, and labels extend below the axis by
	// `tickFontSize` past the tick-line pad.
	const TITLE_LABEL_GAP_PX = 25
	const TICK_LINE_PAD = 6
	const yTitleGap = input.yTitle
		? Math.max(
				// Floor for very short labels — keeps the title from sitting
				// directly on the plot edge.
				24 + yTitleFontSize / 2,
				input.yTitle.horizontal
					? longestYLabelPx + TICK_LINE_PAD + TITLE_LABEL_GAP_PX
					: longestYLabelPx +
							TICK_LINE_PAD +
							TITLE_LABEL_GAP_PX +
							yTitleFontSize / 2
			)
		: 0
	// The x-title sits below the BOTTOM row, so the xTitleGap is sized
	// from THAT row's x-tick labels — same logic as yTitleGap above.
	// The vertical extent depends on rotation: horizontal (0°) is just
	// `fontSize × 1.4`; rotated labels are `labelWidth × |sin| +
	// fontSize × 1.4 × |cos|` — much taller. xTitleGap must clear this.
	const longestXLabelPx = (() => {
		let measuredMax = 0
		for (const p of input.panels) {
			if (p.row !== input.rows - 1) continue
			if (p.xLabelMaxWidthPx != null && p.xLabelMaxWidthPx > measuredMax) {
				measuredMax = p.xLabelMaxWidthPx
			}
		}
		if (measuredMax > 0) return measuredMax
		let maxChars = 0
		for (const p of input.panels) {
			if (p.row !== input.rows - 1) continue
			// Widest LINE — wrapped labels are `\n`-joined multi-line strings.
			for (const l of p.xLabels)
				for (const line of l.split("\n"))
					if (line.length > maxChars) maxChars = line.length
		}
		return maxChars * xTickFontSize * 0.55 + 4
	})()
	const xLabelAngleDegMax = (() => {
		let maxAbs = 0
		for (const p of input.panels) {
			if (p.row !== input.rows - 1) continue
			const a = Math.abs(p.xLabelAngleDeg)
			if (a > maxAbs) maxAbs = a
		}
		return maxAbs
	})()
	const xLabelVerticalPx = (() => {
		const rad = (xLabelAngleDegMax * Math.PI) / 180
		const sin = Math.abs(Math.sin(rad))
		const cos = Math.abs(Math.cos(rad))
		// Wrapped labels stack lines — the horizontal component of the
		// reserve is one line-box per line, mirroring
		// `estimateExtraBottomMargin`.
		let maxLines = 1
		for (const p of input.panels) {
			if (p.row !== input.rows - 1) continue
			for (const l of p.xLabels) {
				const n = l.split("\n").length
				if (n > maxLines) maxLines = n
			}
		}
		return longestXLabelPx * sin + xTickFontSize * 1.4 * maxLines * cos
	})()
	const xTitleGap = input.xTitle
		? TICK_LINE_PAD + xLabelVerticalPx + TITLE_LABEL_GAP_PX + input.xTitle.fontSize
		: 0

	// `estimateExtraLeftMargin` doesn't know about the extended yTitleGap
	// formula; for long labels it can leave plotLeft too close to the canvas
	// left edge, pushing the title against (or past) the edge. Bump
	// leftFloor so the title's center is at least MIN_TITLE_X from the edge.
	const MIN_TITLE_X = 12 + yTitleFontSize / 2
	const requiredLeftFloor = input.yTitle
		? Math.max(0, MIN_TITLE_X + yTitleGap - cellMargin.left)
		: 0
	const leftFloor = Math.max(estimatedLeftFloor, requiredLeftFloor)

	const outerReservesInitial = computeOuterReserves(
		input,
		cellMargin,
		bottomFloor,
		leftFloor,
	)

	// LAYOUT.md §8 Phase 3 detection: when an extreme title offset would
	// push the title past the buffer at the OPPOSITE canvas edge, the
	// plot should also shrink from THAT edge so title + plot stay
	// visually separated. We compute the approximation against
	// `containerHeight`/`containerWidth` (exact for fit mode; slightly
	// over-shrinks in scroll mode, which just adds a small amount of
	// whitespace — acceptable). The phase3 grows are added to the
	// corresponding outerReserves edges below.
	const approxCanvasH = Math.max(
		input.containerHeight,
		outerReservesInitial.top +
			outerReservesInitial.bottom +
			facetLabelHeight +
			cellMargin.top +
			cellMargin.bottom +
			20,
	)
	const approxCanvasW = Math.max(
		input.containerWidth,
		outerReservesInitial.left + cellMargin.left + cellMargin.right + 20,
	)
	// For x-title: desired y = approxPlotBottom + xTitleGap + offsetY.
	// If desired y < VIEWPORT_BUFFER + ascender, the title would clamp
	// to the top — the excess becomes phase3 topGrow.
	const approxPlotBottom =
		approxCanvasH -
		outerReservesInitial.bottom -
		(cellMargin.bottom + bottomFloor)
	const xTitleAscender = (input.xTitle?.fontSize ?? 0) * 0.8
	const xTitleViewportTopMin = VIEWPORT_BUFFER_PX + xTitleAscender
	const xTitleDesiredY =
		approxPlotBottom + xTitleGap + (input.xTitle?.offsetY ?? 0)
	const phase3TopGrowFromXTitle = input.xTitle
		? Math.max(0, xTitleViewportTopMin - xTitleDesiredY)
		: 0

	// For y-title (rotated): desired anchor.x = approxPlotLeft - yTitleGap + offsetX.
	// Rotated title's bbox right = anchor.x + fontSize/2. If that >
	// canvasW - VIEWPORT_BUFFER_PX, the title would clamp to right →
	// excess becomes phase3 rightGrow.
	const approxPlotLeft =
		outerReservesInitial.left + cellMargin.left + leftFloor
	const yTitleHalfBbox = (input.yTitle?.fontSize ?? 0) / 2
	const yTitleDesiredAnchor =
		approxPlotLeft - yTitleGap + (input.yTitle?.offsetX ?? 0)
	const yTitleDesiredRightEdge = yTitleDesiredAnchor + yTitleHalfBbox
	const yTitleViewportRightMax = approxCanvasW - VIEWPORT_BUFFER_PX
	const phase3RightGrowFromYTitle = input.yTitle
		? Math.max(0, yTitleDesiredRightEdge - yTitleViewportRightMax)
		: 0

	// Continuous x-axes anchor their last tick at the plot's right edge, and
	// the tick label is centered on it — so ~half the label width spills past
	// `inner.x1`. The per-cell right chrome is only `cellMargin.right`
	// (BASE_MARGIN.right = 24), which a wide label like "$140,000" overruns,
	// clipping its last character. Reserve the overhang beyond that chrome so
	// the plot shrinks (fit mode) enough for the label to render fully.
	// Bottom-row panels only — interior rows don't draw x-axis labels under
	// shareX.
	const xTickRightOverhang = (() => {
		let maxOverhang = 0
		for (const p of input.panels) {
			if (p.row !== input.rows - 1) continue
			if (!p.xAxisContinuous) continue
			const w = p.xLabelMaxWidthPx ?? 0
			if (w <= 0) continue
			// How far the edge label reaches RIGHT of its tick. Unrotated
			// labels are middle-anchored → half the width. Negative-angle
			// labels are end-anchored (lean up-left, away from the right edge)
			// → no right overhang. Positive-angle labels are start-anchored
			// (lean down-right) → their full horizontal projection extends
			// right. Mirrors the anchor logic in Axes.tsx.
			const angle = p.xLabelAngleDeg
			const rightExtentRaw =
				angle === 0
					? w / 2
					: angle < 0
						? 0
						: w * Math.abs(Math.cos((angle * Math.PI) / 180))
			// A couple px of breathing room so the reserve never lands
			// exactly on the last glyph's edge — measureText excludes the
			// trailing side bearing, and subpixel/antialiased rendering can
			// otherwise still nibble the final character.
			const rightExtent = rightExtentRaw > 0 ? rightExtentRaw + 3 : 0
			const overhang = Math.max(0, rightExtent - cellMargin.right)
			if (overhang > maxOverhang) maxOverhang = overhang
		}
		return maxOverhang
	})()

	const outerReserves = {
		...outerReservesInitial,
		top: outerReservesInitial.top + phase3TopGrowFromXTitle,
		// Take the max, not the sum: the data-label reserve, the y-title
		// phase-3 grow, and the x-tick overhang all reserve canvas space to
		// the RIGHT of the grid, so the largest single demand covers them all.
		right: Math.max(
			outerReservesInitial.right + phase3RightGrowFromYTitle,
			xTickRightOverhang,
		),
	}

	// Floor canvas dims: unmeasured (0×0) renders shouldn't compute negative
	// inner rects. Mirror the floors in computePlotLayout: just-above margin
	// sum so the panel renders an empty plot rather than crashing.
	const minCanvasW = outerReserves.left + cellMargin.left + cellMargin.right + 20
	const minCanvasH =
		outerReserves.top +
		outerReserves.bottom +
		facetLabelHeight +
		cellMargin.top +
		cellMargin.bottom +
		20

	// Natural dims: if container is too small to honor minPanelPx etc., the
	// canvas grows beyond container and scroll is emitted.
	const natural = estimateNaturalDims(
		input,
		outerReserves,
		leftFloor,
		bottomFloor,
		facetLabelHeight,
		cellMargin
	)
	// `let` so we can grow these for ridgeline-overflow later (after we
	// know how far above the natural top reserve the cumulative cells
	// would render). The final `scroll` decision is made after that
	// adjustment.
	//
	// Label-overlap canvas floor: under proportionalSizing, each row's inner
	// height is distributed by yWeight. If the available inner is too small,
	// a panel with many y-categories renders tick labels on top of each
	// other. We compute the minimum canvas height that gives every row at
	// least `rowMaxYLabels × lineHeight` of inner — the actual line-box
	// height of one tick label, NOT a comfortable-spacing default. Mirror
	// for x-axis labels → width (using the widest x-tick label).
	//
	// SCROLL MODE ONLY. These floors grow the canvas beyond the container,
	// which surfaces a scrollbar — and scroll is opt-in via the Aesthetics
	// "Allow scrolling" toggle (minPanelPx > 0). In the default fit mode
	// the user has chosen "shrink to fit, let labels bunch up and be
	// crowded", so the floors must stay out of the way.
	const scrollFloorsActive =
		input.proportionalSizing &&
		(input.minPanelPx ?? DEFAULT_MIN_PANEL_PX) > 0
	const labelOverlapCanvasH = scrollFloorsActive
		? (() => {
				let requiredInner = 0
				for (let r = 0; r < input.rows; r++) {
					let rowRequired = 0
					for (const p of input.panels) {
						if (p.row !== r) continue
						const lineHeight = p.yLabelFontSize * 1.4
						const need = p.yLabels.length * lineHeight
						if (need > rowRequired) rowRequired = need
					}
					requiredInner += rowRequired
				}
				let totalChrome = 0
				for (let r = 0; r < input.rows; r++) {
					const isBottomRow = r === input.rows - 1
					const facetBand = facetLabelHeight + cellMargin.top
					const bottomChrome = isBottomRow
						? cellMargin.bottom + bottomFloor
						: input.shareX
							? SHARED_INTERIOR_AXIS_RESERVE
							: (interiorBottomChromePerRow[r] ?? 0)
					totalChrome += facetBand + bottomChrome
				}
				const totalGaps = Math.max(0, input.gapY) * (input.rows - 1)
				return (
					requiredInner +
					totalChrome +
					totalGaps +
					outerReserves.top +
					outerReserves.bottom
				)
			})()
		: 0
	const labelOverlapCanvasW = scrollFloorsActive
		? (() => {
				let requiredInner = 0
				for (let c = 0; c < input.cols; c++) {
					let colRequired = 0
					for (const p of input.panels) {
						if (p.col !== c) continue
						// Horizontal label overlap: each label takes
						// approximately its rendered width when unrotated.
						// Rotated labels overlap when their vertical
						// projection collides, which is much smaller —
						// only the unrotated case really threatens overlap.
						const labelW = p.xLabelMaxWidthPx ?? p.xLabelFontSize * 0.55 * 4
						const need = p.xLabels.length * labelW
						if (need > colRequired) colRequired = need
					}
					requiredInner += colRequired
				}
				let totalChrome = 0
				for (let c = 0; c < input.cols; c++) {
					const isLeftCol = c === 0
					const leftChrome = isLeftCol
						? cellMargin.left + leftFloor
						: input.shareY
							? SHARED_INTERIOR_AXIS_RESERVE
							: (interiorLeftChromePerCol[c] ?? 0)
					totalChrome += leftChrome + cellMargin.right
				}
				const totalGaps = Math.max(0, input.gapX) * (input.cols - 1)
				return (
					requiredInner +
					totalChrome +
					totalGaps +
					outerReserves.left +
					outerReserves.right
				)
			})()
		: 0
	let canvasW = Math.max(
		input.containerWidth,
		natural.width,
		minCanvasW,
		labelOverlapCanvasW
	)
	let canvasH = Math.max(
		input.containerHeight,
		natural.height,
		minCanvasH,
		labelOverlapCanvasH
	)

	// Inner grid (what's left after outer reserves are taken).
	const innerGrid = {
		width: canvasW - outerReserves.left - outerReserves.right,
		height: canvasH - outerReserves.top - outerReserves.bottom,
	}

	// Per-column / per-row proportional-sizing weights. Under
	// proportionalSizing the available inner space is distributed across
	// columns/rows in proportion to these. Under uniform sizing every
	// weight collapses to 1, restoring the original equal-split behavior.
	//
	// share-axes × proportional interaction: the caller (PlotCanvas) is
	// responsible for feeding the solver weights derived from the FULL
	// dataset rows on whichever axis is shared. That makes xWeight /
	// yWeight identical across all panels for the shared axis, so
	// colWeights / rowWeights become naturally uniform — no special
	// case here. This means proportional + share-axes "Just Works"
	// without solver-side branching: the share-axes flag drives both
	// scale construction (full-dataset rows) AND weight construction
	// (full-dataset rows) in PlotCanvas, and the solver only sees the
	// resulting numbers. (LAYOUT.md §6.)
	//
	// `WEIGHT_EPSILON` keeps a single all-zero column from making the
	// total weight sum zero (would divide-by-zero downstream).
	// We DON'T floor to 1: that silently flattens sub-1 quant ranges
	// (size-by-unit on data like Value 0.01–0.25) into uniform widths.
	const WEIGHT_EPSILON = 1e-9
	const colWeights: number[] = []
	for (let c = 0; c < input.cols; c++) {
		if (!input.proportionalSizing) {
			colWeights.push(1)
			continue
		}
		let max = 0
		for (const p of input.panels) {
			if (p.col === c && p.xWeight > max) max = p.xWeight
		}
		colWeights.push(max > 0 ? max : WEIGHT_EPSILON)
	}
	const rowWeights: number[] = []
	for (let r = 0; r < input.rows; r++) {
		if (!input.proportionalSizing) {
			rowWeights.push(1)
			continue
		}
		let max = 0
		for (const p of input.panels) {
			if (p.row === r && p.yWeight > max) max = p.yWeight
		}
		rowWeights.push(max > 0 ? max : WEIGHT_EPSILON)
	}

	const { innerWidths, innerHeights } = computeInnerDimsArrays(
		innerGrid,
		input.rows,
		input.cols,
		input.gapX,
		input.gapY,
		input.shareX,
		input.shareY,
		facetLabelHeight,
		leftFloor,
		bottomFloor,
		interiorBottomChromePerRow,
		interiorLeftChromePerCol,
		colWeights,
		rowWeights,
		edges,
		cellMargin,
		input.panelWidthOverride,
		input.panelHeightOverride
	)
	const safeInnerWidths = innerWidths.map((w) => Math.max(0, w))
	const safeInnerHeights = innerHeights.map((h) => Math.max(0, h))

	// Fixed aspect ratio: shrink the larger dimension so every panel's
	// inner rect satisfies height/width = aspectRatio. Arrays are uniform
	// here (overrides nulled + proportionalSizing forced off above), so
	// constraining index 0 and filling is exact.
	if (aspectRatio != null) {
		const w = safeInnerWidths[0] ?? 0
		const h = safeInnerHeights[0] ?? 0
		if (w > 0 && h > 0) {
			if (w * aspectRatio <= h) safeInnerHeights.fill(w * aspectRatio)
			else safeInnerWidths.fill(h / aspectRatio)
		}
	}

	// Per-cell widths/heights derive from inner + chrome (varies between
	// edge and interior cells under sharing).
	const cellWidths: number[] = []
	for (let c = 0; c < input.cols; c++) {
		const m = cellMargins(
			0,
			c,
			input.rows,
			input.cols,
			input.shareX,
			input.shareY,
			facetLabelHeight,
			leftFloor,
			bottomFloor,
			interiorBottomChromePerRow,
			interiorLeftChromePerCol,
			edges,
			cellMargin
		)
		cellWidths.push((safeInnerWidths[c] ?? 0) + m.left + m.right)
	}
	const cellHeights: number[] = []
	for (let r = 0; r < input.rows; r++) {
		const m = cellMargins(
			r,
			0,
			input.rows,
			input.cols,
			input.shareX,
			input.shareY,
			facetLabelHeight,
			leftFloor,
			bottomFloor,
			interiorBottomChromePerRow,
			interiorLeftChromePerCol,
			edges,
			cellMargin
		)
		cellHeights.push((safeInnerHeights[r] ?? 0) + m.top + m.bottom)
	}

	// Fixed aspect ratio: the shrink (above) freed inner-grid space. Center
	// the grid in it — shift the origin by half the slack per axis. The
	// used extent is the span from the first cell's origin to the last
	// cell's far edge, with SIGNED gaps (ridgeline overlap shortens it).
	let figureSlackX = 0
	let figureSlackY = 0
	if (aspectRatio != null && input.cols > 0 && input.rows > 0) {
		const usedW =
			cellXForCol(input.cols - 1, cellWidths, input.gapX) +
			(cellWidths[input.cols - 1] ?? 0)
		const usedH =
			cellYForRow(input.rows - 1, cellHeights, input.gapY) +
			(cellHeights[input.rows - 1] ?? 0)
		figureSlackX = Math.max(0, innerGrid.width - usedW)
		figureSlackY = Math.max(0, innerGrid.height - usedH)
	}

	const gridOriginX = outerReserves.left + figureSlackX / 2
	const naturalGridOriginY = outerReserves.top + figureSlackY / 2

	// LAYOUT.md §10: at extreme negative gapY (or gapX), the cumulative
	// cell shift can drive upper rows (or leftmost cols) above the
	// natural top reserve area — they'd render at negative y/x and clip
	// off the canvas. Compute the overflow and shift the grid origin so
	// every panel is on-canvas. Canvas height/width grow accordingly
	// (scroll wrapper triggers if canvas > container).
	let rawMinCellY = naturalGridOriginY
	let rawMinCellX = gridOriginX
	for (const p of input.panels) {
		const rawCellX = gridOriginX + cellXForCol(p.col, cellWidths, input.gapX)
		const rawCellY = naturalGridOriginY + cellYForRow(p.row, cellHeights, input.gapY)
		if (rawCellY < rawMinCellY) rawMinCellY = rawCellY
		if (rawCellX < rawMinCellX) rawMinCellX = rawCellX
	}
	const ridgelineTopGrow = Math.max(0, naturalGridOriginY - rawMinCellY)
	const ridgelineLeftGrow = Math.max(0, gridOriginX - rawMinCellX)
	const gridOriginY = naturalGridOriginY + ridgelineTopGrow
	const adjustedGridOriginX = gridOriginX + ridgelineLeftGrow
	// Grow the canvas to accommodate the shifted grid. Scroll wrapper
	// gets triggered below if this pushes us past the container.
	canvasH += ridgelineTopGrow
	canvasW += ridgelineLeftGrow
	const scroll =
		canvasW > input.containerWidth || canvasH > input.containerHeight
			? { width: input.containerWidth, height: input.containerHeight }
			: null

	// Position cells. Negative gap = ridgeline overlap (cells cumulatively
	// shift toward origin); positive gap = whitespace between cells. With
	// ridgelineTopGrow / ridgelineLeftGrow applied, even extreme overlap
	// keeps every cell on-canvas.
	const panels: SolverPanelOutput[] = input.panels.map((p) => {
		const cellX = adjustedGridOriginX + cellXForCol(p.col, cellWidths, input.gapX)
		const cellY = gridOriginY + cellYForRow(p.row, cellHeights, input.gapY)
		const cell: Rect = {
			x: cellX,
			y: cellY,
			width: cellWidths[p.col] ?? 0,
			height: cellHeights[p.row] ?? 0,
		}
		const m = cellMargins(
			p.row,
			p.col,
			input.rows,
			input.cols,
			input.shareX,
			input.shareY,
			facetLabelHeight,
			leftFloor,
			bottomFloor,
			interiorBottomChromePerRow,
			interiorLeftChromePerCol,
			edges,
			cellMargin
		)
		const inner: Rect = {
			x: cellX + m.left,
			y: cellY + m.top,
			width: safeInnerWidths[p.col] ?? 0,
			height: safeInnerHeights[p.row] ?? 0,
		}
		// Wrap-mode per-panel label sits in the reserved band at the cell
		// top. For polar (radar / pie) the centered circular mark floats in
		// the vertical middle of a tall panel, leaving the top-pinned label
		// stranded far above it (user-reported June 2026). Pull the label
		// down to hug the mark's top edge — but never ABOVE its natural band
		// position (clamp), so densely-packed multi-row wraps are unaffected.
		const naturalFacetLabelY = cellY + facetLabelHeight * 0.75
		const facetLabelY = isPolarMode
			? Math.max(
					naturalFacetLabelY,
					inner.y +
						inner.height / 2 -
						Math.min(inner.width, inner.height) * POLAR_MARK_HALF_FRAC -
						POLAR_HEADER_GAP,
				)
			: naturalFacetLabelY
		const facetLabel: TextRect | null = input.facetLabel
			? {
					x: xForAlignment(
						input.facetLabel.align,
						inner.x,
						inner.x + inner.width
					),
					y: facetLabelY,
					textAnchor: textAnchorFor(input.facetLabel.align),
					rotation: 0,
					width: inner.width,
					height: facetLabelHeight,
				}
			: null
		return {
			key: p.key,
			row: p.row,
			col: p.col,
			cell,
			inner,
			facetLabel,
			// Under shareX, only the bottom-most filled panel of each column
			// renders the x-axis. For a fully populated grid this is just
			// the last row; for wrap with an uneven last row, the second-
			// to-last row's panel takes over in columns whose last cell is
			// empty. Mirror for showYTicks.
			showXTicks:
				!input.shareX || p.row === edges.bottomMostRowPerCol.get(p.col),
			showYTicks:
				!input.shareY || p.col === edges.leftmostColPerRow.get(p.row),
			showXAxisTitle: false,
			showYAxisTitle: false,
		}
	})

	// Shared title rects, anchored to the plot-grid spans (so left/right
	// alignment matches the actual plot edges, not the canvas edges).
	const plotLeft = panels.length > 0
		? Math.min(...panels.map((p) => p.inner.x))
		: gridOriginX + cellMargin.left + leftFloor
	const plotRight = panels.length > 0
		? Math.max(...panels.map((p) => p.inner.x + p.inner.width))
		: canvasW - cellMargin.right
	const plotTop = panels.length > 0
		? Math.min(...panels.map((p) => p.inner.y))
		: gridOriginY + facetLabelHeight + cellMargin.top
	const plotBottom = panels.length > 0
		? Math.max(...panels.map((p) => p.inner.y + p.inner.height))
		: canvasH - cellMargin.bottom

	// Title positions use the font-derived base reserves (titleReserve,
	// etc. — the same bands computeOuterReserves reserved)
	// for their natural y, then add `topGrow` so the title appears in
	// the SAME on-screen spot when the user moves it AWAY from the plot
	// (negative offsetY) — the grow shifted the plot down to give the
	// title room, and we add the same shift to the title so the user's
	// "move away" reads as "plot moves away from title" rather than
	// "title clips off-canvas." Toward-the-plot offsets (positive Y)
	// don't grow, so the title shifts into the plot region as a pure
	// override (per spec §6.4).
	const titleOffsetX = input.chartTitle?.offsetX ?? 0
	const titleOffsetY = input.chartTitle?.offsetY ?? 0
	const subOffsetX = input.chartSubtitle?.offsetX ?? 0
	const subOffsetY = input.chartSubtitle?.offsetY ?? 0
	const xTOffsetX = input.xTitle?.offsetX ?? 0
	const xTOffsetY = input.xTitle?.offsetY ?? 0
	const yTOffsetX = input.yTitle?.offsetX ?? 0
	const yTOffsetY = input.yTitle?.offsetY ?? 0

	// Each top title cancels its OWN away-direction offset (negative Y)
	// so it stays at its natural on-canvas position; only the plot moves.
	// Toward-the-plot offsets (positive Y) shift the title down as-is.
	const title: TextRect | null = input.chartTitle
		? {
				x:
					xForAlignment(input.chartTitle.align, plotLeft, plotRight) +
					titleOffsetX,
				y: clampBaselineY(
					titleReserve(input.chartTitle.fontSize) * 0.7 +
						titleOffsetY +
						outerReserves.titleAwayGrow,
					input.chartTitle.fontSize,
					canvasH,
				),
				textAnchor: textAnchorFor(input.chartTitle.align),
				rotation: 0,
				width: plotRight - plotLeft,
				height: outerReserves.titleHeight,
			}
		: null
	const subtitle: TextRect | null = input.chartSubtitle
		? {
				x:
					xForAlignment(input.chartSubtitle.align, plotLeft, plotRight) +
					subOffsetX,
				y: clampBaselineY(
					// The subtitle hangs below the title band — font-derived when a
					// title is present, the fixed reserve otherwise (matching
					// computeOuterReserves' 0-height band for a missing title).
					(input.chartTitle
						? titleReserve(input.chartTitle.fontSize)
						: TITLE_RESERVE) +
						subtitleReserve(input.chartSubtitle.fontSize) * 0.75 +
						subOffsetY +
						outerReserves.subtitleAwayGrow,
					input.chartSubtitle.fontSize,
					canvasH,
				),
				textAnchor: textAnchorFor(input.chartSubtitle.align),
				rotation: 0,
				width: plotRight - plotLeft,
				height: outerReserves.subtitleHeight,
			}
		: null
	// xTitleGap and yTitleGap already computed at the top of this function
	// (needed earlier to bump leftFloor). Both target a fixed
	// TITLE_LABEL_GAP_PX between the title's edge and the tick labels'
	// edge — see the gap definitions above for the exact geometry.

	// Axis-title default positions are driven by a SINGLE knob —
	// `TITLE_LABEL_GAP_PX` (defined with the gap formulas above). Smaller
	// values = title sits closer to the tick labels; negative values let
	// the title encroach into the label band. Per-chart `offsetX/Y` from
	// the sidebar still stacks on top of this default.

	const xTitle: TextRect | null = input.xTitle
		? {
				x:
					xForAlignment(input.xTitle.align, plotLeft, plotRight) + xTOffsetX,
				// LAYOUT.md §8: title stays at its natural screen position
				// when moved AWAY (positive offsetY); the plot shrinks via
				// `outerReserves.bottom = bottomGrow`, which subtracts from
				// inner.height. Adding `offsetY` here compensates for the
				// shrunk plotBottom so the title's absolute y stays put.
				// Negative offsetY moves the title up freely (toward/over
				// the plot — overlap allowed per spec). Final position is
				// clamped to the viewport with VIEWPORT_BUFFER_PX so the
				// title can't fall off either edge under extreme offsets.
				y: clampBaselineY(
					plotBottom + xTitleGap + xTOffsetY,
					input.xTitle.fontSize,
					canvasH,
				),
				textAnchor: textAnchorFor(input.xTitle.align),
				rotation: 0,
				width: plotRight - plotLeft,
				height: outerReserves.xTitleHeight,
			}
		: null
	const yTitle: TextRect | null = input.yTitle
		? input.yTitle.horizontal
			? {
					// Horizontal title: text extends LEFT from titleX
					// (textAnchor="end"), so the title's right edge lands at
					// plotLeft - yTitleGap and the text body fills the left
					// chrome reserved by `estimateExtraLeftMargin` for the title.
					x: clampHorizontalYTitleX(
						plotLeft - yTitleGap + yTOffsetX,
						longestYLabelPx > 0 ? longestYLabelPx : input.yTitle.fontSize * 6,
						canvasW,
					),
					y:
						(input.yTitle.align === "left"
							? plotTop + input.yTitle.fontSize
							: input.yTitle.align === "right"
								? plotBottom
								: (plotTop + plotBottom) / 2) + yTOffsetY,
					textAnchor: "end",
					rotation: 0,
					width: yTitleGap,
					height: input.yTitle.fontSize * 1.2,
				}
			: {
					// Rotated title: text centered at (titleX, titleY), rotated
					// -90° (reads bottom-to-top). Lives inside BASE_MARGIN.left.
					// Clamp X so the rotated bbox doesn't clip canvas left edge.
					x: clampRotatedTitleX(
						plotLeft - yTitleGap + yTOffsetX,
						input.yTitle.fontSize,
						canvasW,
					),
					y:
						(input.yTitle.align === "left"
							? plotBottom
							: input.yTitle.align === "right"
								? plotTop
								: (plotTop + plotBottom) / 2) + yTOffsetY,
					textAnchor: "middle",
					rotation: -90,
					width: input.yTitle.fontSize * 1.2,
					height: plotBottom - plotTop,
				}
		: null

	// Header strips (grid mode): column headers run across the top of each
	// column above row 0; row headers run down the left of each row left
	// of col 0. Strip bands are reserved by computeOuterReserves so the
	// panel grid already sits below/right of them.
	const stripColHeight = input.columnHeaderHeight ?? 20
	const stripRowWidth = input.rowHeaderWidth ?? 80

	const columnHeaders: StripHeaderRect[] = (input.columnHeaders ?? []).map(
		(h, colIdx) => {
			// Find the first panel in this column to derive cell.x and cell.width.
			const p = panels.find((pp) => pp.col === colIdx)
			if (!p) {
				// Shouldn't happen in a well-formed grid; emit a degenerate rect.
				return {
					text: h.text,
					x: 0,
					y: 0,
					textAnchor: "middle" as const,
					rotation: 0,
					width: 0,
					height: stripColHeight,
				}
			}
			// Column header aligns with the INNER rect's horizontal center,
			// not the cell's. The cell includes left chrome (y-axis labels
			// + title) which can be much larger than the right chrome —
			// using cell center would push the header off-axis from the
			// plot area where the data sits. For radar / pie panels
			// specifically, the plot is centered on inner; for cartesian
			// the inner is the actual plot rect; both want the header
			// aligned with inner center.
			// Anchor the header horizontally per the facet-title alignment,
			// spanning the inner rect (not the cell). offsetX nudges from there.
			const headerX = xForAlignment(
				h.align,
				p.inner.x,
				p.inner.x + p.inner.width
			)
			// Column header strip sits in the top reserve. Place the text's
			// baseline at the strip's vertical center so dominantBaseline="middle"
			// in the renderer centers correctly. The strip's TOP is at
			// outerReserves.top - stripColHeight (immediately above the grid).
			// Follow the aspect-ratio-centered grid (figureSlack shift).
			const stripCenterY =
				outerReserves.top + figureSlackY / 2 - stripColHeight / 2
			// Polar single-row: pull the header down to hug the mark's top
			// edge instead of leaving it stranded above a tall panel. Only
			// applies when there's one row — multi-row grids keep the mark
			// close enough to the top band that the strip position reads
			// fine. Never push the header ABOVE its strip position.
			const y =
				isPolarMode && input.rows === 1
					? Math.max(
							stripCenterY,
							p.inner.y +
								p.inner.height / 2 -
								Math.min(p.inner.width, p.inner.height) * POLAR_MARK_HALF_FRAC -
								POLAR_HEADER_GAP,
						)
					: stripCenterY
			return {
				text: h.text,
				x: headerX + (h.offsetX ?? 0),
				y: y + (h.offsetY ?? 0),
				textAnchor: textAnchorFor(h.align),
				rotation: 0,
				width: p.inner.width,
				height: stripColHeight,
			}
		}
	)
	const rowHeaders: StripHeaderRect[] = (input.rowHeaders ?? []).map(
		(h, rowIdx) => {
			const p = panels.find((pp) => pp.row === rowIdx)
			if (!p) {
				return {
					text: h.text,
					x: 0,
					y: 0,
					textAnchor: "middle" as const,
					rotation: 0,
					width: stripRowWidth,
					height: 0,
				}
			}
			// Row header aligns with the INNER rect's vertical center, not
			// the cell's. The cell includes facet-label / top chrome and
			// bottom chrome (x-axis), which can be asymmetric — using
			// cell center can push the header off the radar/plot's
			// horizontal axis. Inner center is where the plot's middle
			// row sits (Sauteed/Dried for radar; the y-axis midpoint for
			// cartesian).
			// Vertical placement within the row's OWN plot rect, so rows of
			// differing heights each line their title up as chosen: top hugs
			// the plot's top edge, bottom its bottom edge, middle (default)
			// its vertical center. The renderer pairs each y with the matching
			// dominant-baseline (`verticalAnchor`) so the text sits flush.
						const vAlign = h.verticalAlign ?? "middle"
			// Vertical placement lines the title up with the panel's own y-axis tick
			// LABELS (they run down the left edge beside the row title), so
			// top / middle / bottom mean "level with the top-most / centre /
			// bottom-most y-tick label". Those labels are centred on their tick
			// positions (dominant-baseline "middle" in Axes.tsx), so the title is
			// centred on the same y and reads level with them. A categorical y-axis
			// is a scalePoint with padding 0.5 (see scales.ts): its N labels sit half
			// a step (height / 2N) inside each plot edge; a quantitative axis lands
			// its extreme ticks at the edges (no inset). yLabels is populated only for
			// categorical axes, which is exactly the inset-vs-not signal.
			const pIn = input.panels.find(
				(ip) => ip.row === p.row && ip.col === p.col
			)
			const nYLabels = pIn?.yLabels.length ?? 0
			const yInset = nYLabels > 0 ? p.inner.height / (2 * nYLabels) : 0
			const innerCenterY =
				vAlign === "top"
					? p.inner.y + yInset
					: vAlign === "bottom"
						? p.inner.y + p.inner.height - yInset
						: p.inner.y + p.inner.height / 2
			// Always centred, matching the y-tick labels' baseline.
			const vAnchor: VerticalAlignment = "middle"
			// Follow the aspect-ratio-centered grid (figureSlack shift).
			const stripRowRight = outerReserves.left + figureSlackX / 2
			const stripCenterX = stripRowRight - stripRowWidth / 2
			// Honor the facet-title alignment horizontally within the left
			// band: left hugs the band's outer edge, right sits against the
			// grid, center splits it. offsetX/offsetY nudge from there.
			const headerX = xForAlignment(
				h.align,
				stripRowRight - stripRowWidth,
				stripRowRight
			)
			// Polar single-column: a centered pie/radar floats in the middle
			// of a very wide lone column, leaving the strip-band header
			// stranded far to its left. Right-anchor the header just outside
			// the mark's bounding box instead. Only for one-column grids —
			// multi-column keeps each col-0 panel narrow enough that the
			// strip position reads fine. Never push the header RIGHT past the
			// mark (clamp to the strip position as the leftmost fallback).
			if (isPolarMode && input.cols === 1) {
				const markLeft =
					p.inner.x +
					p.inner.width / 2 -
					Math.min(p.inner.width, p.inner.height) * POLAR_MARK_HALF_FRAC
				return {
					text: h.text,
					x:
						Math.max(stripCenterX, markLeft - POLAR_HEADER_GAP) +
						(h.offsetX ?? 0),
					y: innerCenterY + (h.offsetY ?? 0),
					textAnchor: "end" as const,
					rotation: 0,
					width: stripRowWidth,
					height: p.inner.height,
					verticalAnchor: vAnchor,
				}
			}
			return {
				text: h.text,
				x: headerX + (h.offsetX ?? 0),
				y: innerCenterY + (h.offsetY ?? 0),
				textAnchor: textAnchorFor(h.align),
				rotation: 0,
				width: stripRowWidth,
				height: p.inner.height,
				verticalAnchor: vAnchor,
			}
		}
	)

	return {
		canvas: { width: canvasW, height: canvasH },
		scroll,
		title,
		subtitle,
		xTitle,
		yTitle,
		panels,
		columnHeaders,
		rowHeaders,
		figureSlack: { x: figureSlackX, y: figureSlackY },
	}
}
