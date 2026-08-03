/** Collision-aware placement for packed-circle ARC labels (the Data Labels
 * "Text Position" wrap-around option). A wrapped container label wants to
 * sit on an arc just outside its circle, but the pack layout tangent-packs
 * siblings — a fixed 12 o'clock placement would routinely overprint the
 * circle above. The planner searches candidate center-angles around the
 * circle (preferring the most EXPOSED side — away from the parent's
 * center), keeps the first window clear of every obstacle, and reports
 * `null` when no clear window exists (the label is dropped, mirroring the
 * fit-check convention).
 *
 * Angles are in radians, measured from 12 o'clock, CLOCKWISE (screen
 * coords). Labels centered in the LOWER half-circle flip their path
 * direction so the text still reads left-to-right upright; the baseline
 * radius shifts outward there so the glyphs (which then extend inward)
 * occupy the same annular band either way. */

/** A circle the label must not overprint. */
export type Disk = { x: number; y: number; r: number }
/** A previously placed arc label's occupied annular sector. */
export type ArcBand = {
	x: number
	y: number
	rIn: number
	rOut: number
	/** Center angle (rad from 12 o'clock, clockwise). */
	phi: number
	halfSpan: number
}
/** An axis-aligned box (rim labels drawn inside ancestor circles). */
export type Rect = { x0: number; y0: number; x1: number; y1: number }

export type ArcLabelObstacles = {
	disks: readonly Disk[]
	bands: readonly ArcBand[]
	rects: readonly Rect[]
}

export type ArcLabelPlan = {
	/** Chosen center angle. */
	phi: number
	/** SVG path `d` for the invisible baseline arc. */
	pathD: string
	/** True when the lower-half (reversed-direction) form was used. */
	flipped: boolean
	/** Occupied sector — feed back as an obstacle for later labels. */
	band: ArcBand
}

/** Baseline gap above the rim, in em — matches the pre-collision renderer. */
const BASE_GAP_EM = 0.35
/** Cap height in em: how far glyphs extend from the baseline. */
const CAP_EM = 0.72
/** Candidate-angle step (10°) and clearance margin around obstacles. */
const ANGLE_STEP = Math.PI / 18
const MARGIN_PX = 1.5

const TWO_PI = 2 * Math.PI
/** Normalize to (-π, π]. */
const normAngle = (a: number): number => {
	let r = a % TWO_PI
	if (r > Math.PI) r -= TWO_PI
	if (r <= -Math.PI) r += TWO_PI
	return r
}

/** Point at clock-angle `a` (0 = up, clockwise) on radius `rr`. */
const pointAt = (
	cx: number,
	cy: number,
	rr: number,
	a: number
): [number, number] => [cx + Math.sin(a) * rr, cy - Math.cos(a) * rr]

const hitsDisk = (px: number, py: number, d: Disk): boolean =>
	Math.hypot(px - d.x, py - d.y) < d.r + MARGIN_PX

const hitsBand = (px: number, py: number, b: ArcBand): boolean => {
	const dist = Math.hypot(px - b.x, py - b.y)
	if (dist < b.rIn - MARGIN_PX || dist > b.rOut + MARGIN_PX) return false
	const a = Math.atan2(px - b.x, -(py - b.y))
	const slack = dist > 0 ? MARGIN_PX / dist : Math.PI
	return Math.abs(normAngle(a - b.phi)) <= b.halfSpan + slack
}

const hitsRect = (px: number, py: number, r: Rect): boolean =>
	px >= r.x0 - MARGIN_PX &&
	px <= r.x1 + MARGIN_PX &&
	py >= r.y0 - MARGIN_PX &&
	py <= r.y1 + MARGIN_PX

/** Plan a collision-free arc placement for one container label, or `null`
 * when the text can never fit the arc or every candidate window collides. */
export const planArcLabel = (opts: {
	cx: number
	cy: number
	/** The labeled circle's radius. */
	r: number
	fontSize: number
	/** Estimated rendered text width in px. */
	textWidth: number
	/** Preferred center angle — the circle's most exposed side (direction
	 * away from its parent's center); 0 (top) when the circle sits at the
	 * parent's center. */
	preferredPhi: number
	obstacles: ArcLabelObstacles
}): ArcLabelPlan | null => {
	const { cx, cy, r, fontSize, textWidth, obstacles } = opts

	// The glyph band is the same annulus whichever half hosts the label.
	const bandIn = r + 2
	const bandOut = r + fontSize * (BASE_GAP_EM + CAP_EM) + 2
	// Span check against the upper-half baseline (the tighter of the two):
	// more than ~a half-circumference of text reads as a spiral, not a label.
	const upperBaseline = r + fontSize * BASE_GAP_EM
	if (textWidth > Math.PI * upperBaseline * 0.95) return null

	const collides = (phi: number, halfSpan: number): boolean => {
		const steps = Math.max(4, Math.ceil((2 * halfSpan) / 0.12))
		for (let i = 0; i <= steps; i++) {
			const a = phi - halfSpan + (2 * halfSpan * i) / steps
			for (const rr of [bandIn, (bandIn + bandOut) / 2, bandOut]) {
				const [px, py] = pointAt(cx, cy, rr, a)
				if (obstacles.disks.some((d) => hitsDisk(px, py, d))) return true
				if (obstacles.bands.some((b) => hitsBand(px, py, b))) return true
				if (obstacles.rects.some((rc) => hitsRect(px, py, rc))) return true
			}
		}
		return false
	}

	// Candidates fan out from the preferred angle in alternating 10° steps.
	for (let k = 0; k <= 18; k++) {
		for (const sign of k === 0 ? [1] : [1, -1]) {
			const phi = normAngle(opts.preferredPhi + sign * k * ANGLE_STEP)
			// Lower-half placements reverse the path (text stays upright), so
			// the baseline moves OUT by the cap height — glyphs extend inward.
			const flipped = Math.abs(phi) > Math.PI / 2
			const baselineR = flipped
				? r + fontSize * (BASE_GAP_EM + CAP_EM)
				: upperBaseline
			const halfSpan = textWidth / baselineR / 2 + 2 / baselineR
			if (collides(phi, halfSpan)) continue

			// Baseline arc with a little angular headroom so <textPath> never
			// truncates the last glyph on estimate error.
			const pad = halfSpan * 0.15 + 4 / baselineR
			const a0 = phi - halfSpan - pad
			const a1 = phi + halfSpan + pad
			const largeArc = a1 - a0 > Math.PI ? 1 : 0
			const [sx, sy] = pointAt(cx, cy, baselineR, flipped ? a1 : a0)
			const [ex, ey] = pointAt(cx, cy, baselineR, flipped ? a0 : a1)
			const sweep = flipped ? 0 : 1
			return {
				phi,
				flipped,
				pathD: `M ${sx} ${sy} A ${baselineR} ${baselineR} 0 ${largeArc} ${sweep} ${ex} ${ey}`,
				band: { x: cx, y: cy, rIn: bandIn, rOut: bandOut, phi, halfSpan },
			}
		}
	}
	return null
}
