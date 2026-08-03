import { useMemo } from "react"
import { DEFAULT_FILL, DEFAULT_RADIUS } from "../../lib/channelConfig"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import {
	buildGeoPatternDefs,
	geoPatternFill,
	resolveGeoFill,
	resolveGeoOutlineColor,
	resolveGeoRadius,
} from "../../lib/geo/geoMarkStyle"
import { sortByDrawOrder } from "../../lib/drawOrder"
import { parseValue } from "../../lib/scales"

import { GeoBasemap } from "./GeoBasemap"
import { GeoCircleMarks, type GeoCircleMark } from "./GeoCircleMarks"
import { Plot, type PlotContext } from "./Plot"
import { useGeoMapScaffold } from "./useGeoMapScaffold"

type GeoPointPlotProps = ChartRendererBaseProps

/**
 * Lat/long dot map: plot RAW GEOGRAPHIC POINTS. Each data row carries a
 * longitude (`x`) and latitude (`y`); we project `[lon, lat]` through the
 * geographic coord and draw a circle at the resulting pixel. This is the point
 * analogue of the bubble map (GeoSymbolPlot) — but positions come from the
 * data's lon/lat, NOT region centroids, so there is NO region join (the
 * scaffold's `joinRegions: false`).
 *
 * Optional channels:
 *   - `area` → circle radius (proportional symbols at points). When unmapped,
 *     every point is a uniform fixed-radius dot (a classic dot map).
 *   - `hue` / `opacity` → fill (same precedence as the choropleth / bubble map).
 *   - `outlineHue` → per-point stroke color.
 *
 * When `mapConfig.showBasemap` is true (the default) the selected geography
 * draws first as a non-interactive backdrop (outline + no-data fill), so the
 * points read against their geographic context. The projection is fit to the
 * whole geography's features for the same reason.
 *
 * The shared map plumbing (geometry + world-backdrop loading, projection +
 * focus fit, pan/zoom, hover tooltip) lives in `useGeoMapScaffold`.
 */
export const GeoPointPlot = (props: GeoPointPlotProps = {}) => {
	const geo = useGeoMapScaffold(props, { joinRegions: false })
	const { mapConfig, channelConfigs, aestheticScales } = geo

	// x = LONGITUDE, y = LATITUDE. The measure driving fill comes from `hue`
	// (preferred) or `opacity` (alpha-only) via the scaffold's measureField.
	const lonField = geo.encodings.x?.field
	const latField = geo.encodings.y?.field
	const areaScale = aestheticScales.area

	// Pattern `<defs>` for the dots, registered upfront (mirrors ScatterPlot's
	// defs pass). Built from ALL rows — rows later skipped for bad lon/lat just
	// leave an unreferenced def behind, which is inert.
	const patternDefs = useMemo(
		() =>
			buildGeoPatternDefs(
				geo.rowsForChart.map((row) => ({
					row,
					fill: resolveGeoFill(
						channelConfigs.defaultFill ?? DEFAULT_FILL,
						row,
						geo.measureField,
						geo.hueScale,
						geo.opacityScale
					).fill,
				})),
				aestheticScales,
				channelConfigs
			),
		[
			geo.rowsForChart,
			geo.measureField,
			geo.hueScale,
			geo.opacityScale,
			aestheticScales,
			channelConfigs,
		]
	)

	const marksBody = (ctx: PlotContext) => {
		const m = geo.beginMarks(ctx)
		if (!m.ready) return m.placeholder
		const { bundle, path, project, inClip } = m

		// 1) Basemap backdrop (behind the points). Non-interactive — only the
		// points get tooltips. Draws every feature in the no-data fill + base
		// outline, exactly like the bubble map.
		const basemap = mapConfig.showBasemap ? (
			<GeoBasemap
				features={bundle.features}
				path={path}
				fill={mapConfig.noDataFill}
				stroke={geo.baseOutlineColor}
				strokeWidth={geo.outlineWidth}
			/>
		) : null

		// World-countries backdrop behind the basemap (only under a world-capable
		// projection, and only when the basemap is shown — it IS the geography
		// backdrop).
		const worldBackdrop = mapConfig.showBasemap
			? geo.renderWorldBackdrop(path)
			: null

		// 2) Points (the marks). One circle per DATA ROW with a valid lon/lat
		// that projects within the geography.
		const points: GeoCircleMark[] = []
		if (lonField && latField) {
			for (let i = 0; i < geo.rowsForChart.length; i++) {
				const row = geo.rowsForChart[i]
				// Parse lon/lat as quantitative; reject null/NaN/empty.
				const lon = parseValue(row[lonField], "quantitative")
				const lat = parseValue(row[latField], "quantitative")
				if (typeof lon !== "number" || typeof lat !== "number") continue

				// Project [longitude, latitude] (NOTE the order). albersUsa clips
				// to the US, so a point outside it projects to null — skip it.
				const projected = project([lon, lat])
				if (projected === null) continue
				const [px, py] = projected
				// Drop dots outside the focus box (clipExtent only clips paths).
				if (!inClip(px, py)) continue

				// Radius. On a dot map `area` is OPTIONAL: when an area scale
				// exists, a row it can't size is skipped (mirrors the bubble map's
				// null-area drop); when NO area scale is mapped, every point is a
				// uniform fixed-radius dot.
				const r = resolveGeoRadius(
					areaScale,
					row,
					channelConfigs.defaultRadius ?? DEFAULT_RADIUS
				)
				if (r === null) continue

				// Fill: hue wins; else opacity-only varies alpha over a base fill;
				// else the default mark fill. Mirrors the bubble map / choropleth.
				// A row with a pattern category swaps in its pattern ref.
				const { fill: plainFill, fillOpacity } = resolveGeoFill(
					channelConfigs.defaultFill ?? DEFAULT_FILL,
					row,
					geo.measureField,
					geo.hueScale,
					geo.opacityScale
				)
				const fill = geoPatternFill(
					row,
					plainFill,
					aestheticScales,
					channelConfigs
				)

				// Border stroke precedence (mirrors the bubble map): a matching
				// conditional outline rule wins, then the `outlineHue` scale color
				// for this row, else the base outline color.
				const stroke = resolveGeoOutlineColor(
					geo.baseOutlineColor,
					row,
					geo.outlineHue,
					channelConfigs.shape?.outlineColorRules
				)

				points.push({
					key: String(i),
					px,
					py,
					r,
					fill,
					fillOpacity,
					stroke,
					row,
				})
			}
		}

		// An explicit Draw order (Aesthetics) overrides the layer's default
		// largest-dot-first paint order.
		const drawOrder = channelConfigs.drawOrder ?? null
		return geo.renderInteractiveRoot(
			ctx,
			<>
				{worldBackdrop}
				{basemap}
				<GeoCircleMarks
					marks={sortByDrawOrder(points, (p) => p.row, drawOrder, geo.dataset)}
					outlineWidth={geo.outlineWidth}
					hoverHandler={geo.hoverHandler}
					preserveOrder={drawOrder !== null}
				/>
			</>,
			{ onMouseLeave: geo.clearHover }
		)
	}

	return (
		<Plot {...geo.plotProps} patternDefs={patternDefs}>
			{marksBody}
		</Plot>
	)
}
