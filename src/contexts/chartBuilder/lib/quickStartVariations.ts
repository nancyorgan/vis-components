import type { StackMode } from "./channelConfig"
import type { EncodingChannel, FieldType } from "./types"

/** The chart families surfaced by the quick-start icon bar. Each has an
 * ordered list of `QuickStartVariation` entries that the cycle steps through. */
export type QuickStartChartType =
	| "bar"
	| "scatter"
	| "dumbbell"
	| "line"
	| "area"
	| "pie"
	| "radar"
	| "violin"
	| "density"
	| "tile"
	| "map"
	| "circles"
	| "treemap"
	| "sunburst"
	| "sankey"

export const QUICK_START_CHART_TYPES: readonly QuickStartChartType[] = [
	"bar",
	"scatter",
	"dumbbell",
	"line",
	"area",
	"pie",
	"radar",
	"violin",
	"density",
	"tile",
	"map",
	"circles",
	"treemap",
	"sunburst",
	"sankey",
] as const

/** One step in a chart family's cycle. The scaffold picks random fields of the
 * listed types for each channel, then applies the optional config knobs to
 * shape the rendered chart (stacking, area-vs-line, etc.).
 *
 * `allowOpportunisticHue` (default `true`) lets a variation pick up a hue
 * encoding for free when the dataset has a spare categorical field. This
 * collapses "plain" and "+hue" variations into one entry per chart shape —
 * richer starts when data supports it, graceful degradation when it doesn't.
 * Set to `false` on chart families where a second categorical just adds
 * noise (e.g. pies, whose wedges already color by the x category). */
export type QuickStartVariation = {
	name: string
	/** Channels the variation populates, and the field types each accepts.
	 * The scaffold picks a random eligible field per channel, preferring
	 * fields not already used by another channel in the same scaffold. */
	channels: Partial<Record<EncodingChannel, readonly FieldType[]>>
	/** Whether the scaffold should opportunistically add a hue encoding when
	 * `channels` doesn't already include hue and the dataset has a suitable
	 * categorical field available. Defaults to `true`. */
	allowOpportunisticHue?: boolean
	/** Applied to `hue.stackMode` whenever hue ends up mapped — whether
	 * explicitly in `channels` or picked up opportunistically. Defaults to
	 * `"stack"`. */
	stackMode?: StackMode
	/** Applies to `connection.fill`. Only meaningful when the variation maps
	 * connection (via `channels.connection` or `connectionFrom`). Determines
	 * whether an areas-family render draws a filled area ("area") or a
	 * polyline on the top edge only ("line"). */
	connectionFill?: "line" | "area"
	/** Turn on a distribution display on the named axis.
	 *   - `"violin"` / `"box"`: strip-plot variations (categorical x with
	 *     quant y, or vice versa). The overlay sits on the *value* axis — the
	 *     opposite side from the category axis the user named in `channels`.
	 *   - `"density"`: a standalone KDE curve of a LONE quantitative axis (no
	 *     opposite position axis at all — the density axis is implied), the
	 *     same config the manual Distribution → "Density" segment writes. */
	distributionOverlay?: { axis: "x" | "y"; mode: "violin" | "box" | "density" }
	/** Density-mode only: fill the area under the KDE curve (the manual "Fill
	 * under curve" checkbox, stored on the axis's shared histogram config as
	 * `densityFill`). Unset/false leaves the curve as a stroked line. */
	densityFill?: boolean
	/** Radar-only: when true, the auto-gen turns on
	 *  `connection.fillPolygon` so the closed polygon renders filled (the
	 *  classic "watercolor" radar look). No effect on non-radar variations
	 *  (the renderer ignores `fillPolygon` outside radar mode). */
	polygonFill?: boolean
	/** Map the Data Labels `value` encoding to the field assigned to the
	 * named channel. Data labels are NOT an encoding channel — they live in
	 * the separate `DataLabelsEncodings` atom driven by the Data Labels
	 * sidebar section — so variations opt in here instead of via `channels`.
	 * (The legacy `text` encoding channel is back-compat-only for old saved
	 * visuals; scaffolds must never map it.) Used by the tile heatmap to
	 * print each cell's value in the cell. */
	dataLabelsValueFrom?: EncodingChannel
	/** Marks a map variation and which geo chart mode it scaffolds. The geo
	 * channels are assigned from `detectGeoFields` results — by field VALUES,
	 * not field types — so they're NOT listed in `channels`:
	 *   - `"choropleth"` / `"symbols"`: the detected region-key field →
	 *     `connection`
	 *   - `"points"`: detected longitude → `x`, latitude → `y`
	 * `channels` carries only the measure/aesthetic channels on top. A map
	 * variation is unsatisfiable when the dataset has no matching geographic
	 * fields, regardless of `channels`. */
	geo?: "choropleth" | "symbols" | "points"
	/** Hierarchy / flow variations: which layout renders the shared
	 * area+connection encoding signature. Written to
	 * `connection.hierarchyLayout`, which is what the chart-mode registry
	 * dispatches on (the signature alone defaults to packed circles). */
	hierarchyLayout?: "pack" | "treemap" | "sunburst" | "chord" | "sankey"
	/** Map `hue` to the SAME field that landed on the named channel. Flow
	 * scaffolds point this at `connection`: hue on an endpoint column means
	 * "color by node" (the renderers build one scale over the source∪target
	 * union), where a random opportunistic categorical would color nothing. */
	hueFrom?: EncodingChannel
	/** Map `connection` to the SAME field that landed on the named channel.
	 * The dumbbell scaffold points this at `y`: connecting the points WITHIN
	 * each category is what makes it a dumbbell — a freshly-picked connection
	 * field would link points ACROSS categories (a line chart) instead.
	 * `assignFields` never sees this channel (it reuses an already-assigned
	 * field), so it can't affect satisfiability. */
	connectionFrom?: EncodingChannel
	/** Map `hue` to a hierarchy-DERIVED source instead of a field. Tree
	 * scaffolds use `"rootGroup"` so every node takes its outermost group's
	 * color — the canonical hierarchy look, with no extra column needed. */
	hueMeasureSource?: "rootGroup"
	/** Flow variations (sankey/chord) need a SECOND categorical column for
	 * the auto-detected flow target (`resolveFlowTargetField` never picks the
	 * source column itself). When true, the variation is unsatisfiable unless
	 * a spare categorical remains after the source + value assignments. */
	requiresFlowTarget?: boolean
}

const CATEGORICAL_LIKE = ["categorical", "ordinal"] as const
const QUANTITATIVE_LIKE = ["quantitative", "ordinal"] as const
const TIME_OR_QUANT = ["quantitative", "temporal", "ordinal"] as const
/** Line and area charts accept ANY x type — the connection field
 *  supplies the grouping that distinguishes series, so a categorical x
 *  (e.g., day names) renders the same line plot a temporal x would.
 *  Restricting x to TIME_OR_QUANT mistakenly grayed out the line/area
 *  generator buttons for datasets the manual flow accepts. */
const ANY_X_FOR_CONNECTED = [
	"quantitative",
	"temporal",
	"ordinal",
	"categorical",
] as const

/** Basic scatter accepts every field type — strip plots (categorical
 *  × quantitative), categorical × categorical lattice plots, etc. all
 *  render as valid scatters via the band-edge positional scale. The
 *  manual flow accepts these, so the random generator should too. */
const ANY_TYPE = [
	"quantitative",
	"temporal",
	"ordinal",
	"categorical",
] as const

export const QUICK_START_VARIATIONS: Record<
	QuickStartChartType,
	readonly QuickStartVariation[]
> = {
	bar: [
		{
			name: "Vertical bars",
			channels: {
				x: CATEGORICAL_LIKE,
				length: QUANTITATIVE_LIKE,
			},
		},
		{
			name: "Vertical grouped bars",
			// Grouping requires hue explicitly — the "group" stackMode is what
			// differentiates this from the vertical-bars variation above, which
			// would otherwise converge when opportunistic hue fires.
			channels: {
				x: CATEGORICAL_LIKE,
				length: QUANTITATIVE_LIKE,
				hue: CATEGORICAL_LIKE,
			},
			stackMode: "group",
		},
		{
			// Pattern-encoded bars — same hue+pattern combination shows off the
			// pattern overlay capability for users who haven't discovered it.
			name: "Patterned stacked bars",
			channels: {
				x: CATEGORICAL_LIKE,
				length: QUANTITATIVE_LIKE,
				hue: CATEGORICAL_LIKE,
				pattern: CATEGORICAL_LIKE,
			},
			stackMode: "stack",
		},
		{
			name: "Horizontal bars",
			channels: {
				y: CATEGORICAL_LIKE,
				length: QUANTITATIVE_LIKE,
			},
		},
		{
			// Horizontal stacked bars exercise the bars-y stack rendering and
			// give users a different layout to riff on.
			name: "Horizontal stacked bars",
			channels: {
				y: CATEGORICAL_LIKE,
				length: QUANTITATIVE_LIKE,
				hue: CATEGORICAL_LIKE,
			},
			stackMode: "stack",
		},
	],
	scatter: [
		{
			// Basic scatter accepts any field types on x/y — the renderer
			// handles categorical × quantitative (strip plot), categorical
			// × categorical (lattice), etc.
			name: "Scatter",
			channels: {
				x: ANY_TYPE,
				y: ANY_TYPE,
			},
		},
		{
			name: "Bubble",
			channels: {
				x: QUANTITATIVE_LIKE,
				y: QUANTITATIVE_LIKE,
				area: QUANTITATIVE_LIKE,
			},
		},
		{
			// Shape encoding pulls in a categorical so users see different
			// glyphs (circle, square, triangle, etc.) per category.
			name: "Shape scatter",
			channels: {
				x: ANY_TYPE,
				y: ANY_TYPE,
				shape: CATEGORICAL_LIKE,
			},
		},
		{
			// Combines size + shape + opportunistic hue — a "kitchen sink"
			// scatter that shows several aesthetic channels at once.
			name: "Multi-encoded scatter",
			channels: {
				x: QUANTITATIVE_LIKE,
				y: QUANTITATIVE_LIKE,
				area: QUANTITATIVE_LIKE,
				shape: CATEGORICAL_LIKE,
			},
		},
		{
			name: "Vector field",
			channels: {
				x: QUANTITATIVE_LIKE,
				y: QUANTITATIVE_LIKE,
				length: QUANTITATIVE_LIKE,
				angle: QUANTITATIVE_LIKE,
			},
		},
	],
	dumbbell: [
		{
			// Dumbbell: a categorical y with two-or-more measures per category
			// (rows split by the hue field), endpoints connected within each
			// category. `connectionFrom: "y"` is the load-bearing part — the
			// connection field must BE the category field so lines link each
			// category's own points. Shape distinguishes the endpoints alongside
			// hue, and area sizes them.
			name: "Dumbbell",
			channels: {
				y: CATEGORICAL_LIKE,
				x: QUANTITATIVE_LIKE,
				hue: CATEGORICAL_LIKE,
				shape: CATEGORICAL_LIKE,
				area: QUANTITATIVE_LIKE,
			},
			connectionFrom: "y",
			connectionFill: "line",
		},
		{
			// Vertical twin — categories along x, values on y.
			name: "Dumbbell (vertical)",
			channels: {
				x: CATEGORICAL_LIKE,
				y: QUANTITATIVE_LIKE,
				hue: CATEGORICAL_LIKE,
				shape: CATEGORICAL_LIKE,
				area: QUANTITATIVE_LIKE,
			},
			connectionFrom: "x",
			connectionFill: "line",
		},
	],
	line: [
		{
			name: "Line chart",
			channels: {
				x: ANY_X_FOR_CONNECTED,
				y: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			connectionFill: "line",
		},
		{
			name: "Horizontal line chart",
			channels: {
				y: ANY_X_FOR_CONNECTED,
				x: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			connectionFill: "line",
		},
	],
	area: [
		{
			name: "Stacked area",
			// Areas mode is keyed off the `length` encoding (not `y`) — the
			// chart-mode detector flips into areas-x only when `length` is
			// mapped. If we asked for `y` here, the chart would render as a
			// scatter+connection (i.e., a line chart) because no `length`
			// was assigned. Mapping the measure field to `length` directly
			// lets the area renderer take over.
			channels: {
				x: ANY_X_FOR_CONNECTED,
				length: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			connectionFill: "area",
			stackMode: "stack",
		},
		{
			name: "Overlay area",
			// Overlay requires hue — without multiple layers to overlay the mode
			// collapses to a single-series filled area, which is what the
			// first variation (+ opportunistic hue) already produces when data
			// allows.
			channels: {
				x: ANY_X_FOR_CONNECTED,
				length: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
				hue: CATEGORICAL_LIKE,
			},
			connectionFill: "area",
			stackMode: "overlay",
		},
	],
	pie: [
		{
			// Single centered pie — the classic case. Only `angle` is required,
			// so this variation is satisfiable whenever the dataset has one
			// quantitative field. Opportunistic hue makes the wedges distinct
			// when a categorical is available; otherwise the pie falls back to
			// a solid circle (technically valid, just visually boring).
			name: "Single pie",
			channels: {
				angle: QUANTITATIVE_LIKE,
			},
		},
		{
			// Pies arranged along the x-axis, one per x-category. Wedges still
			// color-code via hue (opportunistic by default).
			name: "Pie (categorical x)",
			channels: {
				x: CATEGORICAL_LIKE,
				angle: QUANTITATIVE_LIKE,
			},
		},
		{
			name: "Pie (categorical y)",
			channels: {
				y: CATEGORICAL_LIKE,
				angle: QUANTITATIVE_LIKE,
			},
		},
	],
	radar: [
		{
			// Connected radar — one closed polygon per series. The canonical
			// look: angle holds the metric categories, r holds the score, a
			// series field (connection) groups rows into polygons. Hue is
			// opportunistically picked when a spare categorical exists so
			// multi-series polygons render in distinct colors out of the gate.
			name: "Radar polygon",
			channels: {
				angle: CATEGORICAL_LIKE,
				r: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
		},
		{
			// Filled variant — same shape but fills each polygon (semi-transparent)
			// for the watercolor radar look.
			name: "Filled radar",
			channels: {
				angle: CATEGORICAL_LIKE,
				r: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			polygonFill: true,
		},
		{
			// Fallback for datasets without a spare series field: dots at each
			// (angle, r) point with no polygon. Still informative when the
			// user only has metric + score (no series column).
			name: "Radar (dots)",
			channels: {
				angle: CATEGORICAL_LIKE,
				r: QUANTITATIVE_LIKE,
			},
		},
	],
	violin: [
		{
			name: "Violin (vertical)",
			channels: {
				x: CATEGORICAL_LIKE,
				y: QUANTITATIVE_LIKE,
			},
			distributionOverlay: { axis: "y", mode: "violin" },
			// `assignFields` maps hue to the category axis (x here) so each
			// violin colors by its bin; opportunistic hue is disabled so it
			// can't pick a *different* field and fight that per-category color.
			allowOpportunisticHue: false,
		},
		{
			name: "Box plot (vertical)",
			channels: {
				x: CATEGORICAL_LIKE,
				y: QUANTITATIVE_LIKE,
			},
			distributionOverlay: { axis: "y", mode: "box" },
			allowOpportunisticHue: false,
		},
		{
			name: "Violin (horizontal)",
			channels: {
				y: CATEGORICAL_LIKE,
				x: QUANTITATIVE_LIKE,
			},
			distributionOverlay: { axis: "x", mode: "violin" },
			allowOpportunisticHue: false,
		},
	],
	// Density curve: a lone quantitative field on one position axis, rendered
	// as a standalone KDE curve (the manual Distribution → "Density" segment).
	// Only "quantitative" qualifies — the density display shares the
	// histogram's gate, which requires a strictly quantitative effective type
	// (ordinals read better as bars). Hue stays off: the single curve has
	// nothing to color per category, and the scatter marks are replaced by the
	// (optional) rug, so a random hue field would color nothing.
	density: [
		{
			name: "Density curve",
			channels: {
				x: ["quantitative"],
			},
			distributionOverlay: { axis: "x", mode: "density" },
			allowOpportunisticHue: false,
		},
		{
			// Same curve with the area under it filled — the manual "Fill under
			// curve" checkbox.
			name: "Filled density curve",
			channels: {
				x: ["quantitative"],
			},
			distributionOverlay: { axis: "x", mode: "density" },
			densityFill: true,
			allowOpportunisticHue: false,
		},
	],
	tile: [
		{
			name: "Tile heatmap",
			channels: {
				x: CATEGORICAL_LIKE,
				y: CATEGORICAL_LIKE,
				hue: QUANTITATIVE_LIKE,
			},
			allowOpportunisticHue: false,
		},
		{
			// Labels each cell with the same value that drives its color, via
			// the Data Labels system (so the sidebar's Data Labels section
			// reflects and controls what's rendered).
			name: "Tile heatmap with cell labels",
			channels: {
				x: CATEGORICAL_LIKE,
				y: CATEGORICAL_LIKE,
				hue: QUANTITATIVE_LIKE,
			},
			allowOpportunisticHue: false,
			dataLabelsValueFrom: "hue",
		},
		{
			// Categorical-hue heatmap — useful for things like a weekly schedule
			// or staffing grid where each cell is one of N labels.
			name: "Categorical tile heatmap",
			channels: {
				x: CATEGORICAL_LIKE,
				y: CATEGORICAL_LIKE,
				hue: CATEGORICAL_LIKE,
			},
			allowOpportunisticHue: false,
		},
	],
	map: [
		{
			// Regions colored by a measure — the canonical choropleth. The
			// detected region field goes to `connection`; hue carries the
			// measure as a gradient (the icon bar seeds the quant hue config
			// from the theme, as it does for tile heatmaps).
			name: "Choropleth",
			geo: "choropleth",
			channels: {
				hue: TIME_OR_QUANT,
			},
		},
		{
			// Sized circles at region centroids (geoSymbols mode: the region
			// field on `connection` plus a quantitative `area`). Opportunistic
			// hue colors the bubbles when a spare categorical exists.
			name: "Bubble map",
			geo: "symbols",
			channels: {
				area: QUANTITATIVE_LIKE,
			},
		},
		{
			// Raw lat/long dot map (geoPoints mode: x=longitude, y=latitude,
			// both from detection). Opportunistic hue colors the dots.
			name: "Dot map",
			geo: "points",
			channels: {},
		},
	],
	// Hierarchy trees (packed circles / treemap / sunburst) all scaffold the
	// same signature — a quantitative `area` (node size) plus a categorical
	// `connection` (parent group) — and differ only in `hierarchyLayout`.
	// Deeper nesting kicks in automatically when the dataset has a child-id
	// column (`inferHierarchyIdField`). Hue derives from the top-level group
	// (canonical hierarchy coloring), so opportunistic hue stays off.
	circles: [
		{
			name: "Packed circles",
			channels: {
				area: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			hierarchyLayout: "pack",
			hueMeasureSource: "rootGroup",
			allowOpportunisticHue: false,
		},
	],
	treemap: [
		{
			name: "Treemap",
			channels: {
				area: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			hierarchyLayout: "treemap",
			hueMeasureSource: "rootGroup",
			allowOpportunisticHue: false,
		},
	],
	sunburst: [
		{
			name: "Sunburst",
			channels: {
				area: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			hierarchyLayout: "sunburst",
			hueMeasureSource: "rootGroup",
			allowOpportunisticHue: false,
		},
	],
	sankey: [
		{
			// Flow reading of the same signature: `connection` holds the edge
			// SOURCES, `area` the edge weights; the target column auto-detects
			// (`resolveFlowTargetField`), which is why a spare categorical is
			// required. Hue rides the source column so nodes color over the
			// endpoint union.
			name: "Sankey diagram",
			channels: {
				area: QUANTITATIVE_LIKE,
				connection: CATEGORICAL_LIKE,
			},
			hierarchyLayout: "sankey",
			requiresFlowTarget: true,
			hueFrom: "connection",
			allowOpportunisticHue: false,
		},
	],
}
