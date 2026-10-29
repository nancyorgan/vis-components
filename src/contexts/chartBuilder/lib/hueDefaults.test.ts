import { describe, expect, it } from "vitest"

import { DEFAULT_CATEGORICAL_HUE_CONFIG, DEFAULT_QUANTITATIVE_HUE_CONFIG } from "./channelConfig"
import {
	buildQuantHueConfigFromTheme,
	resolveGradientToConfig,
	seedOutlineHue,
} from "./hueDefaults"
import type { Theme } from "./types"

/** Minimal Theme fixture with just the gradient-relevant fields populated;
 *  the resolver only reads those, so leaving the rest as defaults is safe. */
const baseTheme: Theme = {
	defaultFill: "#000",
	defaultRadius: 4,
	defaultOpacity: 1,
	defaultShape: 0,
	outlineColor: "#fff",
	outlineWidth: 1,
	titleFontFamily: "",
	titleFontColor: "",
	titlePrimarySize: 1,
	titleSubtitleSize: 1,
	titleSecondarySize: 1,
	textFontFamily: "",
	textFontSize: 1,
	textFontColor: "",
	categoricalPalettes: [],
	ordinalPalettes: [],
	linearGradients: [],
	divergingGradients: [],
	defaultCategoricalPaletteId: "",
	defaultOrdinalPaletteId: "",
	defaultTextPaletteId: null,
	defaultGradientPalette: "viridis",
	patternInkColor: "",
	patternBackgroundColor: "",
	gridlineColor: "",
	gridlineThickness: 1,
	tickmarkColor: "",
	tickmarkThickness: 1,
	tickmarkLength: 1,
	spineColor: "",
	spineThickness: 1,
	textEncodingFontFamily: "",
	textEncodingFontSize: 1,
	textEncodingFontWeight: 500,
	textEncodingColor: "",
	distributionOverlayStroke: "",
	distributionOverlayFill: "",
	regressionStroke: "",
	regressionCiFill: "",
	connectionThickness: 2,
	connectionColor: "#888888",
	lengthMin: 0,
	lengthMax: 1,
	angleMin: 0,
	angleMax: 1,
	areaMin: 0,
	areaMax: 1,
	saturationMin: 0,
	saturationMax: 1,
	brightnessMin: 0,
	brightnessMax: 1,
	chartBackgroundColor: null,
	legendBackgroundColor: null,
	legendSwatchColor: "#4f8eda",
	legendSwatchStroke: "#ffffff",
	legendSwatchShape: null,
	legendSwatchSize: 5,
	legendSwatchOutlineColor: null,
	legendSwatchOutlineWidth: 0,
	tooltipMaxWidth: 240,
	tooltipCornerRadius: 6,
	tooltipOutlineColor: null,
	tooltipBackgroundColor: null,
	tooltipBackgroundOpacity: 1,
	tooltipShadowSize: 12,
	tooltipShadowColor: "#000000",
	tooltipShadowOpacity: 0.15,
	dataTableFontFamily: null,
	dataTableFontSize: null,
	dataTableFontWeight: null,
	dataTableTextColor: null,
	dataTableFirstColumnLikeOthers: true,
	dataTableFirstColumnFontFamily: null,
	dataTableFirstColumnFontSize: null,
	dataTableFirstColumnFontWeight: null,
	dataTableFirstColumnColor: null,
	dataTableHeaderBackground: null,
	dataTableHeaderTextColor: null,
	dataTableHeaderFontFamily: null,
	dataTableHeaderFontSize: null,
	dataTableHeaderFontWeight: 600,
	dataTableHeaderBorderColor: null,
	dataTableHeaderBorderWidth: 2,
	dataTableBorderColor: null,
	dataTableStriped: true,
	dataTableStripeColor: null,
	dataTableNumberAlign: "right",
	dataTableTitleFontFamily: null,
	dataTableTitleFontSize: null,
	dataTableTitleColor: null,
	dataTableTitleFontWeight: 600,
	dataTableTitleAlign: "left",
	dataTableCaptionFontFamily: null,
	dataTableCaptionFontSize: null,
	dataTableCaptionColor: null,
	dataTableCaptionFontWeight: null,
	dataTableCaptionAlign: "left",
}

describe("resolveGradientToConfig", () => {
	it("resolves a saved linear gradient by id", () => {
		const theme: Theme = {
			...baseTheme,
			linearGradients: [
				{ id: "blue-fade", name: "Blue", low: "#abc", high: "#def" },
			],
		}
		const cfg = resolveGradientToConfig("blue-fade", theme)
		expect(cfg.kind).toBe("quantitative")
		expect(cfg.palette).toBe("customLinear")
		expect(cfg.lowColor).toBe("#abc")
		expect(cfg.highColor).toBe("#def")
		// Linear gradients have no mid color — the resolver explicitly
		// pins it to null so divergent vs linear paths render correctly.
		expect(cfg.midColor).toBeNull()
	})

	it("resolves a saved diverging gradient by id with all three colors", () => {
		const theme: Theme = {
			...baseTheme,
			divergingGradients: [
				{
					id: "rgb",
					name: "RGB",
					low: "#f00",
					mid: "#0f0",
					high: "#00f",
				},
			],
		}
		const cfg = resolveGradientToConfig("rgb", theme)
		expect(cfg.palette).toBe("customDiverging")
		expect(cfg.lowColor).toBe("#f00")
		expect(cfg.midColor).toBe("#0f0")
		expect(cfg.highColor).toBe("#00f")
	})

	it("falls back to the gradientId as a preset PaletteName when no match exists", () => {
		// e.g. "viridis" / "plasma" — d3-interpolate presets handled
		// downstream. The resolver just passes them through.
		const cfg = resolveGradientToConfig("plasma", baseTheme)
		expect(cfg.palette).toBe("plasma")
		// midColor defaults from DEFAULT_QUANTITATIVE_HUE_CONFIG.
		expect(cfg.midColor).toBe(DEFAULT_QUANTITATIVE_HUE_CONFIG.midColor)
	})

	it("falls back to 'viridis' when the gradientId is empty", () => {
		// Empty-string id shouldn't crash — it falls through to the preset
		// branch with a viridis default. This is the silent-fallback that
		// AUDIT.md flagged; pinning it here so a future "throw on unknown"
		// change has to be deliberate.
		const cfg = resolveGradientToConfig("", baseTheme)
		expect(cfg.palette).toBe("viridis")
	})

	it("prefers a custom-named gradient over a same-named preset (id lookup wins)", () => {
		// If a user names their saved gradient "plasma", that override
		// beats the built-in preset of the same name.
		const theme: Theme = {
			...baseTheme,
			linearGradients: [
				{ id: "plasma", name: "Custom plasma", low: "#aa", high: "#bb" },
			],
		}
		const cfg = resolveGradientToConfig("plasma", theme)
		expect(cfg.palette).toBe("customLinear")
		expect(cfg.lowColor).toBe("#aa")
	})

})

describe("buildQuantHueConfigFromTheme", () => {
	it("delegates to resolveGradientToConfig with the theme's defaultGradientPalette", () => {
		const theme: Theme = {
			...baseTheme,
			defaultGradientPalette: "blue-fade",
			linearGradients: [
				{ id: "blue-fade", name: "Blue", low: "#abc", high: "#def" },
			],
		}
		const cfg = buildQuantHueConfigFromTheme(theme)
		expect(cfg.lowColor).toBe("#abc")
		expect(cfg.highColor).toBe("#def")
	})

	it("falls back to 'viridis' when the theme's defaultGradientPalette doesn't match any saved gradient", () => {
		const cfg = buildQuantHueConfigFromTheme({
			...baseTheme,
			defaultGradientPalette: "viridis",
		})
		expect(cfg.palette).toBe("viridis")
	})
})

describe("seedOutlineHue", () => {
	const theme: Theme = {
		...baseTheme,
		defaultGradientPalette: "blue-fade",
		linearGradients: [{ id: "blue-fade", name: "Blue", low: "#abc", high: "#def" }],
	}

	it("seeds the theme gradient for a continuous field and keeps one already there", () => {
		for (const type of ["quantitative", "temporal"] as const) {
			const seeded = seedOutlineHue(undefined, type, theme)
			expect(seeded).toEqual(buildQuantHueConfigFromTheme(theme))
			expect(seedOutlineHue(seeded, type, theme)).toBe(seeded)
		}
	})

	it("keeps a categorical config for a discrete field and drops a quantitative one", () => {
		const quant = buildQuantHueConfigFromTheme(theme)
		expect(seedOutlineHue(quant, "categorical", theme)).toBeUndefined()
		expect(seedOutlineHue(DEFAULT_CATEGORICAL_HUE_CONFIG, "ordinal", theme)).toBe(
			DEFAULT_CATEGORICAL_HUE_CONFIG
		)
	})
})
