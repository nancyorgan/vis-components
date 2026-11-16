/** THE table of per-part targets.
 *
 *  A "target" is the setting a menu keeps for one PART of a chart beside
 *  the marks' own fill: the line, the points on a chart whose marks are not
 *  points, an overlay's stroke. Color, Opacity and Saturation / Brightness
 *  each store theirs under the same key (`colorSlots.line`,
 *  `opacitySlots.line`, `saturationSlots.line`).
 *
 *  Each target is written ONCE here: what it is called, which part it
 *  styles, when the chart draws that part, and what each menu that offers
 *  it needs to know (Color: the theme color it starts from; Opacity: the
 *  level it starts at). The three per-menu registries — `colorSlots`,
 *  `opacitySlots`, `modulationSlots` — are views of this table, so a part's
 *  name and the answer to "does this chart draw it?" cannot differ from one
 *  menu to the next. They used to be three hand-kept lists that mirrored
 *  each other by convention.
 *
 *  "Does this chart draw it?" is asked of what the mode DECLARES
 *  (`canvas` traits) and of the settings that switch the part on — never of
 *  a list of chart types. The trait half also keeps a leftover flag from
 *  another chart type (a histogram setting surviving a switch to a line
 *  chart) from bringing its targets along.
 *
 *  The table is in `PART_ORDER` (see `markParts`), the one order every menu
 *  lists parts in. Pure: no store, no React. */

import type {
	ChannelConfigs,
	ColorSlotKey,
	ModulationSlotKey,
	OpacitySlotKey,
} from "./channelConfig"
import type { ChartModeCanvasTraits } from "./chartModes/types"
import type { Encodings, Theme } from "./types"

// ---------------------------------------------------------------------------
// The parts

/** A part of a chart that the menus style on its own. */
export type PartId =
	/** The marks, when they are bodies of their own — bars, slices, cells,
	 *  regions, nodes, circles. */
	| "markFill"
	| "markOutline"
	/** A flow diagram's ribbons, beside its nodes. */
	| "ribbon"
	/** The connecting line, the body under it (an area's or a radar
	 *  polygon's fill), and the points along it. A scatter's points are the
	 *  same part with no line. */
	| "line"
	| "body"
	| "pointFill"
	| "pointOutline"
	/** What is drawn over the marks. */
	| "stem"
	| "regressionLine"
	| "regressionBand"
	| "violinFill"
	| "violinOutline"
	| "densityFill"
	| "densityOutline"
	| "rug"

/** The part a target styles. `"ownOutline"` is the marks' own outline,
 *  whichever part that is on the chart at hand (`ownParts` in `markParts`):
 *  a bar's outline, the ring around a point — and on an area chart, whose
 *  own outline is its edge, the Line. */
export type TargetPart = PartId | "ownOutline"

/** THE label for "follow something else": a part left on it takes its color
 * from the part it belongs to (a point from its line, a polygon from its
 * points, a regression line from its group) instead of a choice of its
 * own. One word everywhere, with each part's `help` saying what it follows. */
export const FOLLOW_LABEL = "Auto"

// ---------------------------------------------------------------------------
// The settings that switch a part on

/** True when a rug is DRAWN: "Show rug" is on for an axis whose histogram or
 * standalone density curve is on (the two share the rug's settings, so it
 * stays put across the Histogram ⇄ Density switch). The gate for the Rug
 * color and opacity targets — with the rug off there is nothing to style.
 * Mirrors the renderers: BarPlot draws `histogram.showRug` on a histogram,
 * ScatterPlot on the density display's value axis. */
export const rugOn = (configs: ChannelConfigs): boolean => {
	const on = (c: typeof configs.x) =>
		c?.histogram?.showRug === true &&
		(c.histogram.enabled === true ||
			c.distributionOverlay?.showDensityCurve === true)
	return on(configs.x) || on(configs.y)
}

/** True when a violin or box overlay is active on either position axis. */
export const overlayOn = (configs: ChannelConfigs): boolean => {
	const ov = (c: typeof configs.x) =>
		!!c?.distributionOverlay &&
		(c.distributionOverlay.showDensityViolin || c.distributionOverlay.showBoxPlot)
	return ov(configs.x) || ov(configs.y)
}

/** True when a density curve is active on either position axis — the standalone
 * single-variable curve (a Distribution display) OR the histogram overlay.
 * Drives the density curve's fill / outline targets. */
export const densityCurveOn = (configs: ChannelConfigs): boolean => {
	const standalone = (c: typeof configs.x) =>
		c?.distributionOverlay?.showDensityCurve === true
	const overlay = (c: typeof configs.x) =>
		c?.histogram?.enabled === true && c?.histogram?.showDensity === true
	return (
		standalone(configs.x) ||
		standalone(configs.y) ||
		overlay(configs.x) ||
		overlay(configs.y)
	)
}

/** True when an active density curve's under-curve fill is on. The "Fill under
 * curve" flag lives on `HistogramConfig.densityFill` for BOTH curve forms (the
 * standalone Density display and the histogram overlay share it, so the choice
 * persists across the Histogram ⇄ Density switch). Gates the Density curve
 * fill targets — an unfilled curve has no fill to style. */
export const densityCurveFillOn = (configs: ChannelConfigs): boolean => {
	const on = (c: typeof configs.x) =>
		(c?.distributionOverlay?.showDensityCurve === true ||
			(c?.histogram?.enabled === true && c?.histogram?.showDensity === true)) &&
		c?.histogram?.densityFill === true
	return on(configs.x) || on(configs.y)
}

/** True when an area chart draws point markers on its layer edges: a
 * Connection field mapped and Connection → "Show points" not "No points".
 * The gate for the area modes' Point fill / Point outline targets in every
 * aesthetic menu — with no points there is nothing for them to style. */
export const areaPointsOn = (encodings: Encodings, configs: ChannelConfigs): boolean =>
	!!encodings.connection?.field &&
	(configs.connection?.pointSampling ?? "all") !== "none"

/** True when the scatter regression-line overlay is on. */
export const regressionOn = (configs: ChannelConfigs): boolean =>
	configs.x?.regression?.enabled === true

/** True when the regression overlay's confidence band is on. */
export const regressionCiOn = (configs: ChannelConfigs): boolean =>
	regressionOn(configs) && configs.x?.regression?.showCi === true

// ---------------------------------------------------------------------------
// What a mode declares

type Canvas = ChartModeCanvasTraits

/** Rows sharing a Connection value are joined by a line the menus style as
 *  the "Line": a line chart's, a combo's, a radar polygon's outline. */
const joinsMarks = (c: Canvas): boolean =>
	c.connectionRole === "line" || c.connectionRole === "polygon"

/** The marks are stacked layers — an area chart, whose own outline is its
 *  Line and whose points are a second part. */
const layers = (c: Canvas): boolean => c.connectionRole === "layer"

/** Bars with a line of points over them — a bar + line combo, whose points
 *  are a second part beside the bars. */
const pointsOverBars = (c: Canvas): boolean =>
	c.mark === "bar" && c.connectionRole === "line"

/** The chart can show a distribution with a density curve and a rug: a
 *  histogram's bars, or scatter's standalone density display. The curve and
 *  the rug share their settings across the two. */
const showsDistribution = (c: Canvas): boolean => c.statOverlays || c.histogram === true

/** A bubble map: symbols placed on the regions they are joined to, drawn
 *  over those regions. */
const bubblesOverRegions = (c: Canvas): boolean =>
	c.geo?.marks === "symbols" && c.geo.position === "region"

/** A dot map: points placed by longitude / latitude, over regions that
 *  carry no data. */
const dotsOverRegions = (c: Canvas): boolean => c.geo?.position === "lonLat"

/** A flow diagram: nodes and the ribbons between them. */
const flows = (c: Canvas): boolean => c.flowGeometry !== undefined

// ---------------------------------------------------------------------------
// The table

/** The chart a target is asked about. */
export type TargetContext = {
	canvas: Canvas
	encodings: Encodings
	configs: ChannelConfigs
}

type Gate = (ctx: TargetContext) => boolean

/** What the Color menu needs for a target. */
export type ColorFacet = {
	/** Default single ("None") color, sourced from the theme. */
	themeColor: (theme: Theme) => string
	/** When false, the target offers a single color only — no "Vary by". */
	acceptsFieldMapping: boolean
	/** Present when an UNCONFIGURED target does NOT render the default single
	 * color but follows something else (the Color mapping, its line, …). The
	 * panel then leads the Vary-by list with this "Auto" option — which
	 * clears the stored target — so the untouched state displays truthfully,
	 * and "Single color" is an explicit stored choice that really renders one
	 * color. Targets whose fall-through is just a single color must NOT set
	 * this: there, "Single color" already describes the default. */
	inherit?: { label: string; help?: string }
}

/** What the Opacity menu needs for a target. */
export type OpacityFacet = {
	/** The opacity the part draws at with no explicit level. Parts that read
	 * semi-transparent (a density fill, a confidence band, ribbons) keep that
	 * look rather than snapping to 1. */
	defaultLevel: number
	/** When false, the target offers a single level only — no "Vary by". */
	acceptsFieldMapping: boolean
}

/** What the Saturation / Brightness menus need for a target. Every part
 *  starts OFF (no modulation), so there is no default level. */
export type ModulationFacet = {
	/** False when the part carries no data to vary by: the target offers one
	 *  level, no "Vary by". Absent = true. */
	acceptsFieldMapping?: boolean
}

/** A facet may say when THIS menu's target is drawn, where the menus keep a
 *  part under different keys (see `line`). */
type Scoped<T> = T & { drawn?: Gate }

/** The menus that keep per-part targets. */
export type TargetMenu = "color" | "opacity" | "modulation"

export type PartTargetKey = ColorSlotKey | OpacitySlotKey | ModulationSlotKey

/** One row of the table. A facet is present exactly when the menu stores a
 *  target under this key. */
export type PartTarget = {
	/** The storage key, the same in every menu that offers the target. */
	key: PartTargetKey
	label: string
	part: TargetPart
	/** The chart draws the part this target styles. */
	drawn: Gate
	color?: Scoped<ColorFacet>
	opacity?: Scoped<OpacityFacet>
	modulation?: Scoped<ModulationFacet>
}

/** The facets a key must carry — one per menu whose stored keys include it —
 *  so a key added to a menu's storage type cannot be left out of the table,
 *  nor a facet declared for a menu that has no such key. */
type FacetsOf<K extends PartTargetKey> = (K extends ColorSlotKey
	? { color: Scoped<ColorFacet> }
	: { color?: undefined }) &
	(K extends OpacitySlotKey ? { opacity: Scoped<OpacityFacet> } : { opacity?: undefined }) &
	(K extends ModulationSlotKey
		? { modulation: Scoped<ModulationFacet> }
		: { modulation?: undefined })

const target = <K extends PartTargetKey>(
	row: { key: K; label: string; part: TargetPart; drawn: Gate } & FacetsOf<K>
): PartTarget => row as PartTarget

const connected = ({ encodings }: TargetContext): boolean => !!encodings.connection?.field

/** One level at 1, with "Vary by" — what most parts' Opacity is. */
const OPAQUE: OpacityFacet = { defaultLevel: 1, acceptsFieldMapping: true }

export const PART_TARGETS: readonly PartTarget[] = [
	// --- The marks' own outline -------------------------------------------
	// Color keeps it as the `outlineHue` encoding / `shape.outlineColor`, so
	// it has no color target. Opacity keeps it under `border` and Saturation
	// / Brightness under `outline` — two keys for one part, for back-compat.
	target({
		// Stroke/outline opacity. On an area chart the marks' own outline is
		// the Line, so this is the Line's opacity there.
		key: "border",
		label: "Outline",
		part: "ownOutline",
		drawn: () => true,
		opacity: OPAQUE,
	}),
	target({
		// The marks' own outline — a point's ring, a bar's, a slice's, a
		// cell's, a region's. Every renderer resolves it through
		// `lib/markOutline`, so the option reaches every outline. Not an area
		// chart: its own outline is its Line (the `line` target below), and
		// the points on it have the Point outline target. (Whether an outline
		// is drawn at all — not on line segments, nor a pure density curve —
		// is asked of `drawnParts` where the menus are assembled.)
		key: "outline",
		label: "Outline",
		part: "ownOutline",
		drawn: ({ canvas }) => !layers(canvas),
		modulation: {},
	}),

	// --- Marks that are bodies, beside the chart's own ----------------------
	// Dot map: the regions behind the points. The points are the marks (Point
	// fill / Point outline are the Color mapping and the marks' outline); the
	// geography is styled apart from them here. The regions carry no data on
	// a dot map, so each takes one color and one level — no "Vary by".
	// Untouched they draw as before: the map's region color, and the points'
	// outline color.
	target({
		key: "geoRegionFill",
		label: "Region fill",
		part: "markFill",
		drawn: ({ canvas }) => dotsOverRegions(canvas),
		color: {
			themeColor: (t) => t.mapNoDataFill ?? t.defaultFill,
			acceptsFieldMapping: false,
			inherit: {
				label: FOLLOW_LABEL,
				help: "The map's region color (Map → Region fill).",
			},
		},
		opacity: { defaultLevel: 1, acceptsFieldMapping: false },
		modulation: { acceptsFieldMapping: false },
	}),
	target({
		key: "geoRegionStroke",
		label: "Region outline",
		part: "markOutline",
		drawn: ({ canvas }) => dotsOverRegions(canvas),
		color: {
			themeColor: (t) => t.outlineColor,
			acceptsFieldMapping: false,
			inherit: {
				label: FOLLOW_LABEL,
				help: "The points' outline color.",
			},
		},
		opacity: { defaultLevel: 1, acceptsFieldMapping: false },
		modulation: { acceptsFieldMapping: false },
	}),
	// Flow diagrams (chord / sankey) split opacity by mark part: node arcs /
	// rects anchor the eye at full opacity while ribbons / links read as
	// translucent washes of their source node's color. Flow marks aggregate
	// many rows, so a per-row field mapping is ill-defined — level only.
	// (A ribbon's color, saturation and brightness are its source node's:
	// `PART_EXCEPTIONS` in `markParts`.)
	target({
		key: "node",
		label: "Node fill",
		part: "markFill",
		drawn: ({ canvas }) => flows(canvas),
		opacity: { defaultLevel: 1, acceptsFieldMapping: false },
	}),
	target({
		key: "ribbon",
		label: "Ribbon fill",
		part: "ribbon",
		drawn: ({ canvas }) => flows(canvas),
		opacity: { defaultLevel: 0.45, acceptsFieldMapping: false },
	}),

	// --- The line, what it encloses, and the points on it -------------------
	target({
		// A line chart's and a combo's connection line, and the radar polygon
		// OUTLINE — where the untouched color matches each polygon's fill (see
		// `RADAR_LINE_INHERIT`). A polygon is one series, so a mapped field
		// resolves off its representative row.
		key: "line",
		label: "Line",
		part: "line",
		drawn: (ctx) => connected(ctx) && joinsMarks(ctx.canvas),
		color: {
			themeColor: (t) => t.connectionColor,
			acceptsFieldMapping: true,
		},
		opacity: OPAQUE,
		// An AREA chart's Line is its own outline, kept elsewhere for Color
		// (the split-palette editor owns `connection.lineColors`) and for
		// Opacity (the `border` target above). Saturation / Brightness keep it
		// here, where the area renderer reads it — so on an area chart this
		// key is offered by those two menus only.
		modulation: {
			drawn: (ctx) => connected(ctx) && (joinsMarks(ctx.canvas) || layers(ctx.canvas)),
		},
	}),
	target({
		// Filled radar: the series polygon's BODY, a target of its own beside
		// the points (Point fill), their outlines (Point outline) and the
		// polygon outline (Line). An unfilled polygon has no body to style.
		// Color: unconfigured, each body follows its series (see the help
		// text); "Vary by" / a single color recolor the bodies on their own,
		// resolved off each series' representative row like the Line.
		// Opacity: multiplies each series' own opacity (the Point fill
		// section) rather than replacing it, so the default of 1 leaves
		// filled radars unchanged; the "Filled radar" quick start sets 0.25
		// for the watercolor look. Saturation / Brightness: untouched, the
		// body inherits the Point fill's shading along with its color; a
		// level / field shades the body on its own (`polygonBodyResolver`).
		key: "polygonFill",
		label: "Polygon fill",
		part: "body",
		drawn: ({ canvas, configs }) =>
			canvas.connectionRole === "polygon" && configs.connection?.fillPolygon === true,
		color: {
			themeColor: (t) => t.defaultFill,
			acceptsFieldMapping: true,
			inherit: {
				label: FOLLOW_LABEL,
				help: "Each polygon takes its series' color: from the theme's fill palette while Color uses the theme's own palette, else its point color.",
			},
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		// Area charts (filled or line mode): the point markers on each
		// layer's edge. Color: unconfigured, a point takes its LINE's color
		// (and the Line's saturation / brightness shading); "Vary by"
		// (resolved off the layer's representative row) / a single color
		// recolor the points on their own. Opacity is a level in practice:
		// the Opacity panel drops the "Vary by" on area charts (one layer =
		// one value).
		key: "areaPointFill",
		label: "Point fill",
		part: "pointFill",
		drawn: ({ canvas, encodings, configs }) =>
			layers(canvas) && areaPointsOn(encodings, configs),
		color: {
			themeColor: (t) => t.connectionColor,
			acceptsFieldMapping: true,
			inherit: {
				label: FOLLOW_LABEL,
				help: "Each point takes its line's color.",
			},
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		// Bar + marks combo: the points on the line, beside the bars. Color:
		// unconfigured, a point takes its LINE's color (the Line target /
		// legacy connection chain for its Connection value), never the bars'
		// Color mapping — the points belong to the line they sit on. Opacity:
		// untouched, the points keep drawing at the opacity they always had —
		// the bars' — so saved combos look the same; a level or a variable
		// here is the points' own.
		key: "comboPointFill",
		label: "Point fill",
		part: "pointFill",
		drawn: ({ canvas }) => pointsOverBars(canvas),
		color: {
			themeColor: (t) => t.connectionColor,
			acceptsFieldMapping: true,
			inherit: {
				label: FOLLOW_LABEL,
				help: "Matches the line color: the Line color's mapping, else its single color.",
			},
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		// Bubble map: the bubbles over the regions, styled independently of
		// the region color scale. Not the lon/lat dot map: its points ARE its
		// marks, colored by the Color mapping itself (its "Point fill").
		key: "geoPointFill",
		label: "Point fill",
		part: "pointFill",
		drawn: ({ canvas }) => bubblesOverRegions(canvas),
		color: {
			themeColor: (t) => t.defaultFill,
			acceptsFieldMapping: true,
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		// Area charts: the ring around each point marker. Its COLOR is not a
		// target — it is the marks' outline (`shape.outlineColor` / the
		// `outlineHue` encoding), exactly as on a scatter or line chart. Its
		// opacity and shading need a key of their own because the marks' own
		// outline is the area's Line there.
		key: "areaPointOutline",
		label: "Point outline",
		part: "pointOutline",
		drawn: ({ canvas, encodings, configs }) =>
			layers(canvas) && areaPointsOn(encodings, configs),
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		key: "geoPointStroke",
		label: "Point outline",
		part: "pointOutline",
		drawn: ({ canvas }) => bubblesOverRegions(canvas),
		color: {
			// White by default (the theme's mark outline color) so points read
			// against dark fills / dense choropleth palettes.
			themeColor: (t) => t.outlineColor,
			acceptsFieldMapping: true,
		},
		opacity: OPAQUE,
		modulation: {},
	}),

	// --- What is drawn over the marks ---------------------------------------
	// Each overlay takes Color, Opacity, Saturation and Brightness under the
	// same gate: the overlay is on, on a chart that draws it.
	target({
		// The stick from each point to an axis ("Connect points to axis") — on
		// every chart that can draw one: a scatter or line chart, and the
		// points of a bar + line combo.
		key: "stem",
		label: "Stem",
		part: "stem",
		drawn: ({ canvas, configs }) =>
			canvas.connectionRole === "line" && (configs.connection?.axisStem ?? "none") !== "none",
		color: {
			themeColor: (t) => t.connectionColor,
			acceptsFieldMapping: true,
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		key: "regressionStroke",
		label: "Regression line",
		part: "regressionLine",
		drawn: ({ canvas, configs }) => canvas.statOverlays && regressionOn(configs),
		color: {
			themeColor: (t) => t.regressionStroke,
			acceptsFieldMapping: true,
			// Unconfigured, each per-group regression line inherits its hue
			// group's color (see RegressionLayer).
			inherit: {
				label: FOLLOW_LABEL,
				help: "Each line takes its group's color from the Color mapping.",
			},
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		key: "regressionCiFill",
		label: "Confidence interval",
		part: "regressionBand",
		drawn: ({ canvas, configs }) => canvas.statOverlays && regressionCiOn(configs),
		color: {
			themeColor: (t) => t.regressionCiFill,
			acceptsFieldMapping: true,
			inherit: {
				label: FOLLOW_LABEL,
				help: "Each band takes its group's color: from the theme's fill palette while Color uses the theme's own palette, else from the Color mapping.",
			},
		},
		// The band reads as a translucent wash under the line — full opacity
		// would bury the dots it overlaps.
		opacity: { defaultLevel: 0.15, acceptsFieldMapping: true },
		modulation: {},
	}),
	target({
		key: "violinFill",
		label: "Violin / box fill",
		part: "violinFill",
		drawn: ({ canvas, configs }) => canvas.statOverlays && overlayOn(configs),
		color: {
			themeColor: (t) => t.distributionOverlayFill,
			acceptsFieldMapping: true,
			// Unconfigured, it varies by the Color variable (when that's the
			// category-axis variable) in the theme's fill palette — a real
			// "Vary by" default, see `defaultColorSlot` (lib/colorSlotDefaults).
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	target({
		key: "violinStroke",
		label: "Violin / box outline",
		part: "violinOutline",
		drawn: ({ canvas, configs }) => canvas.statOverlays && overlayOn(configs),
		color: {
			themeColor: (t) => t.distributionOverlayStroke,
			acceptsFieldMapping: true,
			// Unconfigured, it varies by the Color variable in Color's own
			// palette — see `defaultColorSlot`.
		},
		opacity: OPAQUE,
		modulation: {},
	}),
	// The density curve: the standalone curve renders on a scatter (a
	// single-variable distribution); the histogram overlay on bars.
	//
	// Color: "Vary by" a field splits the curve into one KDE per category.
	// Opacity is level-only BY DESIGN, though the color targets of the same
	// name accept a field: curve GROUPING is driven by the color targets'
	// field, and both renderers resolve curve opacity once per curve (not per
	// row), so a field mapped here would render per-category controls that
	// have no effect on the canvas. Making it functional means threading
	// per-row opacity through buildDensityCurve — a feature, not a flag flip.
	target({
		key: "densityCurveFill",
		label: "Density curve fill",
		part: "densityFill",
		// Only when "Fill under curve" is on — an unfilled curve has no fill
		// to style (the outline target below stays whenever the curve shows).
		drawn: ({ canvas, configs }) => showsDistribution(canvas) && densityCurveFillOn(configs),
		color: {
			themeColor: (t) => t.distributionOverlayFill,
			// Unconfigured, it varies by a discrete Color variable in the
			// theme's fill palette — see `defaultColorSlot`.
			acceptsFieldMapping: true,
		},
		opacity: { defaultLevel: 0.25, acceptsFieldMapping: false },
		modulation: {},
	}),
	target({
		key: "densityCurveStroke",
		label: "Density curve outline",
		part: "densityOutline",
		drawn: ({ canvas, configs }) => showsDistribution(canvas) && densityCurveOn(configs),
		color: {
			themeColor: (t) => t.distributionOverlayStroke,
			acceptsFieldMapping: true,
		},
		opacity: { defaultLevel: 1, acceptsFieldMapping: false },
		modulation: {},
	}),
	target({
		// A histogram's rug (bars) and the density display's (scatter), which
		// reuse one tassel config — so the rug's styling stays put across the
		// Histogram ⇄ Density switch.
		key: "rug",
		label: "Rug",
		part: "rug",
		drawn: ({ canvas, configs }) => showsDistribution(canvas) && rugOn(configs),
		color: {
			themeColor: (t) => t.distributionOverlayStroke,
			acceptsFieldMapping: true,
		},
		opacity: OPAQUE,
		modulation: {},
	}),
]

/** One menu's view of a target: the shared name, part and gate, with the
 *  menu's own facet. */
export type MenuTarget<M extends TargetMenu> = {
	key: PartTargetKey
	label: string
	part: TargetPart
	/** The chart draws this target's part (this menu's answer, where the
	 *  menus keep a part under different keys). */
	drawn: Gate
	facet: Omit<NonNullable<PartTarget[M]>, "drawn">
}

/** The targets a menu keeps, in table order. */
export const menuTargets = <M extends TargetMenu>(menu: M): MenuTarget<M>[] => {
	const out: MenuTarget<M>[] = []
	for (const row of PART_TARGETS) {
		const scoped: Scoped<object> | undefined = row[menu]
		if (!scoped) continue
		const { drawn, ...facet } = scoped
		out.push({
			key: row.key,
			label: row.label,
			part: row.part,
			drawn: drawn ?? row.drawn,
			facet: facet as MenuTarget<M>["facet"],
		})
	}
	return out
}
