import { describe, expect, it } from "vitest"

import {
	canvasSizeToggled,
	canvasStartSize,
	DEFAULT_CANVAS_HEIGHT,
	DEFAULT_CANVAS_WIDTH,
} from "./canvasSizeEdits"

describe("canvasSizeToggled", () => {
	const THEME = { exportCanvasWidth: 800, exportCanvasHeight: 450 }

	it("a size the visual never had starts at the theme's", () => {
		expect(canvasSizeToggled(undefined, true, THEME)).toEqual({
			enabled: true,
			width: 800,
			height: 450,
			unit: undefined,
		})
	})

	it("keeps a size the visual had, over the theme's", () => {
		expect(
			canvasSizeToggled({ enabled: false, width: 300, unit: "in" }, true, THEME)
		).toEqual({ enabled: true, width: 300, height: 450, unit: "in" })
	})

	it("a canvas the visual never had starts in the theme's Exporting unit", () => {
		const inches = { ...THEME, exportMarginUnit: "in" as const }
		expect(canvasSizeToggled(undefined, true, inches).unit).toBe("in")
		expect(canvasSizeToggled({ enabled: false }, true, inches).unit).toBe("in")
		// px is the default: kept sparse.
		expect(
			canvasSizeToggled(undefined, true, { ...THEME, exportMarginUnit: "px" }).unit
		).toBeUndefined()
	})

	it("a canvas the visual had keeps its unit, never the theme's", () => {
		const inches = { ...THEME, exportMarginUnit: "in" as const }
		// Had a size in px (absent unit): re-enabling doesn't flip it to inches.
		expect(
			canvasSizeToggled({ enabled: false, width: 1000, height: 600 }, true, inches).unit
		).toBeUndefined()
		expect(
			canvasSizeToggled({ enabled: false, width: 1000, unit: "cm" }, true, inches).unit
		).toBe("cm")
	})

	it("falls back to 1000 × 600 when neither the visual nor the theme has one", () => {
		const built = { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT }
		expect(canvasSizeToggled(null, true, {})).toMatchObject(built)
		expect(canvasSizeToggled(null, true, undefined)).toMatchObject(built)
		expect(canvasSizeToggled(null, true, { exportCanvasWidth: 640 })).toMatchObject({
			width: 640,
			height: DEFAULT_CANVAS_HEIGHT,
		})
	})

	it("canvasStartSize is the theme's size, else the built-in", () => {
		expect(canvasStartSize(THEME)).toEqual({ width: 800, height: 450 })
		expect(canvasStartSize(null)).toEqual({ width: 1000, height: 600 })
	})
})
