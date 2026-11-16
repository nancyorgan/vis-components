import { describe, expect, it } from "vitest"

import type { ChannelConfigs } from "./channelConfig"
import {
	followAreaPaletteDefaults,
	switchConnectionFill,
	withAreaFillFollowingColor,
	withAreaPaletteDefaults,
	withoutAreaPaletteDefaults,
} from "./connectionEdits"
import { LIGHT_THEME_BASE } from "./systemThemes"
import { configsFromTheme, explainChannelCustomization } from "./themeConfig"
import { emptyEncodings, type FieldType, type Theme } from "./types"

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

describe("a Color variable picked on a chart that is already a filled area", () => {
	// The palettes used to be set at the moment of filling alone, so a
	// single-series area given a Color variable afterwards kept the regular
	// palette for its bodies.
	const AREA = {
		...emptyEncodings(),
		x: { field: "month" },
		length: { field: "sales" },
		connection: { field: "region" },
		hue: { field: "region" },
	}
	const typeOf = (name: string): FieldType => (name === "sales" ? "quantitative" : "categorical")
	const filled = (): ChannelConfigs => ({
		...fresh(),
		connection: { ...fresh().connection!, fill: "area" },
	})

	it("puts the body on the fill palette and the line on the categorical one", () => {
		const configs = withAreaFillFollowingColor(filled(), AREA, "categorical", THEME, typeOf)
		expect(configs.categoricalPaletteId).toBe("a-fill")
		expect(configs.connection?.linePaletteId).toBe("a-main")
	})

	it("leaves a palette the user picked, and a non-categorical Color variable", () => {
		const picked = { ...filled(), categoricalPaletteId: "a-other", categoricalPalette: ["#000011", "#000022"] }
		expect(withAreaFillFollowingColor(picked, AREA, "categorical", THEME, typeOf)).toBe(picked)
		const cfg = filled()
		expect(withAreaFillFollowingColor(cfg, AREA, "quantitative", THEME, typeOf)).toBe(cfg)
	})

	it("does nothing on a chart that is not an area, even with a stored area fill", () => {
		// The stored fill outlives a change of chart type: bars must not take
		// the pale fill palette because the chart was once an area.
		const BARS = { ...emptyEncodings(), x: { field: "month" }, length: { field: "sales" }, hue: { field: "region" } }
		const cfg = filled()
		expect(withAreaFillFollowingColor(cfg, BARS, "categorical", THEME, typeOf)).toBe(cfg)
	})

	it("does nothing while the area is unfilled, or the theme has no fill palette", () => {
		const unfilled = fresh()
		expect(withAreaFillFollowingColor(unfilled, AREA, "categorical", THEME, typeOf)).toBe(unfilled)
		const plain = themed("b", false)
		const cfg: ChannelConfigs = { ...configsFromTheme(plain), connection: { ...configsFromTheme(plain).connection!, fill: "area" } }
		expect(withAreaFillFollowingColor(cfg, AREA, "categorical", plain, typeOf)).toBe(cfg)
	})
})
