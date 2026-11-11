import { describe, expect, it } from "vitest"

import type { ChannelConfigs } from "./channelConfig"
import {
	followAreaPaletteDefaults,
	switchConnectionFill,
	withAreaPaletteDefaults,
	withoutAreaPaletteDefaults,
} from "./connectionEdits"
import { LIGHT_THEME_BASE } from "./systemThemes"
import { configsFromTheme, explainChannelCustomization } from "./themeConfig"
import { emptyEncodings, type Theme } from "./types"

const palettes = (prefix: string) => [
	{ id: `${prefix}-main`, name: "Main", colors: ["#110000", "#220000"] },
	{ id: `${prefix}-fill`, name: "Fill", colors: ["#ffeeee", "#ffdddd"] },
	{ id: `${prefix}-other`, name: "Other", colors: ["#000011", "#000022"] },
]
const themed = (prefix: string, fillPalette = true): Theme => ({
	...LIGHT_THEME_BASE,
	categoricalPalettes: palettes(prefix),
	defaultCategoricalPaletteId: `${prefix}-main`,
	defaultFillPaletteId: fillPalette ? `${prefix}-fill` : null,
})
const THEME = themed("a")
const fresh = (): ChannelConfigs => configsFromTheme(THEME)
const LINE = {
	...emptyEncodings(),
	x: { field: "month" },
	y: { field: "sales" },
	connection: { field: "region" },
	hue: { field: "region" },
}

describe("filled-area palette defaults", () => {
	it("filling a line chart puts the body on the fill palette and the line on the categorical one", () => {
		const { configs } = switchConnectionFill(LINE, fresh(), "area", THEME)
		expect(configs.categoricalPaletteId).toBe("a-fill")
		expect(configs.categoricalPalette).toEqual(["#ffeeee", "#ffdddd"])
		expect(configs.connection?.linePaletteId).toBe("a-main")
		expect(configs.connection?.linePalette).toEqual(["#110000", "#220000"])
		// Those ARE the area's defaults, so the Color dot stays off.
		expect(explainChannelCustomization("hue", configs, THEME, true)).toEqual([])
	})

	it("unfilling returns both to the regular defaults", () => {
		const area = switchConnectionFill(LINE, fresh(), "area", THEME)
		const { configs } = switchConnectionFill(area.encodings, area.configs, "line", THEME)
		expect(configs.categoricalPaletteId).toBe("a-main")
		expect(configs.categoricalPalette).toEqual(["#110000", "#220000"])
		expect(configs.connection?.linePaletteId ?? null).toBeNull()
		expect(configs.connection?.linePalette ?? null).toBeNull()
	})

	it("leaves a picked palette or a styled line alone", () => {
		const picked = { ...fresh(), categoricalPaletteId: "a-other", categoricalPalette: ["#000011"] }
		expect(withAreaPaletteDefaults(picked, THEME)).toBe(picked)
		const styled = {
			...fresh(),
			connection: { ...fresh().connection!, strokeColor: "#ff0000" },
		}
		expect(withAreaPaletteDefaults(styled, THEME)).toBe(styled)
		// …and unfilling keeps a palette that isn't the area default.
		expect(withoutAreaPaletteDefaults(picked, THEME)).toBe(picked)
	})

	it("does nothing without a separate fill palette, a Color variable, or for a non-categorical one", () => {
		const cfg = fresh()
		expect(withAreaPaletteDefaults(cfg, themed("a", false))).toBe(cfg)
		expect(withAreaPaletteDefaults(cfg, THEME, null)).toBe(cfg)
		expect(withAreaPaletteDefaults(cfg, THEME, "ordinal")).toBe(cfg)
		expect(withAreaPaletteDefaults(cfg, THEME, "quantitative")).toBe(cfg)
	})

	it("a theme switch moves an area at the defaults onto the new theme's palettes", () => {
		const next = themed("b")
		const prev = withAreaPaletteDefaults(
			{ ...fresh(), connection: { ...fresh().connection!, fill: "area" } },
			THEME
		)
		// What the generic re-theme leaves: the old theme's picks, kept as "user picks".
		const out = followAreaPaletteDefaults(prev, prev, next, THEME)
		expect(out.categoricalPaletteId).toBe("b-fill")
		expect(out.connection?.linePaletteId).toBe("b-main")
		// A hand-picked fill palette is not followed.
		const picked = { ...prev, categoricalPaletteId: "a-other" }
		expect(followAreaPaletteDefaults(picked, picked, next, THEME)).toBe(picked)
	})
})
