import { describe, expect, it } from "vitest"

import { buildQuantHueConfigFromTheme } from "./hueDefaults"
import { seedColorSlot } from "./seedColorSlot"
import { SYSTEM_DARK_THEME, themeOf } from "./systemThemes"
import { resolveTextPalettePick } from "./themeConfig"

describe("seedColorSlot", () => {
	const theme = themeOf(SYSTEM_DARK_THEME)

	it("seeds a continuous field with the theme gradient", () => {
		expect(seedColorSlot("n", "quantitative", theme)).toEqual({
			field: "n",
			hue: buildQuantHueConfigFromTheme(theme),
		})
	})

	it("seeds a categorical field with the default categorical palette", () => {
		const pal = theme.categoricalPalettes.find(
			(p) => p.id === theme.defaultCategoricalPaletteId
		)
		const seeded = seedColorSlot("g", "categorical", theme)
		expect(seeded.field).toBe("g")
		expect(seeded.hue?.kind).toBe("categorical")
		expect(seeded.paletteId).toBe(pal?.id ?? null)
		expect(seeded.palette).toEqual(pal?.colors)
	})

	it("seeds a text slot with the theme's text palette", () => {
		const seeded = seedColorSlot("g", "categorical", theme, "text")
		expect(seeded.palette).toEqual(resolveTextPalettePick(theme).colors)
	})
})
