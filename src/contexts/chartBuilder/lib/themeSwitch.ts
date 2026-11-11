/** What picking a theme in the Theme panel does to a visual's saved
 * slices. Only the fields the theme drives (fonts, palettes, default
 * colors, legend placement, …) are touched at all, and each of those
 * follows the incoming theme ONLY while it still sits at the outgoing
 * theme's value: a field the user moved off the theme is a pick and
 * stays — the theme changes the defaults, never a setting someone made.
 * The comparison is the changed-dot's (`valueChanged`), so "follows the
 * theme" and "no dot" are one fact: what the sidebar shows as unchanged
 * is exactly what a switch restyles. With no outgoing theme to diff
 * against (`from` null — an API edit on a visual whose theme the caller
 * doesn't know) every theme-driven field follows. Titles, alignments,
 * per-category overrides and hue configurations are never touched.
 * Shared by the Theme panel and `editVisual`, so a chart re-themed from
 * a spec matches one re-themed by hand. Pure. */

import type { CaptionConfig } from "./captionConfig"
import { followAreaPaletteDefaults } from "./connectionEdits"
import type { ChannelConfigs, DataLabelsConfig } from "./channelConfig"
import type { DataTableConfig } from "./dataTableConfig"
import type { LabelsConfig, LegendConfig, TooltipConfig } from "./labelsConfig"
import type { MapConfig } from "./mapConfig"
import {
	captionConfigFromTheme,
	configsFromTheme,
	dataLabelsConfigFromTheme,
	dataTableConfigFromTheme,
	labelsFromTheme,
	legendConfigFromTheme,
	mapConfigFromTheme,
	tooltipConfigFromTheme,
	valueChanged,
} from "./themeConfig"
import type { Theme } from "./types"

/** The theme-driven slot's value after the switch: the user's own pick
 * when the slot has moved off the outgoing theme, else the incoming
 * theme's value. `outgoing` undefined (no outgoing theme, or a theme
 * without the slot) can't vouch for a pick, so only a non-empty saved
 * value survives it. */
const follow = <T>(current: T, outgoing: T | undefined, incoming: T, diffable: boolean): T =>
	diffable && valueChanged(current, outgoing) ? current : incoming

/** `follow` over the listed keys of a config slice; every other key of
 * `prev` is user-driven and copied through untouched. */
const followKeys = <T extends object>(
	prev: T,
	outgoing: T | null,
	incoming: T,
	keys: ReadonlyArray<keyof T>
): T => {
	const out = { ...prev }
	for (const k of keys) out[k] = follow(prev[k], outgoing?.[k], incoming[k], outgoing !== null)
	return out
}

/** `followKeys` over every key the incoming slice carries — for a nested
 * block whose keys are all theme-driven (the base fonts). */
const followAll = <T extends object>(prev: T, outgoing: T | null, incoming: T): T =>
	followKeys(prev, outgoing, incoming, Object.keys(incoming) as Array<keyof T>)

const CHANNEL_THEME_KEYS: ReadonlyArray<keyof ChannelConfigs> = [
	"defaultFill",
	"defaultRadius",
	"defaultOpacity",
	"defaultShape",
	"categoricalPaletteId",
	"categoricalPalette",
	"categoricalPalettePatternInks",
	"ordinalPaletteId",
	"ordinalPalette",
	"ordinalPalettePatternInks",
	"defaultGradientId",
	"defaultGradientColors",
	"patternInkColor",
	"defaultPatternInk",
	// Chart background follows the theme like the legend background
	// does: a theme that declares a background should not leave the
	// chart transparent after a switch (Aesthetics ▸ Chart background
	// reads the theme as its baseline, so this also keeps its "changed"
	// dot honest).
	"backgroundColor",
	// The panel border is a theme look too (like the background).
	"panelBorder",
]

export const rethemeChannelConfigs = (
	prev: ChannelConfigs,
	theme: Theme,
	from: Theme | null = null
): ChannelConfigs => {
	const incoming = configsFromTheme(theme)
	const outgoing = from && configsFromTheme(from)
	const diffable = outgoing !== null
	const rethemed: ChannelConfigs = {
		...followKeys(prev, outgoing, incoming, CHANNEL_THEME_KEYS),
		// Nested configs merge so the user's other fields survive; inside
		// them only the theme-driven knobs follow.
		shape: prev.shape
			? {
					...prev.shape,
					outlineColor: follow(
						prev.shape.outlineColor,
						outgoing?.shape?.outlineColor,
						incoming.shape?.outlineColor ?? prev.shape.outlineColor,
						diffable
					),
					outlineWidth: follow(
						prev.shape.outlineWidth,
						outgoing?.shape?.outlineWidth,
						incoming.shape?.outlineWidth ?? prev.shape.outlineWidth,
						diffable
					),
				}
			: incoming.shape,
		// The Background is theme-driven: the new theme's override, or null
		// (tile over each mark's fill) — not the old theme's leftover.
		pattern: prev.pattern
			? {
					...prev.pattern,
					backgroundColor: follow(
						prev.pattern.backgroundColor,
						outgoing?.pattern?.backgroundColor ?? null,
						incoming.pattern?.backgroundColor ?? null,
						diffable
					),
				}
			: incoming.pattern,
		text: prev.text
			? {
					...prev.text,
					color: follow(
						prev.text.color,
						outgoing?.text?.color,
						incoming.text?.color ?? prev.text.color,
						diffable
					),
					palette: follow(
						prev.text.palette,
						outgoing?.text?.palette,
						incoming.text?.palette ?? prev.text.palette,
						diffable
					),
				}
			: incoming.text,
	}
	// A filled area still on the outgoing theme's area palettes (fill
	// palette body, categorical Line) takes the incoming theme's.
	return followAreaPaletteDefaults(prev, rethemed, theme, from)
}

/** Every base-font knob is theme-driven and follows one by one, so a
 * hand-picked title family survives a switch that still restyles the
 * sizes and colors around it. */
export const rethemeLabels = (
	prev: LabelsConfig,
	theme: Theme,
	from: Theme | null = null
): LabelsConfig => {
	const incoming = labelsFromTheme(theme).baseFont
	const outgoing = from && labelsFromTheme(from).baseFont
	return {
		...prev,
		baseFont: {
			...prev.baseFont,
			titles: followAll(prev.baseFont.titles, outgoing?.titles ?? null, incoming.titles),
			text: followAll(prev.baseFont.text, outgoing?.text ?? null, incoming.text),
		},
	}
}

const LEGEND_THEME_KEYS: ReadonlyArray<keyof LegendConfig> = [
	"backgroundColor",
	"position",
	"orientation",
	"showBorder",
	"borderColor",
	"borderRadius",
	"gradientLegendStyle",
]

/** The theme's legend defaults flow through: background, position,
 * orientation, border and gradient style. Columns, size, inside placement,
 * hidden sections and per-section swatch / gradient-bar edits are
 * user-driven and stay. */
export const rethemeLegend = (
	prev: LegendConfig,
	theme: Theme,
	from: Theme | null = null
): LegendConfig =>
	followKeys(
		prev,
		from && legendConfigFromTheme(from),
		legendConfigFromTheme(theme),
		LEGEND_THEME_KEYS
	)

const TOOLTIP_THEME_KEYS: ReadonlyArray<keyof TooltipConfig> = [
	"enabled",
	"pointsOnly",
	"hoverEnabled",
	"legendHighlight",
	"hoverRecolor",
	"hoverHighlightColor",
	"hoverOutline",
	"hoverOutlineColor",
	"hoverOutlineWidth",
	"hoverFade",
	"hoverFadeAmount",
]

/** Tooltip on/off + the hover look flow through; the field list, custom
 * HTML / CSS and the (live-following) box pins stay. */
export const rethemeTooltip = (
	prev: TooltipConfig,
	theme: Theme,
	from: Theme | null = null
): TooltipConfig =>
	followKeys(
		prev,
		from && tooltipConfigFromTheme(from),
		tooltipConfigFromTheme(theme),
		TOOLTIP_THEME_KEYS
	)

const DATA_TABLE_THEME_KEYS: ReadonlyArray<keyof DataTableConfig> = [
	"enabled",
	"placement",
	"maxRows",
	"showDownload",
]

/** The four behavior flags flow through; the title, caption, column picks
 * and the (live-following) style pins stay. */
export const rethemeDataTable = (
	prev: DataTableConfig,
	theme: Theme,
	from: Theme | null = null
): DataTableConfig =>
	followKeys(
		prev,
		from && dataTableConfigFromTheme(from),
		dataTableConfigFromTheme(theme),
		DATA_TABLE_THEME_KEYS
	)

const MAP_THEME_KEYS: ReadonlyArray<keyof MapConfig> = ["noDataFill", "noDataPatternInk"]

/** Only the no-data colors flow through; projection, geography, focus and
 * the pattern choice are user-driven. */
export const rethemeMap = (prev: MapConfig, theme: Theme, from: Theme | null = null): MapConfig =>
	followKeys(prev, from && mapConfigFromTheme(from), mapConfigFromTheme(theme), MAP_THEME_KEYS)

const DATA_LABELS_THEME_KEYS: ReadonlyArray<keyof DataLabelsConfig> = [
	"color",
	"fontFamily",
	"fontSize",
	"fontWeight",
	"italic",
	"underline",
	"leaderLineColor",
	"leaderLineWidth",
]

/** Only the theme-driven font knobs (plus the single fallback color and the
 * map leader-line stroke) flow through; label encodings, per-value color
 * overrides, offsets and templates are user-driven. */
export const rethemeDataLabels = (
	prev: DataLabelsConfig,
	theme: Theme,
	from: Theme | null = null
): DataLabelsConfig =>
	followKeys(
		prev,
		from && dataLabelsConfigFromTheme(from),
		dataLabelsConfigFromTheme(theme),
		DATA_LABELS_THEME_KEYS
	)

const CAPTION_THEME_KEYS: ReadonlyArray<keyof CaptionConfig> = [
	"fontFamily",
	"fontSize",
	"fontWeight",
	"textColor",
	"align",
	"italic",
	"underline",
	"padding",
	"backgroundColor",
	"backgroundOpacity",
	"borderEnabled",
	"borderColor",
	"borderWidth",
	"borderRadius",
]

/** The theme-driven text knobs and box flow through; the caption text and
 * its position / size nudges are user-driven. */
export const rethemeCaption = (
	prev: CaptionConfig,
	theme: Theme,
	from: Theme | null = null
): CaptionConfig =>
	followKeys(
		prev,
		from && captionConfigFromTheme(from),
		captionConfigFromTheme(theme),
		CAPTION_THEME_KEYS
	)
