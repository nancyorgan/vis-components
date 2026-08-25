import { useId } from "react"
import {
	DEFAULT_RECTANGLE_TEXT,
	type CircleAnnotation,
	type LineSegmentAnnotation,
	type RectangleAnnotation,
	type TextAnnotation,
} from "../../../lib/annotationsConfig"
import type { LineDashPattern } from "../../../lib/channelConfig"
import { computeCirclePixels } from "../../../lib/circleAnnotationGeometry"
import { computeLineSegmentPixels } from "../../../lib/lineSegmentAnnotationGeometry"
import {
	computeTextAnnotationAnchor,
	layoutTextAnnotationBox,
} from "../../../lib/textAnnotationGeometry"
import { dashArrayFor, sanitizeCustomDasharray } from "../../../lib/dashPatterns"
import type { Rect } from "../../../lib/facetLayoutSolver"
import { ptToPx } from "../../../lib/fontUnit"
import { estimateLongestLineWidth } from "../../../lib/estimateMargins"
import { lineCount, renderMultilineTspans } from "../../../lib/multilineText"
import {
	applyPositionScale,
	makePositionScale,
	type PositionScale,
} from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import { measureMaxLabelWidth } from "./measureText"

/** Whether an annotation is drawn on the panel with the given key.
 *  `facetKeys` null/undefined ⇒ all facets (legacy default); an array
 *  restricts to listed keys. The `"__all__"` panel is the non-faceted
 *  chart's single panel — always show there so scoping set on a previously
 *  faceted chart doesn't make annotations vanish after faceting is removed. */
export const annotationOnPanel = (
	a: { facetKeys?: string[] | null },
	panelKey: string,
): boolean =>
	a.facetKeys == null ||
	panelKey === "__all__" ||
	a.facetKeys.includes(panelKey)

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

/** Resolve an annotation stroke's SVG dasharray: a (sanitized) custom
 *  dasharray wins over the built-in pattern — the same precedence the dash
 *  picker's Custom button implies. `undefined` = solid (no attribute). */
const annotationDasharray = (
	custom: string | null | undefined,
	pattern: LineDashPattern
): string | undefined =>
	(custom ? sanitizeCustomDasharray(custom) : null) ??
	dashArrayFor(pattern) ??
	undefined

/** Draws a rectangle annotation's optional text label inside the box. The
 *  text block is centered VERTICALLY within the rect; horizontally it follows
 *  `textAlign`, inset from the box edge by `textPadding`. Renders nothing when
 *  the rectangle carries no (non-whitespace) text. Styling fields fall back to
 *  `DEFAULT_RECTANGLE_TEXT` so rectangles saved before text shipped still draw
 *  sensibly. Multi-line text (literal `\n`) stacks via shared `<tspan>`s. */
const AnnotationText = ({
	rect,
	left,
	top,
	width,
	height,
}: {
	rect: RectangleAnnotation
	left: number
	top: number
	width: number
	height: number
}) => {
	const text = rect.text ?? DEFAULT_RECTANGLE_TEXT.text
	if (text.trim().length === 0) return null
	const fontSize = ptToPx(rect.textFontSize ?? DEFAULT_RECTANGLE_TEXT.textFontSize)
	const align = rect.textAlign ?? DEFAULT_RECTANGLE_TEXT.textAlign
	const padding = rect.textPadding ?? DEFAULT_RECTANGLE_TEXT.textPadding
	const anchor =
		align === "left" ? "start" : align === "right" ? "end" : "middle"
	const x =
		align === "left"
			? left + padding
			: align === "right"
				? left + width - padding
				: left + width / 2
	// Center the multi-line block vertically: a line box is `fontSize * 1.2`
	// tall, so the block spans `lines * lineHeight`. The first baseline sits one
	// `fontSize` below the block's top (matching the caption convention).
	const lineHeight = fontSize * 1.2
	const blockTop = top + (height - lineCount(text) * lineHeight) / 2
	const firstBaseline = blockTop + fontSize
	return (
		<text
			data-annotation-text={rect.id}
			x={x}
			y={firstBaseline}
			textAnchor={anchor}
			fontFamily={rect.textFontFamily ?? DEFAULT_RECTANGLE_TEXT.textFontFamily}
			fontSize={fontSize}
			fontWeight={rect.textFontWeight ?? DEFAULT_RECTANGLE_TEXT.textFontWeight}
			fill={rect.textColor ?? DEFAULT_RECTANGLE_TEXT.textColor}
		>
			{renderMultilineTspans(text, x)}
		</text>
	)
}

/** Draws one free-standing text annotation: the auto-sized background box
 *  (fill, border, corner radius) plus the label itself. Position is a single
 *  anchor point — `y` centers the box vertically, `textAlign` picks which
 *  horizontal edge lands on `x` — so the box size comes entirely from the
 *  measured text plus `textPadding`. See `lib/textAnnotationGeometry.ts`.
 *
 *  Width comes from canvas `measureText` against the label's actual face, so
 *  the box hugs the glyphs; a headless render (no canvas) falls back to the
 *  shared character-count estimate rather than collapsing to zero width.
 *  Returns null when a value-mode anchor can't be projected. */
const TextAnnotationMark = ({
	anno,
	inner,
	xScale,
	yScale,
	xType,
	yType,
}: {
	anno: TextAnnotation
	inner: Rect
	xScale: PositionScale | null
	yScale: PositionScale | null
	xType: FieldType | null
	yType: FieldType | null
}) => {
	const point = computeTextAnnotationAnchor(anno, inner, {
		xScale,
		yScale,
		xType,
		yType,
	})
	if (point === null) return null
	const fontSize = ptToPx(anno.textFontSize)
	const measured = measureMaxLabelWidth(
		[anno.text],
		anno.textFontFamily,
		fontSize,
		anno.textFontWeight
	)
	const textWidthPx =
		measured > 0 ? measured : estimateLongestLineWidth(anno.text, fontSize)
	const box = layoutTextAnnotationBox({
		anchorX: point.x,
		anchorY: point.y,
		textWidthPx,
		lines: lineCount(anno.text),
		fontSizePx: fontSize,
		padding: anno.textPadding,
		align: anno.textAlign,
	})
	const dash = annotationDasharray(anno.borderDasharray, anno.borderDash)
	return (
		<g>
			<rect
				data-annotation-text-box={anno.id}
				data-annotation-coord={anno.coordSystem}
				x={box.left}
				y={box.top}
				width={box.width}
				height={box.height}
				rx={anno.cornerRadius || undefined}
				ry={anno.cornerRadius || undefined}
				fill={anno.backgroundColor}
				fillOpacity={anno.backgroundOpacity}
				stroke={anno.borderColor}
				strokeWidth={anno.borderThickness}
				strokeOpacity={anno.borderOpacity}
				strokeDasharray={dash}
			/>
			<text
				data-annotation-text={anno.id}
				x={box.textX}
				y={box.firstBaseline}
				textAnchor={box.anchor}
				fontFamily={anno.textFontFamily}
				fontSize={fontSize}
				fontWeight={anno.textFontWeight}
				fill={anno.textColor}
			>
				{renderMultilineTspans(anno.text, box.textX)}
			</text>
		</g>
	)
}

/** Renders user-defined rectangle annotations against a panel's inner
 *  rect. Percent-mode coordinates are plot-area-normalized:
 *    xMin=0 → left edge of plot   |   xMax=1 → right edge of plot
 *    yMin=0 → BOTTOM edge of plot (cartesian convention; flipped to SVG
 *             top-down internally)
 *    yMax=1 → TOP edge of plot
 *  Value-mode coordinates are fed through a position scale built to MATCH
 *  the panel renderer's axis scale — same share-aware row source
 *  (`xScaleRows` / `yScaleRows`), same per-axis domain override, same
 *  per-axis first-tick offset, same level order. Without that match a data-unit
 *  rectangle drifts from the marks: under shared axes it would otherwise
 *  be built from the panel's own (narrower) extent and land "all over the
 *  place" across panels.
 *  Circles, line segments, and free-standing text labels ride the same
 *  scales and clip region. `layer` filters to only the annotations requesting
 *  "behind" or "front" so the caller can interleave the renderer's marks
 *  between them. */
export const AnnotationRects = ({
	rectangles,
	circles,
	lineSegments,
	texts,
	inner,
	layer,
	xScaleRows,
	yScaleRows,
	axisFields,
	xDomainOverride,
	yDomainOverride,
	firstTickPxOffsetX,
	firstTickPxOffsetY,
	levelOrders,
	isRadar,
	radiusScale,
}: {
	rectangles: readonly RectangleAnnotation[]
	circles: readonly CircleAnnotation[]
	lineSegments: readonly LineSegmentAnnotation[]
	texts: readonly TextAnnotation[]
	inner: Rect
	layer: "behind" | "front"
	xScaleRows: readonly Record<string, unknown>[]
	yScaleRows: readonly Record<string, unknown>[]
	axisFields: {
		xField: string | null
		yField: string | null
		xType: FieldType | null
		yType: FieldType | null
	}
	xDomainOverride?: { min?: number; max?: number }
	yDomainOverride?: { min?: number; max?: number }
	firstTickPxOffsetX?: number
	firstTickPxOffsetY?: number
	levelOrders: Record<string, readonly string[]>
	/** Radar panels render VALUE-mode circles themselves (RadarPlot owns the
	 *  radial scales), so skip them here to avoid a wrong (percent-fallback)
	 *  double-render. Percent-mode circles + all rectangles still render here.
	 *  Pies keep the percent-fallback render for any legacy value circles. */
	isRadar?: boolean
	/** Polar "Size panels by unit" factor (0..1) for this panel. The radar /
	 *  pie disc is drawn at `baseRadius · radiusScale` about the panel center,
	 *  but `inner` is uniform across panels — so percent annotations (sized off
	 *  `inner`) would stay the same size everywhere. Scaling them about the
	 *  panel center by this factor locks them to the disc, so they vary per
	 *  panel like the marks do. Undefined / 1 = no scaling (the default). */
	radiusScale?: number
}) => {
	// Stable, document-unique id so each panel's clip region is its own.
	const clipId = useId()
	const visibleRects = rectangles.filter((r) => r.zOrder === layer)
	const visibleCircles = circles.filter(
		(c) =>
			c.zOrder === layer && !(isRadar && c.coordSystem === "values")
	)
	// Value-mode lines on radar would need polar projection (RadarPlot owns
	// those scales); skip them here to avoid a wrong percent-fallback render,
	// matching the circle handling. Percent-mode lines still render.
	const visibleLines = lineSegments.filter(
		(l) => l.zOrder === layer && !(isRadar && l.coordSystem === "values")
	)
	// Same radar carve-out as lines: RadarPlot owns the polar scales, so a
	// value-mode label would render at the wrong (percent-fallback) spot.
	// Blank labels draw nothing at all — not even their box, since the box is
	// sized to the text.
	const visibleTexts = texts.filter(
		(t) =>
			t.zOrder === layer &&
			t.text.trim().length > 0 &&
			!(isRadar && t.coordSystem === "values")
	)
	if (
		visibleRects.length === 0 &&
		visibleCircles.length === 0 &&
		visibleLines.length === 0 &&
		visibleTexts.length === 0
	)
		return null
	// Lazily-built position scales for value-mode annotations. Match the
	// per-axis range to the panel's inner rect; y is inverted from SVG's
	// top-down to data-axis bottom-up so the user's "yMin" data value
	// renders at the BOTTOM of the rectangle. Rectangles and circles share
	// these scales (and the share-aware row source) so both track the marks.
	const xRange: [number, number] = [inner.x, inner.x + inner.width]
	const yRange: [number, number] = [inner.y + inner.height, inner.y]
	let xScale: PositionScale | null = null
	let yScale: PositionScale | null = null
	const needValues =
		visibleRects.some((r) => r.coordSystem === "values") ||
		visibleCircles.some((c) => c.coordSystem === "values") ||
		visibleLines.some((l) => l.coordSystem === "values") ||
		visibleTexts.some((t) => t.coordSystem === "values")
	if (needValues && axisFields.xField && axisFields.xType) {
		const raws = xScaleRows.map((r) => r[axisFields.xField as string])
		xScale = overrideLinearDomain(
			makePositionScale(
				raws,
				axisFields.xType,
				xRange,
				levelOrders[axisFields.xField],
				{ firstTickPxOffset: firstTickPxOffsetX }
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
				levelOrders[axisFields.yField],
				{ firstTickPxOffset: firstTickPxOffsetY }
			),
			axisFields.yType,
			yDomainOverride?.min,
			yDomainOverride?.max
		)
	}
	// "Size panels by unit" (polar): shrink percent annotations about the
	// panel center by the same factor the disc shrinks, so they track the
	// marks across differently-sized panels instead of staying full-panel.
	const s = radiusScale ?? 1
	const annoScaleTransform =
		Number.isFinite(s) && s > 0 && s !== 1
			? `translate(${inner.x + inner.width / 2} ${inner.y + inner.height / 2}) scale(${s}) translate(${-(inner.x + inner.width / 2)} ${-(inner.y + inner.height / 2)})`
			: undefined
	return (
		<g aria-hidden="true" pointerEvents="none">
			{/* Clip every annotation to this panel's plot area. A value-mode
			    rectangle whose data coords fall outside the panel's (possibly
			    narrow, independent-axis) domain keeps its true geometry — so
			    the configured min/max are honored — but only the in-bounds
			    portion paints. Fully out-of-bounds annotations clip to nothing
			    and draw no visible pixels. Percent-mode rects sit within
			    [0,1] of inner, so the clip is a no-op for them. */}
			<defs>
				<clipPath id={clipId}>
					<rect
						x={inner.x}
						y={inner.y}
						width={inner.width}
						height={inner.height}
					/>
				</clipPath>
			</defs>
			<g clipPath={`url(#${clipId})`}>
				<g transform={annoScaleTransform}>
				{visibleRects.map((r) => {
				const useValues = r.coordSystem === "values"
				let left: number, width: number
				let top: number, height: number
				if (useValues && xScale && axisFields.xType) {
					const a = applyPositionScale(xScale, r.xMin, axisFields.xType)
					const b = applyPositionScale(xScale, r.xMax, axisFields.xType)
					if (a === null || b === null) return null
					// Categorical (point-scale) coordinates land on the
					// category's CENTER, same as line-segment endpoints —
					// min/max name the exact positions the rectangle spans.
					const lo = Math.min(a, b)
					const hi = Math.max(a, b)
					left = lo
					width = hi - lo
				} else {
					// Percent fallback (also used when value-mode is selected
					// but the axis field/type isn't available — e.g. pie
					// chart's missing axis).
					const x0 = Math.min(toNumber(r.xMin), toNumber(r.xMax))
					const x1 = Math.max(toNumber(r.xMin), toNumber(r.xMax))
					left = inner.x + inner.width * x0
					width = inner.width * (x1 - x0)
				}
				if (useValues && yScale && axisFields.yType) {
					const a = applyPositionScale(yScale, r.yMin, axisFields.yType)
					const b = applyPositionScale(yScale, r.yMax, axisFields.yType)
					if (a === null || b === null) return null
					const lo = Math.min(a, b)
					const hi = Math.max(a, b)
					top = lo
					height = hi - lo
				} else {
					// Percent fallback. SVG y is top-down; data convention has
					// y=0 at the BOTTOM of the plot — flip so yMax→top.
					const y0 = Math.min(toNumber(r.yMin), toNumber(r.yMax))
					const y1 = Math.max(toNumber(r.yMin), toNumber(r.yMax))
					top = inner.y + inner.height * (1 - y1)
					height = inner.height * (y1 - y0)
				}
				const dash = annotationDasharray(r.borderDasharray, r.borderDash)
				return (
					<g key={r.id}>
						<rect
							data-annotation={r.id}
							data-annotation-coord={r.coordSystem}
							x={left}
							y={top}
							width={width}
							height={height}
							fill={r.backgroundColor}
							fillOpacity={r.backgroundOpacity}
							stroke={r.borderColor}
							strokeWidth={r.borderThickness}
							strokeOpacity={r.borderOpacity}
							strokeDasharray={dash}
						/>
						<AnnotationText
							rect={r}
							left={left}
							top={top}
							width={width}
							height={height}
						/>
					</g>
				)
			})}
			{visibleCircles.map((c) => {
				// Reuse the same per-panel scales as the rectangles so a
				// data-unit circle tracks the marks across facets. Returns
				// null when the circle can't be placed (e.g. a data-unit
				// radius against a categorical axis).
				const geom = computeCirclePixels(c, inner, {
					xScale,
					yScale,
					xType: axisFields.xType,
					yType: axisFields.yType,
				})
				if (geom === null) return null
				const dash = annotationDasharray(c.borderDasharray, c.borderDash)
				return (
					<circle
						key={c.id}
						data-annotation-circle={c.id}
						data-annotation-coord={c.coordSystem}
						cx={geom.cx}
						cy={geom.cy}
						r={geom.r}
						fill={c.backgroundColor}
						fillOpacity={c.backgroundOpacity}
						stroke={c.borderColor}
						strokeWidth={c.borderThickness}
						strokeOpacity={c.borderOpacity}
						strokeDasharray={dash}
					/>
				)
			})}
				{visibleLines.map((l) => {
					// Reuse the same per-panel scales as the rectangles so a
					// data-unit line tracks the marks across facets. Returns
					// null when an endpoint can't be projected.
					const geom = computeLineSegmentPixels(l, inner, {
						xScale,
						yScale,
						xType: axisFields.xType,
						yType: axisFields.yType,
					})
					if (geom === null) return null
					const dash = annotationDasharray(l.lineDasharray, l.lineDash)
					return (
						<line
							key={l.id}
							data-annotation-line={l.id}
							data-annotation-coord={l.coordSystem}
							x1={geom.x1}
							y1={geom.y1}
							x2={geom.x2}
							y2={geom.y2}
							stroke={l.lineColor}
							strokeWidth={l.lineThickness}
							strokeOpacity={l.lineOpacity}
							strokeDasharray={dash}
						/>
					)
				})}
				{visibleTexts.map((t) => (
					<TextAnnotationMark
						key={t.id}
						anno={t}
						inner={inner}
						xScale={xScale}
						yScale={yScale}
						xType={axisFields.xType}
						yType={axisFields.yType}
					/>
				))}
				</g>
			</g>
		</g>
	)
}
