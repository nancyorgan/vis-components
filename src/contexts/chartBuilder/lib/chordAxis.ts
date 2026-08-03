// Tick math for the chord layout's circular value axis — the graduated tick
// marks drawn around the ring showing each node's flow total (d3's classic
// chord "group ticks"). Pure functions so the geometry is unit-testable
// without rendering; ChordPlot owns the SVG emission.

import { tickStep } from "d3-array"
import { format, formatPrefix, precisionFixed } from "d3-format"

import { buildTickFormatter } from "./formatTick"

/** One tick around the ring. `angle` uses the d3-chord convention: radians,
 * 0 at 12 o'clock, increasing clockwise. `label` is the formatted value for
 * labeled ticks and `null` for the unlabeled graduation marks between them. */
export type ChordAxisTick = {
	value: number
	angle: number
	label: string | null
}

/** The slice of a d3 ChordGroup the tick math needs. */
export type ChordGroupAngles = {
	startAngle: number
	endAngle: number
	value: number
}

/** The ring's shared tick step: a nice round value-step targeting
 * `tickCount` graduations around the full ring, derived from the TOTAL flow
 * so every group shares one scale. `null` when there's nothing to tick
 * (zero / non-finite total, or a degenerate count). */
export const chordAxisStep = (
	total: number,
	tickCount: number
): number | null => {
	if (!Number.isFinite(total) || total <= 0) return null
	if (!Number.isFinite(tickCount) || tickCount <= 0) return null
	const step = tickStep(0, total, tickCount)
	return Number.isFinite(step) && step > 0 ? step : null
}

/** Hard per-group tick cap. A hand-typed step far below the auto one (say
 * 0.001 against a six-figure total) would otherwise emit millions of SVG
 * nodes and peg the main thread; past this cap the step re-derives to land
 * exactly at the cap. */
const MAX_TICKS_PER_GROUP = 200

/**
 * Ticks for one node's arc: value graduations every `step` units from the
 * group's start angle, labeled every `labelEvery`-th tick (starting at 0, so
 * each group's total reads from its start). Mirrors d3's `groupTicks`, with
 * index-based label selection (value-modulo breaks on fractional steps).
 */
export const chordAxisTicks = (
	group: ChordGroupAngles,
	step: number,
	labelEvery: number,
	formatLabel: (v: number) => string
): ChordAxisTick[] => {
	if (
		!Number.isFinite(step) ||
		step <= 0 ||
		!Number.isFinite(group.value) ||
		group.value <= 0
	) {
		return []
	}
	const safeStep =
		group.value / step > MAX_TICKS_PER_GROUP
			? tickStep(0, group.value, MAX_TICKS_PER_GROUP)
			: step
	const every = Math.max(1, Math.floor(labelEvery))
	const k = (group.endAngle - group.startAngle) / group.value
	const ticks: ChordAxisTick[] = []
	for (let i = 0, v = 0; v < group.value; i += 1, v = i * safeStep) {
		ticks.push({
			value: v,
			angle: group.startAngle + v * k,
			label: i % every === 0 ? formatLabel(v) : null,
		})
	}
	return ticks
}

/**
 * Label formatter for the axis: the user's d3-format spec when set (same
 * semantics as the x / y tick Format control), else an automatic format
 * calibrated to the step — SI-prefixed for step ≥ 1 (`5k`, `10k`, … — the
 * d3 chord example's default), fixed-decimal for fractional steps (an SI
 * prefix would render a small total in "milli" units).
 */
export const chordTickFormatter = (
	customFormat: string,
	step: number
): ((v: number) => string) => {
	const custom = buildTickFormatter({ customFormat }, "quantitative")
	if (custom) return custom
	const auto =
		step >= 1
			? formatPrefix(",.0", step)
			: format(`,.${Math.min(20, precisionFixed(step))}f`)
	return (v) => auto(v)
}
