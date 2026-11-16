import { describe, expect, it } from "vitest"

import type { ChannelConfigs } from "./channelConfig"
import { AreasXMode } from "./chartModes/areasX"
import { BarsXMode } from "./chartModes/barsX"
import { ScatterMode } from "./chartModes/scatter"
import {
	areaBodyAutoFill,
	defaultColorSlot,
	isDefaultColorSlot,
	withAreaBodyDefault,
	withColorSlotDefaults,
} from "./colorSlotDefaults"
import { LIGHT_THEME_BASE } from "./systemThemes"
import { emptyEncodings, type Encodings, type Theme } from "./types"

const MARKS = { id: "marks", name: "Marks", colors: ["#1f77b4", "#ff7f0e"] }
const TINTS = { id: "tints", name: "Tints", colors: ["#c6dbef", "#ffd8b1"] }

const theme = (fillId: string | null | undefined): Theme => ({
	...LIGHT_THEME_BASE,
	categoricalPalettes: [MARKS, TINTS],
	defaultCategoricalPaletteId: "marks",
	defaultFillPaletteId: fillId,
})

const violinOn: ChannelConfigs = {
	y: { distributionOverlay: { showDensityViolin: true } },
	categoricalPalette: ["#aa0000", "#00aa00"],
	categoricalPaletteId: "visual-pick",
} as unknown as ChannelConfigs

const densityFillOn: ChannelConfigs = {
	y: {
		distributionOverlay: { showDensityCurve: true },
		histogram: { densityFill: true },
	},
} as unknown as ChannelConfigs

const enc = (patch: Partial<Encodings>): Encodings => ({ ...emptyEncodings(), ...patch })
const byCategory = enc({ x: { field: "proc" }, y: { field: "value" }, hue: { field: "proc" } })

describe("defaultColorSlot", () => {
	it("violin / box fill varies by the Color variable in the theme's FILL palette", () => {
		const d = defaultColorSlot("violinFill", byCategory, violinOn, "categorical", theme("tints"))
		expect(d?.field).toBe("proc")
		expect(d?.paletteId).toBe("tints")
		expect(d?.palette).toEqual(TINTS.colors)
	})

	it("falls back to the default categorical palette when the theme sets no fill palette", () => {
		for (const unset of [null, undefined]) {
			const d = defaultColorSlot("violinFill", byCategory, violinOn, "categorical", theme(unset))
			expect(d?.paletteId).toBe("marks")
			expect(d?.palette).toEqual(MARKS.colors)
		}
	})

	it("violin / box outline varies by the Color variable in Color's OWN palette", () => {
		const d = defaultColorSlot("violinStroke", byCategory, violinOn, "categorical", theme("tints"))
		expect(d?.field).toBe("proc")
		expect(d?.paletteId).toBe("visual-pick")
		expect(d?.palette).toEqual(["#aa0000", "#00aa00"])
	})

	it("violin / box stays one color when Color is a different variable, a gradient, or unmapped", () => {
		const t = theme("tints")
		const other = enc({ x: { field: "proc" }, y: { field: "value" }, hue: { field: "site" } })
		expect(defaultColorSlot("violinFill", other, violinOn, "categorical", t)).toBeUndefined()
		expect(defaultColorSlot("violinFill", byCategory, violinOn, "quantitative", t)).toBeUndefined()
		const noHue = enc({ x: { field: "proc" }, y: { field: "value" } })
		expect(defaultColorSlot("violinFill", noHue, violinOn, null, t)).toBeUndefined()
	})

	it("density-curve fill follows any discrete Color variable, only while the curve is filled", () => {
		const t = theme("tints")
		const e = enc({ y: { field: "value" }, hue: { field: "site" } })
		const d = defaultColorSlot("densityCurveFill", e, densityFillOn, "categorical", t)
		expect(d?.field).toBe("site")
		expect(d?.paletteId).toBe("tints")
		const unfilled = {
			y: { distributionOverlay: { showDensityCurve: true } },
		} as unknown as ChannelConfigs
		expect(defaultColorSlot("densityCurveFill", e, unfilled, "categorical", t)).toBeUndefined()
	})

	it("other slots have no Color-following default", () => {
		expect(
			defaultColorSlot("densityCurveStroke", byCategory, densityFillOn, "categorical", theme(null))
		).toBeUndefined()
	})
})

describe("defaultColorSlot with NO Color variable", () => {
	const noHue = enc({ x: { field: "proc" }, y: { field: "value" } })
	const marks2 = (cfg: ChannelConfigs): ChannelConfigs =>
		({ ...cfg, defaultFill: "#FF7F0E" }) as ChannelConfigs

	it("fills with the fill-palette color ANALOGOUS to the marks' single color", () => {
		// The marks draw the 2nd categorical color → the body the 2nd tint.
		const t = theme("tints")
		const cfg = { ...marks2(violinOn), categoricalPalette: undefined } as unknown as ChannelConfigs
		expect(defaultColorSlot("violinFill", noHue, cfg, null, t)).toEqual({
			field: null,
			singleColor: "#ffd8b1",
		})
		const density = marks2(densityFillOn)
		expect(defaultColorSlot("densityCurveFill", enc({ y: { field: "value" } }), density, null, t))
			.toEqual({ field: null, singleColor: "#ffd8b1" })
	})

	it("looks the mark color up in the visual's own palette first", () => {
		const cfg = { ...violinOn, defaultFill: "#00aa00" } as ChannelConfigs
		expect(defaultColorSlot("violinFill", noHue, cfg, null, theme("tints"))?.singleColor).toBe(
			"#ffd8b1"
		)
	})

	it("keeps the usual single color without a theme fill palette, or when the mark color isn't a palette entry", () => {
		const cfg = { ...violinOn, categoricalPalette: undefined } as unknown as ChannelConfigs
		expect(defaultColorSlot("violinFill", noHue, marks2(cfg), null, theme(null))).toBeUndefined()
		const custom = { ...cfg, defaultFill: "#123456" } as ChannelConfigs
		expect(defaultColorSlot("violinFill", noHue, custom, null, theme("tints"))).toBeUndefined()
	})

	it("never applies to the outline", () => {
		expect(
			defaultColorSlot("violinStroke", noHue, marks2(violinOn), null, theme("tints"))
		).toBeUndefined()
	})
})

describe("bodies that used to match their marks: a radar polygon, a confidence band", () => {
	// On Auto a polygon filled with its series' point color and a band with
	// its group's. They are bodies under a line / points, so on Auto they now
	// take the theme's fill palette — where the theme has one, and while the
	// marks' Color still comes from the theme's own palette (the fill palette
	// is that palette's pale twin, position for position).
	const themeColors: ChannelConfigs = {
		categoricalPaletteId: "marks",
		categoricalPalette: MARKS.colors,
	} as unknown as ChannelConfigs
	const radar = enc({ r: { field: "value" }, angle: { field: "axis" }, connection: { field: "team" }, hue: { field: "team" } })
	const perGroupFit = (groupField: string): ChannelConfigs =>
		({ ...themeColors, x: { regression: { enabled: true, showCi: true, perGroup: true, groupField } } }) as unknown as ChannelConfigs
	const scatter = enc({ x: { field: "a" }, y: { field: "b" }, hue: { field: "team" } })

	it("a radar polygon varies by the Color variable in the theme's fill palette", () => {
		const d = defaultColorSlot("polygonFill", radar, themeColors, "categorical", theme("tints"))
		expect(d?.field).toBe("team")
		expect(d?.paletteId).toBe("tints")
		expect(d?.palette).toEqual(TINTS.colors)
	})

	it("a single-series polygon takes the fill-palette twin of the marks' color", () => {
		const noHue = enc({ r: { field: "value" }, angle: { field: "axis" }, connection: { field: "team" } })
		const cfg = { ...themeColors, defaultFill: "#ff7f0e" } as unknown as ChannelConfigs
		expect(defaultColorSlot("polygonFill", noHue, cfg, null, theme("tints"))).toEqual({
			field: null,
			singleColor: "#ffd8b1",
		})
	})

	it("a confidence band follows when the fits are split by the Color variable", () => {
		const d = defaultColorSlot("regressionCiFill", scatter, perGroupFit("team"), "categorical", theme("tints"))
		expect(d?.field).toBe("team")
		expect(d?.paletteId).toBe("tints")
	})

	it("a pooled band, or fits split by another variable, keep the band's own color", () => {
		const t = theme("tints")
		expect(defaultColorSlot("regressionCiFill", scatter, perGroupFit("site"), "categorical", t)).toBeUndefined()
		const pooled = { ...themeColors, x: { regression: { enabled: true, showCi: true } } } as unknown as ChannelConfigs
		expect(defaultColorSlot("regressionCiFill", scatter, pooled, "categorical", t)).toBeUndefined()
		const noHue = enc({ x: { field: "a" }, y: { field: "b" } })
		expect(defaultColorSlot("regressionCiFill", noHue, pooled, null, t)).toBeUndefined()
	})

	it("keeps matching the marks when the theme has no fill palette", () => {
		for (const unset of [null, undefined]) {
			expect(defaultColorSlot("polygonFill", radar, themeColors, "categorical", theme(unset))).toBeUndefined()
			expect(
				defaultColorSlot("regressionCiFill", scatter, perGroupFit("team"), "categorical", theme(unset))
			).toBeUndefined()
		}
	})

	it("keeps matching the marks when Color uses a palette of the user's, or a recolored category", () => {
		const t = theme("tints")
		const ownPalette = { categoricalPaletteId: "visual-pick", categoricalPalette: ["#aa0000", "#00aa00"] } as unknown as ChannelConfigs
		expect(defaultColorSlot("polygonFill", radar, ownPalette, "categorical", t)).toBeUndefined()
		const recolored = {
			...themeColors,
			hue: { kind: "categorical", colors: { red: "#123456" } },
		} as unknown as ChannelConfigs
		expect(defaultColorSlot("polygonFill", radar, recolored, "categorical", t)).toBeUndefined()
	})

	it("keeps matching the marks for a gradient or an ordinal Color variable", () => {
		const t = theme("tints")
		expect(defaultColorSlot("polygonFill", radar, themeColors, "quantitative", t)).toBeUndefined()
		expect(defaultColorSlot("polygonFill", radar, themeColors, "ordinal", t)).toBeUndefined()
	})

	it("the render configs carry the derived target; a stored one wins", () => {
		const t = theme("tints")
		const derived = withColorSlotDefaults(themeColors, radar, "categorical", t)
		expect(derived.colorSlots?.polygonFill?.paletteId).toBe("tints")
		const stored = { ...themeColors, colorSlots: { polygonFill: { field: null, singleColor: "#000000" } } } as unknown as ChannelConfigs
		expect(withColorSlotDefaults(stored, radar, "categorical", t).colorSlots?.polygonFill).toEqual({
			field: null,
			singleColor: "#000000",
		})
	})
})

describe("isDefaultColorSlot", () => {
	const dfltSingle = { field: null, singleColor: "#ffd8b1" }
	const dfltMapped = { field: "proc", singleColor: "#dbdbdb", paletteId: "tints", palette: [] }

	it("a stored slot that says only the default is default", () => {
		expect(isDefaultColorSlot({ field: null, singleColor: "#ffd8b1" }, dfltSingle)).toBe(true)
		expect(isDefaultColorSlot({ ...dfltMapped, hue: { kind: "categorical", stackMode: "overlay", colors: {} } }, dfltMapped)).toBe(true)
	})

	it("a different color, field, palette, swatch or rule is an edit", () => {
		expect(isDefaultColorSlot({ field: null, singleColor: "#000000" }, dfltSingle)).toBe(false)
		expect(isDefaultColorSlot({ ...dfltMapped, field: "site" }, dfltMapped)).toBe(false)
		expect(isDefaultColorSlot({ ...dfltMapped, paletteId: "marks" }, dfltMapped)).toBe(false)
		expect(
			isDefaultColorSlot(
				{ ...dfltMapped, hue: { kind: "categorical", stackMode: "overlay", colors: { A: "#000" } } },
				dfltMapped
			)
		).toBe(false)
		expect(
			isDefaultColorSlot({ ...dfltSingle, colorRules: [{ condition: "> 0", color: "#000" }] } as never, dfltSingle)
		).toBe(false)
		expect(isDefaultColorSlot(dfltSingle, undefined)).toBe(false)
	})
})

describe("withColorSlotDefaults", () => {
	it("fills only UNTOUCHED slots; a stored slot wins", () => {
		const stored = { field: null, singleColor: "#123456" }
		const out = withColorSlotDefaults(
			{ ...violinOn, colorSlots: { violinFill: stored } },
			byCategory,
			"categorical",
			theme("tints")
		)
		expect(out.colorSlots?.violinFill).toBe(stored)
		expect(out.colorSlots?.violinStroke?.field).toBe("proc")
	})

	it("returns the same object when nothing applies", () => {
		const noHue = enc({ x: { field: "proc" }, y: { field: "value" } })
		expect(withColorSlotDefaults(violinOn, noHue, null, theme(null))).toBe(violinOn)
	})
})

describe("an area chart with nothing on Color", () => {
	// Areas colored by a variable already draw pale bodies under lines in the
	// marks' colors (the Color palette is the theme's fill palette, the Line
	// palette the marks'). A lone area drew body and line in one color; left
	// on the theme's color it now does the same: the body takes the fill
	// palette's twin, the line and points keep the series color.
	const SERIES = MARKS.colors[0] as string
	const TWIN = TINTS.colors[0] as string
	const fillTheme: Theme = { ...theme("tints"), defaultFill: SERIES }
	const area = enc({ x: { field: "month" }, length: { field: "sales" }, connection: { field: "region" } })
	const filled = (more: Record<string, unknown> = {}): ChannelConfigs =>
		({ connection: { fill: "area", strokeColor: null }, defaultFill: SERIES, ...more }) as unknown as ChannelConfigs

	it("the body takes the fill palette's twin of the series color", () => {
		expect(areaBodyAutoFill(AreasXMode, area, filled(), fillTheme)).toBe(TWIN)
		// The stored fill is the theme's whether or not it was written, and
		// however it is spelled.
		expect(areaBodyAutoFill(AreasXMode, area, filled({ defaultFill: undefined }), fillTheme)).toBe(TWIN)
		expect(areaBodyAutoFill(AreasXMode, area, filled({ defaultFill: SERIES.toUpperCase() }), fillTheme)).toBe(TWIN)
	})

	it("draws a pale body under a line in the series color", () => {
		const drawn = withAreaBodyDefault(filled(), AreasXMode, area, fillTheme)
		expect(drawn.defaultFill).toBe(TWIN)
		expect(drawn.connection?.strokeColor).toBe(SERIES)
	})

	it("a Line color the user picked wins", () => {
		const picked = filled({ connection: { fill: "area", strokeColor: "#222222" } })
		const drawn = withAreaBodyDefault(picked, AreasXMode, area, fillTheme)
		expect(drawn.defaultFill).toBe(TWIN)
		expect(drawn.connection?.strokeColor).toBe("#222222")
	})

	it("a fill the user picked is drawn as picked, body and line", () => {
		const picked = filled({ defaultFill: "#aa0000" })
		expect(areaBodyAutoFill(AreasXMode, area, picked, fillTheme)).toBeNull()
		expect(withAreaBodyDefault(picked, AreasXMode, area, fillTheme)).toBe(picked)
	})

	it("leaves everything else alone", () => {
		const untouched = (
			mode: Parameters<typeof areaBodyAutoFill>[0],
			e: Encodings,
			c: ChannelConfigs,
			t: Theme
		) => {
			expect(areaBodyAutoFill(mode, e, c, t)).toBeNull()
			expect(withAreaBodyDefault(c, mode, e, t)).toBe(c)
		}
		// An area drawn as lines has no body.
		untouched(AreasXMode, area, filled({ connection: { fill: "line" } }), fillTheme)
		// A variable on Color: the Color palette decides.
		untouched(AreasXMode, enc({ ...area, hue: { field: "region" } }), filled(), fillTheme)
		// A theme with no fill palette, or whose color has no twin in it.
		untouched(AreasXMode, area, filled(), { ...theme(null), defaultFill: SERIES })
		untouched(AreasXMode, area, filled({ defaultFill: "#123456" }), { ...theme("tints"), defaultFill: "#123456" })
		// Not an area chart — even with "fill area" left switched on.
		untouched(BarsXMode, area, filled(), fillTheme)
		untouched(ScatterMode, area, filled(), fillTheme)
	})
})
