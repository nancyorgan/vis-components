/** What picking a theme in the Theme panel does to a visual's saved
 * slices: ONLY the fields the theme drives (fonts, palettes, default
 * colors) are re-seeded from it; titles, alignments, per-category
 * overrides and hue configurations stay. Shared by the Theme panel and
 * `editVisual`, so a chart re-themed from a spec matches one re-themed by
 * hand. Pure. */

import type { CaptionConfig } from "./captionConfig"
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
} from "./themeConfig"
import type { Theme } from "./types"

export const rethemeChannelConfigs = (prev: ChannelConfigs, theme: Theme): ChannelConfigs => {
	const fromTheme = configsFromTheme(theme)
	return {
		...prev,
		// Theme-controlled defaults (overwritten).
		defaultFill: fromTheme.defaultFill,
		defaultRadius: fromTheme.defaultRadius,
		defaultOpacity: fromTheme.defaultOpacity,
		defaultShape: fromTheme.defaultShape,
		categoricalPaletteId: fromTheme.categoricalPaletteId,
		categoricalPalette: fromTheme.categoricalPalette,
		categoricalPalettePatternInks: fromTheme.categoricalPalettePatternInks,
		ordinalPaletteId: fromTheme.ordinalPaletteId,
		ordinalPalette: fromTheme.ordinalPalette,
		ordinalPalettePatternInks: fromTheme.ordinalPalettePatternInks,
		defaultGradientId: fromTheme.defaultGradientId,
		defaultGradientColors: fromTheme.defaultGradientColors,
		patternInkColor: fromTheme.patternInkColor,
		defaultPatternInk: fromTheme.defaultPatternInk,
		// Chart background follows the theme like the legend background
		// does: a theme that declares a background should not leave the
		// chart transparent after a switch (Aesthetics ▸ Chart background
		// reads the theme as its baseline, so this also keeps its "changed"
		// dot honest).
		backgroundColor: fromTheme.backgroundColor,
		// The panel border is a theme look too (like the background).
		panelBorder: fromTheme.panelBorder,
		// Nested configs merge so user overrides survive.
		shape: prev.shape
			? {
					...prev.shape,
					outlineColor: fromTheme.shape?.outlineColor ?? prev.shape.outlineColor,
					outlineWidth: fromTheme.shape?.outlineWidth ?? prev.shape.outlineWidth,
				}
			: fromTheme.shape,
		// The Background is theme-driven: the new theme's override, or null
		// (tile over each mark's fill) — not the old theme's leftover.
		pattern: prev.pattern
			? {
					...prev.pattern,
					backgroundColor: fromTheme.pattern?.backgroundColor ?? null,
				}
			: fromTheme.pattern,
		text: prev.text
			? {
					...prev.text,
					color: fromTheme.text?.color ?? prev.text.color,
					palette: fromTheme.text?.palette ?? prev.text.palette,
				}
			: fromTheme.text,
	}
}

export const rethemeLabels = (prev: LabelsConfig, theme: Theme): LabelsConfig => ({
	...prev,
	baseFont: labelsFromTheme(theme).baseFont,
})

/** The theme's legend defaults flow through: background, position,
 * orientation, border and gradient style. Columns, size, inside placement,
 * hidden sections and per-section swatch / gradient-bar edits are
 * user-driven and stay. */
export const rethemeLegend = (prev: LegendConfig, theme: Theme): LegendConfig => {
	const fromTheme = legendConfigFromTheme(theme)
	return {
		...prev,
		backgroundColor: fromTheme.backgroundColor,
		position: fromTheme.position,
		orientation: fromTheme.orientation,
		showBorder: fromTheme.showBorder,
		borderColor: fromTheme.borderColor,
		borderRadius: fromTheme.borderRadius,
		gradientLegendStyle: fromTheme.gradientLegendStyle,
	}
}

/** Tooltip on/off + the hover look flow through; the field list, custom
 * HTML / CSS and the (live-following) box pins stay. */
export const rethemeTooltip = (prev: TooltipConfig, theme: Theme): TooltipConfig => {
	const fromTheme = tooltipConfigFromTheme(theme)
	return {
		...prev,
		enabled: fromTheme.enabled,
		pointsOnly: fromTheme.pointsOnly,
		hoverEnabled: fromTheme.hoverEnabled,
		legendHighlight: fromTheme.legendHighlight,
		hoverRecolor: fromTheme.hoverRecolor,
		hoverHighlightColor: fromTheme.hoverHighlightColor,
		hoverOutline: fromTheme.hoverOutline,
		hoverOutlineColor: fromTheme.hoverOutlineColor,
		hoverOutlineWidth: fromTheme.hoverOutlineWidth,
		hoverFade: fromTheme.hoverFade,
		hoverFadeAmount: fromTheme.hoverFadeAmount,
	}
}

/** The four behavior flags flow through; the title, caption, column picks
 * and the (live-following) style pins stay. */
export const rethemeDataTable = (
	prev: DataTableConfig,
	theme: Theme
): DataTableConfig => {
	const fromTheme = dataTableConfigFromTheme(theme)
	return {
		...prev,
		enabled: fromTheme.enabled,
		placement: fromTheme.placement,
		maxRows: fromTheme.maxRows,
		showDownload: fromTheme.showDownload,
	}
}

/** Only the no-data colors flow through; projection, geography, focus and
 * the pattern choice are user-driven. */
export const rethemeMap = (prev: MapConfig, theme: Theme): MapConfig => {
	const fromTheme = mapConfigFromTheme(theme)
	return {
		...prev,
		noDataFill: fromTheme.noDataFill,
		noDataPatternInk: fromTheme.noDataPatternInk,
	}
}

/** Only the theme-driven font knobs (plus the single fallback color and the
 * map leader-line stroke) flow through; label encodings, per-value color
 * overrides, offsets and templates are user-driven. */
export const rethemeDataLabels = (prev: DataLabelsConfig, theme: Theme): DataLabelsConfig => {
	const fromTheme = dataLabelsConfigFromTheme(theme)
	return {
		...prev,
		color: fromTheme.color,
		fontFamily: fromTheme.fontFamily,
		fontSize: fromTheme.fontSize,
		fontWeight: fromTheme.fontWeight,
		italic: fromTheme.italic,
		underline: fromTheme.underline,
		leaderLineColor: fromTheme.leaderLineColor,
		leaderLineWidth: fromTheme.leaderLineWidth,
	}
}

/** The theme-driven text knobs and box flow through; the caption text and
 * its position / size nudges are user-driven. */
export const rethemeCaption = (prev: CaptionConfig, theme: Theme): CaptionConfig => {
	const fromTheme = captionConfigFromTheme(theme)
	return {
		...prev,
		fontFamily: fromTheme.fontFamily,
		fontSize: fromTheme.fontSize,
		fontWeight: fromTheme.fontWeight,
		textColor: fromTheme.textColor,
		align: fromTheme.align,
		italic: fromTheme.italic,
		underline: fromTheme.underline,
		padding: fromTheme.padding,
		backgroundColor: fromTheme.backgroundColor,
		backgroundOpacity: fromTheme.backgroundOpacity,
		borderEnabled: fromTheme.borderEnabled,
		borderColor: fromTheme.borderColor,
		borderWidth: fromTheme.borderWidth,
		borderRadius: fromTheme.borderRadius,
	}
}
