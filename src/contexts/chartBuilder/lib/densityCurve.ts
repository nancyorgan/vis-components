import { computeKde } from "./aggregators/distributions"

/** Inputs for sampling a histogram's density curve. The curve is the same
 * Gaussian KDE that powers violins, but rescaled into the bars' own units so it
 * sits naturally against them. */
export type DensityCurveInput = {
	/** Raw values of the binned (quantitative) axis field. Non-finite entries
	 * and values outside `domain` are ignored — they match the rows a histogram
	 * actually bins. */
	values: number[]
	/** The histogram's binned extent `[lo, hi]` (== the bin domain). */
	domain: [number, number]
	/** Number of (equal-width) bins actually drawn. Used to recover the bin
	 * width that converts a probability density into per-bin units. */
	binCount: number
	/** Match the histogram bars: "count" → expected rows per bin; "density" →
	 * each bin's share of the total (relative frequency, 0–1). */
	mode: "count" | "density"
	/** KDE grid resolution. Defaults to 64 points. */
	gridSize?: number
	/** Smoothing multiplier on the auto bandwidth. Defaults to 1. */
	bandwidthScale?: number
}

export type DensityCurve = {
	/** Sample points along the binned value axis. */
	grid: number[]
	/** Curve height at each grid point, in the same units as the bars: row
	 * COUNT per bin (mode "count") or relative frequency (mode "density"). */
	measure: number[]
}

/** Sample a histogram's density curve in bar units.
 *
 * A KDE `f(x)` integrates to 1 over the value axis. A count histogram bar of
 * width `w` holds about `N · f(x) · w` rows (its area is the row count); a
 * density (relative-frequency) bar holds about `f(x) · w`. So scaling the raw
 * KDE by `N · w` (count) or `w` (density) puts the curve on the bars' scale —
 * its peak lands near the tallest bar instead of near 1. */
export const densityCurveMeasures = (input: DensityCurveInput): DensityCurve => {
	const { domain, binCount, mode } = input
	const [lo, hi] = domain
	// Degenerate domain (single value / zero width) has no bin width to scale by.
	if (!(hi > lo) || binCount < 1) return { grid: [], measure: [] }
	const inRange = input.values.filter(
		(v) => Number.isFinite(v) && v >= lo && v <= hi
	)
	const binWidth = (hi - lo) / binCount
	const { grid, density } = computeKde({
		values: inRange,
		domain,
		gridSize: input.gridSize,
		bandwidthScale: input.bandwidthScale,
	})
	const factor = mode === "count" ? inRange.length * binWidth : binWidth
	return { grid, measure: density.map((d) => d * factor) }
}
