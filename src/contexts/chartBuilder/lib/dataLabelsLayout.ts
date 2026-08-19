/** Helpers shared by `DataLabelsLayer` for the post-processing passes that
 *  decide which labels to render and where. Extracted so each rule can be
 *  tested without spinning up the SVG / Jotai machinery. */

import { charWidthConservativeFactor } from "./estimateMargins"

/** Approximate label bbox using a fixed width-per-character ratio — this is
 *  a heuristic, not a measured metric. For our purposes (overlap detection)
 *  a slight overestimate is fine: false positives just make `nudgeOverlaps`
 *  err on the side of separating labels that were borderline-touching —
 *  which is why this is the CONSERVATIVE tier (0.6) rather than the centered
 *  `charWidthFactor` (0.55) used for margin reservation. Re-exported under
 *  the local name because tests and `DataLabelsLayer` refer to it. */
export const CHAR_WIDTH_RATIO = charWidthConservativeFactor

export type LabelBox = {
	cx: number
	cy: number
	text: string
	fontSize: number
	/** Free-form key for series grouping (hue value, connection group, etc).
	 *  Two anchors with the same `series` are considered the same line / stack
	 *  / layer for the "only show last" pass. Empty string = no grouping. */
	series: string
	/** Original index in the input list. The "last" anchor in a series is the
	 *  one with the highest `index` whose `series` matches. */
	index: number
}

/** Width of a label's bbox in pixels. When `text` contains `\n` (a wrapped
 *  data label), the box is only as wide as its LONGEST line — so overlap
 *  detection reserves the narrower footprint a wrapped label actually
 *  occupies. Single-line text (no `\n`) is unchanged. */
export const labelWidth = (lb: Pick<LabelBox, "text" | "fontSize">): number => {
	const longest = lb.text
		.split("\n")
		.reduce((m, line) => Math.max(m, line.length), 0)
	return longest * lb.fontSize * CHAR_WIDTH_RATIO
}

/** Height of a label's bbox in pixels. One line per `\n`-separated segment,
 *  each ~`fontSize * 1.1` tall — so a wrapped label reserves the taller
 *  footprint its stacked lines occupy. Single-line text (no `\n`) returns
 *  the historical one-line height. */
export const labelHeight = (lb: Pick<LabelBox, "text" | "fontSize">): number =>
	lb.text.split("\n").length * lb.fontSize * 1.1

/** Filter `boxes` down to "the last anchor per series" — the rightmost /
 *  bottom-most box per series, depending on `axis`. Ties (multiple anchors
 *  at the same primary-axis position, e.g. stacked bars in the same
 *  category) break by the perpendicular axis, then by `index` to keep the
 *  selection deterministic.
 *
 *  Why position-based instead of index-based: the previous version used
 *  `index` as the ordering key, which assumed input order matched visual
 *  order. For row-based scatter+connection layers that's only true if rows
 *  were sorted by x — they often aren't, which surfaced as "the last label
 *  appears in the middle of the line" in the user-reported regression.
 *  Ranking by the position pixel removes that assumption.
 *
 *  Anchors with an empty `series` key form an implicit "no series" group,
 *  of which only the single furthest-along entry survives — that gives
 *  chart modes without a series concept (e.g. unfaceted, un-hued bars) a
 *  sensible "only one label" fallback rather than dropping everything. */
export const keepLastPerSeries = <T extends LabelBox>(
	boxes: T[],
	axis: "x" | "y" = "x"
): T[] => {
	if (boxes.length <= 1) return boxes
	const tags = selectEndpointsPerSeries(boxes, axis)
	return boxes.filter((b) => {
		const tag = tags.get(b)
		return tag === "last" || tag === "both"
	})
}

/** Which end(s) of its series a box sits at. `"both"` = the series has a
 *  single anchor, so its one box is simultaneously first and last. */
export type EndpointTag = "first" | "last" | "both"

/** Classify each series' extreme boxes. Only extremes appear as keys — a
 *  box absent from the map is an interior anchor. Callers use the tags both
 *  to filter (which labels survive a `labelPoints` selection) and to know
 *  which per-endpoint override block applies.
 *
 *  Ranking matches `keepLastPerSeries` (which now delegates here): primary
 *  position pixel along `axis`, perpendicular-axis tiebreak, then input
 *  index — position-based, not index-based, because row order often isn't
 *  visual order (see the rationale on `keepLastPerSeries`). "First" is the
 *  minimum end (leftmost / topmost), "last" the maximum. Boxes with an
 *  empty `series` form one implicit group, preserving the single-survivor
 *  fallback for chart modes without a series concept. */
export const selectEndpointsPerSeries = <T extends LabelBox>(
	boxes: T[],
	axis: "x" | "y" = "x"
): Map<T, EndpointTag> => {
	const cmp = (a: T, b: T): number => {
		// Primary axis: higher = "later". For axis="x", rightmost wins.
		// For axis="y", bottom-most (largest cy) wins. Callers in
		// horizontal-bar layouts pass axis="y".
		const ap = axis === "x" ? a.cx : a.cy
		const bp = axis === "x" ? b.cx : b.cy
		if (ap !== bp) return ap - bp
		// Tiebreak on the perpendicular axis so two anchors at the same
		// primary position (e.g. multiple stacked slices in one category)
		// pick the one nearest the visual end of its stack.
		const aq = axis === "x" ? a.cy : a.cx
		const bq = axis === "x" ? b.cy : b.cx
		if (aq !== bq) return aq - bq
		// Last resort — input order — keeps the selection deterministic
		// when both positions match exactly.
		return a.index - b.index
	}
	const extremes = new Map<string, { first: T; last: T }>()
	for (const b of boxes) {
		const prev = extremes.get(b.series)
		if (!prev) {
			extremes.set(b.series, { first: b, last: b })
			continue
		}
		if (cmp(b, prev.first) < 0) prev.first = b
		if (cmp(b, prev.last) > 0) prev.last = b
	}
	const tags = new Map<T, EndpointTag>()
	for (const { first, last } of extremes.values()) {
		if (first === last) tags.set(first, "both")
		else {
			tags.set(first, "first")
			tags.set(last, "last")
		}
	}
	return tags
}

/** Gap left between two separated labels' layout boxes. Must be > 0 so the
 *  final separation is strictly greater than the half-height sum — a
 *  zero-clearance (tangent) landing is float-fragile: the gap can compute
 *  to e.g. 35.19999999999999 vs a 35.2 threshold, re-triggering the strict
 *  `<` overlap test forever. */
export const NUDGE_CLEARANCE_PX = 1

/** Isotonic regression via pool-adjacent-violators: the non-decreasing
 *  sequence closest (least-squares) to `targets`. Equal-weight PAV: walk
 *  left to right, pooling any block whose mean drops below its
 *  predecessor's into a shared mean. */
const isotonicFit = (targets: number[]): number[] => {
	type Block = { sum: number; n: number; mean: number }
	const blocks: Block[] = []
	for (const t of targets) {
		let cur: Block = { sum: t, n: 1, mean: t }
		while (blocks.length > 0 && blocks[blocks.length - 1].mean >= cur.mean) {
			const prev = blocks.pop() as Block
			const sum = prev.sum + cur.sum
			const n = prev.n + cur.n
			cur = { sum, n, mean: sum / n }
		}
		blocks.push(cur)
	}
	return blocks.flatMap((b) => Array.from({ length: b.n }, () => b.mean))
}

/** Resolve label collisions by moving labels vertically. Mutates copies and
 *  returns them in input order; the input array is untouched.
 *
 *  Boxes are first grouped into clusters of (transitive) horizontal
 *  overlap — labels in different clusters can never collide, whatever
 *  their vertical positions.
 *
 *  For a cluster where EVERY pair shares horizontal range — the important
 *  case: end-of-line labels stacked at the right edge of a line chart —
 *  the layout is a 1-D problem solved exactly: sort by anchor cy, require
 *  a minimum gap between vertical neighbors (their half-height sum plus
 *  clearance), and pick the positions minimizing total squared displacement
 *  from the anchors (pool-adjacent-violators after a prefix-gap transform).
 *  Labels move UP as well as down, keep their data's vertical order, and
 *  stay as close to their own anchor as the gaps allow — the previous
 *  down-only greedy sweep could ram a label whose anchor sat ABOVE its
 *  collider's to the bottom of the pile, below labels it never touched.
 *
 *  Mixed-x clusters (chains of partial horizontal overlap) keep the legacy
 *  greedy sweep: walk input order, push any box colliding with an
 *  already-placed one down just past the collision. Enforcing neighbor
 *  gaps there would vertically separate labels that never actually
 *  intersect (they merely chain through a third box), which is far worse
 *  for dense label fields than the occasional greedy cascade. */
export const nudgeOverlaps = <T extends LabelBox>(boxes: T[]): T[] => {
	if (boxes.length <= 1) return boxes
	const xOverlap = (a: T, b: T): boolean =>
		Math.abs(a.cx - b.cx) < labelWidth(a) / 2 + labelWidth(b) / 2
	const overlap = (a: T, b: T): boolean =>
		xOverlap(a, b) &&
		Math.abs(a.cy - b.cy) < labelHeight(a) / 2 + labelHeight(b) / 2
	// Spread shallowly so we can mutate `cy` without touching the input.
	const out = boxes.map((b) => ({ ...b }))
	// Connected components under horizontal overlap (n is small — label
	// counts — so the quadratic scan is fine).
	const clusterOf = out.map((_, i) => i)
	const find = (i: number): number => {
		let r = i
		while (clusterOf[r] !== r) r = clusterOf[r]
		clusterOf[i] = r
		return r
	}
	for (let i = 0; i < out.length; i++) {
		for (let j = i + 1; j < out.length; j++) {
			if (xOverlap(out[i], out[j])) clusterOf[find(i)] = find(j)
		}
	}
	const clusters = new Map<number, number[]>()
	for (let i = 0; i < out.length; i++) {
		const root = find(i)
		clusters.set(root, [...(clusters.get(root) ?? []), i])
	}
	for (const members of clusters.values()) {
		if (members.length <= 1) continue
		const isStack = members.every((i, k) =>
			members.slice(k + 1).every((j) => xOverlap(out[i], out[j]))
		)
		if (isStack) {
			// 1-D optimal pass. Sort by anchor, then express the neighbor-gap
			// constraints `y[k+1] - y[k] >= gap[k]` in gap-cumulative space
			// (`z[k] = y[k] - prefix(gaps)`), where they become plain
			// monotonicity — exactly what isotonic regression solves.
			const order = [...members].sort(
				(a, b) => out[a].cy - out[b].cy || out[a].index - out[b].index
			)
			let prefix = 0
			const targets = order.map((idx, k) => {
				if (k > 0) {
					prefix +=
						labelHeight(out[order[k - 1]]) / 2 +
						labelHeight(out[idx]) / 2 +
						NUDGE_CLEARANCE_PX
				}
				return out[idx].cy - prefix
			})
			const fitted = isotonicFit(targets)
			let backPrefix = 0
			order.forEach((idx, k) => {
				if (k > 0) {
					backPrefix +=
						labelHeight(out[order[k - 1]]) / 2 +
						labelHeight(out[idx]) / 2 +
						NUDGE_CLEARANCE_PX
				}
				out[idx].cy = fitted[k] + backPrefix
			})
			continue
		}
		// Legacy greedy sweep for mixed-x clusters: input order, push down
		// just past each collision. Bound the inner loop — movement is
		// monotonically downward so each placed box is passed at most once.
		const placedIdx: number[] = []
		for (const idx of members) {
			for (let safety = 0; safety < placedIdx.length + 4; safety++) {
				const collider = placedIdx.find((p) => overlap(out[idx], out[p]))
				if (collider === undefined) break
				out[idx].cy +=
					labelHeight(out[collider]) / 2 +
					labelHeight(out[idx]) / 2 -
					(out[idx].cy - out[collider].cy) +
					NUDGE_CLEARANCE_PX
			}
			placedIdx.push(idx)
		}
	}
	return out
}

/** Estimate how much extra plot margin a chart needs so user-driven label
 *  offsets don't push labels off the inner plot rect. The user reported
 *  "if I push labels with x/y offset they get cut off at the viewport
 *  edges" — this helper feeds the additive `extraMargin` slot consumed
 *  by the layout solver so the SVG reserves room on the side the labels
 *  are heading.
 *
 *  Returns zero on every side when `enabled` is false (no labels rendering),
 *  so non-data-labels charts don't pay any padding cost.
 *
 *  Caveat: aggressive margin expansion makes the chart look like it
 *  *moves* in response to offset adjustments — the user reports
 *  "position adjuster moves the chart, not the labels relative to the
 *  chart". The chart base margin already reserves ~24px on the right
 *  and ~76px on the left, which absorbs small offsets without shifting
 *  the plot. We only add EXTRA margin for offsets that exceed those
 *  built-in reserves, so dialing a small offset (< base margin) shifts
 *  labels visibly without disturbing the chart's plot rect. */
export const estimateDataLabelMargins = ({
	enabled,
	xOffset,
	yOffset,
}: {
	enabled: boolean
	xOffset: number
	yOffset: number
	fontSize: number
}): { left: number; right: number; top: number; bottom: number } => {
	if (!enabled) return { left: 0, right: 0, top: 0, bottom: 0 }
	// `BASE_MARGIN` from `lib/plotLayout.ts`: top: 16, right: 24, bottom: 64,
	// left: 76. Inlined here to avoid a circular import — these values
	// are stable; if `BASE_MARGIN` changes, this estimate stops being
	// generous but never under-reserves.
	const BASE_RIGHT = 24
	const BASE_LEFT = 76
	const BASE_TOP = 16
	const BASE_BOTTOM = 64
	// Only request extra margin for the part of the offset that exceeds
	// the built-in reserve. For small offsets (within the base margin),
	// labels naturally fit in the existing reserved space and the plot
	// doesn't visibly shift.
	const right = Math.max(0, xOffset - BASE_RIGHT)
	const left = Math.max(0, -xOffset - BASE_LEFT)
	const bottom = Math.max(0, yOffset - BASE_BOTTOM)
	const top = Math.max(0, -yOffset - BASE_TOP)
	return { left, right, top, bottom }
}

/** Decide which point indices in a connection group should render markers,
 *  given the user's `pointSampling` mode and stride. Lines themselves
 *  always use every point (the polyline path is unaffected); this only
 *  filters the dots / shapes drawn AT each point. */
export const sampleConnectionPointIndices = (
	count: number,
	mode: "all" | "first-only" | "last-only" | "first-and-last" | "every-n",
	everyN: number
): number[] => {
	if (count === 0) return []
	if (count === 1) return [0]
	if (mode === "all") return Array.from({ length: count }, (_, i) => i)
	if (mode === "first-only") return [0]
	if (mode === "last-only") return [count - 1]
	if (mode === "first-and-last") return [0, count - 1]
	// every-n: stride along the line, then anchor first AND last so the
	// endpoints stay visible regardless of stride alignment.
	const stride = Math.max(1, Math.floor(everyN))
	const set = new Set<number>([0, count - 1])
	for (let i = 0; i < count; i += stride) set.add(i)
	return [...set].sort((a, b) => a - b)
}

/** Candidate directions for the 2-D overlap spread, tried in this order
 *  within each ring: verticals first (the cheapest clear for wide, short
 *  label boxes), then horizontals, then diagonals. Unit vectors, so every
 *  candidate in a ring sits at the same distance from the label's start. */
const SPREAD_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
	[0, -1],
	[0, 1],
	[1, 0],
	[-1, 0],
	[Math.SQRT1_2, -Math.SQRT1_2],
	[-Math.SQRT1_2, -Math.SQRT1_2],
	[Math.SQRT1_2, Math.SQRT1_2],
	[-Math.SQRT1_2, Math.SQRT1_2],
]

/** How many rings outward the 2-D spread searches before giving up and
 *  leaving a label at its (still colliding) start position. Ring spacing is
 *  one line-height per step, so this bounds displacement to roughly a dozen
 *  label heights — far enough to clear a dense cluster, close enough that a
 *  leader line still reads as belonging to its label. */
const MAX_SPREAD_RINGS = 12

/** With a `prefer` predicate in play, how many rings PAST the first plain
 *  free spot the spread keeps searching for a preferred one. Small on
 *  purpose: sending a label into open map space is worth a slightly longer
 *  leader line, but not a flight across the chart. */
const PREFERRED_LOOKAHEAD_RINGS = 2

/** Resolve label collisions by moving labels in ANY direction — the 2-D
 *  counterpart of `nudgeOverlaps`, used by the GEO renderers. Map labels
 *  are scattered over a plane (region centroids), so the vertical-only
 *  nudge — right for end-of-line series labels — just piles colliding map
 *  labels into a downward column, which wastes space and looks lopsided
 *  once leader lines tie each label back to its region.
 *
 *  Greedy candidate-ring placement: walk boxes in input order; a box that
 *  collides with an already-placed one tries candidate positions on rings
 *  around its start position (its anchor plus the user's offsets) at
 *  one-line-height steps, verticals → horizontals → diagonals within each
 *  ring, and takes the FIRST candidate whose padded box is free — i.e. the
 *  closest available spot. Non-colliding boxes never move; a box with no
 *  free candidate within `MAX_SPREAD_RINGS` stays put (best-effort, like
 *  the 1-D pass). Deterministic: no randomness, input order decides ties.
 *
 *  The optional `prefer` predicate marks pixels the spread should steer
 *  displaced labels toward — on maps, open space: ocean and regions with no
 *  data, where a label can't sit on top of another region's marks. Within
 *  each ring preferred candidates win over merely-free ones, and the search
 *  keeps looking up to `PREFERRED_LOOKAHEAD_RINGS` past the first plain
 *  free spot for a preferred one before settling — so a label beside a
 *  coast or an empty neighbor drifts there, but never flies far just to
 *  reach water. Labels that don't collide still never move.
 *
 *  Placed boxes are indexed in a coarse spatial hash so the candidate
 *  probes stay near-linear even when a map carries thousands of labels
 *  (county-level joins). Mutates copies; the input array is untouched. */
export const spreadOverlaps2D = <T extends LabelBox>(
	boxes: T[],
	opts?: { prefer?: (x: number, y: number) => boolean }
): T[] => {
	if (boxes.length <= 1) return boxes
	const out = boxes.map((b) => ({ ...b }))
	const halfW = (b: T) => labelWidth(b) / 2
	const halfH = (b: T) => labelHeight(b) / 2
	// Spatial hash of PLACED boxes by center cell. Query reach must cover
	// the largest placed half-extent, tracked as boxes land.
	const CELL = 256
	const cells = new Map<string, number[]>()
	let maxHalfW = 0
	let maxHalfH = 0
	const collides = (b: T, x: number, y: number, gap: number): boolean => {
		const reachX = halfW(b) + maxHalfW + gap
		const reachY = halfH(b) + maxHalfH + gap
		const i0 = Math.floor((x - reachX) / CELL)
		const i1 = Math.floor((x + reachX) / CELL)
		const j0 = Math.floor((y - reachY) / CELL)
		const j1 = Math.floor((y + reachY) / CELL)
		for (let i = i0; i <= i1; i++) {
			for (let j = j0; j <= j1; j++) {
				const bucket = cells.get(`${i}:${j}`)
				if (!bucket) continue
				for (const idx of bucket) {
					const p = out[idx]
					if (
						Math.abs(x - p.cx) < halfW(b) + halfW(p) + gap &&
						Math.abs(y - p.cy) < halfH(b) + halfH(p) + gap
					) {
						return true
					}
				}
			}
		}
		return false
	}
	const place = (idx: number) => {
		const b = out[idx]
		const k = `${Math.floor(b.cx / CELL)}:${Math.floor(b.cy / CELL)}`
		const bucket = cells.get(k)
		if (bucket) bucket.push(idx)
		else cells.set(k, [idx])
		maxHalfW = Math.max(maxHalfW, halfW(b))
		maxHalfH = Math.max(maxHalfH, halfH(b))
	}
	for (let idx = 0; idx < out.length; idx++) {
		const b = out[idx]
		// Strict-overlap test (no clearance) decides whether to move at all —
		// labels merely within clearance of each other stay put, matching the
		// 1-D pass's detection. Candidates then demand the padded gap so the
		// chosen spot has visible breathing room.
		if (collides(b, b.cx, b.cy, 0)) {
			const step = halfH(b) * 2 + NUDGE_CLEARANCE_PX
			const prefer = opts?.prefer
			// First plain-free candidate, kept as the fallback while the search
			// looks a little further for a PREFERRED free spot.
			let fallback: { x: number; y: number } | null = null
			let fallbackRing = 0
			search: for (let ring = 1; ring <= MAX_SPREAD_RINGS; ring++) {
				if (
					fallback !== null &&
					ring > fallbackRing + PREFERRED_LOOKAHEAD_RINGS
				) {
					break
				}
				for (const [dx, dy] of SPREAD_DIRECTIONS) {
					const x = b.cx + dx * ring * step
					const y = b.cy + dy * ring * step
					if (collides(b, x, y, NUDGE_CLEARANCE_PX)) continue
					if (!prefer || prefer(x, y)) {
						b.cx = x
						b.cy = y
						fallback = null
						break search
					}
					if (fallback === null) {
						fallback = { x, y }
						fallbackRing = ring
					}
				}
			}
			if (fallback !== null) {
				b.cx = fallback.x
				b.cy = fallback.y
			}
		}
		place(idx)
	}
	return out
}

/** The leader-line segment from an anchor point (a map region's centroid)
 *  toward the CENTER of a label's bounding box, clipped at the box edge so
 *  the line meets the label without running under its glyphs. Returns null
 *  when the anchor sits inside the box — a label still on (or over) its
 *  anchor needs no leader. Used by the geo Data Labels leader-line render;
 *  pure math so it's testable without SVG. */
export const leaderLineSegment = ({
	anchorX,
	anchorY,
	left,
	right,
	top,
	bottom,
}: {
	anchorX: number
	anchorY: number
	left: number
	right: number
	top: number
	bottom: number
}): { x1: number; y1: number; x2: number; y2: number } | null => {
	const cx = (left + right) / 2
	const cy = (top + bottom) / 2
	const dx = cx - anchorX
	const dy = cy - anchorY
	// Slab clipping against the box, aimed at its center. The center is
	// inside the box by construction, so along each axis the segment either
	// starts inside the slab (dx/dy = 0 → the axis constrains nothing) or
	// crosses into it at the smaller of the two boundary parameters; the
	// segment enters the box at the LATER of the two axis entries.
	const tx = dx === 0 ? -Infinity : Math.min((left - anchorX) / dx, (right - anchorX) / dx)
	const ty = dy === 0 ? -Infinity : Math.min((top - anchorY) / dy, (bottom - anchorY) / dy)
	const t = Math.max(tx, ty)
	// t <= 0 → the anchor is already inside the box (or on its edge).
	if (!Number.isFinite(t) || t <= 0) return null
	return {
		x1: anchorX,
		y1: anchorY,
		x2: anchorX + dx * t,
		y2: anchorY + dy * t,
	}
}
