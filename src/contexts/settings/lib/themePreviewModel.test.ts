import { describe, expect, it } from "vitest"

import { SYSTEM_LIGHT_THEME, themeOf } from "../../chartBuilder/lib/systemThemes"
import type { Theme } from "../../chartBuilder/lib/types"
import {
	buildThemePreviewModel,
	buildThemeSamplerModel,
	dasharrayOf,
	gradientStopsFor,
} from "./themePreviewModel"

/** The gallery preview is a fixed template filled from the theme; these
 *  pin the fills to the same resolution rules a real chart uses. */

const base: Theme = themeOf(SYSTEM_LIGHT_THEME)

describe("buildThemePreviewModel", () => {
	it("draws the DEFAULT categorical palette, not the first one listed", () => {
		const theme: Theme = {
			...base,
			categoricalPalettes: [
				{ id: "a", name: "A", colors: ["#111111", "#222222"] },
				{ id: "b", name: "B", colors: ["#aaaaaa", "#bbbbbb", "#cccccc"] },
			],
			defaultCategoricalPaletteId: "b",
		}
		expect(buildThemePreviewModel(theme).palette).toEqual([
			"#aaaaaa",
			"#bbbbbb",
			"#cccccc",
		])
	})

	it("resolves per-slot font fallbacks the way the chart does", () => {
		const theme: Theme = {
			...base,
			titleFontFamily: "Fraunces, serif",
			titleFontColor: "#123456",
			titleFontWeight: 600,
			// The system theme gives the subtitle its own family; clear it so
			// the fallback to the main title family is what's under test.
			subtitleFontFamily: undefined,
			axisTitleFontFamily: "Quicksand, sans-serif",
			legendTitleFontColor: "#654321",
			textFontFamily: "Inter, sans-serif",
			legendTextFontFamily: undefined,
		}
		const { fonts } = buildThemePreviewModel(theme)
		expect(fonts.title.family).toBe("Fraunces, serif")
		expect(fonts.title.weight).toBe(600)
		// Subtitle follows the main title family when it has none of its own.
		expect(fonts.subtitle.family).toBe("Fraunces, serif")
		expect(fonts.axisTitle.family).toBe("Quicksand, sans-serif")
		expect(fonts.axisTitle.color).toBe("#123456")
		expect(fonts.legendTitle.color).toBe("#654321")
		// Legend labels follow the text font unless split off.
		expect(fonts.legendText.family).toBe("Inter, sans-serif")
	})

	it("prefers per-axis gridline / spine fields over the shared legacy ones", () => {
		const theme: Theme = {
			...base,
			gridlineColor: "#cccccc",
			gridlineThickness: 1,
			yGridlineColor: "#ff0000",
			spineColor: "#000000",
			spineThickness: 2,
			xSpineThickness: 0,
		}
		const m = buildThemePreviewModel(theme)
		expect(m.yGridline.color).toBe("#ff0000")
		expect(m.xGridline.color).toBe("#cccccc")
		expect(m.xSpine.thickness).toBe(0)
		expect(m.ySpine).toEqual({ color: "#000000", thickness: 2 })
	})
})

describe("buildThemeSamplerModel", () => {
	it("lists every palette with the DEFAULT one first", () => {
		const theme: Theme = {
			...base,
			categoricalPalettes: [
				{ id: "a", name: "A", colors: ["#111111", "#222222"] },
				{ id: "b", name: "B", colors: ["#aaaaaa", "#bbbbbb", "#cccccc"] },
			],
			defaultCategoricalPaletteId: "b",
			ordinalPalettes: [
				{ id: "o1", name: "O1", colors: ["#000001", "#000002"] },
				{ id: "o2", name: "O2", colors: ["#00000a", "#00000b", "#00000c"] },
			],
			defaultOrdinalPaletteId: "o2",
			defaultFill: "#ab12cd",
			defaultRadius: 7,
			defaultOpacity: 0.6,
		}
		const m = buildThemeSamplerModel(theme)
		expect(m.categoricalPalettes.map((p) => p.id)).toEqual(["b", "a"])
		expect(m.categoricalPalettes[0]?.isDefault).toBe(true)
		expect(m.ordinalPalettes.map((p) => p.id)).toEqual(["o2", "o1"])
		expect(m.ordinalPalettes[0]?.colors).toEqual(["#00000a", "#00000b", "#00000c"])
		expect(m.mark).toEqual({ fill: "#ab12cd", radius: 7, opacity: 0.6 })
	})

	it("pairs each palette color with its pattern ink, falling back to the global ink", () => {
		const theme: Theme = {
			...base,
			patternInkColor: "#0000ff",
			categoricalPalettes: [
				{
					id: "a",
					name: "A",
					colors: ["#111111", "#222222", "#333333"],
					patternInks: ["#eeeeee", null],
				},
			],
			defaultCategoricalPaletteId: "a",
		}
		expect(buildThemeSamplerModel(theme).categoricalPalettes[0]?.inks).toEqual([
			"#eeeeee",
			"#0000ff",
			"#0000ff",
		])
	})

	it("still draws one palette row when the theme has none saved", () => {
		const m = buildThemeSamplerModel({ ...base, categoricalPalettes: [], ordinalPalettes: [] })
		expect(m.categoricalPalettes).toHaveLength(1)
		expect(m.categoricalPalettes[0]?.colors.length).toBeGreaterThan(0)
		expect(m.ordinalPalettes).toHaveLength(1)
	})

	it("puts the default gradient first, then every saved linear and diverging one", () => {
		const theme: Theme = {
			...base,
			linearGradients: [
				{ id: "l1", name: "L1", low: "#000000", high: "#ffffff" },
				{ id: "l2", name: "L2", low: "#111111", high: "#eeeeee" },
			],
			divergingGradients: [
				{ id: "d1", name: "D1", low: "#0000ff", mid: "#ffffff", high: "#ff0000" },
			],
			defaultGradientPalette: "l2",
		}
		const m = buildThemeSamplerModel(theme)
		expect(m.gradients.map((g) => g.id)).toEqual(["l2", "l1", "d1"])
		expect(m.gradients[0]?.isDefault).toBe(true)
		expect(m.gradients[2]?.stops).toHaveLength(3)
	})

	it("leads with a sampled preset when the default gradient names one", () => {
		const m = buildThemeSamplerModel({
			...base,
			linearGradients: [{ id: "l1", name: "L1", low: "#000000", high: "#ffffff" }],
			divergingGradients: [],
			defaultGradientPalette: "viridis",
		})
		expect(m.gradients.map((g) => g.id)).toEqual(["preset:viridis", "l1"])
		expect(m.gradients[0]?.stops.length).toBeGreaterThan(2)
	})

	it("resolves annotation and data-label seeds through the chart's own resolvers", () => {
		const theme: Theme = {
			...base,
			annotationFillColor: "#ff0000",
			annotationBorderColor: undefined,
			annotationLineDash: "dashed",
			dataLabelsFontSize: 10,
			dataLabelsColor: undefined,
			textEncodingColor: "#0000ff",
		}
		const m = buildThemeSamplerModel(theme)
		// An unset border color follows the fill, like the real seed.
		expect(m.box.borderColor).toBe("#ff0000")
		expect(dasharrayOf(m.line.lineDash, m.line.lineDasharray)).toBe("8,4")
		// Data labels inherit the text-encoding color, and pt → px.
		expect(m.dataLabels.color).toBe("#0000ff")
		expect(m.dataLabels.size).toBeCloseTo(10 * (4 / 3), 5)
	})

	it("lets a custom dasharray win over the named pattern", () => {
		expect(dasharrayOf("dotted", "1 5")).toBe("1 5")
		expect(dasharrayOf("solid", null)).toBeUndefined()
	})
})

describe("gradientStopsFor", () => {
	it("uses a saved linear gradient's own anchors", () => {
		const theme: Theme = {
			...base,
			linearGradients: [{ id: "lin", name: "L", low: "#000000", high: "#ffffff" }],
			defaultGradientPalette: "lin",
		}
		expect(gradientStopsFor(theme)).toEqual([
			{ offset: 0, color: "#000000" },
			{ offset: 1, color: "#ffffff" },
		])
	})

	it("puts a saved diverging gradient's mid color at the centre", () => {
		const theme: Theme = {
			...base,
			divergingGradients: [
				{ id: "div", name: "D", low: "#0000ff", mid: "#ffffff", high: "#ff0000" },
			],
			defaultGradientPalette: "div",
		}
		expect(gradientStopsFor(theme)).toEqual([
			{ offset: 0, color: "#0000ff" },
			{ offset: 0.5, color: "#ffffff" },
			{ offset: 1, color: "#ff0000" },
		])
	})

	it("samples a d3 preset across its full range", () => {
		const stops = gradientStopsFor({ ...base, defaultGradientPalette: "viridis" })
		expect(stops.length).toBeGreaterThan(2)
		expect(stops[0]?.offset).toBe(0)
		expect(stops.at(-1)?.offset).toBe(1)
		// Every sample is a real color string.
		for (const s of stops) expect(s.color).toMatch(/^(#|rgb)/)
	})

	it("falls back to viridis for an unknown preset name", () => {
		const unknown = gradientStopsFor({ ...base, defaultGradientPalette: "nope" })
		const viridis = gradientStopsFor({ ...base, defaultGradientPalette: "viridis" })
		expect(unknown).toEqual(viridis)
	})
})
