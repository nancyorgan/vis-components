import type { PlotInner } from "./plotLayout"

/** Shared prop contracts for every chart-mode renderer.
 *
 *  Each chart-type component (`ScatterPlot`, `BarPlot`, `AreaPlot`,
 *  `PiePlot`, `TilePlot`) extends one of the types below to take a
 *  consistent set of inputs from PlotCanvas, the chart canvas, and
 *  any host that drops a chart into a custom layout. Centralizing the
 *  shape here prevents the silent contract drift the audit flagged —
 *  e.g. one renderer defaulting `showXAxisTitle` to `undefined` while
 *  the other three defaulted to `true`.
 *
 *  The hierarchy:
 *
 *      ChartRendererBaseProps
 *          ├── (PiePlot)
 *          └── CartesianRendererProps
 *                  ├── (TilePlot is roughly here, with per-axis rows)
 *                  ├── MeasureAxisRendererProps (BarPlot, AreaPlot)
 *                  └── ScatterRendererProps (ScatterPlot)
 *
 *  Renderers with a specialized prop (e.g. ScatterPlot's per-axis
 *  numeric domain overrides) compose by intersecting these types. */

/** The minimum every chart renderer accepts. Faceted panels override
 *  `rowsOverride` to render a subset; `titleOverride` / `subtitleOverride`
 *  let PlotCanvas suppress the per-panel title in favor of one shared
 *  title outside the grid. */
export type ChartRendererBaseProps = {
	/** Rows to render. When unset, falls back to the current dataset's
	 *  rows from Jotai. */
	rowsOverride?: Array<Record<string, unknown>>
	/** Rows used to compute scale DOMAINS (categories, max/min, hue
	 *  categories, etc.). When unset, falls back to `rowsOverride`.
	 *  Faceting with shared axes passes the full dataset here so domains
	 *  align across panels. */
	scalesRowsOverride?: Array<Record<string, unknown>>
	/** Hide / show the x and y axes (ticks, spine, labels). */
	showXAxis?: boolean
	showYAxis?: boolean
	/** Override the chart-level title. `null` suppresses it entirely.
	 *  `undefined` falls back to the labels-panel title. */
	titleOverride?: string | null
	subtitleOverride?: string | null
	/** Plot rect in canvas coordinates. The renderer builds scales against
	 *  this rect and emits SVG fragments into the parent `<svg>`. The
	 *  parent (PlotCanvas) owns the outer `<svg>` element, title
	 *  rendering, measurement, and tooltip overlay positioning.
	 *
	 *  Optional only to support unit tests that mount a renderer in
	 *  isolation without a canvas wrapper — in that case `Plot` falls
	 *  back to `DEFAULT_RENDERER_INNER` from `plotLayout.ts`. In
	 *  production paths, PlotCanvas always passes an explicit rect. */
	inner?: PlotInner
}

/** Adds the cartesian-only concerns shared by Scatter / Bar / Area / Tile:
 *  axis-title suppression and the per-panel margin floor that lets
 *  PlotCanvas align axes across panels. */
export type CartesianRendererProps = ChartRendererBaseProps & {
	/** Hide just the axis TITLE (ticks + spine still render via
	 *  `showXAxis` / `showYAxis`). PlotCanvas uses these to suppress
	 *  per-panel titles in favor of one shared title outside the grid.
	 *  Default behavior when unset: `true` (title renders). */
	showXAxisTitle?: boolean
	showYAxisTitle?: boolean
	/** Minimum extra margin (px) the renderer must reserve on the left
	 *  and bottom. PlotCanvas passes the row-/column-max across all
	 *  panels so axis spines align even when each panel's own data would
	 *  call for a smaller margin. */
	extraMarginFloorLeft?: number
	extraMarginFloorBottom?: number
	/** When set, anchors the FIRST and LAST categorical / string-ordinal
	 *  tick of that axis at a fixed pixel offset from each plot-area edge —
	 *  instead of the default `padding(0.5)` behavior where the first tick
	 *  lands at `step/2` from the edge (i.e. scales with N and plot size).
	 *
	 *  PlotCanvas sets an axis's offset ONLY when the chart is faceted AND
	 *  that axis is SHARED across panels (share mode ≠ "none") — shared
	 *  categorical axes need their first/last ticks at the same absolute
	 *  position in every panel or the title-to-first-tick distance drifts
	 *  with each panel's category count. When the axis is NOT shared, each
	 *  panel owns its own category set, cross-panel alignment is
	 *  meaningless, and pinning a sparse panel's two categories to the far
	 *  edges just looks stretched — so the offset stays undefined and the
	 *  historical `padding(0.5)` spacing applies per panel. Standalone
	 *  (non-faceted) charts leave both undefined. */
	firstTickPxOffsetX?: number
	firstTickPxOffsetY?: number
}

/** Adds per-axis scale-row overrides — Scatter and Tile share one axis
 *  while keeping the other per-panel. */
export type PerAxisScalesRendererProps = CartesianRendererProps & {
	/** Override `scalesRowsOverride` for the x-axis ONLY. Set by
	 *  PlotCanvas when `shareX` is true but `shareY` is not. */
	scalesRowsOverrideX?: Array<Record<string, unknown>>
	scalesRowsOverrideY?: Array<Record<string, unknown>>
}

/** Adds upper/lower bounds for the renderer's single "measure axis"
 *  (Bars / Areas have one categorical and one quantitative axis; the
 *  override sets the quantitative one). Extends the per-axis scale-row
 *  overrides too: the categorical axis can be shared while the measure
 *  axis isn't (and vice versa), so Bar/Area read `scalesRowsOverrideX/Y`
 *  for their categorical axis the same way Scatter/Tile do. */
export type MeasureAxisRendererProps = PerAxisScalesRendererProps & {
	/** Upper bound for the measure axis. PlotCanvas with shared axes
	 *  sets this to the max across panels so y-axes match. */
	measureMaxOverride?: number
	/** Lower bound for the measure axis. Defaults to 0 (the bar-/area-
	 *  baseline convention) when unset. */
	measureMinOverride?: number
	/** Histogram measure-color (Fill color / opacity varying by Count /
	 *  Density): the GLOBAL domain max every panel's bars AND the legend
	 *  ramp share. PlotCanvas sets it (via `histogramMeasureColorDomain`)
	 *  whenever a measure-color source is active, so per-panel bar fills
	 *  stay comparable across facets and match the single legend gradient
	 *  regardless of measure-axis share mode or pinned axis bounds. Unset →
	 *  BarPlot falls back to its own panel-local `measureMax` (standalone
	 *  renders / tests). */
	measureColorMaxOverride?: number
}

/** Scatter's specialized form: per-axis quantitative domain overrides on
 *  TOP of the per-axis scale-row overrides. */
export type ScatterRendererProps = PerAxisScalesRendererProps & {
	/** Per-axis numeric bounds. Only honored when the mapped field's
	 *  type is quantitative (or numeric-ordinal). */
	xMinOverride?: number
	xMaxOverride?: number
	yMinOverride?: number
	yMaxOverride?: number
}

/** The CLOSED superset of everything PlotCanvas passes to a renderer —
 *  the union of every family above plus the polar-only extras. This is
 *  the value type of `MODE_RENDERERS` (components/viz/rendererRegistry.ts),
 *  so the per-panel dispatch call
 *  (`<Renderer {...rendererProps} />`) typechecks against every
 *  registered renderer via parameter contravariance: a renderer may
 *  accept any SUBSET of these props (all optional; it ignores the
 *  rest), but a renderer prop that drifts incompatibly — or a
 *  PlotCanvas prop that isn't declared here — is a compile error
 *  instead of the silent mismatch the old `@ts-expect-error` allowed.
 *
 *  Adding a new PlotCanvas→renderer prop = add it here (optional),
 *  then consume it in the renderers that care. */
export type UniversalRendererProps = MeasureAxisRendererProps &
	ScatterRendererProps & {
		/** Polar-only R-axis domain bounds (RadarPlot; faceted polar
		 *  strips pin the shared R scale). Cartesian renderers ignore. */
		rMinOverride?: number
		rMaxOverride?: number
		/** Polar-only "size panels by unit" radius factor (0..1] for
		 *  RadarPlot / PiePlot. Undefined / 1.0 = no shrinking. */
		radiusScale?: number
	}
