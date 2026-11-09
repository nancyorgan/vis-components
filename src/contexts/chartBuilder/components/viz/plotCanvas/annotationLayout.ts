import {
	DEFAULT_RECTANGLE_TEXT,
	type CircleAnnotation,
	type ImageAnnotation,
	type LineCapStyle,
	type LineSegmentAnnotation,
	type RectangleAnnotation,
	type TextAnnotation,
} from "../../../lib/annotationsConfig"
import {
	computeArrowhead,
	resolveLineEnds,
	type ArrowheadGeometry,
} from "../../../lib/arrowheadGeometry"
import {
	isPixelSystem,
	percentToBaseX,
	percentToBaseY,
	pixelToCanvasX,
	pixelToCanvasY,
	type AnnotationCoordSystem,
} from "../../../lib/annotationPixels"
import { computeCirclePixels } from "../../../lib/circleAnnotationGeometry"
import {
	computeImageAnnotationAnchor,
	imageAnnotationSizePx,
	layoutImageAnnotationBox,
} from "../../../lib/imageAnnotationGeometry"
import { computeLineSegmentPixels } from "../../../lib/lineSegmentAnnotationGeometry"
import {
	computeTextAnnotationAnchor,
	layoutTextAnnotationBox,
	type TextAnnotationGeometry,
} from "../../../lib/textAnnotationGeometry"
import { estimateLongestLineWidth } from "../../../lib/estimateMargins"
import type { Rect } from "../../../lib/facetLayoutSolver"
import {
	FACET_PANEL_ALL,
	facetScopeIncludes,
	type FacetPanelRef,
} from "../../../lib/facetPanelRef"
import { ptToPx } from "../../../lib/fontUnit"
import { lineCount } from "../../../lib/multilineText"
import {
	applyPositionScale,
	makePositionScale,
	type PositionScale,
} from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import { measureMaxLabelWidth } from "./measureText"

/** Pure per-panel annotation geometry, shared by the renderer
 *  (`AnnotationRects`) and the layout reserve estimator
 *  (`annotationReserve.ts`). Both must agree on where every annotation
 *  lands — the reserve keeps exactly the pixels the renderer paints inside
 *  the canvas — so the placement math lives here once. */

export type AnnotationAxisFields = {
	xField: string | null
	yField: string | null
	xType: FieldType | null
	yType: FieldType | null
}

/** Axis-aligned bounding box in canvas px, INCLUDING the stroke's outer
 *  half (a border paints centered on the geometric edge). */
export type BBox = {
	left: number
	top: number
	right: number
	bottom: number
}

export type PlacedRectangle = {
	kind: "rectangle"
	anno: RectangleAnnotation
	left: number
	top: number
	width: number
	height: number
	bbox: BBox
}
export type PlacedCircle = {
	kind: "circle"
	anno: CircleAnnotation
	cx: number
	cy: number
	r: number
	bbox: BBox
}
export type PlacedLine = {
	kind: "line"
	anno: LineSegmentAnnotation
	/** The configured endpoints in canvas px (B = x2, y2 is the arrow end). */
	x1: number
	y1: number
	x2: number
	y2: number
	/** Where the stroke actually stops: (x2, y2) with no arrowhead, else the
	 *  head's base so the line doesn't paint through the head. */
	end: { x: number; y: number }
	cap: LineCapStyle
	arrowhead: ArrowheadGeometry | null
	bbox: BBox
}
export type PlacedText = {
	kind: "text"
	anno: TextAnnotation
	box: TextAnnotationGeometry
	fontSizePx: number
	bbox: BBox
}
export type PlacedImage = {
	kind: "image"
	anno: ImageAnnotation
	left: number
	top: number
	width: number
	height: number
	bbox: BBox
}
export type PlacedAnnotation =
	| PlacedRectangle
	| PlacedCircle
	| PlacedLine
	| PlacedText
	| PlacedImage

/** Whether an annotation is drawn on the panel with the given key.
 *  `facetKeys` null/undefined ⇒ all facets (legacy default); an array
 *  restricts to the listed panels (`FacetPanelRef`, matched by key). The
 *  `FACET_PANEL_ALL` panel is the non-faceted chart's single panel — always
 *  show there so scoping set on a previously faceted chart doesn't make
 *  annotations vanish after faceting is removed. */
export const annotationOnPanel = (
	a: { facetKeys?: FacetPanelRef[] | null },
	panelKey: string,
): boolean =>
	a.facetKeys == null ||
	panelKey === FACET_PANEL_ALL ||
	facetScopeIncludes(a.facetKeys, panelKey)

/** Coerce a stored xMin/yMin/etc. to a number. Stored values are
 *  `number | string` to accommodate categorical "values" mode; for the
 *  percent fallback we need a numeric coordinate. */
const toNumber = (v: number | string): number => {
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** Apply a numeric domain pin to an already-built position scale. Mirrors
 *  ScatterPlot's helper of the same name so value-mode annotations honor
 *  the same axis-range overrides the renderer does. No-op for categorical /
 *  temporal scales (only quantitative + numeric-ordinal carry a numeric
 *  domain that an override can pin). */
const overrideLinearDomain = (
	scale: PositionScale,
	type: FieldType,
	min: number | undefined,
	max: number | undefined
): PositionScale => {
	if (min === undefined && max === undefined) return scale
	if (type !== "quantitative" && type !== "ordinal") return scale
	const linear = scale as { domain: (d?: [number, number]) => unknown }
	const [loCur, hiCur] = (linear.domain as () => [number, number])()
	linear.domain([min ?? loCur, max ?? hiCur])
	return scale
}

/** Whether an annotation is clipped to its panel's plot area. Only VALUE-mode
 *  annotations on a MULTI-panel chart clip: each facet renders a data-unit
 *  annotation in its own coordinates, and one whose data range falls outside
 *  a panel's (independent-axis) domain draws nothing there rather than
 *  spilling into a neighbor. Everything else may go anywhere on the canvas —
 *  percent coordinates past 0–100, pixel coordinates outside the plot, or a
 *  single panel's out-of-domain value
 *  deliberately place the annotation beside / above the plot, and the layout
 *  grows the canvas margins so it stays in view. */
export const annotationClipsToPanel = (
	coordSystem: AnnotationCoordSystem,
	multiPanel: boolean
): boolean => multiPanel && coordSystem === "values"

export type PanelAnnotationScaleInputs = {
	xScaleRows: readonly Record<string, unknown>[]
	yScaleRows: readonly Record<string, unknown>[]
	xDomainOverride?: { min?: number; max?: number }
	yDomainOverride?: { min?: number; max?: number }
	/** Polar "Size panels by unit" factor (0..1); undefined / 1 = none. */
	radiusScale?: number
}

export type LayoutPanelAnnotationsInput = PanelAnnotationScaleInputs & {
	rectangles: readonly RectangleAnnotation[]
	circles: readonly CircleAnnotation[]
	lineSegments: readonly LineSegmentAnnotation[]
	texts: readonly TextAnnotation[]
	/** Optional for callers holding a config saved before images shipped. */
	images?: readonly ImageAnnotation[]
	inner: Rect
	axisFields: AnnotationAxisFields
	levelOrders: Record<string, readonly string[]>
	/** Radar panels render VALUE-mode circles / lines / texts themselves
	 *  (RadarPlot owns the radial scales), so they're skipped here. */
	isRadar: boolean
}

const strokeBBox = (
	left: number,
	top: number,
	right: number,
	bottom: number,
	strokeWidth: number
): BBox => {
	const half = Math.max(0, strokeWidth) / 2
	return {
		left: left - half,
		top: top - half,
		right: right + half,
		bottom: bottom + half,
	}
}

/** Scale a bbox about a point (the polar "Size panels by unit" transform
 *  the renderer applies to percent-mode annotations). */
const scaleBBoxAbout = (b: BBox, cx: number, cy: number, s: number): BBox => ({
	left: cx + (b.left - cx) * s,
	top: cy + (b.top - cy) * s,
	right: cx + (b.right - cx) * s,
	bottom: cy + (b.bottom - cy) * s,
})

/** Build the value-mode position scales for a panel, matching the panel
 *  renderer's axis scale — same share-aware row source, same per-axis domain
 *  override, same level order — so a data-unit annotation tracks the marks.
 *  Returns nulls when no value-mode annotation needs them. */
export const buildAnnotationScales = ({
	inner,
	axisFields,
	levelOrders,
	xScaleRows,
	yScaleRows,
	xDomainOverride,
	yDomainOverride,
	needValues,
}: PanelAnnotationScaleInputs & {
	inner: Rect
	axisFields: AnnotationAxisFields
	levelOrders: Record<string, readonly string[]>
	needValues: boolean
}): { xScale: PositionScale | null; yScale: PositionScale | null } => {
	// Match the per-axis range to the panel's inner rect; y is inverted from
	// SVG's top-down to data-axis bottom-up so the user's "yMin" data value
	// renders at the BOTTOM of the rectangle.
	const xRange: [number, number] = [inner.x, inner.x + inner.width]
	const yRange: [number, number] = [inner.y + inner.height, inner.y]
	let xScale: PositionScale | null = null
	let yScale: PositionScale | null = null
	if (needValues && axisFields.xField && axisFields.xType) {
		const raws = xScaleRows.map((r) => r[axisFields.xField as string])
		xScale = overrideLinearDomain(
			makePositionScale(
				raws,
				axisFields.xType,
				xRange,
				levelOrders[axisFields.xField]
			),
			axisFields.xType,
			xDomainOverride?.min,
			xDomainOverride?.max
		)
	}
	if (needValues && axisFields.yField && axisFields.yType) {
		const raws = yScaleRows.map((r) => r[axisFields.yField as string])
		yScale = overrideLinearDomain(
			makePositionScale(
				raws,
				axisFields.yType,
				yRange,
				levelOrders[axisFields.yField]
			),
			axisFields.yType,
			yDomainOverride?.min,
			yDomainOverride?.max
		)
	}
	return { xScale, yScale }
}

/** Width of a text annotation's widest line at its actual font: canvas
 *  `measureText` when available, the shared character-count estimate in a
 *  headless render (so the box never collapses to zero width). */
export const textAnnotationWidthPx = (
	anno: TextAnnotation,
	fontSizePx: number
): number => {
	const measured = measureMaxLabelWidth(
		[anno.text],
		anno.textFontFamily,
		fontSizePx,
		anno.textFontWeight,
		anno.textItalic
	)
	return measured > 0 ? measured : estimateLongestLineWidth(anno.text, fontSizePx)
}

/** Place every annotation of a panel in canvas px. Annotations that can't
 *  be projected (a value-mode coordinate the scale rejects, a blank text
 *  label, an image with no picture yet, a radar value-mode shape) are
 *  omitted. Order is rectangles, circles, lines, texts, images — the
 *  renderer's paint order. */
export const layoutPanelAnnotations = ({
	rectangles,
	circles,
	lineSegments,
	texts,
	images = [],
	inner,
	axisFields,
	levelOrders,
	isRadar,
	xScaleRows,
	yScaleRows,
	xDomainOverride,
	yDomainOverride,
	radiusScale,
}: LayoutPanelAnnotationsInput): PlacedAnnotation[] => {
	const visibleCircles = circles.filter(
		(c) => !(isRadar && c.coordSystem === "values")
	)
	// Value-mode lines / texts on radar would need polar projection
	// (RadarPlot owns those scales); skip them here to avoid a wrong
	// percent-fallback render, matching the circle handling.
	const visibleLines = lineSegments.filter(
		(l) => !(isRadar && l.coordSystem === "values")
	)
	// Blank labels draw nothing at all — not even their box, since the box is
	// sized to the text.
	const visibleTexts = texts.filter(
		(t) => t.text.trim().length > 0 && !(isRadar && t.coordSystem === "values")
	)
	// An image annotation with no picture chosen yet draws nothing.
	const visibleImages = images.filter(
		(m) => m.href.length > 0 && !(isRadar && m.coordSystem === "values")
	)
	if (
		rectangles.length === 0 &&
		visibleCircles.length === 0 &&
		visibleLines.length === 0 &&
		visibleTexts.length === 0 &&
		visibleImages.length === 0
	)
		return []
	const needValues =
		rectangles.some((r) => r.coordSystem === "values") ||
		visibleCircles.some((c) => c.coordSystem === "values") ||
		visibleLines.some((l) => l.coordSystem === "values") ||
		visibleTexts.some((t) => t.coordSystem === "values") ||
		visibleImages.some((m) => m.coordSystem === "values")
	const { xScale, yScale } = buildAnnotationScales({
		inner,
		axisFields,
		levelOrders,
		xScaleRows,
		yScaleRows,
		xDomainOverride,
		yDomainOverride,
		needValues,
	})
	const ctx = {
		xScale,
		yScale,
		xType: axisFields.xType,
		yType: axisFields.yType,
	}
	// "Size panels by unit" (polar): the renderer shrinks the whole
	// annotation group about the panel center by this factor; mirror it on
	// the bounding boxes so the reserve matches what paints.
	const s = radiusScale ?? 1
	const scaleActive = Number.isFinite(s) && s > 0 && s !== 1
	const centerX = inner.x + inner.width / 2
	const centerY = inner.y + inner.height / 2
	const finish = (b: BBox): BBox =>
		scaleActive ? scaleBBoxAbout(b, centerX, centerY, s) : b

	const placed: PlacedAnnotation[] = []
	for (const r of rectangles) {
		const useValues = r.coordSystem === "values"
		const pixelSystem = isPixelSystem(r.coordSystem) ? r.coordSystem : null
		let left: number, width: number
		let top: number, height: number
		if (pixelSystem) {
			// Whole px from the corner's edge (left or right), +x right; min/max
			// name the exact edges, as in the other systems.
			const a = pixelToCanvasX(inner, toNumber(r.xMin), pixelSystem)
			const b = pixelToCanvasX(inner, toNumber(r.xMax), pixelSystem)
			left = Math.min(a, b)
			width = Math.max(a, b) - left
		} else if (useValues && xScale && axisFields.xType) {
			const a = applyPositionScale(xScale, r.xMin, axisFields.xType)
			const b = applyPositionScale(xScale, r.xMax, axisFields.xType)
			if (a === null || b === null) continue
			// Categorical (point-scale) coordinates land on the category's
			// CENTER, same as line-segment endpoints — min/max name the exact
			// positions the rectangle spans.
			left = Math.min(a, b)
			width = Math.max(a, b) - left
		} else {
			// Percent fallback (also used when value-mode is selected but the
			// axis field/type isn't available — e.g. pie chart's missing axis).
			const xa = percentToBaseX(toNumber(r.xMin), r.coordSystem)
			const xb = percentToBaseX(toNumber(r.xMax), r.coordSystem)
			const x0 = Math.min(xa, xb)
			const x1 = Math.max(xa, xb)
			left = inner.x + inner.width * x0
			width = inner.width * (x1 - x0)
		}
		if (pixelSystem) {
			// +y is up from the corner's edge (top or bottom); the helper flips
			// to SVG top-down.
			const a = pixelToCanvasY(inner, toNumber(r.yMin), pixelSystem)
			const b = pixelToCanvasY(inner, toNumber(r.yMax), pixelSystem)
			top = Math.min(a, b)
			height = Math.max(a, b) - top
		} else if (useValues && yScale && axisFields.yType) {
			const a = applyPositionScale(yScale, r.yMin, axisFields.yType)
			const b = applyPositionScale(yScale, r.yMax, axisFields.yType)
			if (a === null || b === null) continue
			top = Math.min(a, b)
			height = Math.max(a, b) - top
		} else {
			// Percent fallback. SVG y is top-down; data convention has y=0 at
			// the BOTTOM of the plot — flip so yMax→top.
			const ya = percentToBaseY(toNumber(r.yMin), r.coordSystem)
			const yb = percentToBaseY(toNumber(r.yMax), r.coordSystem)
			const y0 = Math.min(ya, yb)
			const y1 = Math.max(ya, yb)
			top = inner.y + inner.height * (1 - y1)
			height = inner.height * (y1 - y0)
		}
		placed.push({
			kind: "rectangle",
			anno: r,
			left,
			top,
			width,
			height,
			bbox: finish(
				strokeBBox(left, top, left + width, top + height, r.borderThickness)
			),
		})
	}
	for (const c of visibleCircles) {
		const geom = computeCirclePixels(c, inner, ctx)
		if (geom === null) continue
		placed.push({
			kind: "circle",
			anno: c,
			...geom,
			bbox: finish(
				strokeBBox(
					geom.cx - geom.r,
					geom.cy - geom.r,
					geom.cx + geom.r,
					geom.cy + geom.r,
					c.borderThickness
				)
			),
		})
	}
	for (const l of visibleLines) {
		const geom = computeLineSegmentPixels(l, inner, ctx)
		if (geom === null) continue
		const ends = resolveLineEnds(l)
		const arrowhead = ends.arrowhead
			? computeArrowhead({
					...geom,
					thickness: l.lineThickness,
					style: ends.arrowheadStyle,
					scale: ends.arrowheadScale,
					lineCap: ends.lineCap,
				})
			: null
		const end = arrowhead?.lineEnd ?? { x: geom.x2, y: geom.y2 }
		// The stroke's box (half-width on every side covers a round cap's
		// overhang too), widened to the head's box when there is one.
		const stroke = strokeBBox(
			Math.min(geom.x1, end.x),
			Math.min(geom.y1, end.y),
			Math.max(geom.x1, end.x),
			Math.max(geom.y1, end.y),
			l.lineThickness
		)
		const bbox: BBox = arrowhead
			? {
					left: Math.min(stroke.left, arrowhead.bbox.left),
					top: Math.min(stroke.top, arrowhead.bbox.top),
					right: Math.max(stroke.right, arrowhead.bbox.right),
					bottom: Math.max(stroke.bottom, arrowhead.bbox.bottom),
				}
			: stroke
		placed.push({
			kind: "line",
			anno: l,
			...geom,
			end,
			cap: ends.lineCap,
			arrowhead,
			bbox: finish(bbox),
		})
	}
	for (const t of visibleTexts) {
		const point = computeTextAnnotationAnchor(t, inner, ctx)
		if (point === null) continue
		const fontSizePx = ptToPx(t.textFontSize)
		const box = layoutTextAnnotationBox({
			anchorX: point.x,
			anchorY: point.y,
			textWidthPx: textAnnotationWidthPx(t, fontSizePx),
			lines: lineCount(t.text),
			fontSizePx,
			padding: t.textPadding,
			align: t.textAlign,
		})
		placed.push({
			kind: "text",
			anno: t,
			box,
			fontSizePx,
			bbox: finish(
				strokeBBox(
					box.left,
					box.top,
					box.left + box.width,
					box.top + box.height,
					t.borderThickness
				)
			),
		})
	}
	for (const m of visibleImages) {
		const point = computeImageAnnotationAnchor(m, inner, ctx)
		if (point === null) continue
		const size = imageAnnotationSizePx(m)
		const box = layoutImageAnnotationBox({
			anchorX: point.x,
			anchorY: point.y,
			widthPx: size.width,
			heightPx: size.height,
			anchorH: m.anchorH,
			anchorV: m.anchorV,
		})
		placed.push({
			kind: "image",
			anno: m,
			...box,
			// No stroke: the picture's own edge is its outermost ink.
			bbox: finish(
				strokeBBox(box.left, box.top, box.left + box.width, box.top + box.height, 0)
			),
		})
	}
	return placed
}

/** Resolve a rectangle's inner-label styling with the pre-text defaults, so
 *  rectangles saved before text shipped still draw sensibly. */
export const rectangleTextStyle = (rect: RectangleAnnotation) => ({
	text: rect.text ?? DEFAULT_RECTANGLE_TEXT.text,
	fontSizePx: ptToPx(rect.textFontSize ?? DEFAULT_RECTANGLE_TEXT.textFontSize),
	align: rect.textAlign ?? DEFAULT_RECTANGLE_TEXT.textAlign,
	padding: rect.textPadding ?? DEFAULT_RECTANGLE_TEXT.textPadding,
	fontFamily: rect.textFontFamily ?? DEFAULT_RECTANGLE_TEXT.textFontFamily,
	fontWeight: rect.textFontWeight ?? DEFAULT_RECTANGLE_TEXT.textFontWeight,
	color: rect.textColor ?? DEFAULT_RECTANGLE_TEXT.textColor,
	italic: rect.textItalic ?? false,
	underline: rect.textUnderline ?? false,
})
