import type { ReactNode } from "react"

import type { PlotInner } from "../plotLayout"
import type { PositionScale } from "../scales"

export type AxisLayer = "back" | "front"

/** Position scales for a cartesian coord system. Marks read these to place
 * themselves against the inner rect. `null` when the corresponding axis field
 * isn't mapped — consumers must narrow before use. */
export type CartesianScales = {
	xScale: PositionScale | null
	yScale: PositionScale | null
}

/** Polar position scales used by radar (and future sunburst / wind-rose).
 *
 * `angleScale` maps a row's angle-field value → radians; angle 0 points
 * to 12 o'clock (`-π/2` in screen-Y space) and grows clockwise. Callers
 * should add `-π/2` when converting to screen offsets (or use the helper
 * the renderer provides).
 *
 * `rScale` maps a row's r-field value → pixel radius from the polar
 * center. `null` from either scale means the value couldn't be parsed
 * — the renderer should skip the row. */
export type RadialScales = {
	angleScale: (raw: unknown) => number | null
	rScale: (raw: unknown) => number | null
	/** Polar center in canvas coordinates. */
	center: { cx: number; cy: number }
	/** Maximum radial pixel distance — the rScale's range upper bound,
	 *  also where the angle-tick perimeter labels anchor. */
	maxRadius: number
	/** Resolved angle-axis ticks. For categorical/ordinal angle the value
	 *  is the category string; for quantitative/temporal it's the formatted
	 *  tick value. `angle` is in radians, 0 = 12 o'clock, clockwise. */
	angleTicks: ReadonlyArray<{ label: string; angle: number }>
	/** Resolved r-axis ticks. `radius` is in pixels (distance from center). */
	rTicks: ReadonlyArray<{ label: string; radius: number }>
	/** Resolved concentric grid-ring radii (in pixels). Driven by the
	 *  r-axis gridlines.count config when set; otherwise mirrors
	 *  `rTicks.radius` so rings sit at each label position (the legacy
	 *  "match tick count" behavior). Split from `rTicks` so the user can
	 *  request, e.g., 4 labeled ticks but 10 background rings. */
	rGridRadii: ReadonlyArray<number>
}

/** Projection-backed scales for a geographic coord system. A `geographic`
 * coord builds a d3-geo projection fit to the panel's inner rect, then exposes:
 *
 * `project([lon, lat])` maps a geographic coordinate → canvas pixel, or `null`
 * when the point falls outside the projection's clip extent (e.g. a point
 * outside the albersUsa composite).
 *
 * `path(feature)` renders a GeoJSON feature (or geometry object) to an SVG path
 * `"d"` string, or `null` when the feature produces no geometry. */
export type GeoScales = {
	project: (lonLat: [number, number]) => [number, number] | null
	/** Inverse of `project`: a pixel (in the projection's own coordinate space)
	 *  back to `[lon, lat]`, or `null` when the pixel maps outside the globe.
	 *  Used by the custom drag-to-pan focus to convert pointer pixels to a
	 *  lon/lat shift. */
	invert: (pixel: [number, number]) => [number, number] | null
	path: (feature: GeoJSON.Feature | GeoJSON.GeoJsonObject) => string | null
	/** Pixel-space clip rectangle `[[x0,y0],[x1,y1]]` when the projection is
	 *  clipped to a focus region, else `null`. Path-based geometry is already
	 *  clipped by the projection; point renderers (bubbles/dots) consult this to
	 *  drop marks projecting outside the focused view. */
	clipRect?: [[number, number], [number, number]] | null
}

/** A coordinate system owns "how to render axes around the plot's inner
 * region at a given layer" AND exposes the position scales it resolved so
 * mark renderers can place marks against them. Cartesian coords render two
 * perpendicular axes around a rectangular inner region. Future radial coords
 * would render a circular angle axis and a linear radial axis around a disc.
 *
 * `CoordSystem` is produced by a factory (e.g. `cartesian(input)`) that
 * closes over the scale/config state. Callers pass a `CoordFactory` to
 * `<Plot>`, which invokes the factory with the resolved `inner` rect and
 * renders `renderAxes('back', inner)` before marks (gridlines under) and
 * `renderAxes('front', inner)` after marks (spine/ticks/labels on top).
 *
 * The shape is a tagged union so consumers can narrow by `kind` and reach
 * into `scales` with the right shape. */
export type CoordSystem =
	| {
			kind: "cartesian"
			scales: CartesianScales
			renderAxes: (layer: AxisLayer, inner: PlotInner) => ReactNode
	  }
	| {
			kind: "radial"
			scales: RadialScales
			renderAxes: (layer: AxisLayer, inner: PlotInner) => ReactNode
	  }
	| {
			kind: "geographic"
			scales: GeoScales
			renderAxes: (layer: AxisLayer, inner: PlotInner) => ReactNode
	  }
