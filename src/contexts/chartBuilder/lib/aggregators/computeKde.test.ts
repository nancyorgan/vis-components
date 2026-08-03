import { describe, expect, it } from "vitest"

import { computeKde } from "./distributions"

/** Trapezoidal integral of the density over its grid — should be ~1 for a
 * Gaussian KDE evaluated over a domain that comfortably covers the data. */
const integrate = (grid: number[], density: number[]): number => {
	let area = 0
	for (let i = 1; i < grid.length; i++) {
		const w = (grid[i] as number) - (grid[i - 1] as number)
		area += ((density[i] as number) + (density[i - 1] as number)) / 2 * w
	}
	return area
}

describe("computeKde", () => {
	it("returns a grid spanning the domain at the requested resolution", () => {
		const { grid } = computeKde({ values: [1, 2, 3], domain: [0, 10], gridSize: 5 })
		expect(grid).toHaveLength(5)
		expect(grid[0]).toBe(0)
		expect(grid.at(-1)).toBe(10)
	})

	it("produces UN-normalized density that integrates to ~1 (not peak-normalized)", () => {
		const values = Array.from({ length: 500 }, (_, i) => Math.sin(i) * 3 + 5)
		const { grid, density } = computeKde({
			values,
			domain: [-10, 20],
			gridSize: 256,
		})
		// Peak is well below 1 (peak-normalization would force it to exactly 1).
		expect(Math.max(...density)).toBeLessThan(0.5)
		expect(integrate(grid, density)).toBeCloseTo(1, 1)
	})

	it("bandwidthScale > 1 smooths (lowers the peak); < 1 sharpens it", () => {
		const values = [0, 0, 0, 5, 10, 10, 10]
		const base = computeKde({ values, domain: [-5, 15], gridSize: 128 })
		const smooth = computeKde({
			values,
			domain: [-5, 15],
			gridSize: 128,
			bandwidthScale: 3,
		})
		const sharp = computeKde({
			values,
			domain: [-5, 15],
			gridSize: 128,
			bandwidthScale: 0.3,
		})
		expect(smooth.bandwidth).toBeGreaterThan(base.bandwidth)
		expect(sharp.bandwidth).toBeLessThan(base.bandwidth)
		expect(Math.max(...smooth.density)).toBeLessThan(Math.max(...base.density))
		expect(Math.max(...sharp.density)).toBeGreaterThan(Math.max(...base.density))
	})

	it("an explicit bandwidth overrides bandwidthScale", () => {
		const { bandwidth } = computeKde({
			values: [1, 2, 3],
			domain: [0, 4],
			bandwidth: 0.7,
			bandwidthScale: 10,
		})
		expect(bandwidth).toBe(0.7)
	})

	it("ignores non-finite values", () => {
		const { density } = computeKde({
			values: [1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3],
			domain: [0, 4],
			gridSize: 16,
		})
		expect(density.every((d) => Number.isFinite(d))).toBe(true)
		expect(Math.max(...density)).toBeGreaterThan(0)
	})
})
