import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	type ChannelConfigs,
	type ColorSlotConfig,
	type ColorSlotKey,
	type ColorSlots,
} from "./channelConfig"
import type { ChartModeDef } from "./chartModes/types"
import { COLOR_SLOT_DEFS, densityCurveFillOn, legacySlotColor } from "./colorSlots"
import { CATEGORICAL_HUE_PALETTE } from "./scales"
import { seedColorSlot } from "./seedColorSlot"
import { areaFillPalette, resolveCategoricalPalette } from "./themeConfig"
import type { Encodings, FieldType, Theme } from "./types"

/** Color slots whose UNTOUCHED state varies by the Color variable instead of
 * drawing one color. Fills seed the theme's FILL palette (pale bodies under
 * the marks); the violin / box outline seeds the Color mapping's own
 * palette, so it draws in the marks' colors. With no Color variable, the
 * fills take the fill-palette color analogous to the marks' single color.
 *
 * The rule behind the fills: **a body under a line or under points, left
 * on Auto, takes the theme's fill palette** — a violin / box, a density
 * curve's fill, a radar polygon, a confidence band (and a filled area,
 * whose fill is the Color mapping itself: `withAreaPaletteDefaults`). */
export const COLOR_FOLLOWING_SLOTS = [
	"violinFill",
	"violinStroke",
	"densityCurveFill",
	"polygonFill",
	"regressionCiFill",
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

/** The fill an area chart's body takes on Auto when nothing is on Color:
 * the theme fill palette's twin of the series' color — the pale body under
 * a line that areas colored by a variable already get (their Color palette
 * is the fill palette, their Line palette the marks': `withAreaPaletteDefaults`).
 *
 * "On Auto" means the Area fill color is still the theme's (`defaultFill`
 * is seeded from the theme; a color the user picked is theirs and draws as
 * picked). `null` when the rule does not apply: not an area chart, the
 * area is not filled, a variable is on Color, the fill was picked, or the
 * theme has no fill-palette twin for the color. */
export const areaBodyAutoFill = (
	modeDef: Pick<ChartModeDef, "canvas">,
	encodings: Pick<Encodings, "hue">,
	configs: ChannelConfigs,
	theme: Theme
): string | null => {
	if (modeDef.canvas.connectionRole !== "layer") return null
	if ((configs.connection?.fill ?? DEFAULT_CONNECTION_CONFIG.fill) !== "area") return null
	if (encodings.hue?.field) return null
	if (norm(configs.defaultFill ?? theme.defaultFill) !== norm(theme.defaultFill)) return null
	return analogousFillColor(configs, theme)
}

/** RENDER-side configs for an area chart whose body is on Auto
 * (`areaBodyAutoFill`): the fill becomes the fill-palette twin, and the
 * Line — which, left alone, takes the layer's fill — is pinned to the
 * series' own color, so the picture is a pale body under a line and points
 * in the marks' color. Never persisted: the stored fill stays the theme's,
 * so the default keeps tracking the theme, and the Color panel shows the
 * twin as the Area fill and the series color as the Line. A Line color the
 * user picked always wins. */
export const withAreaBodyDefault = (
	configs: ChannelConfigs,
	modeDef: Pick<ChartModeDef, "canvas">,
	encodings: Pick<Encodings, "hue">,
	theme: Theme
): ChannelConfigs => {
	const body = areaBodyAutoFill(modeDef, encodings, configs, theme)
	const connection = configs.connection
	if (body === null || !connection) return configs
	return {
		...configs,
		defaultFill: body,
		connection: {
			...connection,
			strokeColor: connection.strokeColor ?? configs.defaultFill ?? theme.defaultFill,
		},
	}
}

/** True when the marks' Color is the theme's own: its default categorical
 * palette, with no per-category color changed. The theme's fill palette is
 * that palette's pale twin, position for position, so a body can take
 * "the fill-palette color of its series" only while the series' own color
 * comes from the palette it twins. With a palette the user picked, or a
 * recolored category, the body keeps matching its marks instead. */
const colorAtThemePalette = (configs: ChannelConfigs, theme: Theme): boolean => {
	if (!areaFillPalette(theme)) return false
	// Stored, not assumed: a visual with no palette of its own draws the
	// hue scale's built-in colors, which are not the theme's either.
	if (configs.categoricalPaletteId !== theme.defaultCategoricalPaletteId) return false
	const overrides = configs.hue?.kind === "categorical" ? configs.hue.colors : {}
	return Object.keys(overrides ?? {}).length === 0
}

/** The Auto default of a body that used to match its marks exactly (a
 * radar polygon its points, a confidence band its group): the theme's fill
 * palette by the Color variable, where the theme has one and Color still
 * uses the theme's palette (`colorAtThemePalette`); otherwise `undefined`,
 * and the renderer keeps matching the marks as before. */
const bodyFollowingFillPalette = (
	key: "polygonFill" | "regressionCiFill",
	encodings: Pick<Encodings, "hue">,
	configs: ChannelConfigs,
	hueType: FieldType | null,
	theme: Theme
): ColorSlotConfig | undefined => {
	if (!colorAtThemePalette(configs, theme)) return undefined
	const hueField = encodings.hue?.field ?? null
	if (!hueField) {
		// One series in the marks' single color: its fill-palette twin. A
		// pooled confidence band has a theme color of its own and keeps it.
		if (key === "regressionCiFill") return undefined
		const analogous = analogousFillColor(configs, theme)
		return analogous ? { field: null, singleColor: analogous } : undefined
	}
	if (hueType !== "categorical") return undefined
	// A band belongs to one fit: it can take a Color category only when the
	// fits are split by the Color variable.
	if (key === "regressionCiFill") {
		const reg = configs.x?.regression
		if (!reg?.perGroup || reg.groupField !== hueField) return undefined
	}
	return {
		singleColor: legacySlotColor(key, configs) ?? COLOR_SLOT_DEFS[key].themeColor(theme),
		...seedColorSlot(hueField, hueType, theme, "fill"),
		field: hueField,
	}
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
	if (key === "polygonFill" || key === "regressionCiFill")
		return bodyFollowingFillPalette(key, encodings, configs, hueType, theme)
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

/** True when a part's color in the RENDER configs is its Auto default (the
 * one `withColorSlotDefaults` derived) or absent — i.e. the user has not
 * given the part a color of its own. The panel deletes a stored slot that
 * says only the default, so a stored slot never equals it. */
export const colorSlotOnAuto = (
	key: ColorSlotKey,
	renderConfigs: ChannelConfigs,
	encodings: Pick<Encodings, "hue" | "x" | "y">,
	hueType: FieldType | null,
	theme: Theme
): boolean => {
	const current = renderConfigs.colorSlots?.[key]
	if (!current) return true
	return isDefaultColorSlot(
		current,
		defaultColorSlot(key, encodings, renderConfigs, hueType, theme)
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
