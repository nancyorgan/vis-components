import { geoAlbersUsa, geoMercator, geoNaturalEarth1 } from "d3-geo"

import type { ProjectionName } from "../mapConfig"
import { parseValue } from "../scales"

/** How many would-be point marks the projection rejects.
 *  `total` counts the marks that COULD draw (rows with a usable [lon, lat],
 *  or joined regions with a centroid); `outside` counts those the projection
 *  returns null for — albersUsa is US-only, so anything outside the US
 *  silently vanishes from the map. The Maps section turns a non-zero
 *  `outside` into the "N of M fall outside the mapped area" hint. */
export type OutsideProjectionCount = {
	outside: number
	total: number
}

/** A bare (unfitted) instance of the named projection. Whether a projection
 *  returns null for a [lon, lat] depends only on the projection FAMILY
 *  (albersUsa clips to its US insets; the world projections accept
 *  everything), never on scale/translate — so an unfitted instance answers
 *  "would this point draw?" exactly like the renderer's fitted one, without
 *  needing the plot rect or the fit geometry. */
const bareProjection = (projection: ProjectionName) =>
	projection === "naturalEarth"
		? geoNaturalEarth1()
		: projection === "mercator"
			? geoMercator()
			: geoAlbersUsa()

/**
 * Dot map (geo-points): count the rows whose [lon, lat] the projection
 * rejects. Mirrors GeoPointPlot's mark loop exactly — same quantitative
 * parse, same [lon, lat] order, same `project(...) === null` skip — so the
 * counts always describe the dots actually on screen. Rows with an unusable
 * lon or lat are excluded from BOTH counts (they can never draw under any
 * projection, so they're not "outside" anything).
 */
export const countPointsOutsideProjection = (
	rows: Array<Record<string, unknown>>,
	lonField: string,
	latField: string,
	projection: ProjectionName
): OutsideProjectionCount => {
	const proj = bareProjection(projection)
	let outside = 0
	let total = 0
	for (const row of rows) {
		const lon = parseValue(row[lonField], "quantitative")
		const lat = parseValue(row[latField], "quantitative")
		if (typeof lon !== "number" || typeof lat !== "number") continue
		total++
		if (proj([lon, lat]) === null) outside++
	}
	return { outside, total }
}

/**
 * Bubble map (geo-symbols): count the joined-region centroids the projection
 * rejects. Mirrors GeoSymbolPlot's mark loop (`project(centroid) === null`
 * skip). Only reachable with an explicitly chosen Albers USA over non-US
 * regions — but that's exactly the config where every bubble silently
 * vanishes, so it's worth explaining.
 */
export const countCentroidsOutsideProjection = (
	centroids: Array<[number, number]>,
	projection: ProjectionName
): OutsideProjectionCount => {
	const proj = bareProjection(projection)
	let outside = 0
	for (const c of centroids) if (proj(c) === null) outside++
	return { outside, total: centroids.length }
}
