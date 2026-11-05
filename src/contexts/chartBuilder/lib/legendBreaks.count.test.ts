import { describe, expect, it } from "vitest"
import { breaksForCount, resolveLegendBreaks } from "./legendBreaks"

describe("breaksForCount — the swatch count is exact", () => {
	const v = [0, 3, 9, 14]
	it("the default auto breaks for 0–14 are the 8 round steps (why it asked)", () => {
		expect(resolveLegendBreaks(v, "quantitative", undefined, 3, 3)).toHaveLength(8)
	})
	it("returns exactly the requested number of stops", () => {
		for (const n of [2, 3, 4, 5, 6, 7, 8, 10]) {
			expect(breaksForCount(v, "quantitative", n)).toHaveLength(n)
		}
	})
	it("prefers round increments when a round set has that many", () => {
		expect(breaksForCount(v, "quantitative", 8)).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
		expect(breaksForCount(v, "quantitative", 4)).toEqual([0, 5, 10, 15])
	})
	it("otherwise spaces evenly across the data, rounded", () => {
		expect(breaksForCount(v, "quantitative", 5)).toEqual([0, 3.5, 7, 10.5, 14])
	})
})
