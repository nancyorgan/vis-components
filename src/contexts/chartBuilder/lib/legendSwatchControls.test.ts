import { describe, expect, it } from "vitest"
import {
	isGlyphSection,
	legendSwatchControls,
	sectionOutlineWidthAuto,
	type SwatchMember,
} from "./legendSwatchControls"

const rows = (members: SwatchMember[]) => legendSwatchControls(members)

describe("legendSwatchControls — one rule for every legend section", () => {
	it("offers every property no member encodes", () => {
		expect(rows(["hue"])).toEqual({
			shape: true,
			shapeOptions: "all",
			size: true,
			fill: "encoded",
			outlineColor: true,
			outlineWidth: true,
		})
	})

	it("Saturation / Brightness / Opacity / Pattern never touch shape, size or outline", () => {
		const base = rows(["hue"])
		for (const extra of ["saturation", "brightness", "opacity", "pattern"] as const) {
			const r = rows(["hue", extra])
			expect(r.shape).toBe(base.shape)
			expect(r.size).toBe(base.size)
			expect(r.outlineColor).toBe(base.outlineColor)
			expect(r.outlineWidth).toBe(base.outlineWidth)
		}
	})

	it("a Shape member encodes the glyph; without Color the fill is pickable", () => {
		expect(rows(["shape"]).shape).toBe(false)
		expect(rows(["shape"]).fill).toBe("color")
		expect(rows(["hue", "shape"]).fill).toBe("encoded")
	})

	it("Pattern without Color makes the tiles the fill", () => {
		expect(rows(["pattern"]).fill).toBe("pattern")
		expect(rows(["saturation", "pattern"]).fill).toBe("pattern")
		expect(rows(["pattern", "shape"]).fill).toBe("pattern")
		expect(rows(["hue", "pattern", "shape"]).fill).toBe("encoded")
	})

	it("Outline color encodes only the stroke color — width stays pickable", () => {
		const r = rows(["hue", "outlineHue"])
		expect(r.outlineColor).toBe(false)
		expect(r.outlineWidth).toBe(true)
		expect(rows(["outlineHue"]).fill).toBe("hollow")
		expect(rows(["outlineHue", "shape"]).fill).toBe("color")
	})

	it("Size encodes the radius; Length segments take no glyph controls", () => {
		expect(rows(["hue", "area"]).size).toBe(false)
		expect(rows(["hue", "area"]).shape).toBe(true)
		expect(rows(["hue", "length"])).toMatchObject({
			shape: false,
			size: false,
			outlineColor: false,
			outlineWidth: false,
		})
	})

	it("glyph sections and their auto outline widths", () => {
		expect(isGlyphSection(["hue", "area"])).toBe(true)
		expect(isGlyphSection(["hue", "angle"])).toBe(true)
		expect(isGlyphSection(["hue", "angle", "length"])).toBe(false)
		expect(isGlyphSection(["hue"])).toBe(false)
		// Encoded strokes must stay visible on a 0-width theme.
		expect(sectionOutlineWidthAuto(["hue", "outlineHue"], false, 2)).toBe(1)
		// Quantitative glyphs mirror the marks' outline.
		expect(sectionOutlineWidthAuto(["hue", "area"], true, 1.5)).toBe(1.5)
		expect(sectionOutlineWidthAuto(["hue"], false, 1.5)).toBeNull()
	})
})

describe("shape options — the picker only offers what the swatch can draw", () => {
	it("glyph sections take glyphs; outline / dash swatches drop the rectangle", () => {
		expect(legendSwatchControls(["hue", "area"]).shapeOptions).toBe("glyphs")
		expect(legendSwatchControls(["hue", "outlineHue"]).shapeOptions).toBe("noRect")
		expect(legendSwatchControls(["hue", "pattern"]).shapeOptions).toBe("all")
		expect(
			legendSwatchControls(["hue", "pattern"], { connection: true }).shapeOptions
		).toBe("noRect")
		expect(legendSwatchControls(["hue"], { connection: true }).shapeOptions).toBe("all")
	})
})
