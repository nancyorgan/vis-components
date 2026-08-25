import type { TextAnnotation } from "./annotationsConfig"
import { applyPositionScale, type PositionScale } from "./scales"
import type { FieldType } from "./types"

/** Pixel placement of a text annotation, in the SVG coordinate system of the
 *  panel's inner rect. `null` (from `computeTextAnnotationAnchor`) means the
 *  anchor can't be placed — e.g. a value-mode anchor a scale rejects. */
export type TextAnnotationGeometry = {
	/** Background box, auto-sized to the text plus padding on all four sides. */
	left: number
	top: number
	width: number
	height: number
	/** Where the `<text>` element anchors horizontally, paired with `anchor`. */
	textX: number
	/** Baseline of the FIRST line; later lines drop by 1.2em (tspans). */
	firstBaseline: number
	anchor: "start" | "middle" | "end"
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
 *  matching the rectangle / circle / line renderers' fallback. */
const toNumber = (v: number | string): number => {
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** Line-box height as a multiple of the font size — the same 1.2 factor
 *  `renderMultilineTspans` drops each subsequent line by, so a measured box
 *  matches the rendered stack. */
export const TEXT_ANNOTATION_LINE_HEIGHT = 1.2

/** Lay out a text annotation's auto-sized box around a resolved pixel anchor.
 *
 *  The box hugs the text: `textWidthPx` (the widest rendered line) and the
 *  line stack, each grown by `padding` on all four sides. The anchor rule —
 *  the thing that makes a text annotation a POINT rather than a rect:
 *
 *    - `y` always centers the box VERTICALLY.
 *    - `align` picks which horizontal edge lands on `x`: `left` starts the
 *      box at `x`, `center` straddles it, `right` ends the box there.
 *
 *  So the alignment control does double duty — it also aligns the lines of
 *  multi-line text — which keeps it meaningful for single-line labels, where
 *  line alignment alone would be invisible.
 *
 *  Kept separate from the measurement (canvas `measureText`, DOM-only) so the
 *  placement math is pure and testable. */
export const layoutTextAnnotationBox = ({
	anchorX,
	anchorY,
	textWidthPx,
	lines,
	fontSizePx,
	padding,
	align,
}: {
	anchorX: number
	anchorY: number
	/** Widest rendered line, in px. */
	textWidthPx: number
	/** Number of lines in the label (from literal `\n` breaks). */
	lines: number
	fontSizePx: number
	padding: number
	align: "left" | "center" | "right"
}): TextAnnotationGeometry => {
	const lineHeight = fontSizePx * TEXT_ANNOTATION_LINE_HEIGHT
	const width = textWidthPx + padding * 2
	const height = Math.max(1, lines) * lineHeight + padding * 2
	const left =
		align === "left"
			? anchorX
			: align === "right"
				? anchorX - width
				: anchorX - width / 2
	const top = anchorY - height / 2
	const anchor =
		align === "left" ? "start" : align === "right" ? "end" : "middle"
	const textX =
		align === "left"
			? left + padding
			: align === "right"
				? left + width - padding
				: left + width / 2
	// The first baseline sits one font size below the text block's top — the
	// same convention the rectangle's inner label uses.
	return {
		left,
		top,
		width,
		height,
		textX,
		firstBaseline: top + padding + fontSizePx,
		anchor,
	}
}

/** Resolve a text annotation's anchor point to panel pixels.
 *
 *  - `percent` mode: plot-area-normalized (x: 0=left→1=right; y: 0=BOTTOM→1=top,
 *    flipped to SVG top-down here).
 *  - `values` mode: each coord maps through the x/y position scales, exactly
 *    like rectangle corners and line endpoints. Each axis falls back to the
 *    percent placement independently when its scale/type is unavailable (e.g.
 *    a pie chart's missing axis).
 *
 *  Returns `null` when a value-mode coord can't be projected (e.g. a category
 *  that isn't in the axis domain). */
export const computeTextAnnotationAnchor = (
	anno: Pick<TextAnnotation, "x" | "y" | "coordSystem">,
	inner: Inner,
	ctx: ScaleCtx
): { x: number; y: number } | null => {
	const useValues = anno.coordSystem === "values"
	const x =
		useValues && ctx.xScale && ctx.xType
			? applyPositionScale(ctx.xScale, anno.x, ctx.xType)
			: inner.x + inner.width * toNumber(anno.x)
	// SVG is top-down; the percent convention has y=0 at the BOTTOM, so flip.
	// The value scales are already built with an inverted range.
	const y =
		useValues && ctx.yScale && ctx.yType
			? applyPositionScale(ctx.yScale, anno.y, ctx.yType)
			: inner.y + inner.height * (1 - toNumber(anno.y))
	if (x === null || y === null) return null
	return { x, y }
}
