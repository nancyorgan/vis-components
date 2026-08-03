import { extent } from "d3-array"
import { scaleLinear, scaleTime } from "d3-scale"

import { DEFAULT_ANGLE_CONFIG, type AngleConfig } from "./channelConfig"
import type { RadialScales } from "./coords/types"
import { parseValue } from "./scales"
import { applyLevelOrder } from "./smartSort"
import type { FieldType } from "./types"

/** Build polar angle + radius scales from a field's raw values. The
 *  resulting `RadialScales` packages the per-row mappers plus the
 *  resolved tick lists the axis renderer uses to paint rings/spokes/labels.
 *
 *  Angle conventions:
 *    - 0 radians = 12 o'clock (top).
 *    - Grows clockwise. The renderer converts via
 *      `(cx + r·sin(θ), cy − r·cos(θ))`.
 *    - Categorical/ordinal: evenly spaced — `2π · (i / N)` where `i` is
 *      the value's position in the resolved level order.
 *    - Quantitative/temporal: linearly normalized — `(v − min) / (max − min) · 2π`.
 *
 *  Radius conventions:
 *    - Linear (quantitative/temporal): `0 → maxRadius`. The domain
 *      starts at the data min when it's positive and 0 otherwise so the
 *      common "scores from 60-100" case fills the disc rather than
 *      compressing into the outer ring; this can become configurable
 *      later via the r-axis options panel.
 *    - Categorical/ordinal: equally-spaced rings at
 *      `(i + 1) / N · maxRadius`. */
export const buildRadarScales = (args: {
	angleField: string
	angleType: FieldType
	angleRaws: ReadonlyArray<unknown>
	angleLevelOrder?: ReadonlyArray<string>
	rField: string
	rType: FieldType
	rRaws: ReadonlyArray<unknown>
	rLevelOrder?: ReadonlyArray<string>
	center: { cx: number; cy: number }
	maxRadius: number
	rTickCount?: number
	/** Independent concentric-ring count for the r-axis gridlines. When
	 *  `null` or omitted the rings sit at each rTick position (the
	 *  "Match tick count" toggle's ON state); when a number is supplied
	 *  the ring set is generated independently so a user can request,
	 *  e.g., 4 labeled ticks but 10 background rings. Categorical /
	 *  ordinal R ignores this — its rings are pinned to category positions. */
	rGridlineCount?: number | null
	/** Optional explicit R-axis domain bounds. Either bound may be
	 *  undefined to keep the auto-derived value on that side. Only
	 *  affects quantitative / temporal R; categorical / ordinal R
	 *  ignores these (no meaningful "min/max" on a band-style scale). */
	rMinOverride?: number
	rMaxOverride?: number
	/** When provided, drives angular sweep bounds (minAngle/maxAngle in
	 *  degrees) and quantitative-tick count for the angle scale. The
	 *  -180/180 factory default is treated as "use radar's natural 0–2π
	 *  sweep starting at 12 o'clock" so brand-new radar charts look right
	 *  without the user touching the config. Any non-default value is
	 *  honored verbatim. */
	angleConfig?: AngleConfig
}): RadialScales => {
	const angleBounds = resolveAngleBounds(args.angleConfig)
	const angleTickCount = args.angleConfig?.tickCount ?? 6
	const angle = buildAngleScale(
		args.angleRaws,
		args.angleType,
		args.angleLevelOrder,
		angleBounds,
		angleTickCount,
	)
	const r = buildRScale(
		args.rRaws,
		args.rType,
		args.maxRadius,
		args.rLevelOrder,
		args.rTickCount ?? 5,
		args.rGridlineCount ?? null,
		args.rMinOverride,
		args.rMaxOverride,
	)
	return {
		angleScale: angle.scale,
		rScale: r.scale,
		center: args.center,
		maxRadius: args.maxRadius,
		angleTicks: angle.ticks,
		rTicks: r.ticks,
		rGridRadii: r.gridRadii,
	}
}

/** Resolve the angular sweep bounds (start, end) in radians. The factory
 *  default of –180/180 degrees is treated as a sentinel meaning "use
 *  radar's natural 0–2π sweep" — that's what gives new radar charts
 *  the canonical "start at 12 o'clock, full circle clockwise" look
 *  without requiring users to manually set 0/360 in the Angle panel.
 *  Any other (min, max) pair is honored verbatim as the user-chosen
 *  partial sweep (e.g., 0/180 for a semicircle). */
const resolveAngleBounds = (cfg: AngleConfig | undefined): {
	startRad: number
	endRad: number
} => {
	const minDeg = cfg?.minAngle ?? DEFAULT_ANGLE_CONFIG.minAngle
	const maxDeg = cfg?.maxAngle ?? DEFAULT_ANGLE_CONFIG.maxAngle
	const isDefault =
		minDeg === DEFAULT_ANGLE_CONFIG.minAngle &&
		maxDeg === DEFAULT_ANGLE_CONFIG.maxAngle
	if (isDefault) return { startRad: 0, endRad: Math.PI * 2 }
	return {
		startRad: (minDeg * Math.PI) / 180,
		endRad: (maxDeg * Math.PI) / 180,
	}
}

type AngleBundle = {
	scale: (raw: unknown) => number | null
	ticks: ReadonlyArray<{ label: string; angle: number }>
}

const buildAngleScale = (
	raws: ReadonlyArray<unknown>,
	type: FieldType,
	levelOrder: ReadonlyArray<string> | undefined,
	bounds: { startRad: number; endRad: number },
	tickCount: number,
): AngleBundle => {
	const { startRad, endRad } = bounds
	const sweep = endRad - startRad
	if (type === "categorical" || type === "ordinal") {
		const parsed = raws
			.map((v) => parseValue(v, type))
			.filter((v) => v !== null)
			.map(String)
		const domain = applyLevelOrder([...new Set(parsed)], type, levelOrder)
		const n = Math.max(domain.length, 1)
		const indexByValue = new Map<string, number>()
		domain.forEach((v, i) => indexByValue.set(v, i))
		// For a full sweep (≈ 2π) the last position would coincide with the
		// first — so we divide by N. For a partial sweep we divide by
		// (N-1) so the first lands at startRad and the last lands at
		// endRad (categories evenly distributed across the sweep). One-
		// category fallback parks at startRad.
		const isFullSweep = Math.abs(Math.abs(sweep) - Math.PI * 2) < 1e-6
		const denom = isFullSweep ? n : Math.max(n - 1, 1)
		const scale = (raw: unknown): number | null => {
			const parsedRaw = parseValue(raw, type)
			if (parsedRaw === null) return null
			const i = indexByValue.get(String(parsedRaw))
			if (i === undefined) return null
			return startRad + (i / denom) * sweep
		}
		const ticks = domain.map((label, i) => ({
			label,
			angle: startRad + (i / denom) * sweep,
		}))
		return { scale, ticks }
	}
	// Quantitative / temporal — but first check whether the data is
	// effectively discrete (few unique values). For things like Year
	// auto-detected as quantitative (2021, 2022, 2023, 2024), the user
	// expects 4 evenly-spaced spokes at 90° each, not linear positioning
	// that puts 2021 and 2024 at coincident angles (0° and 360° = top
	// of circle). Route discrete-looking quant/temporal data through the
	// same "one spoke per unique value, evenly spaced" path the
	// categorical branch uses.
	const nums = numericValues(raws, type)
	const uniqueNums = [...new Set(nums)].sort((a, b) => a - b)
	const DISCRETE_ANGLE_THRESHOLD = 12
	if (uniqueNums.length > 0 && uniqueNums.length <= DISCRETE_ANGLE_THRESHOLD) {
		const n = uniqueNums.length
		const indexByValue = new Map<number, number>()
		uniqueNums.forEach((v, i) => indexByValue.set(v, i))
		const isFullSweep = Math.abs(Math.abs(sweep) - Math.PI * 2) < 1e-6
		const denom = isFullSweep ? n : Math.max(n - 1, 1)
		const scale = (raw: unknown): number | null => {
			const num = numericValue(raw, type)
			if (num === null) return null
			const i = indexByValue.get(num)
			if (i === undefined) return null
			return startRad + (i / denom) * sweep
		}
		const ticks = uniqueNums.map((num, i) => ({
			label:
				type === "temporal"
					? new Date(num).toISOString().slice(0, 10)
					: formatNumberTick(num),
			angle: startRad + (i / denom) * sweep,
		}))
		return { scale, ticks }
	}

	const [lo = 0, hi = 1] = (extent(nums) as [number, number] | [undefined, undefined])
	const range = hi - lo || 1
	const scale = (raw: unknown): number | null => {
		const n = numericValue(raw, type)
		if (n === null) return null
		return startRad + ((n - lo) / range) * sweep
	}
	// Use a linear scale to pick "nice" tick values; build a label per tick.
	// Dedupe by label so e.g. Year-as-quantitative with domain [2022, 2024]
	// and tickCount=6 doesn't render six positions labeled "2022, 2022,
	// 2023, 2023, 2024, 2024" — the d3-picked fractional ticks
	// (2022.4, 2022.8, …) all round to the same integer label after
	// `formatNumberTick`, which clutters the angle ring. Keeping the
	// first tick at each distinct label preserves the visual rhythm
	// while removing the duplication.
	const tickSourceRaw =
		type === "temporal"
			? scaleTime()
					.domain([new Date(lo), new Date(hi)])
					.ticks(tickCount)
					.map((d) => ({ raw: d, label: d.toISOString().slice(0, 10) }))
			: scaleLinear()
					.domain([lo, hi])
					.ticks(tickCount)
					.map((n) => ({ raw: n, label: formatNumberTick(n) }))
	const seenLabels = new Set<string>()
	const tickSource = tickSourceRaw.filter(({ label }) => {
		if (seenLabels.has(label)) return false
		seenLabels.add(label)
		return true
	})
	const ticks = tickSource.map(({ raw, label }) => {
		const angleVal =
			type === "temporal"
				? startRad + (((raw as Date).getTime() - lo) / range) * sweep
				: startRad + (((raw as number) - lo) / range) * sweep
		return { label, angle: angleVal }
	})
	return { scale, ticks }
}

type RBundle = {
	scale: (raw: unknown) => number | null
	ticks: ReadonlyArray<{ label: string; radius: number }>
	/** Concentric-ring radii (px). Equals `ticks.map(t => t.radius)` when
	 *  the caller passed `gridlineCount == null`; otherwise a freshly
	 *  generated, equally-spaced ring set independent of the tick labels. */
	gridRadii: ReadonlyArray<number>
}

const buildRScale = (
	raws: ReadonlyArray<unknown>,
	type: FieldType,
	maxRadius: number,
	levelOrder: ReadonlyArray<string> | undefined,
	tickCount: number,
	gridlineCount: number | null,
	rMinOverride?: number,
	rMaxOverride?: number,
): RBundle => {
	if (type === "categorical" || type === "ordinal") {
		// Categorical/ordinal r: place rings at equal spacing. The first
		// category sits at maxRadius/N from the center, the last at maxRadius.
		const parsed = raws
			.map((v) => parseValue(v, type))
			.filter((v) => v !== null)
			.map(String)
		const domain = applyLevelOrder([...new Set(parsed)], type, levelOrder)
		const n = Math.max(domain.length, 1)
		const indexByValue = new Map<string, number>()
		domain.forEach((v, i) => indexByValue.set(v, i))
		const radiusFor = (i: number) => ((i + 1) / n) * maxRadius
		const scale = (raw: unknown): number | null => {
			const parsedRaw = parseValue(raw, type)
			if (parsedRaw === null) return null
			const i = indexByValue.get(String(parsedRaw))
			if (i === undefined) return null
			return radiusFor(i)
		}
		const ticks = domain.map((label, i) => ({
			label,
			radius: radiusFor(i),
		}))
		// Categorical/ordinal r: rings pin to category positions; the
		// gridline-count override is meaningless here (you can't ask for
		// 10 evenly spaced rings on a band scale with 3 categories).
		return { scale, ticks, gridRadii: ticks.map((t) => t.radius) }
	}
	// Quantitative / temporal: linear from 0 (or data min if negative)
	// to data max — with the user's overrides winning when set. This
	// mirrors the cartesian Y axis override application: an explicit
	// `min = 0` pins the floor even when data starts at 60; an
	// explicit `max` caps regardless of data extent.
	const nums = numericValues(raws, type)
	const [dataMin = 0, dataMax = 1] = (extent(nums) as [number, number] | [undefined, undefined])
	const autoLo = Math.min(0, dataMin)
	const autoHi = dataMax === autoLo ? autoLo + 1 : dataMax
	const lo = rMinOverride ?? autoLo
	const hiCandidate = rMaxOverride ?? autoHi
	// Guard against a user setting min > max (or equal). Fall back to a
	// 1-unit window so the scale stays usable rather than collapsing.
	const hi = hiCandidate > lo ? hiCandidate : lo + 1
	const linear = scaleLinear().domain([lo, hi]).range([0, maxRadius]).nice()
	const tickValues = linear.ticks(tickCount)
	const scale = (raw: unknown): number | null => {
		const n = numericValue(raw, type)
		if (n === null) return null
		return linear(n)
	}
	const ticks = tickValues
		// Skip the zero ring — it's just a dot at the center.
		.filter((v) => linear(v) > 0.5)
		.map((v) => ({
			label:
				type === "temporal" ? new Date(v).toISOString().slice(0, 10) : formatNumberTick(v),
			radius: linear(v),
		}))
	// Ring set: when the user has dialed in an explicit gridline count,
	// generate evenly-spaced rings independently of the tick set. d3's
	// `.ticks(n)` returns "nice" round positions but won't honor `n`
	// exactly — for the ring background we DO want exactly the requested
	// count, with the outermost ring sitting at maxRadius so the chart
	// has a visible perimeter. Otherwise mirror the tick radii (legacy
	// "match tick count" behavior).
	const gridRadii =
		gridlineCount != null && gridlineCount >= 1
			? Array.from({ length: gridlineCount }, (_, i) =>
					((i + 1) / gridlineCount) * maxRadius,
				)
			: ticks.map((t) => t.radius)
	return { scale, ticks, gridRadii }
}

const numericValue = (raw: unknown, type: FieldType): number | null => {
	if (type === "temporal") {
		const d = parseValue(raw, "temporal")
		return d instanceof Date ? d.getTime() : null
	}
	const v = parseValue(raw, type)
	return typeof v === "number" ? v : null
}

const numericValues = (
	raws: ReadonlyArray<unknown>,
	type: FieldType,
): number[] => {
	const out: number[] = []
	for (const raw of raws) {
		const n = numericValue(raw, type)
		if (n !== null) out.push(n)
	}
	return out
}

const formatNumberTick = (n: number): string => {
	if (!Number.isFinite(n)) return String(n)
	if (Number.isInteger(n)) return String(n)
	return Number(n.toPrecision(4)).toString()
}
