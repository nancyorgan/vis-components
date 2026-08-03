import {
	geoAlbersUsa,
	geoMercator,
	geoNaturalEarth1,
	type GeoPermissibleObjects,
	geoPath,
} from "d3-geo"

import type { ProjectionName } from "../mapConfig"
import type { PlotInner } from "../plotLayout"
import type { CoordSystem, GeoScales } from "./types"

export type GeoInput = {
	/** Which d3-geo projection to build. `"auto"` resolves to albersUsa for
	 *  now (the default branch); the geography-aware auto-pick lands later. */
	projection: ProjectionName | "auto"
	/** The panel's inner rect — the projection is fit to `[width, height]`. */
	inner: PlotInner
	/** The geometry the projection fits to (its bounds drive the fitSize
	 *  scale + translate). Typically the FeatureCollection being drawn. */
	fitTo: GeoJSON.GeoJsonObject
	/** When true, clip rendered geometry to the projected bounds of `fitTo`.
	 *  `fitSize` only "contains" the fit geometry — the panel's non-binding axis
	 *  keeps fitSize's leftover margin, which fills with neighboring geography
	 *  (e.g. South America bleeding in below a North-America focus box on a tall
	 *  panel). Used for focus regions so the view is actually framed to the
	 *  region; off for whole-geography fits (where the backdrop SHOULD show the
	 *  surrounding world). */
	clipToFit?: boolean
}

/** Geographic coord system: builds a d3-geo projection fit to the panel's
 *  inner rect and exposes `project([lon,lat]) → pixel` plus
 *  `path(feature) → SVG "d"`. It renders no axes — the projection itself
 *  replaces the cartesian axis chrome.
 *
 *  `albersUsa` (the default / `"auto"`) is a composite projection: it clips to
 *  the US extent and returns `null` for points outside it, so `project` guards
 *  with `?? null`. Marks must skip rows that project to `null`.
 *
 *  Actual geographic mark rendering happens in the renderer (a later task);
 *  this factory only resolves the projection + scales. */
export const geographic = (input: GeoInput): CoordSystem => {
	const proj =
		input.projection === "naturalEarth"
			? geoNaturalEarth1()
			: input.projection === "mercator"
				? geoMercator()
				: geoAlbersUsa()
	const { x0, y0, x1, y1 } = input.inner
	// d3-geo types its inputs as the narrower `GeoPermissibleObjects` (concrete
	// geometry/feature/collection shapes) rather than the broad
	// `GeoJSON.GeoJsonObject` our plan-level signature accepts. Any real GeoJSON
	// feature/collection we pass satisfies d3-geo at runtime, so bridge the gap
	// with a cast at this boundary only.
	//
	// fitEXTENT (not fitSize): the panel `<g>` carries no transform, so marks
	// render in absolute SVG coordinates — exactly like the cartesian scales,
	// which range over `[inner.x0, inner.x1]`. Fitting to `[[x0,y0],[x1,y1]]`
	// positions the projection INSIDE the plot rect (below the title, right of
	// the margin). fitSize would fit to `[[0,0],[w,h]]`, drawing the map at the
	// SVG origin — over the title and off the plot area.
	proj.fitExtent(
		[
			[x0, y0],
			[x1, y1],
		],
		input.fitTo as GeoPermissibleObjects
	)
	// Clip rect (in the projection's pixel space). Null when not clipping.
	let clipRect: [[number, number], [number, number]] | null = null
	if (input.clipToFit) {
		// `fitExtent` CONTAINS the focus box (fits it whole, leaving margin on the
		// box's looser axis). That couples the visible band to the box: under a
		// distorting projection, panning changes the box's projected aspect, so
		// the band — and the map's top edge — drifts. Upgrade contain → COVER so
		// the focus FILLS the plot rect, then clip to the rect. The frame is now
		// fixed (always the full plot area); panning/zooming moves geography
		// WITHIN it, and nothing bleeds outside.
		const [[bx0, by0], [bx1, by1]] = geoPath(proj).bounds(
			input.fitTo as GeoPermissibleObjects
		)
		const boxW = bx1 - bx0
		const boxH = by1 - by0
		const panelW = x1 - x0
		const panelH = y1 - y0
		if (boxW > 0 && boxH > 0) {
			// Contain fit the tighter axis exactly; scale up by the looser axis's
			// shortfall so the box covers BOTH axes. Scale about the plot center
			// (where fitExtent already centered the box) to keep it centered.
			const k = Math.max(panelW / boxW, panelH / boxH)
			const cx = (x0 + x1) / 2
			const cy = (y0 + y1) / 2
			const [tx, ty] = proj.translate()
			proj.scale(proj.scale() * k)
			proj.translate([cx + (tx - cx) * k, cy + (ty - cy) * k])
		}
		// Clip to the plot rect itself — the fixed frame.
		clipRect = [
			[x0, y0],
			[x1, y1],
		]
		proj.clipExtent(clipRect)
	}
	const path = geoPath(proj)
	const scales: GeoScales = {
		project: (ll) => proj(ll) ?? null,
		invert: (px) => proj.invert?.(px) ?? null,
		path: (f) => path(f as GeoPermissibleObjects) ?? null,
		clipRect,
	}
	return {
		kind: "geographic",
		scales,
		renderAxes: () => null, // projection replaces cartesian axes
	}
}
