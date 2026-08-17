import type { Feature } from "geojson"

import type {
	AestheticFieldInfo,
	AestheticScales,
} from "../../store/useAestheticScales"
import { resolvePatternDefForItem } from "../buildPatternDefs"
import type { ChannelConfigs, TextColorRule } from "../channelConfig"
import type { PatternDefSpec } from "../patternDefs"
import { applyAreaScale, applyHueScale } from "../scales"
import { resolveRuleColor } from "../textColorRules"
import { featureId } from "./loadGeometry"

/** Final fallback outline color when the user hasn't set one and no outline
 *  field is mapped — a thin neutral hairline that reads cleanly over both
 *  filled/no-data regions and bubbles. The base color always comes from
 *  `channelConfigs.shape.outlineColor` first (see `resolveGeoOutlineColor`). */
export const DEFAULT_OUTLINE_COLOR = "#ffffff"

/** Base fill for the opacity-only path (no hue mapped): marks share this color
 *  and vary their alpha by the measure. */
export const OPACITY_BASE_FILL = "#3730a3" // indigo-800

/**
 * Resolve a geographic mark's fill + fill-opacity from the mapped measure.
 *
 * Precedence (mirrors ScatterPlot's fill logic, shared by the choropleth and
 * the bubble map): hue wins when mapped; otherwise an `opacity`-only mapping
 * varies the alpha over `OPACITY_BASE_FILL`; otherwise the caller's `baseFill`
 * is returned unchanged. The choropleth passes `mapConfig.noDataFill` as the
 * base; the bubble map passes the default mark fill.
 *
 * `row` is the matched data row for this feature; `measureField` is whichever
 * of hue/opacity drives the value (hue preferred). When no measure is mapped
 * (or the value doesn't resolve), the base fill is returned with no opacity.
 *
 * `measureMissing` is true only when a measure IS mapped but its value didn't
 * resolve (blank/NA cell) — the "this region has missing data" signal the
 * no-data pattern keys on. It stays false when no measure is mapped at all
 * (every region returns the base fill there; that's "no measure", not
 * "missing data").
 */
export const resolveGeoFill = (
	baseFill: string,
	row: Record<string, unknown>,
	measureField: AestheticFieldInfo | null,
	hueScale: AestheticScales["hue"],
	opacityScale: AestheticScales["opacity"]
): { fill: string; fillOpacity: number | undefined; measureMissing: boolean } => {
	let fill = baseFill
	let fillOpacity: number | undefined
	let measureMissing = false
	if (measureField) {
		const raw = row[measureField.name]
		if (hueScale) {
			const color = applyHueScale(hueScale.scale, raw, measureField.type)
			if (color !== null) fill = color
			else measureMissing = true
		} else if (opacityScale) {
			const alpha = opacityScale.scale(raw)
			if (alpha !== null) {
				fill = OPACITY_BASE_FILL
				fillOpacity = alpha
			} else measureMissing = true
		}
	}
	return { fill, fillOpacity, measureMissing }
}

/** The `<pattern>` def for the map's OPTIONAL no-data pattern overlay
 *  (`mapConfig.noDataPattern`), or null when the map uses the solid no-data
 *  fill. One def per chart: the tile background is the no-data fill, the ink
 *  is `noDataPatternInk`, so the id can be a fixed slug. Applies to unmatched
 *  regions and matched rows whose measure value didn't resolve — see
 *  `buildRegionStyleResolvers`. */
export const resolveNoDataPatternDef = (mapConfig: {
	noDataPattern: number | null
	noDataFill: string
	noDataPatternInk: string
}): PatternDefSpec | null =>
	mapConfig.noDataPattern === null
		? null
		: {
				svgId: "vc-pat-nodata",
				paletteIdx: mapConfig.noDataPattern,
				bgColor: mapConfig.noDataFill,
				inkColor: mapConfig.noDataPatternInk,
			}

/** Fallback pattern-tile background when no hue drives the mark fill and the
 *  user hasn't set `pattern.backgroundColor` (same constant the cartesian
 *  renderers use). */
const PATTERN_BG_FALLBACK = "#e2e8f0"

/**
 * Resolve the pattern `<defs>` spec (or null) for one geographic mark — a
 * choropleth region, a bubble, or a dot. Defers to the shared
 * `resolvePatternDefForItem`, so geo marks follow the exact same pattern
 * semantics as the cartesian renderers (per-category palette cycling,
 * PATTERN_NONE opt-outs, hue-paired inks).
 *
 * `fill` is the mark's ALREADY-RESOLVED fill (from `resolveGeoFill` or the
 * bubble color slot). Geo fills apply no sat/bri modulation, so the fill IS
 * the pre-modulation hue color — it serves as both the pattern's background
 * tile and the palette key for the ink lookup.
 */
export const resolveGeoPatternDef = (
	row: Record<string, unknown>,
	fill: string,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): PatternDefSpec | null => {
	const patternField = aestheticScales.pattern?.field ?? null
	if (!patternField) return null
	return resolvePatternDefForItem(
		{ patternValue: row[patternField.name], fill, preModulationHue: fill },
		aestheticScales,
		channelConfigs,
		channelConfigs.pattern?.backgroundColor ?? PATTERN_BG_FALLBACK
	)
}

/** The SVG fill a geo mark should draw with: the pattern ref when the mark's
 *  row carries a pattern category, else the plain resolved fill. Marks and the
 *  upfront defs pass (`buildGeoPatternDefs`) share `resolveGeoPatternDef`, so
 *  a mark can never reference a def that wasn't emitted. */
export const geoPatternFill = (
	row: Record<string, unknown>,
	fill: string,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): string => {
	const def = resolveGeoPatternDef(row, fill, aestheticScales, channelConfigs)
	return def === null ? fill : `url(#${def.svgId})`
}

/** Build the deduplicated `<pattern>` def specs a geo renderer's marks will
 *  reference, from (row, resolved fill) pairs. Renderers run this upfront and
 *  hand the result to `<Plot patternDefs>` so every def is registered before
 *  any mark references it. */
export const buildGeoPatternDefs = (
	marks: Iterable<{ row: Record<string, unknown>; fill: string }>,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): PatternDefSpec[] => {
	if (!aestheticScales.pattern) return []
	const defs = new Map<string, PatternDefSpec>()
	for (const { row, fill } of marks) {
		const def = resolveGeoPatternDef(row, fill, aestheticScales, channelConfigs)
		if (def && !defs.has(def.svgId)) defs.set(def.svgId, def)
	}
	return [...defs.values()]
}

/**
 * Resolve a geographic mark's outline (stroke) color for a matched row.
 *
 * Border stroke precedence (mirrors ScatterPlot): a matching conditional
 * outline rule wins, then the `outlineHue` scale color for this region's row,
 * else the caller's `baseOutlineColor`. This assumes a matched `row` (rules /
 * scale can only resolve with one), so callers gate on `row` themselves —
 * the choropleth's no-data regions, which have no row, always use the base
 * color without calling this.
 */
export const resolveGeoOutlineColor = (
	baseOutlineColor: string,
	row: Record<string, unknown>,
	outlineHue: AestheticScales["outlineHue"],
	outlineColorRules: readonly TextColorRule[] | undefined
): string => {
	if (!outlineHue) return baseOutlineColor
	const rawOutline = row[outlineHue.field.name]
	const outlineRuleColor = resolveRuleColor(outlineColorRules, rawOutline)
	const outlineScaleColor = applyHueScale(
		outlineHue.scale,
		rawOutline,
		outlineHue.field.type
	)
	return outlineRuleColor ?? outlineScaleColor ?? baseOutlineColor
}

/** Per-feature style callbacks for a REGION layer (a choropleth's region
 *  paths, or the bubble map's region basemap). Each callback looks up the
 *  feature's matched data row and resolves through `resolveGeoFill` /
 *  `resolveGeoOutlineColor`; an unmatched feature (no row) gets the no-data
 *  fill / base outline color. The shape matches `GeoBasemap`'s optional
 *  `fillFor` / `fillOpacityFor` / `strokeFor` props. */
export type RegionStyleResolvers = {
	fillFor: (feature: Feature) => string
	fillOpacityFor: (feature: Feature) => number | undefined
	strokeFor: (feature: Feature) => string
}

/**
 * Build the per-feature region style resolvers shared by GeoChoroplethPlot
 * (its interactive region paths) and GeoSymbolPlot (its non-interactive
 * region basemap), so the fill/opacity/stroke precedence exists exactly once:
 *
 *  - FILL: the matched row's hue (preferred) / opacity measure via
 *    `resolveGeoFill`, swapped for a pattern ref when the row carries a
 *    pattern category (see `geoPatternFill`); unmatched → `noDataFill`, or
 *    the no-data pattern ref when `noDataPatternDef` is set. A matched row
 *    whose measure value didn't resolve (blank/NA) also takes the no-data
 *    pattern — absent-from-dataset and explicit-NA look identical — unless
 *    its own pattern-channel category already paints it.
 *  - FILL-OPACITY: only set on the opacity-only path (alpha varies over the
 *    shared base fill); unmatched → undefined (full opacity).
 *  - STROKE: conditional outline rule wins, then the `outlineHue` scale color
 *    for the row, else `baseOutlineColor`; unmatched → `baseOutlineColor`.
 */
export const buildRegionStyleResolvers = ({
	featureToRow,
	noDataFill,
	noDataPatternDef = null,
	measureField,
	hueScale,
	opacityScale,
	baseOutlineColor,
	outlineHue,
	outlineColorRules,
	aestheticScales,
	channelConfigs,
}: {
	/** featureId -> matched data row (from `useGeoJoin`). */
	featureToRow: Map<string, Record<string, unknown>>
	noDataFill: string
	/** From `resolveNoDataPatternDef(mapConfig)`. Callers that pass a non-null
	 *  def must also register it in `<Plot patternDefs>`. */
	noDataPatternDef?: PatternDefSpec | null
	measureField: AestheticFieldInfo | null
	hueScale: AestheticScales["hue"]
	opacityScale: AestheticScales["opacity"]
	baseOutlineColor: string
	outlineHue: AestheticScales["outlineHue"]
	outlineColorRules: readonly TextColorRule[] | undefined
	/** Full scales + configs, needed for the pattern channel (the individual
	 *  hue/opacity fields above predate patterns and stay for call-site
	 *  clarity). */
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
}): RegionStyleResolvers => {
	const rowFor = (feature: Feature) => featureToRow.get(featureId(feature))
	const noDataPaint = noDataPatternDef
		? `url(#${noDataPatternDef.svgId})`
		: noDataFill
	return {
		fillFor: (feature) => {
			const row = rowFor(feature)
			if (!row) return noDataPaint
			const { fill, measureMissing } = resolveGeoFill(
				noDataFill,
				row,
				measureField,
				hueScale,
				opacityScale
			)
			const paint = geoPatternFill(row, fill, aestheticScales, channelConfigs)
			// The row's own pattern-channel paint (an encoding) wins; otherwise a
			// blank/NA measure renders like an unmatched region.
			if (paint !== fill) return paint
			return measureMissing ? noDataPaint : fill
		},
		fillOpacityFor: (feature) => {
			const row = rowFor(feature)
			return row
				? resolveGeoFill(noDataFill, row, measureField, hueScale, opacityScale)
						.fillOpacity
				: undefined
		},
		strokeFor: (feature) => {
			const row = rowFor(feature)
			return row
				? resolveGeoOutlineColor(
						baseOutlineColor,
						row,
						outlineHue,
						outlineColorRules
					)
				: baseOutlineColor
		},
	}
}

/**
 * Resolve a geographic point mark's radius (bubble map / dot map).
 *
 * With an area scale mapped the circle's SIZE is the measure, so a row whose
 * `area` value the scale can't size returns null — the caller SKIPS the mark
 * (drawing a fixed-size circle there would read as a real small data point).
 * With no area scale every mark gets the uniform `fallbackRadius` (the dot
 * map's classic fixed-radius dots; defensive fallback on the bubble map,
 * which requires `area`).
 */
export const resolveGeoRadius = (
	areaScale: AestheticScales["area"],
	row: Record<string, unknown>,
	fallbackRadius: number
): number | null =>
	areaScale
		? applyAreaScale(
				areaScale.scale,
				row[areaScale.field.name],
				areaScale.field.type
			)
		: fallbackRadius
