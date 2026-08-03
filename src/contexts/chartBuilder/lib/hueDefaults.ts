import {
	DEFAULT_QUANTITATIVE_HUE_CONFIG,
	type HueConfig,
	type PaletteName,
} from "./channelConfig"
import type { Theme } from "./types"

/** Resolve a gradient ID (preset name OR saved gradient ID) into a
 * quantitative HueConfig. Used wherever the editor needs to seed a hue
 * config from the user's theme defaults. `sourcePaletteId` is set to
 * the resolved ID so a later "Reset colors" can re-resolve from the
 * same source. */
export const resolveGradientToConfig = (
	gradientId: string,
	theme: Theme
): Extract<HueConfig, { kind: "quantitative" }> => {
	const lin = theme.linearGradients.find((g) => g.id === gradientId)
	if (lin) {
		return {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "customLinear",
			lowColor: lin.low,
			midColor: null,
			highColor: lin.high,
			sourcePaletteId: gradientId,
		}
	}
	const div = theme.divergingGradients.find((g) => g.id === gradientId)
	if (div) {
		return {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "customDiverging",
			lowColor: div.low,
			midColor: div.mid,
			highColor: div.high,
			sourcePaletteId: gradientId,
		}
	}
	if (gradientId === "customLinear" && theme.customLinearGradient) {
		return {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "customLinear",
			lowColor: theme.customLinearGradient.low,
			midColor: null,
			highColor: theme.customLinearGradient.high,
			sourcePaletteId: "customLinear",
		}
	}
	if (gradientId === "customDiverging" && theme.customDivergingGradient) {
		return {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "customDiverging",
			lowColor: theme.customDivergingGradient.low,
			midColor: theme.customDivergingGradient.mid,
			highColor: theme.customDivergingGradient.high,
			sourcePaletteId: "customDiverging",
		}
	}
	return {
		...DEFAULT_QUANTITATIVE_HUE_CONFIG,
		palette: (gradientId || "viridis") as PaletteName,
		sourcePaletteId: gradientId || "viridis",
	}
}

/** Build a quantitative HueConfig seeded from the user's theme defaults
 * (their `defaultGradientPalette`). Use this whenever a quant/temporal
 * field is being mapped to hue so the chart renders the user's preferred
 * gradient immediately, not the built-in viridis fallback. */
export const buildQuantHueConfigFromTheme = (
	theme: Theme
): Extract<HueConfig, { kind: "quantitative" }> =>
	resolveGradientToConfig(theme.defaultGradientPalette, theme)
