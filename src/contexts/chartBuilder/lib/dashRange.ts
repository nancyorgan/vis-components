/** "Apply pattern to range" split math. A line's dash pattern draws
 *  only within a [min, max] window along the axis the line runs along; the
 *  parts outside render solid. This module is the pure pixel-space split the
 *  renderers share: given a polyline ordered along that axis and the window's
 *  pixel boundaries, cut it into before / inside / after sub-polylines with
 *  exact interpolated boundary points so the segments meet with no gap or
 *  overlap. */

export type DashRangePoint = { x: number; y: number }

export type DashRangeSegments = {
	/** The part on the low side of the window (renders solid). */
	before: DashRangePoint[]
	/** The part within [min, max] (renders with the dash pattern). */
	inside: DashRangePoint[]
	/** The part on the high side of the window (renders solid). */
	after: DashRangePoint[]
}

/** Split `points` at the pixel boundaries `minPx` / `maxPx` along `axis`.
 *
 *  - `points` must be MONOTONE along `axis` (ascending or descending) — the
 *    order every calling renderer already guarantees (connection lines sort
 *    by cx; area edges walk the category axis; regression samples are
 *    x-ordered). Monotone input means each segment is one contiguous run.
 *  - `null` boundary = unbounded on that side; boundaries swap if reversed.
 *  - A point exactly on a boundary is the shared endpoint of both adjacent
 *    segments.
 *  - Segments with fewer than 2 points come back as empty arrays — nothing
 *    to draw there.
 *
 *  Each span (consecutive point pair) is cut at the boundaries it straddles
 *  and every sub-span is assigned to the region of its MIDPOINT — robust to
 *  spans that start or end exactly on a boundary (classifying points instead
 *  of spans drops those). */
export const splitPolylineAtRange = (
	points: readonly DashRangePoint[],
	minPx: number | null,
	maxPx: number | null,
	axis: "x" | "y"
): DashRangeSegments => {
	const c = (p: DashRangePoint): number => (axis === "x" ? p.x : p.y)
	let lo = minPx ?? -Infinity
	let hi = maxPx ?? Infinity
	if (lo > hi) [lo, hi] = [hi, lo]

	const before: DashRangePoint[] = []
	const inside: DashRangePoint[] = []
	const after: DashRangePoint[] = []
	const segFor = (v: number): DashRangePoint[] =>
		v < lo ? before : v > hi ? after : inside
	const push = (seg: DashRangePoint[], p: DashRangePoint) => {
		const last = seg[seg.length - 1]
		if (last && last.x === p.x && last.y === p.y) return
		seg.push(p)
	}
	const lerpAt = (
		a: DashRangePoint,
		b: DashRangePoint,
		boundary: number
	): DashRangePoint => {
		// Only called for spans that strictly straddle `boundary`, so the
		// denominator is nonzero; clamp t defensively against float drift.
		const t = Math.min(1, Math.max(0, (boundary - c(a)) / (c(b) - c(a))))
		return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
	}

	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i]
		const b = points[i + 1]
		if (!a || !b) continue
		const ca = c(a)
		const cb = c(b)
		// Cut the span at every finite boundary it strictly straddles,
		// ordered along the span's direction of travel.
		const cuts = [lo, hi]
			.filter((bd) => Number.isFinite(bd))
			.filter((bd) => (ca < bd && cb > bd) || (ca > bd && cb < bd))
			.sort((p1, p2) => Math.abs(p1 - ca) - Math.abs(p2 - ca))
			.map((bd) => lerpAt(a, b, bd))
		const chain = [a, ...cuts, b]
		for (let k = 0; k + 1 < chain.length; k++) {
			const u = chain[k]
			const v = chain[k + 1]
			if (!u || !v) continue
			const seg = segFor((c(u) + c(v)) / 2)
			push(seg, u)
			push(seg, v)
		}
	}

	return {
		before: before.length >= 2 ? before : [],
		inside: inside.length >= 2 ? inside : [],
		after: after.length >= 2 ? after : [],
	}
}
