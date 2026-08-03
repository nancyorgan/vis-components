import { describe, expect, it } from "vitest"
import { facetAxisMapping } from "./facetAxisMapping"

describe("facetAxisMapping", () => {
	it("cartesian modes map to x/y with panel size shown", () => {
		const m = facetAxisMapping("scatter")
		expect(m.rowAxis).toBe("y")
		expect(m.colAxis).toBe("x")
		expect(m.showPanelSize).toBe(true)
	})

	it("bars-x, bars-y, areas-x, areas-y, tile all map cartesian", () => {
		for (const id of ["bars-x", "bars-y", "areas-x", "areas-y", "tile"]) {
			const m = facetAxisMapping(id)
			expect(m.rowAxis).toBe("y")
			expect(m.colAxis).toBe("x")
		}
	})

	it("radar maps to r/angle and hides panel size", () => {
		const m = facetAxisMapping("radar")
		expect(m.rowAxis).toBe("r")
		expect(m.colAxis).toBe("angle")
		expect(m.rowAxisLabel).toBe("R axis")
		expect(m.colAxisLabel).toBe("angle axis")
		expect(m.showPanelSize).toBe(false)
	})

	it("pie modes have null row axis (no R equivalent) and angle col axis", () => {
		for (const id of ["pies", "pies-x", "pies-y"]) {
			const m = facetAxisMapping(id)
			expect(m.rowAxis).toBeNull()
			expect(m.colAxis).toBe("angle")
			expect(m.showPanelSize).toBe(false)
		}
	})

	it("unknown mode falls back to cartesian", () => {
		const m = facetAxisMapping("nonexistent")
		expect(m.rowAxis).toBe("y")
		expect(m.colAxis).toBe("x")
	})
})
