import type { GeoViewport } from "../mapConfig"

// Latitude is clamped here: most world projections blow up toward the poles
// (Mercator → infinity at ±90), so keep the box within a safe band.
const MIN_LAT = -85
const MAX_LAT = 85
// Span limits keep the box usable: never wider/taller than the whole world,
// never so tight that a single zoom step inverts the edges.
const MIN_SPAN = 0.5 // degrees
const MAX_LON_SPAN = 360
const MAX_LAT_SPAN = MAX_LAT - MIN_LAT

const clampSpan = (span: number, max: number): number =>
	Math.max(MIN_SPAN, Math.min(max, span))

/**
 * Normalize a viewport into a valid box: ordered edges, latitude within the
 * safe band, and spans within limits. Re-centers (rather than just clipping) so
 * a box pushed past a pole keeps its size and slides back into range.
 */
export const clampViewport = (vp: GeoViewport): GeoViewport => {
	const lonSpan = clampSpan(vp.east - vp.west, MAX_LON_SPAN)
	const latSpan = clampSpan(vp.north - vp.south, MAX_LAT_SPAN)

	let lonCenter = (vp.west + vp.east) / 2
	let latCenter = (vp.south + vp.north) / 2

	// Keep the latitude band inside [MIN_LAT, MAX_LAT].
	latCenter = Math.max(
		MIN_LAT + latSpan / 2,
		Math.min(MAX_LAT - latSpan / 2, latCenter)
	)
	// Keep longitude within [-180, 180] when the span allows it (a full-world
	// span just centers on 0). No wraparound — the fit box must stay simple.
	const lonHalf = lonSpan / 2
	if (lonHalf < 180) {
		lonCenter = Math.max(-180 + lonHalf, Math.min(180 - lonHalf, lonCenter))
	} else {
		lonCenter = 0
	}

	return {
		west: lonCenter - lonSpan / 2,
		east: lonCenter + lonSpan / 2,
		south: latCenter - latSpan / 2,
		north: latCenter + latSpan / 2,
	}
}

/** Shift a viewport by a lon/lat delta (pan), then clamp. */
export const panViewport = (
	vp: GeoViewport,
	dLon: number,
	dLat: number
): GeoViewport =>
	clampViewport({
		west: vp.west + dLon,
		east: vp.east + dLon,
		south: vp.south + dLat,
		north: vp.north + dLat,
	})

/**
 * Zoom a viewport by `factor` (the new span as a fraction of the old: <1 zooms
 * IN, >1 zooms OUT) around an anchor lon/lat. Each edge moves toward/away from
 * the anchor so the anchored point stays put (zoom-to-cursor). Omit the anchor
 * to zoom around the box center.
 */
export const zoomViewport = (
	vp: GeoViewport,
	factor: number,
	anchor?: { lon: number; lat: number }
): GeoViewport => {
	const aLon = anchor?.lon ?? (vp.west + vp.east) / 2
	const aLat = anchor?.lat ?? (vp.south + vp.north) / 2
	return clampViewport({
		west: aLon + (vp.west - aLon) * factor,
		east: aLon + (vp.east - aLon) * factor,
		south: aLat + (vp.south - aLat) * factor,
		north: aLat + (vp.north - aLat) * factor,
	})
}
