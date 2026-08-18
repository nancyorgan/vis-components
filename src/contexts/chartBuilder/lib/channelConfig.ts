// Per-channel configuration for each encoding. Configs are SPARSE — if a channel
// isn't in the map, defaults are used. Each channel's shape is independent.

import type { GradientInterpolation } from "./colorInterpolate"
import type { DrawOrderConfig } from "./drawOrder"
import type { FontConfig, LabelAlignment } from "./labelsConfig"

export type GridlineConfig = {
	enabled: boolean
	color: string
	thickness: number // px
	/** Gridline count. `null` means "match the axis tick count" (one gridline
	 * per labeled tick) — this is the default and what users most often want.
	 * Set to a specific number to decouple from ticks. */
	count: number | null
	/** User-pinned gridline positions on a continuous axis — the gridline
	 * counterpart of `AxisConfig.breaks`. Plain axis values (epoch-ms for
	 * temporal). When non-empty these win over `count` entirely. Optional so
	 * visuals saved before it existed load unchanged. */
	breaks?: number[]
}

export const DEFAULT_GRIDLINE_CONFIG: GridlineConfig = {
	enabled: true,
	color: "#e2e8f0",
	thickness: 1,
	count: null,
}

export type TickmarkConfig = {
	color: string
	thickness: number // px
	length: number // px — how far the tick extends from the axis line
}

export const DEFAULT_TICKMARK_CONFIG: TickmarkConfig = {
	color: "#94a3b8", // stone-400
	thickness: 1,
	length: 4,
}

/** The axis "spine" is the single line drawn along the x or y edge of the
 * plot area. Distinct from gridlines (perpendicular to the spine) and
 * tickmarks (small marks on top of the spine). */
export type SpineConfig = {
	color: string
	thickness: number // px
	/** Stroke opacity [0,1]. Only the radar spoke spine reads this (driven by
	 * the Spine opacity slot); cartesian axis spines leave it unset → 1. */
	opacity?: number
}

export const DEFAULT_SPINE_CONFIG: SpineConfig = {
	color: "#94a3b8", // stone-400
	thickness: 1,
}

/** Distribution overlay options surfaced on a *quantitative* axis when paired
 * with a categorical axis on the other side (i.e. a strip-plot setup). The
 * overlays render on top of the existing scatter marks. */
export type DistributionOverlayConfig = {
	/** Render a mirrored KDE polygon per category. */
	showDensityViolin: boolean
	/** Render a Tukey box (q1/median/q3 + 1.5*IQR whiskers + outliers) per category. */
	showBoxPlot: boolean
	/** Multiplier on the box's thickness — the fat dimension perpendicular to the
	 * value axis (horizontal for a vertical box, vertical for a horizontal one).
	 * 1 = the default (a box spanning ~36% of the category band); larger makes
	 * the box fatter/taller, smaller makes it skinnier. Optional so visuals saved
	 * before it existed load unchanged (read as 1). */
	boxWidthScale?: number
	/** Render a standalone density curve — a single KDE line rising from the
	 * axis baseline (not mirrored like a violin). Only meaningful in the
	 * single-quantitative-variable case (the same situation a histogram
	 * applies), so it's surfaced as a sibling of Histogram in the Distribution
	 * control. Optional so visuals saved before it existed load unchanged. */
	showDensityCurve?: boolean
	// NOTE: the density curve's fill and smoothing are NOT stored here — they're
	// shared with the histogram's density overlay via `HistogramConfig`
	// (`densityFill` / `densityBandwidthScale`), so the choice persists across
	// the Histogram ⇄ Density switch (mirrors the rug).
	/** When false, the underlying scatter marks are hidden so the overlay
	 * stands alone (classic violin-only / box-only plot). Defaults to true so
	 * enabling an overlay on a strip plot keeps the dots visible. */
	showPoints: boolean
	/** Stroke color used when hue isn't mapped (so there's no per-category
	 * palette to inherit from) and no per-category override exists. */
	color: string
	/** Fill color (with reduced opacity) under the same conditions. */
	fillColor: string
	/** Per-category stroke overrides keyed by stringified category value.
	 * Wins over hue inheritance and the default `color`. */
	colorOverrides: Record<string, string>
	/** Per-category fill overrides. Same precedence as `colorOverrides` for
	 * fills. */
	fillColorOverrides: Record<string, string>
	/** Optional saved palette id used to color each category's stroke + dots
	 * INDEPENDENTLY of the fill. When set (paired with `strokePalette` —
	 * the resolved colors snapshotted from `theme.categoricalPalettes`),
	 * each category's stroke draws from `strokePalette[i mod n]` (sorted by
	 * category order). `null` means "no palette — fall back to hue inheritance
	 * or the single `color`". */
	strokePaletteId?: string | null
	strokePalette?: string[]
	/** Same as the above pair, but for fill. Lets the user pair (e.g.) a dark
	 * palette for strokes/dots with a light/muted palette for fills, without
	 * dropping into per-category overrides. */
	fillPaletteId?: string | null
	fillPalette?: string[]
}

export const DEFAULT_DISTRIBUTION_OVERLAY_CONFIG: DistributionOverlayConfig = {
	showDensityViolin: false,
	showBoxPlot: false,
	boxWidthScale: 1,
	showDensityCurve: false,
	showPoints: true,
	color: "#475569", // slate-600
	fillColor: "#cbd5e1", // slate-300
	colorOverrides: {},
	fillColorOverrides: {},
	strokePaletteId: null,
	strokePalette: [],
	fillPaletteId: null,
	fillPalette: [],
}

/** Histogram options surfaced on a *quantitative* category axis in a bar
 * chart (bars-x / bars-y). When enabled, the renderer bins the axis field
 * into `binCount` equal-width buckets and draws one bar per bucket — the
 * normal bar aggregation (count / length-weighted sum / hue stacking) then
 * runs over the binned categories. */
export type HistogramConfig = {
	/** Bin the quantitative category axis instead of treating each distinct
	 * value as its own bar. */
	enabled: boolean
	/** Number of equal-width bins. Clamped to >= 1 at render time. */
	binCount: number
	/** What the bars (and the opposite axis) represent:
	 *  - "count": raw row count per bin.
	 *  - "density": each bin's share of the total (count / total), so values
	 *    fall in 0–1 and sum to 1 (relative frequency). Computed per facet
	 *    panel when faceted. */
	mode: "count" | "density"
	/** How each bin's axis label reads:
	 *  - "range": the full span, e.g. "10 – 20" (default).
	 *  - "low": only the bin's lower edge, e.g. "10".
	 *  - "high": only the bin's upper edge, e.g. "20". */
	labelMode: "range" | "low" | "high"
	/** Show a rug: one short tick per raw row drawn along the binned axis at
	 * the row's exact value — vertical ticks on an x-axis histogram, horizontal
	 * on a y-axis one. A density read that complements the bars. This is the
	 * histogram form of the strip plot's "show points". Off by default. */
	showRug: boolean
	/** Single rug-tick color, used when no `rugPalette` is picked (or no hue is
	 * mapped to color the ticks per category). */
	rugColor: string
	/** Optional saved palette id for the rug. When set (paired with the
	 * snapshotted `rugPalette` colors) AND a hue field is mapped, each tick is
	 * colored by its hue category via `rugPalette[i mod n]` (categories in
	 * hue-scale order). `null` → every tick uses the single `rugColor`. */
	rugPaletteId?: string | null
	rugPalette?: string[]
	/** Total length (px) of each rug tick, centered on the axis baseline (half
	 * above, half below). Unset → default tick length. */
	rugTickLength?: number
	/** Thickness (px) of each rug tick's stroke. Unset → default thickness. */
	rugTickThickness?: number
	/** Overlay a smooth density curve (Gaussian KDE) on top of the bars,
	 * rescaled into the bars' units (count or relative frequency) so it tracks
	 * their heights. A bin-independent read of the distribution's shape.
	 * Off by default; optional so older saves load unchanged. */
	showDensity?: boolean
	/** Fill the area under the density curve (at reduced opacity). When false
	 * the overlay is a stroked line only. */
	densityFill?: boolean
	/** Smoothing multiplier on the KDE's auto (Silverman) bandwidth — >1
	 * smoother, <1 wigglier. Unset reads as 1. */
	densityBandwidthScale?: number
}

/** Regression-line overlay for a scatter plot (both position axes
 * quantitative). Surfaced as the "Regression" section of the X position
 * options — the fit is always y-on-x, so it lives on the x axis config only.
 * Line/band styling (colors, opacities, width, dash) is governed by the
 * Color and Opacity panels' "Regression line" / "Confidence interval"
 * subheaders. */
/** "Apply pattern to range": gate a line's dash pattern to a window along
 * the axis the line runs along — dash inside [min, max], solid outside.
 * The known-vs-forecast case sets `min` to the forecast start and leaves
 * `max` blank. Values are raw axis values like value-mode annotation
 * coordinates (numbers, date strings, or category values); `null` =
 * unbounded on that side. A value that doesn't parse on the panel's scale
 * is treated as unbounded (silent, like annotation misses). */
export type DashRangeConfig = {
	enabled: boolean
	min: number | string | null
	max: number | string | null
}
export const DEFAULT_DASH_RANGE: DashRangeConfig = {
	enabled: false,
	min: null,
	max: null,
}

export type RegressionConfig = {
	enabled: boolean
	/** "linear" fits degree 1; "polynomial" fits `degree`. */
	kind: "linear" | "polynomial"
	/** Polynomial degree (only read when kind === "polynomial"). Clamped 2–6. */
	degree: number
	/** Draw the line (and CI band) in front of or behind the dots. */
	drawPosition: "front" | "back"
	/** Fit one line per value of `groupField` instead of a single pooled
	 * line. When on with no `groupField` chosen yet, the pooled line draws. */
	perGroup: boolean
	/** Grouping variable for per-group fits. Pre-filled from the hue field
	 * (when mapped) at the moment "Line per group" is enabled. */
	groupField: string | null
	/** Draw a pointwise confidence band for the mean response. */
	showCi: boolean
	/** Confidence level in percent (95 = 95% CI). */
	ciLevel: number
	/** Line stroke fallback when the Regression line color slot isn't set and
	 * no hue inheritance applies. Theme-seeded (theme.regressionStroke).
	 * Per-group palettes / per-value overrides live on the `regressionStroke`
	 * color slot (unlike the violin overlay there are no legacy palette
	 * fields here — the slot is the only mechanism, densityCurve-style). */
	color: string
	/** CI band fill fallback, same role as `color` for the band.
	 * Theme-seeded (theme.regressionCiFill). */
	ciFillColor: string
	/** Line stroke width in px. */
	strokeWidth: number
	/** Line dash — same options regular connection lines get (recipes in
	 * `lib/dashPatterns.ts`). Set from the Pattern menu's "Regression line"
	 * subheader. Ignored when `customDasharray` is set. */
	lineStyle: LineDashPattern
	/** User-typed SVG dasharray (e.g. "2,2"). Wins over `lineStyle` when
	 * set; unparseable input falls back to `lineStyle` (mirrors the
	 * per-category `customDashOverrides` semantics). */
	customDasharray: string | null
	/** Gate the dash to an x-range (solid outside). Independent of the
	 * connection channel's `dashRange` — the regression line's dash is its
	 * own setting, so its range is too. */
	dashRange: DashRangeConfig
}

export const DEFAULT_REGRESSION_CONFIG: RegressionConfig = {
	enabled: false,
	kind: "linear",
	degree: 2,
	drawPosition: "front",
	perGroup: false,
	groupField: null,
	showCi: false,
	ciLevel: 95,
	color: "#475569", // slate-600
	ciFillColor: "#cbd5e1", // slate-300
	strokeWidth: 2,
	lineStyle: "solid",
	customDasharray: null,
	dashRange: DEFAULT_DASH_RANGE,
}

/** Hexbin binning settings (hexbin mode only — x/y quantitative with hue
 * varying by "Point count"). Lives as a top-level ChannelConfigs slot rather
 * than inside `HueConfig` so re-seeding the gradient config (e.g. remapping
 * hue) never resets the binning. */
export type HexbinConfig = {
	/** Target hexagon columns across the x domain. Unset reads as the
	 * default (20, `DEFAULT_HEXBIN_BIN_COUNT` in hexbins.ts). */
	binCount?: number
}

/** Fixed panel shape (Aesthetics → Aspect ratio). When enabled, every
 * panel's inner plot rect is shrunk so height : width = length : width —
 * regardless of viewport size, and per panel when faceted. While on it
 * OVERRIDES the Facet panel's Custom sizing pixel dims and proportional
 * panel weights (differently sized panels can't all honor one ratio
 * while sharing row/col tracks). */
export type AspectRatioConfig = {
	enabled: boolean
	/** Vertical proportion — the "Length" input. Default 1. */
	length: number
	/** Horizontal proportion — the "Width" input. Default 1. */
	width: number
}

/** Fixed drawing surface (Aesthetics → Canvas size → "Set canvas size").
 * When enabled, the chart is laid out inside a fixed width × height pixel
 * rectangle instead of filling the editor viewport. The editor shows that
 * rectangle as a white canvas centered in the viewport, with the area
 * outside it shaded light gray; the rectangle scrolls into view when it's
 * larger than the viewport. Scroll mode and the fixed aspect ratio then
 * operate WITHIN the rectangle. */
export type CanvasSizeConfig = {
	enabled: boolean
	/** Canvas width in pixels. Default 1000. */
	width: number
	/** Canvas height in pixels. Default 600. */
	height: number
}

export const DEFAULT_HISTOGRAM_CONFIG: HistogramConfig = {
	enabled: false,
	binCount: 10,
	mode: "count",
	labelMode: "range",
	showRug: false,
	rugColor: "#475569", // slate-600
	rugPaletteId: null,
	rugPalette: [],
	rugTickLength: 10,
	rugTickThickness: 1,
}

export type AxisConfig = {
	tickCount: number // 3–12
	/** d3-format (quantitative) or d3-time-format (temporal) string. Empty
	 * string means "use the scale's default formatter". The sidebar exposes
	 * a dropdown of presets that populate this field; the user can refine
	 * the resulting spec by hand. */
	customFormat: string
	gridlines: GridlineConfig
	tickmarks: TickmarkConfig
	spine: SpineConfig
	/** Tick label rotation in degrees. Clockwise, around each tick's anchor.
	 * Handy for long categorical labels on the x-axis (e.g. -45). 0 = horizontal. */
	tickLabelAngle: number
	/** Random horizontal/vertical offset applied to scatter points along *this*
	 * axis when it's the categorical side of a strip plot. Expressed as a
	 * fraction of the per-category band width: 0 = no jitter (default), 1 =
	 * fills the full band. Ignored on quantitative/temporal axes. */
	jitterAmount: number
	/** Beeswarm packing for the categorical side of a strip plot. When `true`,
	 * points in each category are packed as close together as possible without
	 * overlapping (offset only along THIS axis; their position on the
	 * quantitative axis is preserved) instead of being randomly jittered —
	 * `jitterAmount` is ignored while this is on. Optional so visuals saved
	 * before beeswarm existed load unchanged (absent reads as `false`). */
	beeswarm?: boolean
	/** Distribution overlays — meaningful only when this axis is quantitative
	 * and the other axis is categorical. */
	distributionOverlay: DistributionOverlayConfig
	/** Stride between visible ticks on a categorical/ordinal axis. `1` (the
	 * default) shows every category. `2` shows every other, `3` every
	 * third, etc. — useful when there are too many categories to label
	 * each one cleanly. The first and last categories always render so
	 * the axis ends stay anchored. Ignored on quantitative/temporal axes
	 * (those use `tickCount` directly via d3's `.ticks()`). */
	categoricalTickStride?: number
	/** Per-axis tick LABEL color. Superseded by `tickLabelFont.color` when
	 * that is set; kept for back-compat with visuals saved before the fuller
	 * `tickLabelFont` override existed. When neither is set, tick labels
	 * inherit the global Text encoding color (`labels.baseFont.text.color`). */
	tickLabelColor?: string
	/** Per-axis tick LABEL font override. Any subset of family / size / color
	 * / weight / italic / underline may be set; unset fields fall through to
	 * the global Text encoding font (`labels.baseFont.text`). Lets the user
	 * style an individual axis's tick labels independently — e.g. a smaller
	 * monospace y-axis. `color` here wins over the legacy `tickLabelColor`. */
	tickLabelFont?: Partial<FontConfig>
	/** Line-wrap long tick labels ("Wrap text" in the Tick Labels section).
	 * X-axis labels wrap to their per-tick slot width; y / r labels wrap to a
	 * fixed font-relative max width (see `lib/tickLabelWrap.ts`). Wraps on
	 * spaces, hard-breaking a word only when it alone exceeds a line. While
	 * on, the categorical auto-rotate stays off (wrapping replaces rotation
	 * as the overflow strategy); an explicit `tickLabelAngle` still applies.
	 * Optional so visuals saved before this existed load unchanged (absent
	 * reads as `false`). */
	wrapTickLabels?: boolean
	/** Horizontal alignment of the LINES within a wrapped tick label's block
	 * (only meaningful while `wrapTickLabels` is on — single-line labels have
	 * nothing to align). The block itself stays anchored to its tick; absent
	 * means the axis's natural alignment: centered under an x tick,
	 * right-aligned against the y axis, left-aligned at the radar spoke. The
	 * panel stores a value only when the user picks a NON-natural alignment,
	 * so the "changed" dot stays honest. */
	wrapTickLabelAlign?: LabelAlignment
	/** User-pinned domain bounds for a continuous (quantitative / temporal)
	 * axis. `null` / absent means "auto-fit from the data" (the default).
	 * Quantitative axes store the raw value; temporal axes store epoch
	 * milliseconds. Ignored on categorical / ordinal-string axes.
	 *
	 * These act as the BASE default applied to every panel (single-panel
	 * and faceted alike): the renderer's domain override resolves them as
	 * the lowest-precedence source, so facet-level range overrides
	 * (`overallYRange`, `rowAxisOverrides`, …) still win where set. */
	min?: number | null
	max?: number | null
	/** Extra pinned tick positions for a continuous axis, ADDED to the auto
	 * `tickCount` layout (set `tickCount: 0` and list breaks for fully custom
	 * ticks). Tick labels follow the ticks — every tick gets a label. Empty /
	 * absent = auto only. Numbers are axis values (epoch ms for temporal).
	 * Breaks outside the resolved domain are dropped at render time, and a
	 * break coinciding with an auto tick draws once. Mirrors the Gridlines
	 * section's additive custom-breaks box — `min`/`max` (above) still define
	 * the domain extent independently. Ignored on categorical / ordinal-string
	 * axes. */
	breaks?: number[]
	/** Histogram binning for a quantitative category axis in bar charts.
	 * Absent / `enabled: false` means "no binning" (the default). Optional so
	 * existing saved configs load unchanged — a missing value reads as
	 * disabled. */
	histogram?: HistogramConfig
	/** Regression-line overlay for a two-quantitative scatter. Only ever set
	 * on the X axis config (fits are y-on-x). Optional so saved visuals load
	 * unchanged — absent reads as disabled. */
	regression?: RegressionConfig
	/** LEGACY perpendicular nudge (px) that moves the axis decorations — spine,
	 * tick marks, tick labels, and title — closer to or farther from the plot
	 * area, WITHOUT moving the gridlines. Positive pushes the axis AWAY from
	 * the plot (an x-axis moves vertically, a y-axis horizontally). Superseded
	 * by `offsetX`/`offsetY` below — read only when those are unset; the panel
	 * clears it on the first write of the new fields. */
	offset?: number
	/** "Adjust position" nudge (px, screen coords: +x right, +y down) applied
	 * to the whole axis — spine, tick marks, tick labels, and title — WITHOUT
	 * moving the gridlines (those stay pinned to their data positions). The
	 * sidebar's Y input shows math convention (positive = up) and flips the
	 * sign at the input boundary. Absent = 0. Ignored on the radial `r`
	 * axis. */
	offsetX?: number
	offsetY?: number
}

export const DEFAULT_AXIS_CONFIG: AxisConfig = {
	tickCount: 5,
	customFormat: "",
	gridlines: DEFAULT_GRIDLINE_CONFIG,
	tickmarks: DEFAULT_TICKMARK_CONFIG,
	spine: DEFAULT_SPINE_CONFIG,
	tickLabelAngle: 0,
	jitterAmount: 0,
	distributionOverlay: DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	categoricalTickStride: 1,
}

export type AreaConfig = {
	minRadius: number
	maxRadius: number
	/** How the mapped value translates to circle size:
	 *  - "area" (default, absent): the value drives the circle's AREA —
	 *    radius grows with √value. Honest proportions (a doubled value
	 *    doubles the ink), and the only mode where packed-circle
	 *    containers read as the sum of their children.
	 *  - "diameter": the value drives the RADIUS directly. Exaggerates
	 *    differences (a doubled value quadruples the ink) — useful when
	 *    the data spans a narrow range and area-true sizing reads as
	 *    near-uniform. Applies everywhere the area channel sizes marks:
	 *    scatter bubbles, geo bubble maps, packed circles. */
	sizeBy?: "area" | "diameter"
	/** Per-category radius overrides for a NON-numeric ordinal field mapped to
	 *  area, keyed by the category's string form. An unset category uses the
	 *  even min→max spread, so the auto-spread stays the zero-config default and
	 *  each category is individually pinnable. Ignored for quantitative /
	 *  numeric-ordinal fields (which size continuously from the value). */
	overrides?: Record<string, number>
}
export const DEFAULT_AREA_CONFIG: AreaConfig = { minRadius: 3, maxRadius: 18 }

export type SaturationConfig = {
	min: number
	max: number
	stackMode?: StackMode
	/** Per-value overrides, keyed by the value's string form: a category of
	 * a categorical/ordinal field mapped to the channel, or a packed-circles
	 * derived value (a depth level "1"/"2"/… or a top-level group name). An
	 * unset value falls back to the even min→max spread. Quantitative /
	 * temporal fields modulate continuously and ignore these. Optional so
	 * saved configs load unchanged. */
	overrides?: Record<string, number>
}
export const DEFAULT_SATURATION_CONFIG: SaturationConfig = { min: 0.2, max: 1 }

export type BrightnessConfig = {
	min: number
	max: number
	stackMode?: StackMode
	/** Same as `SaturationConfig.overrides`. */
	overrides?: Record<string, number>
}
export const DEFAULT_BRIGHTNESS_CONFIG: BrightnessConfig = {
	min: 0.25,
	max: 0.85,
}

// Opacity: quantitative fields get a min/max range; categorical/ordinal fields
// get per-category overrides (default 1 for every category).
export type OpacityConfig =
	| { kind: "quantitative"; min: number; max: number; stackMode?: StackMode }
	| {
			kind: "categorical"
			overrides: Record<string, number>
			stackMode?: StackMode
	  }

export const DEFAULT_OPACITY_QUANTITATIVE: Extract<
	OpacityConfig,
	{ kind: "quantitative" }
> = {
	kind: "quantitative",
	min: 0.2,
	max: 1,
}

export const DEFAULT_OPACITY_CATEGORICAL: Extract<
	OpacityConfig,
	{ kind: "categorical" }
> = {
	kind: "categorical",
	overrides: {},
}

export type PaletteName =
	| "viridis"
	| "plasma"
	| "inferno"
	| "magma"
	| "blues"
	| "BrBG"
	| "PiYG"
	| "PRGn"
	| "PuOr"
	| "RdBu"
	| "RdYlBu"
	| "Spectral"

/** How multiple slices within a stack (bars) or layers (areas) combine.
 * - `stack`: slices stack cumulatively bottom-to-top (default, current behavior).
 * - `group`: slices lay side-by-side within the category band. Bars only; for
 *   areas this degrades to `overlay` since side-by-side areas aren't meaningful.
 * - `overlay`: every slice/layer draws from the baseline (0) to its own value,
 *   overlapping. Applies to bars and areas. */
export type StackMode = "stack" | "group" | "overlay"

/** A single user-defined stop on a custom (palette === "custom") hue
 * gradient. `value: null` means "use the auto-interpolated position
 * (first stop → data min, last stop → data max, middle stops evenly
 * spaced)"; an explicit number pins the stop to that data value. */
export type CustomHueStop = {
	color: string
	value: number | null
}

export type HueConfig =
	| {
			kind: "categorical"
			colors: Record<string, string> // value → hex
			stackMode: StackMode
	  }
	| {
			kind: "quantitative"
			palette: PaletteName | "custom" | "customLinear" | "customDiverging"
			// Two/three-stop fields used by `customLinear` (low/high) and
			// `customDiverging` (low/mid/high). Presets ignore these — they
			// derive endpoints from the d3 interpolator instead.
			lowColor: string
			lowValue: number | null // null = data min
			midColor: string | null // null = 2-stop
			midValue: number | null
			highColor: string
			highValue: number | null // null = data max
			/** N-stop user-defined custom gradient — read only when palette
			 * is `"custom"`. The first/last stops anchor the gradient; any
			 * number of additional middle stops are allowed. The legacy
			 * `lowColor`/`midColor`/`highColor` fields stay for backwards
			 * compatibility with saved charts that pre-date this field. */
			customStops?: CustomHueStop[]
			/** Records the dropdown selection that originated this config —
			 * a preset name (`"viridis"`), a saved gradient ID, `"custom"`,
			 * etc. Survives color edits so a "Reset colors" action can
			 * re-resolve to the originating palette's defaults instead of
			 * switching the whole palette type. Older configs without this
			 * field fall back to color-matching against theme gradients. */
			sourcePaletteId?: string
			/** Color space used to blend between gradient stops — "rgb"
			 * (matches CSS gradients), "hsb", or "oklch" (perceptually
			 * uniform). Read only by the custom-gradient paths
			 * (customLinear / customDiverging / manual stops); presets are
			 * fully-specified ramps with nothing left to blend. Absent =
			 * "rgb", so charts saved before the field existed render
			 * unchanged. */
			interpolation?: GradientInterpolation
			stackMode: StackMode
	  }

export const DEFAULT_CATEGORICAL_HUE_CONFIG: Extract<
	HueConfig,
	{ kind: "categorical" }
> = {
	kind: "categorical",
	colors: {},
	// Default to "stack" — bar and area charts with a hue field are
	// almost always reaching for cumulative-quantity semantics; if the
	// chart turns out to be scatter, stackMode is ignored entirely. The
	// previous "overlay" default forced an extra click for the common
	// case (stacked bars/areas) while giving nothing in return for
	// scatter charts.
	stackMode: "stack",
}

export const DEFAULT_QUANTITATIVE_HUE_CONFIG: Extract<
	HueConfig,
	{ kind: "quantitative" }
> = {
	kind: "quantitative",
	palette: "viridis",
	lowColor: "#0d0887", // plasma-esque
	lowValue: null,
	midColor: null,
	midValue: null,
	highColor: "#f0f921",
	highValue: null,
	stackMode: "stack",
}

/** Keys for the generic "color slot" targets surfaced as subheaders in the
 * unified Color menu. Fill and Outline are NOT slots — they keep their own
 * storage (`hue` / `outlineHue` encodings + palette config) and are adapted
 * into the same UI. These six are the previously-scattered color targets,
 * each now an independent optional color encoding. */
export type ColorSlotKey =
	| "line" // area/line top-edge + radar polygon outline + scatter connection line
	| "rug" // histogram rug ticks
	| "violinStroke" // distribution overlay stroke
	| "violinFill" // distribution overlay fill
	| "densityCurveFill" // density curve area fill
	| "densityCurveStroke" // density curve line
	| "stem" // lollipop stems
	| "spine" // radar angular spokes (single color only)
	| "geoPointFill" // bubble / symbol map point FILL (independent of region colors)
	| "geoPointStroke" // bubble / symbol map point OUTLINE
	| "regressionStroke" // scatter regression line
	| "regressionCiFill" // scatter regression confidence band

/** One color target's full state. Mirrors how `hue`/`outlineHue` work: an
 * optional field mapping with a palette + per-level overrides, or — when
 * `field` is null (the default) — a single color applied to every mark. */
export type ColorSlotConfig = {
	/** Dataset column driving this slot's color, or null = single color. */
	field: string | null
	/** Reuses the hue union (categorical {colors} | quantitative gradient).
	 * NOTE: `stackMode` inside this union is inert for slots — never feed a
	 * slot's stackMode to `resolveStackMode`; only `hue`/`pattern` own layout. */
	hue?: HueConfig
	/** Categorical palette selection (mirrors `categoricalPaletteId`). */
	paletteId?: string | null
	palette?: string[] | null
	/** The "None" single color, theme-seeded per slot. */
	singleColor: string
}

export type ColorSlots = Partial<Record<ColorSlotKey, ColorSlotConfig>>

/** Keys for the per-part opacity targets surfaced as subheaders in the Opacity
 * menu. Fill is NOT a slot — it reuses the overall `opacity` encoding +
 * `defaultOpacity`. Border is universal; the rest mirror the color slots. */
export type OpacitySlotKey =
	| "border"
	| "rug"
	| "line"
	| "violinStroke"
	| "violinFill"
	| "densityCurveFill"
	| "densityCurveStroke"
	| "stem"
	| "spine"
	| "node"
	| "ribbon"
	| "regressionStroke"
	| "regressionCiFill"

/** One opacity target's state: a static `level` in [0,1], or — when `field`
 * is set — a field mapping reusing `OpacityConfig` (categorical per-value /
 * quantitative min–max). Absolute: a part's resolved opacity comes solely from
 * its slot, independent of the Fill / overall opacity. */
export type OpacitySlotConfig = {
	field: string | null
	level: number
	opacity?: OpacityConfig
}

export type OpacitySlots = Partial<Record<OpacitySlotKey, OpacitySlotConfig>>

/** A user-defined mark glyph: a short text string (1–3 characters, emoji
 * OK — tinted by the mark's fill color like a symbol path) or an uploaded
 * image (stored as a small data URL, rendered as-is — fill / outline /
 * pattern encodings don't apply to images). */
export type CustomGlyph =
	| { kind: "text"; text: string }
	| { kind: "image"; href: string; aspect: number }

export type ShapeConfig = {
	overrides: Record<string, number>
	/** Stroke color applied to every point mark. Seeded from the theme's
	 * `outlineColor` on chart creation; users can override per-chart in
	 * the Shape panel. To hide outlines entirely, set `outlineWidth` to
	 * 0 rather than matching the fill color — keeps the user's chosen
	 * outline color visible if they re-enable the stroke later. */
	outlineColor: string
	/** Stroke width in pixels applied to every point mark. `0` hides
	 * the outline entirely. */
	outlineWidth: number
	/** Per-category override for the mark's fill color. Wins over the
	 * encoding's hue color for that category — useful when the user wants
	 * one specific category to render hollow ("none"), pair a light fill
	 * with a dark outline, etc. Keyed by stringified category value.
	 * `"none"` renders the path with no fill at all. */
	fillOverrides?: Record<string, string>
	/** Per-category override for the mark's stroke color. Same precedence
	 * as `fillOverrides` but for the outline. Empty / absent → falls back
	 * to the global `outlineColor`. */
	strokeOverrides?: Record<string, string>
	/** Conditional outline-color rules, evaluated against the mapped
	 * `outlineHue` variable's value for each mark (mirrors Data Labels'
	 * `textColorRules`). First matching rule wins and overrides the
	 * outlineHue scale color; per-category `strokeOverrides` still win on
	 * top. Only fire when an outline variable is mapped. */
	outlineColorRules?: TextColorRule[]
	/** Per-chart custom glyphs. A shape index `i >= SHAPE_PALETTE.length`
	 * refers to `customGlyphs[i - SHAPE_PALETTE.length]`. Deleted slots are
	 * tombstoned to `null` (never spliced) so existing index references —
	 * `defaultShape`, per-category `overrides` — stay stable; a reference to
	 * a tombstoned / out-of-range slot resolves to the circle symbol (see
	 * `lib/customGlyphs.resolveGlyph`). */
	customGlyphs?: Array<CustomGlyph | null>
}
export const DEFAULT_SHAPE_CONFIG: ShapeConfig = {
	overrides: {},
	outlineColor: "#ffffff",
	outlineWidth: 1,
	fillOverrides: {},
	strokeOverrides: {},
	outlineColorRules: [],
}

/** A pattern override is either a numeric palette index (0..N-1) or the
 * literal "none" — meaning the category should render with no pattern
 * overlay. The "none" string is mirrored as `PATTERN_NONE` in `./patterns`;
 * the literal is inlined here to avoid a `channelConfig` → `patterns` import
 * cycle. */
export type PatternOverride = number | "none"

export type PatternConfig = {
	/** Per-category palette index (which of the 6 palette shapes this
	 * category's pattern uses), or "none" to render the category with no
	 * pattern overlay (just the underlying hue / background color).
	 *
	 * Governs POINT FILL patterns (SVG fills on marks). In line chart
	 * context this defaults to "none" per-category — user opts in by
	 * clicking a fill swatch. Line dash patterns are tracked separately
	 * in `dashOverrides`. */
	overrides: Record<string, PatternOverride>
	/** Per-category line-dash index (into DASH_CYCLE), or "none" for a
	 * solid line. Only consulted by `renderConnectionLines` in line chart
	 * context. When unset for a category, the line auto-cycles through
	 * DASH_CYCLE by the category's position in its pattern field's
	 * unique-values list. */
	dashOverrides?: Record<string, PatternOverride>
	/** Per-category user-typed SVG dasharray string (e.g., "2,2",
	 * "2,4,5,2"). Wins over `dashOverrides` for that category. Lives
	 * separately so the built-in palette index in `dashOverrides`
	 * doesn't need a wider type. Empty string clears the override. */
	customDashOverrides?: Record<string, string>
	/** Per-category ink color (hex). Missing categories fall back to
	 * DEFAULT_PATTERN_INK. */
	inkColors: Record<string, string>
	/** Background color used when hue is NOT mapped. When hue IS mapped the
	 * background comes from the mark's hue color automatically. */
	backgroundColor: string
	/** Stack/group/overlay layout when pattern is the highest-precedence
	 * mapped color channel (hue > pattern > brightness > opacity >
	 * saturation). Read by `resolveStackMode`; the Pattern panel exposes
	 * the toggle only when it owns layout. Stored here (not only on hue)
	 * so the setting persists when the user maps pattern without hue. */
	stackMode: StackMode
}
export const DEFAULT_PATTERN_CONFIG: PatternConfig = {
	overrides: {},
	dashOverrides: {},
	customDashOverrides: {},
	inkColors: {},
	backgroundColor: "#e2e8f0",
	stackMode: "stack",
}

export type LengthConfig = {
	minLength: number
	maxLength: number
	/** Bar charts: fixed gap between bars in PIXELS — bar width is whatever
	 * remains of each category slot, so one knob controls both. BarPlot
	 * converts it to the band-padding fraction per panel, which keeps the
	 * pixel gap uniform across facet panels of different widths. null/absent
	 * = auto (the proportional 15%-of-slot gap). Histograms ignore it: their
	 * bars always abut. */
	barGapPx?: number | null
}
export const DEFAULT_LENGTH_CONFIG: LengthConfig = {
	minLength: 4,
	maxLength: 40,
}

/** The auto band-gap for categorical bars when `LengthConfig.barGapPx` is
 * unset, as a fraction of each category slot — mirrors the 0.15 band
 * padding BarPlot has always used. */
export const AUTO_BAR_GAP_FRACTION = 0.15

export type AngleConfig = {
	minAngle: number
	maxAngle: number
	// --- Radar-mode axis chrome (only consulted when the active mode is
	// radar). Each defaults at render-time when absent, so existing
	// angle configs (which only carried min/max) keep rendering with
	// theme defaults.
	/** Number of evenly-spaced spokes for quantitative / temporal angle.
	 *  Ignored for categorical / ordinal — those always get one spoke per
	 *  domain value. */
	tickCount?: number
	/** d3-format string for tick labels (quantitative) or d3-time-format
	 *  string (temporal). Empty / undefined → use the scale's default
	 *  formatter. */
	customFormat?: string
	/** Rotation (degrees) applied to perimeter tick labels around their
	 *  anchor. 0 keeps them upright (matches the chosen "Stay horizontal"
	 *  default). */
	tickLabelAngle?: number
	/** Spoke color + thickness — the lines from center to perimeter at
	 *  each angle tick. Defaults to the system theme's spine color when
	 *  unset. */
	spine?: SpineConfig
	/** Pie-mode donut hole, as a percentage (0–90) of the pie's outer
	 *  radius. `0` renders a solid pie; any positive value renders a donut
	 *  whose center hole is that fraction of the radius. Only consulted by
	 *  PiePlot (pies / pies-x / pies-y); radar ignores it. */
	donutHoleRadius?: number
}
/** Default hole size (% of radius) applied when the user flips a pie to a
 *  donut. Sits in the middle of the input's 5–90 range. */
export const DEFAULT_DONUT_HOLE_RADIUS = 50
export const DEFAULT_ANGLE_CONFIG: AngleConfig = {
	minAngle: -180,
	maxAngle: 180,
	tickCount: 6,
	customFormat: "",
	tickLabelAngle: 0,
	spine: DEFAULT_SPINE_CONFIG,
	donutHoleRadius: 0,
}

/** Line drawn between points that share a connection-encoding value. When a
 * user picks a custom color for a specific connection value, the line uses
 * it; otherwise the line adopts the first connected point's hue. */
/** Chord-mode only: the circular value axis drawn around the ring, showing
 * each node's flow total — tick marks along every group arc, graduated like
 * d3's classic chord "group ticks". Off by default; the Connection panel's
 * "Show axis" checkbox (chord layout only) reveals the Ticks / Tick Labels /
 * Spine controls, mirroring the x / y position panels. */
export type ChordAxisConfig = {
	enabled: boolean
	/** Target number of tick marks around the FULL ring — the axis is
	 * continuous (flow values), so it takes a count like the continuous
	 * x / y axes, not a categorical "tick every" stride. The actual step
	 * derives as a nice round value (d3 `tickStep(0, total, tickCount)`),
	 * shared by every group so the ring reads as a single scale; each
	 * node gets ticks proportional to its total. */
	tickCount: number
	/** d3-format spec for tick labels; `""` = auto (SI-prefixed from the
	 * step, e.g. "5k"). Same semantics as `AxisConfig.customFormat`. */
	customFormat: string
	/** Label every Nth tick mark (1 = label all). Labeling every tick gets
	 * crowded at the auto step, so the default labels every 5th — the d3
	 * chord convention. */
	labelEvery: number
	/** Tick mark styling; absent = `DEFAULT_TICKMARK_CONFIG`. */
	tickmarks?: TickmarkConfig
	/** Tick LABEL font override; unset fields inherit the base text font
	 * (`labels.baseFont.text`), exactly like the x / y tick-label fonts. */
	tickLabelFont?: Partial<FontConfig>
	/** The "spine" here is the thin arc drawn along each group's outer edge
	 * (the circular analogue of the x / y axis line); absent =
	 * `DEFAULT_SPINE_CONFIG`. */
	spine?: SpineConfig
}

export const DEFAULT_CHORD_AXIS_CONFIG: ChordAxisConfig = {
	enabled: false,
	// The d3 chord example's calibration: ~100 graduations around the ring,
	// every 5th labeled → ~20 labels.
	tickCount: 100,
	customFormat: "",
	labelEvery: 5,
}

export type ConnectionConfig = {
	/** Per-value line color override. */
	lineColors: Record<string, string>
	/** Optional categorical-palette ID for line strokes in area mode.
	 *  Lets the user pick a separate palette for the area-layer outlines
	 *  while the fill keeps its own palette (`configs.categoricalPaletteId`).
	 *  When `null` / omitted, lines inherit each layer's fill color (the
	 *  default — what most charts want). Per-value `lineColors` overrides
	 *  still win on top of this. */
	linePaletteId?: string | null
	/** Resolved colors for `linePaletteId`. Mirrors the way
	 *  `configs.categoricalPalette` shadows `categoricalPaletteId` so
	 *  renderers don't have to re-resolve from the theme on every paint. */
	linePalette?: string[] | null
	/** Line thickness in pixels — the single value applied to every line,
	 *  and the per-category fallback when `thicknessByValue` has no entry for
	 *  a group. */
	thickness: number
	/** Per-line thickness overrides (px), keyed by the connection field's
	 *  value (the hue value in area mode, matching `dashPatterns`). A missing
	 *  key falls back to `thickness`, so an empty / absent map renders exactly
	 *  like a single global thickness — no separate "mode" flag is stored; the
	 *  "Vary by" dropdown derives its position from whether this map is
	 *  populated. Optional so visuals saved before it existed load unchanged. */
	thicknessByValue?: Record<string, number>
	/** In areas mode only: `"area"` fills the region below each layer down
	 * to the baseline (or the layer below it when stacked); `"line"` renders
	 * just the top edge as a polyline (line chart). Ignored in scatter
	 * mode, where connection always renders as polylines. */
	fill: "area" | "line"
	/** In area / line mode only: global stroke color for layer top edges
	 * (separators in area mode, the polyline itself in line mode). `null`
	 * means "inherit from each layer's hue color" — the default, which
	 * gives every layer a visible stroke matching its fill. */
	strokeColor: string | null
	/** Per-line point sampling. Lines themselves always use every data
	 * point (so the polyline still passes through everything); these
	 * options only control which dots / shapes get drawn AT each point.
	 *  - `"all"` (default): every point gets a marker — current behavior.
	 *  - `"first-only"` / `"last-only"` / `"first-and-last"`: only the
	 *    named anchor points render markers — useful for "where does the
	 *    line end up" annotations or to avoid clutter on dense lines.
	 *  - `"every-n"`: render a marker at every `pointEveryN`-th point in
	 *    line order, plus the first and last for endpoint anchors. */
	pointSampling:
		| "all"
		| "none"
		| "first-only"
		| "last-only"
		| "first-and-last"
		| "every-n"
	/** Stride for `pointSampling: "every-n"`. Ignored otherwise. Clamped
	 * to >= 1 by the renderer. */
	pointEveryN: number
	/** Per-line dash pattern overrides keyed by line group value (the
	 * connection field's value, or the hue value in area mode). When a
	 * key is missing the line falls back to `defaultDashPattern`. */
	dashPatterns: Record<string, LineDashPattern>
	/** Default dash pattern applied to every line that doesn't have a
	 * per-group override. Applies in scatter+connection AND area-line
	 * modes. */
	defaultDashPattern: LineDashPattern
	/** User-typed custom dasharray for the default line dash (the Pattern
	 * panel's no-field "Custom" pick). When it parses to a valid dasharray
	 * (see `sanitizeCustomDasharray`) it wins over `defaultDashPattern`;
	 * per-group `dashPatterns` overrides still win over both. `null` /
	 * absent = no custom dash (the swatch pick applies). */
	customDashPattern?: string | null
	/** Per-line alternating colors for non-solid patterns. The "alternate"
	 * is the color shown in the gap between dashes; setting it makes a
	 * dashed line read as two-color (e.g. dark green dashes on light
	 * green background). When unset for a line, the renderer falls back
	 * to the visualization's background color (or white if transparent),
	 * which keeps dashes visually punching through to the chart bg. */
	dashAlternateColors: Record<string, string>
	/** Single dash-gap color override for charts with NO hue encoding (one
	 * line color → one gap swatch in the panel). With hue mapped, per-category
	 * overrides live in `dashAlternateColors` keyed by hue value instead.
	 * `null` / absent = no override (palette-paired chain applies). */
	dashGapColor?: string | null
	/** Whether the gaps between dashes are painted (an underlay polyline in
	 * the alternate color) so a dashed line reads as one connected two-color
	 * line, or left empty so the line is truly dashed. `null` / absent =
	 * AUTO: gaps are painted unless the pattern encoding maps the SAME field
	 * as the hue encoding (there the dash restates the color split, so true
	 * gaps are the default and painting is opt-in). See
	 * `resolveDashGapFill` in `lib/dashPatterns.ts`. */
	dashGapFill?: boolean | null
	/** "Apply pattern to range": every line's dash (per-category or the
	 * global default) draws only within [min, max] along the axis the line
	 * runs along; outside renders solid. One GLOBAL window (a forecast
	 * boundary is one date for every series). Applies to scatter connection
	 * polylines AND area line-mode top edges — the renderers that share the
	 * rest of this dash config. Optional so visuals saved before it existed
	 * load unchanged (absent = off). */
	dashRange?: DashRangeConfig
	/** Radar-mode only: when true, the closed polygon connecting each
	 *  series' points fills with its hue color (modulated by
	 *  `fillOpacity`). When false, only the polygon outline draws.
	 *  Toggle surfaces in the Connection panel only while the active
	 *  chart mode is radar. */
	fillPolygon?: boolean
	/** Opacity multiplier applied to LINES — area-mode top edges and
	 *  radar-mode polygon outlines. Composes with each layer/series'
	 *  hue-resolved opacity. Defaults to 1 (fully opaque). Surfaced in
	 *  the Opacity panel for area + radar charts. */
	lineOpacity?: number
	/** Opacity multiplier applied to FILLS — area-mode layer bodies and
	 *  radar-mode polygon interiors (when `fillPolygon` is on). Same
	 *  composition rule as `lineOpacity`. Defaults to 1. */
	fillOpacity?: number
	/** Scatter-only: draw a stem from each point to an axis (lollipop
	 *  charts). Unlike the group polyline above, this is a PER-POINT
	 *  derived mark — it needs no connection field and ignores grouping.
	 *   - `"none"` (default): no stems.
	 *   - `"x-axis"`: vertical stem from each point down to the x-axis
	 *     line (the bottom edge of the plot area).
	 *   - `"y-axis"`: horizontal stem from each point across to the
	 *     y-axis line (the left edge of the plot area).
	 *  Stem color matches each point's fill; thickness reuses `thickness`. */
	axisStem?: "none" | "x-axis" | "y-axis"
	/** Lollipop stems only — optional INDEPENDENT color encoding for the
	 *  stems (active only when `axisStem` is set). `stemColorField` names
	 *  the dataset column whose value drives each stem's color; `null` /
	 *  absent (default) means stems inherit each point's fill — the prior
	 *  behavior. `stemColorPaletteId` is the chosen categorical palette;
	 *  its resolved colors are snapshotted into `stemColorPalette` so the
	 *  renderer needn't re-resolve from the theme (mirrors how
	 *  `categoricalPaletteId` / `categoricalPalette` pair up). */
	stemColorField?: string | null
	stemColorPaletteId?: string | null
	stemColorPalette?: string[] | null
	/** How stems pick their color:
	 *   - `"point"` (default): each stem inherits its point's fill.
	 *   - `"single"`: every stem uses the one `stemColor` swatch.
	 *   - `"field"`: stems are colored by `stemColorField` through the
	 *     chosen palette.
	 *  Kept separate from `stemColorField` so "Point color" and a fixed
	 *  single color are both expressible without overloading the field. */
	stemColorMode?: "point" | "single" | "field"
	/** The single color used when `stemColorMode` is `"single"`. */
	stemColor?: string | null
	/** Cap style for OPEN line ends — scatter connection polylines and
	 *  area/line-mode layer edges (dash segments too). Radar polygons are
	 *  closed, so caps never show there. `"square"` maps to SVG's `butt`
	 *  cap: the stroke ends flush at the endpoint's data position rather
	 *  than extending half a stroke-width past it. */
	lineCap?: "round" | "square"
	/** Line smoothing amount in [0, 1] for scatter connection lines and
	 *  area/line-mode layer edges. 0 (the default) draws straight segments
	 *  through the points; higher values round the corners via a cardinal
	 *  spline (see `lib/linePath.buildLinePath`). Radar polygons ignore this. */
	smoothing?: number
	/** Packed-circles only: the dataset column holding each row's own node
	 *  IDENTITY (e.g. `Child` when connection maps `Parent`). Matching
	 *  connection values against this column is what lets circles nest
	 *  deeper than two levels — a row whose connection value equals another
	 *  row's id nests inside that row's circle.
	 *
	 *  `null` / absent (the default) = AUTO: the renderer detects the id
	 *  column as the one whose values overlap the connection field's values
	 *  (`inferHierarchyIdField`), falling back to one grouping level when
	 *  nothing overlaps. The `HIERARCHY_ID_NONE` sentinel = the user
	 *  explicitly opted OUT of nesting (one grouping level even when a
	 *  column overlaps). Follows the radar `fillPolygon` precedent:
	 *  mode-specific state on the connection channel's config so it
	 *  persists with the visual. */
	hierarchyIdField?: string | null
	/** Which layout renders the hierarchy (packed circles is the default).
	 *  All five layouts — three trees (pack / treemap / sunburst) and two
	 *  flows (chord / sankey) — share ONE encoding signature (`area`
	 *  + optional `connection`, no positions), so encodings alone can't
	 *  distinguish them — this config gates mode detection instead, the
	 *  same way the histogram toggle does for bars. Surfaced as the
	 *  "Layout" picker in the Connection panel's Hierarchy section.
	 *  Optional so visuals saved before treemap/sunburst existed load as
	 *  packed circles. */
	hierarchyLayout?: "pack" | "treemap" | "sunburst" | "chord" | "sankey"
	/** Flow layouts (chord / sankey) only: the dataset column holding each
	 *  edge's TARGET node (`Stop` when connection maps `Start`). The
	 *  connection field is the SOURCE; each row is a directed edge
	 *  source → target weighted by the `area` field.
	 *
	 *  `null` / absent (the default) = AUTO: the column whose values overlap
	 *  the connection field's the most (`inferHierarchyIdField` — flows
	 *  reuse the hierarchy heuristic), falling back to the first categorical
	 *  column when nothing overlaps (bipartite flows like Country → Product
	 *  share no node names between the columns). Kept SEPARATE from
	 *  `hierarchyIdField`: that column means row-identity for trees, this
	 *  one means edge-target. */
	flowTargetField?: string | null
	/** Chord layout only: the circular value axis around the ring. Absent /
	 *  `enabled: false` draws no axis (the historical look). Optional so
	 *  visuals saved before it existed load unchanged. */
	chordAxis?: ChordAxisConfig
}

/** Dash patterns offered in the Connection panel — each maps to a fixed
 *  SVG `stroke-dasharray` recipe in `lib/dashPatterns.ts`. New patterns
 *  add entries to BOTH places (the union here and the recipe map there)
 *  so the panel and renderer stay in sync. `"blank"` is the range-mode
 *  gap option: where the dash applies the line doesn't draw at all (only
 *  the "Fill dash gaps" underlay, when on). Only offered while "Apply
 *  pattern to range" is enabled — as a whole-line dash it would erase the
 *  line, so outside an active range the renderers treat it as solid. */
export type LineDashPattern = "solid" | "dashed" | "dotted" | "dash-dot" | "blank"
export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
	lineColors: {},
	thickness: 2,
	// Default to "line" (each layer renders as a polyline) rather than the
	// historical "area" fill. Areas mode users still get a one-click toggle
	// — but the line shape is what most newcomers expect when they map a
	// connection field to scatter or areas, and it composes better with
	// every other connection knob (per-line color, point sampling, dash
	// patterns).
	fill: "line",
	strokeColor: null,
	pointSampling: "all",
	pointEveryN: 5,
	dashPatterns: {},
	defaultDashPattern: "solid",
	customDashPattern: null,
	dashAlternateColors: {},
	dashGapColor: null,
	dashGapFill: null,
	fillPolygon: false,
	lineOpacity: 1,
	fillOpacity: 1,
	axisStem: "none",
	stemColorField: null,
	stemColorPaletteId: null,
	stemColorPalette: null,
	stemColorMode: "point",
	stemColor: null,
	lineCap: "round",
	smoothing: 0,
	hierarchyIdField: null,
	flowTargetField: null,
}

/** Per-panel axis range override. Keys are optional — omit a bound to let
 * it auto-compute from the panel's data. Applied per chart mode:
 *   - scatter: both x and y bounds shape the position scales directly.
 *   - vertical bars/areas (bars-x / areas-x): only `yMin`/`yMax` bind the
 *     measure axis (the x-axis is categorical).
 *   - horizontal bars/areas (bars-y / areas-y): only `xMin`/`xMax` bind the
 *     measure axis (the y-axis is categorical).
 *   - pies: no axes, so every field is a no-op. */
export type PanelAxisOverride = {
	xMin?: number
	xMax?: number
	yMin?: number
	yMax?: number
}

/** Small-multiples layout. When a categorical field is mapped to the facet
 * encoding, the chart area splits into a grid of panels — one per unique
 * facet value. Either rows or cols may be `null` to auto-derive from the
 * other; set both to pin the grid exactly. */
export type FacetConfig = {
	rows: number | null
	cols: number | null
	/** @deprecated Legacy bundled toggle. Both `shareX` and `shareY` are
	 * authoritative going forward; we keep this so older saved visuals
	 * still hydrate, but new code reads the per-axis flags. The
	 * `migrateShareValue` helper derives `shareX`/`shareY` from this when
	 * the stored config predates the split. */
	shareAxes: boolean
	/** Tri-state scale sharing for the x-axis. "all" = one shared x-axis
	 *  across the grid; "perGroup" = one per column (each column's panels
	 *  share x); "none" = every panel its own x. Legacy boolean values
	 *  (true / false) and `undefined` are normalized via migrateShareValue,
	 *  so saved visuals continue to load. */
	shareX?: "none" | "perGroup" | "all" | boolean
	/** Same as shareX for the y-axis: "all" = one shared y; "perGroup" =
	 *  one per row; "none" = every panel its own y. */
	shareY?: "none" | "perGroup" | "all" | boolean
	/** Horizontal whitespace between panel plot rectangles, in pixels.
	 * Measured plot-edge to plot-edge — does NOT include any axis labels,
	 * tick labels, axis titles, or facet labels (those are chrome that
	 * sits outside the panel). Negative values overlap panels (ridgeline
	 * use case). */
	gapX: number
	/** Vertical whitespace between panel plot rectangles, in pixels.
	 * Same semantics as gapX. Facet labels for the row below render in
	 * this whitespace, so this should typically be >= the facet label
	 * height (~20px) to avoid the labels overlapping the row above's
	 * plot. */
	gapY: number
	/** Optional pixel-precise inner-width override for EVERY panel.
	 * When set (positive number), the solver bypasses the
	 * proportional / equal-split distribution and sizes every panel's
	 * `inner.width` to this value. If the total grid demand exceeds
	 * the container width, the canvas grows and the renderer wraps
	 * it in a scroll container. `null`/`undefined` (the default) =
	 * use automatic distribution. Useful for fine-tuning a chart's
	 * exact panel proportions or for matching a print/export
	 * specification. */
	panelWidth?: number | null
	/** Mirror of `panelWidth` for `inner.height`. */
	panelHeight?: number | null
	/** Per-panel axis range overrides keyed by facet value (stringified). Only
	 * consulted when neither share-axis flag is on for that axis. */
	panelAxisOverrides: Record<string, PanelAxisOverride>
	/** Per-row y-axis range overrides. Keyed by the row's facet value
	 *  (stringified). Only consulted when `shareY === "perGroup"` AND the
	 *  y-axis variable is continuous (quantitative or temporal); the UI
	 *  for these overrides is hidden otherwise. The legacy
	 *  `panelAxisOverrides` keyed by individual panel value stays for
	 *  wrap-mode back-compat. */
	rowAxisOverrides?: Record<string, { min?: number; max?: number }>
	/** Mirror of `rowAxisOverrides` for the x-axis per column. */
	colAxisOverrides?: Record<string, { min?: number; max?: number }>
	/** Overall y-axis range applied when `shareY === "all"` and y is
	 *  quantitative or temporal. Lets the user pin the shared axis to
	 *  a "pretty" start (e.g. 0) or an upper bound even though d3-nice
	 *  would otherwise pick something larger. Either bound may be
	 *  omitted to keep auto-fit on that side. */
	overallYRange?: { min?: number; max?: number }
	/** Mirror of `overallYRange` for the x-axis. */
	overallXRange?: { min?: number; max?: number }
	/** Polar-chart (radar / pie) share modes. Polar plots aren't
	 *  cartesian — the R axis and the angle axis don't have a natural
	 *  row vs col bias, so they each get a 4-way picker:
	 *    "none"   = every panel its own scale
	 *    "perRow" = panels in the same layout row share
	 *    "perCol" = panels in the same layout column share
	 *    "all"    = every panel shares
	 *  These coexist with `shareX` / `shareY`; the renderer reads
	 *  `shareR` for radar's R channel and `shareAngle` for the angle
	 *  channel. Missing → migrate from shareX/shareY (perGroup → perRow
	 *  for R, perCol for angle) so saved visuals upgrade cleanly. */
	shareR?: "none" | "perRow" | "perCol" | "all"
	shareAngle?: "none" | "perRow" | "perCol" | "all"
	/** "Size panels by unit" for polar charts — scales each panel's
	 *  rendered radius proportionally to its R range (radar) or its
	 *  total slice value (pie). Off = every panel has the same
	 *  diameter; on = panels with bigger underlying values render
	 *  bigger. Has no effect outside polar modes. */
	proportionalPanelSizing?: boolean
	/** R-axis range overrides for polar (radar) charts. Mirrors the
	 *  cartesian `overallYRange` / `rowAxisOverrides` / etc. family
	 *  but kept on dedicated fields so switching between cartesian
	 *  and polar modes doesn't cross-pollute settings.
	 *
	 *  Application order (highest priority first):
	 *    - shareR === "all"      → overallRRange
	 *    - shareR === "perRow"   → rowRAxisOverrides[rowKey]
	 *    - shareR === "perCol"   → colRAxisOverrides[colKey]
	 *    - shareR === "none"     → panelRAxisOverrides[panelKey] */
	overallRRange?: { min?: number; max?: number }
	rowRAxisOverrides?: Record<string, { min?: number; max?: number }>
	colRAxisOverrides?: Record<string, { min?: number; max?: number }>
	panelRAxisOverrides?: Record<string, { min?: number; max?: number }>
	/** Per-panel display order keyed by facet value (stringified). Values with
	 * an entry sort ascending by the number; values without fall through in
	 * their natural (data-encounter) order. */
	panelOrder: Record<string, number>
	/** Size each panel proportional to its number of categories on the
	 * non-measure axis. Only meaningful when that axis isn't shared — with
	 * a shared axis every panel sees the same domain so equal sizing is
	 * already the right answer.
	 *
	 * Defaults to `true`. Equal-sized panels with varying category counts
	 * produce a layout bug: the band/point scale puts the first tick at
	 * `(plot_area_height) / (2 * N)` from the plot top, so a panel with 1
	 * category gets a much larger title-to-first-tick gap than a panel
	 * with 6. Proportional sizing makes plot_area_height proportional to
	 * N, which keeps that offset constant across panels. Users can still
	 * disable to force equal-sized panels. */
	proportionalSizing?: boolean
	/** Same idea as `proportionalSizing`, but the weight is each panel's
	 * data range on its quantitative axis instead of its category count.
	 * Useful when panels share a categorical other-axis but each has a
	 * different value range (e.g., panel A's y spans 0–10, panel B's y
	 * spans 0–20 → B renders twice as tall). When BOTH flags are true,
	 * this one wins. Spec §4.5. */
	proportionalSizingByUnit?: boolean
	/** Per-axis sizing modes. Drives panel widths (X) and heights (Y) when
	 *  proportional sizing is on. Migrated from the older global flags
	 *  `proportionalSizing` / `proportionalSizingByUnit`. The legacy flags
	 *  are kept on the type for back-compat with saved visuals; readers
	 *  go through `migrateProportionalSizing` to get the per-axis value. */
	proportionalSizingX?: "off" | "categoryCount" | "unit"
	proportionalSizingY?: "off" | "categoryCount" | "unit"
	/** Grid mode (both facetRow AND facetCol mapped): drop cross-product
	 *  cells with no data and compact the survivors. Layout adapts to how
	 *  evenly the surviving panels distribute — see resolveFacetPanels'
	 *  compactNonEmptyGrid. Default off; wrap / row-only / col-only modes
	 *  ignore it (their domains are data-derived, so no cell is ever
	 *  empty). */
	hideEmptyPanels?: boolean
}
export const DEFAULT_FACET_CONFIG: FacetConfig = {
	rows: null,
	cols: null,
	shareAxes: true,
	shareX: "all",
	shareY: "all",
	gapX: 30,
	gapY: 30,
	panelWidth: null,
	panelHeight: null,
	panelAxisOverrides: {},
	rowAxisOverrides: {},
	colAxisOverrides: {},
	overallYRange: {},
	overallXRange: {},
	proportionalPanelSizing: false,
	panelOrder: {},
	proportionalSizing: true,
	proportionalSizingByUnit: false,
	proportionalSizingX: "categoryCount",
	proportionalSizingY: "categoryCount",
	hideEmptyPanels: false,
}

/** Normalize a possibly-legacy share value to the canonical tri-state.
 *  Saved visuals predating Phase 2 carry `shareX` / `shareY` as
 *  `boolean | undefined`; new code reads tri-state strings. This
 *  function is the single source of truth for that mapping.
 *
 *  - `true` → "all"  (legacy "shared")
 *  - `false` → "none" (legacy "unshared")
 *  - `undefined` → derives from `shareAxes` (older configs only stored
 *    the bundled flag): true → "all", false → "none"
 *  - any tri-state string → passes through verbatim */
export const migrateShareValue = (
	value: "none" | "perGroup" | "all" | boolean | undefined,
	shareAxes: boolean,
): "none" | "perGroup" | "all" => {
	if (value === true) return "all"
	if (value === false) return "none"
	if (value === undefined) return shareAxes ? "all" : "none"
	return value
}

/** Normalize a polar share value, falling back to the cartesian
 *  shareX / shareY value when the polar-specific field is unset.
 *  `mappedAxis = "R"` reads from shareY (R is the row-axis in
 *  facetAxisMapping); `"angle"` reads from shareX (angle is the
 *  col-axis). The cartesian "perGroup" semantics translate to
 *  "perRow" for R and "perCol" for angle — matching what the
 *  cartesian share-axis picker UI used to mean for these channels. */
export const migratePolarShareValue = (
	polarValue: "none" | "perRow" | "perCol" | "all" | undefined,
	cartesianValue: "none" | "perGroup" | "all" | boolean | undefined,
	cartesianShareAxes: boolean | undefined,
	mappedAxis: "R" | "angle",
): "none" | "perRow" | "perCol" | "all" => {
	if (polarValue !== undefined) return polarValue
	const v = migrateShareValue(cartesianValue, cartesianShareAxes ?? false)
	if (v === "perGroup") return mappedAxis === "R" ? "perRow" : "perCol"
	return v
}

/** Resolve a per-axis proportional-sizing value from the (possibly
 *  legacy) global flags. Read by PlotCanvas when computing xWeight /
 *  yWeight per panel, and by the row / col facet option panels. */
export const migrateProportionalSizing = (
	perAxis: "off" | "categoryCount" | "unit" | undefined,
	legacyOn: boolean | undefined,
	legacyByUnit: boolean | undefined,
): "off" | "categoryCount" | "unit" => {
	if (perAxis !== undefined) return perAxis
	if (legacyOn === false) return "off"
	if (legacyByUnit === true) return "unit"
	return "categoryCount" // legacyOn === true or unset; the historical default
}

/** Whether "Size rows by …" is meaningful for this grid shape + share mode.
 *  Sizing assigns ONE weight per row, so it needs each row to have a
 *  well-defined Y characteristic: a single panel with its own Y (1 col +
 *  shareY=none), or a row-shared Y (2+ cols + shareY=perGroup). Everything
 *  else collapses to uniform weights or makes the per-row weight ambiguous.
 *
 *  Shared by FacetOptionsPanel (whether to SHOW the sizing toggle / panel-dim
 *  inputs) and PlotCanvas (whether sizing WINS over an explicit panelHeight at
 *  render time). The two must stay in lockstep: when the UI hides the sizing
 *  toggle as a no-op and offers the pixel input instead, the runtime must
 *  honor that pixel value rather than treating the inert sizing flag as
 *  active. */
export const rowSizingMeaningful = (
	rows: number,
	cols: number,
	shareY: "none" | "perGroup" | "all",
): boolean =>
	rows >= 2 &&
	((cols === 1 && shareY === "none") || (cols >= 2 && shareY === "perGroup"))

/** Column-axis counterpart of `rowSizingMeaningful` — same lockstep contract. */
export const colSizingMeaningful = (
	rows: number,
	cols: number,
	shareX: "none" | "perGroup" | "all",
): boolean =>
	cols >= 2 &&
	((rows === 1 && shareX === "none") || (rows >= 2 && shareX === "perGroup"))

// Defaults for when no field is mapped to an encoding.
// These replace hardcoded constants in ScatterPlot.tsx so users can customize
// the base aesthetics of all marks (e.g. "all points are pink stars at radius 8").
export const DEFAULT_FILL = "#d1d5db"
export const DEFAULT_RADIUS = 4
export const DEFAULT_OPACITY = 0.85
export const DEFAULT_SHAPE = 0
export const DEFAULT_ANGLE = 0
/** Configuration for the `text` encoding — labels rendered next to (scatter)
 * or inside (bars / pies / tiles) marks. The user can pin a single color or
 * supply a per-category palette overriding it; the palette is independent
 * from `hue` so e.g. light-fill bars can carry darker text. */
export type TextConfig = {
	/** Single fallback color when neither a palette nor a per-category
	 * override applies. */
	color: string
	/** Per-category color overrides, keyed by stringified category value.
	 * Always wins when set, regardless of palette / fallback. */
	colorOverrides: Record<string, string>
	/** Optional palette assigned to the text channel — independent from
	 * the hue palette so e.g. light-fill bars can carry darker text via
	 * a paired darker palette. When null/empty, text falls back to the
	 * single `color` fallback. */
	palette: string[]
	fontFamily: string
	fontSize: number // px
	fontWeight: number
	/** Number of fractional digits when the text value is numeric. `null`
	 * leaves numbers as the raw string from the row. */
	decimals: number | null
}

export const DEFAULT_TEXT_CONFIG: TextConfig = {
	color: "#111827",
	colorOverrides: {},
	palette: [],
	fontFamily: "system-ui, sans-serif",
	fontSize: 11,
	fontWeight: 500,
	decimals: null,
}

export type ChannelConfigs = Partial<{
	x: AxisConfig
	y: AxisConfig
	r: AxisConfig
	area: AreaConfig
	hue: HueConfig
	/** Stash of the last quantitative `hue` config, saved when the hue
	 * encoding switches to a categorical/derived source (the live quant
	 * config is dropped then so the renderer can't confuse the two kinds).
	 * Restored — instead of re-seeding from the theme — when hue goes
	 * quantitative again, so a picked gradient survives an encoding
	 * round-trip. Never read while `hue` itself is quantitative. */
	hueQuantStash: Extract<HueConfig, { kind: "quantitative" }>
	/** Mirror stash for the categorical `hue` config, saved when a
	 * quantitative field replaces it — per-value color overrides survive a
	 * round-trip through a gradient the same way. */
	hueCategoricalStash: Extract<HueConfig, { kind: "categorical" }>
	/** Color scale that drives mark *outline* (stroke) color, mapped to its
	 * own field via the `outlineHue` encoding. Reuses the `HueConfig` shape
	 * (categorical palette or quantitative gradient). Independent of `hue`,
	 * which drives fill. When unmapped, outlines fall back to
	 * `shape.outlineColor` (the universal per-chart stroke color). */
	outlineHue: HueConfig
	saturation: SaturationConfig
	brightness: BrightnessConfig
	opacity: OpacityConfig
	shape: ShapeConfig
	pattern: PatternConfig
	length: LengthConfig
	angle: AngleConfig
	connection: ConnectionConfig
	facet: FacetConfig
	text: TextConfig
	/** Hexbin binning (not a channel — chart-level, but configured from the
	 * Color panel since the hue mapping is what enables hexbin mode). */
	hexbin: HexbinConfig
	// Defaults for when no field is mapped
	defaultFill: string // DEFAULT_FILL
	defaultRadius: number // DEFAULT_RADIUS
	defaultOpacity: number // DEFAULT_OPACITY (the Fill / overall opacity)
	defaultShape: number // DEFAULT_SHAPE (palette index)
	defaultSaturation: number | null // null = no modulation
	defaultBrightness: number | null // null = no modulation
	defaultPattern: number | null // null = no pattern
	defaultPatternInk: string // DEFAULT_PATTERN_INK from patterns.tsx
	defaultAngle: number // degrees
	defaultLength: number | null // null = shape mode, number = line px
	// Palette settings (resolved from theme at visualization creation)
	categoricalPaletteId: string // ID of the SavedCategoricalPalette
	categoricalPalette: string[] // resolved color array (for rendering)
	/** Per-color pattern-ink override paired with `categoricalPalette`. Same
	 * length when present; entries may be `null` to fall back to the global
	 * `patternInkColor`. Resolved from the source `SavedCategoricalPalette` at
	 * theme-snapshot time. */
	categoricalPalettePatternInks: Array<string | null>
	/** Ordinal palette settings. Used when the hue field's effective type
	 *  is `ordinal`. Mirrors the categorical fields but pulled from the
	 *  theme's `ordinalPalettes` list so themes can supply sequential
	 *  (light → dark) palettes that read as ordered. */
	ordinalPaletteId?: string
	ordinalPalette?: string[]
	ordinalPalettePatternInks?: Array<string | null>
	/** Outline-color palette selection for the `outlineHue` channel, kept
	 *  independent of the fill-hue palette (`categoricalPalette` /
	 *  `ordinalPalette`) so picking an outline palette never disturbs the
	 *  fill. Unset → outline falls back to the fill palette, preserving the
	 *  behavior of visuals saved before outline had its own picker. */
	outlineCategoricalPaletteId?: string
	outlineCategoricalPalette?: string[]
	outlineOrdinalPaletteId?: string
	outlineOrdinalPalette?: string[]
	defaultGradientId: string // preset name like "viridis", or ID of saved gradient
	defaultGradientColors: { low: string; mid?: string; high: string } | null // resolved
	patternInkColor: string // default pattern ink
	/** Per-visual chart background color. `null` (or absent) means transparent
	 * — host page / iframe shows through. */
	backgroundColor: string | null
	/** Global chart-canvas behavior when natural content would exceed the
	 * available container:
	 *   "fit" (default): canvas matches container; panels / inner rects
	 *     shrink to fit, no scrollbar. Best for dashboards and fixed embeds.
	 *   "scroll": preserve minimum per-panel size and per-category spacing.
	 *     The chart canvas grows beyond the container and a scrollbar
	 *     appears. Best when you have many facets, long categorical axes,
	 *     or need legible labels at the cost of scrolling.
	 *
	 * Applies to BOTH faceted and single-panel charts. For single-panel
	 * charts with many categorical ticks (e.g., bars-y with 50 activities),
	 * scroll mode lets each tick keep ~20px of space; fit mode squishes
	 * them into the container regardless of count. */
	scrollMode: "fit" | "scroll"
	/** Paint (z-) order for overlapping point marks — scatter, dot map,
	 * bubble map. `null`/absent = the renderer's default: dataset row order
	 * for scatter (later rows draw on top), largest-circle-first for the geo
	 * maps (small bubbles stay visible). When set, marks stable-sort by the
	 * field before painting — ascending puts the highest values on top,
	 * descending the lowest. Paint time ONLY: connection lines, scales, and
	 * aggregations still see dataset order. */
	drawOrder?: DrawOrderConfig | null
	/** Aesthetics → Aspect ratio (see AspectRatioConfig). Absent = off. */
	aspectRatio: AspectRatioConfig
	/** Aesthetics → Canvas size (see CanvasSizeConfig). Absent = off:
	 * the chart fills the editor viewport as before. */
	canvasSize: CanvasSizeConfig
	/** Generic color targets beyond fill (`hue`) and outline (`outlineHue`):
	 * line, rug, violin/box stroke + fill, lollipop stem, radar spine. Each is
	 * an independent optional color encoding surfaced as a subheader in the
	 * Color menu. Sparse — an absent slot means the renderer falls back to the
	 * legacy per-feature color field (e.g. `histogram.rugColor`), so visuals
	 * saved before this existed render unchanged. */
	colorSlots: ColorSlots
	/** Per-part opacity targets (border + the same set of slots as color, minus
	 * fill which reuses the overall `opacity` encoding). Each is an independent
	 * optional opacity encoding surfaced as a subheader in the Opacity menu.
	 * Sparse — an absent slot means the part renders at its registry
	 * `defaultLevel`. */
	opacitySlots: OpacitySlots
}>

export const EMPTY_CHANNEL_CONFIGS: ChannelConfigs = {}

/** Settings that control how the Data Labels layer draws on top of the
 * main visualization. The layer's encodings (which fields drive x, y,
 * hue, size, text) live in their own `DataLabelsEncodings`; this object
 * holds appearance + offsets + per-channel scale knobs. */
export type DataLabelsConfig = {
	/** Fallback color used when no `hue` field is mapped (or no palette
	 * resolves). */
	color: string
	/** Per-category color overrides keyed by stringified value of the hue
	 * field. Wins over the hue scale and the fallback. */
	colorOverrides: Record<string, string>
	/** Saved-palette id (from `theme.categoricalPalettes`) used to color
	 * labels by the hue field's category index. `null` means the user hasn't
	 * picked a labels-specific palette — the layer inherits the CHART's
	 * palette so labels match the marks without extra setup. The sentinel
	 * `DATA_LABELS_SINGLE_COLOR_ID` means the user explicitly chose "None
	 * (single color)" — labels ignore palettes and use the single `color`
	 * value. Only consulted when the hue field's effective type is
	 * categorical/ordinal. */
	paletteId: string | null
	/** Resolved palette colors — duplicated from `theme.categoricalPalettes`
	 * at the moment the user picks a palette so the renderer doesn't have
	 * to reach into the theme atom on every frame. Empty when no palette
	 * is selected. */
	palette: string[]
	/** Quantitative gradient id used when the hue field's effective type
	 * is quantitative/temporal. Either a d3 preset name (`"viridis"`,
	 * `"plasma"`, …) or a saved-gradient id from
	 * `theme.linearGradients` / `theme.divergingGradients`. `null` means
	 * no gradient — labels fall back to the single `color` value. */
	gradientId: string | null
	/** Resolved low/mid/high colors when `gradientId` points at a saved
	 * linear / diverging gradient. `null` when the id is a preset (those
	 * resolve via the d3 interpolator at render time). */
	gradientColors: { low: string; mid: string | null; high: string } | null
	/** Font family for labels. Defaults to the theme's text font. */
	fontFamily: string
	/** Default font weight applied to every label (when no per-channel
	 * override applies). */
	fontWeight: number
	/** Italic label text. Optional so saved visuals from before the style
	 * controls load with it off — matching their previous look. */
	italic?: boolean
	/** Underlined label text. Optional for the same back-compat reason. */
	underline?: boolean
	/** Default font size in px (used when no `size` field is mapped). */
	fontSize: number
	/** Min/max font size when a `size` field is mapped — the field's
	 * numeric range scales linearly across this px range. */
	sizeMin: number
	sizeMax: number
	/** Pixel offset added to each label's x position after the chart
	 * scale lookup. Lets the user nudge labels relative to a bar end or
	 * a point — e.g. +12 to push them past the right edge of bars. */
	xOffset: number
	/** Pixel offset added to each label's y position. */
	yOffset: number
	/** When the text field is numeric, render with this many fractional
	 * digits. `null` leaves the raw value as-is. In multi-field mode this is
	 * the fallback for any selected field without its own `fieldFormats`
	 * entry. */
	decimals: number | null
	/** Multi-field mode only (`DataLabelsEncodings.value.multiField`): the
	 * arrangement of the selected fields, as a string with `{Field}` tokens —
	 * e.g. `"{Region} ({Share})"`. Any literal text between tokens is kept
	 * verbatim; a token whose name isn't a selected field is left as-is.
	 * Empty / unset = join the selected fields (in check order) with ", ". */
	labelTemplate?: string
	/** Multi-field mode only: per-field number format, keyed by field name.
	 * Each value is a d3-format spec (the same specs the axes use, via
	 * `buildTickFormatter`) — e.g. `".1%"` → `32.0%`, `"$,.0f"` → `$1,200`.
	 * A field with no entry falls back to `decimals`. */
	fieldFormats?: Record<string, string>
	/** Multi-field mode only: per-field TEXT COLOR, keyed by field name — one
	 * color slot per variable shown in the label, mirroring the mark color
	 * slots (fill / outline / line). Each is a `ColorSlotConfig`: single color
	 * (`field: null`), or vary-by a field via palette / gradient — so a
	 * category can be tinted to match its line while a delta varies by value.
	 * No entry → that variable uses the label's normal color chain. */
	fieldColors?: Record<string, ColorSlotConfig>
	/** Where labels sit along a bar's measure axis, when the chart is a bar
	 * chart and Data Labels' position-axis isn't mapped to a field.
	 *  - `"center"` (default): slice midpoint — current behavior.
	 *  - `"inside-base"`: just inside the bar near the zero baseline /
	 *     stack-bottom for stacked bars.
	 *  - `"inside-end"`: just inside the bar near the top / stack-top.
	 *  - `"outside-end"`: just outside the bar past the top of the slice.
	 * Has no effect on scatter / area / pie / tile renderers (they have no
	 * "measure axis end" to refer to). */
	barLabelPosition?: "center" | "inside-base" | "inside-end" | "outside-end"
	/** When true, only the LAST label per series is rendered — useful for
	 * directly labeling line charts and stacked bar charts at their end so
	 * the legend can be turned off. "Series" is the value of the hue field
	 * (anchor-based renderers) or the connection field (scatter+connection
	 * line charts). When neither is mapped, the single absolute-last label
	 * is kept.
	 *
	 * Superseded by `labelPoints` — kept (and still read) so saved visuals
	 * from before the selector keep their look; the panel no longer writes
	 * it. */
	onlyLastLabel?: boolean
	/** Which labels render, per series. Supersedes `onlyLastLabel`; resolve
	 * the effective value via `effectiveLabelPoints(cfg)`, which falls back
	 * to the legacy boolean when this is unset.
	 *  - `"all"` (default): every label.
	 *  - `"first"` / `"last"`: only the first / last anchor per series along
	 *    the chart's primary axis (position-ranked, like `onlyLastLabel`).
	 *  - `"first-last"`: both ends. A single-point series renders ONE label,
	 *    styled by the `lastLabel` overrides (direct-labeling intent). */
	labelPoints?: LabelPointsMode
	/** Per-endpoint overrides, consulted ONLY in `"first-last"` mode — that's
	 * the only mode where two label populations coexist and need to differ.
	 * The single `"first"` / `"last"` modes use the layer-wide template /
	 * offset / alignment directly, matching the panel (which only splits the
	 * controls into First/Last pairs when both ends are shown). Every unset
	 * field inherits the layer-wide value. */
	firstLabel?: EndpointLabelOverrides
	lastLabel?: EndpointLabelOverrides
	/** When true, the renderer detects label boxes that overlap and nudges
	 * later labels along the y-axis to keep them readable. Best-effort —
	 * with many labels in a small space some collisions remain — but
	 * cheap to enable when it helps. */
	avoidOverlaps?: boolean
	/** Conditional overrides for the label's text color, evaluated against
	 * the label's numeric value when it can be parsed as a number. The
	 * first matching rule's color wins; non-matching rules fall through
	 * to the standard color resolution chain (per-category override → hue
	 * scale → `color`). Designed for heatmaps where a single text color
	 * doesn't read on every cell in the gradient — e.g. white on dark
	 * tiles and black on light ones. */
	textColorRules?: TextColorRule[]
	/** Horizontal text alignment for the label. Maps to SVG `text-anchor`:
	 *  - `center` (default) → `middle` (label centered on anchor point)
	 *  - `left` → `start` (label extends right of anchor)
	 *  - `right` → `end` (label extends left of anchor)
	 *  Pairs naturally with `onlyLastLabel`: setting alignment to "left"
	 *  + a small positive `xOffset` puts the last label cleanly to the
	 *  right of its point instead of overlapping it. */
	alignment?: "left" | "center" | "right"
	/** When true, long label text wraps onto multiple lines instead of
	 *  rendering as a single run. The wrap point is chosen by
	 *  `wrapMaxChars` (see below). SVG `<text>` has no auto-wrap, so the
	 *  renderer pre-splits the string into `<tspan>` lines. Optional so
	 *  saved visuals load with wrapping off (their previous look). */
	wrapText?: boolean
	/** Target number of characters per line when `wrapText` is on. The
	 *  wrapper aims for this width but breaks on the SPACE nearest the
	 *  target — searching both directions — so lines land on word
	 *  boundaries and never split mid-word (an over-long word simply
	 *  overflows its line). Ignored when `wrapText` is false. */
	wrapMaxChars?: number
	/** Pie / polar label placement — distance from the pie center as a
	 *  PERCENT of the pie radius. `100` (the default) lands on the rim /
	 *  border; lower values pull labels inside the wedge (`65` ≈ mid-wedge);
	 *  `>100` pushes them outside the pie. The cartesian polar analogue of
	 *  `yOffset`. Ignored by non-polar renderers. */
	polarLabelRadius?: number
	/** Pie / polar label placement — angular nudge in DEGREES applied to
	 *  every label, rotating it off its slice's midpoint angle. Positive =
	 *  clockwise, matching d3's arc convention (0° = 12 o'clock). The
	 *  cartesian polar analogue of `xOffset`. Ignored by non-polar
	 *  renderers. */
	polarLabelAngle?: number
	/** When true, draw a filled rounded rect behind each label so the text
	 *  reads cleanly over gridlines / dense marks instead of colliding with
	 *  them. */
	textBackground?: boolean
	/** Fill color of the text-background rect. `null` (the default) inherits
	 *  the visualization's background color — white when that's transparent —
	 *  so labels blend into the chart canvas while masking gridlines. */
	textBackgroundColor?: string | null
	/** Corner radius (px) of the text-background rect. `0` = square corners. */
	textBackgroundRadius?: number
	/** Horizontal padding (px) added to EACH side of the text inside the
	 *  background rect. Widens the rect left and right of the glyphs. */
	textBackgroundPadX?: number
	/** Vertical padding (px) added to the top and bottom of the text inside
	 *  the background rect. */
	textBackgroundPadY?: number
	/** Packed circles only: container depths (1 = top level) whose labels
	 *  wrap around the OUTSIDE of their circle on an arc instead of sitting
	 *  inside the top rim. Managed by the Data Labels panel's "Text
	 *  Position" checkboxes; other renderers ignore it. */
	arcWrapLevels?: number[]
}

export type LabelPointsMode = "all" | "first" | "last" | "first-last"

/** Overrides one endpoint's labels can apply on top of the layer-wide
 *  Data Labels config. Deliberately limited to template + offset +
 *  alignment — the things that legitimately differ between a line's start
 *  and end labels. Per-endpoint fonts/colors/backgrounds are out of scope
 *  (that shape of need is multi-layer composition, not more knobs here). */
export type EndpointLabelOverrides = {
	/** Multi-field mode only: alternate `{Field}` template for this
	 *  endpoint's labels. Empty/unset = inherit `labelTemplate` (an empty
	 *  string means "inherit", not "blank label" — hide an endpoint via
	 *  `labelPoints` instead). Anchor-based renderers (bars/areas) pre-format
	 *  their label text without templates, so this only affects the
	 *  row-based path (scatter / line charts). */
	labelTemplate?: string
	/** REPLACE (not add to) the layer-wide xOffset/yOffset for this
	 *  endpoint's labels. null/unset = inherit. */
	xOffset?: number | null
	yOffset?: number | null
	/** Replace the layer-wide alignment. null/unset = inherit. */
	alignment?: "left" | "center" | "right" | null
}

/** The selection `DataLabelsLayer` should apply: the new `labelPoints`
 *  value when present, else the legacy `onlyLastLabel` boolean mapped onto
 *  the same scale — so saved visuals keep rendering without a migration. */
export const effectiveLabelPoints = (
	cfg: Pick<DataLabelsConfig, "labelPoints" | "onlyLastLabel">
): LabelPointsMode =>
	cfg.labelPoints ?? (cfg.onlyLastLabel === true ? "last" : "all")

/** Sentinel for `DataLabelsConfig.paletteId`: the user explicitly picked
 *  "None (single color)" in the Data Labels color panel. Distinct from
 *  `null` (no pick yet → inherit the chart's palette) so the layer knows
 *  to skip the inherit-chart-palette fallback and color every label with
 *  the single `color` value. */
export const DATA_LABELS_SINGLE_COLOR_ID = "__single__"

/** A "if the label's numeric value matches this comparison, use this color"
 *  rule. `condition` is a freeform expression like `>0`, `<= 50`, `==5`.
 *  An unparseable string is treated as a non-match (rule skipped). */
export type TextColorRule = {
	condition: string
	color: string
}

export const DEFAULT_DATA_LABELS_CONFIG: DataLabelsConfig = {
	color: "#111827",
	colorOverrides: {},
	paletteId: null,
	palette: [],
	gradientId: null,
	gradientColors: null,
	fontFamily: "system-ui, sans-serif",
	fontWeight: 500,
	italic: false,
	underline: false,
	fontSize: 11,
	sizeMin: 8,
	sizeMax: 24,
	xOffset: 0,
	yOffset: 0,
	decimals: null,
	labelTemplate: "",
	fieldFormats: {},
	fieldColors: {},
	barLabelPosition: "center",
	onlyLastLabel: false,
	// labelPoints deliberately ABSENT from the defaults: merged configs are
	// `{...DEFAULT, ...saved}`, and a concrete "all" here would override the
	// legacy `onlyLastLabel: true` on saves from before the selector.
	// `effectiveLabelPoints` owns the fallback chain instead.
	firstLabel: {},
	lastLabel: {},
	avoidOverlaps: false,
	textColorRules: [],
	alignment: "center",
	wrapText: false,
	wrapMaxChars: 20,
	polarLabelRadius: 100,
	polarLabelAngle: 0,
	textBackground: false,
	textBackgroundColor: null,
	textBackgroundRadius: 2,
	textBackgroundPadX: 3,
	textBackgroundPadY: 1.5,
	arcWrapLevels: [],
}
