import type { Feature } from "geojson"

import type {
	AestheticFieldInfo,
	AestheticScales,
} from "../../store/useAestheticScales"
import { resolvePatternDefForItem } from "../buildPatternDefs"
import type { ChannelConfigs } from "../channelConfig"
import { markOutlineResolver } from "../markOutline"
import type { PatternDefSpec } from "../patternDefs"
import { resolveRowModulation } from "../resolveMarkAesthetics"
import { applyAreaScale, applyHueScale, modulateColor } from "../scales"
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

/** What `resolveGeoFill` resolved for one geographic mark. */
export type GeoFillResolved = {
	/** The drawn fill, AFTER saturation/brightness modulation. */
	fill: string
	/** The measure color BEFORE modulation — the pattern-ink palette key
	 *  (see `GeoPatternModulation`). */
	preModulationHue: string
	/** Set only on the opacity-only path (alpha varies over a shared base
	 *  fill); undefined means full opacity. */
	fillOpacity: number | undefined
	/** A measure IS mapped but this row's value didn't resolve (blank/NA). */
	measureMissing: boolean
	/** Sat/bri units applied to `fill`, `null` when that channel contributed
	 *  no modulation. Passed on to the pattern pass so a NO-HUE pattern
	 *  background modulates like the fill. */
	satUnit: number | null
	briUnit: number | null
}

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
 *
 * The resolved color then runs through SATURATION / BRIGHTNESS modulation
 * (`resolveRowModulation` — the same units and fallback convention the
 * cartesian renderers use), so a hue + brightness pairing shades within each
 * hue on a map exactly as it does on a bar or a scatter. `preModulationHue` is
 * kept for the pattern-ink invariant (see `GeoPatternModulation`).
 */
export const resolveGeoFill = (
	baseFill: string,
	row: Record<string, unknown>,
	measureField: AestheticFieldInfo | null,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): GeoFillResolved => {
	const hueScale = aestheticScales.hue
	const opacityScale = aestheticScales.opacity
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
	// Conditional fill rules, the same step the cartesian fill chains take
	// (`resolveGroupFill` / `resolveMarkAesthetics`): an implicit rule tests
	// the Color variable's value, a `{Variable}` rule tests the row. A match
	// replaces the measure color before modulation; a missing measure still
	// reads as missing (the no-data paint decides separately).
	const fillRuleColor = resolveRuleColor(
		channelConfigs.fillColorRules,
		hueScale ? row[hueScale.field.name] : undefined,
		[row]
	)
	if (fillRuleColor) fill = fillRuleColor
	// Opacity as an option of its own, as on every other body: beside a
	// Color measure its variable's scale answers for the row, and with no
	// variable the single level applies. (On the opacity-ONLY path above the
	// variable already is the alpha.) Full opacity sets nothing, so untouched
	// maps draw as before.
	if (fillOpacity === undefined) {
		const level =
			(hueScale && opacityScale
				? opacityScale.scale(row[opacityScale.field.name] as never)
				: null) ??
			channelConfigs.defaultOpacity ??
			1
		if (level !== 1) fillOpacity = level
	}
	const preModulationHue = fill
	const { satUnit, briUnit } = resolveRowModulation(
		row,
		aestheticScales,
		channelConfigs
	)
	if (satUnit !== null || briUnit !== null) {
		fill = modulateColor(fill, satUnit, briUnit)
	}
	return {
		fill,
		preModulationHue,
		fillOpacity,
		measureMissing,
		satUnit,
		briUnit,
	}
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

/** The modulation half of a geo mark's resolved color, as the pattern pass
 *  needs it (from `resolveGeoFill`).
 *
 *  INVARIANT: pattern-ink lookups match the theme palette's exact swatch
 *  hexes, so they key on `preModulationHue` — sat/bri modulation rewrites the
 *  fill hex out of the palette. `satUnit`/`briUnit` ride along so a pattern
 *  whose background is NOT hue-driven modulates like the fill does.
 *
 *  OMIT for marks whose fill comes from a color SLOT (the bubble map's
 *  `geoPointFill`): slots are their own color channels and apply no
 *  modulation, so the fill itself is the palette key. */
export type GeoPatternModulation = {
	preModulationHue: string
	satUnit: number | null
	briUnit: number | null
}

/**
 * Resolve the pattern `<defs>` spec (or null) for one geographic mark — a
 * choropleth region, a bubble, or a dot. Defers to the shared
 * `resolvePatternDefForItem`, so geo marks follow the exact same pattern
 * semantics as the cartesian renderers (per-category palette cycling,
 * PATTERN_NONE opt-outs, hue-paired inks).
 *
 * `fill` is the mark's ALREADY-RESOLVED fill (from `resolveGeoFill` or the
 * bubble color slot); `mod` carries the pre-modulation hue + sat/bri units
 * behind it (see `GeoPatternModulation`), and defaults to "fill IS the hue,
 * no modulation" when omitted.
 */
export const resolveGeoPatternDef = (
	row: Record<string, unknown>,
	fill: string,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	mod?: GeoPatternModulation
): PatternDefSpec | null => {
	const patternField = aestheticScales.pattern?.field ?? null
	// With no Pattern variable the configured DEFAULT pattern applies, as it
	// does to bars and cells.
	if (!patternField && channelConfigs.defaultPattern == null) return null
	return resolvePatternDefForItem(
		{
			patternValue: patternField ? row[patternField.name] : undefined,
			fill,
			preModulationHue: mod?.preModulationHue ?? fill,
			satUnit: mod?.satUnit ?? null,
			briUnit: mod?.briUnit ?? null,
		},
		aestheticScales,
		channelConfigs,
		channelConfigs.pattern?.backgroundColor ?? null,
		GEO_PATTERN_OPTIONS
	)
}

/** Geo marks take the configured default pattern like bars and cells. Marks
 *  and the upfront defs pass both resolve through `resolveGeoPatternDef`, so
 *  they cannot disagree on it. */
const GEO_PATTERN_OPTIONS = { includeDefaultPattern: true } as const

/** The SVG fill a geo mark should draw with: the pattern ref when the mark's
 *  row carries a pattern category, else the plain resolved fill. Marks and the
 *  upfront defs pass (`buildGeoPatternDefs`) share `resolveGeoPatternDef`, so
 *  a mark can never reference a def that wasn't emitted. */
export const geoPatternFill = (
	row: Record<string, unknown>,
	fill: string,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	mod?: GeoPatternModulation
): string => {
	const def = resolveGeoPatternDef(
		row,
		fill,
		aestheticScales,
		channelConfigs,
		mod
	)
	return def === null ? fill : `url(#${def.svgId})`
}

/** Build the deduplicated `<pattern>` def specs a geo renderer's marks will
 *  reference, from (row, resolved fill) pairs. Renderers run this upfront and
 *  hand the result to `<Plot patternDefs>` so every def is registered before
 *  any mark references it. */
export const buildGeoPatternDefs = (
	marks: Iterable<{
		row: Record<string, unknown>
		fill: string
		mod?: GeoPatternModulation
	}>,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): PatternDefSpec[] => {
	if (!aestheticScales.pattern && channelConfigs.defaultPattern == null) return []
	const defs = new Map<string, PatternDefSpec>()
	for (const { row, fill, mod } of marks) {
		const def = resolveGeoPatternDef(
			row,
			fill,
			aestheticScales,
			channelConfigs,
			mod
		)
		if (def && !defs.has(def.svgId)) defs.set(def.svgId, def)
	}
	return [...defs.values()]
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
	/** The outline's Opacity for the region; `undefined` at full opacity. */
	strokeOpacityFor: (feature: Feature) => number | undefined
	strokeFor: (feature: Feature) => string
	/** The outline's thickness for the region (px; 0 = none). */
	strokeWidthFor: (feature: Feature) => number
	/** True when the feature draws in the NO-DATA paint: absent from the dataset
	 *  entirely, or a matched row whose measure value didn't resolve (blank/NA)
	 *  and whose own pattern category doesn't already paint it. Legend-hover
	 *  highlighting reads this to keep such regions out of the matched set —
	 *  they carry no measure to be a member of the hovered category (see
	 *  `unmatchedHighlight`). */
	noDataFor: (feature: Feature) => boolean
}

/** One resolution of a MATCHED row's region paint: the measure-driven fill
 *  (`resolveGeoFill`), the paint actually drawn (that fill, or the row's own
 *  pattern-channel ref), and whether it lands on the no-data paint. Shared by
 *  `buildRegionStyleResolvers` and `matchedRowIsNoData` so "paints as
 *  no-data" is decided in exactly one place. */
const resolveRowPaint = (
	baseFill: string,
	row: Record<string, unknown>,
	measureField: AestheticFieldInfo | null,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): { paint: string; noData: boolean } => {
	const { fill, measureMissing, preModulationHue, satUnit, briUnit } =
		resolveGeoFill(baseFill, row, measureField, aestheticScales, channelConfigs)
	const paint = geoPatternFill(row, fill, aestheticScales, channelConfigs, {
		preModulationHue,
		satUnit,
		briUnit,
	})
	// The row's own pattern-channel paint (an encoding) wins; otherwise a
	// blank/NA measure renders like an unmatched region.
	return { paint, noData: paint === fill && measureMissing }
}

/**
 * Whether a MATCHED row paints as no-data: its mapped measure didn't resolve
 * (blank / NA cell) and no pattern-channel category of its own paints it
 * instead. False when no measure is mapped at all (every region is "no
 * measure" there, not "missing data"). The single predicate behind
 * `noDataFor`, the choropleth's "Fill regions with no data" skip, and the
 * auto frame's notion of what's drawn (useGeoMapScaffold /
 * useAutoFitViewport), so the three can never disagree.
 */
export const matchedRowIsNoData = (
	row: Record<string, unknown>,
	measureField: AestheticFieldInfo | null,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): boolean =>
	// The base fill can't affect the verdict (a resolved measure replaces it;
	// an unresolved one flags measureMissing either way), so any color will do.
	resolveRowPaint("#000000", row, measureField, aestheticScales, channelConfigs)
		.noData

/**
 * Build the per-feature region style resolvers shared by GeoChoroplethPlot
 * (its interactive region paths) and GeoSymbolPlot (its non-interactive
 * region basemap), so the fill/opacity/stroke precedence exists exactly once:
 *
 *  - FILL: the matched row's hue (preferred) / opacity measure via
 *    `resolveGeoFill` (sat/bri modulation included), swapped for a pattern
 *    ref when the row carries a
 *    pattern category (see `geoPatternFill`); unmatched → `noDataFill`, or
 *    the no-data pattern ref when `noDataPatternDef` is set. A matched row
 *    whose measure value didn't resolve (blank/NA) also takes the no-data
 *    pattern — absent-from-dataset and explicit-NA look identical — unless
 *    its own pattern-channel category already paints it.
 *  - FILL-OPACITY: only set on the opacity-only path (alpha varies over the
 *    shared base fill); unmatched → undefined (full opacity).
 *  - STROKE: the shared outline resolver (`lib/markOutline`) — a matching
 *    outline rule, then the Outline variable's color for the row, else the
 *    one outline color; shaded by the outline's Saturation / Brightness and
 *    drawn at its Opacity. An unmatched region has no row, so it takes the
 *    one outline color and the single levels.
 */
export const buildRegionStyleResolvers = ({
	featureToRow,
	noDataFill,
	noDataPatternDef = null,
	measureField,
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
	/** Full scales + configs: the hue / opacity measure scales, the pattern
	 *  channel, and the saturation / brightness modulation all resolve from
	 *  here (see `resolveGeoFill`). */
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
}): RegionStyleResolvers => {
	const rowFor = (feature: Feature) => featureToRow.get(featureId(feature))
	// A region's outline — color (rule, Outline variable, or the one outline
	// color), saturation / brightness and opacity — through the resolver
	// every mark's outline shares. An unmatched region has no row: it takes
	// the one outline color and the single levels.
	const outlineFor = markOutlineResolver(channelConfigs, aestheticScales)
	const outlineOf = (feature: Feature) => outlineFor(rowFor(feature) ?? {})
	const noDataPaint = noDataPatternDef
		? `url(#${noDataPatternDef.svgId})`
		: noDataFill
	/** A MATCHED row's region paint (see `resolveRowPaint`), with the no-data
	 *  verdict swapped for this map's no-data paint — so `fillFor` and
	 *  `noDataFor` can't drift apart. */
	const paintOf = (
		row: Record<string, unknown>
	): { paint: string; noData: boolean } => {
		const { paint, noData } = resolveRowPaint(
			noDataFill,
			row,
			measureField,
			aestheticScales,
			channelConfigs
		)
		return noData ? { paint: noDataPaint, noData: true } : { paint, noData: false }
	}
	return {
		fillFor: (feature) => {
			const row = rowFor(feature)
			return row ? paintOf(row).paint : noDataPaint
		},
		fillOpacityFor: (feature) => {
			const row = rowFor(feature)
			return row
				? resolveGeoFill(
						noDataFill,
						row,
						measureField,
						aestheticScales,
						channelConfigs
					).fillOpacity
				: undefined
		},
		strokeFor: (feature) => outlineOf(feature).stroke,
		strokeOpacityFor: (feature) => {
			const { strokeOpacity } = outlineOf(feature)
			return strokeOpacity === 1 ? undefined : strokeOpacity
		},
		strokeWidthFor: (feature) => outlineOf(feature).strokeWidth,
		noDataFor: (feature) => {
			const row = rowFor(feature)
			return row ? paintOf(row).noData : true
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
