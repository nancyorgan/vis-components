import {
	DEFAULT_SHAPE,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	type ChannelConfigs,
	type TextConfig,
} from "../../../lib/channelConfig"
import { ptToPx } from "../../../lib/fontUnit"
import { resolvePatternDefForItem } from "../../../lib/buildPatternDefs"
import { effectiveType } from "../../../lib/fieldType"
import { resolveMarkAesthetics } from "../../../lib/resolveMarkAesthetics"
import {
	applyHueScale,
	applyPositionScale,
	makePositionScale,
} from "../../../lib/scales"
import { GlyphMark, resolveGlyph } from "../../../lib/customGlyphs"
import { resolveShapeColors } from "../../../lib/shapeColors"
import { resolveRuleColor } from "../../../lib/textColorRules"
import { formatTextValue, resolveTextColor } from "../../../lib/textEncoding"
import type { Encodings } from "../../../lib/types"
import type { AestheticScales } from "../../../store/useAestheticScales"
import {
	rowHighlight,
	type LegendHighlight,
} from "../../../store/useLegendHighlight"
import type { HoverState, Mark } from "./types"

/** Render the per-row data points (shape paths, or length/angle line
 * segments) for a chart. Shared by the standard scatter / strip-plot path and
 * the single-variable violin/box path so the dots get identical hue / shape /
 * pattern / opacity treatment regardless of which branch built them. */
export const renderMarkPaths = (args: {
	marks: Mark[]
	markedIndices: Set<number> | null
	channelConfigs: ChannelConfigs
	hoveredIdx: number | null
	/** Per-row border (stroke) opacity from the Border opacity slot. */
	borderOpacity: (row: Record<string, unknown>) => number
	setHovered: (h: HoverState | null) => void
	/** Legend-hover highlight state; dims marks whose field value doesn't
	 * match the hovered legend entry. `null` = nothing hovered. */
	highlight: LegendHighlight | null
	/** Publish the hovered mark's series to the highlight atom on mark enter,
	 * so direct hover recolors / outlines / fades like a legend hover. */
	publishHover: (row: Record<string, unknown>) => void
}): React.ReactNode => {
	const {
		marks,
		markedIndices,
		channelConfigs,
		hoveredIdx,
		borderOpacity,
		setHovered,
		highlight,
		publishHover,
	} = args
	return (
		<g>
			{marks.map((m) => {
				if (markedIndices !== null && !markedIndices.has(m.i)) {
					return null
				}
				// Pattern can apply to points AND lines simultaneously
				// (renderConnectionLines reads the same idx and maps
				// it to DASH_CYCLE for the polyline). Points keep
				// their fill pattern regardless of line-chart context.
				const effectivePatternId = m.patternId
				const fillProp = effectivePatternId
					? `url(#${effectivePatternId})`
					: m.fill
				// `outlineColor` is no longer read at render time —
				// the per-mark `m.shapeStroke` baked it in already
				// (defaulting to hue when hue is mapped, or to the
				// theme's outline color otherwise). Width still comes
				// straight off the config since it's a single number.
				const outlineWidth = channelConfigs.shape?.outlineWidth ?? 1
				// Legend/mark-hover highlight: recolor / outline the matched mark
				// and fade the rest. When the highlight atom is active (a legend
				// entry OR another mark's series is hovered), the atom drives the
				// fade — skip the ad-hoc per-point dim so they don't compound.
				const mh = rowHighlight(highlight, m.row)
				const localDim = highlight
					? 1
					: hoveredIdx === null || hoveredIdx === m.i
						? 1
						: 0.3
				const hoverFocus = localDim * mh.opacityMul
				if (m.line) {
					return (
						<line
							key={m.i}
							{...m.line}
							stroke={mh.fill ?? m.fill}
							strokeWidth={3}
							strokeLinecap="round"
							opacity={hoverFocus * m.markOpacity}
							onMouseEnter={(e) => {
								setHovered({
									i: m.i,
									row: m.row,
									clientX: e.clientX,
									clientY: e.clientY,
								})
								publishHover(m.row)
							}}
						/>
					)
				}
				// Per-shape fill / stroke overrides win over the hue color.
				// `"none"` is the literal SVG sentinel — gives a hollow
				// shape that still picks up the (overridden or default)
				// stroke. Pattern fills always go through `fillProp` since
				// the pattern fills the path itself.
				const baseFillForShape = effectivePatternId
					? fillProp
					: m.shapeFill === "none"
						? "none"
						: m.shapeFill
				// Highlight recolor repaints the fill (overriding pattern / hollow);
				// highlight outline overrides the stroke + thickens it.
				const fillForShape = mh.fill ?? baseFillForShape
				// `m.shapeStroke` already bakes in the outline precedence
				// (explicit Color-menu outline > per-category > hue when
				// mapped > theme outline), so it applies to pattern-filled
				// points too — previously these were forced to `m.fill`,
				// which silently discarded the user's outline color.
				const strokeForShape = mh.outline ?? m.shapeStroke
				return (
					<GlyphMark
						key={m.i}
						glyph={m.glyph ?? { kind: "symbol", idx: 0 }}
						r={m.r}
						transform={`translate(${m.cx},${m.cy})${
							m.rotation == null ? "" : ` rotate(${m.rotation})`
						}`}
						fill={fillForShape}
						fillOpacity={fillForShape === "none" ? 0 : m.markOpacity}
						stroke={strokeForShape}
						strokeWidth={
							mh.outline
								? Math.max(outlineWidth, mh.outlineWidth)
								: outlineWidth
						}
						strokeOpacity={mh.outline ? 1 : borderOpacity(m.row)}
						opacity={hoverFocus}
						onMouseEnter={(e) => {
							setHovered({
								i: m.i,
								row: m.row,
								clientX: e.clientX,
								clientY: e.clientY,
							})
							publishHover(m.row)
						}}
					/>
				)
			})}
		</g>
	)
}

/** Draw text labels for each mark when the `text` encoding is mapped.
 * Anchored just to the right of the mark's centroid so it sits next to the
 * point/line without overlapping its outline. Uses the active `TextConfig`
 * for font, weight, and per-category color overrides. */
export const renderTextLabels = (
	marks: Mark[],
	textField: string | null,
	channelConfigs: ChannelConfigs
) => {
	if (!textField) return null
	const cfg: TextConfig = { ...DEFAULT_TEXT_CONFIG, ...channelConfigs.text }
	const offset = 6
	// Build a value→index map so each row gets a stable palette slot.
	const indexByValue = new Map<string, number>()
	for (const m of marks) {
		const raw = m.row[textField]
		if (raw === undefined || raw === null || raw === "") continue
		const key = String(raw)
		if (!indexByValue.has(key)) indexByValue.set(key, indexByValue.size)
	}
	return (
		<g aria-hidden>
			{marks.map((m) => {
				const raw = m.row[textField]
				const formatted = formatTextValue(raw, cfg.decimals)
				if (formatted === null) return null
				const idx =
					raw === undefined || raw === null
						? undefined
						: indexByValue.get(String(raw))
				return (
					<text
						key={`txt-${m.i}`}
						x={m.cx + offset}
						y={m.cy}
						fill={resolveTextColor(raw, cfg, idx)}
						fontFamily={cfg.fontFamily}
						fontSize={ptToPx(cfg.fontSize)}
						fontWeight={cfg.fontWeight}
						dominantBaseline="middle"
						pointerEvents="none"
					>
						{formatted}
					</text>
				)
			})}
		</g>
	)
}

/** Tie-break for `sortByDrawOrder`: when the draw-order field can't separate
 * two marks (equal or both-unrankable values — common with a coarse ordinal
 * field), paint the bigger radius first so it lands BEHIND and the smaller
 * mark stays visible on top. Runs only within a field tie, so it never
 * overrides the user's chosen ordering across levels. */
export const drawOrderSizeTieBreak = (a: Mark, b: Mark): number => b.r - a.r

type BuildMarksArgs = {
	rowsForChart: Array<Record<string, unknown>>
	encodings: Encodings
	channelConfigs: ChannelConfigs
	aestheticScales: AestheticScales
	xScale: NonNullable<ReturnType<typeof makePositionScale>>
	yScale: NonNullable<ReturnType<typeof makePositionScale>>
	xType: NonNullable<ReturnType<typeof effectiveType>>
	yType: NonNullable<ReturnType<typeof effectiveType>>
}

export const buildMarks = ({
	rowsForChart,
	encodings,
	channelConfigs,
	aestheticScales,
	xScale,
	yScale,
	xType,
	yType,
}: BuildMarksArgs): Mark[] => {
	const hue = aestheticScales.hue?.field ?? null
	const outlineHue = aestheticScales.outlineHue?.field ?? null
	const outlineHueScale = aestheticScales.outlineHue?.scale ?? null
	const shape = aestheticScales.shape?.field ?? null
	const length = aestheticScales.length?.field ?? null
	const angle = aestheticScales.angle?.field ?? null
	const pattern = aestheticScales.pattern?.field ?? null
	const shapeIdx = aestheticScales.shape?.idx ?? null
	const lengthScale = aestheticScales.length?.scale ?? null
	const angleScale = aestheticScales.angle?.scale ?? null

	const patternBgFallback = channelConfigs.pattern?.backgroundColor ?? "#e2e8f0"

	const xName = encodings.x?.field as string
	const yName = encodings.y?.field as string

	return rowsForChart
		.map((row, i): Mark | null => {
			const cx = applyPositionScale(xScale, row[xName], xType)
			const cy = applyPositionScale(yScale, row[yName], yType)
			if (cx === null || cy === null) return null

			// Hue → sat/bri modulation → opacity → area radius, via the
			// shared per-row pipeline (also captures the pre-modulation hue
			// color for the pattern-ink lookup below).
			const {
				fill,
				preModulationHue,
				opacity: markOpacity,
				radius: r,
				satUnit,
				briUnit,
			} = resolveMarkAesthetics(row, aestheticScales, channelConfigs)

			// Length/angle: line segment mode (overrides shape)
			let lenValue: number | null = null
			let angValue: number | null = null
			if (lengthScale && length) {
				lenValue = lengthScale(row[length.name])
			} else if (channelConfigs.defaultLength != null) {
				lenValue = channelConfigs.defaultLength
			}
			if (angleScale && angle) {
				angValue = angleScale(row[angle.name])
			} else if (channelConfigs.defaultAngle != null) {
				angValue = (channelConfigs.defaultAngle * Math.PI) / 180
			}

			// Same per-item resolver the upfront pattern-defs pass uses, so a
			// mark's svgId always references an emitted def. `defaultToNone`:
			// in line chart context points stay clean by default — Pattern
			// drives line dash style via `dashOverrides`; per-category point
			// fills require an explicit Point-fill swatch click.
			const resolvedPattern =
				pattern || channelConfigs.defaultPattern != null
					? resolvePatternDefForItem(
							{
								patternValue: pattern ? row[pattern.name] : undefined,
								fill,
								preModulationHue,
								satUnit,
								briUnit,
							},
							aestheticScales,
							channelConfigs,
							patternBgFallback,
							{
								defaultToNone: !!encodings.connection?.field,
								includeDefaultPattern: true,
							}
						)
					: null
			const patternId = resolvedPattern?.svgId ?? null

			// Shape (only used when length is not active)
			const shapeIndex =
				shapeIdx && shape
					? shapeIdx(row[shape.name])
					: (channelConfigs.defaultShape ?? DEFAULT_SHAPE)
			const glyph =
				lenValue === null
					? resolveGlyph(shapeIndex, channelConfigs.shape?.customGlyphs)
					: null
			// Per-category fill / stroke overrides. Keyed by the SHAPE
			// encoding's value when it's mapped, so users can give one
			// category a hollow look (`"none"`) or pair a light fill with a
			// dark stroke without dropping into the hue palette.
			// Per-category fill / stroke resolution lives in
			// `lib/shapeColors.ts` so the precedence rules are testable
			// without spinning up the whole chart pipeline. Pass the
			// hue-derived `fill` and let the helper decide whether the
			// stroke inherits it (hue mapped) or falls back to the theme
			// outline color (hue unmapped).
			const shapeKey = shape ? String(row[shape.name] ?? "") : null
			// Field-driven outline color (the `outlineHue` channel). When
			// mapped, the row's value resolves to a stroke color that sits
			// between any per-category override and the universal outline
			// fallback (see resolveShapeColors precedence).
			const outlineScaleColor =
				outlineHueScale && outlineHue
					? applyHueScale(
							outlineHueScale,
							row[outlineHue.name],
							outlineHue.type
						)
					: null
			// Conditional outline rules test the mapped outline variable's
			// value and override the scale color when one matches. Only fire
			// when an outline field is mapped (nothing to compare otherwise).
			const outlineRuleColor = outlineHue
				? resolveRuleColor(
						channelConfigs.shape?.outlineColorRules,
						row[outlineHue.name]
					)
				: null
			const { fill: shapeFill, stroke: shapeStroke } = resolveShapeColors({
				hueFill: fill,
				shapeCategoryValue: shapeKey,
				shapeConfig: channelConfigs.shape,
				hueMapped: !!hue,
				fallbackOutline:
					channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor,
				outlineScaleColor,
				outlineRuleColor,
			})

			// Line endpoints (centered on anchor at (cx, cy))
			let line: { x1: number; y1: number; x2: number; y2: number } | null = null
			if (lenValue !== null) {
				const a = angValue ?? 0
				const half = lenValue / 2
				line = {
					x1: cx - Math.cos(a) * half,
					y1: cy - Math.sin(a) * half,
					x2: cx + Math.cos(a) * half,
					y2: cy + Math.sin(a) * half,
				}
			}

			// Pass angle through for shape rotation (when not in line mode)
			const rotation =
				lenValue === null && angValue != null
					? (angValue * 180) / Math.PI
					: null

			return {
				i,
				cx,
				cy,
				r,
				fill,
				shapeFill,
				shapeStroke,
				glyph,
				line,
				patternId,
				markOpacity,
				rotation,
				row,
			}
		})
		.filter((m): m is Mark => m !== null)
}
