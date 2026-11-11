import type { AestheticScales } from "../store/useAestheticScales"

import {
	DEFAULT_PATTERN_CONFIG,
	type PatternConfig,
	type ChannelConfigs,
	type ColorSlotConfig,
	type ColorSlotKey,
	type ModulationSlotConfig,
	type ModulationSlotKey,
	type OpacitySlotConfig,
	type OpacitySlotKey,
} from "./channelConfig"
import { modulationSlotEdited } from "./modulationSlots"
import type { PatternDefSpec } from "./patternDefs"
import {
	inkForHueColor,
	inkPaletteForHue,
	resolveDefaultPatternForMark,
	resolveDefaultPatternInk,
	resolvePatternForMark,
} from "./patterns"
import { OPACITY_SLOT_DEFS } from "./opacitySlots"
import { applyHueScale, modulateColor, type UnitScale } from "./scales"
import { resolveRuleColor, type RuleRows } from "./textColorRules"

/** Subset of `Slice.groupValues` (or equivalent per-row aesthetic map)
 *  that this resolver consumes. Keys are the five "group channels"; the
 *  raw stored value can be anything the user encoded. Renderers pass
 *  `Partial` because not every channel is mapped at any given time. */
export type GroupValues = Partial<
	Record<
		"hue" | "outlineHue" | "saturation" | "brightness" | "pattern" | "opacity",
		string | number | null | undefined
	>
>

export type LayerResolved = {
	/** Base fill color, after hue lookup and saturation/brightness
	 *  modulation. Always a CSS color string. */
	fill: string
	/** The hue color BEFORE sat/bri modulation — the key pattern-ink
	 *  lookups pair on (see `resolveGroupFill`'s invariant). */
	preModulationHue: string
	/** Resolved opacity in [0, 1]. */
	opacity: number
	/** SVG `<pattern>` element id when a pattern is applied, else null. */
	patternId: string | null
	/** Outline (stroke) color from the `outlineHue` channel's scale, or
	 *  `null` when no outline-color field is mapped (or the value doesn't
	 *  resolve). Callers fall back to the universal outline color. */
	outline: string | null
}

export type ResolveLayerColorArgs = {
	/** Per-channel value for the row/slice/layer being resolved. */
	groupValues: GroupValues
	/** Color to fall back to when hue isn't mapped (or maps to null). */
	defaultFill: string
	/** INERT since 2026-11-04: the pattern always tiles over the mark's own
	 *  fill (the Color menu owns it). Call sites still thread the stored
	 *  `pattern.backgroundColor` through; `patternTile` ignores it. */
	patternBgOverride: string | null
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
	/** Pattern-channel context flags (default pattern opt-in, line-chart
	 *  default-to-none). MUST match the options the renderer passes to its
	 *  defs pass (`buildPatternDefs`) or marks reference defs that were
	 *  never emitted. */
	patternOptions?: PatternDefOptions
	/** The dataset rows the mark draws (a bar slice's, a wedge's, an area
	 *  layer's) — what `{Variable}` outline-color rules test, every row
	 *  alike. Absent → those rules don't fire. */
	rows?: RuleRows
}

/** The hue → sat/bri slice of the pipeline for one set of `GroupValues`:
 *  apply the hue scale (or fall back to `defaultFill`), then modulate via
 *  saturation/brightness. Shared by `resolveLayerColor` and the pattern-defs
 *  pass (`lib/buildPatternDefs`) so the two can never drift apart — marks and
 *  their `<defs>` MUST resolve identical colors or marks reference defs that
 *  were never emitted.
 *
 *  INVARIANT: `preModulationHue` is the hue color BEFORE saturation/
 *  brightness modulation. Pattern-ink lookups match against the theme
 *  palette's exact swatch hexes, so they must key on this color — the
 *  modulated hex is never in the palette. (Per-value hue overrides also
 *  miss the ACTIVE palette; they resolve through the cross-palette
 *  `themeInkFallback` table when the picked color is a swatch of another
 *  theme palette, else fall back to the default ink.) */
export const resolveGroupFill = (
	groupValues: GroupValues,
	defaultFill: string,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	/** The mark's dataset rows, for `{Variable}` fill rules (see
	 *  `ResolveLayerColorArgs.rows`). Absent → those rules don't fire. */
	rows?: RuleRows
): {
	fill: string
	preModulationHue: string
	/** Sat/bri unit values applied to `fill` (scale value when mapped and
	 *  resolvable, else the channel's default), `null` when no modulation
	 *  applied. Exposed so
	 *  the pattern-defs pass can modulate the NO-HUE pattern background the
	 *  same way the fill is modulated — otherwise sat/bri encodings vanish
	 *  on patterned marks the moment hue is unmapped. */
	satUnit: number | null
	briUnit: number | null
} => {
	const hueG = aestheticScales.hue?.field ?? null
	const hueScale = aestheticScales.hue?.scale ?? null
	const satG = aestheticScales.saturation?.field ?? null
	const satScale = aestheticScales.saturation?.scale ?? null
	const briG = aestheticScales.brightness?.field ?? null
	const briScale = aestheticScales.brightness?.scale ?? null

	let color = defaultFill
	if (hueScale && hueG && groupValues.hue !== undefined) {
		const c = applyHueScale(hueScale, groupValues.hue, hueG.type)
		if (c) color = c
	}
	// Conditional fill rules: an implicit rule tests the Color variable's
	// value (nothing to compare while hue is unmapped — `undefined` never
	// passes), a `{Variable}` rule tests the mark's rows. A match replaces
	// the palette color before sat/bri modulation, so a rule-colored mark
	// still shades by a mapped Saturation / Brightness like its siblings.
	const fillRuleColor = resolveRuleColor(
		channelConfigs.fillColorRules,
		groupValues.hue,
		rows
	)
	if (fillRuleColor) color = fillRuleColor
	const preModulationHue = color

	// Sat/bri fallback convention (shared with the per-row sibling,
	// `resolveMarkAesthetics`): a mapped channel whose value can't resolve —
	// missing slice key, blank/NA cell, value outside the scale's domain —
	// falls back to the channel's DEFAULT level, exactly like an unmapped
	// channel. Mirrors how hue degrades to `defaultFill` (and opacity to
	// `defaultOpacity`): a scale with no answer never silently disables the
	// channel for one slice while its siblings stay modulated.
	const satUnit =
		(satScale && satG && groupValues.saturation !== undefined
			? satScale(groupValues.saturation as never)
			: null) ??
		channelConfigs.defaultSaturation ??
		null
	const briUnit =
		(briScale && briG && groupValues.brightness !== undefined
			? briScale(groupValues.brightness as never)
			: null) ??
		channelConfigs.defaultBrightness ??
		null
	if (satUnit !== null || briUnit !== null) {
		color = modulateColor(color, satUnit, briUnit)
	}
	return { fill: color, preModulationHue, satUnit, briUnit }
}

/** One mark's inputs to the pattern-def resolution, with the fill colors
 *  already resolved. Renderers with per-row pipelines (ScatterPlot) build
 *  these from `resolveMarkAesthetics`; GroupValues-based renderers go
 *  through the `buildPatternDefs` wrapper (lib/buildPatternDefs), which
 *  resolves the colors via `resolveGroupFill`. Either way the SAME
 *  resolution the marks use feeds the defs pass, so svgIds always agree. */
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
	 *  out of the palette. (Per-value hue overrides also miss the active
	 *  palette; the cross-palette `themeInkFallback` table covers colors
	 *  borrowed from other theme palettes, else the default ink applies.) */
	preModulationHue: string
	/** Sat/bri unit values applied to `fill` (from `resolveMarkAesthetics` /
	 *  `resolveGroupFill`). When hue is UNMAPPED they modulate the pattern's
	 *  background tile the same way the fill is modulated, so sat/bri
	 *  encodings stay visible on patterned marks. Omitted / null = no
	 *  modulation. */
	satUnit?: number | null
	briUnit?: number | null
}

/** The tile a pattern draws over and the color its ink pairs on: ALWAYS the
 *  mark's own fill (hue mapped or not — default fill, fill rules, sat/bri
 *  modulation), with the ink keyed on the pre-modulation color (the
 *  palette's exact swatch hex). The Pattern panel's Background swatch was
 *  removed on 2026-11-04 ("the point color is already addressed in the
 *  Color encoding"); a `backgroundColor` an older save still carries is
 *  ignored here, so such visuals follow their Color-menu fill like any
 *  other. `hueMapped` and `patternBgOverride` stay in the signature for the
 *  many call sites that thread them; both are inert. */
export const patternTile = (
	item: Pick<PatternDefItem, "fill" | "preModulationHue" | "satUnit" | "briUnit">,
	_hueMapped: boolean,
	_patternBgOverride: string | null
): { bgColor: string; inkKeyColor: string } => ({
	bgColor: item.fill,
	inkKeyColor: item.preModulationHue,
})

export type PatternDefOptions = {
	/** Line-chart context (a connection field is mapped): treat the ABSENCE
	 *  of a per-category override as "no pattern" instead of auto-cycling
	 *  the palette — marks stay clean by default; users opt in per
	 *  category via the Point-fill swatches. */
	defaultToNone?: boolean
	/** When no pattern FIELD is mapped but `channelConfigs.defaultPattern`
	 *  is set, emit the single `__default__` def each mark references. All
	 *  cartesian mark-fill renderers (scatter points, bars, areas, pies)
	 *  opt in; geo and the structure renderers (hierarchy, flows) keep
	 *  their own separately-designed pattern semantics and don't. */
	includeDefaultPattern?: boolean
}

/** Resolve the pattern `<defs>` spec (or null) for a single mark. Shared by
 *  the upfront defs passes (`buildPatternDefsFromItems` / `buildPatternDefs`
 *  in lib/buildPatternDefs), ScatterPlot's per-mark render loop, and the
 *  GroupValues renderers' `resolveLayerColor` below — one resolver for all
 *  of them guarantees marks never reference defs that were never emitted. */
export const resolvePatternDefForItem = (
	item: PatternDefItem,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	/** The Pattern panel's Background override, or `null` to tile over the
	 *  mark's own fill (see `patternTile`). */
	patternBgOverride: string | null,
	options?: PatternDefOptions
): PatternDefSpec | null => {
	const patG = aestheticScales.pattern?.field ?? null
	const patternCategories = aestheticScales.pattern?.categories ?? null
	const hueG = aestheticScales.hue?.field ?? null
	const wantsDefault =
		!!options?.includeDefaultPattern && channelConfigs.defaultPattern != null
	if (!(patternCategories && patG) && !wantsDefault) return null

	// The tile the pattern is drawn over, and the color its ink pairs on.
	// With hue mapped the tile is the mark's hue fill. Without, it is STILL
	// the mark's own fill (default fill, fill rules, sat/bri modulation) —
	// a patterned bar keeps its color — unless the Background override
	// replaces it, in which case the override modulates like the fill would.
	// Ink lookup keys on the PRE-modulation color (see
	// `PatternDefItem.preModulationHue`): the palette's exact swatch hex, or
	// the override itself. Colors the active palette doesn't know (per-value
	// overrides borrowed from another theme palette) fall back to the
	// theme-wide ink table.
	const { bgColor, inkKeyColor } = patternTile(item, hueG !== null, patternBgOverride)

	if (patternCategories && patG) {
		const raw = item.patternValue
		if (raw === undefined || raw === null || String(raw) === "") return null
		const catStr = String(raw)
		const catIdx = patternCategories.indexOf(catStr)
		if (catIdx === -1) return null
		const huePalette = inkPaletteForHue(channelConfigs, hueG?.type)
		const preferredInk = inkForHueColor(
			inkKeyColor,
			huePalette.palette,
			huePalette.inks,
			aestheticScales.themeInkFallback
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

	if (channelConfigs.defaultPattern == null) return null
	return resolveDefaultPatternForMark(
		bgColor,
		channelConfigs.defaultPattern,
		resolveDefaultPatternInk(
			channelConfigs,
			inkKeyColor,
			hueG?.type,
			aestheticScales.themeInkFallback
		),
		channelConfigs.pattern?.defaultScale,
		channelConfigs.pattern?.defaultRotation
	)
}

/** Which `PatternConfig` fields hold a fill target's SEPARATE pattern
 *  state — the radar polygon body or the violin / box body — stored beside
 *  the point fill's `overrides` / `inkColors` / `scales` / `defaultPattern`
 *  so no two targets ever share an index. */
export type FillTargetPatternKeys = {
	overrides: "polygonOverrides" | "violinOverrides" | "areaPointOverrides"
	inkColors: "polygonInkColors" | "violinInkColors" | "areaPointInkColors"
	scales: "polygonScales" | "violinScales" | "areaPointScales"
	rotations: "polygonRotations" | "violinRotations" | "areaPointRotations"
	defaultPattern: "defaultPolygonPattern" | "defaultViolinPattern" | "defaultAreaPointPattern"
	defaultInk: "defaultPolygonPatternInk"
		| "defaultViolinPatternInk"
		| "defaultAreaPointPatternInk"
	defaultScale: "defaultPolygonScale" | "defaultViolinScale" | "defaultAreaPointScale"
	defaultRotation: "defaultPolygonRotation"
		| "defaultViolinRotation"
		| "defaultAreaPointRotation"
}
export const POLYGON_PATTERN_KEYS: FillTargetPatternKeys = {
	overrides: "polygonOverrides",
	inkColors: "polygonInkColors",
	scales: "polygonScales",
	rotations: "polygonRotations",
	defaultPattern: "defaultPolygonPattern",
	defaultInk: "defaultPolygonPatternInk",
	defaultScale: "defaultPolygonScale",
	defaultRotation: "defaultPolygonRotation",
}
export const VIOLIN_PATTERN_KEYS: FillTargetPatternKeys = {
	overrides: "violinOverrides",
	inkColors: "violinInkColors",
	scales: "violinScales",
	rotations: "violinRotations",
	defaultPattern: "defaultViolinPattern",
	defaultInk: "defaultViolinPatternInk",
	defaultScale: "defaultViolinScale",
	defaultRotation: "defaultViolinRotation",
}
export const AREA_POINT_PATTERN_KEYS: FillTargetPatternKeys = {
	overrides: "areaPointOverrides",
	inkColors: "areaPointInkColors",
	scales: "areaPointScales",
	rotations: "areaPointRotations",
	defaultPattern: "defaultAreaPointPattern",
	defaultInk: "defaultAreaPointPatternInk",
	defaultScale: "defaultAreaPointScale",
	defaultRotation: "defaultAreaPointRotation",
}

type FillTargetPatternView = {
	pattern: PatternConfig
	defaultPattern: number | null
	/** Explicit target ink, else the explicit point-fill ink, else `null`
	 *  — the palette-paired / theme ink (`resolveDefaultPatternInk`). */
	defaultPatternInk: string | null
}

/** Channel configs re-pointed at one fill target's pattern state so the
 *  ordinary per-mark resolver reads that target's separate picks in place
 *  of the point-fill ones. Palettes, background, and sat/bri stay shared. */
const fillTargetPatternView = (
	configs: Partial<Pick<ChannelConfigs, "pattern" | "defaultPatternInk">>,
	keys: FillTargetPatternKeys
): FillTargetPatternView => {
	const pat = configs.pattern
	return {
		pattern: {
			...DEFAULT_PATTERN_CONFIG,
			...pat,
			overrides: pat?.[keys.overrides] ?? {},
			inkColors: pat?.[keys.inkColors] ?? {},
			scales: pat?.[keys.scales] ?? {},
			defaultScale: pat?.[keys.defaultScale] ?? null,
			rotations: pat?.[keys.rotations] ?? {},
			defaultRotation: pat?.[keys.defaultRotation] ?? null,
		},
		defaultPattern: pat?.[keys.defaultPattern] ?? null,
		defaultPatternInk:
			pat?.[keys.defaultInk] ?? configs.defaultPatternInk ?? null,
	}
}

/** The RADAR POLYGON FILL view (`PatternConfig.polygonOverrides` /
 *  `polygonInkColors` / `polygonScales` / `defaultPolygonPattern` /
 *  `defaultPolygonPatternInk` / `defaultPolygonScale`). The legend uses it
 *  directly, since its swatch renderers hold only a partial configs
 *  object. */
export const polygonPatternView = (
	configs: Partial<Pick<ChannelConfigs, "pattern" | "defaultPatternInk">>
): FillTargetPatternView => fillTargetPatternView(configs, POLYGON_PATTERN_KEYS)

/** The VIOLIN / BOX FILL view (`PatternConfig.violinOverrides` et al.). */
export const violinPatternView = (
	configs: Partial<Pick<ChannelConfigs, "pattern" | "defaultPatternInk">>
): FillTargetPatternView => fillTargetPatternView(configs, VIOLIN_PATTERN_KEYS)

/** Resolve the `<pattern>` def (or null) for a fill target's body with the
 *  re-pointed configs. Semantics mirror point fills in line-chart context:
 *  with a pattern variable mapped, a category renders NO pattern until the
 *  user picks a swatch for it; with none mapped, the target's default
 *  pattern fills every body. */
const resolveFillTargetPatternDef = (
	item: PatternDefItem,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	patternBgOverride: string | null,
	keys: FillTargetPatternKeys
): PatternDefSpec | null =>
	resolvePatternDefForItem(
		item,
		aestheticScales,
		{ ...channelConfigs, ...fillTargetPatternView(channelConfigs, keys) },
		patternBgOverride,
		{ defaultToNone: true, includeDefaultPattern: true }
	)

/** The def for a radar series POLYGON body. The polygon fill has its own
 *  pattern pick, separate from the points' (the Pattern menu's "Polygon
 *  fill" vs "Point fill" subsections), so the same series can carry, say,
 *  a hatched body under plain dots. Callers gate on
 *  `connection.fillPolygon` — an unfilled polygon has no body to pattern. */
export const resolvePolygonPatternDef = (
	item: PatternDefItem,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	patternBgOverride: string | null
): PatternDefSpec | null =>
	resolveFillTargetPatternDef(
		item,
		aestheticScales,
		channelConfigs,
		patternBgOverride,
		POLYGON_PATTERN_KEYS
	)

/** The def for a VIOLIN / BOX body (the Pattern menu's "Violin / box fill"
 *  subsection). Callers gate on an active overlay (`overlayOn`). */
export const resolveViolinPatternDef = (
	item: PatternDefItem,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	patternBgOverride: string | null
): PatternDefSpec | null =>
	resolveFillTargetPatternDef(
		item,
		aestheticScales,
		channelConfigs,
		patternBgOverride,
		VIOLIN_PATTERN_KEYS
	)

/** The def for an AREA-CHART POINT marker (the Pattern menu's "Point
 *  fill" subsection on area charts), tiled over the point's own fill —
 *  separate from the area body's pattern. Callers gate on the points
 *  drawing (`areaPointsOn`). */
export const resolveAreaPointPatternDef = (
	item: PatternDefItem,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	patternBgOverride: string | null
): PatternDefSpec | null =>
	resolveFillTargetPatternDef(
		item,
		aestheticScales,
		channelConfigs,
		patternBgOverride,
		AREA_POINT_PATTERN_KEYS
	)

/** Single source of truth for "what color does this slice/layer/row draw
 *  with?" Every aggregating chart renderer (BarPlot, AreaPlot, PiePlot,
 *  ScatterPlot's marks) used to inline this pipeline; small drifts
 *  between them (e.g. saturation precedence with an unmapped sat
 *  channel, pattern-ink fallback when hue is mapped vs unmapped) caused
 *  silent bugs. Centralizing here keeps every renderer consistent.
 *
 *  Pipeline:
 *    1. **Hue** — apply the hue scale to `groupValues.hue` if mapped;
 *       otherwise use `defaultFill`.
 *    2. **Saturation / brightness** — modulate the color via HSL,
 *       sourcing the unit value from the per-row scale when the channel
 *       is mapped and the value resolves, or from
 *       `channelConfigs.defaultSaturation` / `defaultBrightness`
 *       otherwise (unmapped OR mapped-but-unresolvable).
 *    3. **Pattern** — if a pattern channel is mapped AND the row's
 *       pattern value is one of the discovered categories, resolve a
 *       `<pattern>` element id (honoring `patternOptions.defaultToNone`);
 *       with no pattern field but `defaultPattern` configured (and the
 *       renderer opted in via `patternOptions.includeDefaultPattern`),
 *       resolve the `__default__` def instead. The tile sits on the mark's
 *       fill (or the Background override when hue is unmapped) and the ink
 *       pairs on the pre-modulation color (see `patternTile`).
 *    4. **Opacity** — same precedence as sat/bri: scale value if mapped
 *       and resolvable, the channel's `defaultOpacity` otherwise. */
export const resolveLayerColor = ({
	groupValues,
	defaultFill,
	patternBgOverride,
	aestheticScales,
	channelConfigs,
	patternOptions,
	rows,
}: ResolveLayerColorArgs): LayerResolved => {
	const outlineG = aestheticScales.outlineHue?.field ?? null
	const outlineScale = aestheticScales.outlineHue?.scale ?? null
	const opG = aestheticScales.opacity?.field ?? null
	const opacityScale = aestheticScales.opacity?.scale ?? null

	// Hue → sat/bri modulation, with the pre-modulation hue color captured
	// for the pattern-ink lookup below (see `resolveGroupFill`'s invariant).
	const {
		fill: color,
		preModulationHue: paletteHueColor,
		satUnit,
		briUnit,
	} = resolveGroupFill(
		groupValues,
		defaultFill,
		aestheticScales,
		channelConfigs,
		rows
	)

	// Same per-item resolver the upfront defs passes use, so a mark's svgId
	// always references an emitted def (pattern ink keyed on the
	// PRE-modulation hue color — see `PatternDefItem.preModulationHue`).
	const patternDef = resolvePatternDefForItem(
		{
			patternValue: groupValues.pattern,
			fill: color,
			preModulationHue: paletteHueColor,
			satUnit,
			briUnit,
		},
		aestheticScales,
		channelConfigs,
		patternBgOverride,
		patternOptions
	)
	const patternId = patternDef?.svgId ?? null

	// Mapped-but-unresolvable rows fall back to the channel's default level
	// — the same convention hue (defaultFill) and sat/bri (defaultSaturation
	// / defaultBrightness) follow, shared with `resolveMarkAesthetics`.
	const opacity =
		(opacityScale && opG && groupValues.opacity !== undefined
			? opacityScale(groupValues.opacity as never)
			: null) ??
		channelConfigs.defaultOpacity ??
		1

	let outline: string | null = null
	if (outlineScale && outlineG && groupValues.outlineHue !== undefined) {
		outline = applyHueScale(outlineScale, groupValues.outlineHue, outlineG.type)
	}
	// Conditional outline rules override the scale color when one matches
	// (per-category stroke overrides, handled by callers, still win on top).
	// An implicit rule tests the mapped outline variable's value — nothing
	// to compare while it's unmapped — but a `{Variable}` rule tests the
	// mark's rows and fires either way, so "outline red when {Profit} < 0"
	// works on a chart with no Outline variable.
	const outlineRuleColor = resolveRuleColor(
		channelConfigs.shape?.outlineColorRules,
		groupValues.outlineHue,
		rows
	)
	if (outlineRuleColor) outline = outlineRuleColor

	return {
		fill: color,
		preModulationHue: paletteHueColor,
		opacity,
		patternId,
		outline,
	}
}

/** Convenience: turn a `LayerResolved` into the SVG `fill` attribute
 *  value. When a pattern is active, `fill` becomes a `url(#id)`
 *  reference; otherwise it's the base color directly. */
export const layerFillProp = (resolved: LayerResolved): string =>
	resolved.patternId === null ? resolved.fill : `url(#${resolved.patternId})`

/** Resolve a single color-slot target (line / rug / violin / stem / spine) for
 *  one row. A matching conditional rule (`slotCfg.colorRules`) wins first —
 *  an implicit rule tests the slot's mapped field value, a `{Variable}` rule
 *  tests `rows` (every row of a multi-row mark such as a connection line;
 *  defaults to the one `row`). Then, when the slot maps a field, run the
 *  slot's scale over the row's value (mirrors the outline branch of
 *  `resolveLayerColor`); otherwise use the slot's single color, and finally
 *  the supplied legacy fallback when the slot isn't configured at all (so
 *  visuals saved before color slots existed keep their previous per-feature
 *  color). */
export const resolveSlotColor = (
	slot: AestheticScales["colorSlots"][ColorSlotKey],
	slotCfg: ColorSlotConfig | undefined,
	row: Record<string, unknown>,
	fallback: string,
	rows?: RuleRows
): string => {
	const mapped = slot && slotCfg?.field ? slot : null
	const ruleColor = resolveRuleColor(
		slotCfg?.colorRules,
		mapped ? row[mapped.field.name] : undefined,
		rows ?? [row]
	)
	if (ruleColor) return ruleColor
	if (mapped) {
		const c = applyHueScale(mapped.scale, row[mapped.field.name], mapped.field.type)
		if (c) return c
	}
	return slotCfg?.singleColor ?? fallback
}

/** Resolve a single opacity-slot target (border / rug / line / violin / stem /
 *  spine) for one row. When the slot maps a field, run the slot's opacity scale
 *  over the row's value (mirrors `resolveSlotColor`); otherwise use the slot's
 *  static `level`, and finally the supplied fallback (the slot's registry
 *  `defaultLevel`) when the slot isn't configured at all. */
export const resolveSlotOpacity = (
	slot: AestheticScales["opacitySlots"][OpacitySlotKey],
	slotCfg: OpacitySlotConfig | undefined,
	row: Record<string, unknown>,
	fallback: number
): number => {
	if (slot && slotCfg?.field) {
		const v = slot.scale(row[slot.field.name] as never)
		if (v != null) return v
	}
	return slotCfg?.level ?? fallback
}

/** Build a per-row opacity resolver for one slot key. Captures the slot's
 *  config, its (optional) field scale, and its registry `defaultLevel`, and
 *  returns `(row) => opacity`. Renderers call the returned fn per mark; for
 *  group-level parts with no field mapping, call it with `{}` to get the
 *  static level. Keeps the lookup boilerplate out of every renderer. */
export const slotOpacityResolver = (
	key: OpacitySlotKey,
	channelConfigs: ChannelConfigs,
	aestheticScales: AestheticScales
): ((row: Record<string, unknown>) => number) => {
	const slotCfg = channelConfigs.opacitySlots?.[key]
	const slot = aestheticScales.opacitySlots[key] ?? null
	const fallback = OPACITY_SLOT_DEFS[key].defaultLevel
	return (row) => resolveSlotOpacity(slot, slotCfg, row, fallback)
}

/** One part's saturation or brightness level for a row: the slot's field
 *  scale when mapped and resolvable, else its static `level`, else `null`
 *  (no modulation — the slot's untouched state). Mirrors `resolveSlotOpacity`. */
const resolveSlotModulation = (
	slot: { scale: UnitScale; field: { name: string } } | null | undefined,
	slotCfg: ModulationSlotConfig | undefined,
	row: Record<string, unknown>
): number | null => {
	if (slot && slotCfg?.field) {
		const v = slot.scale(row[slot.field.name] as never)
		if (v != null) return v
	}
	return slotCfg?.level ?? null
}

/** Build a per-row color modulator for one mark part (outline / line) from
 *  its Saturation and Brightness slots. Returns `(color, row) => color`;
 *  identity when neither slot is set, so untouched charts render unchanged.
 *  `"none"` (a hollow override) passes through. */
export const slotModulationResolver = (
	key: ModulationSlotKey,
	channelConfigs: ChannelConfigs,
	aestheticScales: AestheticScales
): ((color: string, row: Record<string, unknown>) => string) => {
	const units = slotModulationUnitsResolver(key, channelConfigs, aestheticScales)
	if (!units) return (color) => color
	return (color, row) => {
		if (color === "none") return color
		const { sat, bri } = units(row)
		return sat === null && bri === null ? color : modulateColor(color, sat, bri)
	}
}

/** The per-row saturation / brightness UNIT levels for one mark part, or
 *  `null` when neither slot is set (the part is untouched). The color form
 *  above wraps this; callers that also tile a pattern over the part (the
 *  violin / box body) need the units themselves, so the tile modulates like
 *  the fill (`PatternDefItem.satUnit` / `briUnit`). */
export const slotModulationUnitsResolver = (
	key: ModulationSlotKey,
	channelConfigs: ChannelConfigs,
	aestheticScales: AestheticScales
): ((row: Record<string, unknown>) => {
	sat: number | null
	bri: number | null
}) | null => {
	const satCfg = channelConfigs.saturationSlots?.[key]
	const briCfg = channelConfigs.brightnessSlots?.[key]
	if (!modulationSlotEdited(satCfg) && !modulationSlotEdited(briCfg)) return null
	const satSlot = aestheticScales.saturationSlots?.[key]
	const briSlot = aestheticScales.brightnessSlots?.[key]
	return (row) => ({
		sat: resolveSlotModulation(satSlot, satCfg, row),
		bri: resolveSlotModulation(briSlot, briCfg, row),
	})
}
