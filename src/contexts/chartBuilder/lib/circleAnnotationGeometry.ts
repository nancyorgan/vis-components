import type { CircleAnnotation } from "./annotationsConfig"
import { applyPositionScale, type PositionScale } from "./scales"
import type { FieldType } from "./types"

/** Pixel placement of a circle annotation, in the SVG coordinate system of
 *  the panel's inner rect. `null` means the circle can't be placed (e.g. a
 *  data-unit radius requested against a categorical axis). */
export type CircleGeometry = {
	cx: number
	cy: number
	r: number
}

type Inner = { x: number; y: number; width: number; height: number }

type ScaleCtx = {
	xScale: PositionScale | null
	yScale: PositionScale | null
	xType: FieldType | null
	yType: FieldType | null
}

/** Coerce a stored center coord to a number for percent-mode math. Strings
 *  (categorical leftovers) coerce to 0 — meaningless in percent mode anyway,
 *  matching the rectangle renderer's fallback. */
const toNumber = (v: number | string): number => {
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** A data-unit radius is only meaningful on a continuous axis (quantitative
 *  or numeric ordinal), where adding the radius to the center value and
 *  re-projecting yields a pixel span. Temporal/categorical axes have no
 *  natural "radius in units", so we skip those circles. */
const isContinuous = (type: FieldType | null): type is FieldType =>
	type === "quantitative" || type === "ordinal"

/** Compute the pixel center + radius for a circle annotation against a
 *  panel's inner rect.
 *
 *  - `percent` mode: center is plot-area-normalized (x: 0=left→1=right;
 *    y: 0=BOTTOM→1=top, flipped to SVG top-down here). Radius is a fraction
 *    of the chosen axis's pixel extent (width for x, height for y), so the
 *    result is always a true on-screen circle.
 *  - `values` mode: center maps through the x/y position scales (exactly like
 *    rectangle corners). Radius is in data units along the chosen axis,
 *    converted via that axis's scale: |scale(center+radius) − scale(center)|.
 *    Each axis falls back to the percent placement independently when its
 *    scale/type is unavailable (e.g. a pie chart's missing axis), mirroring
 *    the rectangle renderer. */
export const computeCirclePixels = (
	circle: CircleAnnotation,
	inner: Inner,
	ctx: ScaleCtx
): CircleGeometry | null => {
	const useValues = circle.coordSystem === "values"

	// Center X.
	let cx: number
	if (useValues && ctx.xScale && ctx.xType) {
		const px = applyPositionScale(ctx.xScale, circle.centerX, ctx.xType)
		if (px === null) return null
		cx = px
	} else {
		cx = inner.x + inner.width * toNumber(circle.centerX)
	}

	// Center Y. SVG is top-down; the percent convention has y=0 at the BOTTOM,
	// so flip. The value scales are already built with an inverted range.
	let cy: number
	if (useValues && ctx.yScale && ctx.yType) {
		const py = applyPositionScale(ctx.yScale, circle.centerY, ctx.yType)
		if (py === null) return null
		cy = py
	} else {
		cy = inner.y + inner.height * (1 - toNumber(circle.centerY))
	}

	// Radius.
	let r: number
	if (useValues) {
		const scale = circle.radiusAxis === "x" ? ctx.xScale : ctx.yScale
		const type = circle.radiusAxis === "x" ? ctx.xType : ctx.yType
		const centerVal =
			circle.radiusAxis === "x" ? circle.centerX : circle.centerY
		if (
			!scale ||
			!isContinuous(type) ||
			typeof centerVal !== "number" ||
			!Number.isFinite(circle.radius)
		) {
			// Data-unit radius isn't expressible on this axis — skip the circle
			// rather than draw a degenerate one.
			return null
		}
		const a = applyPositionScale(scale, centerVal, type)
		const b = applyPositionScale(scale, centerVal + circle.radius, type)
		if (a === null || b === null) return null
		r = Math.abs(b - a)
	} else {
		const extent = circle.radiusAxis === "x" ? inner.width : inner.height
		r = extent * toNumber(circle.radius)
	}

	return { cx, cy, r: Math.max(0, r) }
}

/** Scales + frame for placing a VALUE-mode circle on a polar (radar) chart.
 *  `angleScale`/`rScale` are the chart's own radial scales (raw value →
 *  radians / pixel-radius), so an annotation lands exactly on the marks. */
type PolarCtx = {
	angleScale: (raw: unknown) => number | null
	rScale: (raw: unknown) => number | null
	center: { cx: number; cy: number }
	/** Type of the r-axis field — the data-unit radius is only expressible
	 *  on a continuous (quantitative / numeric-ordinal) r-axis. */
	rType: FieldType | null
}

/** Pixel placement of a VALUE-mode circle on a radar chart. The center is a
 *  polar coordinate: `centerX` is an ANGLE-axis value (a spoke/category or a
 *  numeric angle) and `centerY` is an R-axis value. The circle's `radius` is
 *  in R-axis data units, projected through `rScale` — and because the radial
 *  axis is isotropic in pixels (one pixels-per-r-unit in every direction),
 *  that yields a TRUE on-screen circle without a radius-axis choice.
 *
 *  Returns `null` when the circle can't be placed: either scale rejects the
 *  value, or the radius is requested against a non-continuous r-axis (the
 *  center still resolves there, but a data-unit radius has no meaning). */
export const computePolarCirclePixels = (
	circle: CircleAnnotation,
	ctx: PolarCtx
): CircleGeometry | null => {
	const angle = ctx.angleScale(circle.centerX)
	const rPx = ctx.rScale(circle.centerY)
	if (angle === null || rPx === null) return null
	// Angle convention matches the renderer: 0 = 12 o'clock, clockwise.
	const cx = ctx.center.cx + Math.sin(angle) * rPx
	const cy = ctx.center.cy - Math.cos(angle) * rPx
	if (
		!isContinuous(ctx.rType) ||
		typeof circle.centerY !== "number" ||
		!Number.isFinite(circle.radius)
	) {
		return null
	}
	const rOuterPx = ctx.rScale(circle.centerY + circle.radius)
	if (rOuterPx === null) return null
	return { cx, cy, r: Math.max(0, Math.abs(rOuterPx - rPx)) }
}
