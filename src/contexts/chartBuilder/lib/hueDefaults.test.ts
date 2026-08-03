import { describe, expect, it } from "vitest"

import { DEFAULT_QUANTITATIVE_HUE_CONFIG } from "./channelConfig"
import {
	buildQuantHueConfigFromTheme,
	resolveGradientToConfig,
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

	it("handles the literal 'customLinear' id with the theme's custom slot", () => {
		const theme: Theme = {
			...baseTheme,
			customLinearGradient: { low: "#000", high: "#fff" },
		}
		const cfg = resolveGradientToConfig("customLinear", theme)
		expect(cfg.palette).toBe("customLinear")
		expect(cfg.lowColor).toBe("#000")
		expect(cfg.highColor).toBe("#fff")
		expect(cfg.midColor).toBeNull()
	})

	it("handles the literal 'customDiverging' id with the theme's custom slot", () => {
		const theme: Theme = {
			...baseTheme,
			customDivergingGradient: { low: "#a", mid: "#b", high: "#c" },
		}
		const cfg = resolveGradientToConfig("customDiverging", theme)
		expect(cfg.palette).toBe("customDiverging")
		expect(cfg.lowColor).toBe("#a")
		expect(cfg.midColor).toBe("#b")
		expect(cfg.highColor).toBe("#c")
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

	it("ignores the 'customLinear' literal when no customLinearGradient is set in theme", () => {
		// Falls through to preset path with 'customLinear' as the palette
		// name — caller-facing fallback rather than a crash.
		const cfg = resolveGradientToConfig("customLinear", {
			...baseTheme,
			customLinearGradient: undefined,
		})
		expect(cfg.palette).toBe("customLinear")
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
