import { describe, expect, it } from "vitest"

import { DEFAULT_CATEGORICAL_HUE_CONFIG, type ChannelConfigs, type HueConfig } from "./channelConfig"
import { colorSlotEdited } from "./colorSlots"
import {
	isLineChart,
	keepLineFollowingColor,
	lineFollowsColorNote,
	withLineFollowingColor,
} from "./lineFollowsColor"
import { pickHuePalette } from "./paletteEdits"
import { CATEGORICAL_HUE_PALETTE } from "./scales"
import { seedColorSlot } from "./seedColorSlot"
import { LIGHT_THEME_BASE as theme } from "./systemThemes"
import { channelHasCustomization, configsFromTheme } from "./themeConfig"
import { emptyEncodings, type Encodings } from "./types"

const LINE: Encodings = {
	...emptyEncodings(),
	x: { field: "Quarter" },
	y: { field: "rate" },
	hue: { field: "Region" },
	connection: { field: "Region" },
}
const base = configsFromTheme(theme)
const themeCategorical = theme.categoricalPalettes.find(
	(p) => p.id === theme.defaultCategoricalPaletteId
)!
const otherCategorical = theme.categoricalPalettes.find((p) => p.id !== themeCategorical.id)!

const GRADIENT: Extract<HueConfig, { kind: "quantitative" }> = {
	kind: "quantitative",
	palette: "customLinear",
	lowColor: "#123456",
	lowValue: null,
	midColor: null,
	midValue: null,
	highColor: "#fedcba",
	highValue: null,
	stackMode: "stack",
}

describe("isLineChart", () => {
	it("is x + y + a series on Connection that is neither axis, nothing on Length", () => {
		expect(isLineChart(LINE)).toBe(true)
	})
	it("is not a dumbbell (connection = y), a connection on x, an area chart, bars, or a scatter", () => {
		expect(isLineChart({ ...LINE, connection: { field: "rate" } })).toBe(false)
		expect(isLineChart({ ...LINE, connection: { field: "Quarter" } })).toBe(false)
		expect(isLineChart({ ...LINE, y: { field: null }, length: { field: "rate" } })).toBe(false)
		expect(isLineChart({ ...LINE, length: { field: "rate" } })).toBe(false)
		expect(isLineChart({ ...LINE, connection: { field: null } })).toBe(false)
	})
})

describe("withLineFollowingColor", () => {
	it("sets Line > Vary by to the Color variable on the theme's categorical palette", () => {
		const next = withLineFollowingColor(base, LINE, "categorical", theme)
		const line = next.colorSlots?.line
		expect(line).toMatchObject({
			...seedColorSlot("Region", "categorical", theme),
			field: "Region",
			singleColor: theme.connectionColor,
		})
		expect(line?.palette).toEqual(themeCategorical.colors)
	})

	it("carries a Color palette changed off the theme default onto the line", () => {
		const picked = pickHuePalette(base, theme, otherCategorical.id, "categorical")
		const line = withLineFollowingColor(picked, LINE, "categorical", theme).colorSlots?.line
		expect(line?.paletteId).toBe(otherCategorical.id)
		expect(line?.palette).toEqual(otherCategorical.colors)
	})

	it("an ordinal Color variable: the line takes the ordinal ramp the points draw with", () => {
		const ord = theme.ordinalPalettes[1]
		const picked = pickHuePalette(base, theme, ord.id, "ordinal")
		const line = withLineFollowingColor(picked, LINE, "ordinal", theme).colorSlots?.line
		expect(line?.field).toBe("Region")
		expect(line?.paletteId).toBe(ord.id)
		expect(line?.palette).toEqual(ord.colors)
		expect(line?.hue).toMatchObject({ kind: "categorical", colors: {} })
	})

	it("a quantitative Color variable: the line takes the Color gradient", () => {
		const configs: ChannelConfigs = { ...base, hue: GRADIENT }
		const enc = { ...LINE, hue: { field: "rate" } }
		const line = withLineFollowingColor(configs, enc, "quantitative", theme).colorSlots?.line
		expect(line?.field).toBe("rate")
		expect(line?.hue).toEqual(GRADIENT)
	})

	it("works with no stored configs at all", () => {
		const line = withLineFollowingColor({}, LINE, "categorical", theme).colorSlots?.line
		expect(line?.field).toBe("Region")
		expect(line?.singleColor).toBe(theme.connectionColor)
	})

	it("a well-formed default slot (a reset) still follows", () => {
		const configs: ChannelConfigs = {
			...base,
			colorSlots: { line: { field: null, singleColor: theme.connectionColor } },
		}
		expect(withLineFollowingColor(configs, LINE, "categorical", theme).colorSlots?.line?.field).toBe(
			"Region"
		)
	})

	describe("leaves the line alone", () => {
		const same = (configs: ChannelConfigs, enc: Encodings = LINE) =>
			expect(withLineFollowingColor(configs, enc, "categorical", theme)).toBe(configs)

		it("with no Color variable, or no type for it", () => {
			same(base, { ...LINE, hue: { field: null } })
			expect(withLineFollowingColor(base, LINE, null, theme)).toBe(base)
		})
		it("on charts that aren't line charts: dumbbell, bars with hue, areas, connection on x", () => {
			same(base, { ...LINE, connection: { field: "rate" } })
			same(base, { ...LINE, y: { field: null }, length: { field: "rate" }, connection: { field: null } })
			same(base, { ...LINE, y: { field: null }, length: { field: "rate" } })
			same(base, { ...LINE, connection: { field: "Quarter" } })
		})
		it("when the slot already varies by the Color variable", () => {
			same({ ...base, colorSlots: { line: { field: "Region", singleColor: "#000" } } })
		})
		it("when the slot varies by another variable", () => {
			same({
				...base,
				colorSlots: { line: { ...seedColorSlot("Other", "categorical", theme), singleColor: "#000", field: "Other" } },
			})
		})
		it("when the slot is a single color other than the theme default", () => {
			same({ ...base, colorSlots: { line: { field: null, singleColor: "#ff0000" } } })
		})
		it("when an older line color setting is set (global, per value, or a line palette)", () => {
			const conn = base.connection!
			same({ ...base, connection: { ...conn, strokeColor: "#ff0000" } })
			same({ ...base, connection: { ...conn, lineColors: { West: "#ff0000" } } })
			same({ ...base, connection: { ...conn, linePaletteId: otherCategorical.id, linePalette: otherCategorical.colors } })
		})
	})
})

describe("Color moves from one variable to another", () => {
	const ON_SEGMENT: Encodings = { ...LINE, hue: { field: "Segment" } }
	const followingRegion = withLineFollowingColor(base, LINE, "categorical", theme)
	const previous = { hueField: "Region", configs: followingRegion }

	it("lines that followed the old variable re-seed to the new one on Color's palette", () => {
		const line = withLineFollowingColor(followingRegion, ON_SEGMENT, "categorical", theme, previous)
			.colorSlots?.line
		expect(line).toMatchObject({ field: "Segment", singleColor: theme.connectionColor })
		expect(line?.palette).toEqual(themeCategorical.colors)
	})

	it("categorical to quantitative: the line takes Color's gradient, no leftover palette", () => {
		const configs: ChannelConfigs = { ...followingRegion, hue: GRADIENT }
		const enc = { ...LINE, hue: { field: "rate" } }
		const line = withLineFollowingColor(configs, enc, "quantitative", theme, previous).colorSlots?.line
		expect(line?.field).toBe("rate")
		expect(line?.hue).toEqual(GRADIENT)
		expect(line?.palette).toBeUndefined()
		expect(colorSlotEdited("line", line, configs, theme, "rate")).toBe(false)
	})

	it("a line slot someone edited on the old variable stays on it", () => {
		const slot = followingRegion.colorSlots!.line!
		const edits = [
			{ ...slot, palette: otherCategorical.colors, paletteId: otherCategorical.id },
			{ ...slot, hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: { West: "#ff0000" } } },
			{ ...slot, colorRules: [{ condition: "> 0", color: "#ff0000" }] },
		]
		for (const edited of edits) {
			const configs = { ...followingRegion, colorSlots: { line: edited } }
			const prev = { hueField: "Region", configs }
			expect(withLineFollowingColor(configs, ON_SEGMENT, "categorical", theme, prev)).toBe(configs)
		}
	})

	it("a slot on another variable than the old Color, or a single color, stays", () => {
		const other: ChannelConfigs = {
			...base,
			colorSlots: { line: { ...seedColorSlot("Other", "categorical", theme), singleColor: "#000", field: "Other" } },
		}
		const prev = { hueField: "Region", configs: other }
		expect(withLineFollowingColor(other, ON_SEGMENT, "categorical", theme, prev)).toBe(other)
		const single: ChannelConfigs = { ...base, colorSlots: { line: { field: null, singleColor: "#ff0000" } } }
		expect(
			withLineFollowingColor(single, ON_SEGMENT, "categorical", theme, { hueField: "Region", configs: single })
		).toBe(single)
	})

	it("unmapping Color leaves the slot as it is", () => {
		const unmapped = { ...LINE, hue: { field: null } }
		expect(withLineFollowingColor(followingRegion, unmapped, null, theme, previous)).toBe(followingRegion)
	})
})

describe("the seeded Line slot is not an edit", () => {
	it("no Color dot and no Line subsection dot", () => {
		const next = withLineFollowingColor(base, LINE, "categorical", theme)
		expect(colorSlotEdited("line", next.colorSlots?.line, next, theme, "Region")).toBe(false)
		expect(channelHasCustomization("hue", next, theme, true, "Region")).toBe(false)
		// Without the Color variable it reads as a field mapping, an edit.
		expect(colorSlotEdited("line", next.colorSlots?.line, next, theme)).toBe(true)
		// The same on a Color palette changed off the theme default.
		const picked = pickHuePalette(base, theme, otherCategorical.id, "categorical")
		const followed = withLineFollowingColor(picked, LINE, "categorical", theme)
		expect(colorSlotEdited("line", followed.colorSlots?.line, followed, theme, "Region")).toBe(false)
	})
	it("a per-value line color or another palette is an edit", () => {
		const next = withLineFollowingColor(base, LINE, "categorical", theme)
		const line = next.colorSlots!.line!
		const recolored = { ...line, hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: { West: "#ff0000" } } }
		expect(colorSlotEdited("line", recolored, next, theme, "Region")).toBe(true)
		const repaletted = { ...line, palette: otherCategorical.colors }
		expect(colorSlotEdited("line", repaletted, next, theme, "Region")).toBe(true)
	})
	it("a quantitative follow-seed is not an edit until the gradient differs", () => {
		const configs: ChannelConfigs = { ...base, hue: GRADIENT }
		const enc = { ...LINE, hue: { field: "rate" } }
		const next = withLineFollowingColor(configs, enc, "quantitative", theme)
		expect(colorSlotEdited("line", next.colorSlots?.line, next, theme, "rate")).toBe(false)
		const changed = { ...next, hue: { ...GRADIENT, highColor: "#000000" } }
		expect(colorSlotEdited("line", next.colorSlots?.line, changed, theme, "rate")).toBe(true)
	})
})

describe("lineFollowsColorNote", () => {
	it("names the variable, without em dashes", () => {
		const note = lineFollowsColorNote("Region")
		expect(note).toContain('"Region"')
		expect(note).not.toContain("—")
	})
})

describe("keepLineFollowingColor (a change to Color's own palette or gradient)", () => {
	const followed = withLineFollowingColor(base, LINE, "categorical", theme)

	it("a new Color palette carries the following line along, with no dot", () => {
		const next = keepLineFollowingColor(
			followed,
			pickHuePalette(followed, theme, otherCategorical.id, "categorical"),
			"Region",
			"categorical",
			theme
		)
		expect(next.colorSlots?.line?.field).toBe("Region")
		expect(next.colorSlots?.line?.palette).toEqual(otherCategorical.colors)
		expect(colorSlotEdited("line", next.colorSlots?.line, next, theme, "Region")).toBe(false)
	})

	it("a new Color gradient carries a following quantitative line along", () => {
		const quant = withLineFollowingColor(
			{ ...base, hue: GRADIENT },
			LINE,
			"quantitative",
			theme
		)
		const regraded = { ...quant, hue: { ...GRADIENT, highColor: "#00ff00" } }
		const next = keepLineFollowingColor(quant, regraded, "Region", "quantitative", theme)
		expect(next.colorSlots?.line?.hue).toEqual(regraded.hue)
	})

	it("a line someone edited stays as it was", () => {
		const edited = {
			...followed,
			colorSlots: {
				...followed.colorSlots,
				line: { ...followed.colorSlots!.line!, palette: ["#111111", "#222222"] },
			},
		}
		const changed = pickHuePalette(edited, theme, otherCategorical.id, "categorical")
		const next = keepLineFollowingColor(edited, changed, "Region", "categorical", theme)
		expect(next).toBe(changed)
		expect(next.colorSlots?.line?.palette).toEqual(["#111111", "#222222"])
	})

	it("a change that rewrites the Line slot itself, or no Color variable, is left alone", () => {
		const rewritten = {
			...followed,
			colorSlots: { ...followed.colorSlots, line: { field: null, singleColor: "#abcdef" } },
		}
		expect(keepLineFollowingColor(followed, rewritten, "Region", "categorical", theme)).toBe(
			rewritten
		)
		const changed = pickHuePalette(followed, theme, otherCategorical.id, "categorical")
		expect(keepLineFollowingColor(followed, changed, null, "categorical", theme)).toBe(changed)
	})
})

describe("a chart with no Color palette stored (an older chart, or one built by hand)", () => {
	const bare: ChannelConfigs = { ...base }
	delete bare.categoricalPalette
	delete bare.categoricalPaletteId

	it("the line takes the palette the points actually draw (the hue scale's built-in), not the theme default", () => {
		const next = withLineFollowingColor(bare, LINE, "categorical", theme)
		expect(next.colorSlots?.line?.palette).toEqual([...CATEGORICAL_HUE_PALETTE])
		expect(next.colorSlots?.line?.palette).not.toEqual(themeCategorical.colors)
	})

	it("and that line still reads as following Color (no dot)", () => {
		const next = withLineFollowingColor(bare, LINE, "categorical", theme)
		expect(colorSlotEdited("line", next.colorSlots?.line, next, theme, "Region")).toBe(false)
	})
})
