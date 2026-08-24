import {
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	type AxisConfig,
	type ChannelConfigs,
	type DistributionOverlayConfig,
} from "../../../lib/channelConfig"
import type { PositionScale } from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import type { Mark } from "./types"

// ---------------------------------------------------------------------------
// Strip-plot overlays: jitter + violin + box. All require one axis to be a
// band/point scale (categorical) and the other to be quantitative.
// ---------------------------------------------------------------------------

export type StripAxes = {
	categoryAxis: "x" | "y"
	categoryField: string
	valueField: string
	valueType: FieldType
	categoryScale: { (cat: unknown): number | undefined; step: () => number }
	valueScale: PositionScale
	jitterAmount: number
	/** When true, pack points into a beeswarm instead of random jitter. */
	beeswarm: boolean
	overlay: DistributionOverlayConfig
}

const isBandScale = (
	scale: unknown
): scale is { step: () => number; (cat: unknown): number | undefined } => {
	return (
		typeof (scale as { step?: unknown })?.step === "function" &&
		typeof scale === "function"
	)
}

/** Wrap a `scaleLinear` (used by ordinal-numeric fields) so the violin / box
 * overlay code can treat it like a band scale: position lookups go through
 * `Number(value)` into the linear scale; `step()` reports the average gap
 * between unique values in the data so violinHalfWidth doesn't go to zero
 * (one-or-two-category edge cases get a sensible minimum).
 *
 * Without this, ordinal-numeric axes (e.g. fields like "Stage 1, Stage 2,
 * Stage 3" stored as 1/2/3) wouldn't satisfy `isBandScale`'s shape check,
 * so the overlay layer would silently bail out — exactly the bug users
 * reported as "violins don't draw on ordinal axes". */
const wrapLinearAsBand = (
	linear: PositionScale,
	uniqueValues: string[]
): { step: () => number; (cat: unknown): number | undefined } => {
	const sorted = [...uniqueValues]
		.map(Number)
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => a - b)
	const positions = sorted.map((n) =>
		(linear as unknown as (x: number) => number)(n)
	)
	let step = 0
	if (positions.length >= 2) {
		const first = positions[0] ?? 0
		const last = positions.at(-1) ?? 0
		step = Math.abs(last - first) / (positions.length - 1)
	} else {
		// Single category — fall back to a fraction of the linear range so the
		// violin/box still has visible width.
		const dom = (linear as unknown as { range?: () => number[] }).range?.()
		step = dom ? Math.abs((dom[1] ?? 0) - (dom[0] ?? 0)) / 4 : 40
	}
	const wrapped = (cat: unknown): number | undefined => {
		const n = Number(cat)
		if (!Number.isFinite(n)) return undefined
		return (linear as unknown as (x: number) => number)(n)
	}
	;(wrapped as unknown as { step: () => number }).step = () => step
	return wrapped as {
		step: () => number
		(cat: unknown): number | undefined
	}
}

export const resolveStripAxes = (args: {
	xScale: PositionScale
	yScale: PositionScale
	xType: FieldType
	yType: FieldType
	xField: string | null
	yField: string | null
	rows: ReadonlyArray<Record<string, unknown>>
	channelConfigs: ChannelConfigs
}): StripAxes | null => {
	const { xScale, yScale, xType, yType, xField, yField, rows, channelConfigs } =
		args
	if (!xField || !yField) return null

	// "Category-like" = anything that displays as discrete groups: native
	// scaleBand / scalePoint, plus ordinal-numeric axes whose scaleLinear
	// can be wrapped to behave like a band scale (see `wrapLinearAsBand`).
	// Without that fallback, violin / box overlays silently fail on ordinal
	// axes — even though the sidebar happily offers the toggle.
	const xIsBand = isBandScale(xScale)
	const yIsBand = isBandScale(yScale)
	const xIsCategoryLike =
		xIsBand || xType === "categorical" || xType === "ordinal"
	const yIsCategoryLike =
		yIsBand || yType === "categorical" || yType === "ordinal"
	const xIsQuant = xType === "quantitative"
	const yIsQuant = yType === "quantitative"

	const uniqueValuesFor = (field: string): string[] => [
		...new Set(
			rows
				.map((r) => r[field])
				.filter((v) => v !== undefined && v !== null && String(v) !== "")
				.map(String)
		),
	]

	let categoryAxis: "x" | "y"
	let categoryField: string
	let valueField: string
	let valueType: FieldType
	let categoryScale: StripAxes["categoryScale"]
	let valueScale: PositionScale
	if (xIsCategoryLike && yIsQuant && !yIsBand) {
		categoryAxis = "x"
		categoryField = xField
		valueField = yField
		valueType = yType
		categoryScale = xIsBand
			? (xScale as StripAxes["categoryScale"])
			: wrapLinearAsBand(xScale, uniqueValuesFor(xField))
		valueScale = yScale
	} else if (yIsCategoryLike && xIsQuant && !xIsBand) {
		categoryAxis = "y"
		categoryField = yField
		valueField = xField
		valueType = xType
		categoryScale = yIsBand
			? (yScale as StripAxes["categoryScale"])
			: wrapLinearAsBand(yScale, uniqueValuesFor(yField))
		valueScale = xScale
	} else {
		return null
	}

	const cfg: AxisConfig | undefined =
		categoryAxis === "x" ? channelConfigs.x : channelConfigs.y
	const valueCfg: AxisConfig | undefined =
		categoryAxis === "x" ? channelConfigs.y : channelConfigs.x
	// Spread defaults UNDER the saved value so older visuals (saved before
	// `colorOverrides` / `fillColorOverrides` / `usePalette` existed) don't
	// crash on `overlay.colorOverrides[cat]` with `undefined['A']`.
	const overlay: DistributionOverlayConfig = {
		...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
		...valueCfg?.distributionOverlay,
	}

	return {
		categoryAxis,
		categoryField,
		valueField,
		valueType,
		categoryScale,
		valueScale,
		jitterAmount: cfg?.jitterAmount ?? 0,
		beeswarm: cfg?.beeswarm ?? false,
		overlay,
	}
}

/** Deterministic [0, 1] value derived from a row index. mulberry32-flavored
 * mixing — re-renders for the same row index produce the same offset, so
 * jittered points don't dance across re-renders. */
const stableRandom = (i: number): number => {
	let x = (i + 1) * 0x9e3779b1
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
	return ((x ^ (x >>> 16)) >>> 0) / 4294967295
}

export const applyJitter = (marks: Mark[], strip: StripAxes | null): Mark[] => {
	if (!strip || strip.jitterAmount <= 0) return marks
	const step = strip.categoryScale.step()
	if (!step) return marks
	const maxOffset = step * 0.5 * strip.jitterAmount
	const axis = strip.categoryAxis
	return marks.map((m) => {
		const delta = (stableRandom(m.i) - 0.5) * 2 * maxOffset
		if (axis === "x") {
			const cx = m.cx + delta
			const line = m.line
				? { ...m.line, x1: m.line.x1 + delta, x2: m.line.x2 + delta }
				: null
			return { ...m, cx, line }
		}
		const cy = m.cy + delta
		const line = m.line
			? { ...m.line, y1: m.line.y1 + delta, y2: m.line.y2 + delta }
			: null
		return { ...m, cy, line }
	})
}

/** One-dimensional beeswarm packing. Given points described by their position
 * along the VALUE axis and their radius, return the offset to apply along the
 * CATEGORY axis for each — packed as close to the band center (offset 0) as
 * possible without any two circles overlapping. Deterministic: the result
 * depends only on the inputs, so points don't dance across re-renders.
 *
 * Algorithm (the standard d3-beeswarm "swarm"): place points in order of
 * value position. For each point, every already-placed neighbor whose value
 * gap is smaller than the sum of radii forbids a horizontal band around its
 * offset (width = the chord that keeps the circles just touching). Pick the
 * offset nearest 0 that sits outside every forbidden band. O(n²) per group,
 * which is fine for the point counts a strip plot renders. */
const computeSwarmOffsets = (
	points: ReadonlyArray<{ pos: number; r: number }>
): number[] => {
	const order = points
		.map((_, i) => i)
		.sort((a, b) => points[a].pos - points[b].pos)
	const offsets = new Array<number>(points.length).fill(0)
	const placed: Array<{ pos: number; r: number; offset: number }> = []
	const EPS = 1e-6
	for (const idx of order) {
		const p = points[idx]
		// Forbidden intervals along the category axis, from each placed neighbor
		// whose circle could overlap this one given their value-axis gap.
		const intervals: Array<[number, number]> = []
		for (const q of placed) {
			const sumR = p.r + q.r
			const dv = Math.abs(p.pos - q.pos)
			if (dv < sumR) {
				const sep = Math.sqrt(sumR * sumR - dv * dv)
				intervals.push([q.offset - sep, q.offset + sep])
			}
		}
		// Candidate offsets: 0 (band center) plus each forbidden boundary.
		// The nearest candidate to 0 that lies outside every interval wins.
		const candidates = [0]
		for (const [lo, hi] of intervals) {
			candidates.push(lo, hi)
		}
		candidates.sort((a, b) => Math.abs(a) - Math.abs(b))
		let chosen = 0
		for (const c of candidates) {
			const free = !intervals.some(([lo, hi]) => c > lo + EPS && c < hi - EPS)
			if (free) {
				chosen = c
				break
			}
		}
		offsets[idx] = chosen
		placed.push({ pos: p.pos, r: p.r, offset: chosen })
	}
	return offsets
}

/** Pack points into a beeswarm along the category axis, leaving their value-axis
 * position untouched. Groups marks by their (shared) category-axis center, packs
 * each group with {@link computeSwarmOffsets}, then shifts cx/cy (and any
 * length/angle line endpoints) by the resulting offset.
 *
 * `pad` widens each point's collision radius — pass the stroke's half-width so
 * the packing accounts for the outline that SVG centers on the circle's edge.
 * Without it, circles pack to touching CENTERS-apart and their strokes visibly
 * overlap. */
export const applyBeeswarm = (
	marks: Mark[],
	strip: StripAxes | null,
	pad: number
): Mark[] => {
	if (!strip) return marks
	const axis = strip.categoryAxis
	// Group by the base center along the category axis — applyPositionScale puts
	// every point in a category at that band's center, so equal centers = same
	// category. Round to absorb floating-point noise from the scale.
	const groups = new Map<number, Mark[]>()
	for (const m of marks) {
		const base = axis === "x" ? m.cx : m.cy
		const key = Math.round(base * 1000) / 1000
		const bucket = groups.get(key)
		if (bucket) bucket.push(m)
		else groups.set(key, [m])
	}
	const offsetByIndex = new Map<number, number>()
	for (const bucket of groups.values()) {
		const swarm = computeSwarmOffsets(
			bucket.map((m) => ({ pos: axis === "x" ? m.cy : m.cx, r: m.r + pad }))
		)
		bucket.forEach((m, i) => offsetByIndex.set(m.i, swarm[i]))
	}
	return marks.map((m) => {
		const delta = offsetByIndex.get(m.i) ?? 0
		if (axis === "x") {
			const cx = m.cx + delta
			const line = m.line
				? { ...m.line, x1: m.line.x1 + delta, x2: m.line.x2 + delta }
				: null
			return { ...m, cx, line }
		}
		const cy = m.cy + delta
		const line = m.line
			? { ...m.line, y1: m.line.y1 + delta, y2: m.line.y2 + delta }
			: null
		return { ...m, cy, line }
	})
}
