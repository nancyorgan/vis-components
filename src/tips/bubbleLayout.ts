/**
 * Where a tip bubble sits beside its anchor. Pure geometry: the paced
 * tips (one bubble, `layoutBubble`) and the Info tips board (every bubble
 * for the view at once, `layoutBoard`) share it.
 */
import type { TipPlacement } from "./tips"

/** The pointer: how far it reaches out from the bubble, and its base. */
export const ARROW_LEN = 14
export const ARROW_BASE = 16
/** Space between the pointer's tip and the target. The highlight ring
 *  reaches 4px out (2px offset + 2px ring), so this leaves ~4px clear. */
const TIP_CLEARANCE = 8
const GAP = ARROW_LEN + TIP_CLEARANCE // anchor ↔ bubble
const MARGIN = 8 // bubble ↔ viewport edge
/** Corner radius of the bubble's outline. */
export const RADIUS = 20
/** Keep the pointer on the straight part of an edge, clear of the corners. */
const ARROW_INSET = RADIUS + ARROW_BASE / 2 + 2

export type Rect = { top: number; left: number; width: number; height: number }

export type BubbleLayout = {
	placement: TipPlacement
	top: number
	left: number
	/** Where the pointer leaves the bubble: its offset along the edge
	 *  that faces the anchor. */
	arrow: number
	/** Where the pointer's tip lands, on the same axis as `arrow` (equal
	 *  to it when the pointer goes straight out). */
	tip: number
	/** How far the pointer reaches out from that edge. */
	reach: number
}

const OPPOSITE: Record<TipPlacement, TipPlacement> = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left",
}

/** The sides to try: the preferred one, its opposite, then the rest. */
const sideOrder = (preferred: TipPlacement): TipPlacement[] => [
	preferred,
	OPPOSITE[preferred],
	...(["bottom", "right", "top", "left"] as const).filter(
		(p) => p !== preferred && p !== OPPOSITE[preferred]
	),
]

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v))

const vertical = (p: TipPlacement) => p === "top" || p === "bottom"

/** Place a w×h bubble beside `a`: the preferred side if it fits, else the
 *  opposite side, else whichever side has the most room. Centered on the
 *  anchor, kept inside the window, pointer straight out. */
export const layoutBubble = (
	a: Rect,
	w: number,
	h: number,
	preferred: TipPlacement,
	vw: number,
	vh: number
): BubbleLayout => {
	const room: Record<TipPlacement, number> = {
		top: a.top - GAP - MARGIN,
		bottom: vh - (a.top + a.height) - GAP - MARGIN,
		left: a.left - GAP - MARGIN,
		right: vw - (a.left + a.width) - GAP - MARGIN,
	}
	const need = (p: TipPlacement) => (vertical(p) ? h : w)
	const order = sideOrder(preferred)
	const placement =
		order.find((p) => room[p] >= need(p)) ??
		order.reduce((best, p) => (room[p] > room[best] ? p : best))
	const cx = a.left + a.width / 2
	const cy = a.top + a.height / 2
	if (vertical(placement)) {
		const left = clamp(cx - w / 2, MARGIN, Math.max(MARGIN, vw - w - MARGIN))
		const top =
			placement === "bottom" ? a.top + a.height + GAP : a.top - GAP - h
		const arrow = clamp(cx - left, ARROW_INSET, w - ARROW_INSET)
		return {
			placement,
			top: clamp(top, MARGIN, Math.max(MARGIN, vh - h - MARGIN)),
			left,
			arrow,
			tip: arrow,
			reach: ARROW_LEN,
		}
	}
	const top = clamp(cy - h / 2, MARGIN, Math.max(MARGIN, vh - h - MARGIN))
	const left = placement === "right" ? a.left + a.width + GAP : a.left - GAP - w
	const arrow = clamp(cy - top, ARROW_INSET, h - ARROW_INSET)
	return {
		placement,
		top,
		left: clamp(left, MARGIN, Math.max(MARGIN, vw - w - MARGIN)),
		arrow,
		tip: arrow,
		reach: ARROW_LEN,
	}
}

// ── The Info tips board ───────────────────────────────────────────────

/** How far out from its anchor a board bubble may sit: the usual gap
 *  first, then further out on a longer pointer when that's crowded. */
const BOARD_DISTANCES = [GAP, GAP + 40, GAP + 100, GAP + 180, GAP + 280]
/** A longer pointer may lean: its tip may land up to this much of its
 *  length to the side of where it leaves the bubble. */
const SLANT = 0.75
/** The least space kept between two bubbles. */
const BOARD_SPACING = 8
/** Second to overlaps, a bubble weighs covering other anchors (a point
 *  per percent of each anchor covered), pointers passing under bubbles
 *  (this many points each — the pointer goes under, so it's no worse
 *  than hiding a third of a control)… */
const CROSSING_COST = 30
/** …pointers whose tip ends under another bubble (as bad as hiding the
 *  anchor itself)… */
const TIP_HIDDEN_COST = 100
/** …and sitting further from its own: each step round or out costs this
 *  many points… */
const NEAR_COST = 12
/** …and sliding off center, a point per this many px. */
const DRIFT_PER_POINT = 25

export type BoardItem = {
	anchor: Rect
	w: number
	h: number
	preferred: TipPlacement
}

type Segment = { x1: number; y1: number; x2: number; y2: number }

const overlapArea = (a: Rect, b: Rect): number => {
	const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
	const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
	return w > 0 && h > 0 ? w * h : 0
}

const grow = (r: Rect, by: number): Rect => ({
	top: r.top - by,
	left: r.left - by,
	width: r.width + 2 * by,
	height: r.height + 2 * by,
})

/** Whether segment `s` passes through rect `r` (Liang–Barsky clip). */
const crosses = (s: Segment, r: Rect): boolean => {
	const dx = s.x2 - s.x1
	const dy = s.y2 - s.y1
	let t0 = 0
	let t1 = 1
	const edges: [number, number][] = [
		[-dx, s.x1 - r.left],
		[dx, r.left + r.width - s.x1],
		[-dy, s.y1 - r.top],
		[dy, r.top + r.height - s.y1],
	]
	for (const [p, q] of edges) {
		if (p === 0) {
			if (q < 0) return false
			continue
		}
		const t = q / p
		if (p < 0) t0 = Math.max(t0, t)
		else t1 = Math.min(t1, t)
		if (t0 > t1) return false
	}
	return true
}

/** Whether the pointer's tip lands under (or within a few px of) `r`. */
const tipUnder = (s: Segment, r: Rect): boolean =>
	s.x2 > r.left - 4 &&
	s.x2 < r.left + r.width + 4 &&
	s.y2 > r.top - 4 &&
	s.y2 < r.top + r.height + 4

type Candidate = { layout: BubbleLayout; box: Rect; pointer: Segment; along: number }

/**
 * A board bubble on `side` of `a`, `distance` out, with its top (left /
 * right sides) or left (top / bottom) at `along`, kept inside the window.
 * The pointer leaves the bubble as near the anchor's center as the
 * straight part of the edge allows and lands on the nearest point of the
 * anchor; null when that would lean further than SLANT allows.
 */
const placeOnBoard = (
	a: Rect,
	w: number,
	h: number,
	side: TipPlacement,
	distance: number,
	along: number,
	vw: number,
	vh: number
): Candidate | null => {
	const v = vertical(side)
	const left = v
		? clamp(along, MARGIN, Math.max(MARGIN, vw - w - MARGIN))
		: clamp(
				side === "right" ? a.left + a.width + distance : a.left - distance - w,
				MARGIN,
				Math.max(MARGIN, vw - w - MARGIN)
			)
	const top = v
		? clamp(
				side === "bottom" ? a.top + a.height + distance : a.top - distance - h,
				MARGIN,
				Math.max(MARGIN, vh - h - MARGIN)
			)
		: clamp(along, MARGIN, Math.max(MARGIN, vh - h - MARGIN))
	// The gap the window clamp actually left between anchor and bubble.
	const gap =
		side === "bottom"
			? top - (a.top + a.height)
			: side === "top"
				? a.top - (top + h)
				: side === "right"
					? left - (a.left + a.width)
					: a.left - (left + w)
	const reach = Math.max(gap - TIP_CLEARANCE, 4)
	// Along the edge: where the pointer leaves, and where it lands.
	const start = v ? left : top
	const span = v ? w : h
	const a0 = v ? a.left : a.top
	const a1 = a0 + (v ? a.width : a.height)
	const inset = Math.min(6, (a1 - a0) / 2)
	const base = clamp((a0 + a1) / 2, start + ARROW_INSET, start + span - ARROW_INSET)
	const land = clamp(base, a0 + inset, a1 - inset)
	if (Math.abs(land - base) > SLANT * reach + 0.5) return null
	// The pointer as a line from the edge to its tip, in window space.
	const edge =
		side === "bottom" ? top : side === "top" ? top + h : side === "right" ? left : left + w
	const out = side === "bottom" || side === "right" ? -reach : reach
	const pointer: Segment = v
		? { x1: base, y1: edge, x2: land, y2: edge + out }
		: { x1: edge, y1: base, x2: edge + out, y2: land }
	return {
		layout: { placement: side, top, left, arrow: base - start, tip: land - start, reach },
		box: { top, left, width: w, height: h },
		pointer,
		along: start,
	}
}

/** A spot for one bubble, with what makes it more or less good. */
type Spot = Candidate & {
	/** Steps from the ideal: round from the preferred side, plus out. */
	near: number
	/** How far it slid from centered on the anchor. */
	drift: number
}

/** A fixed shuffle (mulberry32), so the same view lays out the same. */
const shuffled = (xs: readonly number[], seed: number): number[] => {
	let t = seed
	const rand = () => {
		t = (t + 0x6d2b79f5) | 0
		let r = Math.imul(t ^ (t >>> 15), 1 | t)
		r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296
	}
	const out = [...xs]
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1))
		const tmp = out[i]
		out[i] = out[j] as number
		out[j] = tmp as number
	}
	return out
}

/**
 * Lay out every bubble on the Info tips board at once. Each bubble wants
 * the spot that, in order of importance:
 *   1. overlaps the least of the other bubbles (and their pointers), its
 *      own anchor and the `keepClear` rects (the header);
 *   2. covers the least of the OTHER anchors (as a share of each);
 *   3. is nearest: on the preferred side, close in, and failing that one
 *      step further out or round, a step at a time;
 *   4. strays least from centered on the anchor.
 * Further out, the pointer gets longer and may lean toward its anchor.
 * Bubbles are placed one at a time and then each re-placed among the
 * rest; since the first ones placed can crowd out the later, that runs
 * in a few orders and the best overall result wins. Returns layouts in
 * the order of `items`.
 */
export const layoutBoard = (
	items: readonly BoardItem[],
	keepClear: readonly Rect[],
	vw: number,
	vh: number
): BubbleLayout[] => {
	const n = items.length
	const anchors = items.map((o) => grow(o.anchor, 4))

	/** Spot `c` for bubble `i`, scored against the others in `sol`. */
	const score = (i: number, c: Spot, sol: readonly (Spot | null)[]): number[] => {
		let hard = overlapArea(c.box, anchors[i] ?? c.box)
		for (const r of keepClear) hard += overlapArea(c.box, r)
		let cover = 0
		for (let j = 0; j < n; j++) {
			if (j === i) continue
			const r = anchors[j]
			if (r) cover += (100 * overlapArea(c.box, r)) / Math.max(1, r.width * r.height)
			const o = sol[j]
			if (!o) continue
			hard += overlapArea(c.box, grow(o.box, BOARD_SPACING))
			if (crosses(c.pointer, o.box)) cover += CROSSING_COST
			if (crosses(o.pointer, c.box)) cover += CROSSING_COST
			// A pointer whose tip ends under a bubble points at nothing.
			if (tipUnder(c.pointer, o.box)) cover += TIP_HIDDEN_COST
			if (tipUnder(o.pointer, c.box)) cover += TIP_HIDDEN_COST
		}
		return [hard, cover + NEAR_COST * c.near + c.drift / DRIFT_PER_POINT]
	}

	/** The best spot for bubble `i` among the others in `sol`. */
	const placeOne = (i: number, sol: readonly (Spot | null)[]): { c: Spot; key: number[] } => {
		const item = items[i] as BoardItem
		const { anchor: a, w, h } = item
		const obstacles = [
			...keepClear,
			...anchors,
			...sol.flatMap((o, j) => (o && j !== i ? [grow(o.box, BOARD_SPACING)] : [])),
		]
		let best: { c: Spot; key: number[] } | null = null
		const sides = sideOrder(item.preferred)
		for (let sideRank = 0; sideRank < sides.length; sideRank++) {
			const side = sides[sideRank] ?? item.preferred
			const v = vertical(side)
			const span = v ? w : h
			const a0 = v ? a.left : a.top
			const a1 = a0 + (v ? a.width : a.height)
			const centered = (a0 + a1) / 2 - span / 2
			for (let tier = 0; tier < BOARD_DISTANCES.length; tier++) {
				const distance = BOARD_DISTANCES[tier] ?? GAP
				// How far the bubble may slide and still reach the anchor.
				const lean = SLANT * (distance - TIP_CLEARANCE)
				const lo = a0 - lean - span + ARROW_INSET
				const hi = a1 + lean - ARROW_INSET
				// Centered, and flush against each thing in the way: whatever
				// shares the row (top / bottom) or column (left / right) the
				// bubble sits in at this distance.
				const first = placeOnBoard(a, w, h, side, distance, clamp(centered, lo, hi), vw, vh)
				const band0 = first ? (v ? first.box.top : first.box.left) : -Infinity
				const band1 = band0 + (v ? h : w)
				const alongs = new Set<number>([clamp(centered, lo, hi)])
				for (const r of obstacles) {
					const r0 = v ? r.top : r.left
					const r1 = r0 + (v ? r.height : r.width)
					if (r1 <= band0 || r0 >= band1) continue
					alongs.add(Math.round(clamp(v ? r.left + r.width : r.top + r.height, lo, hi)))
					alongs.add(Math.round(clamp((v ? r.left : r.top) - span, lo, hi)))
				}
				for (const along of alongs) {
					const placed = placeOnBoard(a, w, h, side, distance, along, vw, vh)
					if (!placed) continue
					const c: Spot = {
						...placed,
						near: sideRank + tier,
						drift: Math.abs(placed.along - centered),
					}
					const key = score(i, c, sol)
					if (!best || lexLess(key, best.key)) best = { c, key }
				}
			}
		}
		if (best) return best
		// Nothing reachable (a window too small to hold it): the paced
		// tip's spot, pointer straight out.
		const l = layoutBubble(a, w, h, item.preferred, vw, vh)
		const v = vertical(l.placement)
		const edge =
			l.placement === "bottom"
				? l.top
				: l.placement === "top"
					? l.top + h
					: l.placement === "right"
						? l.left
						: l.left + w
		const along = (v ? l.left : l.top) + l.arrow
		const out = l.placement === "bottom" || l.placement === "right" ? -l.reach : l.reach
		const c: Spot = {
			layout: l,
			box: { top: l.top, left: l.left, width: w, height: h },
			pointer: v
				? { x1: along, y1: edge, x2: along, y2: edge + out }
				: { x1: edge, y1: along, x2: edge + out, y2: along },
			along: v ? l.left : l.top,
			near: 0,
			drift: 0,
		}
		return { c, key: score(i, c, sol) }
	}

	const solve = (order: readonly number[]): (Spot | null)[] => {
		const sol: (Spot | null)[] = new Array<Spot | null>(n).fill(null)
		for (const i of order) sol[i] = placeOne(i, sol).c
		for (let round = 0; round < 2; round++) {
			let moved = false
			for (const i of order) {
				const now = sol[i]
				const next = placeOne(i, sol)
				if (!now || lexLess(next.key, score(i, now, sol))) {
					sol[i] = next.c
					moved = true
				}
			}
			if (!moved) break
		}
		return sol
	}

	const total = (sol: readonly (Spot | null)[]): number[] => {
		const sum = [0, 0]
		sol.forEach((c, i) => {
			if (!c) return
			score(i, c, sol).forEach((v, k) => (sum[k] = (sum[k] ?? 0) + v))
		})
		return sum
	}

	const reading = items
		.map((_, i) => i)
		.sort((i, j) => {
			const a = items[i]?.anchor
			const b = items[j]?.anchor
			return a && b ? a.top - b.top || a.left - b.left : 0
		})
	const orders = [
		reading,
		[...reading].reverse(),
		// Biggest bubbles first: they're the hardest to fit.
		[...reading].sort((i, j) => (items[j]?.h ?? 0) - (items[i]?.h ?? 0)),
		...(n > 2 ? [1, 2, 3].map((seed) => shuffled(reading, seed)) : []),
	]
	let best: { sol: (Spot | null)[]; key: number[] } | null = null
	for (const order of orders) {
		const sol = solve(order)
		const key = total(sol)
		if (!best || lexLess(key, best.key)) best = { sol, key }
		// Nothing overlaps, nothing's covered: no order can do better on
		// what matters most.
		if ((key[0] ?? 0) === 0 && (key[1] ?? 0) === 0) break
	}
	return (best?.sol ?? []).map(
		(c, i) => c?.layout ?? layoutBubble(items[i]?.anchor ?? keepClear[0] ?? { top: 0, left: 0, width: 0, height: 0 }, 0, 0, "bottom", vw, vh)
	)
}

/** Lexicographic `a < b`, treating sub-pixel differences as ties. */
const lexLess = (a: number[], b: number[]): boolean => {
	for (let k = 0; k < a.length; k++) {
		const d = (a[k] ?? 0) - (b[k] ?? 0)
		if (Math.abs(d) > 0.5) return d < 0
	}
	return false
}
