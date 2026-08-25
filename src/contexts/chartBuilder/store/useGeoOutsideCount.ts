import { useMemo } from "react"
import { useAtomValue } from "jotai"

import { resolveGeoProjection } from "../lib/geo/geoProjection"
import {
	countCentroidsOutsideProjection,
	countPointsOutsideProjection,
	type OutsideProjectionCount,
} from "../lib/geo/outsideProjection"
import type { ProjectionName } from "../lib/mapConfig"
import { currentEncodingsAtom, currentMapConfigAtom } from "./atoms"
import { useChartModeDef } from "./useChartModeDef"
import { useCurrentDatasetView } from "./useCurrentDatasetView"
import { useEffectiveGeographyLevel } from "./useEffectiveGeographyLevel"
import { useGeoJoin } from "./useGeoJoin"
import { useGeometry } from "./useGeometry"

/** What the Maps section's outside-the-projection hint needs to render:
 *  "{outside} of {total} {points|regions} fall outside the mapped area".
 *  `kind` names the mark family being counted (null when the active mode has
 *  no projected point marks — choropleth regions clip themselves via their
 *  paths); `projection` is the resolved projection the counts describe, so
 *  the hint can name the fix (albersUsa is the one that clips). */
export type GeoOutsideStatus = OutsideProjectionCount & {
	kind: "points" | "regions" | null
	projection: ProjectionName
}

// Stable empty rows so the memo below doesn't churn while no dataset is bound.
const NO_ROWS: Array<Record<string, unknown>> = []

/**
 * Count the point marks the current projection silently drops — the dot map's
 * lat/long rows (albersUsa returns null outside the US) or the bubble map's
 * joined-region centroids. The sidebar companion to `useGeoResolution`: that
 * hook explains rows that didn't JOIN; this one explains marks that joined /
 * parsed fine but the PROJECTION rejects, which otherwise just vanish.
 *
 * Resolves the projection exactly like `useGeoMapScaffold` (same level
 * fallback, same focus override) so the counts always describe the map on
 * screen. A focus forces a world projection, so `outside` is 0 there — marks
 * panned out of a focus box are deliberate framing, not lost data. Memoized
 * on data + fields + projection; unrelated re-renders don't recount.
 */
export const useGeoOutsideCount = (): GeoOutsideStatus => {
	const modeId = useChartModeDef().id
	const encodings = useAtomValue(currentEncodingsAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	const dataset = useCurrentDatasetView()

	// Same level fallback the scaffold uses while auto-detection is in flight
	// (harmless: the hint hides at 0, and it recounts when detection lands).
	const level = useEffectiveGeographyLevel()
	const projection = resolveGeoProjection(
		level ?? "states",
		mapConfig.projection,
		mapConfig.focusRegion
	)

	const isPoints = modeId === "geo-points"
	const isSymbols = modeId === "geo-symbols"
	const rows = dataset?.rows ?? NO_ROWS

	// The bubble map counts joined-region CENTROIDS, so it needs the geometry
	// + the same join the renderer draws from. The dot map (and every other
	// mode) skips both loads (null level / null field).
	const { bundle } = useGeometry(isSymbols ? level : null)
	const featureToRow = useGeoJoin(
		bundle,
		isSymbols ? encodings.connection.field : null,
		rows,
		mapConfig.keyType
	)

	const lonField = encodings.x?.field
	const latField = encodings.y?.field

	return useMemo<GeoOutsideStatus>(() => {
		if (isPoints && lonField && latField) {
			return {
				...countPointsOutsideProjection(rows, lonField, latField, projection),
				kind: "points",
				projection,
			}
		}
		if (isSymbols && bundle) {
			const centroids: Array<[number, number]> = []
			for (const id of featureToRow.keys()) {
				const c = bundle.centroids.get(id)
				if (c) centroids.push(c)
			}
			return {
				...countCentroidsOutsideProjection(centroids, projection),
				kind: "regions",
				projection,
			}
		}
		return { outside: 0, total: 0, kind: null, projection }
	}, [
		isPoints,
		isSymbols,
		lonField,
		latField,
		rows,
		projection,
		bundle,
		featureToRow,
	])
}
