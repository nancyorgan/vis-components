import type { FieldType } from "../types"

type Row = Record<string, unknown>

export type BoxStats = {
	min: number
	max: number
	q1: number
	median: number
	q3: number
	iqr: number
	/** Smallest value within q1 - 1.5*IQR (Tukey lower whisker). */
	lowerWhisker: number
	/** Largest value within q3 + 1.5*IQR (Tukey upper whisker). */
	upperWhisker: number
	outliers: number[]
}

export type KdeResult = {
	/** Sample points along the value axis. Shared across all categories so
	 * violins are directly comparable on the same scale. */
	grid: number[]
	/** Density at each grid point. Normalized per-category so the peak
	 * equals 1.0 — the chart maps that to half the violin band-width. */
	density: number[]
}

export type DistributionStats = {
	category: string
	/** Sorted, finite values for this category. */
	values: number[]
	box: BoxStats
	kde: KdeResult
}

export type DistributionAggregation =
	| {
			categories: string[]
			stats: DistributionStats[]
			/** Global [min, max] across all categories — handy for chart bounds. */
			valueDomain: [number, number]
	  }
	| { error: string }

export type AggregateDistributionsInput = {
	rows: Row[]
	categoryField: string
	valueField: string
	categoryType: FieldType
	valueType: FieldType
	/** KDE bandwidth. Defaults to Silverman's rule of thumb. */
	bandwidth?: number
	/** Multiplier on the auto (Silverman) bandwidth — >1 smoother, <1 wigglier.
	 * Ignored when an absolute `bandwidth` is set. Defaults to 1. */
	bandwidthScale?: number
	/** KDE grid resolution. Defaults to 64 points. */
	gridSize?: number
}

const DEFAULT_GRID_SIZE = 64

/** Exported so overlay renderers can key data rows by category exactly the
 * way the aggregation does (same stringify + trim). */
export const coerceCategory = (raw: unknown): string | null => {
	if (raw === undefined || raw === null) return null
	const str = String(raw).trim()
	return str === "" ? null : str
}

const coerceValue = (raw: unknown): number | null => {
	if (raw === undefined || raw === null || raw === "") return null
	const n = Number(raw)
	return Number.isFinite(n) ? n : null
}

/** Linear interpolation at a fractional rank in a sorted array — matches
 * the type-7 quantile definition (numpy/R default). */
const quantile = (sorted: number[], p: number): number => {
	if (sorted.length === 0) return Number.NaN
	if (sorted.length === 1) return sorted[0] as number
	const h = (sorted.length - 1) * p
	const lo = Math.floor(h)
	const hi = Math.ceil(h)
	const frac = h - lo
	const a = sorted[lo] as number
	const b = sorted[hi] as number
	return a + (b - a) * frac
}

const computeBoxStats = (sorted: number[]): BoxStats => {
	const min = sorted[0] as number
	const max = sorted.at(-1) as number
	const q1 = quantile(sorted, 0.25)
	const median = quantile(sorted, 0.5)
	const q3 = quantile(sorted, 0.75)
	const iqr = q3 - q1
	const lowerInner = q1 - 1.5 * iqr
	const upperInner = q3 + 1.5 * iqr
	let lowerWhisker = q1
	let upperWhisker = q3
	const outliers: number[] = []
	for (const v of sorted) {
		if (v < lowerInner || v > upperInner) {
			outliers.push(v)
		} else {
			if (v < lowerWhisker) lowerWhisker = v
			if (v > upperWhisker) upperWhisker = v
		}
	}
	return {
		min,
		max,
		q1,
		median,
		q3,
		iqr,
		lowerWhisker,
		upperWhisker,
		outliers,
	}
}

const stddev = (values: number[]): number => {
	if (values.length < 2) return 0
	const mean = values.reduce((a, b) => a + b, 0) / values.length
	const variance =
		values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
	return Math.sqrt(variance)
}

/** Silverman's rule of thumb for Gaussian KDE bandwidth. Falls back to 1%
 * of the value range when std and IQR are both zero (all values equal). */
const silvermanBandwidth = (
	sorted: number[],
	rangeFallback: number
): number => {
	const n = sorted.length
	if (n < 2) return Math.max(rangeFallback * 0.01, 1e-9)
	const sd = stddev(sorted)
	const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25)
	const spread = Math.min(sd || Infinity, (iqr || Infinity) / 1.34)
	if (!Number.isFinite(spread) || spread === 0) {
		return Math.max(rangeFallback * 0.01, 1e-9)
	}
	return 0.9 * spread * n ** (-1 / 5)
}

const GAUSSIAN_NORM = 1 / Math.sqrt(2 * Math.PI)

/** Gaussian kernel density at each point of `grid`, given samples and
 * bandwidth h. Returns un-normalized density. */
const gaussianKde = (values: number[], grid: number[], h: number): number[] => {
	const n = values.length
	const out: number[] = Array.from({ length: grid.length }, () => 0)
	if (n === 0 || h <= 0) return out
	const factor = 1 / (n * h)
	for (const [j, element] of grid.entries()) {
		let sum = 0
		const x = element as number
		for (let i = 0; i < n; i++) {
			const u = (x - (values[i] as number)) / h
			sum += GAUSSIAN_NORM * Math.exp(-(u * u) / 2)
		}
		out[j] = sum * factor
	}
	return out
}

export type Kde = {
	/** Sample points along the value axis. */
	grid: number[]
	/** Un-normalized Gaussian-kernel density at each grid point (integrates to
	 * ~1 over the value axis). Violins peak-normalize this so the fattest point
	 * maps to the band half-width; a density curve drawn over a histogram needs
	 * the RAW scale instead, because it's rescaled into count / relative-
	 * frequency units to sit against the bars. */
	density: number[]
	/** The bandwidth actually used (Silverman × `bandwidthScale`, or the
	 * explicit override). */
	bandwidth: number
}

export type ComputeKdeInput = {
	/** Sample values. Non-finite entries are ignored; need not be sorted. */
	values: number[]
	/** Value-axis extent the grid spans, `[lo, hi]` with `hi > lo`. */
	domain: [number, number]
	/** Grid resolution. Defaults to 64 points. */
	gridSize?: number
	/** Absolute bandwidth override. When set, `bandwidthScale` is ignored. */
	bandwidth?: number
	/** Multiplier on the auto (Silverman) bandwidth. Defaults to 1. */
	bandwidthScale?: number
}

/** Gaussian KDE over a fixed grid, returning UN-normalized density. The shared
 * primitive behind both the violin overlay (which peak-normalizes the result)
 * and the histogram density curve (which rescales it into bar units). */
export const computeKde = (input: ComputeKdeInput): Kde => {
	const { domain, values } = input
	const [lo, hi] = domain
	const range = hi - lo
	const gridSize = input.gridSize ?? DEFAULT_GRID_SIZE
	const grid: number[] = []
	for (let i = 0; i < gridSize; i++) {
		grid.push(gridSize === 1 ? lo : lo + (range * i) / (gridSize - 1))
	}
	const sorted = values
		.filter((v) => Number.isFinite(v))
		.sort((a, b) => a - b)
	const h =
		input.bandwidth ??
		silvermanBandwidth(sorted, range) * (input.bandwidthScale ?? 1)
	const density = gaussianKde(sorted, grid, h)
	return { grid, density, bandwidth: h }
}

/** Aggregate per-category distributions for violin / box / strip overlays.
 * Quantitative value field is required. The categorical field groups the rows;
 * pass an empty `categoryField` to treat ALL rows as one group (a single-
 * variable violin / box, with no grouping axis). Returns sorted values, Tukey
 * box stats, and a normalized KDE per category — all sharing one global
 * value-axis grid for direct comparison. */
export const aggregateDistributions = (
	input: AggregateDistributionsInput
): DistributionAggregation => {
	const { rows, categoryField, valueField, valueType } = input
	if (valueType !== "quantitative") {
		return {
			error:
				"Distribution overlays (violin / box plot) require a quantitative value axis.",
		}
	}

	const valuesByCategory = new Map<string, number[]>()
	const categoryOrder: string[] = []
	let globalMin = Infinity
	let globalMax = -Infinity

	for (const row of rows) {
		// Empty categoryField → single group (all rows together).
		const cat = categoryField ? coerceCategory(row[categoryField]) : ""
		if (cat === null) continue
		const v = coerceValue(row[valueField])
		if (v === null) continue
		if (!valuesByCategory.has(cat)) {
			valuesByCategory.set(cat, [])
			categoryOrder.push(cat)
		}
		const list = valuesByCategory.get(cat)
		if (list) list.push(v)
		if (v < globalMin) globalMin = v
		if (v > globalMax) globalMax = v
	}

	if (categoryOrder.length === 0 || !Number.isFinite(globalMin)) {
		return { error: "No usable rows: every row had a missing value." }
	}

	if (globalMin === globalMax) {
		// Pad the domain by ±1 so KDE has a sensible grid even when all values
		// are identical (edge case: single value, or many copies of the same).
		globalMin -= 1
		globalMax += 1
	}

	const gridSize = input.gridSize ?? DEFAULT_GRID_SIZE

	const stats: DistributionStats[] = categoryOrder.map((category) => {
		const values = [...(valuesByCategory.get(category) ?? [])].sort(
			(a, b) => a - b
		)
		const box = computeBoxStats(values)
		// All categories share one global value domain → identical grids → the
		// violins are directly comparable on the same axis.
		const { grid, density: rawDensity } = computeKde({
			values,
			domain: [globalMin, globalMax],
			gridSize,
			bandwidth: input.bandwidth,
			bandwidthScale: input.bandwidthScale,
		})
		// Per-category peak normalization — peak = 1.0 maps to the violin's
		// half-band width at draw time. Without this, categories with more
		// samples would render visually fatter even at equal *relative*
		// density.
		const peak = rawDensity.reduce((m, v) => Math.max(v, m), 0)
		const density = peak > 0 ? rawDensity.map((v) => v / peak) : [...rawDensity]
		return {
			category,
			values,
			box,
			kde: { grid: [...grid], density },
		}
	})

	return {
		categories: categoryOrder,
		stats,
		valueDomain: [globalMin, globalMax],
	}
}
