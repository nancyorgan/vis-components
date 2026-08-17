import { useEffect, useRef } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { GlyphMark, type ResolvedGlyph } from "../../../lib/customGlyphs"
import { chunkColumns } from "../../../lib/legendSections"
import {
	DEFAULT_LEGEND_CONFIG,
	DEFAULT_TOOLTIP_CONFIG,
	type GradientBarStyle,
	type LegendSwatchShape,
	resolveGradientBarStyle,
} from "../../../lib/labelsConfig"
import { PATTERN_PALETTE } from "../../../lib/patterns"
import { symbolPath } from "../../../lib/scales"
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
}: {
	groups: React.ReactNode[][]
	stackGapClass?: string
}) => (
	<div className="flex flex-row items-start">
		{groups.map((group, ci) => (
			<div
				// eslint-disable-next-line react/no-array-index-key -- columns are positional chunks; never reordered
				key={ci}
				className={`flex min-w-0 flex-col ${stackGapClass}`}
				style={ci > 0 ? { marginLeft: "var(--vc-legend-col-gap, 24px)" } : undefined}
			>
				{group}
			</div>
		))}
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
		<div className="flex flex-col gap-1">{rows}</div>
	)

/** Fallback style for callers (smoke tests prop-driving the sub-legends)
 * that don't thread the legend config's gradient-bar options through. */
export const DEFAULT_GRADIENT_BAR_STYLE: GradientBarStyle =
	resolveGradientBarStyle(DEFAULT_LEGEND_CONFIG)

export type GradientRampStop = {
	/** Proportional position along the bar, 0 (lo) → 1 (hi). */
	t: number
	color: string
	label: string
	key: number
}

/** The quantitative color legend's gradient strip: the bar itself, optional
 * tick marks at each break stop, and the break labels. Shared by the
 * hue-only combined section and HueLegend so the two bar render paths can't
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
	const { length, radius, tickLength, tickThickness, tickColor } = barStyle
	const hasTicks = tickLength > 0 && tickThickness > 0
	const isVertical = orientation === "vertical"
	// Publish the rendered length (px along the bar's axis) after every
	// render so the Legend panel's "Bar length" input can placeholder the
	// auto size and step from it ([[auto-input-step-from-displayed]])
	// instead of jumping to 0 on the first spinner press. Last ramp wins
	// when several render — they share the legend's orientation + config,
	// so their lengths agree in practice.
	const barRef = useRef<HTMLDivElement | null>(null)
	const setRenderedLength = useSetAtom(currentRenderedGradientBarLengthAtom)
	useEffect(() => {
		const el = barRef.current
		if (!el) return
		const px = isVertical ? el.offsetHeight : el.offsetWidth
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
		return (
			<div className="flex flex-row items-stretch">
				<div
					ref={barRef}
					className="w-3 flex-shrink-0"
					style={{ background: gradientCss, borderRadius: radius, ...sizing }}
				/>
				{hasTicks && (
					<div
						className="relative flex-shrink-0"
						style={{ width: tickLength }}
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
				<div className="relative ml-2 flex flex-col" style={sizing}>
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
			style={length !== null ? { width: `${length}px` } : undefined}
		>
			<div
				ref={barRef}
				className="h-3 w-full"
				style={{ background: gradientCss, borderRadius: radius }}
			/>
			{hasTicks && (
				<div
					className="relative w-full"
					style={{ height: tickLength }}
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
			<div className="relative mt-1 h-5 w-full">
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
				? "flex flex-shrink-0 items-center gap-1.5"
				: "flex items-center gap-2"
		}
	>
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
				const side = (r + 3) * 2
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
								strokeWidth={Math.max(2, Math.round(r / 2))}
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
		<span
			className={
				horizontal ? "whitespace-nowrap" : "min-w-0 truncate"
			}
			title={String(children)}
		>
			{children}
		</span>
	</div>
)

/** Swatch that composes color, opacity, optional pattern overlay, and an
 * optional shape glyph — mirrors what a mark/slice looks like in the chart.
 * Used by the combined group legend when 2+ group encodings share the same
 * field. When `shape` is provided, the swatch draws the symbol path
 * (colored by the hue) instead of a rectangle, so that hue+shape on the
 * same field collapses into one row per category. `shapeFill === "none"`
 * routes through to render an outline-only glyph. */
export const ComposedSwatch = ({
	color,
	opacity,
	pattern,
	shape,
	dash,
	swatchShape,
	swatchSize,
	outlineStroke,
	outlineWidth,
}: {
	color: string
	opacity: number
	pattern: { bg: string; ink: string; paletteIdx: number; svgId: string } | null
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
}) => {
	// Default-rectangle dimensions. The swatch-size picker (radius-like, 5 =
	// historical) scales them proportionally so the rectangle honors the size
	// control just like the shaped glyphs do.
	const rectScale = (swatchSize ?? 5) / 5
	const w = Math.round(18 * rectScale)
	const h = Math.round(12 * rectScale)
	// Line chart context: mirror the rendered visual — dash line passing
	// behind a (patterned) point. Shape uses the encoded shape index when
	// available, otherwise defaults to a circle. Pattern fills the shape.
	if (dash) {
		// Glyph radius honors the user's swatch-size choice — `shape.size` when
		// a shape channel is mapped, otherwise the hue swatch-size picker. 4.5
		// stays the baseline so existing line charts don't shift.
		const r = shape?.size ?? swatchSize ?? 4.5
		// Grow the swatch box with the glyph; keep extra horizontal room so the
		// dashed line still reads as a line beside larger symbols.
		const lh = Math.max(14, (r + 3) * 2)
		const lw = Math.max(22, (r + 3) * 2 + 8)
		const cx = lw / 2
		const cy = lh / 2
		// The "line" swatch shape (or a synthesized line descriptor) reads as a
		// pure dashed stroke — skip the point glyph behind it.
		const showGlyph = swatchShape !== "line" && !shape?.line
		// The dash (line-chart) context draws a point glyph behind the line; a
		// "line" swatch shape has no point form here, so fall back to a circle.
		const shapeIdx =
			shape?.idx ?? (typeof swatchShape === "number" ? swatchShape : 0)
		const pointGlyph: ResolvedGlyph =
			shape?.glyph ?? { kind: "symbol", idx: shapeIdx }
		const def = pattern
			? PATTERN_PALETTE[pattern.paletteIdx % PATTERN_PALETTE.length]
			: null
		const patId = pattern ? `legend-combined-${pattern.svgId}` : null
		const shapeFill = pattern
			? `url(#${patId})`
			: (shape?.fill ?? color)
		const shapeStroke = shape?.stroke ?? color
		return (
			<svg
				width={lw}
				height={lh}
				viewBox={`0 0 ${lw} ${lh}`}
				className="flex-shrink-0"
				style={{ opacity }}
				aria-hidden="true"
			>
				{pattern && def && patId && (
					<defs>
						<pattern
							id={patId}
							patternUnits="userSpaceOnUse"
							width={def.size}
							height={def.size}
						>
							<rect
								width={def.size}
								height={def.size}
								fill={pattern.bg}
							/>
							{def.render(pattern.ink)}
						</pattern>
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
							glyph={pointGlyph}
							r={r}
							fill={shapeFill}
							fillOpacity={shape?.fill === "none" && !pattern ? 0 : 1}
							stroke={shapeStroke}
							strokeWidth={1}
						/>
					</g>
				)}
			</svg>
		)
	}
	if (shape) {
		// Shape route: emit the symbol path filled with hue color (or
		// outlined-only when fill === "none"). Pattern overlay still
		// applies as a fill via `<defs>` if present, but the simpler
		// path here covers the user-reported case (hue + shape on same
		// field). Synthesized outline swatches may carry a `size` (from the
		// swatch-size picker) and a `line` flag (the "line" swatch shape).
		const r = shape.size ?? 5
		const side = Math.max(16, (r + 3) * 2)
		return (
			<svg
				width={side}
				height={side}
				viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
				aria-hidden="true"
				className="flex-shrink-0"
				style={{ opacity }}
			>
				{shape.line ? (
					<line
						x1={-r}
						y1={0}
						x2={r}
						y2={0}
						stroke={shape.stroke}
						strokeWidth={Math.max(2, Math.round(r / 2))}
						strokeLinecap="round"
					/>
				) : (
					<GlyphMark
						glyph={shape.glyph ?? { kind: "symbol", idx: shape.idx }}
						r={r}
						fill={shape.fill}
						fillOpacity={shape.fill === "none" ? 0 : 1}
						stroke={shape.stroke}
						strokeWidth={1}
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
		const def = pattern
			? PATTERN_PALETTE[pattern.paletteIdx % PATTERN_PALETTE.length]
			: null
		const patId = pattern ? `legend-combined-${pattern.svgId}` : null
		const fill = pattern && patId ? `url(#${patId})` : color
		const r = swatchSize ?? 5
		const side = (r + 3) * 2
		return (
			<svg
				width={side}
				height={side}
				viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`}
				aria-hidden="true"
				className="flex-shrink-0"
				style={{ opacity }}
			>
				{pattern && def && patId && (
					<defs>
						<pattern
							id={patId}
							patternUnits="userSpaceOnUse"
							width={def.size}
							height={def.size}
						>
							<rect width={def.size} height={def.size} fill={pattern.bg} />
							{def.render(pattern.ink)}
						</pattern>
					</defs>
				)}
				{swatchShape === "line" ? (
					<line
						x1={-r}
						y1={0}
						x2={r}
						y2={0}
						stroke={pattern ? color : (outlineStroke ?? color)}
						strokeWidth={Math.max(2, Math.round(r / 2))}
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
		const def = PATTERN_PALETTE[pattern.paletteIdx % PATTERN_PALETTE.length]
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
					<pattern
						id={patId}
						patternUnits="userSpaceOnUse"
						width={def.size}
						height={def.size}
					>
						<rect width={def.size} height={def.size} fill={pattern.bg} />
						{def.render(pattern.ink)}
					</pattern>
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
