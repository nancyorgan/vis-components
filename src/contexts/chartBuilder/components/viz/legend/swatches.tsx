import { max } from "d3-array"
import { useEffect, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import {
	GlyphMark,
	stripNudge,
	type ResolvedGlyph,
} from "../../../lib/customGlyphs"
import { chunkColumns } from "../../../lib/legendSections"
import {
	DEFAULT_LEGEND_CONFIG,
	DEFAULT_TOOLTIP_CONFIG,
	type GradientBarStyle,
	type LegendSwatchShape,
	resolveGradientBarStyle,
} from "../../../lib/labelsConfig"
import { PatternTile } from "../../../lib/patternDefs"
import type { SegmentPatternContext } from "../../../lib/segmentPattern"
import { symbolPath } from "../../../lib/scales"
import {
	lineSwatchStrokeWidth,
	SWATCH_BOX_PAD,
	swatchGlyphBox,
} from "../../../lib/swatchBox"
import {
	currentRenderedGradientBarLengthAtom,
	currentTooltipConfigAtom,
	hoveredLegendEntryAtom,
} from "../../../store/atoms"

/** Wraps a single categorical legend entry so hovering it publishes
 * `{ field, value }` to `hoveredLegendEntryAtom` — the plot renderers read
 * that and highlight matching marks (the "hover over legend to highlight visual
 * elements" option). The wrapper also fades the OTHER legend entries to match
 * the marks when "Fade other elements" is on, so the legend and chart read as
 * one gesture. When `field` is undefined (feature off, or a quantitative/slot
 * section) it renders the entry untouched. */
export const EntryHoverWrap = ({
	field,
	value,
	children,
}: {
	field: string | undefined
	value: string
	children: React.ReactNode
}) => {
	const hovered = useAtomValue(hoveredLegendEntryAtom)
	const setHovered = useSetAtom(hoveredLegendEntryAtom)
	const cfg = { ...DEFAULT_TOOLTIP_CONFIG, ...useAtomValue(currentTooltipConfigAtom) }
	if (!field) return <>{children}</>
	const fadeOn = (cfg.hoverEnabled ?? true) && (cfg.hoverFade ?? true)
	const isThisHovered =
		hovered !== null && hovered.field === field && hovered.value === value
	// Fade this entry when SOMETHING else is hovered (in this legend or another
	// section) and fade is on — mirroring the marks' fade so the two agree.
	const faded = fadeOn && hovered !== null && !isThisHovered
	const fadedOpacity =
		1 - Math.min(Math.max(cfg.hoverFadeAmount ?? 0.85, 0), 1)
	return (
		<div
			onMouseEnter={() => setHovered({ field, value })}
			onMouseLeave={() => setHovered(null)}
			style={{
				opacity: faded ? fadedOpacity : 1,
				transition: "opacity 120ms ease",
			}}
		>
			{children}
		</div>
	)
}

/** Lay `groups` out as side-by-side flex columns. Each column hugs its own
 * content width (so columns can differ in width and sit close together), and
 * the gap between them is a NEGATIVE-capable `marginLeft` driven by the
 * `--vc-legend-col-gap` CSS variable the parent `Legend` sets from the user's
 * "Column gap" control (`margin` accepts negative values, unlike CSS
 * `column-gap`, which is why this uses flex rather than multi-column). Columns
 * keep `min-w-0` so their labels truncate gracefully only when the whole legend
 * is squeezed against its viewport cap. */
export const LegendColumns = ({
	groups,
	stackGapClass = "gap-1",
	rowList = true,
}: {
	groups: React.ReactNode[][]
	stackGapClass?: string
	/** The columns hold legend ENTRY rows (default) — their gap follows a
	 *  fixed "Legend height". `false` for columns of whole sections. */
	rowList?: boolean
}) => (
	<div className="flex flex-row items-start">
		{groups.map((group, ci) => (
			<div
				// eslint-disable-next-line react/no-array-index-key -- columns are positional chunks; never reordered
				key={ci}
				className={`flex min-w-0 flex-col ${stackGapClass}${rowList ? " vc-legend-rows" : ""}`}
				style={ci > 0 ? { marginLeft: "var(--vc-legend-col-gap, 24px)" } : undefined}
			>
				{group}
			</div>
		))}
	</div>
)

/** The column a legend entry's swatch graphic sits in. Sized by the
 * `--vc-legend-swatch-col` CSS variable (see `.vc-swatch-cell`), which the
 * legend publishes — as the widest swatch across ALL its sections — whenever
 * ≥2 sections stack vertically, so every section's swatches center on one
 * shared vertical axis and the labels line up. With the variable unset the
 * cell hugs its graphic (no visual change). `minWidth` lets a sub-legend keep
 * its own per-section column floor (e.g. area-sized swatches). A `div` (not a
 * `span`) so label queries that walk a legend's spans don't pick up the cell. */
export const SwatchCell = ({
	minWidth,
	children,
}: {
	minWidth?: number | null
	children: React.ReactNode
}) => (
	<div className="vc-swatch-cell" style={minWidth ? { minWidth } : undefined}>
		{children}
	</div>
)

/** Render a categorical entry list: a single stacked column normally, or
 * content-hugging flex columns when `cols > 1`. */
export const renderEntryList = (
	rows: React.ReactNode[],
	cols?: number,
): React.ReactElement =>
	cols && cols > 1 ? (
		<LegendColumns groups={chunkColumns(rows, cols)} />
	) : (
		<div className="vc-legend-rows flex flex-col gap-1">{rows}</div>
	)

/** Fallback style for callers (smoke tests prop-driving the sub-legends)
 * that don't thread the legend config's gradient-bar options through: the
 * built-in defaults, no theme. The real legend (`Legend.tsx`) always passes
 * the visual → theme → built-in resolution. */
export const DEFAULT_GRADIENT_BAR_STYLE: GradientBarStyle =
	resolveGradientBarStyle(DEFAULT_LEGEND_CONFIG, {})

export type GradientRampStop = {
	/** Proportional position along the bar, 0 (lo) → 1 (hi). */
	t: number
	color: string
	label: string
	key: number
}

/** The quantitative color legend's gradient strip: the bar itself, optional
 * tick marks at each break stop, and the break labels. Shared by the
 * hue-only combined section and ColorLegend so the two bar render paths can't
 * drift. Vertical bars run hi-on-top (`to top`) so reading top-to-bottom
 * matches a y-axis; horizontal bars run lo-on-left. */
export const GradientBarRamp = ({
	stops,
	cssStops,
	orientation,
	barStyle,
}: {
	stops: GradientRampStop[]
	/** Optional denser sampling for the CSS gradient only (see
	 * `sampleRampCssStops`); ticks/labels always render from `stops`. */
	cssStops?: { t: number; color: string }[]
	orientation: "vertical" | "horizontal"
	barStyle: GradientBarStyle
}) => {
	const {
		length,
		thickness,
		radius,
		tickLength,
		tickThickness,
		tickColor,
		borderWidth,
		borderColor,
	} = barStyle
	const hasTicks = tickLength > 0 && tickThickness > 0
	const isVertical = orientation === "vertical"
	// The border is drawn OUTSIDE the ramp: the bar's border-box grows
	// by `borderWidth` on every side, and the tick / label tracks inset by
	// the same amount so their 0% / 100% still line up with the gradient's
	// ends rather than the border's outer edge.
	const border =
		borderWidth > 0 ? { border: `${borderWidth}px solid ${borderColor}` } : undefined
	const inset = borderWidth
	// Publish the rendered RAMP length (px along the bar's axis, border
	// excluded — `client*` stops at the padding box) after every render so
	// the Legend panel's "Bar length" input can placeholder the auto size
	// and step from it ([[auto-input-step-from-displayed]]) instead of
	// jumping to 0 on the first spinner press. Last ramp wins when several
	// render — they share the legend's orientation + config, so their
	// lengths agree in practice.
	const barRef = useRef<HTMLDivElement | null>(null)
	const setRenderedLength = useSetAtom(currentRenderedGradientBarLengthAtom)
	useEffect(() => {
		const el = barRef.current
		if (!el) return
		const px = isVertical ? el.clientHeight : el.clientWidth
		if (px > 0) setRenderedLength(Math.round(px))
	})
	const gradientDirection = isVertical ? "to top" : "to right"
	const gradientCss = `linear-gradient(${gradientDirection}, ${(
		cssStops ?? stops
	)
		.map((s) => `${s.color} ${s.t * 100}%`)
		.join(", ")})`
	if (isVertical) {
		const align = barStyle.labelAlign ?? "left"
		// A fixed length pins the bar (and the label column tracking it);
		// auto keeps the historical stretch-with-siblings minimum.
		const sizing =
			length !== null
				? { height: `${length}px` }
				: { minHeight: "8rem" as const }
		// Bar outer size = ramp + border on each side (border-box).
		const barSizing =
			length !== null
				? { height: `${length + 2 * inset}px` }
				: { minHeight: `calc(8rem + ${2 * inset}px)` }
		// Tick + label tracks span only the ramp, not the border.
		const trackInset = { marginTop: inset, marginBottom: inset }
		return (
			<div className="flex flex-row items-stretch">
				<div
					ref={barRef}
					className="flex-shrink-0"
					style={{
						background: gradientCss,
						borderRadius: radius,
						width: thickness + 2 * inset,
						...barSizing,
						...border,
					}}
				/>
				{hasTicks && (
					<div
						className="relative flex-shrink-0"
						style={{ width: tickLength, ...trackInset }}
						aria-hidden="true"
					>
						{stops.map((s) => (
							<div
								key={s.key}
								className="absolute left-0"
								style={{
									bottom: `calc(${s.t * 100}% - ${tickThickness / 2}px)`,
									width: tickLength,
									height: tickThickness,
									background: tickColor,
								}}
							/>
						))}
					</div>
				)}
				<div className="relative ml-2 flex flex-col" style={{ ...sizing, ...trackInset }}>
					{/* Invisible zero-height in-flow copies give the column the
					 *  width of its widest label, so the absolutely-positioned
					 *  visible labels below can align (left/center/right) within
					 *  a real box instead of shrink-wrapping at the left edge. */}
					{stops.map((s) => (
						<div
							key={s.key}
							className="invisible h-0 overflow-hidden whitespace-nowrap"
							aria-hidden="true"
						>
							{s.label}
						</div>
					))}
					{/* Each label sits at its proportional break position,
					 *  measured from the BOTTOM (hi-on-top matches the `to top`
					 *  gradient). translate-y-1/2 drops the label by half its own
					 *  height so its vertical center lands exactly on the tick. */}
					{stops.map((s) => (
						<span
							key={s.key}
							className="absolute left-0 right-0 translate-y-1/2 whitespace-nowrap"
							style={{
								bottom: `${s.t * 100}%`,
								textAlign: align,
							}}
						>
							{s.label}
						</span>
					))}
				</div>
			</div>
		)
	}
	const align = barStyle.labelAlign ?? "center"
	// Anchor each label's left edge / center / right edge at its break stop.
	const labelTranslate =
		align === "left" ? "" : align === "right" ? "-translate-x-full" : "-translate-x-1/2"
	return (
		<div
			className={
				length !== null ? "flex flex-col" : "flex w-full min-w-32 flex-col"
			}
			// Fixed length is the RAMP's; the border adds to it on both ends
			// (auto stretches to the legend's width, ramp = width − 2·border).
			style={length !== null ? { width: `${length + 2 * inset}px` } : undefined}
		>
			<div
				ref={barRef}
				className="w-full"
				style={{
					background: gradientCss,
					borderRadius: radius,
					height: thickness + 2 * inset,
					...border,
				}}
			/>
			{hasTicks && (
				<div
					className="relative"
					style={{ height: tickLength, marginLeft: inset, marginRight: inset }}
					aria-hidden="true"
				>
					{stops.map((s) => (
						<div
							key={s.key}
							className="absolute top-0"
							style={{
								left: `calc(${s.t * 100}% - ${tickThickness / 2}px)`,
								width: tickThickness,
								height: tickLength,
								background: tickColor,
							}}
						/>
					))}
				</div>
			)}
			<div
				className="relative mt-1 h-5"
				style={{ marginLeft: inset, marginRight: inset }}
			>
				{stops.map((s) => (
					<span
						key={s.key}
						className={`absolute whitespace-nowrap ${labelTranslate}`}
						style={{ left: `${s.t * 100}%` }}
					>
						{s.label}
					</span>
				))}
			</div>
		</div>
	)
}

export const Swatch = ({
	color,
	strokeColor,
	strokeWidth,
	shape,
	size,
	children,
	horizontal,
	opacity = 1,
}: {
	color: string
	/** Optional border color drawn AROUND the fill. Set by area / radar
	 *  charts where the user has chosen a separate palette for the
	 *  line/outline so the legend can reflect "filled with X, outlined
	 *  with Y" at a glance. Omit (or pass null) for the default no-
	 *  border swatch. */
	strokeColor?: string | null
	/** Border width (px) for `strokeColor`. Defaults to 1.5 (the historical
	 *  split-outline width); the user's Swatch outline setting passes its own. */
	strokeWidth?: number | null
	/** Optional swatch glyph: a `SHAPE_PALETTE` index draws that symbol
	 *  (filled with `color`), `"line"` draws a short line segment, `null` keeps
	 *  the default rounded rectangle. */
	shape?: LegendSwatchShape
	/** Swatch size (px, radius-like). Defaults to 5. Symbol radius when
	 *  `shape` is set; scales the default rectangle proportionally otherwise. */
	size?: number | null
	children: React.ReactNode
	/** When true, render with no width-min / no truncate so the row's
	 * labels keep their natural width — used by horizontal legend rows
	 * where the parent container is `flex-nowrap`. */
	horizontal?: boolean
	/** Opacity applied to the swatch GRAPHIC only (never the label) so it can
	 *  match marks drawn at a reduced global opacity. Defaults to 1. */
	opacity?: number
}) => (
	<div
		className={
			horizontal
				? "vc-legend-hentry flex flex-shrink-0 items-center gap-1.5"
				: "flex items-center gap-2"
		}
	>
		<SwatchCell>
			{shape == null ? (
				<span
					className="block flex-shrink-0 rounded-sm"
					style={{
						// The size picker (radius-like, 5 = historical) scales the
						// default 16×12 rectangle so it isn't glyph-only.
						width: Math.round(16 * ((size ?? 5) / 5)),
						height: Math.round(12 * ((size ?? 5) / 5)),
						backgroundColor: color,
						opacity,
						...(strokeColor
							? {
									borderColor: strokeColor,
									borderStyle: "solid",
									borderWidth: strokeWidth ?? 1.5,
								}
							: undefined),
					}}
				/>
			) : (
				(() => {
					const r = size ?? 5
					const side = swatchGlyphBox(
						shape,
						r,
						strokeColor ? (strokeWidth ?? 1.5) : 0,
					)
					return (
						<svg
							width={side}
							height={side}
							viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
							aria-hidden="true"
							className="flex-shrink-0"
							opacity={opacity}
						>
							{shape === "line" ? (
								<line
									x1={-r}
									y1={0}
									x2={r}
									y2={0}
									stroke={color}
									strokeWidth={lineSwatchStrokeWidth(r)}
									strokeLinecap="round"
								/>
							) : (
								<path
									d={symbolPath(shape, r)}
									fill={color}
									stroke={strokeColor ?? undefined}
									strokeWidth={strokeColor ? (strokeWidth ?? 1.5) : undefined}
								/>
							)}
						</svg>
					)
				})()
			)}
		</SwatchCell>
		<span
			className={
				horizontal
					? "vc-legend-label whitespace-nowrap"
					: "min-w-0 truncate"
			}
			title={String(children)}
		>
			{children}
		</span>
	</div>
)

/** A legend swatch standing for a scatter LINE SEGMENT (Length / Angle
 *  marks): a short stroke at the chart's segment thickness and cap. In
 *  pattern FILL mode the stroke paint is the pattern tile (`patternId`); in
 *  DASH mode it carries `dashArray` over a `gapColor` underlay ("Fill dash
 *  gaps"), exactly as `renderMarkPaths` draws the marks. */
export type SegmentSwatchSpec = Pick<SegmentPatternContext, "thickness" | "cap"> & {
	dashArray: string | null
	gapColor: string | null
}

/** Box of a segment swatch — mirrors `LengthLegend`'s sizing: the height
 *  grows with the stroke so thick segments aren't clipped, and round caps
 *  (which reach half a stroke past each endpoint) inset the line. */
export const segmentSwatchBox = (
	thickness: number,
	cap: "round" | "butt",
): { w: number; h: number; pad: number } => {
	const pad = cap === "round" ? Math.max(2, thickness / 2) : 2
	return {
		w: Math.ceil(SEGMENT_SWATCH_LENGTH + pad * 2),
		h: Math.max(8, Math.ceil(thickness) + 2),
		pad,
	}
}
const SEGMENT_SWATCH_LENGTH = 20

/** The `<svg>` of a segment swatch. `stroke` is the segment's paint — a
 *  color, or `url(#…)` for a pattern tile whose `<pattern>` the caller
 *  places in `defs`. */
export const SegmentSwatchLine = ({
	segment,
	stroke,
	opacity = 1,
	defs,
}: {
	segment: SegmentSwatchSpec
	stroke: string
	opacity?: number
	defs?: React.ReactNode
}) => {
	const { w, h, pad } = segmentSwatchBox(segment.thickness, segment.cap)
	const cy = h / 2
	const line = { x1: pad, y1: cy, x2: w - pad, y2: cy }
	const strokeProps = {
		strokeWidth: segment.thickness,
		strokeLinecap: segment.cap,
	}
	return (
		<svg
			width={w}
			height={h}
			viewBox={`0 0 ${w} ${h}`}
			aria-hidden="true"
			className="flex-shrink-0"
			style={{ opacity }}
		>
			{defs && <defs>{defs}</defs>}
			{segment.gapColor !== null && segment.dashArray !== null && (
				<line {...line} stroke={segment.gapColor} {...strokeProps} />
			)}
			<line
				{...line}
				stroke={stroke}
				strokeDasharray={segment.dashArray ?? undefined}
				{...strokeProps}
			/>
		</svg>
	)
}

/** Swatch that composes color, opacity, optional pattern overlay, and an
 * optional shape glyph — mirrors what a mark/slice looks like in the chart.
 * Used by the combined group legend when 2+ group encodings share the same
 * field. When `shape` is provided, the swatch draws the symbol path
 * (colored by the hue) instead of a rectangle, so that hue+shape on the
 * same field collapses into one row per category. `shapeFill === "none"`
 * routes through to render an outline-only glyph. */
export type ComposedSwatchProps = {
	color: string
	opacity: number
	/** Pattern overlay for the swatch. `scale` is the tile zoom (the
	 *  category's Scale pick, ×1 when absent) — the legend tiles at the same
	 *  zoom as the marks. */
	pattern: {
		bg: string
		ink: string
		paletteIdx: number
		svgId: string
		scale?: number
	} | null
	shape?: {
		idx: number
		/** Resolved glyph for `idx` (built-in symbol OR the chart's custom
		 * text / image glyph). Callers with access to the chart's
		 * `shape.customGlyphs` pass this so custom shapes show in the
		 * swatch; when absent the swatch draws the built-in symbol at
		 * `idx`. */
		glyph?: ResolvedGlyph
		fill: string // "none" or a color
		stroke: string
		/** Glyph outline width (px). Defaults to 1. */
		strokeWidth?: number
		/** Glyph radius (px). Defaults to 5. Set by synthesized outline-only
		 *  swatches so the user's swatch-size choice applies. */
		size?: number
		/** Draw a line segment instead of the symbol glyph (the "line" swatch
		 *  shape), stroked in `stroke`. */
		line?: boolean
	}
	/** When set, draws a horizontal line segment across the swatch with
	 *  the given SVG stroke-dasharray. Used to show line-chart dash
	 *  patterns alongside the shape pattern in a combined legend. `null`
	 *  for the array means solid. */
	dash?: { strokeDashArray: string | null; stroke: string } | null
	/** Scatter line segments (Length / Angle marks, no connection): the
	 *  swatch is a stroke at the chart's segment thickness, painted with the
	 *  pattern tile (`pattern` set) or dashed (`dashArray`), like the marks.
	 *  Wins over every other route. */
	segment?: SegmentSwatchSpec | null
	/** Hue-legend swatch shape (a `SHAPE_PALETTE` index). When set — and no
	 *  per-mark `shape` encoding is present — the otherwise-rectangular
	 *  swatch is drawn as this symbol, filled with the swatch color (or
	 *  pattern overlay). `null` / undefined keeps the rectangle. */
	swatchShape?: LegendSwatchShape
	/** Swatch size (px, radius-like). Defaults to 5. Symbol radius for the
	 *  `swatchShape` glyph; scales the default / pattern rectangle otherwise. */
	swatchSize?: number | null
	/** Border color drawn around the swatch — the area/radar line color when it
	 *  differs from the fill. `null` / undefined → no border. */
	outlineStroke?: string | null
	/** Border width (px) for `outlineStroke`. Defaults to 1.5 (the historical
	 *  split-outline width); the user's Swatch outline setting passes its own. */
	outlineWidth?: number | null
}

/** The point glyph the line-chart (dash) swatch draws behind its dashed
 *  line: the encoded shape when a shape channel is mapped, else the hue
 *  swatch shape, else a circle (a "line" swatch shape has no point form). */
const dashPointGlyph = ({
	shape,
	swatchShape,
}: Pick<ComposedSwatchProps, "shape" | "swatchShape">): ResolvedGlyph =>
	shape?.glyph ?? {
		kind: "symbol",
		idx: shape?.idx ?? (typeof swatchShape === "number" ? swatchShape : 0),
	}

/** Rendered box (px) of a `ComposedSwatch` — the one sizing rule for every
 *  route it draws, so a stacked entry list can reserve a column as wide as
 *  its widest swatch (`swatchColumnWidth`) when entries differ. Glyph boxes
 *  follow `swatchGlyphBox`, which grows past the historical `(r + 3) * 2`
 *  only when a pointed symbol or a thick outline would otherwise be cut
 *  off; the default rectangle scales 18×12 by r/5. */
export const composedSwatchSize = (
	props: ComposedSwatchProps,
): { w: number; h: number } => {
	const { shape, dash, swatchShape, swatchSize, outlineStroke, outlineWidth } =
		props
	if (props.segment) {
		const { w, h } = segmentSwatchBox(props.segment.thickness, props.segment.cap)
		return { w, h }
	}
	if (dash) {
		// Glyph radius honors the user's swatch-size choice — `shape.size` when
		// a shape channel is mapped, otherwise the hue swatch-size picker. 4.5
		// stays the baseline so existing line charts don't shift.
		const r = shape?.size ?? swatchSize ?? 4.5
		// The "line" swatch shape (or a synthesized line descriptor) reads as a
		// pure dashed stroke — no point glyph behind it to make room for.
		const showGlyph = swatchShape !== "line" && !shape?.line
		const box = showGlyph
			? swatchGlyphBox(dashPointGlyph(props), r, 1)
			: (r + SWATCH_BOX_PAD) * 2
		// Keep extra horizontal room so the dashed line still reads as a line
		// beside larger symbols.
		return { w: Math.max(22, box + 8), h: Math.max(14, box) }
	}
	if (shape) {
		// 16px floor keeps the default look unchanged.
		const r = shape.size ?? 5
		const side = Math.max(
			16,
			swatchGlyphBox(
				shape.line ? "line" : (shape.glyph ?? shape.idx),
				r,
				shape.strokeWidth ?? 1,
			),
		)
		return { w: side, h: side }
	}
	if (swatchShape != null) {
		const r = swatchSize ?? 5
		const side = swatchGlyphBox(
			swatchShape,
			r,
			outlineStroke ? (outlineWidth ?? 1.5) : 0,
		)
		return { w: side, h: side }
	}
	// Default-rectangle dimensions. The swatch-size picker (radius-like, 5 =
	// historical) scales them proportionally so the rectangle honors the size
	// control just like the shaped glyphs do.
	const rectScale = (swatchSize ?? 5) / 5
	return { w: Math.round(18 * rectScale), h: Math.round(12 * rectScale) }
}

/** Column width (px) a stacked entry list reserves for its swatches so the
 *  labels align: the widest swatch when the swatches differ in width (area-
 *  sized glyphs, a shape channel mixing a star with a circle), else `null`
 *  — the cells hug their graphic as before. */
export const swatchColumnWidth = (
	sizes: ReadonlyArray<{ w: number }>,
): number | null => {
	const widths = sizes.map((s) => s.w)
	return new Set(widths).size > 1 ? (max(widths) as number) : null
}

export const ComposedSwatch = (props: ComposedSwatchProps) => {
	const {
		color,
		opacity,
		pattern,
		shape,
		dash,
		swatchShape,
		swatchSize,
		outlineStroke,
		outlineWidth,
	} = props
	const { w, h } = composedSwatchSize(props)
	// Segment scatter: the swatch IS a segment — pattern tile as the stroke
	// paint, or the dash — see `SegmentSwatchLine`.
	if (props.segment) {
		const patId = pattern ? `legend-combined-${pattern.svgId}` : null
		return (
			<SegmentSwatchLine
				segment={props.segment}
				stroke={patId ? `url(#${patId})` : color}
				opacity={opacity}
				defs={
					pattern && patId ? (
						<PatternTile
							id={patId}
							paletteIdx={pattern.paletteIdx}
							bgColor={pattern.bg}
							inkColor={pattern.ink}
							scale={pattern.scale}
						/>
					) : undefined
				}
			/>
		)
	}
	// Line chart context: mirror the rendered visual — dash line passing
	// behind a (patterned) point. Shape uses the encoded shape index when
	// available, otherwise defaults to a circle. Pattern fills the shape.
	if (dash) {
		// Glyph radius honors the user's swatch-size choice — `shape.size` when
		// a shape channel is mapped, otherwise the hue swatch-size picker. 4.5
		// stays the baseline so existing line charts don't shift.
		const r = shape?.size ?? swatchSize ?? 4.5
		const lw = w
		const lh = h
		const cx = lw / 2
		const cy = lh / 2
		// The "line" swatch shape (or a synthesized line descriptor) reads as a
		// pure dashed stroke — skip the point glyph behind it.
		const showGlyph = swatchShape !== "line" && !shape?.line
		const pointGlyph = dashPointGlyph(props)
		const patId = pattern ? `legend-combined-${pattern.svgId}` : null
		const shapeFill = pattern
			? `url(#${patId})`
			: (shape?.fill ?? color)
		// The point glyph keeps an encoded stroke (shape / outline
		// descriptor); otherwise the section's Outline color / width when it
		// draws one, else the historical 1px self-colored edge.
		const shapeStroke = shape?.stroke ?? outlineStroke ?? color
		const shapeStrokeWidth =
			shape?.strokeWidth ?? (shape ? 1 : outlineStroke ? (outlineWidth ?? 1.5) : 1)
		return (
			<svg
				width={lw}
				height={lh}
				viewBox={`0 0 ${lw} ${lh}`}
				className="flex-shrink-0"
				style={{ opacity }}
				aria-hidden="true"
			>
				{pattern && patId && (
					<defs>
						<PatternTile
							id={patId}
							paletteIdx={pattern.paletteIdx}
							bgColor={pattern.bg}
							inkColor={pattern.ink}
							scale={pattern.scale}
						/>
					</defs>
				)}
				<line
					x1={0}
					y1={cy}
					x2={lw}
					y2={cy}
					stroke={dash.stroke}
					strokeWidth={1.5}
					strokeLinecap="butt"
					strokeDasharray={dash.strokeDashArray ?? undefined}
				/>
				{showGlyph && (
					<g transform={`translate(${cx}, ${cy})`}>
						<GlyphMark
							// Swatches render centered — strip any creation-time nudge.
							glyph={stripNudge(pointGlyph)}
							r={r}
							fill={shapeFill}
							fillOpacity={shape?.fill === "none" && !pattern ? 0 : 1}
							stroke={shapeStroke}
							strokeWidth={shapeStrokeWidth}
						/>
					</g>
				)}
			</svg>
		)
	}
	if (shape) {
		// Shape route: emit the symbol path filled with hue color (or
		// outlined-only when fill === "none"). A pattern sharing the section
		// tiles the glyph's fill, as it tiles the marks. Synthesized outline
		// swatches may carry a `size` (from the swatch-size picker) and a
		// `line` flag (the "line" swatch shape).
		const r = shape.size ?? 5
		const side = w
		const patId =
			pattern && shape.fill !== "none" ? `legend-combined-${pattern.svgId}` : null
		return (
			<svg
				width={side}
				height={side}
				viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
				aria-hidden="true"
				className="flex-shrink-0"
				style={{ opacity }}
			>
				{pattern && patId && (
					<defs>
						<PatternTile
							id={patId}
							paletteIdx={pattern.paletteIdx}
							bgColor={pattern.bg}
							inkColor={pattern.ink}
							scale={pattern.scale}
						/>
					</defs>
				)}
				{shape.line ? (
					<line
						x1={-r}
						y1={0}
						x2={r}
						y2={0}
						stroke={shape.stroke}
						strokeWidth={lineSwatchStrokeWidth(r)}
						strokeLinecap="round"
					/>
				) : (
					<GlyphMark
						glyph={stripNudge(
							shape.glyph ?? { kind: "symbol", idx: shape.idx }
						)}
						r={r}
						fill={patId ? `url(#${patId})` : shape.fill}
						fillOpacity={shape.fill === "none" ? 0 : 1}
						stroke={shape.stroke}
						strokeWidth={shape.strokeWidth ?? 1}
					/>
				)}
			</svg>
		)
	}
	if (swatchShape != null) {
		// Hue-legend swatch shape: no per-mark shape encoding, but the user
		// picked a glyph for the color swatches. Draw the symbol filled with
		// the swatch color — or a pattern overlay when a pattern channel
		// shares the field, so the composed visual is preserved.
		const patId = pattern ? `legend-combined-${pattern.svgId}` : null
		const fill = pattern && patId ? `url(#${patId})` : color
		const r = swatchSize ?? 5
		const side = w
		return (
			<svg
				width={side}
				height={side}
				viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
				aria-hidden="true"
				className="flex-shrink-0"
				style={{ opacity }}
			>
				{pattern && patId && (
					<defs>
						<PatternTile
							id={patId}
							paletteIdx={pattern.paletteIdx}
							bgColor={pattern.bg}
							inkColor={pattern.ink}
							scale={pattern.scale}
						/>
					</defs>
				)}
				{swatchShape === "line" ? (
					<line
						x1={-r}
						y1={0}
						x2={r}
						y2={0}
						stroke={pattern ? color : (outlineStroke ?? color)}
						strokeWidth={lineSwatchStrokeWidth(r)}
						strokeLinecap="round"
					/>
				) : (
					<path
						d={symbolPath(swatchShape, r)}
						fill={fill}
						stroke={outlineStroke ?? undefined}
						strokeWidth={outlineStroke ? (outlineWidth ?? 1.5) : undefined}
					/>
				)}
			</svg>
		)
	}
	if (pattern) {
		const patId = `legend-combined-${pattern.svgId}`
		return (
			<svg
				width={w}
				height={h}
				className="flex-shrink-0 rounded-sm"
				style={{ opacity }}
				aria-hidden="true"
			>
				<defs>
					<PatternTile
						id={patId}
						paletteIdx={pattern.paletteIdx}
						bgColor={pattern.bg}
						inkColor={pattern.ink}
						scale={pattern.scale}
					/>
				</defs>
				<rect
					width={w}
					height={h}
					fill={`url(#${patId})`}
					stroke={outlineStroke ?? undefined}
					strokeWidth={outlineStroke ? (outlineWidth ?? 1.5) : undefined}
				/>
			</svg>
		)
	}
	return (
		<span
			className="block flex-shrink-0 rounded-sm"
			style={{
				width: w,
				height: h,
				backgroundColor: color,
				opacity,
				...(outlineStroke
					? {
							borderColor: outlineStroke,
							borderStyle: "solid",
							borderWidth: outlineWidth ?? 1.5,
						}
					: undefined),
			}}
		/>
	)
}
