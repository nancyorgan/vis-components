import { useMemo } from "react"
import type { Feature } from "geojson"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import {
	buildGeoPatternDefs,
	buildRegionStyleResolvers,
	resolveGeoFill,
} from "../../lib/geo/geoMarkStyle"
import { featureId } from "../../lib/geo/loadGeometry"

import { Plot, type PlotContext } from "./Plot"
import { useGeoMapScaffold } from "./useGeoMapScaffold"

type GeoChoroplethPlotProps = ChartRendererBaseProps

/**
 * Choropleth: one interactive `<path>` per region feature, filled by the
 * measure joined from the data via the `connection` (region) channel. All the
 * shared map plumbing (geometry + world-backdrop loading, projection + focus
 * fit, pan/zoom, hover tooltip) lives in `useGeoMapScaffold`; this file owns
 * only the region-drawing loop and its no-data gating.
 */
export const GeoChoroplethPlot = (props: GeoChoroplethPlotProps = {}) => {
	const geo = useGeoMapScaffold(props)
	const { mapConfig, channelConfigs } = geo

	// Per-region fill / fill-opacity / stroke resolution, shared with the
	// bubble map's region basemap (see buildRegionStyleResolvers): matched rows
	// color via the hue/opacity measure + outlineHue/rules; unmatched regions
	// get the no-data fill + base outline color.
	const regionStyle = buildRegionStyleResolvers({
		featureToRow: geo.featureToRow,
		noDataFill: mapConfig.noDataFill,
		measureField: geo.measureField,
		hueScale: geo.hueScale,
		opacityScale: geo.opacityScale,
		baseOutlineColor: geo.baseOutlineColor,
		outlineHue: geo.outlineHue,
		outlineColorRules: channelConfigs.shape?.outlineColorRules,
		aestheticScales: geo.aestheticScales,
		channelConfigs,
	})

	// Pattern `<defs>` for the matched regions, registered upfront so the
	// region paths' `url(#...)` fills (see geoPatternFill via the style
	// resolvers) always have a def to reference. Unmatched regions carry no
	// pattern, so matched rows are the complete def universe.
	const patternDefs = useMemo(
		() =>
			buildGeoPatternDefs(
				[...geo.featureToRow.values()].map((row) => ({
					row,
					fill: resolveGeoFill(
						mapConfig.noDataFill,
						row,
						geo.measureField,
						geo.hueScale,
						geo.opacityScale
					).fill,
				})),
				geo.aestheticScales,
				channelConfigs
			),
		[
			geo.featureToRow,
			geo.measureField,
			geo.hueScale,
			geo.opacityScale,
			geo.aestheticScales,
			mapConfig.noDataFill,
			channelConfigs,
		]
	)

	const marksBody = (ctx: PlotContext) => {
		const m = geo.beginMarks(ctx)
		if (!m.ready) return m.placeholder
		const { bundle, path } = m

		// Default behavior: a region NOT in the dataset (no matched row) is
		// omitted entirely. Turning on `showNoDataRegions` fills the rest of the
		// basemap with the no-data color (the legacy always-on behavior). A
		// region WITH a matched row always draws, even when its measure value is
		// null.
		//
		// A focus region implies "show this area as a filled map", so it also
		// fills non-data regions with the no-data color — both the own level's
		// gaps (e.g. non-data US states) and, on a world-countries map, the
		// focused continent's other countries (which the world backdrop doesn't
		// cover at the countries level). Without this the focused viewport shows
		// blank land wherever the data doesn't reach.
		const fillNoDataRegions =
			mapConfig.showNoDataRegions || mapConfig.focusRegion !== "auto"

		return geo.renderInteractiveRoot(
			ctx,
			<>
				{geo.renderWorldBackdrop(path)}
				<g onMouseLeave={geo.clearHover}>
					{bundle.features.map((feature: Feature) => {
						const d = path(feature)
						if (d === null) return null
						const id = featureId(feature)
						// The matched data row exists whenever the region value joins
						// to this feature, independent of whether a measure (hue /
						// opacity) is mapped. The tooltip uses it directly; the style
						// resolvers only consult it when a measure is mapped.
						const row = geo.featureToRow.get(id)
						if (!row && !fillNoDataRegions) return null
						// Only matched regions get a tooltip — hovering a no-data
						// region (no row) leaves the hover state untouched, like
						// hovering empty space.
						const onHover =
							row === undefined ? undefined : geo.hoverHandler(row)
						return (
							<path
								key={id}
								d={d}
								fill={regionStyle.fillFor(feature)}
								fillOpacity={regionStyle.fillOpacityFor(feature)}
								stroke={regionStyle.strokeFor(feature)}
								strokeWidth={geo.outlineWidth}
								onMouseEnter={onHover}
								onMouseMove={onHover}
							/>
						)
					})}
				</g>
			</>
		)
	}

	return (
		<Plot {...geo.plotProps} patternDefs={patternDefs}>
			{marksBody}
		</Plot>
	)
}
