import {
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	type AxisConfig,
	type ChannelConfigs,
	type DistributionOverlayConfig,
} from "../../../lib/channelConfig"
import type { PositionScale } from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import { uniqueFieldValues } from "../../../lib/uniqueFieldValues"
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
	/** Jitter only the marks that share a pre-jitter position with another
	 * mark (`AxisConfig.jitterOverlappingOnly`). */
	jitterOverlappingOnly: boolean
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

	const uniqueValuesFor = (field: string): string[] =>
		uniqueFieldValues(rows, field, { skipBlank: true })

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
		jitterOverlappingOnly: cfg?.jitterOverlappingOnly === true,
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

/** Signed jitter fraction (-1..1 of the max offset) for every mark that
 * shares its exact pre-jitter position (same `cx` AND `cy`) with at least
 * one other mark; marks that sit alone are absent. Two rows with the same
 * category and the same value land on identical pixels, so an exact pixel
 * match is the same test as an exact data match; nearby-but-distinct
 * values stay distinct.
 *
 * A stack splits EVENLY between the two sides of the band center: walking
 * the group in draw order, members alternate side (2 → one each way; 3 →
 * two one way, one the other; which side gets the extra is a stable coin
 * flip per group so it doesn't always lean the same way). Within a side
 * the members take evenly spaced slots out to the max offset, each
 * wobbled by a stable per-row amount, so no two land on the same spot and
 * none hugs the center. In-memory lookup only — the key is never
 * persisted. */
const overlappingJitter = (marks: Mark[]): Map<number, number> => {
	const groups = new Map<string, Mark[]>()
	for (const m of marks) {
		const key = `${m.cx},${m.cy}`
		const g = groups.get(key)
		if (g) g.push(m)
		else groups.set(key, [m])
	}
	const out = new Map<number, number>()
	for (const group of groups.values()) {
		if (group.length < 2) continue
		const members = [...group].sort((a, b) => a.i - b.i)
		const first = members[0]
		if (!first) continue
		const firstSign = stableRandom(first.i) < 0.5 ? -1 : 1
		const perSide: [number, number] = [
			Math.ceil(members.length / 2),
			Math.floor(members.length / 2),
		]
		const placed: [number, number] = [0, 0]
		members.forEach((m, k) => {
			const side = k % 2 === 0 ? 0 : 1
			const slots = perSide[side]
			const j = placed[side]
			placed[side] = j + 1
			// Slot center (j + 0.5) / slots, wobbled by up to ±0.3 of a slot.
			const t = (j + 0.5 + (stableRandom(m.i) - 0.5) * 0.6) / slots
			out.set(m.i, (side === 0 ? firstSign : -firstSign) * t)
		})
	}
	return out
}

export const applyJitter = (marks: Mark[], strip: StripAxes | null): Mark[] => {
	if (!strip || strip.jitterAmount <= 0) return marks
	const step = strip.categoryScale.step()
	if (!step) return marks
	const maxOffset = step * 0.5 * strip.jitterAmount
	const axis = strip.categoryAxis
	// "Only jitter overlapping points": a mark that sits alone keeps its
	// band-center position; only stacked marks spread, split evenly
	// between the two sides of the center.
	const stacked = strip.jitterOverlappingOnly ? overlappingJitter(marks) : null
	return marks.map((m) => {
		const fraction = stacked ? stacked.get(m.i) : undefined
		if (stacked && fraction === undefined) return m
		const delta =
			fraction !== undefined
				? fraction * maxOffset
				: (stableRandom(m.i) - 0.5) * 2 * maxOffset
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

