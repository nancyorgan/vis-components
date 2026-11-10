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

import { max, min } from "d3-array"
import { DEFAULT_TICKMARK_CONFIG } from "./channelConfig"
import {
	estimateExtraBottomMargin,
	estimateExtraLeftMargin,
	estimateInteriorBottomChrome,
	estimateInteriorLeftChrome,
	estimateLongestLineWidth,
} from "./estimateMargins"
import { lineCount } from "./multilineText"
import {
	BASE_MARGIN,
	extraLinesPx,
	POLAR_MARGIN,
	subtitleBand,
	subtitleReserve,
	TITLE_LINE_STEP_EM,
	TITLE_RESERVE,
	titleBand,
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
	/** Structural rotation about (x, y): -90 for the rotated y-title and a
	 *  LEFT-side facet title (reads bottom-to-top), 90 for a RIGHT-side facet
	 *  title (reads top-to-bottom). A user "Angle" applies only at 0. */
	readonly rotation: 0 | -90 | 90
	readonly width: number
	readonly height: number
	/** Vertical anchoring the renderer applies via SVG dominant-baseline.
	 *  Set on row headers with a non-default (top / bottom) vertical
	 *  alignment and on upright side-band facet titles; omitted → the
	 *  renderer's default (row headers: center; others: the alphabetic
	 *  baseline). */
	readonly verticalAnchor?: VerticalAlignment
	/** Multi-line text stacks its extra lines ABOVE `y` — which is then the
	 *  LAST line's baseline — instead of below it. Set on the chart title,
	 *  subtitle and facet panel labels, whose bands grow upward so a wrapped
	 *  title's bottom line stays where a single line would be (LAYOUT.md §7);
	 *  axis titles keep the first-line convention. */
	readonly growUp?: boolean
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
	/** Widest rendered line, px — canvas-measured by the caller, the chart
	 *  title's prefix run included. The chart title and subtitle use it to
	 *  stay in view horizontally (`clampTitleAnchorX`); the axis titles ignore
	 *  it. Omitted / 0 = unmeasured: the anchor is used as aligned. */
	readonly textWidth?: number
	/** Vertical placement within the reserved band / strip. Only the row-header
	 *  strip honors this today (it positions the title at the top / center /
	 *  bottom of the row's plot rect). Omit = "middle" (legacy centering). */
	readonly verticalAlign?: VerticalAlignment
	/** Paint-time rotation the renderer applies about the anchor (facet-title
	 *  "Angle"). The solver doesn't rotate the rect for it; it only reads it
	 *  in the facet-title keep-in-view pass (LAYOUT.md §8) so a steeply
	 *  rotated header's extent counts when deciding whether it leaves the
	 *  canvas. Only the header strips carry it. Omit = 0. */
	readonly angleDeg?: number
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
	/** Line count of the tallest panel label (`\n`-separated). The band grows
	 *  by one line step per extra line and every label's BOTTOM line sits at
	 *  the single-line position, so a wrapped label grows up into the added
	 *  room rather than down into the panel. Omit = 1. */
	readonly lines?: number
	/** Which side of the panel the band sits on (Labels → Facet titles →
	 *  Placement). `top` (the default) is the band above the plot rect
	 *  described above. `left` / `right` move it beside the plot rect, at the
	 *  cell's OUTER edge (outside the y-axis chrome), `width` px wide; the
	 *  top band is then not reserved at all. */
	readonly side?: FacetLabelSide
	/** Band width (px) for a side placement — the caller pins it like
	 *  `height`: the single-line band for a vertical title, or the widest
	 *  title plus padding for an upright one. Ignored for `top`. */
	readonly width?: number
	/** Side placement only: read the title upright instead of rotated
	 *  (-90° on the left, 90° on the right). */
	readonly horizontal?: boolean
	/** Side placement only: where along the panel the title sits — level
	 *  with the plot rect's top edge, its vertical center (default) or its
	 *  bottom edge. */
	readonly verticalAlign?: VerticalAlignment
	/** Widest title line, px (canvas-measured by the caller), for the
	 *  keep-in-view pass. Omit = the pass sees a zero-width title. */
	readonly textWidth?: number
	/** "Adjust position" nudge (screen px: +x right, +y down), folded into
	 *  every panel's rect by the solver. The keep-in-view pass then grows the
	 *  outer reserves when a nudged title would leave the canvas. Omit = 0. */
	readonly offsetX?: number
	readonly offsetY?: number
	/** Paint-time rotation (facet-title "Angle"); see
	 *  `SharedTitleInput.angleDeg`. Ignored by the renderer for a vertical
	 *  side band (the structural ±90 wins), and the pass mirrors that. */
	readonly angleDeg?: number
}

export type FacetLabelSide = "top" | "left" | "right"

/** Side padding inside an upright side band, between the band's edges and
 *  the title text. */
export const FACET_SIDE_BAND_PAD = 8

export type SolverPanelInput = {
	readonly key: string
	readonly row: number
	readonly col: number
	/** Sample of x-axis tick labels for margin estimation: the category
	 *  values, or for a continuous axis the formatted tick labels the axis
	 *  will draw (see `buildSolverPanelInputs`). */
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

	/** Room past the canvas's left / right edge (px) that the chart title and
	 *  subtitle may paint into: the column beside a left / right edge legend,
	 *  which is blank above the plot's top edge. PlotCanvas lets exactly those
	 *  two texts escape the SVG box (LAYOUT.md §7), so a title wider than the
	 *  plot flows over the legend instead of clipping at the canvas edge.
	 *  Omitted = 0 / 0. Ignored in scroll mode, whose box clips at the
	 *  container. */
	readonly titleOverhang?: TitleOverhang

	/** Tick-label "Adjust position" nudges (screen px: +x right, +y down).
	 *  The nudge moves ONLY the tick labels (see Axes.tsx `labelDx`/
	 *  `labelDy`), so the axis-title gap — which targets a fixed distance
	 *  from the labels' RENDERED edge — must track the component that moves
	 *  labels TOWARD the title (y labels nudged left, x labels nudged
	 *  down). Callers fold the legacy single `offset` in exactly like the
	 *  renderer does. Omitted = 0. */
	readonly yTickLabelDx?: number
	readonly xTickLabelDy?: number

	/** Tick-mark length per axis (px). Axes.tsx insets the tick labels from
	 *  the spine by `tick.length + 4` (y) / `tick.length + 12` (x), so the
	 *  axis-title gaps — which target a fixed distance from the labels'
	 *  rendered edge — grow with the tick. Omitted = the default tick length. */
	readonly xTickLength?: number
	readonly yTickLength?: number

	/** Which plot edge each axis sits on (`AxisConfig.side` through
	 *  `axisFlipped`, LAYOUT.md §17). `xAxisTop` moves the x axis — its
	 *  tick-label band, the shared x title and the interior / shared
	 *  reserves — from the bottom of every cell to the top (below the facet
	 *  label band), and the shared x axis is drawn on each column's TOP-most
	 *  filled panel instead of its bottom-most. `yAxisRight` likewise swaps
	 *  the y chrome to the right of each cell and draws the shared y axis on
	 *  each row's RIGHT-most filled panel. The far-side pads (BASE_MARGIN.top
	 *  / .right) swap with them. Title offsets keep their screen-coordinate
	 *  meaning; "away from the plot" simply points the other way (§8).
	 *  Omitted = bottom / left. */
	readonly xAxisTop?: boolean
	readonly yAxisRight?: boolean

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
	/** Extra pixels reserved ABOVE the plot grid, below the chart title /
	 *  subtitle band. Annotations placed above the plot pass their spill
	 *  here so the grid moves down and they stay inside the canvas. Adds to
	 *  outerReserves.top. */
	readonly extraTopMargin?: number

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

/** Grid mode with a row-header strip: the shared y-title moves OUT of the
 *  leftmost cells' chrome into its own band left of the strip, so it reads
 *  as the outermost label ([title][row titles][ticks][plot]) instead of
 *  being sandwiched between the row titles and the tick labels. */
const yTitleOutsideRowStrip = (input: SolverInput): boolean =>
	Boolean(input.yTitle) &&
	(input.rowHeaders?.length ?? 0) > 0 &&
	// A right-side y axis keeps its title beside its own labels on the
	// right; the row strip stays on the left, so there's nothing to clear.
	!input.yAxisRight

/** Space between an outside y-title and the row-header strip's left edge.
 *  Small because the strip band already carries 12px of side padding. */
const Y_TITLE_STRIP_GAP = 8

/** Width of the outer band holding an outside y-title (0 when the title
 *  stays in the cell chrome): canvas buffer + the title block + strip gap.
 *  A rotated title's block is one line-height per line; a horizontal one is
 *  its widest line. */
const yTitleOuterBand = (input: SolverInput): number => {
	if (!input.yTitle || !yTitleOutsideRowStrip(input)) return 0
	const { text, fontSize, horizontal } = input.yTitle
	const block = horizontal
		? estimateLongestLineWidth(text, fontSize)
		: fontSize * 1.2 * lineCount(text)
	return VIEWPORT_BUFFER_PX + block + Y_TITLE_STRIP_GAP
}

/** Clamp a baseline-anchored text's y coordinate so its bounding box
 *  (ascender + descender) doesn't cross the viewport edge with buffer.
 *  Used by chart title / subtitle / x-title. `extraAbove` is the height of
 *  the lines a `growUp` block stacks above `y` (its last line), so the
 *  block's FIRST line is what stays clear of the top edge. */
const clampBaselineY = (
	y: number,
	fontSize: number,
	canvasH: number,
	extraAbove: number = 0,
): number => {
	const ascender = fontSize * 0.8
	const descender = fontSize * 0.2
	const minY = VIEWPORT_BUFFER_PX + ascender + extraAbove
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

/** Room past the canvas's left / right edge the chart title and subtitle
 *  may paint into — see `SolverInput.titleOverhang`. */
export type TitleOverhang = { readonly left: number; readonly right: number }

export const NO_TITLE_OVERHANG: TitleOverhang = { left: 0, right: 0 }

/** Keep a chart-level title (chart title / subtitle) in view horizontally.
 *  The text's extent follows from its anchor side and widest line; the
 *  figure it must fit is the canvas plus `overhang` past each edge (the
 *  blank band over a left / right legend). The anchor moves only as far
 *  as the text needs, so alignment is untouched whenever the text already
 *  fits — and text wider than the whole figure keeps its anchor side in
 *  view: a left-aligned title still starts at the buffer, a right-aligned
 *  one still ends at it, a centered one centers on the figure. */
const clampTitleAnchorX = (
	anchorX: number,
	textAnchor: TextAnchorSpec,
	textWidth: number,
	canvasW: number,
	overhang: TitleOverhang,
): number => {
	const leftExtent =
		textAnchor === "start" ? 0 : textAnchor === "end" ? textWidth : textWidth / 2
	const rightExtent = textWidth - leftExtent
	const minX = VIEWPORT_BUFFER_PX - overhang.left + leftExtent
	const maxX = canvasW + overhang.right - VIEWPORT_BUFFER_PX - rightExtent
	if (minX > maxX) {
		return textAnchor === "start"
			? minX
			: textAnchor === "end"
				? maxX
				: (minX + maxX) / 2
	}
	return Math.max(minX, Math.min(maxX, anchorX))
}

/** Baseline-to-visual-center, as a fraction of font size (about half a cap
 *  height). Lifts a centered title so its ink, not its baseline, centers. */
const TITLE_CAP_CENTER_RATIO = 0.35

const textAnchorFor = (align: Alignment): TextAnchorSpec =>
	align === "left" ? "start" : align === "right" ? "end" : "middle"

const xForAlignment = (
	align: Alignment,
	left: number,
	right: number
): number => (align === "left" ? left : align === "right" ? right : (left + right) / 2)

/** First-line baseline y for the UPRIGHT ("read y-axis title horizontally")
 *  y-title, which always sits CENTERED on the panel's plot span.
 *
 *  Alignment does NOT move an upright title along the axis (unlike the
 *  rotated one, where "left"/"right" are the axis ends the text reads
 *  between). An upright title reads left-to-right, so its align buttons do
 *  what they say on a block of prose: they align the WRAPPED LINES against
 *  each other (see `horizontalYTitleAnchorX`). Top/bottom placement is the
 *  Adjust-position Y nudge's job.
 *
 *  Baselines, not edges: `<text>` puts its ALPHABETIC baseline at `y`, so a
 *  single line lifts by half a cap height to center its ink rather than its
 *  baseline. Multi-line titles stack DOWN from the first baseline
 *  (`renderMultilineTspans`, 1.2em steps), so the first line also rises by
 *  half the block's drop — the BLOCK centers, not line one. */
const horizontalYTitleBaselineY = (
	plotTop: number,
	plotBottom: number,
	fontSize: number,
	lines: number
): number => {
	const blockDrop = TITLE_LINE_STEP_EM * fontSize * Math.max(0, lines - 1)
	return (
		(plotTop + plotBottom) / 2 - blockDrop / 2 + TITLE_CAP_CENTER_RATIO * fontSize
	)
}

/** Anchor x for the upright y-title, given the RIGHT EDGE of the band the
 *  left margin reserved for it and the width of its widest line.
 *
 *  The block's box is fixed — its right edge butts against the tick labels
 *  and it extends `blockWidth` leftward, which is exactly the space
 *  `estimateExtraLeftMargin` reserved. Alignment slides the ANCHOR inside
 *  that box so the lines align within it while the box itself stays put:
 *  end-anchored at the right edge, start-anchored at the left edge,
 *  middle-anchored at the middle. The widest line spans the whole box in
 *  every case, so no alignment can push ink into the tick labels or off the
 *  canvas. */
const horizontalYTitleAnchorX = (
	align: Alignment,
	rightEdge: number,
	blockWidth: number
): number =>
	align === "left"
		? rightEdge - blockWidth
		: align === "center"
			? rightEdge - blockWidth / 2
			: rightEdge

/** Mirror of `horizontalYTitleAnchorX` for a RIGHT-side y axis (§17): the
 *  box's LEFT edge butts against the tick labels and the text extends
 *  rightward into the chrome reserved for it; alignment slides the anchor
 *  inside that fixed box. */
const horizontalYTitleAnchorXFromLeft = (
	align: Alignment,
	leftEdge: number,
	blockWidth: number
): number =>
	align === "left"
		? leftEdge
		: align === "center"
			? leftEdge + blockWidth / 2
			: leftEdge + blockWidth

/** Clamp a right-side upright y-title's LEFT edge so its widest line stays
 *  inside the canvas's right buffer (the mirror of `clampHorizontalYTitleX`). */
const clampHorizontalYTitleLeftX = (
	leftEdge: number,
	textWidth: number,
	canvasW: number,
): number => {
	const minX = VIEWPORT_BUFFER_PX
	const maxX = canvasW - VIEWPORT_BUFFER_PX - textWidth
	if (minX > maxX) return Math.max(0, (minX + maxX) / 2)
	return Math.max(minX, Math.min(maxX, leftEdge))
}

/** Compute the per-side global margin floors that hold the SHARED axis
 *  titles. The left floor holds the y-title (lives to the left of the
 *  leftmost column); the bottom floor holds the x-title (lives below
 *  the bottom row). Both are MAGNITUDES named for the default edges: under
 *  `yAxisRight` / `xAxisTop` the same floors are applied on the right /
 *  top (see `cellMargins`). Only panels in the axis-edge column / row are
 *  visited, so a tall y-label inside an interior column doesn't inflate
 *  the title-to-plot gap of the leftmost panel (under shareY=ON every
 *  panel sees the full-dataset labels anyway, so the leftmost panel's
 *  labels already represent the widest label — taking the max here vs.
 *  the global max produces the same value). */
/** For a sparse panel list (wrap mode can have an uneven last row), find
 *  the panel that carries each column's x axis and each row's y axis: the
 *  filled row nearest the x axis's edge per column (bottom-most by default,
 *  top-most under `xAxisTop`) and the filled column nearest the y axis's
 *  edge per row (leftmost by default, rightmost under `yAxisRight`). Used
 *  to decide which panels draw the shared X / Y axis when the grid isn't
 *  fully populated — without this, a column whose bottom-most panel isn't
 *  on `row === rows-1` would lose its x-axis entirely.
 *
 *  For grid mode (cross-product), every cell is present so this collapses
 *  to `{rows-1 for every col}` / `{0 for every row}` — same as the old
 *  `p.row === rows-1` / `p.col === 0` checks. */
const computeEdgePositions = (
	panels: readonly SolverPanelInput[],
	xAxisTop: boolean,
	yAxisRight: boolean
) => {
	const xAxisRowPerCol = new Map<number, number>()
	const yAxisColPerRow = new Map<number, number>()
	for (const p of panels) {
		const curRow = xAxisRowPerCol.get(p.col)
		if (curRow == null || (xAxisTop ? p.row < curRow : p.row > curRow))
			xAxisRowPerCol.set(p.col, p.row)
		const curCol = yAxisColPerRow.get(p.row)
		if (curCol == null || (yAxisRight ? p.col > curCol : p.col < curCol))
			yAxisColPerRow.set(p.row, p.col)
	}
	// A row carries full x chrome whenever ANY column's axis panel lands on
	// it (uneven wrap: the last filled panel of one column may sit a row
	// above another column's); likewise columns for the y axis.
	const rowsCarryingXAxis = new Set<number>()
	for (const r of xAxisRowPerCol.values()) rowsCarryingXAxis.add(r)
	const colsCarryingYAxis = new Set<number>()
	for (const c of yAxisColPerRow.values()) colsCarryingYAxis.add(c)
	return {
		xAxisRowPerCol,
		yAxisColPerRow,
		rowsCarryingXAxis,
		colsCarryingYAxis,
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
		if (p.col === edges.yAxisColPerRow.get(p.row)) {
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
		if (p.row === edges.xAxisRowPerCol.get(p.col)) {
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


/** Clamp the data-label reserves so the canvas never grows in fit mode.
 *
 *  The reserves arrive uncapped (dataLabelReserve.ts): a long label at the
 *  last point of a line compresses the figure as far as needed to stay in
 *  the viewport, exactly like a wide legend does — down to a zero-width
 *  plot if the label demands it (there is deliberately NO floor; a legend
 *  wider than the viewport collapses the chart the same way). What the
 *  clamp prevents is the reserve exceeding the container: in FIT mode the
 *  natural canvas width is just the reserves, so an unclamped pair wider
 *  than the container would grow the canvas and emit a horizontal scroll
 *  in a mode whose contract is "never scroll". The two reserves scale down
 *  proportionally to the budget left after the other horizontal chrome.
 *  Scroll mode and pixel panel overrides grow the canvas by design, so
 *  they pass through untouched (the label stays in view via the scroll
 *  wrapper). A fixed aspect ratio shadows the input to fit mode first.
 *
 *  The chrome is the grid's outer-edge margins plus the plot-to-plot gaps
 *  (the chrome between neighbouring columns sits inside the gap — see
 *  `GridChrome`). */
const clampLabelReserves = (
	input: SolverInput,
	cellMargin: CellMargin,
	leftFloor: number,
	otherLeftReserve: number,
): { left: number; right: number } => {
	const left = Math.max(0, input.extraLeftMargin ?? 0)
	const right = Math.max(0, input.extraRightMargin ?? 0)
	const total = left + right
	if (total === 0) return { left, right }
	const fitMode =
		(input.minPanelPx ?? DEFAULT_MIN_PANEL_PX) === 0 &&
		!(input.panelWidthOverride != null && input.panelWidthOverride > 0)
	if (!fitMode) return { left, right }
	const chrome =
		cellMargin.left +
		cellMargin.right +
		leftFloor +
		Math.max(0, input.gapX) * (input.cols - 1)
	const budget = Math.max(0, input.containerWidth - otherLeftReserve - chrome)
	if (total <= budget) return { left, right }
	const scale = budget / total
	return {
		left: Math.floor(left * scale),
		right: Math.floor(right * scale),
	}
}

const computeOuterReserves = (
	input: SolverInput,
	cellMargin: CellMargin,
	bottomFloor: number = 0,
	leftFloor: number = 0,
) => {
	// Multi-line titles grow UP (LAYOUT.md §7): each extra line adds one
	// line step to the band, the bottom line keeps the single line's
	// distance to what sits below it, and the earlier lines fill the added
	// room above. `*LinesGrow` is that added room; the title.y / subtitle.y
	// formulas push the bottom line down by it.
	const titleLinesGrow = input.chartTitle
		? extraLinesPx(input.chartTitle.text, input.chartTitle.fontSize)
		: 0
	const titleHeight = input.chartTitle
		? titleBand(input.chartTitle.text, input.chartTitle.fontSize)
		: 0
	const subtitleLinesGrow = input.chartSubtitle
		? extraLinesPx(input.chartSubtitle.text, input.chartSubtitle.fontSize)
		: 0
	const subtitleHeight = input.chartSubtitle
		? subtitleBand(input.chartSubtitle.text, input.chartSubtitle.fontSize)
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
	// Offsets stay in screen coordinates; with the x axis on TOP (§17)
	// "away from the plot" is UP, so the away component is `-offsetY`, and
	// the grow lands on the top reserve instead of the bottom one.
	const xTitleAway = input.xAxisTop ? -rawXTitleOffsetY : rawXTitleOffsetY
	const xTitleGrow = input.xTitle ? Math.max(-extensionRoom, xTitleAway) : 0
	const bottomGrow = input.xAxisTop ? 0 : xTitleGrow
	const xTitleTopGrow = input.xAxisTop ? xTitleGrow : 0
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
	// An outside y-title (left of the row strip) has no cell chrome to
	// reclaim, so a toward-the-plot offset is a pure shift — no extension.
	// With the y axis on the RIGHT (§17) "away" is +offsetX and the grow
	// lands on the right reserve.
	const yTitleAway = input.yAxisRight ? rawYTitleOffsetX : -rawYTitleOffsetX
	const yTitleGrow = input.yTitle
		? Math.max(
				yTitleOutsideRowStrip(input) ? 0 : -leftExtensionRoom,
				yTitleAway,
			)
		: 0
	const leftGrow = input.yAxisRight ? 0 : yTitleGrow
	const yTitleRightGrow = input.yAxisRight ? yTitleGrow : 0
	const yTitleBand = yTitleOuterBand(input)
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
	// one but in the opposite direction. In fit mode the pair is clamped
	// so the canvas never outgrows the container (`clampLabelReserves`).
	const labelReserve = clampLabelReserves(
		input,
		cellMargin,
		leftFloor,
		yTitleGrow + rowHeaderBand + yTitleBand,
	)
	//
	// Title-offset semantics (LAYOUT.md §8): canvas matches the
	// container; the user's offset is interpreted as "shift the
	// plot/title distance". For positive x-title offsetY (title moves
	// away/down), the plot SHRINKS — its bottom edge moves up — while
	// the title stays at its natural screen position. We accomplish
	// this by adding `bottomGrow` to `outerReserves.bottom`, which
	// subtracts from inner.height in the main solver.
	return {
		top:
			titleHeight +
			subtitleHeight +
			topGrow +
			xTitleTopGrow +
			columnHeaderBand +
			(input.extraTopMargin ?? 0),
		bottom: bottomGrow + (input.extraBottomMargin ?? 0),
		left: leftGrow + labelReserve.left + rowHeaderBand + yTitleBand,
		right: labelReserve.right + yTitleRightGrow,
		titleHeight,
		subtitleHeight,
		titleLinesGrow,
		subtitleLinesGrow,
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

/** Resolve total chrome per cell side. Three regimes per axis:
 *  - The axis-edge row / column: full margin (BASE_MARGIN + floor) because
 *    these rows/cols hold the shared axis title plus their own ticks+labels.
 *  - Interior + shared: small SHARED_INTERIOR_AXIS_RESERVE (axis spine only).
 *  - Interior + un-shared: just enough room for ticks + tick labels — NO
 *    title space, since the shared title is reserved by the edge row/col.
 *  `cellMargin` is named for the DEFAULT edges (`.bottom` / `.left` are the
 *  axis-side bases, `.top` / `.right` the far-side pads); under `xAxisTop` /
 *  `yAxisRight` (§17) the x chrome lands on the cell's top, below the facet
 *  label band, and the y chrome on its right, with the pads swapping over. */
const cellMargins = (
	row: number,
	col: number,
	_rows: number,
	_cols: number,
	shareX: boolean,
	shareY: boolean,
	facetLabelHeight: number,
	facetSideLeft: number,
	facetSideRight: number,
	leftFloor: number,
	bottomFloor: number,
	interiorBottomChromePerRow: readonly number[],
	interiorLeftChromePerCol: readonly number[],
	edges: ReturnType<typeof computeEdgePositions>,
	cellMargin: CellMargin,
	xAxisTop: boolean,
	yAxisRight: boolean
): { top: number; right: number; bottom: number; left: number } => {
	// Chrome is uniform across each row (height) and each col (width) so
	// cells stay regular. A row carries full x chrome whenever ANY
	// column's axis panel lands on it (e.g. uneven wrap where row 3 col 1
	// is the last filled panel of col 1 but row 4 col 0 still exists for
	// col 0 — both rows 3 and 4 carry the axis).
	const rowCarriesXAxis = edges.rowsCarryingXAxis.has(row)
	const colCarriesYAxis = edges.colsCarryingYAxis.has(col)
	const xChrome = rowCarriesXAxis
		? cellMargin.bottom + bottomFloor
		: shareX
			? SHARED_INTERIOR_AXIS_RESERVE
			: (interiorBottomChromePerRow[row] ?? 0)
	const yChrome = colCarriesYAxis
		? cellMargin.left + leftFloor
		: shareY
			? SHARED_INTERIOR_AXIS_RESERVE
			: (interiorLeftChromePerCol[col] ?? 0)
	// A side-placed facet title band sits at the cell's OUTER edge, outside
	// the y chrome, so the title clears the tick labels whichever side the
	// axis is on (facetSideLeft / facetSideRight: one is 0, both under a
	// top placement).
	return {
		top: facetLabelHeight + (xAxisTop ? xChrome : cellMargin.top),
		bottom: xAxisTop ? cellMargin.top : xChrome,
		left: facetSideLeft + (yAxisRight ? cellMargin.right : yChrome),
		right: facetSideRight + (yAxisRight ? yChrome : cellMargin.right),
	}
}

type CellMarginsAt = (
	row: number,
	col: number
) => { top: number; right: number; bottom: number; left: number }

/** The chrome a laid-out grid carries, split by where it sits. The user's
 *  gap is measured PLOT EDGE TO PLOT EDGE (0 = neighbouring plot rects
 *  touch, negative = they overlap — LAYOUT.md §10), so the chrome between
 *  two neighbours (the first cell's right / bottom margin plus the next
 *  one's left / top) lives inside the gap rather than on top of it:
 *  `cellGapsX[i]` is the cell-edge gap between col i and col i+1 that puts
 *  their plot rects exactly `gapX` apart, and goes negative whenever the
 *  gap is narrower than that chrome. Only the grid's OUTER edges reserve
 *  chrome of their own (`edgeX` / `edgeY`). Chrome is uniform per row
 *  (bottom) and per column (left), so row 0 / col 0 stand in for the rest. */
type GridChrome = {
	readonly edgeX: number
	readonly edgeY: number
	readonly cellGapsX: readonly number[]
	readonly cellGapsY: readonly number[]
}

const computeGridChrome = (
	rows: number,
	cols: number,
	gapX: number,
	gapY: number,
	marginsAt: CellMarginsAt
): GridChrome => {
	const cellGapsX: number[] = []
	for (let c = 0; c + 1 < cols; c++) {
		cellGapsX.push(gapX - marginsAt(0, c).right - marginsAt(0, c + 1).left)
	}
	const cellGapsY: number[] = []
	for (let r = 0; r + 1 < rows; r++) {
		cellGapsY.push(gapY - marginsAt(r, 0).bottom - marginsAt(r + 1, 0).top)
	}
	const lastCol = Math.max(0, cols - 1)
	const lastRow = Math.max(0, rows - 1)
	return {
		edgeX: marginsAt(0, 0).left + marginsAt(0, lastCol).right,
		edgeY: marginsAt(0, 0).top + marginsAt(lastRow, 0).bottom,
		cellGapsX,
		cellGapsY,
	}
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
 *  The grid's span is its plot rects plus the plot-to-plot gaps plus the
 *  chrome on its OUTER edges (the chrome between neighbours sits inside
 *  the gap — see `GridChrome`), so that edge chrome and the gaps come out
 *  FIRST and the weights govern the *inner* rect distribution.
 *
 *  Negative gaps (ridgeline overlap, LAYOUT.md §10): once a gap turns
 *  negative the panel SIZE freezes at its gap=0 (plots touching) value.
 *  The negative gap then drives cumulative cell-position overlap (see
 *  `cellOrigin`) WITHOUT inflating the per-panel height/width. Previously
 *  a more-negative gap also grew the panel ("gives back space"), which
 *  produced odd visual proportions as the user dragged the gap slider
 *  further negative. */
const computeInnerDimsArrays = (
	innerGrid: { width: number; height: number },
	rows: number,
	cols: number,
	gapX: number,
	gapY: number,
	gridChrome: GridChrome,
	colWeights: readonly number[],
	rowWeights: readonly number[],
	panelWidthOverride?: number | null,
	panelHeightOverride?: number | null
): { innerWidths: number[]; innerHeights: number[] } => {
	// LAYOUT.md §10: clamp negative gaps to 0 when sizing panels, so
	// panels stay the SAME width they'd be at gap=0 once we cross into
	// overlap territory. The cumulative overlap is applied at cell-
	// positioning time (`cellOrigin`), not here.
	const horizGapsForSizing = Math.max(0, gapX) * (cols - 1)
	const availableInnerW = innerGrid.width - gridChrome.edgeX - horizGapsForSizing
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

	const vertGapsForSizing = Math.max(0, gapY) * (rows - 1)
	const availableInnerH = innerGrid.height - gridChrome.edgeY - vertGapsForSizing
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

/** Offset of cell `index` from the grid origin along one axis: the sizes
 *  of the cells before it plus the cell-edge gaps between them
 *  (`GridChrome.cellGapsX` / `cellGapsY`). A negative cell gap
 *  (ridgeline, or a plot gap narrower than the chrome between plots)
 *  pulls each later cell back cumulatively. */
const cellOrigin = (
	index: number,
	sizes: readonly number[],
	cellGaps: readonly number[]
): number => {
	let offset = 0
	for (let i = 0; i < index; i++) {
		offset += (sizes[i] ?? 0) + (cellGaps[i] ?? 0)
	}
	return offset
}

/** Extent of a run of cells measured from the grid origin to the farthest
 *  cell edge, with the SIGNED cell gaps — the span the laid-out grid will
 *  really cover on that axis. A negative gap (ridgeline) pulls later cells
 *  back toward the origin; at extreme overlap they pass it, which the
 *  far-edge measure ignores (that spill is handled by the top / left
 *  grow). */
const gridFarEdge = (
	sizes: readonly number[],
	cellGaps: readonly number[]
): number => {
	let farEdge = 0
	for (let i = 0; i < sizes.length; i++) {
		const edge = cellOrigin(i, sizes, cellGaps) + (sizes[i] ?? 0)
		if (edge > farEdge) farEdge = edge
	}
	return farEdge
}

/** Estimate the natural canvas dims demanded by proportional sizing or
 *  the NONPROPORTIONAL_MIN_PX floor. Used to drive scroll emission. */
const estimateNaturalDims = (
	input: SolverInput,
	outerReserves: { top: number; bottom: number; left: number; right: number },
	leftFloor: number,
	bottomFloor: number,
	facetLabelHeight: number,
	facetSideWidth: number,
	cellMargin: CellMargin,
	marginsAt: CellMarginsAt,
	gridChrome: GridChrome
): { width: number; height: number } => {
	const cols = input.cols
	const rows = input.rows
	const minPanelPx = input.minPanelPx ?? DEFAULT_MIN_PANEL_PX
	const minPxPerCat = input.minPxPerCategory ?? DEFAULT_MIN_PX_PER_CATEGORY
	// Per-cell horizontal chrome (using leftmost-col chrome as a floor —
	// scroll computation is a worst-case sizing).
	const horizChrome =
		cellMargin.left + leftFloor + cellMargin.right + facetSideWidth
	const vertChrome =
		facetLabelHeight + cellMargin.top + cellMargin.bottom + bottomFloor
	// Natural inner widths/heights, per cell. Axis-aware: x weights only
	// influence width, y weights only influence height. The max across all
	// panels is what determines the per-cell floor (every cell reserves
	// enough room for the heaviest panel on each axis — actual cell sizes
	// can then differ within that envelope via colWeights/rowWeights).
	const xWeights = input.panels.map((p) => Math.max(1, p.xWeight))
	const yWeights = input.panels.map((p) => Math.max(1, p.yWeight))
	const maxXWeight = max(xWeights) ?? 1
	const maxYWeight = max(yWeights) ?? 1
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
	// When the gap is NEGATIVE (ridgeline), the user has explicitly opted
	// into overlap; cells should compress to fit the container rather
	// than enforcing minPanelPx and emitting scroll. Suppress the natural
	// floor for the affected dimension.
	// The grid's span is its plot rects + the plot-to-plot gaps + the
	// chrome on its outer edges (`GridChrome`).
	const naturalGridW =
		fitMode || input.gapX < 0
			? 0
			: Math.max(
					naturalCellW,
					cols * naturalInnerW + gridChrome.edgeX + (cols - 1) * input.gapX
				)
	const naturalGridH =
		fitMode || input.gapY < 0
			? 0
			: Math.max(
					naturalCellH,
					rows * naturalInnerH + gridChrome.edgeY + (rows - 1) * input.gapY
				)
	// When the user has specified pixel-precise panel dimensions, the
	// canvas MUST grow to honor them (even in fit mode). Take the
	// override-driven grid as a separate floor and use the larger.
	//
	// The floor is the grid the solver will actually lay out, measured from
	// the grid origin to the farthest cell edge: the exact per-row / per-col
	// chrome (`cellMargins` — an interior row under shareX carries a 4px
	// spine reserve, not the full x-axis band) and the SIGNED cell gaps, so a
	// ridgeline's overlapped rows pull the far edge back instead of stacking
	// as if the gap were 0. Sizing it as `rows × (override + full chrome)`
	// grew the canvas past the figure — scrollbars plus a band of empty
	// canvas under the last row (user-reported Oct 2026). Any spill ABOVE /
	// LEFT of the origin at extreme overlap is `ridgelineTopGrow` /
	// `ridgelineLeftGrow`'s job, so the far-edge measure alone is right here.
	const gridFromOverrideW =
		widthOverride != null && widthOverride > 0
			? (() => {
					const widths: number[] = []
					for (let c = 0; c < cols; c++) {
						const m = marginsAt(0, c)
						widths.push(widthOverride + m.left + m.right)
					}
					return gridFarEdge(widths, gridChrome.cellGapsX)
				})()
			: 0
	const gridFromOverrideH =
		heightOverride != null && heightOverride > 0
			? (() => {
					const heights: number[] = []
					for (let r = 0; r < rows; r++) {
						const m = marginsAt(r, 0)
						heights.push(heightOverride + m.top + m.bottom)
					}
					return gridFarEdge(heights, gridChrome.cellGapsY)
				})()
			: 0
	const finalGridW = Math.max(naturalGridW, gridFromOverrideW)
	const finalGridH = Math.max(naturalGridH, gridFromOverrideH)
	return {
		width: finalGridW + outerReserves.left + outerReserves.right,
		height: finalGridH + outerReserves.top + outerReserves.bottom,
	}
}

/** The big one. Pure function: SolverInput → FacetLayoutSpec. */
/** The per-panel facet title's rect for its placement, offsets folded in.
 *  Top: the band above the plot rect (`topY` is the resolved baseline —
 *  the single-line spot, or the polar mark hug). Left / right: the band at
 *  the cell's outer edge. A vertical side title reads bottom-to-top on the
 *  left (rotate -90) and top-to-bottom on the right (rotate 90), its
 *  baseline a quarter of the single-line band in from the band's inner
 *  edge so ascenders face outward; `verticalAlign` pins which end of the
 *  panel the text starts from. An upright side title aligns inside the
 *  padded band like a row-strip header and anchors its line box to the
 *  chosen panel edge (`verticalAnchor`). */
const placeFacetLabel = (
	fl: FacetLabelInput,
	side: FacetLabelSide,
	cell: Rect,
	inner: Rect,
	topY: number,
	facetLabelHeight: number,
	sideWidth: number,
	sideSingle: number,
	linesGrow: number,
): TextRect => {
	const ox = fl.offsetX ?? 0
	const oy = fl.offsetY ?? 0
	if (side === "top") {
		return {
			x: xForAlignment(fl.align, inner.x, inner.x + inner.width) + ox,
			y: topY + oy,
			textAnchor: textAnchorFor(fl.align),
			rotation: 0,
			width: inner.width,
			height: facetLabelHeight,
			growUp: true,
		}
	}
	const vAlign = fl.verticalAlign ?? "middle"
	const bandX = side === "left" ? cell.x : cell.x + cell.width - sideWidth
	const edgeY =
		vAlign === "top"
			? inner.y
			: vAlign === "bottom"
				? inner.y + inner.height
				: inner.y + inner.height / 2
	if (!fl.horizontal) {
		const x =
			side === "left"
				? bandX + sideWidth - sideSingle * 0.25
				: bandX + sideSingle * 0.25
		// rotate(-90) runs the text UP the panel, rotate(90) DOWN it, so the
		// anchor that pins the title to the panel's top edge is "end" on the
		// left and "start" on the right (and the reverse at the bottom).
		const textAnchor: TextAnchorSpec =
			vAlign === "middle"
				? "middle"
				: (side === "right") === (vAlign === "top")
					? "start"
					: "end"
		return {
			x: x + ox,
			y: edgeY + oy,
			textAnchor,
			rotation: side === "left" ? -90 : 90,
			width: sideWidth,
			height: inner.height,
			growUp: true,
		}
	}
	const x = xForAlignment(
		fl.align,
		bandX + FACET_SIDE_BAND_PAD,
		bandX + sideWidth - FACET_SIDE_BAND_PAD,
	)
	// Extra lines of an upright title stack along the panel: a top-anchored
	// title hangs its lines below, a bottom-anchored one stacks them up, and
	// a centered one drops by half the extra so the block stays centered.
	return {
		x: x + ox,
		y: edgeY + (vAlign === "middle" ? linesGrow / 2 : 0) + oy,
		textAnchor: textAnchorFor(fl.align),
		rotation: 0,
		width: sideWidth,
		height: inner.height,
		verticalAnchor: vAlign,
		growUp: vAlign !== "top",
	}
}

/** Axis-aligned extent of a title as the renderer draws it: `textWidth`
 *  wide from its anchor, one line box tall per line, rotated about (x, y)
 *  by the structural rotation or, at 0, the paint-time angle — the same
 *  precedence SharedText / StripHeaders apply. `vAnchor` is how the
 *  renderer anchors the line box vertically ("baseline" = the alphabetic
 *  baseline). The line box is the browser's glyph cell, not the ink —
 *  about 1em above an alphabetic baseline and 0.25em below for the
 *  system fonts (measured 0.98 / 0.23 in Chromium) — so the extents here
 *  use 1em / 0.3em and err on the side of keeping the title in. */
const textExtent = (
	rect: TextRect,
	textWidth: number,
	fontSize: number,
	lines: number,
	angleDeg: number,
	vAnchor: VerticalAlignment | "baseline",
): { minX: number; maxX: number; minY: number; maxY: number } => {
	const x0 =
		rect.textAnchor === "start"
			? rect.x
			: rect.textAnchor === "end"
				? rect.x - textWidth
				: rect.x - textWidth / 2
	const x1 = x0 + textWidth
	const extra = fontSize * TITLE_LINE_STEP_EM * Math.max(0, lines - 1)
	const block = fontSize + extra
	let y0: number
	let y1: number
	if (vAnchor === "top") {
		y0 = rect.y
		y1 = rect.y + block + fontSize * 0.3
	} else if (vAnchor === "middle") {
		y0 = rect.y - block / 2 - fontSize * 0.15
		y1 = rect.y + block / 2 + fontSize * 0.15
	} else {
		y0 = rect.y - fontSize - (rect.growUp ? extra : 0)
		y1 = rect.y + fontSize * 0.3 + (rect.growUp ? 0 : extra)
	}
	const angle = rect.rotation !== 0 ? rect.rotation : angleDeg
	if (!angle) return { minX: x0, maxX: x1, minY: y0, maxY: y1 }
	const rad = (angle * Math.PI) / 180
	const cos = Math.cos(rad)
	const sin = Math.sin(rad)
	let minX = Infinity
	let maxX = -Infinity
	let minY = Infinity
	let maxY = -Infinity
	for (const [cx, cy] of [
		[x0, y0],
		[x1, y0],
		[x0, y1],
		[x1, y1],
	]) {
		const dx = cx - rect.x
		const dy = cy - rect.y
		const rx = rect.x + dx * cos - dy * sin
		const ry = rect.y + dx * sin + dy * cos
		if (rx < minX) minX = rx
		if (rx > maxX) maxX = rx
		if (ry < minY) minY = ry
		if (ry > maxY) maxY = ry
	}
	return { minX, maxX, minY, maxY }
}

/** How far past each canvas edge any facet title (per-panel labels, the
 *  column / row header strips) would paint, or null when they all fit.
 *  Flush with an edge is fine — only ink past it counts. */
const facetTitleOverflow = (
	input: SolverInput,
	spec: FacetLayoutSpec,
): { top: number; bottom: number; left: number; right: number } | null => {
	let top = 0
	let bottom = 0
	let left = 0
	let right = 0
	const take = (e: ReturnType<typeof textExtent>) => {
		left = Math.max(left, -e.minX)
		right = Math.max(right, e.maxX - spec.canvas.width)
		top = Math.max(top, -e.minY)
		bottom = Math.max(bottom, e.maxY - spec.canvas.height)
	}
	const fl = input.facetLabel
	if (fl) {
		for (const p of spec.panels) {
			if (!p.facetLabel) continue
			take(
				textExtent(
					p.facetLabel,
					fl.textWidth ?? 0,
					fl.fontSize,
					fl.lines ?? 1,
					fl.angleDeg ?? 0,
					p.facetLabel.verticalAnchor ?? "baseline",
				),
			)
		}
	}
	input.columnHeaders?.forEach((h, i) => {
		const r = spec.columnHeaders[i]
		if (!r || r.width <= 0) return
		take(
			textExtent(
				r,
				h.textWidth ?? estimateLongestLineWidth(h.text, h.fontSize),
				h.fontSize,
				lineCount(h.text),
				h.angleDeg ?? 0,
				"middle",
			),
		)
	})
	input.rowHeaders?.forEach((h, i) => {
		const r = spec.rowHeaders[i]
		if (!r || r.height <= 0) return
		take(
			textExtent(
				r,
				h.textWidth ?? estimateLongestLineWidth(h.text, h.fontSize),
				h.fontSize,
				lineCount(h.text),
				h.angleDeg ?? 0,
				r.verticalAnchor ?? "middle",
			),
		)
	})
	const ceil = (n: number) => (n > 0.5 ? Math.ceil(n) : 0)
	const out = { top: ceil(top), bottom: ceil(bottom), left: ceil(left), right: ceil(right) }
	return out.top || out.bottom || out.left || out.right ? out : null
}

/** Solve the layout, keeping every facet title on the canvas (LAYOUT.md
 *  §8, "Facet-title keep-in-view"): after a first solve, any per-panel
 *  label or header-strip title whose drawn extent — offsets and rotation
 *  included — would leave the canvas grows the outer reserve on that side
 *  by the overshoot, and the layout is solved once more. The title keeps
 *  its place relative to its panel; the figure shrinks (fit mode) or the
 *  canvas grows (scroll mode) to make room, exactly like an axis title
 *  nudged away from the plot. */
export const solveFacetLayout = (rawInput: SolverInput): FacetLayoutSpec => {
	const first = solveOnce(rawInput)
	const over = facetTitleOverflow(rawInput, first)
	if (!over) return first
	return solveOnce({
		...rawInput,
		extraTopMargin: (rawInput.extraTopMargin ?? 0) + over.top,
		extraBottomMargin: (rawInput.extraBottomMargin ?? 0) + over.bottom,
		extraLeftMargin: (rawInput.extraLeftMargin ?? 0) + over.left,
		extraRightMargin: (rawInput.extraRightMargin ?? 0) + over.right,
	})
}

/** One solve. `solveFacetLayout` runs it once, then once more with grown
 *  outer reserves if a facet title would leave the canvas (keep-in-view). */
const solveOnce = (rawInput: SolverInput): FacetLayoutSpec => {
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
	// Per-panel facet-label band: the single-line band the caller pinned,
	// grown by one line step per extra line of the tallest panel label so a
	// wrapped label grows UP into the band rather than down into the panel
	// (every label's bottom line sits at the single-line position).
	// A side placement (Labels → Facet titles → Placement left / right)
	// moves the band beside the plot rect instead: the top band is not
	// reserved at all, and `facetSideWidth` joins the cell's left / right
	// chrome at its outer edge (see `cellMargins`). A vertical side title
	// grows the band OUTWARD by the same line step (its earlier lines stack
	// away from the plot); an upright one sits in a band the caller already
	// sized to its widest line, so extra lines stack along the panel.
	const facetSide: FacetLabelSide = input.facetLabel?.side ?? "top"
	const facetLabelLinesGrow = input.facetLabel
		? TITLE_LINE_STEP_EM *
			input.facetLabel.fontSize *
			Math.max(0, (input.facetLabel.lines ?? 1) - 1)
		: 0
	const facetBandSingle =
		facetSide === "top" ? (input.facetLabel?.height ?? 0) : 0
	const facetLabelHeight = facetBandSingle + facetLabelLinesGrow * (facetSide === "top" ? 1 : 0)
	const facetSideSingle =
		facetSide === "top"
			? 0
			: (input.facetLabel?.width ?? input.facetLabel?.height ?? 0)
	const facetSideWidth =
		facetSideSingle +
		(facetSide !== "top" && !input.facetLabel?.horizontal
			? facetLabelLinesGrow
			: 0)
	const facetSideLeft = facetSide === "left" ? facetSideWidth : 0
	const facetSideRight = facetSide === "right" ? facetSideWidth : 0
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
	// With row titles the y-title lives in its own band left of the strip
	// (yTitleOuterBand), so the leftmost cells give back the slot the base
	// margin holds for it — the floors below are then sized for tick labels
	// alone.
	const yTitleOutside = yTitleOutsideRowStrip(input)
	const cellMargin: CellMargin = {
		top: isPolarMode ? POLAR_MARGIN.top : BASE_MARGIN.top,
		right: isPolarMode ? POLAR_MARGIN.right : BASE_MARGIN.right,
		bottom:
			isPolarMode && !input.xTitle ? POLAR_MARGIN.bottom : BASE_MARGIN.bottom,
		left:
			isPolarMode && !input.yTitle
				? POLAR_MARGIN.left
				: yTitleOutside
					? Math.max(40, BASE_MARGIN.left - (yTitleFontSize + 24))
					: BASE_MARGIN.left,
	}

	const xAxisTop = input.xAxisTop === true
	const yAxisRight = input.yAxisRight === true
	const edges = computeEdgePositions(input.panels, xAxisTop, yAxisRight)
	// The row / column whose panels sit beside the shared axis titles — the
	// labels that size the title gaps come from there (LAYOUT.md §17).
	const xAxisRow = xAxisTop ? 0 : input.rows - 1
	const yAxisCol = yAxisRight ? input.cols - 1 : 0

	// Tick-label position nudges move ONLY the labels (Axes.tsx labelDx/
	// labelDy), so the labels' rendered edge shifts while the title's
	// default position wouldn't. Fold the toward-the-title component into
	// the title gaps below (y labels nudged LEFT, x labels nudged DOWN) so
	// each title keeps its fixed distance from where the labels actually
	// draw. The away component is ignored — titles never chase labels
	// inward.
	// The toward-the-title direction follows the axis's side: y labels move
	// toward a LEFT title when nudged left (-dx), toward a RIGHT one when
	// nudged right (+dx); x labels toward a BOTTOM title when nudged down
	// (+dy), toward a TOP one when nudged up (-dy).
	const yTickLabelDx = input.yTickLabelDx ?? 0
	const yLabelNudgeTowardTitle = Math.max(0, yAxisRight ? yTickLabelDx : -yTickLabelDx)
	// A tick mark longer than the default pushes the labels outward by the
	// difference (Axes.tsx insets labels by the tick length); fold that in
	// alongside the nudge so the title still clears the labels. Never
	// negative: a shorter tick doesn't pull the title inward.
	const xTickExtra = Math.max(
		0,
		(input.xTickLength ?? DEFAULT_TICKMARK_CONFIG.length) -
			DEFAULT_TICKMARK_CONFIG.length
	)
	const xTickLabelDy = input.xTickLabelDy ?? 0
	const xLabelNudgeTowardTitle =
		Math.max(0, xAxisTop ? -xTickLabelDy : xTickLabelDy) + xTickExtra

	const { left: estimatedLeftFloor, bottom: estimatedBottomFloor } =
		estimateGlobalFloors(
			input.panels,
			edges,
			yTitleOutside ? false : yTitleHorizontal,
			yTitleOutside ? "" : yTitleText,
			yTitleOutside ? 0 : yTitleFontSize,
			xTitleText,
			xTitleFontSize,
			xTitleLines,
			cellMargin.left,
			cellMargin.bottom
		)
	// `estimateExtraBottomMargin` doesn't know about the label nudge folded
	// into xTitleGap below; grow the bottom chrome to match so the pushed-
	// down title still fits inside the canvas.
	const bottomFloor =
		estimatedBottomFloor + (input.xTitle ? xLabelNudgeTowardTitle : 0)

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
	// The y-title sits beside the axis-edge column (leftmost, or rightmost
	// under yAxisRight), so its gap to the plot is sized by that column's
	// labels — not by a long label hiding in an interior column the title
	// doesn't sit next to.
	const longestYLabelChars = (() => {
		let max = 0
		for (const p of input.panels) {
			if (p.col !== yAxisCol) continue
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
			if (p.col !== yAxisCol) continue
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
	// Where the y tick labels' outer edge actually lands: Axes.tsx anchors
	// them (text-anchor end) at `-(tick.length + 4)` from the spine.
	const Y_LABEL_PAD = 4
	const yLabelInset =
		(input.yTickLength ?? DEFAULT_TICKMARK_CONFIG.length) + Y_LABEL_PAD
	const yTitleGap = input.yTitle
		? Math.max(
				// Floor for very short labels — keeps the title from sitting
				// directly on the plot edge.
				24 + yTitleFontSize / 2,
				input.yTitle.horizontal
					? longestYLabelPx + yLabelInset + TITLE_LABEL_GAP_PX
					: longestYLabelPx +
							yLabelInset +
							TITLE_LABEL_GAP_PX +
							yTitleFontSize / 2
			) + yLabelNudgeTowardTitle
		: 0
	// The x-title sits beyond the axis-edge row (bottom, or top under
	// xAxisTop), so the xTitleGap is sized from THAT row's x-tick labels —
	// same logic as yTitleGap above.
	// The vertical extent depends on rotation: horizontal (0°) is just
	// `fontSize × 1.4`; rotated labels are `labelWidth × |sin| +
	// fontSize × 1.4 × |cos|` — much taller. xTitleGap must clear this.
	const longestXLabelPx = (() => {
		let measuredMax = 0
		for (const p of input.panels) {
			if (p.row !== xAxisRow) continue
			if (p.xLabelMaxWidthPx != null && p.xLabelMaxWidthPx > measuredMax) {
				measuredMax = p.xLabelMaxWidthPx
			}
		}
		if (measuredMax > 0) return measuredMax
		let maxChars = 0
		for (const p of input.panels) {
			if (p.row !== xAxisRow) continue
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
			if (p.row !== xAxisRow) continue
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
			if (p.row !== xAxisRow) continue
			for (const l of p.xLabels) {
				const n = l.split("\n").length
				if (n > maxLines) maxLines = n
			}
		}
		return longestXLabelPx * sin + xTickFontSize * 1.4 * maxLines * cos
	})()
	// The title's own extent between its baseline and the label band: below
	// the plot the baseline sits an ascender (~fontSize) under the title's
	// top edge; above the plot (xAxisTop) only the descender hangs below the
	// baseline toward the labels.
	const xTitleExtent = (input.xTitle?.fontSize ?? 0) * (xAxisTop ? 0.25 : 1)
	const xTitleGap = input.xTitle
		? TICK_LINE_PAD +
			xLabelVerticalPx +
			TITLE_LABEL_GAP_PX +
			xTitleExtent +
			xLabelNudgeTowardTitle
		: 0

	// `estimateExtraLeftMargin` doesn't know about the extended yTitleGap
	// formula; for long labels it can leave plotLeft too close to the canvas
	// left edge, pushing the title against (or past) the edge. Bump
	// leftFloor so the title's center is at least MIN_TITLE_X from the edge.
	const MIN_TITLE_X = 12 + yTitleFontSize / 2
	const requiredLeftFloor = input.yTitle && !yTitleOutside
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
		outerReservesInitial.left +
			cellMargin.left +
			cellMargin.right +
			facetSideWidth +
			20,
	)
	// x-title: with the axis at the bottom the title wants
	// y = approxPlotBottom + xTitleGap + offsetY; if that lands above
	// VIEWPORT_BUFFER + ascender it would clamp to the top, and the excess
	// becomes a phase-3 TOP grow. With the axis on top (§17) the title wants
	// y = approxPlotTop - xTitleGap + offsetY and the mirror check runs
	// against the bottom edge (descender), growing the BOTTOM reserve.
	const xChromePx = cellMargin.bottom + bottomFloor
	const approxPlotBottom =
		approxCanvasH - outerReservesInitial.bottom - (xAxisTop ? cellMargin.top : xChromePx)
	const approxPlotTop =
		outerReservesInitial.top + facetLabelHeight + (xAxisTop ? xChromePx : cellMargin.top)
	const xTitleAscender = (input.xTitle?.fontSize ?? 0) * 0.8
	const xTitleDescender = (input.xTitle?.fontSize ?? 0) * 0.2
	const xTitleDesiredY = xAxisTop
		? approxPlotTop - xTitleGap + (input.xTitle?.offsetY ?? 0)
		: approxPlotBottom + xTitleGap + (input.xTitle?.offsetY ?? 0)
	const phase3TopGrowFromXTitle =
		input.xTitle && !xAxisTop
			? Math.max(0, VIEWPORT_BUFFER_PX + xTitleAscender - xTitleDesiredY)
			: 0
	const phase3BottomGrowFromXTitle =
		input.xTitle && xAxisTop
			? Math.max(
					0,
					xTitleDesiredY + xTitleDescender - (approxCanvasH - VIEWPORT_BUFFER_PX)
				)
			: 0

	// y-title (rotated): on the left the anchor wants
	// x = approxPlotLeft - yTitleGap + offsetX, and its bbox's right edge
	// (anchor + fontSize/2) past canvasW - VIEWPORT_BUFFER_PX becomes a
	// phase-3 RIGHT grow. On the right (§17) the anchor wants
	// x = approxPlotRight + yTitleGap + offsetX and the bbox's LEFT edge
	// short of the buffer becomes a LEFT grow.
	const yChromePx = cellMargin.left + leftFloor
	const approxPlotLeft =
		outerReservesInitial.left + (yAxisRight ? cellMargin.right : yChromePx)
	const approxPlotRight =
		approxCanvasW - outerReservesInitial.right - (yAxisRight ? yChromePx : cellMargin.right)
	const yTitleHalfBbox = (input.yTitle?.fontSize ?? 0) / 2
	const yTitleDesiredAnchor = yAxisRight
		? approxPlotRight + yTitleGap + (input.yTitle?.offsetX ?? 0)
		: approxPlotLeft - yTitleGap + (input.yTitle?.offsetX ?? 0)
	const phase3RightGrowFromYTitle =
		input.yTitle && !yTitleOutside && !yAxisRight
			? Math.max(
					0,
					yTitleDesiredAnchor + yTitleHalfBbox - (approxCanvasW - VIEWPORT_BUFFER_PX)
				)
			: 0
	const phase3LeftGrowFromYTitle =
		input.yTitle && yAxisRight
			? Math.max(0, VIEWPORT_BUFFER_PX - (yTitleDesiredAnchor - yTitleHalfBbox))
			: 0

	// Continuous x-axes anchor their edge ticks at the plot's edges, and an
	// unrotated tick label is centered on its tick — so ~half the label width
	// spills past `inner.x1` (and `inner.x0`). The far-side pad is only
	// `cellMargin.right` (BASE_MARGIN.right = 24), which a wide label like
	// "$140,000" overruns, clipping its last character. Reserve the overhang
	// beyond that pad so the plot shrinks (fit mode) enough for the label to
	// render fully. By default the y chrome covers the left spill and the
	// pad sits on the right; under yAxisRight (§17) they swap, so the LEFT
	// spill is what needs the reserve. Axis-row panels only — interior rows
	// don't draw x-axis labels under shareX.
	const xTickOverhang = (() => {
		let maxOverhang = 0
		for (const p of input.panels) {
			if (p.row !== xAxisRow) continue
			if (!p.xAxisContinuous) continue
			const w = p.xLabelMaxWidthPx ?? 0
			if (w <= 0) continue
			// How far the edge label reaches past its tick on the pad side.
			// Unrotated labels are middle-anchored → half the width. A rotated
			// label hangs entirely to one side of its tick: below the axis a
			// negative angle is end-anchored (leans up-left → all of its
			// horizontal projection extends LEFT) and a positive one
			// start-anchored (extends RIGHT); above the axis (xAxisTop) the
			// anchors flip so the text still leans away from the axis.
			// Mirrors the anchor logic in Axes.tsx.
			const angle = p.xLabelAngleDeg
			const projection = w * Math.abs(Math.cos((angle * Math.PI) / 180))
			const extendsRight = angle === 0 ? w / 2 : (angle > 0) !== xAxisTop ? projection : 0
			const extendsLeft = angle === 0 ? w / 2 : (angle < 0) !== xAxisTop ? projection : 0
			const extentRaw = yAxisRight ? extendsLeft : extendsRight
			// A couple px of breathing room so the reserve never lands
			// exactly on the last glyph's edge — measureText excludes the
			// trailing side bearing, and subpixel/antialiased rendering can
			// otherwise still nibble the final character.
			const extent = extentRaw > 0 ? extentRaw + 3 : 0
			const overhang = Math.max(0, extent - cellMargin.right)
			if (overhang > maxOverhang) maxOverhang = overhang
		}
		return maxOverhang
	})()

	const outerReserves = {
		...outerReservesInitial,
		top: outerReservesInitial.top + phase3TopGrowFromXTitle,
		bottom: outerReservesInitial.bottom + phase3BottomGrowFromXTitle,
		// Take the max, not the sum: the data-label reserve, the y-title
		// phase-3 grow, and the x-tick overhang all reserve canvas space
		// beside the grid, so the largest single demand covers them all.
		// The overhang lands on whichever side carries the far pad; the
		// y-title's side is left alone (its grow may be NEGATIVE — a
		// toward-the-plot offset extends the plot into the title chrome,
		// §8 — and a max would clamp that away).
		left: yAxisRight
			? Math.max(outerReservesInitial.left + phase3LeftGrowFromYTitle, xTickOverhang)
			: outerReservesInitial.left + phase3LeftGrowFromYTitle,
		right: yAxisRight
			? outerReservesInitial.right + phase3RightGrowFromYTitle
			: Math.max(outerReservesInitial.right + phase3RightGrowFromYTitle, xTickOverhang),
	}

	// Floor canvas dims: unmeasured (0×0) renders shouldn't compute negative
	// inner rects. Mirror the floors in computePlotLayout: just-above margin
	// sum so the panel renders an empty plot rather than crashing.
	const minCanvasW =
		outerReserves.left + cellMargin.left + cellMargin.right + facetSideWidth + 20
	const minCanvasH =
		outerReserves.top +
		outerReserves.bottom +
		facetLabelHeight +
		cellMargin.top +
		cellMargin.bottom +
		20

	const marginsAt: CellMarginsAt = (row, col) =>
		cellMargins(
			row,
			col,
			input.rows,
			input.cols,
			input.shareX,
			input.shareY,
			facetLabelHeight,
			facetSideLeft,
			facetSideRight,
			leftFloor,
			bottomFloor,
			interiorBottomChromePerRow,
			interiorLeftChromePerCol,
			edges,
			cellMargin,
			xAxisTop,
			yAxisRight
		)
	const gridChrome = computeGridChrome(
		input.rows,
		input.cols,
		input.gapX,
		input.gapY,
		marginsAt
	)

	// Natural dims: if container is too small to honor minPanelPx etc., the
	// canvas grows beyond container and scroll is emitted.
	const natural = estimateNaturalDims(
		input,
		outerReserves,
		leftFloor,
		bottomFloor,
		facetLabelHeight,
		facetSideWidth,
		cellMargin,
		marginsAt,
		gridChrome
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
				const totalGaps = Math.max(0, input.gapY) * (input.rows - 1)
				return (
					requiredInner +
					gridChrome.edgeY +
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
				const totalGaps = Math.max(0, input.gapX) * (input.cols - 1)
				return (
					requiredInner +
					gridChrome.edgeX +
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
		gridChrome,
		colWeights,
		rowWeights,
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
		const m = marginsAt(0, c)
		cellWidths.push((safeInnerWidths[c] ?? 0) + m.left + m.right)
	}
	const cellHeights: number[] = []
	for (let r = 0; r < input.rows; r++) {
		const m = marginsAt(r, 0)
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
			cellOrigin(input.cols - 1, cellWidths, gridChrome.cellGapsX) +
			(cellWidths[input.cols - 1] ?? 0)
		const usedH =
			cellOrigin(input.rows - 1, cellHeights, gridChrome.cellGapsY) +
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
		const rawCellX =
			gridOriginX + cellOrigin(p.col, cellWidths, gridChrome.cellGapsX)
		const rawCellY =
			naturalGridOriginY + cellOrigin(p.row, cellHeights, gridChrome.cellGapsY)
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
	const shrinkWidths =
		input.proportionalSizing &&
		!(input.panelWidthOverride != null && input.panelWidthOverride > 0)
	const shrinkHeights =
		input.proportionalSizing &&
		!(input.panelHeightOverride != null && input.panelHeightOverride > 0)
	const weightFrac = (w: number, max: number | undefined): number =>
		max != null && max > 0 ? Math.min(1, Math.max(0, w / max)) : 1
	const panels: SolverPanelOutput[] = input.panels.map((p) => {
		const cellX =
			adjustedGridOriginX + cellOrigin(p.col, cellWidths, gridChrome.cellGapsX)
		const cellY =
			gridOriginY + cellOrigin(p.row, cellHeights, gridChrome.cellGapsY)
		const cell: Rect = {
			x: cellX,
			y: cellY,
			width: cellWidths[p.col] ?? 0,
			height: cellHeights[p.row] ?? 0,
		}
		const m = marginsAt(p.row, p.col)
		// Per-panel sizing within a row / column: the row's height comes
		// from its largest-weight panel (rowWeights is the max), so a panel
		// with a smaller weight is drawn shorter than its cell —
		// bottom-aligned, so x axes across the row share one baseline.
		// Columns mirror it: narrower, left-aligned (y axes line up). One
		// px-per-unit holds across the whole figure. A pixel override
		// pins every panel to the same size, so it skips the shrink.
		const fullInnerW = safeInnerWidths[p.col] ?? 0
		const fullInnerH = safeInnerHeights[p.row] ?? 0
		const xFrac = shrinkWidths ? weightFrac(p.xWeight, colWeights[p.col]) : 1
		const yFrac = shrinkHeights ? weightFrac(p.yWeight, rowWeights[p.row]) : 1
		const innerH = fullInnerH * yFrac
		const yDrop = fullInnerH - innerH
		const inner: Rect = {
			x: cellX + m.left,
			y: cellY + m.top + yDrop,
			width: fullInnerW * xFrac,
			height: innerH,
		}
		// Wrap-mode per-panel label sits in the reserved band at the cell
		// top: its BOTTOM line a quarter of the single-line band above the
		// band's bottom edge (the single-line spot, 0.75 × band from the
		// top), earlier lines stacking up into the band's grown room.
		// For polar (radar / pie) the centered circular mark floats in
		// the vertical middle of a tall panel, leaving the top-pinned label
		// stranded far above it (user-reported June 2026). Pull the label
		// down to hug the mark's top edge — but never ABOVE its natural band
		// position (clamp), so densely-packed multi-row wraps are unaffected.
		// Follows a shortened panel's top edge (yDrop) so the label stays
		// attached to its panel rather than the row's tallest one.
		const naturalFacetLabelY =
			cellY + yDrop + facetLabelHeight - facetBandSingle * 0.25
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
			? placeFacetLabel(
					input.facetLabel,
					facetSide,
					cell,
					inner,
					facetLabelY,
					facetLabelHeight,
					facetSideWidth,
					facetSideSingle,
					facetLabelLinesGrow,
				)
			: null
		return {
			key: p.key,
			row: p.row,
			col: p.col,
			cell,
			inner,
			facetLabel,
			// Under shareX, only the filled panel nearest the x axis's edge in
			// each column renders the x-axis (bottom-most by default, top-most
			// under xAxisTop). For a fully populated grid this is just the
			// edge row; for wrap with an uneven last row, the second-to-last
			// row's panel takes over in columns whose last cell is empty.
			// Mirror for showYTicks (leftmost / rightmost under yAxisRight).
			showXTicks:
				!input.shareX || p.row === edges.xAxisRowPerCol.get(p.col),
			showYTicks:
				!input.shareY || p.col === edges.yAxisColPerRow.get(p.row),
			showXAxisTitle: false,
			showYAxisTitle: false,
		}
	})

	// Shared title rects, anchored to the plot-grid spans (so left/right
	// alignment matches the actual plot edges, not the canvas edges).
	const edgeMargins = marginsAt(0, 0)
	const plotLeft = min(panels, (p) => p.inner.x) ?? gridOriginX + edgeMargins.left
	const plotRight =
		max(panels, (p) => p.inner.x + p.inner.width) ?? canvasW - edgeMargins.right
	const plotTop = min(panels, (p) => p.inner.y) ?? gridOriginY + edgeMargins.top
	const plotBottom =
		max(panels, (p) => p.inner.y + p.inner.height) ?? canvasH - edgeMargins.bottom

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
	// Chart-level titles keep their aligned anchor unless the text would
	// leave the figure; then they slide just far enough to stay in view —
	// into the legend band past the canvas edge when there is one
	// (`titleOverhang`). Scroll mode has no such band: its box clips at the
	// container, so the overhang only counts when the canvas fits.
	const titleOverhang = scroll
		? NO_TITLE_OVERHANG
		: (input.titleOverhang ?? NO_TITLE_OVERHANG)
	const titleAnchorX = (t: SharedTitleInput, offsetX: number): number => {
		const x = xForAlignment(t.align, plotLeft, plotRight) + offsetX
		return t.textWidth
			? clampTitleAnchorX(
					x,
					textAnchorFor(t.align),
					t.textWidth,
					canvasW,
					titleOverhang,
				)
			: x
	}
	const title: TextRect | null = input.chartTitle
		? {
				x: titleAnchorX(input.chartTitle, titleOffsetX),
				// `y` is the BOTTOM line: the single line's natural baseline
				// pushed down by the room the extra lines reserved above it, so
				// it keeps the single line's distance to the subtitle / plot and
				// the earlier lines stack up into that room.
				y: clampBaselineY(
					titleReserve(input.chartTitle.fontSize) * 0.7 +
						outerReserves.titleLinesGrow +
						titleOffsetY +
						outerReserves.titleAwayGrow,
					input.chartTitle.fontSize,
					canvasH,
					outerReserves.titleLinesGrow,
				),
				textAnchor: textAnchorFor(input.chartTitle.align),
				rotation: 0,
				width: plotRight - plotLeft,
				height: outerReserves.titleHeight,
				growUp: true,
			}
		: null
	const subtitle: TextRect | null = input.chartSubtitle
		? {
				x: titleAnchorX(input.chartSubtitle, subOffsetX),
				y: clampBaselineY(
					// The subtitle hangs below the title band — font-derived (and
					// grown for the title's extra lines) when a title is present,
					// the fixed reserve otherwise (matching computeOuterReserves'
					// 0-height band for a missing title). Bottom line, like the
					// title: pushed down by its own extra lines' room.
					(input.chartTitle ? outerReserves.titleHeight : TITLE_RESERVE) +
						subtitleReserve(input.chartSubtitle.fontSize) * 0.75 +
						outerReserves.subtitleLinesGrow +
						subOffsetY +
						outerReserves.subtitleAwayGrow,
					input.chartSubtitle.fontSize,
					canvasH,
					outerReserves.subtitleLinesGrow,
				),
				textAnchor: textAnchorFor(input.chartSubtitle.align),
				rotation: 0,
				width: plotRight - plotLeft,
				height: outerReserves.subtitleHeight,
				growUp: true,
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
		? xAxisTop
			? {
					x:
						xForAlignment(input.xTitle.align, plotLeft, plotRight) + xTOffsetX,
					// §17: above the plot the title's LAST line sits `xTitleGap`
					// above plotTop and earlier lines stack upward (`growUp`).
					// The same offset compensation as below holds in mirror: a
					// negative (away = up) offsetY grew the TOP reserve, so adding
					// it here keeps the title's absolute y put while the plot
					// moves down; a positive offset shifts the title down freely.
					y: clampBaselineY(
						plotTop - xTitleGap + xTOffsetY,
						input.xTitle.fontSize,
						canvasH,
						extraLinesPx(input.xTitle.text, input.xTitle.fontSize),
					),
					textAnchor: textAnchorFor(input.xTitle.align),
					rotation: 0,
					width: plotRight - plotLeft,
					height: outerReserves.xTitleHeight,
					growUp: true,
				}
			: {
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
	// Outside y-title: right edge of its block sits Y_TITLE_STRIP_GAP left
	// of the row strip (which follows the figureSlack-centered grid).
	const yTitleOutsideRight =
		outerReserves.left +
		figureSlackX / 2 -
		(input.rowHeaderWidth ?? 80) -
		Y_TITLE_STRIP_GAP
	const yTitle: TextRect | null = input.yTitle
		? yTitleOutside
			? input.yTitle.horizontal
				? {
						x: horizontalYTitleAnchorX(
							input.yTitle.align,
							yTitleOutsideRight + yTOffsetX,
							estimateLongestLineWidth(input.yTitle.text, input.yTitle.fontSize),
						),
						y:
							horizontalYTitleBaselineY(
								plotTop,
								plotBottom,
								input.yTitle.fontSize,
								lineCount(input.yTitle.text),
							) + yTOffsetY,
						textAnchor: textAnchorFor(input.yTitle.align),
						rotation: 0,
						width: yTitleOuterBand(input),
						height: input.yTitle.fontSize * 1.2,
					}
				: {
						// Rotated -90°, extra lines stack toward the strip, so the
						// anchor (first line's center) sits that many lines out.
						x: clampRotatedTitleX(
							yTitleOutsideRight -
								input.yTitle.fontSize * 1.2 * (lineCount(input.yTitle.text) - 1) -
								input.yTitle.fontSize / 2 +
								yTOffsetX,
							input.yTitle.fontSize,
							canvasW,
						),
						y:
							(input.yTitle.align === "left"
								? plotBottom
								: input.yTitle.align === "right"
									? plotTop
									: (plotTop + plotBottom) / 2) + yTOffsetY,
						textAnchor: textAnchorFor(input.yTitle.align),
						rotation: -90,
						width: input.yTitle.fontSize * 1.2,
						height: plotBottom - plotTop,
					}
			: yAxisRight
				? input.yTitle.horizontal
					? {
							// §17 right-side upright title: the block's LEFT edge lands
							// at `plotRight + yTitleGap`, just right of the tick labels,
							// and the text extends rightward into the reserved chrome.
							// Alignment moves the anchor within that fixed box.
							x: horizontalYTitleAnchorXFromLeft(
								input.yTitle.align,
								clampHorizontalYTitleLeftX(
									plotRight + yTitleGap + yTOffsetX,
									estimateLongestLineWidth(input.yTitle.text, input.yTitle.fontSize),
									canvasW,
								),
								estimateLongestLineWidth(input.yTitle.text, input.yTitle.fontSize),
							),
							y:
								horizontalYTitleBaselineY(
									plotTop,
									plotBottom,
									input.yTitle.fontSize,
									lineCount(input.yTitle.text),
								) + yTOffsetY,
							textAnchor: textAnchorFor(input.yTitle.align),
							rotation: 0,
							width: yTitleGap,
							height: input.yTitle.fontSize * 1.2,
						}
					: {
							// §17 right-side rotated title: still -90° (reads bottom-to-
							// top on both sides, so "left" starts at the panel floor and
							// "right" ends at the ceiling exactly as on the left), centered
							// `yTitleGap` right of the plot. A positive (away) offsetX
							// grew the right reserve, so adding it keeps the title put.
							x: clampRotatedTitleX(
								plotRight + yTitleGap + yTOffsetX,
								input.yTitle.fontSize,
								canvasW,
							),
							y:
								(input.yTitle.align === "left"
									? plotBottom
									: input.yTitle.align === "right"
										? plotTop
										: (plotTop + plotBottom) / 2) + yTOffsetY,
							textAnchor: textAnchorFor(input.yTitle.align),
							rotation: -90,
							width: input.yTitle.fontSize * 1.2,
							height: plotBottom - plotTop,
						}
			: input.yTitle.horizontal
			? {
					// Horizontal title: the block's RIGHT EDGE lands at
					// `plotLeft - yTitleGap`, just left of the tick labels, and
					// the text body extends leftward into the chrome
					// `estimateExtraLeftMargin` reserved for it. Alignment moves
					// the anchor within that fixed box, not the box.
					x: horizontalYTitleAnchorX(
						input.yTitle.align,
						clampHorizontalYTitleX(
							plotLeft - yTitleGap + yTOffsetX,
							longestYLabelPx > 0 ? longestYLabelPx : input.yTitle.fontSize * 6,
							canvasW,
						),
						estimateLongestLineWidth(input.yTitle.text, input.yTitle.fontSize),
					),
					y:
						horizontalYTitleBaselineY(
							plotTop,
							plotBottom,
							input.yTitle.fontSize,
							lineCount(input.yTitle.text),
						) + yTOffsetY,
					textAnchor: textAnchorFor(input.yTitle.align),
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
					// Anchor per alignment, exactly like the x-title: rotated -90°
					// the text reads bottom-to-top, so "start" begins at the panel
					// FLOOR and "end" finishes at the panel TOP. A hardcoded
					// "middle" would center the title on that edge instead, leaving
					// half the words hanging past the panel.
					textAnchor: textAnchorFor(input.yTitle.align),
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
			// Ridgeline overlap (LAYOUT.md §10): with a negative gap the rows'
			// plot rects stack over one another, so most of a row's rect is
			// also the rect of the ridges behind and in front of it — a title
			// placed against that full rect lands inside a neighbour's ridge
			// (user-reported Oct 2026: the titles bunched at the top of the
			// stack while the ridges sat lower). The only band that is this
			// row's alone is the slice between the previous ridge's baseline
			// and its own, so top / middle / bottom align the title's line
			// box within that slice instead: bottom sits ON the baseline (the
			// classic ridgeline label), top hangs just under the ridge above.
			// The first row borrows the step below it so every row reads the
			// same. Only when the plot rects really overlap (the step is
			// shorter than the rect); at extreme overlap the rows reverse and
			// the slice is meaningless, so the full-rect placement stays.
			const baselineOf = (pp: SolverPanelOutput) => pp.inner.y + pp.inner.height
			const baseline = baselineOf(p)
			const prevRow = panels.find((pp) => pp.row === rowIdx - 1)
			const nextRow = panels.find((pp) => pp.row === rowIdx + 1)
			const ridgeStep = prevRow
				? baseline - baselineOf(prevRow)
				: nextRow
					? baselineOf(nextRow) - baseline
					: 0
			const ridgeSlice =
				input.gapY < 0 && ridgeStep > 0 && ridgeStep < p.inner.height
					? ridgeStep
					: null
			const innerCenterY =
				ridgeSlice != null
					? vAlign === "top"
						? baseline - ridgeSlice
						: vAlign === "bottom"
							? baseline
							: baseline - ridgeSlice / 2
					: vAlign === "top"
						? p.inner.y + yInset
						: vAlign === "bottom"
							? p.inner.y + p.inner.height - yInset
							: p.inner.y + p.inner.height / 2
			// Centred, matching the y-tick labels' baseline — except inside a
			// ridgeline slice, where the line box is flush with the slice edge
			// it was aligned to (hanging under the top, sitting on the baseline).
			const vAnchor: VerticalAlignment = ridgeSlice != null ? vAlign : "middle"
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
