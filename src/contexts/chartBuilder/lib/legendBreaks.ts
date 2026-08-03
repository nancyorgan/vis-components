import { ticks as d3Ticks } from "d3-array"
import { format as d3Format } from "d3-format"
import { scaleLinear } from "d3-scale"
import { timeFormat } from "d3-time-format"

import {
	DEFAULT_LEGEND_CHANNEL_CONFIG,
	type LegendChannelConfig,
} from "./labelsConfig"
import { parseValue } from "./scales"
import type { FieldType } from "./types"

/** A "rendered" break entry: the underlying numeric (used for scale
 * positioning) plus the formatted label string the legend should show.
 * Temporal channels still use a numeric breakpoint here — Date-typed
 * values get the timestamp; the formatter handles the display side. */
export type LegendBreak = {
	value: number
	label: string
}

/** Resolve the effective per-channel config — fills in defaults for any
 * missing fields. Centralized so legend renderers and scale builders agree
 * on the same merged shape. */
export const resolveLegendChannelConfig = (
	cfg: Partial<LegendChannelConfig> | undefined,
): LegendChannelConfig => ({ ...DEFAULT_LEGEND_CHANNEL_CONFIG, ...(cfg ?? {}) })

/** Coerce a value into the appropriate numeric for legend display.
 * Temporal values use ms-since-epoch so a single number-based break-array
 * round-trips cleanly. */
const toLegendNumber = (raw: unknown, type: FieldType): number | null => {
	const parsed = parseValue(
		raw,
		type === "ordinal" ? "ordinal" : type === "temporal" ? "temporal" : "quantitative",
	)
	if (parsed === null) return null
	if (parsed instanceof Date) return parsed.getTime()
	return typeof parsed === "number" ? parsed : null
}

/** Compute the data extent ([lo, hi]) for a quantitative legend. Returns
 * null when the values yield no usable numbers (caller's cue to skip the
 * legend entirely or fall back to a placeholder). */
export const legendDataExtent = (
	rawValues: unknown[],
	type: FieldType,
): [number, number] | null => {
	let lo = Number.POSITIVE_INFINITY
	let hi = Number.NEGATIVE_INFINITY
	for (const raw of rawValues) {
		const n = toLegendNumber(raw, type)
		if (n === null) continue
		if (n < lo) lo = n
		if (n > hi) hi = n
	}
	return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
}

/** Build the formatter for legend break labels. Spec-aware just like the
 * axis tick formatter: a `%<letter>` directive selects d3-time-format,
 * everything else selects d3-format. Returns null when the spec is empty
 * (caller falls back to the legacy default formatter). */
export const buildLegendFormatter = (
	spec: string,
): ((v: number) => string) | null => {
	const trimmed = spec.trim()
	if (trimmed === "") return null
	const isTime = /%[a-zA-Z]/.test(trimmed)
	if (isTime) {
		try {
			const f = timeFormat(trimmed)
			return (v) => {
				const d = new Date(v)
				if (Number.isNaN(d.getTime())) return String(v)
				return f(d)
			}
		} catch {
			return (v) => String(v)
		}
	}
	try {
		const f = d3Format(trimmed)
		return (v) => f(v)
	} catch {
		return (v) => String(v)
	}
}

/** Compute the resolved scale domain for a quantitative legend. When the
 * user has set explicit breaks, the domain spans the min/max of those
 * breaks. Otherwise it spans the data extent. Returns null when neither
 * source yields a usable extent (no data and no user breaks). */
export const resolveLegendDomain = (
	rawValues: unknown[],
	type: FieldType,
	cfg: Partial<LegendChannelConfig> | undefined,
): [number, number] | null => {
	const merged = resolveLegendChannelConfig(cfg)
	if (merged.breaks.length >= 2) {
		const lo = Math.min(...merged.breaks)
		const hi = Math.max(...merged.breaks)
		if (Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi) return [lo, hi]
	}
	return legendDataExtent(rawValues, type)
}

/** "Pretty" round breaks for a numeric extent at approximately the
 * requested count. Uses d3's `scale.nice()` to round the endpoints
 * outward (so 2..194 → 0..200) and then `d3.ticks()` for the step
 * between them — the same algorithm axis tick generators use. */
export const prettyBreaks = (
	lo: number,
	hi: number,
	count: number,
): number[] => {
	if (lo === hi) return [lo]
	const [niceLo, niceHi] = scaleLinear().domain([lo, hi]).nice(count).domain() as [
		number,
		number,
	]
	const pretty = d3Ticks(niceLo, niceHi, count)
	if (pretty.length === 0) return [lo, hi]
	return pretty
}

/** Compute the sorted, non-empty array of break values to use for legend
 * stops. When the user supplied custom breaks, those win (sorted ascending,
 * de-duplicated). Otherwise we ask `prettyBreaks` for round increments at
 * approximately `breakCount` density — same algorithm the axis tick
 * generator uses, so legend breaks pick up the familiar 0/50/100/150/200
 * look instead of arbitrary lo+i*step values.
 *
 * Caveat: `prettyBreaks` may return slightly more or fewer values than
 * requested (it prefers round increments over exact count). The
 * `floorCount` argument backs out to evenly-spaced when the pretty
 * algorithm degenerates below that floor — useful for size/length
 * legends that historically showed three stops and would visually
 * degenerate otherwise. */
export const resolveLegendBreaks = (
	rawValues: unknown[],
	type: FieldType,
	cfg: Partial<LegendChannelConfig> | undefined,
	defaultCount = 5,
	floorCount = 2,
): number[] => {
	const merged = resolveLegendChannelConfig(cfg)
	if (merged.breaks.length > 0) {
		const sorted = [...new Set(merged.breaks)].sort((a, b) => a - b)
		return sorted
	}
	const extent = legendDataExtent(rawValues, type)
	if (!extent) return []
	const [lo, hi] = extent
	if (lo === hi) return [lo]
	const requested = merged.breakCount > 0 ? merged.breakCount : defaultCount
	const count = Math.max(floorCount, requested)
	// Temporal data lives in ms — `prettyBreaks` against epoch ms gives
	// ugly round-million values, not actual date boundaries. Fall through
	// to even-spacing for temporal until we wire d3-time-scale's tick logic.
	if (type !== "temporal") {
		const pretty = prettyBreaks(lo, hi, count)
		if (pretty.length >= floorCount) return pretty
	}
	const step = (hi - lo) / (count - 1)
	const out: number[] = []
	for (let i = 0; i < count; i++) out.push(lo + step * i)
	return out
}

/** Parse a user-typed CSV/whitespace-separated break list into a number
 * array. Non-numeric tokens are skipped silently — the sidebar input
 * trusts the user to fix bad input. Returned array is NOT sorted; the
 * resolver does that downstream. */
export const parseBreaksInput = (raw: string): number[] => {
	return raw
		.split(/[,;\s]+/)
		.map((s) => s.trim())
		.filter((s) => s !== "")
		.map((s) => Number(s))
		.filter((n) => Number.isFinite(n))
}

/** Inverse of `parseBreaksInput` — serializes back to the comma-separated
 * form the text input displays. */
export const formatBreaksInput = (breaks: number[]): string =>
	breaks.map((n) => (Number.isInteger(n) ? String(n) : n.toFixed(2))).join(", ")

/** Append a "+" to the topmost break label when the user's chosen top
 * break sits below the actual data max — signaling "this value or
 * higher, all the same color/size" (matches the clamp-out-of-range
 * behavior). Returns the label unchanged otherwise.
 *
 * No-op when:
 * - There's no data extent to compare against.
 * - `breakIndex` isn't the last entry in `breaks`.
 * - The top break is at or above the data max (typical of auto-pretty
 *   breaks, which extend outward via d3.nice). */
export const decorateOpenTopLabel = (
	label: string,
	breakIndex: number,
	breaks: number[],
	dataExtent: [number, number] | null,
): string => {
	if (!dataExtent || breaks.length === 0) return label
	if (breakIndex !== breaks.length - 1) return label
	const topBreak = breaks[breaks.length - 1]
	if (topBreak >= dataExtent[1]) return label
	return `${label}+`
}
