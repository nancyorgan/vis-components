export const BASE_MARGIN = { top: 16, right: 24, bottom: 64, left: 76 } as const
/** Compact per-cell chrome for polar panels (radar / pie). Polar charts
 *  don't draw cartesian axes — the angle ticks and r-axis ticks sit
 *  INSIDE the inner rect, around the circle, and the renderer reserves
 *  its own perimeter padding for them. So the cell chrome only needs a
 *  small breathing margin instead of the 64/76 reserves cartesian cells
 *  use to fit axis labels + titles. Sides with a shared x-title /
 *  y-title (pies-x / pies-y) still fall back to BASE_MARGIN on that
 *  side — see `solveFacetLayout`'s per-side resolution. */
export const POLAR_MARGIN = { top: 4, right: 8, bottom: 8, left: 8 } as const
export const TITLE_RESERVE = 36
export const SUBTITLE_RESERVE = 22

/** Sensible default plot rect for renderers used in isolation (e.g.,
 *  unit tests that mount BarPlot / ScatterPlot directly without going
 *  through PlotCanvas). In production, PlotCanvas always passes an
 *  explicit `inner` from the solver — this constant is the fallback
 *  for callers that don't. Sized to a 600×400 container minus default
 *  margins. */
export const DEFAULT_RENDERER_INNER = {
	x0: BASE_MARGIN.left,
	y0: BASE_MARGIN.top,
	x1: 600 - BASE_MARGIN.right,
	y1: 400 - BASE_MARGIN.bottom,
} as const

export type PlotInner = { x0: number; y0: number; x1: number; y1: number }
export type PlotLayout = {
	width: number
	height: number
	inner: PlotInner
	titleY: number
	subtitleY: number
}

/** Per-side additive margin overrides — renderers compute estimates via
 * `lib/estimateMargins.ts` and pass them to the layout solver when their
 * tick labels or axis titles need more room than the default reserve. */
export type ExtraMargin = {
	top?: number
	right?: number
	bottom?: number
	left?: number
}

/** Compute the plot layout from measured SVG bounds plus title/subtitle presence.
 * Always reserves the full BASE_MARGIN on every side — axis-hiding in faceted
 * panels is handled by the Axis component's `showTicksAndLabels` prop, not by
 * collapsing margins (prior attempts at margin collapsing caused inconsistent
 * inner plot dimensions across facet panels, making bar widths differ).
 *
 * `extraMargin` adds *more* room — never less. Callers compute these when
 * their label content (long category names, multiline axis titles, etc.)
 * exceeds the default reserve.
 */
export const computePlotLayout = (
	bounds: { width: number; height: number },
	hasTitle: boolean,
	hasSubtitle: boolean,
	extraMargin: ExtraMargin = {}
): PlotLayout => {
	// Floors guard against the initial unmeasured render (useMeasure returns
	// {0, 0} on first paint) producing negative inner dimensions. Set the
	// floor to JUST ABOVE the margin sum so an unmeasured panel renders an
	// empty plot but doesn't compute inner.y1 < inner.y0.
	//
	// CRITICAL: do NOT raise these floors above the natural minimum panel
	// height. A floor of 200 on height was the source of a faceted-chart
	// layout bug: panels with low category counts (proportional sizing
	// gave them ~120-150px) had their SVG height clamped to 200, expanding
	// the inner plot area beyond what the panel container could show. The
	// band/point scale spread its single tick across the expanded plot,
	// producing a visible "single-category panel's title sits 2 lines
	// above the gridline" while multi-category panels' titles sit 1 line
	// above. The clamp is what made the offsets diverge.
	const minWidth = BASE_MARGIN.left + BASE_MARGIN.right + 20
	const minHeight = BASE_MARGIN.top + BASE_MARGIN.bottom + 20
	const width = Math.max(minWidth, bounds.width)
	const height = Math.max(minHeight, bounds.height)
	const titleExtra = hasTitle ? TITLE_RESERVE : 0
	const subtitleExtra = hasSubtitle ? SUBTITLE_RESERVE : 0
	const topOffset = titleExtra + subtitleExtra
	const left = BASE_MARGIN.left + Math.max(0, extraMargin.left ?? 0)
	const right = BASE_MARGIN.right + Math.max(0, extraMargin.right ?? 0)
	const top = BASE_MARGIN.top + topOffset + Math.max(0, extraMargin.top ?? 0)
	const bottom = BASE_MARGIN.bottom + Math.max(0, extraMargin.bottom ?? 0)
	const inner: PlotInner = {
		x0: left,
		y0: top,
		x1: width - right,
		y1: height - bottom,
	}
	const titleY = titleExtra ? titleExtra * 0.7 : 0
	const subtitleY = titleExtra + (subtitleExtra ? subtitleExtra * 0.75 : 0)
	return { width, height, inner, titleY, subtitleY }
}
