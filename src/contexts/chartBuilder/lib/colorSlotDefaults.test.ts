import { describe, expect, it } from "vitest"

import type { ChannelConfigs } from "./channelConfig"
import {
	defaultColorSlot,
	isDefaultColorSlot,
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
