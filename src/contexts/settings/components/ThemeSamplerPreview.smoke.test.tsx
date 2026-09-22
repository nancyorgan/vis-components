import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SYSTEM_LIGHT_THEME, themeOf } from "../../chartBuilder/lib/systemThemes"
import type { Theme } from "../../chartBuilder/lib/types"

import { ThemeSamplerPreview } from "./ThemeSamplerPreview"

afterEach(cleanup)

const base: Theme = themeOf(SYSTEM_LIGHT_THEME)

const theme: Theme = {
	...base,
	categoricalPalettes: [
		{ id: "a", name: "A", colors: ["#a00001", "#a00002"] },
		{ id: "b", name: "B", colors: ["#b00001", "#b00002", "#b00003"] },
	],
	defaultCategoricalPaletteId: "b",
	ordinalPalettes: [{ id: "o", name: "O", colors: ["#c00001", "#c00002"] }],
	defaultOrdinalPaletteId: "o",
	linearGradients: [{ id: "l", name: "L", low: "#d00001", high: "#d00002" }],
	divergingGradients: [],
	defaultGradientPalette: "l",
	patternInkColor: "#e00001",
	patternBackgroundColor: "#e00002",
}

const fillsOf = (svg: Element) =>
	Array.from(svg.querySelectorAll("rect")).map((r) => r.getAttribute("fill"))

describe("ThemeSamplerPreview", () => {
	it("shows every palette, every gradient and the pattern set", () => {
		render(<ThemeSamplerPreview theme={theme} name="Sampled" />)
		const svg = screen.getByRole("img", { name: "Sampler of the Sampled theme" })
		const fills = new Set(fillsOf(svg))
		// Both categorical palettes and the ordinal one, not just the defaults.
		for (const c of ["#a00001", "#a00002", "#b00001", "#b00002", "#b00003", "#c00001"])
			expect(fills.has(c)).toBe(true)
		// One <linearGradient> per gradient, one <pattern> per pattern tile.
		expect(svg.querySelectorAll("linearGradient")).toHaveLength(1)
		expect(svg.querySelectorAll("stop")[0]?.getAttribute("stop-color")).toBe("#d00001")
		expect(svg.querySelectorAll("pattern")).toHaveLength(6)
		// The first pattern tile sits on the theme's pattern background.
		expect(
			svg.querySelector("pattern rect")?.getAttribute("fill")
		).toBe("#e00002")
	})

	it("puts the second row of pattern tiles on the default palette's colors", () => {
		render(<ThemeSamplerPreview theme={theme} name="Sampled" />)
		const svg = screen.getByRole("img", { name: "Sampler of the Sampled theme" })
		// Each tile's first rect is its background; the checker pattern adds
		// ink rects after it.
		const tileBackgrounds = Array.from(svg.querySelectorAll("pattern")).map((p) =>
			p.querySelector("rect")?.getAttribute("fill")
		)
		expect(tileBackgrounds).toEqual([
			"#e00002",
			"#e00002",
			"#e00002",
			"#b00001",
			"#b00002",
			"#b00003",
		])
	})
})
