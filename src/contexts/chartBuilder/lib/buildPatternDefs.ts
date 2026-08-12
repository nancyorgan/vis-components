import type { AestheticScales } from "../store/useAestheticScales"

import type { Stack } from "./aggregators/stacks"
import { DEFAULT_PATTERN_CONFIG, type ChannelConfigs } from "./channelConfig"
import type { PatternDefSpec } from "./patternDefs"
import {
	DEFAULT_PATTERN_INK,
	inkForHueColor,
	inkPaletteForHue,
	resolvePatternForMark,
} from "./patterns"
import {
	modulatedPatternBg,
	resolveGroupFill,
	type GroupValues,
} from "./resolveLayerColor"

/** One mark's inputs to the pattern-def resolution, with the fill colors
 *  already resolved. Renderers with per-row pipelines (ScatterPlot) build
 *  these from `resolveMarkAesthetics`; GroupValues-based renderers go
 *  through the `buildPatternDefs` wrapper below, which resolves the colors
 *  via `resolveGroupFill`. Either way the SAME resolution the marks use
 *  feeds the defs pass, so svgIds always agree. */
export type PatternDefItem = {
	/** Raw pattern-channel value for the mark (undefined / null / "" mean
	 *  "no pattern category on this mark"). */
	patternValue: unknown
	/** The mark's drawn fill AFTER sat/bri modulation — the pattern's
	 *  background tile color (when hue is mapped). */
	fill: string
	/** Hue color BEFORE sat/bri modulation. INVARIANT: pattern-ink lookups
	 *  match against the theme palette's exact swatch hexes, so they must
	 *  key on this un-modulated color — modulation rewrites the fill hex
	 *  out of the palette (and per-value hue overrides likewise miss the
	 *  palette, falling back to the default ink). */
	preModulationHue: string
	/** Sat/bri unit values applied to `fill` (from `resolveMarkAesthetics` /
	 *  `resolveGroupFill`). When hue is UNMAPPED they modulate the pattern's
	 *  background tile the same way the fill was modulated, so sat/bri
	 *  encodings stay visible on patterned marks. Omitted / null = no
	 *  modulation. */
	satUnit?: number | null
	briUnit?: number | null
}

export type PatternDefOptions = {
	/** Line-chart context (a connection field is mapped): treat the ABSENCE
	 *  of a per-category override as "no pattern" instead of auto-cycling
	 *  the palette — points stay clean by default; users opt in per
	 *  category via the Point-fill swatches. ScatterPlot only. */
	defaultToNone?: boolean
	/** When no pattern FIELD is mapped but `channelConfigs.defaultPattern`
	 *  is set, emit the single `__default__` def each mark references.
	 *  ScatterPlot only for now — extending the default-pattern behavior to
	 *  bars/areas/pies is a product decision, not a refactor concern. */
	includeDefaultPattern?: boolean
}

/** Resolve the pattern `<defs>` spec (or null) for a single mark. Shared by
 *  the upfront defs pass (`buildPatternDefsFromItems`) and ScatterPlot's
 *  per-mark render loop, which needs each mark's `svgId` — using one
 *  resolver for both guarantees marks never reference defs that were never
 *  emitted. */
export const resolvePatternDefForItem = (
	item: PatternDefItem,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	patternBgFallback: string,
	options?: PatternDefOptions
): PatternDefSpec | null => {
	const patG = aestheticScales.pattern?.field ?? null
	const patternCategories = aestheticScales.pattern?.categories ?? null
	const hueG = aestheticScales.hue?.field ?? null

	if (patternCategories && patG) {
		const raw = item.patternValue
		if (raw === undefined || raw === null || String(raw) === "") return null
		const catStr = String(raw)
		const catIdx = patternCategories.indexOf(catStr)
		if (catIdx === -1) return null
		const bgColor = hueG
			? item.fill
			: modulatedPatternBg(
					patternBgFallback,
					item.satUnit ?? null,
					item.briUnit ?? null
				)
		const huePalette = inkPaletteForHue(channelConfigs, hueG?.type)
		// Ink lookup keys on the PRE-modulation hue color (see
		// `PatternDefItem.preModulationHue`).
		const preferredInk = inkForHueColor(
			hueG ? item.preModulationHue : patternBgFallback,
			huePalette.palette,
			huePalette.inks
		)
		return resolvePatternForMark(
			catStr,
			catIdx,
			bgColor,
			channelConfigs.pattern,
			preferredInk,
			options?.defaultToNone
		)
	}

	if (options?.includeDefaultPattern && channelConfigs.defaultPattern != null) {
		// Background swatch applies only when hue isn't driving the fill;
		// with hue mapped the pattern sits on the mark's hue color (matches
		// the field-mapped path above).
		const bgColor = hueG ? item.fill : patternBgFallback
		const inkColor = channelConfigs.defaultPatternInk ?? DEFAULT_PATTERN_INK
		return resolvePatternForMark("__default__", 0, bgColor, {
			...DEFAULT_PATTERN_CONFIG,
			overrides: { __default__: channelConfigs.defaultPattern },
			inkColors: { __default__: inkColor },
		})
	}

	return null
}

/** Build the deduplicated list of `<pattern>` element specs that the
 *  current encoding + configs will reference, from pre-resolved per-mark
 *  items. Renderers run this upfront so all `<defs>` are registered before
 *  any mark tries to reference them via `fill="url(#...)"`. */
export const buildPatternDefsFromItems = (
	items: Iterable<PatternDefItem>,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	patternBgFallback: string,
	options?: PatternDefOptions
): PatternDefSpec[] => {
	const defsMap = new Map<string, PatternDefSpec>()
	for (const item of items) {
		const resolved = resolvePatternDefForItem(
			item,
			aestheticScales,
			channelConfigs,
			patternBgFallback,
			options
		)
		if (resolved && !defsMap.has(resolved.svgId)) {
			defsMap.set(resolved.svgId, resolved)
		}
	}
	return [...defsMap.values()]
}

/** GroupValues-based entry point (BarPlot / AreaPlot / PiePlot iterate
 *  their native `stacks.slices.groupValues`). Resolves each slice's fill +
 *  pre-modulation hue via `resolveGroupFill` — the same helper
 *  `resolveLayerColor` uses — then defers to the item-based core.
 *
 *  Why a separate helper from `resolveLayerColor`:
 *   - `resolveLayerColor` returns only the resolved fill / opacity /
 *     pattern-id for one row/slice — sufficient for rendering.
 *   - This helper produces the *full* `PatternDefSpec` (svgId + svg
 *     children + background + ink) needed by `<PatternDefs>` to emit
 *     each pattern's `<defs>` block. */
export const buildPatternDefs = (
	groupValuesList: readonly GroupValues[],
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	defaultFill: string,
	patternBgFallback: string
): PatternDefSpec[] => {
	const patG = aestheticScales.pattern?.field ?? null
	const patternCategories = aestheticScales.pattern?.categories ?? null
	if (!patternCategories || !patG) return []

	return buildPatternDefsFromItems(
		groupValuesList
			.filter((groupValues) => groupValues.pattern !== undefined)
			.map((groupValues) => {
				const { fill, preModulationHue, satUnit, briUnit } = resolveGroupFill(
					groupValues,
					defaultFill,
					aestheticScales,
					channelConfigs
				)
				return {
					patternValue: groupValues.pattern,
					fill,
					preModulationHue,
					satUnit,
					briUnit,
				}
			}),
		aestheticScales,
		channelConfigs,
		patternBgFallback
	)
}

/** Map a stack list to the slice-level `GroupValues` the `buildPatternDefs`
 *  wrapper consumes. Centralized so BarPlot / AreaPlot / PiePlot stay in
 *  sync. */
export const stacksToGroupValues = (stacks: readonly Stack[]): GroupValues[] =>
	stacks.flatMap((s) => s.slices.map((sl) => sl.groupValues))
