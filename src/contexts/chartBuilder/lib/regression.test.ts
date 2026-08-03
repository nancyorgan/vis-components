import { describe, expect, it } from "vitest"

import {
	fitPolynomial,
	normalQuantile,
	sampleRange,
	tQuantile,
} from "./regression"

describe("fitPolynomial", () => {
	it("recovers an exact linear relationship", () => {
		const pts: Array<[number, number]> = [1, 2, 3, 4, 5].map((x) => [
			x,
			3 + 2 * x,
		])
		const fit = fitPolynomial(pts, 1)
		expect(fit).not.toBeNull()
		expect(fit!.coefficients[0]).toBeCloseTo(3, 8)
		expect(fit!.coefficients[1]).toBeCloseTo(2, 8)
		expect(fit!.predict(10)).toBeCloseTo(23, 8)
		expect(fit!.xExtent).toEqual([1, 5])
		expect(fit!.n).toBe(5)
	})

	it("recovers an exact quadratic", () => {
		const pts: Array<[number, number]> = [-2, -1, 0, 1, 2, 3].map((x) => [
			x,
			1 - 4 * x + 0.5 * x * x,
		])
		const fit = fitPolynomial(pts, 2)
		expect(fit).not.toBeNull()
		expect(fit!.coefficients[0]).toBeCloseTo(1, 8)
		expect(fit!.coefficients[1]).toBeCloseTo(-4, 8)
		expect(fit!.coefficients[2]).toBeCloseTo(0.5, 8)
	})

	it("matches the closed-form OLS slope/intercept on noisy data", () => {
		// Fixed pseudo-noise (no RNG — deterministic test).
		const noise = [0.3, -0.2, 0.1, -0.4, 0.25, 0.05, -0.15, 0.2]
		const pts: Array<[number, number]> = noise.map((e, i) => [
			i,
			1 + 0.5 * i + e,
		])
		const fit = fitPolynomial(pts, 1)
		expect(fit).not.toBeNull()
		// Closed-form simple regression for reference.
		const n = pts.length
		const mx = pts.reduce((a, [x]) => a + x, 0) / n
		const my = pts.reduce((a, [, y]) => a + y, 0) / n
		const sxy = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0)
		const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0)
		const slope = sxy / sxx
		const intercept = my - slope * mx
		expect(fit!.coefficients[1]).toBeCloseTo(slope, 8)
		expect(fit!.coefficients[0]).toBeCloseTo(intercept, 8)
	})

	it("is numerically stable on offset data (years)", () => {
		const pts: Array<[number, number]> = Array.from({ length: 27 }, (_, i) => {
			const year = 2000 + i
			return [year, 5 + 0.25 * (year - 2000)] as [number, number]
		})
		const fit = fitPolynomial(pts, 3)
		expect(fit).not.toBeNull()
		// A cubic fit of exactly-linear data must still predict on the line.
		expect(fit!.predict(2013)).toBeCloseTo(5 + 0.25 * 13, 6)
		expect(fit!.predict(2026)).toBeCloseTo(5 + 0.25 * 26, 6)
	})

	it("filters non-finite points before fitting", () => {
		const pts: Array<[number, number]> = [
			[1, 3],
			[Number.NaN, 4],
			[2, Number.POSITIVE_INFINITY],
			[2, 5],
			[3, 7],
		]
		const fit = fitPolynomial(pts, 1)
		expect(fit).not.toBeNull()
		expect(fit!.n).toBe(3)
		expect(fit!.coefficients[1]).toBeCloseTo(2, 8)
	})

	it("returns null when underdetermined (n < degree + 1)", () => {
		expect(
			fitPolynomial(
				[
					[1, 2],
					[2, 4],
				],
				2
			)
		).toBeNull()
		expect(fitPolynomial([[1, 2]], 1)).toBeNull()
		expect(fitPolynomial([], 1)).toBeNull()
	})

	it("returns null on zero x-variance", () => {
		expect(
			fitPolynomial(
				[
					[2, 1],
					[2, 3],
					[2, 5],
				],
				1
			)
		).toBeNull()
	})

	describe("ciAt", () => {
		it("returns null on a saturated fit (no residual df)", () => {
			const fit = fitPolynomial(
				[
					[0, 1],
					[1, 3],
				],
				1
			)
			expect(fit).not.toBeNull()
			expect(fit!.ciAt(0.5, 0.95)).toBeNull()
		})

		it("returns null for invalid levels", () => {
			const fit = fitPolynomial(
				[
					[0, 1],
					[1, 2],
					[2, 4],
					[3, 3],
				],
				1
			)
			expect(fit!.ciAt(1, 0)).toBeNull()
			expect(fit!.ciAt(1, 1)).toBeNull()
			expect(fit!.ciAt(1, 95)).toBeNull()
		})

		it("matches the closed-form OLS mean-response CI", () => {
			// x = 1..6, y as below. Exact OLS by hand: slope = 34.6/17.5,
			// intercept = 0.08, s² = SSE/4 = 0.0277142857. At x₀ = x̄ = 3.5 the
			// prediction is exactly ȳ = 7 and se(mean) = s·√(1/6); with
			// t(0.975, 4) = 2.776445 the 95% CI is 7 ± 0.188695.
			const pts: Array<[number, number]> = [
				[1, 2.1],
				[2, 3.9],
				[3, 6.2],
				[4, 7.8],
				[5, 10.1],
				[6, 11.9],
			]
			const fit = fitPolynomial(pts, 1)
			expect(fit).not.toBeNull()
			expect(fit!.coefficients[1]).toBeCloseTo(34.6 / 17.5, 8)
			expect(fit!.coefficients[0]).toBeCloseTo(0.08, 8)
			expect(fit!.predict(3.5)).toBeCloseTo(7, 8)
			const ci = fit!.ciAt(3.5, 0.95)
			expect(ci).not.toBeNull()
			// Our t-quantile is approximate (Cornish–Fisher) at df = 4, so allow
			// a small tolerance around the exact bounds.
			expect(ci![0]).toBeCloseTo(7 - 0.188695, 3)
			expect(ci![1]).toBeCloseTo(7 + 0.188695, 3)
		})

		it("is widest away from the x mean and narrows with higher n", () => {
			const mk = (n: number) =>
				fitPolynomial(
					Array.from({ length: n }, (_, i) => {
						const x = i / (n - 1)
						// Deterministic wiggle so residual variance is nonzero.
						return [x, 2 * x + (i % 2 === 0 ? 0.1 : -0.1)] as [number, number]
					}),
					1
				)
			const fit = mk(10)
			const atMean = fit!.ciAt(0.5, 0.95)
			const atEdge = fit!.ciAt(0, 0.95)
			expect(atEdge![1] - atEdge![0]).toBeGreaterThan(atMean![1] - atMean![0])
			const bigger = mk(100)
			const atMeanBig = bigger!.ciAt(0.5, 0.95)
			expect(atMeanBig![1] - atMeanBig![0]).toBeLessThan(
				atMean![1] - atMean![0]
			)
		})
	})
})

describe("normalQuantile", () => {
	it("matches known values", () => {
		expect(normalQuantile(0.5)).toBeCloseTo(0, 9)
		expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5)
		expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 5)
		expect(normalQuantile(0.995)).toBeCloseTo(2.575829, 5)
	})
	it("rejects out-of-range p", () => {
		expect(normalQuantile(0)).toBeNaN()
		expect(normalQuantile(1)).toBeNaN()
		expect(normalQuantile(-0.2)).toBeNaN()
	})
})

describe("tQuantile", () => {
	it("matches exact closed forms at df 1 and 2", () => {
		expect(tQuantile(0.975, 1)).toBeCloseTo(12.7062, 3)
		expect(tQuantile(0.975, 2)).toBeCloseTo(4.302653, 5)
	})
	it("approximates reference values at moderate df", () => {
		expect(tQuantile(0.975, 5)).toBeCloseTo(2.570582, 2)
		expect(tQuantile(0.975, 10)).toBeCloseTo(2.228139, 3)
		expect(tQuantile(0.975, 30)).toBeCloseTo(2.042272, 4)
	})
	it("converges to the normal quantile at large df", () => {
		expect(tQuantile(0.975, 100000)).toBeCloseTo(1.959964, 3)
	})
})

describe("sampleRange", () => {
	it("spans both endpoints evenly", () => {
		const s = sampleRange(0, 10, 5)
		expect(s).toEqual([0, 2.5, 5, 7.5, 10])
	})
	it("collapses a degenerate range to one point", () => {
		expect(sampleRange(3, 3)).toEqual([3])
	})
	it("returns empty on invalid input", () => {
		expect(sampleRange(5, 1)).toEqual([])
		expect(sampleRange(Number.NaN, 1)).toEqual([])
	})
})
