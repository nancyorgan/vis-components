import { describe, expect, it } from "vitest"

import { densityCurveMeasures } from "./densityCurve"

/** Trapezoidal sum of the curve heights over the grid. */
const integrate = (grid: number[], measure: number[]): number => {
	let area = 0
	for (let i = 1; i < grid.length; i++) {
		const w = (grid[i] as number) - (grid[i - 1] as number)
		area += ((measure[i] as number) + (measure[i - 1] as number)) / 2 * w
	}
	return area
}

describe("densityCurveMeasures", () => {
	// Data concentrated in the interior (4–6) of a wider domain (0–10), so the
	// Gaussian tails stay inside the bin range and the KDE integrates to ~1
	// over the domain — isolating the scaling factor from tail clipping.
	const values = Array.from({ length: 400 }, (_, i) => 5 + Math.sin(i) * 0.8)

	it("count mode: area under the curve ≈ N × binWidth (total row count × bin width)", () => {
		const domain: [number, number] = [0, 10]
		const binCount = 10
		const { grid, measure } = densityCurveMeasures({
			values,
			domain,
			binCount,
			mode: "count",
		})
		const binWidth = (domain[1] - domain[0]) / binCount
		// ∫ measure dx = (∫ kde dx ≈ 1) × N × binWidth = N × binWidth.
		expect(integrate(grid, measure)).toBeCloseTo(values.length * binWidth, 0)
	})

	it("density mode: area under the curve ≈ binWidth (curve integrates to a per-bin share)", () => {
		const domain: [number, number] = [0, 10]
		const binCount = 10
		const { grid, measure } = densityCurveMeasures({
			values,
			domain,
			binCount,
			mode: "density",
		})
		const binWidth = (domain[1] - domain[0]) / binCount
		expect(integrate(grid, measure)).toBeCloseTo(binWidth, 2)
	})

	it("clips the curve's tails to the bin domain — area is at most N × binWidth", () => {
		// Data at the domain edges: Gaussian tails spill past [lo, hi] and are
		// dropped, so the in-domain area falls a little short of N × binWidth.
		const domain: [number, number] = [0, 10]
		const binCount = 10
		const edgeData = Array.from({ length: 400 }, (_, i) => (i % 40) / 4) // 0–10
		const { grid, measure } = densityCurveMeasures({
			values: edgeData,
			domain,
			binCount,
			mode: "count",
		})
		const full = edgeData.length * ((domain[1] - domain[0]) / binCount)
		const area = integrate(grid, measure)
		expect(area).toBeLessThan(full)
		expect(area).toBeGreaterThan(full * 0.85)
	})

	it("count peak scales with N — twice the rows ≈ twice the height", () => {
		const domain: [number, number] = [0, 10]
		const single = densityCurveMeasures({ values, domain, binCount: 10, mode: "count" })
		const doubled = densityCurveMeasures({
			values: [...values, ...values],
			domain,
			binCount: 10,
			mode: "count",
		})
		// ~2× from the doubled N; slightly more because Silverman bandwidth
		// shrinks with sample size and sharpens the peak a touch.
		const ratio = Math.max(...doubled.measure) / Math.max(...single.measure)
		expect(ratio).toBeGreaterThan(1.9)
		expect(ratio).toBeLessThan(2.4)
	})

	it("only counts values inside the domain (out-of-range rows are dropped, like the bins)", () => {
		const domain: [number, number] = [0, 10]
		const withOutliers = densityCurveMeasures({
			values: [...values, -100, -100, 500, 500],
			domain,
			binCount: 10,
			mode: "count",
		})
		const clean = densityCurveMeasures({ values, domain, binCount: 10, mode: "count" })
		// The 4 out-of-range rows don't inflate N, so the curve is unchanged.
		expect(Math.max(...withOutliers.measure)).toBeCloseTo(
			Math.max(...clean.measure),
			5
		)
	})

	it("returns empty for a degenerate (zero-width) domain", () => {
		expect(densityCurveMeasures({ values, domain: [5, 5], binCount: 10, mode: "count" })).toEqual({
			grid: [],
			measure: [],
		})
	})
})
