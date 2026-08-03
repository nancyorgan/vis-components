import type { LineSegmentAnnotation } from "./annotationsConfig"
import { applyPositionScale, type PositionScale } from "./scales"
import type { FieldType } from "./types"

/** Pixel placement of a line-segment annotation, in the SVG coordinate system
 *  of the panel's inner rect. `null` means the segment can't be placed (e.g. a
 *  value-mode endpoint a scale rejects). */
export type LineSegmentGeometry = {
	x1: number
	y1: number
	x2: number
	y2: number
}

type Inner = { x: number; y: number; width: number; height: number }

type ScaleCtx = {
	xScale: PositionScale | null
	yScale: PositionScale | null
	xType: FieldType | null
	yType: FieldType | null
}

/** Coerce a stored coord to a number for percent-mode math. Strings
 *  (categorical leftovers) coerce to 0 — meaningless in percent mode anyway,
 *  matching the rectangle / circle renderers' fallback. */
const toNumber = (v: number | string): number => {
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** Compute the pixel endpoints for a line-segment annotation against a panel's
 *  inner rect. Endpoint A = (xMin, yMin), endpoint B = (xMax, yMax).
 *
 *  - `percent` mode: each coord is plot-area-normalized (x: 0=left→1=right;
 *    y: 0=BOTTOM→1=top, flipped to SVG top-down here).
 *  - `values` mode: each coord maps through the x/y position scales (exactly
 *    like rectangle corners). Each axis falls back to the percent placement
 *    independently when its scale/type is unavailable (e.g. a pie chart's
 *    missing axis), mirroring the rectangle renderer.
 *
 *  Unlike the rectangle, value-mode endpoints on a categorical (point) axis
 *  land on the category's CENTER — a line connects points, so there's no band
 *  to span. Returns `null` if any endpoint can't be projected. */
export const computeLineSegmentPixels = (
	line: LineSegmentAnnotation,
	inner: Inner,
	ctx: ScaleCtx
): LineSegmentGeometry | null => {
	const useValues = line.coordSystem === "values"

	const projectX = (v: number | string): number | null => {
		if (useValues && ctx.xScale && ctx.xType) {
			return applyPositionScale(ctx.xScale, v, ctx.xType)
		}
		return inner.x + inner.width * toNumber(v)
	}
	// SVG is top-down; the percent convention has y=0 at the BOTTOM, so flip.
	// The value scales are already built with an inverted range.
	const projectY = (v: number | string): number | null => {
		if (useValues && ctx.yScale && ctx.yType) {
			return applyPositionScale(ctx.yScale, v, ctx.yType)
		}
		return inner.y + inner.height * (1 - toNumber(v))
	}

	const x1 = projectX(line.xMin)
	const y1 = projectY(line.yMin)
	const x2 = projectX(line.xMax)
	const y2 = projectY(line.yMax)
	if (x1 === null || y1 === null || x2 === null || y2 === null) return null
	return { x1, y1, x2, y2 }
}
