import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	type ChannelConfigs,
	type ColorSlotConfig,
	type ColorSlotKey,
	type ColorSlots,
} from "./channelConfig"
import { COLOR_SLOT_DEFS, densityCurveFillOn, legacySlotColor } from "./colorSlots"
import { CATEGORICAL_HUE_PALETTE } from "./scales"
import { seedColorSlot } from "./seedColorSlot"
import { resolveCategoricalPalette } from "./themeConfig"
import type { Encodings, FieldType, Theme } from "./types"

/** Color slots whose UNTOUCHED state varies by the Color variable instead of
 * drawing one color. Fills seed the theme's FILL palette (pale bodies under
 * the marks); the violin / box outline seeds the Color mapping's own
 * palette, so it draws in the marks' colors. With no Color variable, the
 * fills take the fill-palette color analogous to the marks' single color. */
export const COLOR_FOLLOWING_SLOTS = [
	"violinFill",
	"violinStroke",
	"densityCurveFill",
] as const satisfies readonly ColorSlotKey[]

export type ColorFollowingSlot = (typeof COLOR_FOLLOWING_SLOTS)[number]

export const isColorFollowingSlot = (key: ColorSlotKey): key is ColorFollowingSlot =>
	(COLOR_FOLLOWING_SLOTS as readonly ColorSlotKey[]).includes(key)

/** The category field of each ACTIVE violin / box overlay: the field on the
 * axis opposite the overlay's value axis ("" for the single-variable shape,
 * which has no categories). */
const overlayCategoryFields = (
	encodings: Pick<Encodings, "x" | "y">,
	configs: ChannelConfigs
): string[] => {
	const out: string[] = []
	for (const valueAxis of ["x", "y"] as const) {
		const ov = configs[valueAxis]?.distributionOverlay
		if (!ov || (!ov.showDensityViolin && !ov.showBoxPlot)) continue
		const other = valueAxis === "x" ? encodings.y : encodings.x
		out.push(other?.field ?? "")
	}
	return out
}

const norm = (c: string): string => c.trim().toLowerCase()

/** The fill palette's entry ANALOGOUS to the marks' single color: with no
 * Color variable the marks draw `defaultFill`, and when that color is an
 * entry of the categorical palette (the visual's, else the theme default),
 * a body fills with the theme fill palette's entry at the same position — a
 * pale version of its marks. `null` when the theme sets no fill palette or
 * the color isn't a palette entry. */
const analogousFillColor = (configs: ChannelConfigs, theme: Theme): string | null => {
	const fillPal = theme.defaultFillPaletteId
		? theme.categoricalPalettes.find((p) => p.id === theme.defaultFillPaletteId)
		: undefined
	if (!fillPal || fillPal.colors.length === 0) return null
	const markColor = norm(configs.defaultFill ?? theme.defaultFill)
	for (const pal of [configs.categoricalPalette, resolveCategoricalPalette(theme).colors]) {
		const pos = pal?.findIndex((c) => norm(c) === markColor) ?? -1
		if (pos >= 0) return fillPal.colors[pos % fillPal.colors.length] ?? null
	}
	return null
}

/** What an UNCONFIGURED color-following slot draws: "Vary by" the Color
 * variable, with the palette its kind seeds; with NO Color variable, a fill
 * slot's single color analogous to the marks' (`analogousFillColor`); else
 * `undefined`, drawing its usual single color. Pure — the renderer (via `withColorSlotDefaults`),
 * the aesthetic scales and the Color panel all read it, so what the panel
 * shows is what draws.
 *
 * Follows Color only when Color maps a DISCRETE variable the body can key by:
 *  - violin / box: the overlay's category variable (a body is one category;
 *    any other variable can vary inside it, so it falls back to one color).
 *  - density-curve fill: any discrete Color variable, which splits the curve
 *    into one filled KDE per value — only while "Fill under curve" is on. */
export const defaultColorSlot = (
	key: ColorSlotKey,
	encodings: Pick<Encodings, "hue" | "x" | "y">,
	configs: ChannelConfigs,
	hueType: FieldType | null,
	theme: Theme
): ColorSlotConfig | undefined => {
	if (!isColorFollowingSlot(key)) return undefined
	if (key === "densityCurveFill" && !densityCurveFillOn(configs)) return undefined
	const hueField = encodings.hue?.field ?? null
	if (!hueField) {
		if (key === "violinStroke") return undefined
		const analogous = analogousFillColor(configs, theme)
		return analogous ? { field: null, singleColor: analogous } : undefined
	}
	if (hueType !== "categorical" && hueType !== "ordinal") return undefined
	if (
		key !== "densityCurveFill" &&
		!overlayCategoryFields(encodings, configs).includes(hueField)
	) {
		return undefined
	}
	const singleColor =
		legacySlotColor(key, configs) ?? COLOR_SLOT_DEFS[key].themeColor(theme)
	if (key === "violinStroke") {
		// The outline keeps the Color mapping's OWN palette (the visual's pick,
		// not the theme default), so it draws exactly in the marks' colors.
		const ordinal = hueType === "ordinal"
		const palette =
			(ordinal ? configs.ordinalPalette : undefined) ??
			configs.categoricalPalette ??
			CATEGORICAL_HUE_PALETTE
		return {
			field: hueField,
			singleColor,
			hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
			paletteId:
				(ordinal ? configs.ordinalPaletteId : undefined) ??
				configs.categoricalPaletteId ??
				null,
			palette: [...palette],
		}
	}
	return {
		singleColor,
		...seedColorSlot(hueField, hueType, theme, "fill"),
		field: hueField,
	}
}

/** True when a stored slot says no more than its default — an edit that
 * landed back on the default (a Reset, a swatch put back). The panel then
 * deletes it, so the slot keeps tracking the live default. */
export const isDefaultColorSlot = (
	cfg: ColorSlotConfig,
	dflt: ColorSlotConfig | undefined
): boolean => {
	if (!dflt || cfg.field !== dflt.field) return false
	if ((cfg.colorRules?.length ?? 0) > 0) return false
	if (cfg.field === null) return cfg.singleColor === dflt.singleColor
	const overrides = cfg.hue?.kind === "categorical" ? cfg.hue.colors : {}
	return (
		cfg.hue?.kind !== "quantitative" &&
		Object.keys(overrides).length === 0 &&
		(cfg.paletteId ?? null) === (dflt.paletteId ?? null)
	)
}

/** RENDER-side configs with every unconfigured color-following slot filled
 * in with its `defaultColorSlot`. Never persisted: the stored slot stays
 * absent, so the default keeps tracking the Color variable and the theme's
 * fill palette. A stored slot (any explicit pick) always wins. */
export const withColorSlotDefaults = (
	configs: ChannelConfigs,
	encodings: Pick<Encodings, "hue" | "x" | "y">,
	hueType: FieldType | null,
	theme: Theme
): ChannelConfigs => {
	let slots: ColorSlots | null = null
	for (const key of COLOR_FOLLOWING_SLOTS) {
		if (configs.colorSlots?.[key]) continue
		const dflt = defaultColorSlot(key, encodings, configs, hueType, theme)
		if (!dflt) continue
		slots ??= { ...configs.colorSlots }
		slots[key] = dflt
	}
	return slots ? { ...configs, colorSlots: slots } : configs
}
