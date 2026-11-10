import { describe, expect, it } from "vitest"

import { DEFAULT_CAPTION_CONFIG } from "./captionConfig"
import { DEFAULT_DATA_TABLE_CONFIG } from "./dataTableConfig"
import { DEFAULT_LEGEND_CONFIG, DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import { DEFAULT_MAP_CONFIG } from "./mapConfig"
import { LIGHT_THEME_BASE } from "./systemThemes"
import {
	captionConfigFromTheme,
	configsFromTheme,
	dataLabelsConfigFromTheme,
	dataTableConfigFromTheme,
	labelsFromTheme,
	legendConfigFromTheme,
	mapConfigFromTheme,
	panelBorderFromTheme,
	tooltipConfigFromTheme,
} from "./themeConfig"
import {
	rethemeCaption,
	rethemeChannelConfigs,
	rethemeDataLabels,
	rethemeDataTable,
	rethemeLabels,
	rethemeLegend,
	rethemeMap,
	rethemeTooltip,
} from "./themeSwitch"
import type { Theme } from "./types"

const THEMED: Theme = {
	...LIGHT_THEME_BASE,
	legendPosition: "bottom",
	legendOrientation: "horizontal",
	legendShowBorder: true,
	legendBorderColor: "#123456",
	legendBorderRadius: 0,
	legendGradientStyle: "bar",
	tooltipEnabled: false,
	tooltipPointsOnly: true,
	hoverEnabled: false,
	hoverLegendHighlight: false,
	hoverRecolor: true,
	hoverHighlightColor: "#ff0000",
	hoverOutline: true,
	hoverOutlineColor: "#00ff00",
	hoverOutlineWidth: 4,
	hoverFade: false,
	hoverFadeAmount: 0.5,
	captionItalic: true,
	captionUnderline: true,
	captionPadding: 2,
	captionBackgroundColor: "#eeeeee",
	captionBackgroundOpacity: 1,
	captionBorderEnabled: true,
	captionBorderColor: "#333333",
	captionBorderWidth: 3,
	captionBorderRadius: 0,
	dataTableEnabled: true,
	dataTablePlacement: "tabs",
	dataTableMaxRows: null,
	dataTableShowDownload: false,
	mapNoDataFill: "#222222",
	mapNoDataPatternInk: "#444444",
}

describe("theme-seeded builders", () => {
	it("keep the built-in defaults for a theme without the new fields", () => {
		expect(legendConfigFromTheme(LIGHT_THEME_BASE)).toEqual({
			...DEFAULT_LEGEND_CONFIG,
			backgroundColor: LIGHT_THEME_BASE.legendBackgroundColor,
		})
		expect(tooltipConfigFromTheme(LIGHT_THEME_BASE)).toEqual(DEFAULT_TOOLTIP_CONFIG)
		expect(dataTableConfigFromTheme(LIGHT_THEME_BASE)).toEqual(DEFAULT_DATA_TABLE_CONFIG)
		expect(mapConfigFromTheme(LIGHT_THEME_BASE)).toEqual(DEFAULT_MAP_CONFIG)
		const caption = captionConfigFromTheme(LIGHT_THEME_BASE)
		expect(caption.italic).toBeUndefined()
		expect(caption.underline).toBeUndefined()
		expect(caption.padding).toBe(DEFAULT_CAPTION_CONFIG.padding)
		expect(caption.borderEnabled).toBe(DEFAULT_CAPTION_CONFIG.borderEnabled)
	})

	it("seed the theme's values", () => {
		expect(legendConfigFromTheme(THEMED)).toMatchObject({
			position: "bottom",
			orientation: "horizontal",
			showBorder: true,
			borderColor: "#123456",
			borderRadius: 0,
		})
		expect(tooltipConfigFromTheme(THEMED)).toMatchObject({
			enabled: false,
			pointsOnly: true,
			hoverEnabled: false,
			legendHighlight: false,
			hoverRecolor: true,
			hoverHighlightColor: "#ff0000",
			hoverOutline: true,
			hoverOutlineColor: "#00ff00",
			hoverOutlineWidth: 4,
			hoverFade: false,
			hoverFadeAmount: 0.5,
		})
		expect(captionConfigFromTheme(THEMED)).toMatchObject({
			italic: true,
			underline: true,
			padding: 2,
			backgroundColor: "#eeeeee",
			backgroundOpacity: 1,
			borderEnabled: true,
			borderColor: "#333333",
			borderWidth: 3,
			borderRadius: 0,
		})
		expect(dataTableConfigFromTheme(THEMED)).toMatchObject({
			enabled: true,
			placement: "tabs",
			maxRows: null,
			showDownload: false,
		})
		expect(mapConfigFromTheme(THEMED)).toMatchObject({
			noDataFill: "#222222",
			noDataPatternInk: "#444444",
		})
	})

	it("tell an unset max-rows (10) from the theme's All (null)", () => {
		expect(dataTableConfigFromTheme(LIGHT_THEME_BASE).maxRows).toBe(10)
		expect(dataTableConfigFromTheme({ ...LIGHT_THEME_BASE, dataTableMaxRows: null }).maxRows).toBe(
			null
		)
		expect(dataTableConfigFromTheme({ ...LIGHT_THEME_BASE, dataTableMaxRows: 25 }).maxRows).toBe(25)
	})

	it("leave the tooltip box sparse (it follows the theme live)", () => {
		expect("tooltipMaxWidth" in tooltipConfigFromTheme(THEMED)).toBe(false)
	})
})

describe("retheme", () => {
	it("rewrites the seeded legend fields and keeps user layout", () => {
		const prev = { ...DEFAULT_LEGEND_CONFIG, columns: 3, width: 200, position: "left" as const }
		const next = rethemeLegend(prev, THEMED)
		expect(next).toMatchObject({
			position: "bottom",
			orientation: "horizontal",
			showBorder: true,
			borderColor: "#123456",
			borderRadius: 0,
			columns: 3,
			width: 200,
		})
	})

	it("rewrites the hover look and keeps the field list, custom HTML and box pins", () => {
		const prev = {
			...DEFAULT_TOOLTIP_CONFIG,
			visibleFields: ["sales"],
			useCustomHtml: true,
			customHtml: "<b>{sales}</b>",
			tooltipMaxWidth: 300,
		}
		const next = rethemeTooltip(prev, THEMED)
		expect(next).toMatchObject({
			enabled: false,
			hoverOutline: true,
			hoverOutlineWidth: 4,
			hoverFadeAmount: 0.5,
			visibleFields: ["sales"],
			useCustomHtml: true,
			customHtml: "<b>{sales}</b>",
			tooltipMaxWidth: 300,
		})
	})

	it("rewrites the caption box and keeps its text and nudges", () => {
		const prev = { ...DEFAULT_CAPTION_CONFIG, text: "Source: CDC", offsetY: 12 }
		const next = rethemeCaption(prev, THEMED)
		expect(next).toMatchObject({
			text: "Source: CDC",
			offsetY: 12,
			italic: true,
			padding: 2,
			borderEnabled: true,
			borderWidth: 3,
		})
	})

	it("rewrites the data-table flags and keeps its title and columns", () => {
		const prev = { ...DEFAULT_DATA_TABLE_CONFIG, title: "Sales", columns: "all" as const }
		const next = rethemeDataTable(prev, THEMED)
		expect(next).toMatchObject({
			title: "Sales",
			columns: "all",
			enabled: true,
			placement: "tabs",
			maxRows: null,
			showDownload: false,
		})
	})

	it("rewrites the no-data colors and keeps the projection", () => {
		const prev = { ...DEFAULT_MAP_CONFIG, projection: "mercator" as const, noDataFill: "#ffffff" }
		const next = rethemeMap(prev, THEMED)
		expect(next).toMatchObject({
			projection: "mercator",
			noDataFill: "#222222",
			noDataPatternInk: "#444444",
		})
	})
})

/** The theme changes the DEFAULTS, never a setting the user made: with
 * the outgoing theme to diff against, a slot still at that theme's value
 * follows the new one and a slot the user moved off it stays. The rule
 * is the changed-dot's, so "stays" and "lit dot" agree. */
describe("retheme keeps the user's picks", () => {
	const FROM = LIGHT_THEME_BASE
	const seeded = configsFromTheme(FROM)

	it("keeps a hand-set point size and still follows the untouched defaults", () => {
		const prev = { ...seeded, defaultRadius: 14 }
		const next = rethemeChannelConfigs(prev, { ...THEMED, defaultRadius: 3, defaultFill: "#abcdef" }, FROM)
		expect(next.defaultRadius).toBe(14)
		expect(next.defaultFill).toBe("#abcdef")
	})

	it("follows the new theme for a point size still at the old theme's", () => {
		const next = rethemeChannelConfigs(seeded, { ...THEMED, defaultRadius: 3 }, FROM)
		expect(next.defaultRadius).toBe(3)
	})

	it("without an outgoing theme every theme-driven slot follows", () => {
		const prev = { ...seeded, defaultRadius: 14 }
		expect(rethemeChannelConfigs(prev, { ...THEMED, defaultRadius: 3 }).defaultRadius).toBe(3)
	})

	it("keeps a custom chart background and a custom outline, follows the rest", () => {
		const prev = {
			...seeded,
			backgroundColor: "#fffbe6",
			shape: { ...seeded.shape!, outlineWidth: 5 },
		}
		const to = { ...THEMED, chartBackgroundColor: "#000000", outlineColor: "#ff00ff", outlineWidth: 2 }
		const next = rethemeChannelConfigs(prev, to, FROM)
		expect(next.backgroundColor).toBe("#fffbe6")
		expect(next.shape).toMatchObject({ outlineWidth: 5, outlineColor: "#ff00ff" })
	})

	it("keeps a hand-picked legend position and follows the border", () => {
		const prev = { ...legendConfigFromTheme(FROM), position: "left" as const }
		const next = rethemeLegend(prev, THEMED, FROM)
		expect(next).toMatchObject({ position: "left", showBorder: true, borderColor: "#123456" })
	})

	it("keeps one base-font knob and follows its siblings", () => {
		const prev = labelsFromTheme(FROM)
		prev.baseFont = {
			...prev.baseFont,
			titles: { ...prev.baseFont.titles, family: "Georgia" },
		}
		const to = { ...THEMED, titleFontFamily: "Inter", titlePrimarySize: 40, textFontSize: 9 }
		const next = rethemeLabels(prev, to, FROM)
		expect(next.baseFont.titles).toMatchObject({ family: "Georgia", primarySize: 40 })
		expect(next.baseFont.text.size).toBe(9)
	})

	it("keeps a user's hover and data-label picks, caption box and map fill", () => {
		const seededTip = tooltipConfigFromTheme(FROM)
		const tooltip = { ...seededTip, hoverFade: !seededTip.hoverFade }
		expect(rethemeTooltip(tooltip, THEMED, FROM).hoverFade).toBe(!seededTip.hoverFade)
		const labels = { ...dataLabelsConfigFromTheme(FROM), fontSize: 23 }
		expect(rethemeDataLabels(labels, THEMED, FROM).fontSize).toBe(23)
		const caption = { ...captionConfigFromTheme(FROM), padding: 17 }
		expect(rethemeCaption(caption, THEMED, FROM)).toMatchObject({ padding: 17, borderWidth: 3 })
		const table = { ...dataTableConfigFromTheme(FROM), placement: "tabs" as const }
		expect(rethemeDataTable(table, { ...THEMED, dataTablePlacement: "below" }, FROM).placement).toBe("tabs")
		const map = { ...mapConfigFromTheme(FROM), noDataFill: "#ffffff" }
		expect(rethemeMap(map, THEMED, FROM)).toMatchObject({ noDataFill: "#ffffff", noDataPatternInk: "#444444" })
	})

	it("treats an absent saved field as the theme's own and follows", () => {
		const { defaultRadius: _dropped, ...sparse } = seeded
		const next = rethemeChannelConfigs(sparse as typeof seeded, { ...THEMED, defaultRadius: 3 }, FROM)
		expect(next.defaultRadius).toBe(3)
	})
})

describe("panel border", () => {
	it("is off by default and takes the theme's x spine color", () => {
		expect(panelBorderFromTheme(LIGHT_THEME_BASE)).toEqual({
			enabled: false,
			width: 1,
			color: LIGHT_THEME_BASE.xSpineColor ?? LIGHT_THEME_BASE.spineColor,
		})
	})

	it("seeds the theme's values", () => {
		const theme: Theme = {
			...LIGHT_THEME_BASE,
			panelBorderEnabled: true,
			panelBorderWidth: 3,
			panelBorderColor: "#abcdef",
		}
		expect(panelBorderFromTheme(theme)).toEqual({
			enabled: true,
			width: 3,
			color: "#abcdef",
		})
	})

	it("follows a theme switch", () => {
		const theme: Theme = {
			...LIGHT_THEME_BASE,
			panelBorderEnabled: true,
			panelBorderWidth: 2,
			panelBorderColor: "#112233",
		}
		const next = rethemeChannelConfigs(
			{ panelBorder: { enabled: false, width: 1, color: "#000000" } },
			theme
		)
		expect(next.panelBorder).toEqual({
			enabled: true,
			width: 2,
			color: "#112233",
		})
	})
})
