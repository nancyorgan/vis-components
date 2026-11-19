import type {
	ChannelConfigs,
	ColorSlotConfig,
	ColorSlotKey,
} from "./channelConfig"
import { chartModeDefById, type ChartMode } from "./chartMode"
import {
	menuTargets,
	type ColorFacet,
	type TargetContext,
	type TargetPart,
} from "./partTargets"
import { CATEGORICAL_HUE_PALETTE } from "./scales"
import type { Encodings, Theme } from "./types"

// The label and the "is this part drawn?" gates live with the table; they
// are re-exported here, where the renderers and panels have always read them.
export {
	FOLLOW_LABEL,
	densityCurveFillOn,
	densityCurveOn,
} from "./partTargets"

/** One color target: the Color menu's view of a row of `PART_TARGETS`
 * (lib/partTargets) — its label, the part it styles, when the chart draws
 * that part, the theme color it defaults to, and whether it supports mapping
 * a variable. */
export type ColorSlotDef = ColorFacet & {
	key: ColorSlotKey
	label: string
	/** The part the target styles. */
	part: TargetPart
	/** The chart draws that part: the mode declares it and the feature that
	 * switches it on is on (overlay on, histogram on, stem on, …). */
	drawn: (ctx: TargetContext) => boolean
	/** `drawn`, for a caller that holds the mode's id. */
	isApplicable: (
		encodings: Encodings,
		configs: ChannelConfigs,
		mode: ChartMode
	) => boolean
}

/** The field a density curve is grouped (split) by — whichever field is mapped
 * to the curve's outline or fill color slot (outline wins if both are set).
 * `null` = a single aggregate curve. Both render paths and the legend read this
 * so grouping, coloring, and the legend agree. */
export const densityCurveGroupField = (configs: ChannelConfigs): string | null =>
	configs.colorSlots?.densityCurveStroke?.field ??
	configs.colorSlots?.densityCurveFill?.field ??
	null

/** Every color target, in the table's order. Fill and Outline are NOT here —
 * they keep their own storage (`hue` / `outlineHue`) and are rendered by
 * the Color panel via adapters. */
export const COLOR_SLOT_REGISTRY: readonly ColorSlotDef[] = menuTargets("color").map(
	({ key, label, part, drawn, facet }) => ({
		...facet,
		key: key as ColorSlotKey,
		label,
		part,
		drawn,
		isApplicable: (encodings, configs, mode) =>
			drawn({ canvas: chartModeDefById(mode).canvas, encodings, configs }),
	})
)

export const COLOR_SLOT_DEFS: Record<ColorSlotKey, ColorSlotDef> = Object.fromEntries(
	COLOR_SLOT_REGISTRY.map((d) => [d.key, d])
) as Record<ColorSlotKey, ColorSlotDef>

/** The legacy single-color a slot superseded, read off the old per-feature
 * config field. Used to seed the slot control's single-color swatch so the
 * Color panel reflects a saved visual's color before the user touches it
 * (rendering still uses the legacy field until the slot is created). */
export const legacySlotColor = (
	key: ColorSlotKey,
	configs: ChannelConfigs
): string | undefined => {
	const overlay = configs.x?.distributionOverlay ?? configs.y?.distributionOverlay
	const histogram = configs.x?.histogram ?? configs.y?.histogram
	const connection = configs.connection
	switch (key) {
		case "rug":
			return histogram?.rugColor
		case "violinStroke":
			return overlay?.color
		case "violinFill":
			return overlay?.fillColor
		case "densityCurveFill":
		case "densityCurveStroke":
		case "stem":
		case "comboPointFill":
		case "polygonFill":
		case "areaPointFill":
			// No legacy per-feature color field to seed from; the slot's
			// theme-seeded singleColor is the source of truth.
			return undefined
		case "line":
			return connection?.strokeColor ?? undefined
		case "regressionStroke":
			return configs.x?.regression?.color
		case "regressionCiFill":
			return configs.x?.regression?.ciFillColor
	}
}

const sameValue = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
		return a.every((x, i) => sameValue(x, b[i]))
	}
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
	const ka = Object.keys(a)
	const rb = b as Record<string, unknown>
	return (
		ka.length === Object.keys(b).length &&
		ka.every((k) => sameValue((a as Record<string, unknown>)[k], rb[k]))
	)
}

/** A Line slot that says no more than "vary by the Color variable, on the
 * Color mapping's own palette or gradient": what mapping Color on a line
 * chart seeds (`lib/lineFollowsColor.ts`), so it reads as untouched. A
 * per-value color, a rule, or another palette is an edit. */
export const lineSlotFollowsHue = (
	slot: ColorSlotConfig,
	configs: ChannelConfigs,
	hueField: string | null
): boolean => {
	if (!hueField || slot.field !== hueField) return false
	if ((slot.colorRules?.length ?? 0) > 0) return false
	const hue = slot.hue
	if (hue?.kind === "quantitative")
		return configs.hue?.kind === "quantitative" && sameValue(hue, configs.hue)
	if (hue && Object.keys(hue.colors ?? {}).length > 0) return false
	const palette = slot.palette
	if (!palette) return false
	// With no palette stored, the Color mapping draws the hue scale's
	// built-in palette, which is what a follow-seeded line took.
	return [
		configs.categoricalPalette ?? CATEGORICAL_HUE_PALETTE,
		configs.ordinalPalette,
	].some((p) => !!p && sameValue(p, palette))
}

/** This slot deviates from its untouched state: a field mapped, a palette
 * picked, or its single color moved off the slot's default (the legacy
 * per-feature color, else the theme color). A slot OBJECT merely existing is
 * NOT an edit — the panel writes a well-formed `{field: null, singleColor:
 * default}` on any touch (a reset included), so presence alone must not count.
 * The single source for both the panel's subsection dot and the encoding row's
 * channel dot, so the two can't drift. */
export const colorSlotEdited = (
	key: ColorSlotKey,
	slotCfg: ColorSlotConfig | undefined,
	configs: ChannelConfigs,
	theme: Theme,
	/** The Color (hue) variable, when the caller knows it: a Line slot that
	 *  only follows it (`lineSlotFollowsHue`) is what mapping Color on a line
	 *  chart seeds, not an edit. */
	hueField?: string | null
): boolean => {
	if (!slotCfg) return false
	if (key === "line" && lineSlotFollowsHue(slotCfg, configs, hueField ?? null)) return false
	// An inherit-capable slot's untouched state is "Automatic" (no stored
	// config; renderers follow the Color mapping). There the panel stores a
	// config only on an explicit choice — "Single color" or a field — and
	// picking Automatic deletes it, so presence IS the edit.
	if (COLOR_SLOT_DEFS[key]?.inherit) return true
	if (slotCfg.field != null || slotCfg.paletteId != null) return true
	// A conditional color rule is an edit; an emptied list (every rule
	// removed) is not.
	if ((slotCfg.colorRules?.length ?? 0) > 0) return true
	if (slotCfg.singleColor == null) return false
	// A stray key with no registry entry renders nowhere (nothing to clear), so
	// it never dots.
	const defaultColor =
		legacySlotColor(key, configs) ?? COLOR_SLOT_DEFS[key]?.themeColor(theme)
	return defaultColor != null && slotCfg.singleColor !== defaultColor
}

/** The color targets a chart offers: those whose part it draws. */
export const colorSlotsFor = (ctx: TargetContext): ColorSlotDef[] =>
	COLOR_SLOT_REGISTRY.filter((d) => d.drawn(ctx))

/** `colorSlotsFor`, for a caller that holds the mode's id. */
export const applicableColorSlots = (
	mode: ChartMode,
	encodings: Encodings,
	configs: ChannelConfigs
): ColorSlotDef[] =>
	colorSlotsFor({ canvas: chartModeDefById(mode).canvas, encodings, configs })
