import type {
	ImageAnchorH,
	ImageAnchorV,
	ImageAnnotation,
	ImageSizeUnit,
} from "./annotationsConfig"
import { PX_PER_UNIT } from "./displayUnits"
import { computeTextAnnotationAnchor } from "./textAnnotationGeometry"

/** Pixel placement of an image annotation in the SVG coordinate system of
 *  the panel's inner rect. */
export type ImageAnnotationGeometry = {
	left: number
	top: number
	width: number
	height: number
}

type Inner = { x: number; y: number; width: number; height: number }

/** The size fields the px resolution reads. `naturalWidth` is what a percent
 *  size is a percent of; `aspect` (natural width / height) derives the
 *  height while the ratio is locked. */
export type ImageSizeFields = Pick<
	ImageAnnotation,
	"width" | "height" | "sizeUnit" | "lockAspect" | "aspect" | "naturalWidth"
>

const safeAspect = (aspect: number): number =>
	Number.isFinite(aspect) && aspect > 0 ? aspect : 1

const nonNegative = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0)

/** Convert one stored size value to px. Physical units go through the
 *  96 px/in convention; percent is of the picture's natural size along that
 *  axis (`naturalPx`). */
export const imageSizeValueToPx = (
	value: number,
	unit: ImageSizeUnit,
	naturalPx: number
): number =>
	nonNegative(unit === "percent" ? (value / 100) * naturalPx : value * PX_PER_UNIT[unit])

/** The inverse of `imageSizeValueToPx` — px to a value in `unit`. A percent
 *  of a zero natural size reads as 0 (nothing to be a percent of). */
export const imagePxToSizeValue = (
	px: number,
	unit: ImageSizeUnit,
	naturalPx: number
): number => {
	if (unit === "percent") return naturalPx > 0 ? (px / naturalPx) * 100 : 0
	return px / PX_PER_UNIT[unit]
}

/** Natural width / height of the picture in px. A missing natural width
 *  (an image annotation saved before the field existed; the editor
 *  backfills it from the picture on its next open) falls back to the
 *  stored width CONVERTED to px — read in its own unit, never as a bare
 *  number, or a width stored in cm would make a "percent" thousands — so a
 *  percent size has something sensible to be a percent of. A percent
 *  width with no natural size has nothing to convert through and reads as
 *  px. */
export const imageNaturalPx = (
	anno: Pick<ImageSizeFields, "aspect" | "naturalWidth" | "width" | "sizeUnit">
): { width: number; height: number } => {
	const aspect = safeAspect(anno.aspect)
	const unit: ImageSizeUnit = anno.sizeUnit ?? "px"
	const fallback =
		unit === "percent" ? nonNegative(anno.width) : nonNegative(anno.width * PX_PER_UNIT[unit])
	const w = nonNegative(anno.naturalWidth) || fallback
	return { width: w, height: w / aspect }
}

/** Resolve an image annotation's rendered size in px. With the aspect ratio
 *  locked the height is derived from the width (the stored height is only
 *  the editor's mirror of it); unlocked, both stored values are honored and
 *  the picture stretches. Tolerates the fields an annotation saved before
 *  height / unit / lock existed lacks (reads px, locked). */
export const imageAnnotationSizePx = (
	anno: ImageSizeFields
): { width: number; height: number } => {
	const unit: ImageSizeUnit = anno.sizeUnit ?? "px"
	const locked = anno.lockAspect ?? true
	const natural = imageNaturalPx(anno)
	const width = imageSizeValueToPx(anno.width, unit, natural.width)
	const height = locked
		? width / safeAspect(anno.aspect)
		: imageSizeValueToPx(anno.height ?? anno.width, unit, natural.height)
	return { width, height }
}

/** Lay an image's box out around a resolved anchor point. `anchorH` /
 *  `anchorV` pick which point of the box sits on the anchor — the center by
 *  default, a corner to tuck a logo against the edge of the plot. Pure, so
 *  the renderer and the layout reserve agree. */
export const layoutImageAnnotationBox = ({
	anchorX,
	anchorY,
	widthPx,
	heightPx,
	anchorH,
	anchorV,
}: {
	anchorX: number
	anchorY: number
	widthPx: number
	heightPx: number
	anchorH: ImageAnchorH
	anchorV: ImageAnchorV
}): ImageAnnotationGeometry => {
	const width = nonNegative(widthPx)
	const height = nonNegative(heightPx)
	const left =
		anchorH === "left" ? anchorX : anchorH === "right" ? anchorX - width : anchorX - width / 2
	const top =
		anchorV === "top" ? anchorY : anchorV === "bottom" ? anchorY - height : anchorY - height / 2
	return { left, top, width, height }
}

/** Resolve an image annotation's anchor point to panel pixels — the same
 *  percent / values / pixel-corner rules as a text annotation's anchor (one
 *  point, not a region). `null` when a value-mode coordinate can't be
 *  projected. */
export const computeImageAnnotationAnchor = computeTextAnnotationAnchor as (
	anno: Pick<ImageAnnotation, "x" | "y" | "coordSystem">,
	inner: Inner,
	ctx: Parameters<typeof computeTextAnnotationAnchor>[2]
) => { x: number; y: number } | null
