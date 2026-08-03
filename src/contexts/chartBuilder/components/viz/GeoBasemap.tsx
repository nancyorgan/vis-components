import type { Feature } from "geojson"

import type { GeoScales } from "../../lib/coords/types"
import { featureId } from "../../lib/geo/loadGeometry"

type GeoBasemapProps = {
	/** The geography's features (one per region). */
	features: Feature[]
	/** The projected path generator from the geographic coord's scales. */
	path: GeoScales["path"]
	/** Uniform no-data fill for every region (e.g. `mapConfig.noDataFill`). Used
	 *  as the per-feature fill when `fillFor` is absent (or returns nothing). */
	fill: string
	/** Outline (stroke) color for every region. Used as the per-feature stroke
	 *  when `strokeFor` is absent. */
	stroke: string
	/** Outline width for every region (0 hides the border). */
	strokeWidth: number
	/** Optional per-feature fill override. When provided, the backdrop becomes a
	 *  CHOROPLETH: each region is filled by this callback (e.g. by a measure)
	 *  instead of the uniform `fill`. Returning the uniform `fill` for unmatched
	 *  regions is the caller's responsibility. */
	fillFor?: (feature: Feature) => string
	/** Optional per-feature stroke override (mirrors `fillFor`). */
	strokeFor?: (feature: Feature) => string
	/** Optional per-feature fill-opacity override (e.g. an opacity-only measure
	 *  choropleth). Omit → no `fillOpacity` attribute (full opacity). */
	fillOpacityFor?: (feature: Feature) => number | undefined
}

/**
 * Non-interactive geography backdrop: draws every region feature as a
 * background path behind the data marks. Used by data-mark map renderers (the
 * bubble map and the lat/long dot map) so the marks read against their
 * geography. Carries NO tooltip handlers — only the data marks are interactive.
 * Features that produce no geometry under the projection (e.g. albersUsa clips
 * non-US regions) are skipped.
 *
 * By default every region uses the uniform `fill` + `stroke`. When the optional
 * `fillFor` / `strokeFor` / `fillOpacityFor` per-feature callbacks are supplied
 * the backdrop becomes a CHOROPLETH (each region colored by a measure) — this
 * is how the bubble map draws its region layer. The uniform props remain the
 * fallback so the dot map's plain backdrop is unchanged.
 *
 * GeoChoroplethPlot does NOT use this — it draws interactive region paths with
 * its own per-region MEASURE fills + tooltips.
 */
export const GeoBasemap = ({
	features,
	path,
	fill,
	stroke,
	strokeWidth,
	fillFor,
	strokeFor,
	fillOpacityFor,
}: GeoBasemapProps) => (
	<>
		{features.map((feature: Feature) => {
			const d = path(feature)
			if (d === null) return null
			return (
				<path
					key={`base-${featureId(feature)}`}
					d={d}
					fill={fillFor ? fillFor(feature) : fill}
					fillOpacity={fillOpacityFor ? fillOpacityFor(feature) : undefined}
					stroke={strokeFor ? strokeFor(feature) : stroke}
					strokeWidth={strokeWidth}
				/>
			)
		})}
	</>
)
