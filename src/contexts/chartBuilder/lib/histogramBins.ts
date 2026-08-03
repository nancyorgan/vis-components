/** "Pretty" equal-width binning for histograms.
 *
 * A histogram in this chart builder is a bars-x / bars-y chart whose CATEGORY
 * axis carries a quantitative field. Instead of treating each distinct value
 * as its own category, we partition the value range into equal-width buckets
 * and use the bucket as the category. The bars renderer then runs its normal
 * `aggregateStacks` pass over the binned categories — so counting and hue
 * stacking come for free.
 *
 * Bin edges are made "nice": we pick a round step (1, 2, 5, 10, 25, …) via
 * d3's `tickStep` and extend the domain outward to multiples of that step, so
 * bins span round numbers (e.g. 0–5, 5–10, …) rather than raw data extremes
 * (1.3–5.75). Because the step is rounded, `binCount` is a TARGET — the actual
 * number of bins can differ slightly to keep the edges round.
 *
 * This module is intentionally pure (no React / Jotai) so it can be unit
 * tested in isolation and reused by both the renderer and any future
 * histogram-specific UI.
 */
import { tickStep } from "d3-array"

export type HistogramBin = {
	/** Zero-based bin index, ascending from the lowest value. */
	index: number
	/** Inclusive lower edge. */
	lo: number
	/** Upper edge. Exclusive for every bin except the last, which is
	 * inclusive so the maximum value lands somewhere. */
	hi: number
	/** Display label, e.g. "10 – 20". Also the category key fed to the bars
	 * aggregator, so it must be unique per bin. */
	label: string
}

export type HistogramBinning = {
	bins: HistogramBin[]
	/** Bin labels in ascending edge order. Pass this as the bars aggregator's
	 * `categoryOrder` so bins sort by value rather than by encounter order. */
	order: string[]
	/** Map a raw cell value to its bin label, or `null` when the value is
	 * missing / non-numeric (those rows are dropped, matching how the bars
	 * aggregator already skips null categories). */
	labelForValue: (raw: unknown) => string | null
	/** The full binned value extent `[lowEdge, highEdge]` — the first bin's
	 * lower edge through the last bin's upper edge (honoring pinned bounds).
	 * Equal-width bins tile this range, so a linear scale over it lines up
	 * exactly with the band scale of bin labels — used to place rug ticks at
	 * their raw value along the binned axis. */
	domain: [number, number]
}

/** Format a bin edge for display. Picks a precision from the bin width so
 * narrow bins don't all collapse to the same rounded label, then trims
 * trailing zeros. Kept local (not d3-format) because edges are always plain
 * numbers and we want the precision to track the width automatically. */
const formatEdge = (value: number, width: number): string => {
	if (!Number.isFinite(value)) return String(value)
	// Choose decimals so two adjacent edges (width apart) render distinctly.
	// width >= 1 → integers usually read fine; smaller widths need more places.
	let decimals = 0
	if (width > 0 && width < 1) {
		decimals = Math.min(6, Math.ceil(-Math.log10(width)) + 1)
	}
	const fixed = value.toFixed(decimals)
	// Trim trailing zeros / dangling decimal point ("12.50" → "12.5", "12.0" → "12").
	return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed
}

const coerceNumber = (raw: unknown): number | null => {
	if (raw === undefined || raw === null || raw === "") return null
	const n = Number(raw)
	return Number.isFinite(n) ? n : null
}

/**
 * Build a "nice" equal-width binning over the finite numbers in `values`.
 *
 * Edges snap to round multiples of a `tickStep`-derived step, so `binCount`
 * is a TARGET — the realized bin count can differ to keep edges round.
 *
 * Returns `null` when there's nothing to bin (no finite values), so callers
 * can fall back to plain (unbinned) bar rendering.
 *
 * Edge cases:
 *  - `binCount` is clamped to at least 1.
 *  - When every value is identical (min === max) a single bin spanning
 *    [v, v] is returned; every row maps into it.
 */
export const computeHistogramBins = (
	values: readonly unknown[],
	binCount: number,
	/** Optional edge formatter — when provided (e.g. built from the axis's
	 * tick-format setting), bin-edge labels use it instead of the built-in
	 * precision formatter. Lets a user format "20000 – 30000" as "20k – 30k"
	 * by picking an SI tick format on the binned axis. */
	formatEdgeOverride?: (value: number) => string,
	/** Optional binning extent (the axis min/max). A pinned bound overrides the
	 * data extent and is honored EXACTLY (not snapped); values outside the
	 * resolved extent are excluded from the bins. Invalid pins (min ≥ max) are
	 * ignored in favor of the data extent. */
	bounds?: { min?: number | null; max?: number | null },
	/** How each bin's label reads: "range" → "lo – hi" (default), "low" → just
	 * the lower edge, "high" → just the upper edge. The label doubles as the
	 * bin's category key, so each mode still yields unique per-bin strings
	 * (lo / hi edges are strictly increasing). */
	labelMode: "range" | "low" | "high" = "range"
): HistogramBinning | null => {
	// Compose a bin's label from its edges per the chosen mode.
	const makeLabel = (
		lo: number,
		hi: number,
		width: number,
		useOverride: boolean
	): string => {
		const loStr = formatEdgeWith(lo, width, useOverride)
		const hiStr = formatEdgeWith(hi, width, useOverride)
		return labelMode === "low"
			? loStr
			: labelMode === "high"
				? hiStr
				: `${loStr} – ${hiStr}`
	}
	// Label an edge with the supplied tick formatter, but only when `useOverride`
	// is true. We disable the override (below) when it would collapse distinct
	// edges — e.g. ".0s" (1 significant digit) maps both 150000 and 200000 to
	// "200k", which would render misleading labels like "200k – 200k" and make
	// equal-width bins look uneven.
	const formatEdgeWith = (
		value: number,
		width: number,
		useOverride: boolean
	): string =>
		useOverride && formatEdgeOverride
			? formatEdgeOverride(value)
			: formatEdge(value, width)
	let min = Infinity
	let max = -Infinity
	for (const raw of values) {
		const n = coerceNumber(raw)
		if (n === null) continue
		if (n < min) min = n
		if (n > max) max = n
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) return null

	const count = Math.max(1, Math.floor(binCount))

	// Resolve the binning extent. A pinned axis bound overrides the data
	// extent; invalid pins (min ≥ max) fall back to the data extent.
	const pinnedLo = bounds?.min ?? null
	const pinnedHi = bounds?.max ?? null
	const candidateLo = pinnedLo ?? min
	const candidateHi = pinnedHi ?? max
	const useBounds = candidateLo < candidateHi
	const lo = useBounds ? candidateLo : min
	const hi = useBounds ? candidateHi : max
	const minPinned = useBounds && pinnedLo !== null
	const maxPinned = useBounds && pinnedHi !== null

	// Degenerate domain (all values equal): one bin covering the single value.
	if (lo === hi) {
		const label = formatEdgeWith(lo, 1, formatEdgeOverride != null)
		const bins: HistogramBin[] = [{ index: 0, lo, hi, label }]
		return {
			bins,
			order: [label],
			labelForValue: (raw) => (coerceNumber(raw) === null ? null : label),
			domain: [lo, hi],
		}
	}

	// Bin edges. When BOTH bounds are pinned, divide the exact range into
	// `count` equal bins (predictable, honors the pins). Otherwise use a round
	// "pretty" step (1/2/5×10ᵏ), keeping any pinned bound exact and snapping the
	// unpinned side outward to a round multiple.
	let step: number
	let niceLo: number
	let niceHi: number
	let nBins: number
	if (minPinned && maxPinned) {
		nBins = count
		step = (hi - lo) / count
		niceLo = lo
		niceHi = hi
	} else {
		const rawStep = tickStep(lo, hi, count)
		// `tickStep` can misbehave for tiny spans; fall back to a plain step.
		step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : (hi - lo) / count
		niceLo = minPinned ? lo : Math.floor(lo / step) * step
		niceHi = maxPinned ? hi : Math.ceil(hi / step) * step
		nBins = Math.max(1, Math.round((niceHi - niceLo) / step))
	}

	// Decide once whether the override formatter is precise enough: format every
	// edge and require them all-distinct. If it collapses any two edges, fall
	// back to the built-in precision formatter so labels stay meaningful.
	const edgeValues: number[] = []
	for (let i = 0; i <= nBins; i++) {
		edgeValues.push(i === nBins ? niceHi : niceLo + step * i)
	}
	const overrideSafe =
		formatEdgeOverride != null &&
		new Set(edgeValues.map((v) => formatEdgeOverride(v))).size ===
			edgeValues.length

	const bins: HistogramBin[] = []
	for (let i = 0; i < nBins; i++) {
		const lo = niceLo + step * i
		const hi = i === nBins - 1 ? niceHi : niceLo + step * (i + 1)
		bins.push({
			index: i,
			lo,
			hi,
			label: makeLabel(lo, hi, step, overrideSafe),
		})
	}

	const order = bins.map((b) => b.label)

	const eps = step * 1e-9
	const labelForValue = (raw: unknown): string | null => {
		const n = coerceNumber(raw)
		if (n === null) return null
		// Exclude values outside the (possibly pinned) extent. With no pins the
		// extent brackets the data, so nothing is dropped.
		if (n < niceLo - eps || n > niceHi + eps) return null
		// Clamp the computed index into range: values exactly at `niceHi` would
		// otherwise produce index === nBins (one past the last bin).
		const idx = Math.min(nBins - 1, Math.max(0, Math.floor((n - niceLo) / step)))
		return bins[idx]?.label ?? null
	}

	return { bins, order, labelForValue, domain: [niceLo, niceHi] }
}

/** The quantitative domain a histogram's bins span on the MEASURE axis — used
 * when the user encodes Fill color or opacity by the bins' derived measure
 * (rather than a data field). Returns `[0, maxCount]` in "count" mode and
 * `[0, maxShare]` in "density" mode, where `maxShare = maxCount / total`
 * matches `toDensityStacks` (each bin's share of the grand total of binned
 * rows). Both the renderer and the legend call this so the bar colors and the
 * legend ramp agree on the scale.
 *
 * Returns `null` when there's nothing to bin (no finite values) — callers then
 * have no measure to encode. The `binCount` / `bounds` / `labelMode` arguments
 * mirror `computeHistogramBins` so the binning matches the rendered bars
 * exactly. */
export const histogramMeasureDomain = (
	values: readonly unknown[],
	binCount: number,
	mode: "count" | "density",
	bounds?: { min?: number | null; max?: number | null },
	labelMode: "range" | "low" | "high" = "range"
): { min: number; max: number } | null => {
	const binning = computeHistogramBins(
		values,
		binCount,
		undefined,
		bounds,
		labelMode
	)
	if (!binning) return null
	const counts = binnedCounts(values, binning)
	let maxCount = 0
	let total = 0
	for (const c of counts.values()) {
		total += c
		if (c > maxCount) maxCount = c
	}
	if (mode === "density") {
		return { min: 0, max: total > 0 ? maxCount / total : 0 }
	}
	return { min: 0, max: maxCount }
}

/** Count raw values into a precomputed binning. Values that don't map to a bin
 * (missing / non-numeric) are skipped. Returns a map of bin label → count.
 *
 * Used for the faceted shared count axis: bins are computed once from the
 * pooled rows (shared edges), then each panel counts its OWN rows into those
 * bins so the shared measure axis reflects the largest per-panel bin. */
export const binnedCounts = (
	values: readonly unknown[],
	binning: HistogramBinning
): Map<string, number> => {
	const counts = new Map<string, number>()
	for (const raw of values) {
		const label = binning.labelForValue(raw)
		if (label === null) continue
		counts.set(label, (counts.get(label) ?? 0) + 1)
	}
	return counts
}
