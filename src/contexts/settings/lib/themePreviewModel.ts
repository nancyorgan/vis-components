import {
	resolveLegendTextFont,
	resolveTextFont,
	resolveTitleFont,
	type FontConfig,
	type TextFontConfig,
} from "../../chartBuilder/lib/labelsConfig"
import type {
	BoxAnnotationStyle,
	LineAnnotationStyle,
	RectangleTextStyle,
	TextAnnotationBoxStyle,
} from "../../chartBuilder/lib/annotationsConfig"
import type {
	LineDashPattern,
	PaletteName,
} from "../../chartBuilder/lib/channelConfig"
import { dashArrayFor } from "../../chartBuilder/lib/dashPatterns"
import { ptToPx } from "../../chartBuilder/lib/fontUnit"
import { PALETTE_INTERPOLATORS } from "../../chartBuilder/lib/scales"
import {
	dataLabelsConfigFromTheme,
	gridlineThemeFor,
	labelsFromTheme,
	lineAnnotationStyleFromTheme,
	rectangleStyleFromTheme,
	resolveCategoricalPalette,
	resolveGradientColors,
	resolveOrdinalPalette,
	spineThemeFor,
	textAnnotationStyleFromTheme,
} from "../../chartBuilder/lib/themeConfig"
import type {
	SavedCategoricalPalette,
	SavedDivergingGradient,
	SavedLinearGradient,
	Theme,
} from "../../chartBuilder/lib/types"

/** Everything the theme gallery's preview template needs, resolved from a
 *  theme the same way a real chart resolves it (per-slot font fallbacks,
 *  per-axis gridline / spine fallbacks, default palette + gradient lookup).
 *  The template is fixed; only these values change from theme to theme, so
 *  a new theme never needs a rendered thumbnail — the preview is drawn
 *  live from the theme's own fields. */
export type ThemePreviewModel = {
	background: string | null
	legendBackground: string | null
	/** Default categorical palette, in order. Never empty. The card draws
	 *  its first six colors as bars. */
	palette: string[]
	fonts: {
		title: FontConfig
		subtitle: FontConfig
		axisTitle: FontConfig
		legendTitle: FontConfig
		text: TextFontConfig
		legendText: TextFontConfig
	}
	titleAlignment: "left" | "center" | "right"
	xGridline: { color: string; thickness: number }
	yGridline: { color: string; thickness: number }
	xSpine: { color: string; thickness: number }
	ySpine: { color: string; thickness: number }
	outline: { color: string; width: number }
	defaultFill: string
	defaultOpacity: number
}

/** How many samples a preset gradient is drawn with. Enough that viridis
 *  and the diverging presets read as their real ramps, few enough that the
 *  SVG stays tiny. */
const PRESET_GRADIENT_SAMPLES = 9

export type GradientStop = { offset: number; color: string }

/** A saved gradient's own anchors as stops: two for a linear one, three
 *  (mid at the centre) for a diverging one. */
export const savedGradientStops = (
	g: SavedLinearGradient | SavedDivergingGradient
): GradientStop[] =>
	"mid" in g
		? [
				{ offset: 0, color: g.low },
				{ offset: 0.5, color: g.mid },
				{ offset: 1, color: g.high },
			]
		: [
				{ offset: 0, color: g.low },
				{ offset: 1, color: g.high },
			]

/** A d3 preset sampled evenly across its range; unknown names draw as
 *  viridis, which is what the scale itself falls back to. */
export const presetGradientStops = (name: string): GradientStop[] => {
	const interpolator =
		PALETTE_INTERPOLATORS[name as PaletteName] ?? PALETTE_INTERPOLATORS.viridis
	return Array.from({ length: PRESET_GRADIENT_SAMPLES }, (_, i) => {
		const t = i / (PRESET_GRADIENT_SAMPLES - 1)
		return { offset: t, color: interpolator(t) }
	})
}

/** Stops for the theme's DEFAULT gradient. */
export const gradientStopsFor = (theme: Theme): GradientStop[] => {
	const custom = resolveGradientColors(theme)
	if (custom) {
		return custom.mid
			? [
					{ offset: 0, color: custom.low },
					{ offset: 0.5, color: custom.mid },
					{ offset: 1, color: custom.high },
				]
			: [
					{ offset: 0, color: custom.low },
					{ offset: 1, color: custom.high },
				]
	}
	return presetGradientStops(theme.defaultGradientPalette)
}

export const buildThemePreviewModel = (theme: Theme): ThemePreviewModel => {
	const base = labelsFromTheme(theme).baseFont
	return {
		background: theme.chartBackgroundColor,
		legendBackground: theme.legendBackgroundColor,
		palette: resolveCategoricalPalette(theme).colors,
		fonts: {
			title: resolveTitleFont(base, "primary", undefined),
			subtitle: resolveTitleFont(base, "subtitle", undefined),
			axisTitle: resolveTitleFont(base, "secondary", undefined),
			legendTitle: resolveTitleFont(base, "legend", undefined),
			text: resolveTextFont(base),
			legendText: resolveLegendTextFont(base),
		},
		titleAlignment: theme.titleAlignment ?? "center",
		xGridline: gridlineThemeFor(theme, "x"),
		yGridline: gridlineThemeFor(theme, "y"),
		xSpine: spineThemeFor(theme, "x"),
		ySpine: spineThemeFor(theme, "y"),
		outline: { color: theme.outlineColor, width: theme.outlineWidth },
		defaultFill: theme.defaultFill,
		defaultOpacity: theme.defaultOpacity,
	}
}

// ---------------------------------------------------------------------------
// Second panel — the sampler: everything the card's bar chart doesn't show.
// ---------------------------------------------------------------------------

/** One palette row of the sampler. `inks` pairs each color with the
 *  pattern ink the theme would put on it (per-hue override, else the
 *  global ink), so the pattern tiles can sit on real palette colors. */
export type SamplerPalette = {
	id: string
	name: string
	colors: string[]
	inks: string[]
	isDefault: boolean
}

export type SamplerGradient = {
	id: string
	name: string
	stops: GradientStop[]
	isDefault: boolean
}

export type ThemeSamplerModel = {
	background: string | null
	/** Every categorical palette, the default one first. Never empty. */
	categoricalPalettes: SamplerPalette[]
	/** Every ordinal palette, the default one first. Never empty. */
	ordinalPalettes: SamplerPalette[]
	/** The default gradient first (a preset when the default names one),
	 *  then every saved linear and diverging gradient. Never empty. */
	gradients: SamplerGradient[]
	pattern: { ink: string; background: string }
	mark: { fill: string; radius: number; opacity: number }
	outline: { color: string; width: number }
	connection: { color: string; thickness: number }
	regression: { stroke: string; ciFill: string }
	distribution: { stroke: string; fill: string }
	/** Data-label font; `size` is px. */
	dataLabels: {
		family: string
		size: number
		weight: number
		color: string
		italic: boolean
		underline: boolean
	}
	leaderLine: { color: string; width: number }
	legendSwatch: { color: string; stroke: string }
	text: TextFontConfig
	box: BoxAnnotationStyle & RectangleTextStyle
	textBox: TextAnnotationBoxStyle & RectangleTextStyle
	line: LineAnnotationStyle
}

/** Resolve an annotation dash the way the renderer does: a custom dasharray
 *  wins, else the named pattern's recipe, else solid (`undefined`). */
export const dasharrayOf = (
	pattern: LineDashPattern,
	custom: string | null
): string | undefined => custom ?? dashArrayFor(pattern) ?? undefined

const samplerPalette = (
	p: SavedCategoricalPalette,
	globalInk: string,
	isDefault: boolean
): SamplerPalette => ({
	id: p.id,
	name: p.name,
	colors: p.colors,
	inks: p.colors.map((_, i) => p.patternInks?.[i] ?? globalInk),
	isDefault,
})

/** The theme's palettes with the default first. A theme with no saved
 *  palette still gets one row: the stand-in the chart itself would draw. */
const orderedPalettes = (
	list: SavedCategoricalPalette[] | undefined,
	defaultId: string,
	fallback: { colors: string[]; patternInks: Array<string | null> },
	globalInk: string
): SamplerPalette[] => {
	const saved = list ?? []
	const def = saved.find((p) => p.id === defaultId) ?? saved[0]
	if (!def)
		return [
			{
				id: "fallback",
				name: "Default",
				colors: fallback.colors,
				inks: fallback.patternInks.map((ink) => ink ?? globalInk),
				isDefault: true,
			},
		]
	return [
		samplerPalette(def, globalInk, true),
		...saved
			.filter((p) => p.id !== def.id)
			.map((p) => samplerPalette(p, globalInk, false)),
	]
}

const orderedGradients = (theme: Theme): SamplerGradient[] => {
	const saved: Array<SavedLinearGradient | SavedDivergingGradient> = [
		...theme.linearGradients,
		...theme.divergingGradients,
	]
	const defaultId = theme.defaultGradientPalette
	const savedDefault = saved.find((g) => g.id === defaultId)
	const head: SamplerGradient = {
		id: savedDefault?.id ?? `preset:${defaultId}`,
		name: savedDefault?.name ?? defaultId,
		stops: gradientStopsFor(theme),
		isDefault: true,
	}
	return [
		head,
		...saved
			.filter((g) => g.id !== savedDefault?.id)
			.map((g) => ({
				id: g.id,
				name: g.name,
				stops: savedGradientStops(g),
				isDefault: false,
			})),
	]
}

export const buildThemeSamplerModel = (theme: Theme): ThemeSamplerModel => {
	const dataLabels = dataLabelsConfigFromTheme(theme)
	const ink = theme.patternInkColor
	return {
		background: theme.chartBackgroundColor,
		categoricalPalettes: orderedPalettes(
			theme.categoricalPalettes,
			theme.defaultCategoricalPaletteId,
			resolveCategoricalPalette(theme),
			ink
		),
		ordinalPalettes: orderedPalettes(
			theme.ordinalPalettes,
			theme.defaultOrdinalPaletteId,
			resolveOrdinalPalette(theme),
			ink
		),
		gradients: orderedGradients(theme),
		pattern: { ink, background: theme.patternBackgroundColor },
		mark: {
			fill: theme.defaultFill,
			radius: theme.defaultRadius,
			opacity: theme.defaultOpacity,
		},
		outline: { color: theme.outlineColor, width: theme.outlineWidth },
		connection: {
			color: theme.connectionColor,
			thickness: theme.connectionThickness,
		},
		regression: { stroke: theme.regressionStroke, ciFill: theme.regressionCiFill },
		distribution: {
			stroke: theme.distributionOverlayStroke,
			fill: theme.distributionOverlayFill,
		},
		dataLabels: {
			family: dataLabels.fontFamily,
			size: ptToPx(dataLabels.fontSize),
			weight: dataLabels.fontWeight,
			color: dataLabels.color,
			italic: dataLabels.italic ?? false,
			underline: dataLabels.underline ?? false,
		},
		// The config leaves these optional; the map renderer's own fallbacks.
		leaderLine: {
			color: dataLabels.leaderLineColor ?? "#999999",
			width: dataLabels.leaderLineWidth ?? 1,
		},
		legendSwatch: {
			color: theme.legendSwatchColor,
			stroke: theme.legendSwatchStroke,
		},
		text: resolveTextFont(labelsFromTheme(theme).baseFont),
		box: rectangleStyleFromTheme(theme),
		textBox: textAnnotationStyleFromTheme(theme),
		line: lineAnnotationStyleFromTheme(theme),
	}
}
