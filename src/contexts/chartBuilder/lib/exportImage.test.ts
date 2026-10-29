import { describe, expect, it } from "vitest"
import { exportSizeFor } from "./exportImage"

describe("exportSizeFor", () => {
	it("takes a fixed canvas size outright at 4×", () => {
		expect(
			exportSizeFor({ enabled: true, width: 624, height: 432, unit: "in" })
		).toEqual({ width: 624, height: 432, pixelRatio: 4 })
	})

	it("clamps a fixed canvas to the export bounds", () => {
		const size = exportSizeFor({ enabled: true, width: 9000, height: 10 })
		expect(size.width).toBe(4096)
		expect(size.height).toBe(50)
	})

	it("steps a large canvas down to a PowerPoint-exact dpi, as the dialog does", () => {
		// 1229 × 1344 at 4× is past the canvas area limit.
		const size = exportSizeFor({ enabled: true, width: 1229, height: 1344 })
		expect(size.pixelRatio * 96).toBe(300)
	})

	it("defaults to the dialog's unmeasured size at 4× without a fixed canvas", () => {
		for (const canvas of [
			undefined,
			{ enabled: false, width: 1000, height: 600 },
		]) {
			expect(exportSizeFor(canvas)).toEqual({
				width: 650,
				height: 400,
				pixelRatio: 4,
			})
		}
	})
})
