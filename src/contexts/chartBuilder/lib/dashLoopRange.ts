/** "Apply pattern to range" for a CLOSED line — a radar polygon's outline.
 *
 *  An open line runs along an axis and is cut where it crosses the window
 *  (`splitPolylineAtRange`). A radar's outline runs AROUND the angle axis and
 *  closes on itself, and its vertices sit on the spokes, so the window is a
 *  run of spokes: the edges between two spokes inside it draw with the dash,
 *  every other edge draws solid. Nothing is interpolated — a window boundary
 *  falls on a spoke, never between two. */

export type LoopPoint = {
	x: number
	y: number
	/** Where the vertex sits along the axis the loop runs around (a radar
	 *  spoke's angle). The window's bounds are in the same unit. */
	at: number
}

type Pt = { x: number; y: number }

export type LoopRangeRuns = {
	/** Open runs of edges inside the window (drawn with the dash). */
	inside: Pt[][]
	/** Open runs of edges outside it (drawn solid). */
	outside: Pt[][]
	/** True when one class covers the whole loop: its single run ends on the
	 *  point it started from, so it draws as the closed outline. */
	closed: boolean
}

/** Split the closed loop through `points` (in order around it) at the window
 *  [`lo`, `hi`]. `null` = unbounded on that side; the bounds swap if given
 *  reversed.
 *
 *  An edge is inside when both its ends are. The closing edge (last point
 *  back to the first) joins the two ends of the axis, so it is inside only
 *  when every vertex is — a window that stops short of either end leaves
 *  the wrap-around solid. */
export const splitLoopAtRange = (
	points: readonly LoopPoint[],
	lo: number | null,
	hi: number | null
): LoopRangeRuns => {
	const n = points.length
	if (n < 2) return { inside: [], outside: [], closed: false }
	let min = lo ?? -Infinity
	let max = hi ?? Infinity
	if (min > max) [min, max] = [max, min]
	const isIn = points.map((p) => p.at >= min && p.at <= max)
	const allIn = isIn.every(Boolean)
	const edgeInside = (i: number): boolean =>
		i === n - 1 ? allIn : isIn[i] === true && isIn[i + 1] === true
	const at = (i: number): Pt => {
		const p = points[i % n] as LoopPoint
		return { x: p.x, y: p.y }
	}

	const classes = Array.from({ length: n }, (_, i) => edgeInside(i))
	// One class all the way round: the whole outline, closed.
	if (classes.every((c) => c === classes[0])) {
		const loop = Array.from({ length: n + 1 }, (_, i) => at(i))
		return classes[0]
			? { inside: [loop], outside: [], closed: true }
			: { inside: [], outside: [loop], closed: true }
	}

	// Start where the class changes, so no run is split across the seam.
	let start = 0
	while (classes[(start + n - 1) % n] === classes[start]) start += 1
	const inside: Pt[][] = []
	const outside: Pt[][] = []
	let i = 0
	while (i < n) {
		const first = (start + i) % n
		const cls = classes[first]
		const run: Pt[] = [at(first)]
		while (i < n && classes[(start + i) % n] === cls) {
			run.push(at(start + i + 1))
			i += 1
		}
		;(cls ? inside : outside).push(run)
	}
	return { inside, outside, closed: false }
}
