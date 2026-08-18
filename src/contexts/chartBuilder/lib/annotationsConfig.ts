import type { LineDashPattern } from "./channelConfig"

/** A single user-defined rectangle drawn on top of (or behind) the plot.
 *  Position is expressed in plot-area-normalized coordinates:
 *
 *    (0, 0) = bottom-left corner of the plot rect (where the spines meet)
 *    (1, 1) = top-right corner
 *
 *  Choosing normalized coords (vs pixel or data coords) means the
 *  annotation stays anchored to the same RELATIVE region as the chart
 *  resizes, and doesn't need to be re-derived when axis domains change.
 *  Two known limitations: (1) flipping to a categorical axis still
 *  works visually since the spine corners are fixed regardless of
 *  scale; (2) if the user wants the annotation to track a SPECIFIC
 *  data value, they'd need to re-enter the percent each time the data
 *  domain shifts. */
export type RectangleAnnotation = {
	/** Stable id for keying and removal. */
	id: string
	/** Optional human label shown in the sidebar list. */
	name: string
	/** Horizontal extent. In `"percent"` coordSystem these are 0–1
	 *  numbers (plot-area-normalized — xMin=0 hugs the y-axis spine,
	 *  xMax=1 hugs the right edge). In `"values"` coordSystem they're
	 *  raw axis values: numbers for quantitative/temporal/numeric-ordinal
	 *  axes, strings for categorical/string-ordinal axes. The renderer
	 *  feeds them through the chart's position scale. */
	xMin: number | string
	xMax: number | string
	/** Vertical extent. Same number-vs-string rules as `xMin/xMax`. In
	 *  `"percent"` coordSystem yMin=0 hugs the BOTTOM spine (cartesian
	 *  convention) and yMax=1 hugs the top; the renderer flips to SVG's
	 *  top-down coordinate system. In `"values"` mode the entries are
	 *  data values along whichever encoding drives the y axis (`y` for
	 *  scatter/pies-y, `length` for bars-x/areas-x). */
	yMin: number | string
	yMax: number | string
	backgroundColor: string
	/** 0..1 fill alpha applied on top of the fill color. */
	backgroundOpacity: number
	borderColor: string
	borderThickness: number
	/** 0..1 alpha applied to the border stroke. */
	borderOpacity: number
	borderDash: LineDashPattern
	/** User-typed custom SVG dasharray (e.g. `"2,2"`). When set it WINS over
	 *  `borderDash` — the picker's Custom choice. Null/absent = use
	 *  `borderDash` (also the shape of annotations saved before Custom
	 *  existed). Parsed via `sanitizeCustomDasharray` at render time. */
	borderDasharray?: string | null
	/** "behind" draws the rectangle UNDER the chart marks (e.g. a shaded
	 *  background band); "front" draws ABOVE marks (e.g. a callout box
	 *  highlighting a region). */
	zOrder: "behind" | "front"
	/** How `xMin/xMax/yMin/yMax` are interpreted:
	 *   - `"percent"` (default): plot-area-normalized (0–1), same as the
	 *     original behavior. Useful for "always anchor to the bottom-left
	 *     quadrant" annotations regardless of data.
	 *   - `"values"`: data values along each axis. The renderer feeds the
	 *     numbers through the chart's actual position scales, so the
	 *     rectangle tracks data domains and moves with axis rescales. */
	coordSystem: "percent" | "values"
	/** Which facet panels the annotation is drawn on, when the chart is
	 *  faceted. `null`/`undefined` (the default) means "all facets" — the
	 *  legacy behavior, so saved annotations keep showing everywhere. An
	 *  array restricts the annotation to panels whose key (e.g. `"A|1"`,
	 *  matching the facet label) is listed; an empty array hides it from
	 *  every panel. Ignored on non-faceted charts. */
	facetKeys?: string[] | null
	/** Optional text label drawn INSIDE the rectangle. Empty/absent = no
	 *  text. The text block is centered vertically within the box;
	 *  horizontal placement follows `textAlign`, inset from the box edge by
	 *  `textPadding`. A literal `\n` in the string forces a line break. All
	 *  the styling fields below are optional so rectangles saved before text
	 *  shipped read back with the `DEFAULT_RECTANGLE_TEXT` fallbacks. */
	text?: string
	textFontFamily?: string
	textFontSize?: number
	textColor?: string
	textFontWeight?: number
	textAlign?: "left" | "center" | "right"
	/** Inner padding between the rectangle edge and the text, in px. */
	textPadding?: number
}

/** Fallback text styling for rectangles saved before the text feature (and
 *  the seed values `newRectangle` writes when the theme doesn't override
 *  them). Kept here so the sidebar editor and the renderer resolve missing
 *  fields to the exact same defaults. */
export const DEFAULT_RECTANGLE_TEXT = {
	text: "",
	textFontFamily: "system-ui, sans-serif",
	textFontSize: 13,
	textColor: "#44403c",
	textFontWeight: 400,
	textAlign: "center" as "left" | "center" | "right",
	textPadding: 8,
}

/** Built-in fill + border seed shared by rectangles and circles — the values
 *  the factories write when the theme carries no annotation defaults, and the
 *  `??` fallbacks behind the theme's `annotation*` fields (see
 *  `rectangleStyleFromTheme` and friends in themeConfig.ts). */
export const DEFAULT_BOX_ANNOTATION_STYLE = {
	backgroundColor: "#facc15",
	backgroundOpacity: 0.2,
	borderColor: "#facc15",
	borderThickness: 1,
	borderOpacity: 0,
	borderDash: "solid" as LineDashPattern,
	borderDasharray: null as string | null,
}

/** Built-in stroke seed for line-segment annotations — same role as
 *  `DEFAULT_BOX_ANNOTATION_STYLE`. */
export const DEFAULT_LINE_ANNOTATION_STYLE = {
	lineColor: "#1e293b",
	lineThickness: 2,
	lineOpacity: 1,
	lineDash: "solid" as LineDashPattern,
	lineDasharray: null as string | null,
}

/** The style fields rectangles and circles share (fill + border). */
export type BoxAnnotationStyle = typeof DEFAULT_BOX_ANNOTATION_STYLE

/** The rectangle's text styling, sans the text content itself. */
export type RectangleTextStyle = Omit<typeof DEFAULT_RECTANGLE_TEXT, "text">

/** The line segment's stroke styling. */
export type LineAnnotationStyle = typeof DEFAULT_LINE_ANNOTATION_STYLE

/** A user-defined circle drawn on top of (or behind) the plot. Always
 *  renders as a TRUE on-screen circle; `radiusAxis` only selects which axis
 *  the radius is measured against (since x and y usually have different
 *  pixels-per-unit, a single radius can't be data-accurate on both). See
 *  `circleAnnotationGeometry.ts` for the placement math. */
export type CircleAnnotation = {
	/** Stable id for keying and removal. */
	id: string
	/** Optional human label shown in the sidebar list. */
	name: string
	/** Center position. In `"percent"` coordSystem these are 0–1 numbers
	 *  (plot-area-normalized — x: 0 hugs the y-axis spine, 1 the right edge;
	 *  y: 0 hugs the BOTTOM spine, 1 the top — the renderer flips to SVG's
	 *  top-down system). In `"values"` coordSystem they're raw axis values
	 *  (numbers for quantitative/temporal/numeric-ordinal, strings for
	 *  categorical), fed through the chart's position scales. */
	centerX: number | string
	centerY: number | string
	/** Radius magnitude. In `"percent"` mode it's a fraction (0–1) of the
	 *  `radiusAxis` axis's pixel extent. In `"values"` mode it's a count of
	 *  data units along `radiusAxis`, projected through that axis's scale.
	 *  A data-unit radius is only meaningful on a continuous (quantitative /
	 *  numeric-ordinal) axis; on categorical/temporal axes the circle is
	 *  skipped at render time. */
	radius: number
	/** Which axis the radius is measured against (its pixel extent in percent
	 *  mode, its scale in values mode). */
	radiusAxis: "x" | "y"
	backgroundColor: string
	/** 0..1 fill alpha applied on top of the fill color. */
	backgroundOpacity: number
	borderColor: string
	borderThickness: number
	/** 0..1 alpha applied to the border stroke. */
	borderOpacity: number
	borderDash: LineDashPattern
	/** Custom dasharray override — see `RectangleAnnotation.borderDasharray`. */
	borderDasharray?: string | null
	/** "behind" draws under the chart marks; "front" draws above them. */
	zOrder: "behind" | "front"
	/** How `centerX/centerY/radius` are interpreted — see field docs above. */
	coordSystem: "percent" | "values"
	/** Which facet panels the annotation is drawn on — see
	 *  `RectangleAnnotation.facetKeys`. */
	facetKeys?: string[] | null
}

/** A user-defined straight line segment drawn on top of (or behind) the
 *  plot. The segment runs between two endpoints: A = (xMin, yMin) and
 *  B = (xMax, yMax). The min/max naming mirrors the rectangle (so the
 *  coordinate inputs and the percent↔values conversion are shared), but
 *  nothing forces an ordering — set xMin==xMax for a vertical line,
 *  yMin==yMax for a horizontal reference line, or any pair for an
 *  arbitrary segment (including a negative slope, by giving A a larger
 *  value than B). */
export type LineSegmentAnnotation = {
	/** Stable id for keying and removal. */
	id: string
	/** Optional human label shown in the sidebar list. */
	name: string
	/** Endpoint A x / endpoint B x. Same number-vs-string + percent/values
	 *  rules as the rectangle's `xMin/xMax` — see `RectangleAnnotation`. */
	xMin: number | string
	xMax: number | string
	/** Endpoint A y / endpoint B y. Same rules as the rectangle's `yMin/yMax`
	 *  (percent y=0 hugs the BOTTOM spine; the renderer flips to SVG top-down). */
	yMin: number | string
	yMax: number | string
	lineColor: string
	lineThickness: number
	/** 0..1 alpha applied to the line stroke. */
	lineOpacity: number
	lineDash: LineDashPattern
	/** Custom dasharray override — see `RectangleAnnotation.borderDasharray`. */
	lineDasharray?: string | null
	/** "behind" draws the line UNDER the chart marks; "front" draws ABOVE
	 *  them (the usual choice for a reference / trend line). */
	zOrder: "behind" | "front"
	/** How the endpoints are interpreted — see `RectangleAnnotation`. */
	coordSystem: "percent" | "values"
	/** Which facet panels the annotation is drawn on — see
	 *  `RectangleAnnotation.facetKeys`. */
	facetKeys?: string[] | null
}

export type AnnotationsConfig = {
	rectangles: RectangleAnnotation[]
	circles: CircleAnnotation[]
	lineSegments: LineSegmentAnnotation[]
}

export const DEFAULT_ANNOTATIONS_CONFIG: AnnotationsConfig = {
	rectangles: [],
	circles: [],
	lineSegments: [],
}

/** Build a new rectangle with sensible defaults — placed in the
 *  upper-middle of the plot so it's visible immediately. `style` carries the
 *  theme's annotation defaults (see `rectangleStyleFromTheme`); omitted, the
 *  built-in seed values apply. */
export const newRectangle = (
	id: string,
	style?: BoxAnnotationStyle & RectangleTextStyle
): RectangleAnnotation => ({
	id,
	// Left blank so the sidebar shows an iterating "Rectangle N" suggestion
	// (placeholder) — the user is nudged to type a more descriptive label.
	name: "",
	xMin: 0.25,
	xMax: 0.75,
	yMin: 0.4,
	yMax: 0.7,
	zOrder: "behind",
	coordSystem: "percent",
	...DEFAULT_RECTANGLE_TEXT,
	...DEFAULT_BOX_ANNOTATION_STYLE,
	...style,
})

/** Build a new line segment with sensible defaults — a visible diagonal
 *  across the middle of the plot, drawn in front so it reads as a reference
 *  / trend line over the marks. `style` carries the theme's line-annotation
 *  defaults (see `lineAnnotationStyleFromTheme`). */
export const newLineSegment = (
	id: string,
	style?: LineAnnotationStyle
): LineSegmentAnnotation => ({
	id,
	// Blank — see `newRectangle` (sidebar shows an iterating suggestion).
	name: "",
	xMin: 0.25,
	yMin: 0.4,
	xMax: 0.75,
	yMax: 0.7,
	zOrder: "front",
	coordSystem: "percent",
	...DEFAULT_LINE_ANNOTATION_STYLE,
	...style,
})

/** Build a new circle with sensible defaults — centered in the plot with a
 *  radius of 20% of the plot width, so it's visible immediately. `style`
 *  carries the theme's annotation fill + border defaults (see
 *  `boxAnnotationStyleFromTheme`). */
export const newCircle = (
	id: string,
	style?: BoxAnnotationStyle
): CircleAnnotation => ({
	id,
	// Blank — see `newRectangle` (sidebar shows an iterating suggestion).
	name: "",
	centerX: 0.5,
	centerY: 0.5,
	radius: 0.2,
	radiusAxis: "x",
	zOrder: "behind",
	coordSystem: "percent",
	...DEFAULT_BOX_ANNOTATION_STYLE,
	...style,
})
