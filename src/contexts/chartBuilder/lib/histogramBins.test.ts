import { describe, expect, it } from "vitest"

import {
	binnedCounts,
	computeHistogramBins,
	histogramMeasureDomain,
} from "./histogramBins"

describe("computeHistogramBins", () => {
	it("returns null when there are no finite values", () => {
		expect(computeHistogramBins([], 5)).toBeNull()
		expect(computeHistogramBins([null, undefined, "", "abc"], 5)).toBeNull()
	})

	it("partitions the range into equal-width bins", () => {
		const binning = computeHistogramBins([0, 10], 5)
		expect(binning).not.toBeNull()
		const bins = binning?.bins ?? []
		expect(bins).toHaveLength(5)
		expect(bins[0]).toMatchObject({ index: 0, lo: 0, hi: 2 })
		expect(bins[4]).toMatchObject({ index: 4, lo: 8, hi: 10 })
	})

	it("orders bin labels ascending by edge (round steps of 1/2/5×10ᵏ)", () => {
		// target 4 over 0..100 → tickStep picks 20 → five round bins.
		const binning = computeHistogramBins([0, 100], 4)
		expect(binning?.order).toEqual([
			"0 – 20",
			"20 – 40",
			"40 – 60",
			"60 – 80",
			"80 – 100",
		])
	})

	it("assigns values to the correct bin", () => {
		const { labelForValue } = computeHistogramBins([0, 100], 4)!
		expect(labelForValue(0)).toBe("0 – 20")
		expect(labelForValue(19.9)).toBe("0 – 20")
		expect(labelForValue(20)).toBe("20 – 40")
		expect(labelForValue(60)).toBe("60 – 80")
	})

	it("puts the maximum value in the last bin (inclusive upper edge)", () => {
		const { labelForValue } = computeHistogramBins([0, 100], 4)!
		expect(labelForValue(100)).toBe("80 – 100")
	})

	it("drops missing / non-numeric values", () => {
		const { labelForValue } = computeHistogramBins([0, 10], 5)!
		expect(labelForValue(null)).toBeNull()
		expect(labelForValue("")).toBeNull()
		expect(labelForValue("nope")).toBeNull()
	})

	it("coerces numeric strings (CSV columns arrive as strings)", () => {
		const { labelForValue } = computeHistogramBins(["0", "10"], 2)!
		expect(labelForValue("3")).toBe("0 – 5")
		expect(labelForValue("7")).toBe("5 – 10")
	})

	it("clamps bin count to at least 1", () => {
		expect(computeHistogramBins([0, 10], 0)?.bins).toHaveLength(1)
		expect(computeHistogramBins([0, 10], -3)?.bins).toHaveLength(1)
	})

	it("handles a degenerate domain where all values are equal", () => {
		const binning = computeHistogramBins([7, 7, 7], 5)
		expect(binning?.bins).toHaveLength(1)
		expect(binning?.labelForValue(7)).toBe(binning?.order[0])
	})

	it("picks decimal precision from the bin width for narrow ranges", () => {
		// target 4 over 0..1 → tickStep picks 0.2 → five round bins.
		const binning = computeHistogramBins([0, 1], 4)
		expect(binning?.order).toEqual([
			"0 – 0.2",
			"0.2 – 0.4",
			"0.4 – 0.6",
			"0.6 – 0.8",
			"0.8 – 1",
		])
	})

	describe("nice (round) edges", () => {
		it("snaps edges to round numbers around the data extremes", () => {
			const binning = computeHistogramBins([1, 20], 4)
			expect(binning?.order).toEqual([
				"0 – 5",
				"5 – 10",
				"10 – 15",
				"15 – 20",
			])
			expect(binning?.labelForValue(1)).toBe("0 – 5")
			expect(binning?.labelForValue(20)).toBe("15 – 20")
		})

		it("extends the domain outward to round multiples of the step", () => {
			const binning = computeHistogramBins([12, 37], 5)
			expect(binning?.order[0]).toBe("10 – 15")
			expect(binning?.order.at(-1)).toBe("35 – 40")
		})

		it("treats binCount as a target — realized count may differ for round edges", () => {
			// step rounds to 5 over 1..20, so 4 bins even though 5 were asked for.
			expect(computeHistogramBins([1, 20], 5)?.bins).toHaveLength(4)
		})
	})

	describe("label mode (range / low / high)", () => {
		it("defaults to the full range", () => {
			expect(computeHistogramBins([0, 40000], 4)?.order[0]).toBe("0 – 10000")
		})

		it("labels by the lowest edge in 'low' mode", () => {
			const binning = computeHistogramBins([0, 40000], 4, undefined, undefined, "low")
			expect(binning?.order).toEqual(["0", "10000", "20000", "30000"])
		})

		it("labels by the highest edge in 'high' mode", () => {
			const binning = computeHistogramBins(
				[0, 40000],
				4,
				undefined,
				undefined,
				"high"
			)
			expect(binning?.order).toEqual(["10000", "20000", "30000", "40000"])
		})

		it("keeps bin labels unique (usable as category keys) in low/high mode", () => {
			const low = computeHistogramBins([0, 40000], 4, undefined, undefined, "low")!
			expect(new Set(low.order).size).toBe(low.order.length)
			// labelForValue maps a value to its bin's (low-mode) label.
			expect(low.labelForValue(15000)).toBe("10000")
		})
	})

	describe("edge-label format override (axis tick format)", () => {
		it("formats bin-edge labels with the supplied formatter", () => {
			// Mimics an SI tick format: 20000 → "20k".
			const si = (n: number) => `${n / 1000}k`
			const binning = computeHistogramBins([0, 40000], 4, si)
			expect(binning?.order).toEqual([
				"0k – 10k",
				"10k – 20k",
				"20k – 30k",
				"30k – 40k",
			])
		})

		it("falls back to the built-in formatter when none is supplied", () => {
			expect(computeHistogramBins([0, 40000], 4)?.order[0]).toBe("0 – 10000")
		})

		it("ignores a too-coarse formatter that would collapse distinct edges", () => {
			// 50k-wide bins over 0..450k; a 1-sig-fig SI format maps 150000 and
			// 200000 both to "200k" → would produce "200k – 200k". The binner
			// must detect the collision and fall back to precise labels.
			const coarse = (n: number) => {
				const k = Math.round(n / 100000) * 100 // 1 sig-fig-ish, in k
				return `${k}k`
			}
			const binning = computeHistogramBins([0, 450000], 9, coarse)!
			const labels = binning.order
			// No duplicate edges / degenerate "X – X" labels.
			expect(new Set(labels).size).toBe(labels.length)
			expect(labels.some((l) => /^(.+) – \1$/.test(l))).toBe(false)
		})

		it("uses a formatter that keeps edges distinct", () => {
			// tickStep rounds to 20k-wide bins; "÷1000 + k" keeps every edge
			// distinct → the formatter is used.
			const si = (n: number) => `${n / 1000}k`
			expect(computeHistogramBins([0, 100000], 4, si)?.order).toEqual([
				"0k – 20k",
				"20k – 40k",
				"40k – 60k",
				"60k – 80k",
				"80k – 100k",
			])
		})
	})

	describe("bounds (axis min/max limit the binned range)", () => {
		it("bins over a pinned min, dropping rows below it", () => {
			const binning = computeHistogramBins([0, 200], 4, undefined, {
				min: 50,
				max: null,
			})!
			// Extent starts at the pinned 50 (not 0); max snaps pretty.
			expect(binning.bins[0]!.lo).toBe(50)
			// Values below the pinned min are excluded.
			expect(binning.labelForValue(10)).toBeNull()
			expect(binning.labelForValue(50)).toBe(binning.order[0])
		})

		it("drops rows above a pinned max", () => {
			const binning = computeHistogramBins([0, 200], 4, undefined, {
				min: null,
				max: 100,
			})!
			expect(binning.labelForValue(150)).toBeNull()
			expect(binning.labelForValue(100)).toBe(binning.order.at(-1))
		})

		it("with both bounds pinned, makes exactly binCount equal bins over [min,max]", () => {
			const binning = computeHistogramBins([0, 999], 5, undefined, {
				min: 0,
				max: 100,
			})!
			expect(binning.bins).toHaveLength(5)
			expect(binning.bins.map((b) => b.hi - b.lo)).toEqual([20, 20, 20, 20, 20])
			expect(binning.labelForValue(500)).toBeNull() // outside [0,100]
		})

		it("ignores invalid pins (min ≥ max) and uses the data extent", () => {
			const pinned = computeHistogramBins([0, 100], 4, undefined, {
				min: 80,
				max: 20,
			})
			const plain = computeHistogramBins([0, 100], 4)
			expect(pinned?.order).toEqual(plain?.order)
		})
	})

	describe("binnedCounts (faceted shared bins, per-group counts)", () => {
		// Bins are computed once from the pooled/union values so every facet
		// panel shares edges; each panel then counts only its own rows.
		const union = [1, 2, 3, 4, 5, 15, 16, 17, 18]
		const binning = computeHistogramBins(union, 2)! // → "0 – 10", "10 – 20"

		it("counts each group independently into the shared bins", () => {
			const a = binnedCounts([1, 2, 3, 4, 5], binning)
			const b = binnedCounts([15, 16, 17, 18], binning)
			expect(a.get("0 – 10")).toBe(5)
			expect(a.get("10 – 20") ?? 0).toBe(0)
			expect(b.get("10 – 20")).toBe(4)
			expect(b.get("0 – 10") ?? 0).toBe(0)
		})

		it("skips missing / non-numeric values", () => {
			const c = binnedCounts([3, null, "", "x", 7], binning)
			const total = [...c.values()].reduce((sum, n) => sum + n, 0)
			expect(total).toBe(2)
		})
	})

	describe("histogramMeasureDomain (Fill color/opacity by bin measure)", () => {
		// 0–10 holds 5 rows, 10–20 holds 3 → max count 5, total 8.
		const values = [1, 2, 3, 4, 5, 15, 16, 17]

		it("returns [0, maxCount] in count mode", () => {
			expect(histogramMeasureDomain(values, 2, "count")).toEqual({
				min: 0,
				max: 5,
			})
		})

		it("returns [0, maxShare] in density mode (max bin ÷ total)", () => {
			const dom = histogramMeasureDomain(values, 2, "density")!
			expect(dom.min).toBe(0)
			expect(dom.max).toBeCloseTo(5 / 8)
		})

		it("honors pinned bounds (rows outside the extent are excluded)", () => {
			// Pin to [0, 10] → only the 5 low rows count; the high bin is dropped.
			const dom = histogramMeasureDomain(values, 1, "count", {
				min: 0,
				max: 10,
			})!
			expect(dom.max).toBe(5)
		})

		it("returns null when there are no finite values to bin", () => {
			expect(histogramMeasureDomain([null, "", "x"], 5, "count")).toBeNull()
		})
	})
})
