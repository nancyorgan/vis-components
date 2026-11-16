import {
	DEFAULT_TEXT_CONFIG,
	type ChannelConfigs,
	type TextConfig,
} from "../../../lib/channelConfig"
import { ptToPx } from "../../../lib/fontUnit"
import { resolvePatternDefForItem } from "../../../lib/buildPatternDefs"
import { resolveDashGapColor, resolveDashGapFill } from "../../../lib/dashPatterns"
import { inkPaletteForHue } from "../../../lib/patterns"
import {
	resolveSegmentPatternContext,
	resolveSegmentPatternMode,
	segmentDashArray,
} from "../../../lib/segmentPattern"
import { effectiveType } from "../../../lib/fieldType"
import { resolveMarkAesthetics } from "../../../lib/resolveMarkAesthetics"
import { outlineWidthResolver } from "../../../lib/markOutline"
import { pointStyleResolver } from "../../../lib/pointStyle"
import { applyPositionScale, makePositionScale } from "../../../lib/scales"
import { GlyphMark, resolveGlyph } from "../../../lib/customGlyphs"
import {
	resolveSegmentThickness,
	segmentStrokeLinecap,
} from "../../../lib/segmentStroke"
import { formatTextValue, resolveTextColor } from "../../../lib/textEncoding"
import type { Encodings } from "../../../lib/types"
import { uniqueValues } from "../../../lib/uniqueFieldValues"
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
	publishHover: (row: Record<string, unknown>, node?: string) => void
	/** Single-element hover (a violin / box chart): each mark's own key, so
	 * hovering one lights that mark alone instead of its whole series. */
	nodeKeyOf?: (m: Mark) => string
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
		nodeKeyOf,
	} = args
	// The outline's thickness: one value, or the mark's level's ("Vary by").
	const outlineWidthFor = outlineWidthResolver(channelConfigs)
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
				// theme's outline color otherwise).
				const outlineWidth = outlineWidthFor(m.row)
				// Legend/mark-hover highlight: recolor / outline the matched mark
				// and fade the rest. When the highlight atom is active (a legend
				// entry OR another mark's series is hovered), the atom drives the
				// fade — skip the ad-hoc per-point dim so they don't compound.
				const nodeKey = nodeKeyOf?.(m)
				const mh = rowHighlight(highlight, m.row, nodeKey)
				const localDim = highlight
					? 1
					: hoveredIdx === null || hoveredIdx === m.i
						? 1
						: 0.3
				const hoverFocus = localDim * mh.opacityMul
				if (m.line) {
					const onEnter = (e: React.MouseEvent) => {
						setHovered({
							i: m.i,
							row: m.row,
							clientX: e.clientX,
							clientY: e.clientY,
						})
						publishHover(m.row, nodeKey)
					}
					const segment = m.segmentPattern
					// Pattern on a segment: in fill mode the tile IS the stroke
					// paint (SVG lets a <pattern> paint a stroke, so the capsule
					// fills like a bar would, caps included); in dash mode the
					// stroke carries the dasharray, over the gap-color underlay
					// when "Fill dash gaps" is on. The highlight recolor wins over
					// the pattern paint, as it does on a patterned bar.
					const patternStroke =
						segment?.kind === "fill" && effectivePatternId
							? `url(#${effectivePatternId})`
							: m.fill
					const dashArray = segment?.kind === "dash" ? segment.dashArray : null
					const gapColor =
						segment?.kind === "dash" && dashArray !== null
							? segment.gapColor
							: null
					const strokeProps = {
						strokeWidth: resolveSegmentThickness(channelConfigs.length, m.row),
						strokeLinecap: segmentStrokeLinecap(channelConfigs.length),
					}
					if (gapColor !== null) {
						return (
							<g
								key={m.i}
								opacity={hoverFocus * m.markOpacity}
								onMouseEnter={onEnter}
							>
								<line {...m.line} stroke={gapColor} {...strokeProps} />
								<line
									{...m.line}
									stroke={mh.fill ?? patternStroke}
									strokeDasharray={dashArray ?? undefined}
									{...strokeProps}
								/>
							</g>
						)
					}
					return (
						<line
							key={m.i}
							{...m.line}
							stroke={mh.fill ?? patternStroke}
							strokeDasharray={dashArray ?? undefined}
							{...strokeProps}
							opacity={hoverFocus * m.markOpacity}
							onMouseEnter={onEnter}
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
							publishHover(m.row, nodeKey)
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
	channelConfigs: ChannelConfigs,
	/** Legend / mark-hover highlight — a label fades with its own mark. */
	highlight: LegendHighlight | null = null
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
				const opacityMul = rowHighlight(highlight, m.row).opacityMul
				return (
					<text
						key={`txt-${m.i}`}
						x={m.cx + offset}
						y={m.cy}
						opacity={opacityMul < 1 ? opacityMul : undefined}
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

export type BuildMarksArgs = {
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
	const length = aestheticScales.length?.field ?? null
	const angle = aestheticScales.angle?.field ?? null
	const pattern = aestheticScales.pattern?.field ?? null
	const lengthScale = aestheticScales.length?.scale ?? null
	const angleScale = aestheticScales.angle?.scale ?? null

	const patternBgOverride = channelConfigs.pattern?.backgroundColor ?? null
	// The points' glyph and fill / outline colors, by the rules every chart's
	// points share (`lib/pointStyle`).
	const pointStyle = pointStyleResolver(channelConfigs, aestheticScales)

	const xName = encodings.x?.field as string
	const yName = encodings.y?.field as string

	// Segment-pattern state, resolved ONCE per chart (the Pattern menu's
	// toggle and the legends resolve the same way, so they agree with the
	// marks). Per row only a Vary-by thickness re-runs the auto rule. The
	// scatter renderer is the only caller of buildMarks, so `lengthRole`
	// is its own: "mark".
	const segmentCtx = resolveSegmentPatternContext({
		lengthRole: "mark",
		encodings,
		channelConfigs,
		patternMapped: !!pattern,
	})
	const patternDomain: readonly string[] =
		segmentCtx && pattern
			? uniqueValues(
					rowsForChart.map((r) => r[pattern.name]),
					{ skipBlank: false }
				)
			: []
	const hueField = encodings.hue?.field ?? null
	const segmentGapFill = segmentCtx
		? resolveDashGapFill({
				configured: channelConfigs.connection?.dashGapFill ?? null,
				patternField: pattern?.name ?? null,
				hueField,
			})
		: false
	const gapInkPalette = inkPaletteForHue(channelConfigs, hue?.type)

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
							patternBgOverride,
							{
								defaultToNone: !!encodings.connection?.field,
								includeDefaultPattern: true,
							}
						)
					: null
			const patternId = resolvedPattern?.svgId ?? null

			// Shape (only used when length is not active)
			const glyph =
				lenValue === null
					? resolveGlyph(pointStyle.shapeIndex(row), channelConfigs.shape?.customGlyphs)
					: null
			// Fill and outline color: the Color mapping's `fill`, unless the
			// point's Shape category has a look of its own; the outline from the
			// Outline variable, a matching rule, or the single outline color.
			const { fill: shapeFill, stroke: shapeStroke } = pointStyle.colors(row, fill)

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

			// How Pattern paints this segment — see `Mark.segmentPattern`.
			let segmentPattern: Mark["segmentPattern"] = null
			if (line !== null && segmentCtx) {
				const mode = resolveSegmentPatternMode({
					configured: channelConfigs.pattern?.segmentPattern,
					thickness: resolveSegmentThickness(channelConfigs.length, row),
					tileSide: segmentCtx.tileSide,
				})
				if (mode === "fill") {
					segmentPattern = patternId !== null ? { kind: "fill" } : null
				} else {
					const rawPattern = pattern ? row[pattern.name] : undefined
					const patternValue =
						rawPattern === undefined || rawPattern === null
							? null
							: String(rawPattern)
					const dashArray = segmentDashArray({
						patternValue,
						domain: patternDomain,
						patternCfg: channelConfigs.pattern,
						connectionCfg: channelConfigs.connection,
					})
					const rawHue = hueField ? row[hueField] : null
					// Gap ink pairs on the PRE-modulation color, like a connection
					// line's underlay (`resolveDashGapColor`).
					const gapColor =
						segmentGapFill && dashArray !== null
							? resolveDashGapColor({
									overrideKeys: [
										rawHue === null || rawHue === undefined
											? null
											: String(rawHue),
									],
									patternValue,
									hueColor: hue ? preModulationHue : null,
									lineColor: preModulationHue,
									overrides: channelConfigs.connection?.dashAlternateColors ?? {},
									singleOverride: channelConfigs.connection?.dashGapColor ?? null,
									inkColors: channelConfigs.pattern?.inkColors ?? {},
									palette: gapInkPalette.palette,
									patternInks: gapInkPalette.inks,
									themeInkFallback: aestheticScales.themeInkFallback,
									defaultInk:
										channelConfigs.defaultPatternInk ??
										channelConfigs.patternInkColor ??
										null,
								})
							: null
					segmentPattern = { kind: "dash", dashArray, gapColor }
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
				segmentPattern,
				markOpacity,
				rotation,
				row,
			}
		})
		.filter((m): m is Mark => m !== null)
}
