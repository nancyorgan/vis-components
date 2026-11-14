import { useMemo } from "react"
import type { Feature } from "geojson"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import {
	buildGeoPatternDefs,
	buildRegionStyleResolvers,
	resolveGeoFill,
	resolveNoDataPatternDef,
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
	const geo = useGeoMapScaffold(props, {
		// With "Fill regions with no data" off only the matched regions draw, so
		// "Whole map (auto)" frames those rather than the whole geography (see
		// useGeoMapScaffold).
		fitToMatchedRegions: (mc) => !mc.showNoDataRegions,
	})
	const { mapConfig, channelConfigs } = geo

	// Optional no-data pattern overlay (unmatched / blank-measure regions).
	// Registered in patternDefs below whenever set. Memoized on the atom-held
	// config so the patternDefs memo doesn't churn every render.
	const noDataDef = useMemo(() => resolveNoDataPatternDef(mapConfig), [mapConfig])

	// Per-region fill / fill-opacity / stroke resolution, shared with the
	// bubble map's region basemap (see buildRegionStyleResolvers): matched rows
	// color via the hue/opacity measure + outlineHue/rules; unmatched regions
	// get the no-data fill + base outline color.
	const regionStyle = buildRegionStyleResolvers({
		featureToRow: geo.featureToRow,
		noDataFill: mapConfig.noDataFill,
		noDataPatternDef: noDataDef,
		measureField: geo.measureField,
		aestheticScales: geo.aestheticScales,
		channelConfigs,
	})

	// Pattern `<defs>` for the matched regions, registered upfront so the
	// region paths' `url(#...)` fills (see geoPatternFill via the style
	// resolvers) always have a def to reference. Unmatched regions carry no
	// pattern-channel category, so matched rows plus the (optional) no-data
	// pattern def are the complete def universe.
	const patternDefs = useMemo(() => {
		const defs = buildGeoPatternDefs(
			[...geo.featureToRow.values()].map((row) => {
				// Same resolution the region paths draw with (modulation included),
				// so the `url(#...)` ids always match an emitted def.
				const { fill, preModulationHue, satUnit, briUnit } = resolveGeoFill(
					mapConfig.noDataFill,
					row,
					geo.measureField,
					geo.aestheticScales,
					channelConfigs
				)
				return {
					row,
					fill,
					mod: { preModulationHue, satUnit, briUnit },
				}
			}),
			geo.aestheticScales,
			channelConfigs
		)
		return noDataDef ? [...defs, noDataDef] : defs
	}, [
		geo.featureToRow,
		geo.measureField,
		geo.aestheticScales,
		mapConfig.noDataFill,
		channelConfigs,
		noDataDef,
	])

	const marksBody = (ctx: PlotContext) => {
		const m = geo.beginMarks(ctx)
		if (!m.ready) return m.placeholder
		const { bundle, path } = m

		// Default behavior: every region draws — one NOT in the dataset (no
		// matched row) fills with the no-data color, exactly like a matched row
		// whose measure value is blank/NA. Turning `showNoDataRegions` OFF omits
		// every region that would paint as no-data — unmatched regions AND
		// matched-but-blank rows alike (`regionStyle.noDataFor`; a row's own
		// pattern-channel paint still draws) — so only regions with data draw.
		// The toggle is honored under any focus region too — a focused/custom
		// viewport with the toggle off shows only the data regions (e.g. just
		// Washington).
		const fillNoDataRegions = mapConfig.showNoDataRegions

		return geo.renderInteractiveRoot(
			ctx,
			<>
				{/* The world-countries backdrop (neighboring countries under a
				    world projection) is no-data paint too — Canada above a
				    Washington map — so it follows the same toggle: off means
				    nothing without data is drawn. (The bubble / dot maps gate it
				    on their "Show basemap" toggle instead.) */}
				{fillNoDataRegions ? geo.renderWorldBackdrop(path) : null}
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
						if (!fillNoDataRegions && regionStyle.noDataFor(feature)) return null
						// Only matched regions get a tooltip — hovering a no-data
						// region (no row) leaves the hover state untouched, like
						// hovering empty space.
						const onHover =
							row === undefined ? undefined : geo.hoverHandler(row)
						// Legend-hover highlight: fade / recolor / outline this region
						// under the hovered legend entry. A region drawn in the no-data
						// paint never matches — it fades with the rest. Presentation
						// only: `d` and the projection are untouched, so the coord's
						// per-feature path cache survives a hover.
						const mh = geo.regionHighlight(feature, () =>
							regionStyle.noDataFor(feature)
						)
						return (
							<path
								key={id}
								d={d}
								fill={mh.fill ?? regionStyle.fillFor(feature)}
								fillOpacity={regionStyle.fillOpacityFor(feature)}
								stroke={mh.outline ?? regionStyle.strokeFor(feature)}
								strokeOpacity={
									mh.outline ? undefined : regionStyle.strokeOpacityFor(feature)
								}
								strokeWidth={
									mh.outline
										? Math.max(regionStyle.strokeWidthFor(feature), mh.outlineWidth)
										: regionStyle.strokeWidthFor(feature)
								}
								opacity={mh.opacityMul === 1 ? undefined : mh.opacityMul}
								onMouseEnter={onHover}
								onMouseMove={onHover}
							/>
						)
					})}
				</g>
				{geo.renderDataLabels(m)}
			</>
		)
	}

	return (
		<Plot {...geo.plotProps} patternDefs={patternDefs}>
			{marksBody}
		</Plot>
	)
}
