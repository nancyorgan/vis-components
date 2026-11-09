import type { AnnotationsConfig } from "../../../lib/annotationsConfig"
import type { AnnotationCoordSystem } from "../../../lib/annotationPixels"
import type { FacetLayoutSpec } from "../../../lib/facetLayoutSolver"
import {
	annotationClipsToPanel,
	annotationOnPanel,
	layoutPanelAnnotations,
	type AnnotationAxisFields,
	type PanelAnnotationScaleInputs,
} from "./annotationLayout"

/** Extra canvas room (px) reserved on each side of the plot grid so every
 *  annotation stays inside the canvas. Like the data-label edge reserve and
 *  the caption band, these add to the solver's outer reserves — the plot
 *  shrinks (fit mode) or the canvas grows (scroll mode / pixel overrides) —
 *  instead of letting an annotation placed beside the plot get cut off at
 *  the SVG edge. */
export type AnnotationReserve = {
	left: number
	right: number
	top: number
	bottom: number
}

export const NO_ANNOTATION_RESERVE: AnnotationReserve = {
	left: 0,
	right: 0,
	top: 0,
	bottom: 0,
}

/** Breathing room (px) past the measured annotation edge. Text widths come
 *  from canvas measureText (no trailing side bearing) and strokes
 *  antialias past their geometric half-width, so a flush reserve can still
 *  nibble a pixel. Same idea as the data-label reserve's pad. */
export const ANNOTATION_RESERVE_PAD_PX = 2

/** Residual spill (px) under which the iteration stops. */
const SPILL_TOLERANCE_PX = 0.5

/** Solves with annotation reserves. Hard cap on solver calls: the first
 *  (unreserved) solve, then at most this many re-solves. */
const MAX_RESERVE_ITERATIONS = 8

/** How far (px) the annotations spill past the canvas on each side, given a
 *  solved layout. Positive = cut off by that much; negative = slack between
 *  the outermost annotation edge and the canvas edge (0 when no annotation
 *  is on that side at all — slack only counts once a reserve exists, so an
 *  annotation well inside the plot never shrinks a reserve below zero).
 *  Annotations that clip to their panel (value mode on a multi-panel chart)
 *  can't spill and are ignored. */
export const measureAnnotationSpill = ({
	spec,
	annotations,
	scaleInputsByPanel,
	axisFields,
	levelOrders,
	isRadar,
}: {
	spec: FacetLayoutSpec
	annotations: AnnotationsConfig
	scaleInputsByPanel: ReadonlyMap<string, PanelAnnotationScaleInputs>
	axisFields: AnnotationAxisFields
	levelOrders: Record<string, readonly string[]>
	isRadar: boolean
}): AnnotationReserve => {
	const multiPanel = spec.panels.length > 1
	let minLeft = Infinity
	let minTop = Infinity
	let maxRight = -Infinity
	let maxBottom = -Infinity
	for (const p of spec.panels) {
		const scaleInputs = scaleInputsByPanel.get(p.key)
		if (!scaleInputs) continue
		const unclipped = <T extends { coordSystem: AnnotationCoordSystem }>(
			list: readonly T[] | undefined
		): T[] =>
			(list ?? []).filter(
				(a) =>
					annotationOnPanel(a as { facetKeys?: string[] | null }, p.key) &&
					!annotationClipsToPanel(a.coordSystem, multiPanel)
			)
		const placed = layoutPanelAnnotations({
			rectangles: unclipped(annotations.rectangles),
			circles: unclipped(annotations.circles),
			lineSegments: unclipped(annotations.lineSegments),
			texts: unclipped(annotations.texts),
			images: unclipped(annotations.images),
			inner: p.inner,
			axisFields,
			levelOrders,
			isRadar,
			...scaleInputs,
		})
		for (const a of placed) {
			if (a.bbox.left < minLeft) minLeft = a.bbox.left
			if (a.bbox.top < minTop) minTop = a.bbox.top
			if (a.bbox.right > maxRight) maxRight = a.bbox.right
			if (a.bbox.bottom > maxBottom) maxBottom = a.bbox.bottom
		}
	}
	if (minLeft === Infinity) return NO_ANNOTATION_RESERVE
	const pad = ANNOTATION_RESERVE_PAD_PX
	return {
		left: pad - minLeft,
		top: pad - minTop,
		right: maxRight + pad - spec.canvas.width,
		bottom: maxBottom + pad - spec.canvas.height,
	}
}

const SIDES = ["left", "right", "top", "bottom"] as const
type Side = (typeof SIDES)[number]

/** A side is settled when its spill is within tolerance — or when it has
 *  no reserve and nothing spills there (slack on an untouched side is just
 *  "no annotation near this edge"). */
const sideSettled = (reserve: number, spill: number): boolean =>
	Math.abs(spill) <= SPILL_TOLERANCE_PX ||
	(reserve === 0 && spill <= SPILL_TOLERANCE_PX)

const settled = (reserve: AnnotationReserve, spill: AnnotationReserve) =>
	SIDES.every((side) => sideSettled(reserve[side], spill[side]))

/** One side's root bracket for the regula-falsi step: `lo` still spills
 *  (positive), `hi` has slack (negative). */
type Sample = { r: number; e: number }
type SideBracket = { lo: Sample | null; hi: Sample | null; last: "lo" | "hi" | null }

/** Solve the layout with just enough reserve on each side that every
 *  annotation fits inside the canvas.
 *
 *  The reserve can't be computed up front: a percent-mode annotation at
 *  x = 130% sits 30% of the PLOT width past its edge, and the plot width is
 *  what the reserve shrinks. So this iterates — solve, measure the spill,
 *  adjust the reserve, solve again — treating each side's spill as a
 *  function of that side's reserve and root-finding it. The first step is
 *  the plain correction (reserve += spill); that overshoots (the plot
 *  shrank, so the annotation moved in by MORE than the spill), which
 *  brackets the root, and from then on each step is the secant between the
 *  bracketing samples (regula falsi, Illinois-damped so a stale end can't
 *  stall it). Spill is piecewise-affine in the reserve — a clamp or a
 *  collapsed plot adds a kink — so the bracket keeps every step inside the
 *  known-good interval where a bare secant would wander off.
 *
 *  Charts without annotations cost exactly one solve: the first spill
 *  measurement is all-zero and the loop never runs. When a reserve can't
 *  fit (the solver clamps left + right to the container in fit mode) the
 *  loop stops at the cap and the annotation clips at the viewport, exactly
 *  like an over-wide data label. */
export const solveWithAnnotationReserves = (
	solve: (reserve: AnnotationReserve) => FacetLayoutSpec,
	measureSpill: (spec: FacetLayoutSpec) => AnnotationReserve
): FacetLayoutSpec => {
	let reserve: AnnotationReserve = NO_ANNOTATION_RESERVE
	let spec = solve(reserve)
	let spill = measureSpill(spec)
	if (settled(reserve, spill)) return spec
	const brackets: Record<Side, SideBracket> = {
		left: { lo: null, hi: null, last: null },
		right: { lo: null, hi: null, last: null },
		top: { lo: null, hi: null, last: null },
		bottom: { lo: null, hi: null, last: null },
	}
	for (let i = 0; i < MAX_RESERVE_ITERATIONS; i++) {
		const next = { ...reserve }
		for (const side of SIDES) {
			const r = reserve[side]
			const e = spill[side]
			if (sideSettled(r, e)) continue
			const b = brackets[side]
			// Fold the latest sample into the bracket. Illinois: when the same
			// end is replaced twice running, halve the other end's spill so the
			// secant stops hugging it.
			if (e > 0) {
				if (b.last === "lo" && b.hi) b.hi = { r: b.hi.r, e: b.hi.e / 2 }
				b.lo = { r, e }
				b.last = "lo"
			} else {
				if (b.last === "hi" && b.lo) b.lo = { r: b.lo.r, e: b.lo.e / 2 }
				b.hi = { r, e }
				b.last = "hi"
			}
			let target: number
			if (b.lo && b.hi && b.hi.e !== b.lo.e) {
				target = b.lo.r - (b.lo.e * (b.hi.r - b.lo.r)) / (b.hi.e - b.lo.e)
			} else {
				// No bracket yet: the plain correction (grow by the spill, or
				// give back the slack).
				target = r + e
			}
			next[side] = Math.max(0, target)
		}
		if (SIDES.every((side) => Math.abs(next[side] - reserve[side]) < 0.25))
			break
		reserve = next
		spec = solve(reserve)
		spill = measureSpill(spec)
		if (settled(reserve, spill)) break
	}
	return spec
}
