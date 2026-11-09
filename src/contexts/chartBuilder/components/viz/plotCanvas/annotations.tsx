import { useId } from "react"
import type {
	CircleAnnotation,
	ImageAnnotation,
	LineSegmentAnnotation,
	RectangleAnnotation,
	TextAnnotation,
} from "../../../lib/annotationsConfig"
import type { AnnotationCoordSystem } from "../../../lib/annotationPixels"
import type { LineDashPattern } from "../../../lib/channelConfig"
import { lineCapToSvg } from "../../../lib/arrowheadGeometry"
import { dashArrayFor, sanitizeCustomDasharray } from "../../../lib/dashPatterns"
import type { Rect } from "../../../lib/facetLayoutSolver"
import { lineCount, renderMultilineTspans } from "../../../lib/multilineText"
import {
	annotationClipsToPanel,
	layoutPanelAnnotations,
	rectangleTextStyle,
	type AnnotationAxisFields,
	type PanelAnnotationScaleInputs,
	type PlacedImage,
	type PlacedRectangle,
	type PlacedText,
} from "./annotationLayout"

export { annotationOnPanel } from "./annotationLayout"

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
const AnnotationText = ({ placed }: { placed: PlacedRectangle }) => {
	const { anno: rect, left, top, width, height } = placed
	const style = rectangleTextStyle(rect)
	if (style.text.trim().length === 0) return null
	const anchor =
		style.align === "left" ? "start" : style.align === "right" ? "end" : "middle"
	const x =
		style.align === "left"
			? left + style.padding
			: style.align === "right"
				? left + width - style.padding
				: left + width / 2
	// Center the multi-line block vertically: a line box is `fontSize * 1.2`
	// tall, so the block spans `lines * lineHeight`. The first baseline sits one
	// `fontSize` below the block's top (matching the caption convention).
	const lineHeight = style.fontSizePx * 1.2
	const blockTop = top + (height - lineCount(style.text) * lineHeight) / 2
	const firstBaseline = blockTop + style.fontSizePx
	return (
		<text
			data-annotation-text={rect.id}
			x={x}
			y={firstBaseline}
			textAnchor={anchor}
			fontFamily={style.fontFamily}
			fontSize={style.fontSizePx}
			fontWeight={style.fontWeight}
			fontStyle={style.italic ? "italic" : undefined}
			textDecoration={style.underline ? "underline" : undefined}
			fill={style.color}
		>
			{renderMultilineTspans(style.text, x)}
		</text>
	)
}

/** Draws one free-standing text annotation: the auto-sized background box
 *  (fill, border, corner radius) plus the label itself. Position is a single
 *  anchor point — `y` centers the box vertically, `textAlign` picks which
 *  horizontal edge lands on `x` — so the box size comes entirely from the
 *  measured text plus `textPadding`. See `lib/textAnnotationGeometry.ts`. */
const TextAnnotationMark = ({
	placed,
	clipPath,
}: {
	placed: PlacedText
	clipPath: string | undefined
}) => {
	const { anno, box, fontSizePx } = placed
	const dash = annotationDasharray(anno.borderDasharray, anno.borderDash)
	return (
		<g clipPath={clipPath}>
			<rect
				aria-hidden="true"
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
				fontSize={fontSizePx}
				fontWeight={anno.textFontWeight}
				fontStyle={anno.textItalic ? "italic" : undefined}
				textDecoration={anno.textUnderline ? "underline" : undefined}
				fill={anno.textColor}
			>
				{renderMultilineTspans(anno.text, box.textX)}
			</text>
		</g>
	)
}

/** Draws one image annotation: the stored picture (a data URL) filling the
 *  box the layout sized from its width / height (`preserveAspectRatio`
 *  "none": with the ratio locked the box already has the picture's
 *  proportions, unlocked the stretch is the point). `href` AND
 *  `xlink:href` are both written — browsers read either, and desktop SVG
 *  importers (PowerPoint) still want the xlink form. A description makes the
 *  picture an `img` for assistive tech; without one it is decorative, hidden
 *  like the annotation shapes. */
const ImageAnnotationMark = ({
	placed,
	clipPath,
}: {
	placed: PlacedImage
	clipPath: string | undefined
}) => {
	const { anno, left, top, width, height } = placed
	const alt = anno.alt.trim()
	return (
		<image
			data-annotation-image={anno.id}
			data-annotation-coord={anno.coordSystem}
			clipPath={clipPath}
			href={anno.href}
			xlinkHref={anno.href}
			x={left}
			y={top}
			width={width}
			height={height}
			preserveAspectRatio="none"
			opacity={anno.opacity < 1 ? anno.opacity : undefined}
			role={alt ? "img" : undefined}
			aria-label={alt || undefined}
			aria-hidden={alt ? undefined : "true"}
		/>
	)
}

/** Renders user-defined annotations against a panel's inner rect.
 *  Percent-mode coordinates are plot-area-normalized:
 *    xMin=0 → left edge of plot   |   xMax=1 → right edge of plot
 *    yMin=0 → BOTTOM edge of plot (cartesian convention; flipped to SVG
 *             top-down internally)
 *    yMax=1 → TOP edge of plot
 *  and may run past 0–1 to place an annotation beside / above the plot.
 *  Value-mode coordinates are fed through a position scale built to MATCH
 *  the panel renderer's axis scale — same share-aware row source
 *  (`xScaleRows` / `yScaleRows`), same per-axis domain override, same level
 *  order. Without that match a data-unit rectangle drifts from the marks:
 *  under shared axes it would otherwise be built from the panel's own
 *  (narrower) extent and land "all over the place" across panels.
 *
 *  Nothing is clipped to the panel EXCEPT value-mode annotations on a
 *  multi-panel chart (`annotationClipsToPanel`): there each facet draws the
 *  data-unit annotation in its own coordinates, and an out-of-domain one
 *  must draw nothing in that panel rather than bleed into a neighbor. The
 *  clip preserves the true geometry (the configured min/max stay intact);
 *  only the in-bounds portion paints. Every other annotation may sit
 *  anywhere on the canvas — PlotCanvas reserves canvas margins so it stays
 *  in view (`annotationReserve.ts`).
 *
 *  The placement math itself lives in `layoutPanelAnnotations`, shared with
 *  that reserve estimate. `layer` filters to only the annotations requesting
 *  "behind" or "front" so the caller can interleave the renderer's marks
 *  between them. */
export const AnnotationRects = ({
	rectangles,
	circles,
	lineSegments,
	texts,
	images,
	inner,
	layer,
	xScaleRows,
	yScaleRows,
	axisFields,
	xDomainOverride,
	yDomainOverride,
	levelOrders,
	isRadar,
	radiusScale,
	multiPanel,
}: PanelAnnotationScaleInputs & {
	rectangles: readonly RectangleAnnotation[]
	circles: readonly CircleAnnotation[]
	lineSegments: readonly LineSegmentAnnotation[]
	texts: readonly TextAnnotation[]
	/** Optional for callers holding a config saved before images shipped. */
	images?: readonly ImageAnnotation[]
	inner: Rect
	layer: "behind" | "front"
	axisFields: AnnotationAxisFields
	levelOrders: Record<string, readonly string[]>
	/** Radar panels render VALUE-mode circles themselves (RadarPlot owns the
	 *  radial scales), so skip them here to avoid a wrong (percent-fallback)
	 *  double-render. Percent-mode circles + all rectangles still render here.
	 *  Pies keep the percent-fallback render for any legacy value circles. */
	isRadar?: boolean
	/** True when the chart has more than one panel — the only case in which
	 *  value-mode annotations clip to their panel. */
	multiPanel?: boolean
}) => {
	// Stable, document-unique id so each panel's clip region is its own.
	const clipId = useId()
	const placed = layoutPanelAnnotations({
		rectangles: rectangles.filter((r) => r.zOrder === layer),
		circles: circles.filter((c) => c.zOrder === layer),
		lineSegments: lineSegments.filter((l) => l.zOrder === layer),
		texts: texts.filter((t) => t.zOrder === layer),
		images: (images ?? []).filter((m) => m.zOrder === layer),
		inner,
		axisFields,
		levelOrders,
		isRadar: isRadar ?? false,
		xScaleRows,
		yScaleRows,
		xDomainOverride,
		yDomainOverride,
		radiusScale,
	})
	if (placed.length === 0) return null
	const clipFor = (coordSystem: AnnotationCoordSystem) =>
		annotationClipsToPanel(coordSystem, multiPanel ?? false)
			? `url(#${clipId})`
			: undefined
	const needsClipDef = placed.some(
		(a) => clipFor(a.anno.coordSystem) !== undefined
	)
	// "Size panels by unit" (polar): shrink percent annotations about the
	// panel center by the same factor the disc shrinks, so they track the
	// marks across differently-sized panels instead of staying full-panel.
	const s = radiusScale ?? 1
	const annoScaleTransform =
		Number.isFinite(s) && s > 0 && s !== 1
			? `translate(${inner.x + inner.width / 2} ${inner.y + inner.height / 2}) scale(${s}) translate(${-(inner.x + inner.width / 2)} ${-(inner.y + inner.height / 2)})`
			: undefined
	return (
		// The author's annotation TEXT (and a described image) stays readable;
		// only the decorative shapes (rects, circles, lines, arrowheads, text
		// boxes, undescribed images) are hidden.
		<g data-annotation-layer pointerEvents="none">
			{needsClipDef && (
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
			)}
			<g transform={annoScaleTransform}>
				{placed.map((a) => {
					const clipPath = clipFor(a.anno.coordSystem)
					switch (a.kind) {
						case "rectangle": {
							const r = a.anno
							const dash = annotationDasharray(r.borderDasharray, r.borderDash)
							return (
								<g key={r.id} clipPath={clipPath}>
									<rect
										aria-hidden="true"
										data-annotation={r.id}
										data-annotation-coord={r.coordSystem}
										x={a.left}
										y={a.top}
										width={a.width}
										height={a.height}
										fill={r.backgroundColor}
										fillOpacity={r.backgroundOpacity}
										stroke={r.borderColor}
										strokeWidth={r.borderThickness}
										strokeOpacity={r.borderOpacity}
										strokeDasharray={dash}
									/>
									<AnnotationText placed={a} />
								</g>
							)
						}
						case "circle": {
							const c = a.anno
							const dash = annotationDasharray(c.borderDasharray, c.borderDash)
							return (
								<circle
									key={c.id}
									aria-hidden="true"
									data-annotation-circle={c.id}
									data-annotation-coord={c.coordSystem}
									clipPath={clipPath}
									cx={a.cx}
									cy={a.cy}
									r={a.r}
									fill={c.backgroundColor}
									fillOpacity={c.backgroundOpacity}
									stroke={c.borderColor}
									strokeWidth={c.borderThickness}
									strokeOpacity={c.borderOpacity}
									strokeDasharray={dash}
								/>
							)
						}
						case "line": {
							const l = a.anno
							const dash = annotationDasharray(l.lineDasharray, l.lineDash)
							const cap = lineCapToSvg(a.cap)
							// The stroke stops at `a.end` — the far endpoint, or the
							// arrowhead's base — and the head is explicit path geometry
							// (no <marker>: PowerPoint's SVG import drops them). Both
							// share the clip so a value-mode arrow on a facet grid
							// can't poke its head into the next panel, and the line's
							// opacity sits on the GROUP: where the line runs under an
							// open chevron (or a round cap tucks under a head) the two
							// then composite once instead of darkening at the overlap.
							return (
								<g
									key={l.id}
									aria-hidden="true"
									clipPath={clipPath}
									opacity={l.lineOpacity < 1 ? l.lineOpacity : undefined}
								>
									<line
										data-annotation-line={l.id}
										data-annotation-coord={l.coordSystem}
										x1={a.x1}
										y1={a.y1}
										x2={a.end.x}
										y2={a.end.y}
										stroke={l.lineColor}
										strokeWidth={l.lineThickness}
										strokeDasharray={dash}
										strokeLinecap={cap}
									/>
									{a.arrowhead &&
										(a.arrowhead.filled ? (
											<path
												data-annotation-arrowhead={l.id}
												data-arrowhead-style={a.arrowhead.style}
												d={a.arrowhead.d}
												fill={l.lineColor}
												stroke="none"
											/>
										) : (
											<path
												data-annotation-arrowhead={l.id}
												data-arrowhead-style={a.arrowhead.style}
												d={a.arrowhead.d}
												fill="none"
												stroke={l.lineColor}
												strokeWidth={l.lineThickness}
												strokeLinecap={cap}
												strokeLinejoin={cap === "round" ? "round" : "miter"}
											/>
										))}
								</g>
							)
						}
						case "text":
							return (
								<TextAnnotationMark
									key={a.anno.id}
									placed={a}
									clipPath={clipPath}
								/>
							)
						case "image":
							return (
								<ImageAnnotationMark
									key={a.anno.id}
									placed={a}
									clipPath={clipPath}
								/>
							)
					}
				})}
			</g>
		</g>
	)
}
