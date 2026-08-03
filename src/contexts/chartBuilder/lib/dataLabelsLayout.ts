/** Helpers shared by `DataLabelsLayer` for the post-processing passes that
 *  decide which labels to render and where. Extracted so each rule can be
 *  tested without spinning up the SVG / Jotai machinery. */

/** Approximate label bbox using a fixed width-per-character ratio — this is
 *  a heuristic, not a measured metric. For our purposes (overlap detection)
 *  a slight overestimate is fine: false positives just make `nudgeOverlaps`
 *  err on the side of separating labels that were borderline-touching. */
export const CHAR_WIDTH_RATIO = 0.6

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
	const lastBySeries = new Map<string, T>()
	for (const b of boxes) {
		const prev = lastBySeries.get(b.series)
		if (!prev || cmp(b, prev) > 0) lastBySeries.set(b.series, b)
	}
	const keep = new Set<T>(lastBySeries.values())
	return boxes.filter((b) => keep.has(b))
}

/** Greedy overlap nudge: walks the boxes in their input order and, for any
 *  box whose bbox overlaps an already-placed box, shifts its center down by
 *  the smallest amount that resolves the collision (with the box that
 *  triggered it). Mutates a copy and returns it; callers keep the input
 *  array untouched.
 *
 *  Not optimal — "shift everything later down" can compound when many
 *  labels collide — but cheap to compute and matches the user's request
 *  for "best-effort overlap avoidance" without bringing in a real
 *  force-directed layout. */
export const nudgeOverlaps = <T extends LabelBox>(boxes: T[]): T[] => {
	if (boxes.length <= 1) return boxes
	const placed: T[] = []
	const overlap = (a: T, b: T): boolean => {
		const aw = labelWidth(a) / 2
		const ah = labelHeight(a) / 2
		const bw = labelWidth(b) / 2
		const bh = labelHeight(b) / 2
		return Math.abs(a.cx - b.cx) < aw + bw && Math.abs(a.cy - b.cy) < ah + bh
	}
	for (const original of boxes) {
		// Spread shallowly so we can mutate `cy` without touching the input.
		let candidate: T = { ...original }
		// Bound the loop — pathological inputs (lots of overlaps) shouldn't
		// be able to spin forever.
		for (let safety = 0; safety < placed.length + 4; safety++) {
			const collider = placed.find((p) => overlap(candidate, p))
			if (!collider) break
			// Push downward just enough to clear the overlapping edge.
			const dy =
				labelHeight(collider) / 2 +
				labelHeight(candidate) / 2 -
				(candidate.cy - collider.cy)
			candidate = { ...candidate, cy: candidate.cy + dy }
		}
		placed.push(candidate)
	}
	return placed
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
