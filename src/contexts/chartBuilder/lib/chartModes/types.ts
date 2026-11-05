import type { ChannelConfigs } from "../channelConfig"
import type { MapConfig } from "../mapConfig"
import type { Encodings, FieldType } from "../types"

/** Optional type lookup passed to `detect` so modes that depend on field
 * type (e.g. Tile mode requiring categorical x AND y) can decide
 * accurately. Callers without a dataset in hand can omit it; modes that
 * need it should fall back to a safe default when absent. */
export type FieldTypeLookup = (fieldName: string) => FieldType | undefined

export type ChartModeLegendConfig = {
	/** When true, Legend hides any legend section for the length encoding
	 * even when length is mapped. Used by bar modes — length is redundant
	 * with the measure axis. */
	hideLengthInThisMode: boolean
	/** Mirror for pies: angle is redundant with the measure axis. */
	hideAngleInThisMode: boolean
	/** When true, Legend hides any legend section for the connection encoding
	 * even when connection is mapped. Used by geographic modes (choropleth) —
	 * there the connection channel is the region key (which feature each row
	 * is), not a visual series, so a per-region legend would be meaningless. */
	hideConnectionInThisMode: boolean
	/** When true, the Size (area) legend defaults to HIDDEN in this mode —
	 * unlike the hide flags above, the "Legends shown" toggle stays so the
	 * user can turn it back on. Used by the flow (sankey / chord) and
	 * hierarchy (pack / treemap / sunburst) modes, where every mark is sized
	 * by `area` and the diagram itself already communicates the magnitudes.
	 * Resolved via `resolveLegendHidden` (labelsConfig.ts); absent = false. */
	areaHiddenByDefault?: boolean
	/** Reverse the categorical legend order (top→bottom) so the top swatch
	 * aligns with the top of the stack. True for the VERTICAL stacked modes
	 * (bars-x, areas-x), where the first-encountered value sits at the bottom.
	 * False for the horizontal variants (bars-y, areas-y), which stack
	 * left→right so discovery order already matches the stack. */
	reverseCategoricalOrder: boolean
}

/** How the Annotations sidebar panel maps its coordinate inputs onto this
 * mode's encodings. The panel must NEVER compare mode ids — like the canvas
 * traits below, a new chart mode declares these and the panel honors them
 * without edits. */
export type ChartModeAnnotationTraits = {
	/** Encoding channel whose mapped field backs the HORIZONTAL axis for
	 * value-mode ("data units") annotation coordinates. Mirrors what the
	 * renderer scales against: `"x"` for cartesian modes, `"length"` when
	 * the measure runs horizontally (bars-y / areas-y), `"angle"` on radar
	 * (value-mode x IS the angle position). `null` = no field drives the
	 * horizontal value axis in this mode — the slice angle consumed it
	 * (pies / pies-y), or the panel has no position scale at all (geo, the
	 * axis-less structure layouts). Both null = the panel disables value
	 * mode. Must agree with `canvas.cartesianAxes` (a registry test checks). */
	xValueChannel: "x" | "length" | "angle" | null
	/** Vertical counterpart: `"y"` for cartesian modes, `"length"` when the
	 * measure runs vertically (bars-x / areas-x), `"r"` on radar. `null` =
	 * no vertical value axis (pies / pies-x). */
	yValueChannel: "y" | "r" | "length" | null
	/** True when value-mode annotation coordinates are POLAR (radar):
	 * x reads as the angle position and y as the radial distance, so circle
	 * editors relabel their center inputs ("center angle" / "center r"),
	 * always measure the radius on the r axis, and hide the x/y radius-axis
	 * toggle. Polar modes WITHOUT value axes (the pie variants) leave this
	 * false — they disable value mode entirely instead (the panel derives
	 * that from `canvas.coordFamily === "polar"` or both value channels
	 * being null). */
	polarValueCoords: boolean
}

/** Shape of a chart-type definition. Registering a new mode means adding
 * one of these to the registry (`chartModes/index.ts`) AND binding its
 * renderer component in `components/viz/rendererRegistry.ts` (keyed by
 * the `ChartMode` union, so forgetting the binding is a compile error).
 *
 * Mode defs are deliberately React-free — detection + declarative traits
 * only — so mode detection can be imported by tests, the layout solver,
 * and sidebar hooks without pulling in the renderer tree. */
export type ChartModeDef = {
	/** Stable identifier matching the existing ChartMode union string
	 * (`"scatter" | "bars-x" | "bars-y" | "pies-x" | "pies-y"` today). */
	id: string
	/** Return true when the current encodings select this mode. The first
	 * registered mode whose detect() returns true wins — put narrower
	 * modes before broader ones. `scatter` should be last (fallback).
	 *
	 * `getType`, when provided, lets the mode look up the effective type of
	 * any mapped field (respecting user overrides). Modes that don't need
	 * type info ignore the second argument; modes that DO need it (tile)
	 * should bail out gracefully when it's absent.
	 *
	 * `channelConfigs`, when provided, lets a mode consult per-channel config
	 * (e.g. the histogram toggle on an axis). Callers that omit it simply
	 * won't activate config-gated modes — a safe default.
	 *
	 * `mapConfig`, when provided, exposes the chart-wide map settings (e.g.
	 * `coordSystem`) so geographic modes can activate. Cartesian modes ignore
	 * it; callers that omit it simply won't activate geographic modes. */
	detect: (
		encodings: Encodings,
		getType?: FieldTypeLookup,
		channelConfigs?: ChannelConfigs,
		mapConfig?: MapConfig
	) => boolean
	legend: ChartModeLegendConfig
	facet: {
		/** True when this mode supports a shared measure axis across
		 * facet panels (bar modes). False for scatter/pie. */
		supportsSharedMeasureMax: boolean
	}
	/** Declarative traits the Annotations sidebar panel reads — see
	 * `ChartModeAnnotationTraits`. */
	annotations: ChartModeAnnotationTraits
	/** Declarative traits PlotCanvas AND the sidebar panels branch on.
	 * Neither may compare mode ids — a new chart mode declares its traits
	 * here (plus the legend / facet / annotations / labels blocks above and
	 * below) and every consumer honors them without edits. */
	canvas: ChartModeCanvasTraits
	/** Declarative traits the Data Labels sidebar panel reads — see
	 * `ChartModeLabelTraits`. */
	labels: ChartModeLabelTraits
}

/** How the Data Labels panel adapts to a mode. Like the annotation traits,
 * the panel never compares mode ids: every placement / selection decision
 * it makes is declared here. (Family-level decisions — bar placements,
 * area layer position, pie polar nudges — read the mode families.) */
export type ChartModeLabelTraits = {
	/** How the mode positions its labels, which decides which fine-tuning
	 * controls apply:
	 *  - `"mark"`: the shared label layer anchors each label on its mark
	 *    (cartesian nudges, bar / area placements, polar nudges on pies;
	 *    packed circles hand it their layout-placed anchors).
	 *  - `"ring"`: the layout hands arc anchors to the shared layer — the
	 *    Angle nudge applies and R is RING-relative (sunburst).
	 *  - `"layout"`: the renderer draws its own labels where the layout
	 *    puts them (leaf centers, container rims) — the position / overlap
	 *    / background fine-tuning stands down (treemap). */
	placement: "mark" | "ring" | "layout"
	/** True when the label position rows are locked to the chart's own x / y
	 * fields: every mark is keyed by exactly those two (a heatmap cell), so
	 * encoding a third field as a label position would be nonsense — picking
	 * one auto-fills the other and the dropdowns offer only the chart's
	 * fields. */
	positionLockedToAxes: boolean
	/** True when labels have per-series ENDPOINTS to select ("first and
	 * last" along the series). False where there is no series to run along
	 * — regions on a map, nodes in a sunburst or a flow diagram — so the
	 * series "Which labels" selection hides and the renderer skips it (flows
	 * offer their own by-direction selection instead). */
	seriesEndpoints: boolean
	/** True when the mode draws container (group) labels that can sit inside
	 * the rim or wrap around the outside, per nesting level — the packed
	 * circles' "Wrap label around" options (under Position and alignment). */
	containerRimLabels: boolean
}

/** How PlotCanvas lays out and adorns panels for a mode. */
export type ChartModeCanvasTraits = {
	/** Coordinate family. `"polar"` (radar + pie variants) drives the
	 * solver's reduced per-cell chrome (POLAR_MARGIN) and the angle/r →
	 * x/y share-mode migration; `"geo"` panels own their projection and
	 * ignore cartesian share plumbing. */
	coordFamily: "cartesian" | "polar" | "geo"
	/** Which CARTESIAN axes the panel actually draws. `coordFamily` alone
	 * can't say: the axis-less layouts (packed circles / treemap / sunburst /
	 * chord / sankey) are "cartesian" panels that draw no axis, the pie
	 * bands draw ONE (pies-x draws x, pies-y draws y), and geo panels draw
	 * none. Everything that asks "is there an x axis here?" — shared axis
	 * titles, the facet panel's Share-axis rows and range editors, the
	 * annotation value-mode gate — reads this, never the mode id. */
	cartesianAxes: { x: boolean; y: boolean }
	/** What the `length` channel (and the Length options panel) means here:
	 *  - `"mark"`: a per-mark pixel length through the Length min/max px
	 *    range (or the single default length when unmapped) — scatter-style
	 *    segments.
	 *  - `"measure"`: the mapped variable IS the mark extent, scaled by the
	 *    measure axis (bars / areas) — the px range is inert.
	 *  - `"none"`: the renderer never reads length (pies, tile, geo, the
	 *    structure layouts) — every Length control is inert.
	 * Distinct from `legend.hideLengthInThisMode` (a legend-display choice)
	 * so the two can't be conflated. */
	lengthRole: "mark" | "measure" | "none"
	/** What the `connection` channel means here — the gate for every
	 * line-styling control in the Connection / Color / Pattern / Tooltip
	 * panels:
	 *  - `"line"`: rows sharing a value join into a drawn polyline the
	 *    pointer can wander along (scatter's line charts).
	 *  - `"layer"`: rows sharing a value form a stacked series LAYER whose
	 *    outline is colored with its fill (areas).
	 *  - `"polygon"`: rows sharing a value close into a polygon (radar).
	 *  - `"key"`: a structural key, never a drawn line — the tree parent /
	 *    flow source (the structure layouts) or the region join (maps).
	 *  - `"none"`: the renderer never draws or keys on it (bars, pies, tile,
	 *    hexbin, the lon/lat point map). */
	connectionRole: "line" | "layer" | "polygon" | "key" | "none"
	/** What the `shape` channel's config means here — the gate for the
	 * Shape panel's Default-shape glyph picker:
	 *  - `"glyph"`: marks are point glyphs; `defaultShape` / per-category
	 *    shapes pick the symbol and `shape.outlineWidth` strokes it (scatter,
	 *    radar).
	 *  - `"cell"`: marks are axis-gridded cells — bars, heatmap tiles, hex
	 *    cells — that read only `shape.outlineWidth`, as the cell border.
	 *    Nothing composes a glyph from `defaultShape` (the cell modes'
	 *    legends are swatches / gradient bars), so the picker is hidden.
	 *  - `"outline"`: marks are shapes of their own (wedges, regions,
	 *    bubbles, nested circles / rects / arcs, ribbons) stroked by
	 *    `shape.outlineWidth`; no glyph is drawn on the canvas, so the
	 *    Shape panel hides the glyph pickers, the legend drops any Shape
	 *    section, and fallback legend swatches are circles (not
	 *    `defaultShape`).
	 *  - `"none"`: the renderer never reads the shape config (areas). */
	shapeRole: "glyph" | "cell" | "outline" | "none"
	/** What the `area` channel means here — the gate for the Area (size)
	 * options panel:
	 *  - `"mark"`: a per-mark pixel size through the min/max px range, with
	 *    the Scale-by (area vs diameter) choice (scatter bubbles, radar, the
	 *    geo point / bubble maps).
	 *  - `"layoutRadius"`: the layout computes each circle's radius from the
	 *    value, honoring Scale-by — the px range is inert (packed circles).
	 *  - `"proportional"`: the layout maps the value straight to a rect
	 *    area / arc span / ribbon or link width — neither the px range nor
	 *    Scale-by applies (treemap, sunburst, chord, sankey).
	 *  - `"none"`: the renderer never reads it (bars, areas, pies, tile,
	 *    hexbin, the choropleth). */
	areaRole: "mark" | "layoutRadius" | "proportional" | "none"
	/** True when the renderer draws the statistical overlays configured on
	 * the position axes — the violin / box distribution overlays, the
	 * standalone density curve, and the regression line — so their styling
	 * controls (overlay outline width, regression dash) apply. Scatter only:
	 * the overlays sit on scatter's continuous position scales. */
	statOverlays: boolean
	/** Polar-only: which POLAR axes the panel draws. Radar draws an R axis
	 * plus the angle spokes (the Angle panel's Spokes / Spoke-label
	 * sections); the pie variants draw neither — the slice angle consumed
	 * the measure and there is no R scale. */
	polarAxes?: { r: boolean; angle: boolean }
	/** Flow-only (chord / sankey): the figure's geometry. `"ring"` = nodes
	 * on a circle with ribbons across it, which carries a graduated value
	 * axis around the ring (the Connection panel's "Show axis"); `"columns"`
	 * = nodes in left → right columns with links between them, no axis. */
	flowGeometry?: "ring" | "columns"
	/** Geo-only: what the map draws and where it places it.
	 *  - `marks`: `"regions"` = the joined polygons ARE the marks, filled by
	 *    their measure (choropleth) — "Fill regions with no data" applies and
	 *    "Whole map (auto)" frames just the matched regions while it's off;
	 *    `"symbols"` = point marks over an optional basemap (bubble / dot
	 *    maps) — "Show basemap" applies.
	 *  - `position`: `"region"` = marks are placed by the `connection`
	 *    region join (polygon / centroid); `"lonLat"` = the `x` / `y`
	 *    channels carry raw longitude / latitude. */
	geo?: {
		marks: "regions" | "symbols"
		position: "region" | "lonLat"
	}
	/** Which ENCODING axis carries the continuous measure for bar/area-
	 * style charts: the axis whose bounds PlotCanvas translates into
	 * `measureMinOverride`/`measureMaxOverride` and whose share mode
	 * drives the per-group measure max. `"y"` = vertical (bars-x/areas-x),
	 * `"x"` = horizontal (bars-y/areas-y). `null` = no measure axis
	 * (scatter, tile, polar, geo). Non-null also implies the measure axis
	 * is continuous even when no field is mapped to it (histogram count). */
	measureAxis: "x" | "y" | null
	/** The field supplying the measure VALUE for the shared-axis group
	 * max. Declared only by measure-axis modes; encodes each mode's own
	 * fallback chain (e.g. areas-x reads `length` then `y`). */
	resolveMeasureField?: (encodings: Encodings) => string | null
	/** True when this mode's marks can point BELOW zero: the measure axis
	 * extends down to the lowest value in the data and marks grow from the
	 * zero baseline in whichever direction their value points. Absent /
	 * false = the measure axis floors at zero and a negative value collapses
	 * to nothing, which is the historical behavior for every measure-axis
	 * mode. Only bars implement the diverging geometry today; areas keep the
	 * zero floor until their path builder grows the same handling. */
	supportsNegativeMeasure?: boolean
	/** Polar-only: what "size panels by unit" uses as a panel's unit.
	 * `"rAxisMax"` (radar) = the R-axis data max, honoring R-range
	 * overrides and shareR group folding. `"angleSum"` (pies) = the sum
	 * of slice values; no R axis, so no override/share folding. */
	polarUnit?: "rAxisMax" | "angleSum"
	/** True when the renderer draws value-coordinate circle / line-segment
	 * annotations itself (radar: polar coords), so the canvas annotation
	 * layer must skip them. */
	valueAnnotationsInRenderer?: boolean
}
