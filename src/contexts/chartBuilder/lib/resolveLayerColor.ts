import type { AestheticScales } from "../store/useAestheticScales"

import type {
	ChannelConfigs,
	ColorSlotConfig,
	ColorSlotKey,
	OpacitySlotConfig,
	OpacitySlotKey,
} from "./channelConfig"
import {
	inkForHueColor,
	inkPaletteForHue,
	resolvePatternForMark,
} from "./patterns"
import { OPACITY_SLOT_DEFS } from "./opacitySlots"
import { applyHueScale, modulateColor } from "./scales"
import { resolveRuleColor } from "./textColorRules"

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
	/** Background color used to pick a pattern ink when hue is unmapped
	 *  (the pattern's foreground needs contrast against *some* color
	 *  even when hue isn't carrying meaning). */
	patternBgFallback: string
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
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
 *  modulated hex is never in the palette (per-value hue overrides likewise
 *  miss the palette and fall back to the default ink). */
export const resolveGroupFill = (
	groupValues: GroupValues,
	defaultFill: string,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): {
	fill: string
	preModulationHue: string
	/** Sat/bri unit values applied to `fill` (scale value when mapped, else
	 *  the channel's default), `null` when no modulation applied. Exposed so
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
	const preModulationHue = color

	const satUnit =
		satScale && satG && groupValues.saturation !== undefined
			? satScale(groupValues.saturation as never)
			: (channelConfigs.defaultSaturation ?? null)
	const briUnit =
		briScale && briG && groupValues.brightness !== undefined
			? briScale(groupValues.brightness as never)
			: (channelConfigs.defaultBrightness ?? null)
	if (satUnit !== null || briUnit !== null) {
		color = modulateColor(color, satUnit, briUnit)
	}
	return { fill: color, preModulationHue, satUnit, briUnit }
}

/** The background tile color for a pattern when hue does NOT drive the
 *  fill: the Pattern panel's background (or the historical gray fallback),
 *  modulated by the SAME sat/bri units the fill used. One rule everywhere —
 *  "the pattern background modulates exactly like the fill" — so mapping
 *  saturation/brightness alongside pattern stays visible on the marks (and
 *  the legend mirrors this). The pattern-INK lookup deliberately keeps
 *  keying on the un-modulated background (palette-ink invariant). */
export const modulatedPatternBg = (
	patternBgFallback: string,
	satUnit: number | null,
	briUnit: number | null
): string =>
	satUnit !== null || briUnit !== null
		? modulateColor(patternBgFallback, satUnit, briUnit)
		: patternBgFallback

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
 *       is mapped or from `channelConfigs.defaultSaturation` /
 *       `defaultBrightness` when it's not.
 *    3. **Pattern** — if a pattern channel is mapped AND the row's
 *       pattern value is one of the discovered categories, resolve a
 *       `<pattern>` element id. The pattern's ink color is derived
 *       from the (modulated) fill or the `patternBgFallback`.
 *    4. **Opacity** — same precedence as sat/bri: scale value if
 *       mapped, default otherwise. */
export const resolveLayerColor = ({
	groupValues,
	defaultFill,
	patternBgFallback,
	aestheticScales,
	channelConfigs,
}: ResolveLayerColorArgs): LayerResolved => {
	const hueG = aestheticScales.hue?.field ?? null
	const outlineG = aestheticScales.outlineHue?.field ?? null
	const outlineScale = aestheticScales.outlineHue?.scale ?? null
	const patG = aestheticScales.pattern?.field ?? null
	const opG = aestheticScales.opacity?.field ?? null
	const opacityScale = aestheticScales.opacity?.scale ?? null
	const patternCategories = aestheticScales.pattern?.categories ?? null

	// Hue → sat/bri modulation, with the pre-modulation hue color captured
	// for the pattern-ink lookup below (see `resolveGroupFill`'s invariant).
	const {
		fill: color,
		preModulationHue: paletteHueColor,
		satUnit,
		briUnit,
	} = resolveGroupFill(groupValues, defaultFill, aestheticScales, channelConfigs)

	let patternId: string | null = null
	if (patternCategories && patG && groupValues.pattern !== undefined) {
		const catStr = String(groupValues.pattern)
		const catIdx = patternCategories.indexOf(catStr)
		if (catIdx !== -1) {
			const bgColor = hueG
				? color
				: modulatedPatternBg(patternBgFallback, satUnit, briUnit)
			const huePalette = inkPaletteForHue(channelConfigs, hueG?.type)
			const preferredInk = inkForHueColor(
				hueG ? paletteHueColor : patternBgFallback,
				huePalette.palette,
				huePalette.inks
			)
			const resolved = resolvePatternForMark(
				catStr,
				catIdx,
				bgColor,
				channelConfigs.pattern,
				preferredInk
			)
			if (resolved !== null) patternId = resolved.svgId
		}
	}

	const opacity =
		opacityScale && opG && groupValues.opacity !== undefined
			? (opacityScale(groupValues.opacity as never) ?? 1)
			: (channelConfigs.defaultOpacity ?? 1)

	let outline: string | null = null
	if (outlineScale && outlineG && groupValues.outlineHue !== undefined) {
		outline = applyHueScale(outlineScale, groupValues.outlineHue, outlineG.type)
		// Conditional outline rules test the mapped outline variable's value
		// and override the scale color when one matches (per-category stroke
		// overrides, handled by callers, still win on top). Gated on the
		// outline field being mapped — rules have nothing to compare against
		// otherwise.
		const ruleColor = resolveRuleColor(
			channelConfigs.shape?.outlineColorRules,
			groupValues.outlineHue
		)
		if (ruleColor) outline = ruleColor
	}

	return { fill: color, opacity, patternId, outline }
}

/** Convenience: turn a `LayerResolved` into the SVG `fill` attribute
 *  value. When a pattern is active, `fill` becomes a `url(#id)`
 *  reference; otherwise it's the base color directly. */
export const layerFillProp = (resolved: LayerResolved): string =>
	resolved.patternId === null ? resolved.fill : `url(#${resolved.patternId})`

/** Resolve a single color-slot target (line / rug / violin / stem / spine) for
 *  one row. When the slot maps a field, run the slot's scale over the row's
 *  value (mirrors the outline branch of `resolveLayerColor`); otherwise use the
 *  slot's single color, and finally the supplied legacy fallback when the slot
 *  isn't configured at all (so visuals saved before color slots existed keep
 *  their previous per-feature color). */
export const resolveSlotColor = (
	slot: AestheticScales["colorSlots"][ColorSlotKey],
	slotCfg: ColorSlotConfig | undefined,
	row: Record<string, unknown>,
	fallback: string
): string => {
	if (slot && slotCfg?.field) {
		const c = applyHueScale(slot.scale, row[slot.field.name], slot.field.type)
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
