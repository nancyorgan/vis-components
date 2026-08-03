import { useMemo } from "react"
import { DEFAULT_FILL, DEFAULT_RADIUS } from "../../lib/channelConfig"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import {
	DEFAULT_OUTLINE_COLOR,
	buildGeoPatternDefs,
	buildRegionStyleResolvers,
	geoPatternFill,
	resolveGeoFill,
	resolveGeoRadius,
} from "../../lib/geo/geoMarkStyle"
import { sortByDrawOrder } from "../../lib/drawOrder"
import { resolveSlotColor } from "../../lib/resolveLayerColor"

import { GeoBasemap } from "./GeoBasemap"
import { GeoCircleMarks, type GeoCircleMark } from "./GeoCircleMarks"
import { Plot, type PlotContext } from "./Plot"
import { useGeoMapScaffold } from "./useGeoMapScaffold"

type GeoSymbolPlotProps = ChartRendererBaseProps

/**
 * Bubble map = a CHOROPLETH with points on top:
 *  - REGIONS (the basemap): a real choropleth. When `mapConfig.showBasemap` is
 *    true (the default) every region draws as a non-interactive backdrop filled
 *    by the `hue` (preferred) / `opacity` measure — matched regions take the
 *    measure color, unmatched regions the `noDataFill` — exactly like
 *    GeoChoroplethPlot's per-region fills (the SAME `buildRegionStyleResolvers`
 *    output drives both). Region outline uses `outlineHue` /
 *    `shape.outlineColor`. When `showBasemap` is off, no regions draw (points
 *    only).
 *  - POINTS (the bubbles): one circle per matched region that ALSO has a usable
 *    `area` value, drawn at the region's centroid and SIZED by `area`. Their
 *    FILL + OUTLINE come from the dedicated point color slots (`geoPointFill` /
 *    `geoPointStroke`), INDEPENDENT of the region/measure colors, so a single
 *    map can color regions by a measure and points by something else entirely.
 *    Bubbles are the only interactive marks (hover → tooltip).
 *
 * The shared map plumbing (geometry + world-backdrop loading, projection +
 * focus fit, region join, pan/zoom, hover tooltip) lives in `useGeoMapScaffold`.
 */
export const GeoSymbolPlot = (props: GeoSymbolPlotProps = {}) => {
	const geo = useGeoMapScaffold(props)
	const { mapConfig, channelConfigs, aestheticScales } = geo

	// The bubbles are SIZED by `area`; the REGION choropleth is colored by
	// `hue` (preferred) or `opacity` (alpha-only) via the scaffold's
	// measureField.
	const areaScale = aestheticScales.area

	// Point (bubble) color comes from the dedicated color slots, NOT hue/opacity
	// (those drive the regions). Each slot resolves field-driven when mapped,
	// else its single color, else the supplied legacy fallback.
	const pointFillSlot = aestheticScales.colorSlots?.geoPointFill
	const pointFillCfg = channelConfigs.colorSlots?.geoPointFill
	const pointStrokeSlot = aestheticScales.colorSlots?.geoPointStroke
	const pointStrokeCfg = channelConfigs.colorSlots?.geoPointStroke

	// Per-region fill / fill-opacity / stroke resolution for the basemap —
	// the same resolvers the choropleth uses for its interactive regions.
	const regionStyle = buildRegionStyleResolvers({
		featureToRow: geo.featureToRow,
		noDataFill: mapConfig.noDataFill,
		measureField: geo.measureField,
		hueScale: geo.hueScale,
		opacityScale: geo.opacityScale,
		baseOutlineColor: geo.baseOutlineColor,
		outlineHue: geo.outlineHue,
		outlineColorRules: channelConfigs.shape?.outlineColorRules,
		aestheticScales,
		channelConfigs,
	})

	// Pattern `<defs>` for BOTH mark layers, registered upfront: the region
	// basemap (fill via the hue/opacity measure) and the bubbles (fill via the
	// geoPointFill slot). Same rows, two fills each — the defs pass mirrors the
	// per-mark resolution exactly so every `url(#...)` has a def.
	const patternDefs = useMemo(() => {
		const rows = [...geo.featureToRow.values()]
		return buildGeoPatternDefs(
			[
				...rows.map((row) => ({
					row,
					fill: resolveGeoFill(
						mapConfig.noDataFill,
						row,
						geo.measureField,
						geo.hueScale,
						geo.opacityScale
					).fill,
				})),
				...rows.map((row) => ({
					row,
					fill: resolveSlotColor(
						pointFillSlot,
						pointFillCfg,
						row,
						channelConfigs.defaultFill ?? DEFAULT_FILL
					),
				})),
			],
			aestheticScales,
			channelConfigs
		)
	}, [
		geo.featureToRow,
		geo.measureField,
		geo.hueScale,
		geo.opacityScale,
		aestheticScales,
		mapConfig.noDataFill,
		pointFillSlot,
		pointFillCfg,
		channelConfigs,
	])

	const marksBody = (ctx: PlotContext) => {
		const m = geo.beginMarks(ctx)
		if (!m.ready) return m.placeholder
		const { bundle, path, project, inClip } = m

		// 1) Region choropleth backdrop (behind the bubbles). Non-interactive —
		// only the bubbles get tooltips. When showBasemap is off, no regions draw.
		const basemap = mapConfig.showBasemap ? (
			<GeoBasemap
				features={bundle.features}
				path={path}
				fill={mapConfig.noDataFill}
				stroke={geo.baseOutlineColor}
				strokeWidth={geo.outlineWidth}
				fillFor={regionStyle.fillFor}
				fillOpacityFor={regionStyle.fillOpacityFor}
				strokeFor={regionStyle.strokeFor}
			/>
		) : null

		// World-countries backdrop behind the region basemap (only under a
		// world-capable projection, and only when the basemap is shown — it IS
		// the geography backdrop).
		const worldBackdrop = mapConfig.showBasemap
			? geo.renderWorldBackdrop(path)
			: null

		// 2) Bubbles (the marks). One circle per MATCHED region that ALSO has a
		// usable `area` value, at the region's centroid.
		const bubbles: GeoCircleMark[] = []
		for (const [id, row] of geo.featureToRow) {
			const centroid = bundle.centroids.get(id)
			if (!centroid) continue
			// Project the [lon, lat] centroid through the coord. albersUsa clips
			// to the US, so a region outside it projects to null — skip it.
			const projected = project(centroid)
			if (projected === null) continue
			const [px, py] = projected
			// Drop bubbles outside the focus box (clipExtent only clips paths).
			if (!inClip(px, py)) continue

			// Radius from the area scale; a null (unsizable) area value drops the
			// bubble. The constant fallback is purely defensive for the
			// shouldn't-happen case where `area` isn't mapped at all (this mode
			// requires it) — just enough to not crash.
			const r = resolveGeoRadius(
				areaScale,
				row,
				channelConfigs.defaultRadius ?? DEFAULT_RADIUS
			)
			if (r === null) continue

			// Point FILL from the geoPointFill slot (field-driven if mapped, else
			// the slot single color, else the default mark fill). INDEPENDENT of
			// the region/measure colors — hue/opacity drive the regions, not the
			// bubbles. Bubbles render at full opacity (there's no point-opacity
			// concept in scope). A row with a pattern category swaps in its
			// pattern ref over the slot color.
			const slotFill = resolveSlotColor(
				pointFillSlot,
				pointFillCfg,
				row,
				channelConfigs.defaultFill ?? DEFAULT_FILL
			)
			const fill = geoPatternFill(row, slotFill, aestheticScales, channelConfigs)

			// Point OUTLINE from the geoPointStroke slot (field-driven if mapped,
			// else the slot single color, else the base outline color).
			const stroke = resolveSlotColor(
				pointStrokeSlot,
				pointStrokeCfg,
				row,
				channelConfigs.shape?.outlineColor ?? DEFAULT_OUTLINE_COLOR
			)

			bubbles.push({ key: id, px, py, r, fill, stroke, row })
		}

		// An explicit Draw order (Aesthetics) overrides the layer's default
		// largest-bubble-first paint order.
		const drawOrder = channelConfigs.drawOrder ?? null
		return geo.renderInteractiveRoot(
			ctx,
			<>
				{worldBackdrop}
				{basemap}
				<GeoCircleMarks
					marks={sortByDrawOrder(bubbles, (b) => b.row, drawOrder, geo.dataset)}
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
