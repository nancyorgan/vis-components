import { describe, expect, it } from "vitest"

import type { SavedCategoricalPalette } from "../../../chartBuilder/lib/types"

import { reorderPaletteColors, reorderPalettes } from "./paletteHelpers"

const PALETTE: SavedCategoricalPalette = {
	id: "p",
	name: "P",
	colors: ["#a", "#b", "#c", "#d"],
}

describe("reorderPaletteColors", () => {
	it("moves a swatch forward into a later gap", () => {
		// Drag A into the gap after C (slot 3) → B, C, A, D.
		expect(reorderPaletteColors(PALETTE, 0, 3)?.colors).toEqual([
			"#b",
			"#c",
			"#a",
			"#d",
		])
	})

	it("moves a swatch backward into an earlier gap", () => {
		// Drag D into the gap before B (slot 1) → A, D, B, C.
		expect(reorderPaletteColors(PALETTE, 3, 1)?.colors).toEqual([
			"#a",
			"#d",
			"#b",
			"#c",
		])
	})

	it("appends when dropped in the trailing gap", () => {
		expect(reorderPaletteColors(PALETTE, 1, 4)?.colors).toEqual([
			"#a",
			"#c",
			"#d",
			"#b",
		])
	})

	it("is a no-op for the gaps on either side of the dragged swatch", () => {
		expect(reorderPaletteColors(PALETTE, 1, 1)).toBeNull()
		expect(reorderPaletteColors(PALETTE, 1, 2)).toBeNull()
	})

	it("carries pattern inks along with their colors", () => {
		const withInks = { ...PALETTE, patternInks: ["#ia", null, "#ic", null] }
		expect(reorderPaletteColors(withInks, 0, 3)).toEqual({
			colors: ["#b", "#c", "#a", "#d"],
			patternInks: [null, "#ic", "#ia", null],
		})
	})

	it("pads a short ink array before permuting it", () => {
		const sparse = { ...PALETTE, patternInks: ["#ia"] }
		expect(reorderPaletteColors(sparse, 0, 4)).toEqual({
			colors: ["#b", "#c", "#d", "#a"],
			patternInks: [null, null, null, "#ia"],
		})
	})

	it("leaves patternInks absent when the palette has none", () => {
		const patch = reorderPaletteColors(PALETTE, 0, 2)
		expect(patch).toEqual({ colors: ["#b", "#a", "#c", "#d"] })
		expect(patch && "patternInks" in patch).toBe(false)
	})
})

describe("reorderPalettes", () => {
	const LIST = ["p1", "p2", "p3"]

	it("moves a palette forward into a later gap", () => {
		// Drag p1 into the trailing gap → p2, p3, p1.
		expect(reorderPalettes(LIST, 0, 3)).toEqual(["p2", "p3", "p1"])
	})

	it("moves a palette backward into an earlier gap", () => {
		// Drag p3 into the gap before p1 → p3, p1, p2.
		expect(reorderPalettes(LIST, 2, 0)).toEqual(["p3", "p1", "p2"])
	})

	it("is a no-op for the gaps on either side of the dragged palette", () => {
		expect(reorderPalettes(LIST, 1, 1)).toBeNull()
		expect(reorderPalettes(LIST, 1, 2)).toBeNull()
	})

	it("does not mutate the input", () => {
		reorderPalettes(LIST, 0, 3)
		expect(LIST).toEqual(["p1", "p2", "p3"])
	})
})
