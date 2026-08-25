import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode, SVGProps } from "react"
import type { Feature, FeatureCollection } from "geojson"
import { useAtomValue, useSetAtom } from "jotai"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	type ChannelConfigs,
} from "../../lib/channelConfig"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { geographic } from "./coords/geographic"
import type { GeoScales } from "../../lib/coords/types"
import { regionViewport, viewportGeoJson } from "../../lib/geo/focusRegion"
import { DEFAULT_OUTLINE_COLOR } from "../../lib/geo/geoMarkStyle"
import { resolveGeoProjection } from "../../lib/geo/geoProjection"
import { featureId, type GeometryBundle } from "../../lib/geo/loadGeometry"
import { buildOpenSpacePredicate } from "../../lib/geo/openSpace"
import { worldBackdropFeatures } from "../../lib/geo/worldBackdrop"
import type {
	GeographyLevel,
	GeoViewport,
	MapConfig,
} from "../../lib/mapConfig"
import {
	emptyDataLabelsEncodings,
	type DatasetView,
	type Encodings,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentMapConfigAtom,
} from "../../store/atoms"
import {
	useAestheticScales,
	type AestheticFieldInfo,
	type AestheticScales,
} from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useEffectiveGeographyLevel } from "../../store/useEffectiveGeographyLevel"
import { useGeoJoin } from "../../store/useGeoJoin"
import { useGeoLabelLevel } from "../../store/useGeoLabelLevel"
import { useGeometry } from "../../store/useGeometry"
import {
	NEUTRAL_HIGHLIGHT,
	rowHighlight,
	unmatchedHighlight,
	useLegendHighlight,
	useMarkHoverHighlight,
	type MarkHighlight,
} from "../../store/useLegendHighlight"

import { DataLabelsLayer } from "./DataLabelsLayer"
import { GeoBasemap } from "./GeoBasemap"
import { buildGeoLabelAnchors } from "./geoLabelAnchors"
import { HoverTooltip } from "./HoverTooltip"
import type { CoordFactory, PlotContext, PlotProps } from "./Plot"
import { useMapPanZoom } from "./useMapPanZoom"

/** Hover state carries the matched data row plus the pointer's viewport
 *  coordinates so the shared `HoverTooltip` can portal-render itself anywhere
 *  on screen. Unlike scatter there's no mark index — geo marks don't dim. */
type HoverState = {
	row: Record<string, unknown>
	clientX: number
	clientY: number
}

/** What `beginMarks` hands the renderer's mark loop once geometry + coord are
 *  ready. `bundle` is the non-null geometry; `inClip` is true when a projected
 *  pixel falls inside the focus-box clip (always true when not focused) —
 *  path geometry is clipped by the projection, but point marks are separate
 *  `<circle>`s, so renderers drop out-of-box ones via this. */
export type GeoMarksReady = {
	ready: true
	bundle: GeometryBundle
	path: GeoScales["path"]
	pathBounds: GeoScales["pathBounds"]
	project: GeoScales["project"]
	invert: GeoScales["invert"]
	clipRect: GeoScales["clipRect"]
	inClip: (px: number, py: number) => boolean
}

export type GeoMarks =
	| { ready: false; placeholder: ReactNode }
	| GeoMarksReady

export type GeoMapScaffold = {
	/** Jotai-backed config the renderers' mark loops read. */
	encodings: Encodings
	mapConfig: MapConfig
	channelConfigs: ChannelConfigs
	aestheticScales: AestheticScales
	dataset: DatasetView | undefined
	/** Rows to render: `props.rowsOverride` (faceted panel) or the dataset's. */
	rowsForChart: Array<Record<string, unknown>>
	/** featureId -> matched data row (empty when `joinRegions` is false). */
	featureToRow: Map<string, Record<string, unknown>>
	/** Whichever of hue / opacity drives the mark fill (hue preferred). */
	measureField: AestheticFieldInfo | null
	hueScale: AestheticScales["hue"]
	opacityScale: AestheticScales["opacity"]
	outlineHue: AestheticScales["outlineHue"]
	/** Single outline width for all marks (0 hides the border). */
	outlineWidth: number
	baseOutlineColor: string
	/** Gate + shared setup at the top of a marks body: narrows the coord to
	 *  geographic, shows the loading placeholder until geometry resolves, and
	 *  exposes the live scales to the pan/zoom handlers. */
	beginMarks: (ctx: PlotContext) => GeoMarks
	/** The interactive map root `<g>`: spreads the pan/zoom `rootProps` and
	 *  (when a focus is active) a transparent capture rect so wheel/drag over
	 *  ocean/empty areas still reaches the handlers (a bare `<g>` has no
	 *  geometry). `groupProps` merges extras (e.g. `onMouseLeave`). */
	renderInteractiveRoot: (
		ctx: PlotContext,
		children: ReactNode,
		groupProps?: SVGProps<SVGGElement>
	) => ReactNode
	/** Non-interactive world-countries backdrop behind the regions/marks. Null
	 *  unless the resolved projection is world-capable AND the level isn't
	 *  already "countries" (and the countries geometry has loaded). Renderers
	 *  with a basemap toggle add their own `mapConfig.showBasemap` gate. */
	renderWorldBackdrop: (path: GeoScales["path"]) => ReactNode
	/** The Data Labels layer for maps: one label per region matched by the
	 *  labels' `geography` channel, centered on the region's centroid (which
	 *  may be a COARSER level than the map's — state labels on a county map).
	 *  Renderers place it LAST inside `renderInteractiveRoot` so labels
	 *  pan/zoom with the marks. Null until the label geometry resolves or
	 *  when the channel isn't in use. */
	renderDataLabels: (m: GeoMarksReady) => ReactNode
	/** Mouse handler that records the hovered row + pointer position (wired to
	 *  both onMouseEnter and onMouseMove for a follow-cursor feel). Also
	 *  publishes the row's category to the legend-highlight atom, so hovering a
	 *  mark emphasizes its whole series exactly like hovering the matching legend
	 *  entry (the same reverse direction the cartesian renderers have). */
	hoverHandler: (
		row: Record<string, unknown>
	) => (e: React.MouseEvent) => void
	clearHover: () => void
	/** Legend-hover highlight for a mark backed by a DATA ROW (a dot, a bubble,
	 *  a matched region): how to fade / recolor / outline it under the currently
	 *  hovered legend entry. Neutral when nothing is hovered, or when the hovered
	 *  field isn't a column of the row (an unrelated legend). */
	markHighlight: (row: Record<string, unknown>) => MarkHighlight
	/** Legend-hover highlight for a REGION path. A region drawn in the no-data
	 *  paint never matches — it carries no measure to be a member of the hovered
	 *  category — so it fades with the rest. `isNoData` is a thunk because it is
	 *  only consulted while an entry is actually hovered: the normal render path
	 *  pays nothing extra. */
	regionHighlight: (
		feature: Feature,
		isNoData: () => boolean
	) => MarkHighlight
	/** Wiring for the shared `Plot` wrapper: the measured inner rect, the geo
	 *  coord factory, and the hover tooltip overlay. */
	plotProps: Pick<PlotProps, "inner" | "coord" | "tooltip">
}

/**
 * Shared scaffold for the geographic renderers (GeoChoroplethPlot,
 * GeoSymbolPlot, GeoPointPlot). Owns everything except the mark loop:
 *
 *  - geometry bundle + world-backdrop loading (`useGeometry`);
 *  - projection resolution + focus-box fit + the geographic coord factory;
 *  - drag-to-pan/zoom wiring, incl. focus promotion (dragging/zooming a named
 *    region turns it into a custom viewport seeded from that region) and
 *    end-of-gesture viewport commit;
 *  - the region join (featureId -> row) for the renderers that need it;
 *  - hover state + the `HoverTooltip` overlay (torn down whenever the
 *    viewport changes — pan/zoom moves the geography under the cursor, so the
 *    hovered mark goes stale; it reappears on the next mouse move).
 *
 * Each renderer keeps only its mark-drawing loop (region fills / centroid
 * bubbles / lat-long dots) plus its genuinely unique gating.
 */
export const useGeoMapScaffold = (
	props: ChartRendererBaseProps,
	options?: {
		/** Join the `connection` (region) field against the geometry. The
		 *  choropleth and bubble map need this; the lat/long dot map has no
		 *  region join (positions come straight from the data's lon/lat). */
		joinRegions?: boolean
	}
): GeoMapScaffold => {
	const joinRegions = options?.joinRegions ?? true
	const encodings = useAtomValue(currentEncodingsAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	const setMapConfig = useSetAtom(currentMapConfigAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
	const [hovered, setHovered] = useState<HoverState | null>(null)

	// --- Legend-hover highlight ---------------------------------------------
	// Same treatment as the cartesian renderers: a hovered categorical legend
	// entry emphasizes matching marks (opacity / recolor / outline, per the
	// user's Hover options) and fades the rest. Purely presentational — nothing
	// here touches the projection, the coord cache, or the per-feature path
	// strings, so hovering can't invalidate the geometry caches.
	const legendHighlight = useLegendHighlight()
	// The reverse direction (mark hover → highlight its series), wired only for
	// a CATEGORICAL hue: that's exactly when the legend has discrete entries to
	// correspond with. A quantitative measure legend is a gradient and never
	// publishes, so a numeric value could only ever light up its own mark.
	const hueFieldInfo = aestheticScales.hue?.field
	const markHoverField =
		hueFieldInfo && hueFieldInfo.type === "categorical"
			? hueFieldInfo.name
			: null
	const markHover = useMarkHoverHighlight(markHoverField)
	// Both onMouseEnter and onMouseMove share one hover handler (follow-cursor
	// tooltips), so remember what we last published and skip re-publishing the
	// same category on every pixel of movement.
	const publishedMarkValue = useRef<string | null>(null)

	// Drag-to-pan/zoom focus. ANY focus (a named region OR custom) is
	// interactive; the box the projection fits comes from the custom viewport,
	// the named region's box, or null for "auto". The handlers read the latest
	// scales via this ref (set each render in `beginMarks`).
	const scalesRef = useRef<GeoScales | null>(null)
	const focusViewport = useMemo((): GeoViewport | null => {
		if (mapConfig.focusRegion === "custom") return mapConfig.customViewport
		if (mapConfig.focusRegion === "auto") return null
		return regionViewport(mapConfig.focusRegion)
	}, [mapConfig.focusRegion, mapConfig.customViewport])
	// Committing a gesture "promotes" the view to custom: dragging/zooming a
	// named region turns it into a custom viewport seeded from that region, so
	// the user can fine-tune any starting geography exactly how they want.
	const commitViewport = useCallback(
		(customViewport: GeoViewport) =>
			setMapConfig((prev) => ({
				...prev,
				focusRegion: "custom",
				customViewport,
			})),
		[setMapConfig]
	)
	const pan = useMapPanZoom({
		active: mapConfig.focusRegion !== "auto",
		configViewport: focusViewport,
		scalesRef,
		commit: commitViewport,
	})
	// Pan/zoom moves the geography under the cursor, so the hovered mark goes
	// stale — drop the tooltip whenever the viewport changes; it reappears with
	// the correct mark on the next mouse move.
	useEffect(() => {
		setHovered(null)
	}, [pan.viewport])

	// The shared auto-detection hook resolves "auto" from the connection
	// values (null while detecting — beginMarks shows the loading placeholder
	// then, exactly like geometry that hasn't arrived).
	const level: GeographyLevel | null = useEffectiveGeographyLevel()
	const { bundle, loading } = useGeometry(level)
	// Projection/backdrop decisions need a concrete level while detection is
	// in flight; states (the legacy "auto") is harmless — no marks draw until
	// the detected level's geometry lands anyway.
	const levelForProjection = level ?? "states"

	// Resolve the concrete projection BEFORE building the coord (see
	// resolveGeoProjection: albersUsa clips non-US points, so "auto" picks a
	// world projection for the countries level).
	const resolvedProjection = resolveGeoProjection(
		levelForProjection,
		mapConfig.projection,
		mapConfig.focusRegion
	)

	// World-countries backdrop: a US-states (or any non-world) map under a
	// world-capable projection (mercator / naturalEarth) otherwise leaves the
	// rest of the globe blank. Load the countries geometry to draw behind the
	// regions/marks in the no-data fill so the map reads in a global context.
	// Gate on the projection the user CHOSE (resolved without the focus
	// override): a focus forces a world projection just so albersUsa can pan,
	// and that mustn't conjure neighboring countries onto a map that never
	// showed them (e.g. Canada appearing when custom-zooming a US map). The
	// "countries" level already IS the world.
	const needsWorldBackdrop =
		resolveGeoProjection(levelForProjection, mapConfig.projection, "auto") !==
			"albersUsa" && levelForProjection !== "countries"
	const { bundle: worldBundle } = useGeometry(
		needsWorldBackdrop ? "countries" : null
	)

	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)

	// The region field is the `connection` encoding. The measure that colors
	// each mark is whatever is on `hue` (preferred); when only `opacity` is
	// mapped, marks share a base fill whose alpha varies by the measure.
	const regionField = encodings.connection.field
	const hueScale = aestheticScales.hue
	const opacityScale = aestheticScales.opacity
	// Hue wins when mapped; otherwise opacity drives the per-mark value.
	const measureField = hueScale?.field ?? opacityScale?.field ?? null

	// Mark-border styling mirrors ScatterPlot's stroke resolution. The outline
	// width is a single value for all marks (0 hides the border). `outlineHue`
	// is an independent color channel for the border; with no field mapped,
	// every mark falls back to the user's base outline color.
	const outlineWidth = channelConfigs.shape?.outlineWidth ?? 1
	const outlineHue = aestheticScales.outlineHue
	const baseOutlineColor =
		channelConfigs.shape?.outlineColor ?? DEFAULT_OUTLINE_COLOR

	// Resolve the join + build a featureId -> data row map. Region renderers
	// iterate FEATURES (so the whole basemap always draws) or matched features
	// (one bubble each), so the lookup goes featureId -> row. First row per
	// raw value wins. The dot map skips the join entirely (null field).
	const featureToRow = useGeoJoin(
		bundle,
		joinRegions ? regionField : null,
		rowsForChart,
		mapConfig.keyType
	)

	// A no-data region belongs to no category, so it fades with the rest rather
	// than ever lighting up. Guarded on the hovered field being a column of this
	// chart's data (within one visual it always is — the legend and the marks
	// read the same dataset — but an unrelated hover must never dim the map).
	const noDataHighlight = unmatchedHighlight(
		legendHighlight &&
			(dataset?.fields.some((f) => f.name === legendHighlight.field) ?? false)
			? legendHighlight
			: null
	)
	const markHighlight = (row: Record<string, unknown>): MarkHighlight =>
		rowHighlight(legendHighlight, row)
	const regionHighlight = (
		feature: Feature,
		isNoData: () => boolean
	): MarkHighlight => {
		if (!legendHighlight) return NEUTRAL_HIGHLIGHT
		if (isNoData()) return noDataHighlight
		const row = featureToRow.get(featureId(feature))
		return row ? rowHighlight(legendHighlight, row) : noDataHighlight
	}

	// --- Data labels on maps -------------------------------------------------
	// The labels' `geography` channel joins independently of the map's own
	// region field, at its OWN auto-detected level — so a county map can carry
	// state-level labels. Defensive merge: persisted encodings from before the
	// channel existed lack the key.
	const dataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		...useAtomValue(currentDataLabelsEncodingsAtom),
	}
	const dataLabelsCfg = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...useAtomValue(currentDataLabelsConfigAtom),
	}
	const labelField = dataLabelsEncodings.geography?.field ?? null
	// Mirror the layer's own gate (geography + value both required) so we
	// don't load geometry that can't render anything.
	const labelValue = dataLabelsEncodings.value
	const labelsActive =
		labelField !== null &&
		(Boolean(labelValue.field) ||
			(labelValue.multiField === true && (labelValue.fields?.length ?? 0) > 0))
	// When the geography field IS the map's region field, reuse the map's
	// effective level + keyType override so labels and regions can't disagree;
	// otherwise detect the label level from the field's own values.
	const labelSameAsRegion =
		labelsActive && joinRegions && labelField === regionField
	const detectedLabelLevel = useGeoLabelLevel(
		labelsActive && !labelSameAsRegion ? labelField : null
	)
	const { bundle: labelOwnBundle } = useGeometry(
		labelSameAsRegion ? null : detectedLabelLevel
	)
	const labelBundle = !labelsActive
		? null
		: labelSameAsRegion
			? bundle
			: labelOwnBundle
	const labelKeyType = labelSameAsRegion ? mapConfig.keyType : "auto"

	const renderDataLabels = (m: GeoMarksReady): ReactNode => {
		if (labelField === null || labelBundle === null) return null
		const anchors = buildGeoLabelAnchors({
			rows: rowsForChart,
			geographyField: labelField,
			value: labelValue,
			cfg: dataLabelsCfg,
			hueField: dataLabelsEncodings.hue.field,
			sizeField: dataLabelsEncodings.size.field,
			bundle: labelBundle,
			keyType: labelKeyType,
			project: m.project,
			inClip: m.inClip,
		})
		// Open-space preference for the overlap spread: displaced labels drift
		// toward ocean / no-data regions rather than onto data-carrying ones.
		// Occupied = the MAP's own joined regions (labels may sit at a coarser
		// level, but it's the map's marks a label mustn't cover). The dot map
		// has no region join → empty set → no preference, spread unchanged.
		const preferOpenSpace = buildOpenSpacePredicate({
			features: m.bundle.features,
			occupiedIds: new Set(featureToRow.keys()),
			bounds: m.pathBounds,
			invert: m.invert,
		})
		// The layer handles styling / overlap / offsets / gating; the row-based
		// position props are inert on the anchor path.
		return (
			<DataLabelsLayer
				anchors={anchors}
				positionGate="geo"
				preferOpenSpace={preferOpenSpace}
				rows={rowsForChart}
				xScale={null}
				yScale={null}
				xType={null}
				yType={null}
			/>
		)
	}

	// Fit the projection to the level's whole feature collection so every
	// region lands in the panel even when only a few are data-matched. When
	// geometry hasn't resolved yet this is an empty collection (no marks draw).
	// Memoized on the bundle: the collection's IDENTITY keys the coord cache
	// below, so it must only change when the geometry actually does.
	const fitTo: FeatureCollection = useMemo(
		() => ({
			type: "FeatureCollection",
			features: bundle?.features ?? [],
		}),
		[bundle]
	)

	// When a focus is active, fit the projection to its box instead of the
	// loaded geometry — pans + zooms the map there. `pan.viewport` is the live
	// (possibly mid-drag) box for any focus (region or custom); null for "auto".
	// Memoized on the viewport for the same identity-keying reason as fitTo.
	const focusGeo = useMemo(
		() => (pan.viewport ? viewportGeoJson(pan.viewport) : null),
		[pan.viewport]
	)

	// Coord factory — defers the projection build to after measurement so the
	// projection fits the SAME inner rect Plot hands the marks callback.
	//
	// Plot invokes the factory on EVERY render, but building the geographic
	// coord streams the whole fit geometry (fitExtent bounds) — at the ZCTA
	// level that's ~33k polygons — and dropping the old coord instance also
	// drops its per-feature path cache, forcing every "d" string to
	// re-serialize. So memoize the built coord on its actual inputs
	// (projection, fit target identity, clip flag, inner rect) and hand back
	// the SAME instance until one of them really changes: unrelated re-renders
	// (hover, sidebar tweaks, label edits) then cost nothing geographic.
	const coordCacheRef = useRef<{
		projection: typeof resolvedProjection
		fit: GeoJSON.GeoJsonObject
		clip: boolean
		x0: number
		y0: number
		x1: number
		y1: number
		coord: ReturnType<typeof geographic>
	} | null>(null)
	const coord: CoordFactory = (inner) => {
		// Clip to the focus box so neighboring geography doesn't bleed into
		// fitSize's margin (e.g. South America under a North-America focus).
		const fit = focusGeo ?? fitTo
		const clip = focusGeo !== null
		const c = coordCacheRef.current
		if (
			c &&
			c.projection === resolvedProjection &&
			c.fit === fit &&
			c.clip === clip &&
			c.x0 === inner.x0 &&
			c.y0 === inner.y0 &&
			c.x1 === inner.x1 &&
			c.y1 === inner.y1
		) {
			return c.coord
		}
		const built = geographic({
			projection: resolvedProjection,
			inner,
			fitTo: fit,
			clipToFit: clip,
		})
		coordCacheRef.current = {
			projection: resolvedProjection,
			fit,
			clip,
			x0: inner.x0,
			y0: inner.y0,
			x1: inner.x1,
			y1: inner.y1,
			coord: built,
		}
		return built
	}

	const beginMarks = (ctx: PlotContext): GeoMarks => {
		if (ctx.coord.kind !== "geographic")
			return { ready: false, placeholder: null }
		if (loading || !bundle) {
			// SVG-safe loading placeholder inside the plot frame.
			return {
				ready: false,
				placeholder: (
					<text
						x={(ctx.inner.x0 + ctx.inner.x1) / 2}
						y={(ctx.inner.y0 + ctx.inner.y1) / 2}
						textAnchor="middle"
						fill="#78716c"
					>
						Loading geography…
					</text>
				),
			}
		}
		// Expose the live scales to the pan/zoom handlers (for invert).
		scalesRef.current = ctx.coord.scales
		const clipRect = ctx.coord.scales.clipRect
		const inClip = (px: number, py: number): boolean =>
			!clipRect ||
			(px >= clipRect[0][0] &&
				px <= clipRect[1][0] &&
				py >= clipRect[0][1] &&
				py <= clipRect[1][1])
		return {
			ready: true,
			bundle,
			path: ctx.coord.scales.path,
			pathBounds: ctx.coord.scales.pathBounds,
			project: ctx.coord.scales.project,
			invert: ctx.coord.scales.invert,
			clipRect,
			inClip,
		}
	}

	const renderInteractiveRoot = (
		ctx: PlotContext,
		children: ReactNode,
		groupProps?: SVGProps<SVGGElement>
	): ReactNode => (
		<g {...pan.rootProps} {...groupProps}>
			{/* Transparent capture rect: a bare <g> has no geometry, so
			    wheel/drag events over ocean/empty areas would target the SVG
			    and never reach these handlers. This rect (behind the marks)
			    makes the whole plot area catch events that bubble up. */}
			{pan.active && (
				<rect
					x={ctx.inner.x0}
					y={ctx.inner.y0}
					width={ctx.inner.x1 - ctx.inner.x0}
					height={ctx.inner.y1 - ctx.inner.y0}
					fill="none"
					pointerEvents="all"
				/>
			)}
			{children}
		</g>
	)

	// Non-interactive world backdrop behind the regions/marks (only present
	// under world-capable projections). Excludes the parent country so its
	// coarse outline never shows through the foreground region paths. Plain
	// no-data fill: backdrop countries aren't in the dataset, so they carry no
	// measure.
	const renderWorldBackdrop = (path: GeoScales["path"]): ReactNode =>
		needsWorldBackdrop && worldBundle ? (
			<GeoBasemap
				features={worldBackdropFeatures(worldBundle.features)}
				path={path}
				fill={mapConfig.noDataFill}
				stroke={baseOutlineColor}
				strokeWidth={outlineWidth}
			/>
		) : null

	// onMouseMove tracks the cursor as it moves within a (potentially large)
	// mark for a nicer follow-cursor feel — renderers wire the same handler to
	// both enter and move.
	const hoverHandler =
		(row: Record<string, unknown>) => (e: React.MouseEvent) => {
			setHovered({ row, clientX: e.clientX, clientY: e.clientY })
			// Publish this mark's category so its whole series highlights, exactly
			// like hovering the matching legend entry (no-ops when no categorical
			// hue is mapped, or the value hasn't changed since the last move).
			if (markHoverField !== null) {
				const raw = row[markHoverField]
				const key = raw === undefined || raw === null ? null : String(raw)
				if (key !== publishedMarkValue.current) {
					publishedMarkValue.current = key
					markHover.enter(raw)
				}
			}
		}
	const clearHover = () => {
		setHovered(null)
		publishedMarkValue.current = null
		markHover.leave()
	}

	// Tooltip overlay — `HoverTooltip` portals itself to document.body and
	// positions via viewport coords so it isn't clipped by panel or chart
	// `overflow:hidden` ancestors. It reads the user's TooltipConfig itself
	// (enabled / visibleFields / custom HTML), so we pass ALL dataset fields
	// mapped to the hovered row and let it filter — exactly like ScatterPlot.
	const tooltip =
		hovered === null || !dataset || pan.interacting ? null : (
			<HoverTooltip
				state={{
					clientX: hovered.clientX,
					clientY: hovered.clientY,
					fields: dataset.fields.map((f) => ({
						name: f.name,
						value: hovered.row[f.name],
					})),
				}}
			/>
		)

	return {
		encodings,
		mapConfig,
		channelConfigs,
		aestheticScales,
		dataset,
		rowsForChart,
		featureToRow,
		measureField,
		hueScale,
		opacityScale,
		outlineHue,
		outlineWidth,
		baseOutlineColor,
		beginMarks,
		renderInteractiveRoot,
		renderWorldBackdrop,
		renderDataLabels,
		hoverHandler,
		clearHover,
		markHighlight,
		regionHighlight,
		plotProps: { inner: props.inner, coord, tooltip },
	}
}
