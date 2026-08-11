import type { scaleBand, scaleLinear, scalePoint, scaleTime } from "d3-scale"
import { autoLabelAngleFor } from "../../lib/autoLabelAngle"
import {
	DEFAULT_GRIDLINE_CONFIG,
	DEFAULT_SPINE_CONFIG,
	DEFAULT_TICKMARK_CONFIG,
	type AxisConfig,
} from "../../lib/channelConfig"
import { ptToPx, resolveTickFontSizePx } from "../../lib/fontUnit"
import { estimateLongestLineWidth } from "../../lib/estimateMargins"
import { buildTickFormatter } from "../../lib/formatTick"
import {
	textAnchorFromAlignment,
	type FontConfig,
	type LabelAlignment,
	type TextFontConfig,
} from "../../lib/labelsConfig"
import { renderMultilineTspans } from "../../lib/multilineText"
import {
	renderWrappedTickLabel,
	TICK_WRAP_SLOT_FRACTION,
	tickWrapMaxPx,
	wrapTickLabel,
} from "../../lib/tickLabelWrap"
import type { PositionScale } from "../../lib/scales"
import type { FieldType } from "../../lib/types"

type Props = {
	scale: PositionScale
	orientation: "x" | "y"
	inner: { x0: number; y0: number; x1: number; y1: number }
	label: string
	config?: AxisConfig
	fieldType: FieldType
	/**
	 * The largest tick count that is "meaningful" given the underlying data
	 * granularity — requested tick counts above this are clamped, since more
	 * ticks would fall at increments finer than the data supports.
	 */
	maxMeaningfulTicks?: number
	/** Font applied to tick labels. */
	tickFont?: TextFontConfig
	/** Font applied to the axis title (usually the field name). */
	titleFont?: FontConfig
	/** When `false`, skip ticks, tick labels, and title — render only the
	 * spine and gridlines. Used by facet panels with shared axes, so
	 * interior panels keep their grid intact without duplicating axis
	 * decorations. The spine deliberately survives this flag because the
	 * user-configured spine color/thickness is a visual frame for each
	 * panel, not part of the "tick decoration" the shared axis replaces.
	 * Set `spine.thickness = 0` to hide the spine entirely. */
	showTicksAndLabels?: boolean
	/** Which layer of the axis to draw. "back" = gridlines only (drawn under
	 * marks). "front" = spine + ticks + labels + title (drawn over marks, so
	 * mark outlines don't poke through the spine). "full" (default) = both
	 * in the original single-pass order. */
	layer?: "back" | "front" | "full"
	/** Horizontal alignment for the axis title. Defaults to "center"
	 * (centered along the axis). */
	titleAlignment?: LabelAlignment
	/** When true, the y-axis title is drawn upright (0°) sitting to the
	 * left of the spine. Ignored on x-axes. */
	yTitleHorizontal?: boolean
	/** When false, suppress the axis title only (still draw spine + ticks).
	 * Used by faceted panels so a single shared title can be drawn outside
	 * the panel grid. Defaults to true. */
	showTitle?: boolean
}

const DEFAULT_TICK_COUNT = 5

export const Axis = ({
	scale,
	orientation,
	inner,
	label,
	config,
	fieldType,
	maxMeaningfulTicks = Infinity,
	tickFont,
	titleFont,
	showTicksAndLabels = true,
	layer = "full",
	titleAlignment = "center",
	yTitleHorizontal = false,
	showTitle = true,
}: Props) => {
	const drawBack = layer !== "front"
	const drawFront = layer !== "back" && showTicksAndLabels
	// Tick STROKES draw in the back pass (with the gridlines) so points or
	// shapes that overlap the axis paint on top of them rather than the ticks
	// poking through the marks. Tick LABELS and the title stay in the front
	// pass below. Gated on `showTicksAndLabels` like the labels so faceted
	// inner panels (spine-only) still suppress their tick strokes.
	const drawTickMarks = drawBack && showTicksAndLabels
	// Per-axis tick-label font override layered over the global Text encoding
	// font. Each field falls through to `tickFont` when the user hasn't set
	// it. `color` resolves through the legacy `tickLabelColor` for back-compat
	// with visuals saved before the fuller `tickLabelFont` override existed.
	const tickLabelFont = config?.tickLabelFont
	// Override sizes are pt (raw config); `tickFont.size` arrives already
	// resolved to px. The shared helper owns that unit split; the trailing
	// fallback (no tickFont prop — standalone mounts only) is the base text
	// default in px.
	const tickFontSize = resolveTickFontSizePx(
		tickLabelFont?.size,
		tickFont?.size ?? ptToPx(12)
	)
	const tickFamily = tickLabelFont?.family ?? tickFont?.family
	const tickFill =
		tickLabelFont?.color ?? config?.tickLabelColor ?? tickFont?.color
	const tickFontWeight = tickLabelFont?.weight ?? tickFont?.weight
	const tickItalic = tickLabelFont?.italic ?? tickFont?.italic
	const tickUnderline = tickLabelFont?.underline ?? tickFont?.underline
	const tickFontStyle = tickItalic ? ("italic" as const) : undefined
	const tickDecoration = tickUnderline ? ("underline" as const) : undefined
	// `titleFont` arrives resolved (px); the fallback mirrors the secondary
	// title default for standalone mounts.
	const titleFontSize = titleFont?.size ?? ptToPx(13)
	const titleFill = titleFont?.color
	const titleFamily = titleFont?.family
	const titleFontWeight = titleFont?.weight ?? 500
	const titleFontStyle = titleFont?.italic ? ("italic" as const) : undefined
	const titleDecoration = titleFont?.underline ? ("underline" as const) : undefined
	const isX = orientation === "x"
	const axisLine = isX
		? { x1: inner.x0, y1: inner.y1, x2: inner.x1, y2: inner.y1 }
		: { x1: inner.x0, y1: inner.y0, x2: inner.x0, y2: inner.y1 }
	// "Adjust position" nudge — shifts the spine + ticks + labels + title,
	// WITHOUT moving the gridlines (which stay pinned to their data
	// positions). Stored in screen coords (+x right, +y down). The legacy
	// single `offset` was perpendicular-only (x-axis: positive = down, y-axis:
	// positive = left); it's folded in only while the new fields are unset —
	// the panel clears it on the first write of offsetX/offsetY.
	const legacyOffset = config?.offset ?? 0
	const axisDx = config?.offsetX ?? (isX ? 0 : -legacyOffset)
	const axisDy = config?.offsetY ?? (isX ? legacyOffset : 0)
	const offsetTransform =
		axisDx === 0 && axisDy === 0
			? undefined
			: `translate(${axisDx},${axisDy})`

	const requestedCount = config?.tickCount ?? DEFAULT_TICK_COUNT
	// Clamp to 0..maxMeaningfulTicks. `tickCount: 0` is a valid request that
	// means "no ticks at all" — the user can use it to suppress tickmarks /
	// labels on a quantitative axis when the spine alone is sufficient (or
	// when data labels cover the axis labeling).
	const tickCount = Math.max(0, Math.min(requestedCount, maxMeaningfulTicks))
	const customFmt = config ? buildTickFormatter(config, fieldType) : null

	// A continuous (quantitative / temporal) scale exposes `.ticks()`;
	// categorical scalePoint / scaleBand don't.
	const isContinuousScale =
		typeof (scale as unknown as { ticks?: unknown }).ticks === "function"
	// Resolve user-pinned break positions on a continuous axis. Stored as
	// plain numbers — axis values, or epoch-ms for temporal. We drop any
	// break outside the resolved domain (a pinned min/max may have tightened
	// it), de-dup, sort, and convert to the scale's input type (Date for
	// temporal). `null` when the user hasn't set breaks or the axis is
	// categorical.
	const resolveBreaks = (raw: number[] | undefined): unknown[] | null => {
		if (!isContinuousScale || !raw || raw.length === 0) return null
		const dom = (scale as unknown as { domain: () => unknown[] }).domain()
		const toNum = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v))
		const d0 = toNum(dom[0])
		const d1 = toNum(dom[dom.length - 1])
		const lo = Math.min(d0, d1)
		const hi = Math.max(d0, d1)
		const within = [...new Set(raw.filter((b) => b >= lo && b <= hi))].sort(
			(a, b) => a - b
		)
		if (within.length === 0) return null
		return within.map((b) => (fieldType === "temporal" ? new Date(b) : b))
	}
	// Tick positions from the Ticks section's "Custom breaks" box — extra
	// pinned ticks ADDED to the auto `tickCount` layout (Count 0 + breaks =
	// fully custom ticks). Labels simply follow the ticks.
	const customBreaks = resolveBreaks(config?.breaks)

	const ticks: Array<{ pos: number; label: string }> = (() => {
		const s = scale as unknown as {
			ticks?: (count: number) => unknown[]
			tickFormat?: (count: number) => (v: unknown) => string
			domain: () => unknown[]
			bandwidth?: () => number
		}
		if (typeof s.ticks === "function") {
			// `tickCount: 0` is a valid "no automatic ticks" request — custom
			// breaks (if any) then carry the whole tick list.
			const auto = tickCount === 0 ? [] : s.ticks(tickCount)
			const values = [...auto, ...(customBreaks ?? [])]
			if (values.length === 0) return []
			const fallback = s.tickFormat?.(
				tickCount > 0 ? tickCount : Math.max(2, DEFAULT_TICK_COUNT)
			)
			const fmt = customFmt ?? fallback
			// Sort by axis value (breaks land between the auto ticks) and de-dup
			// on pixel position so a break that coincides with an auto tick
			// draws one tick + label, not two.
			const toNum = (v: unknown) =>
				v instanceof Date ? v.getTime() : Number(v)
			const seen = new Set<string>()
			return values
				.sort((a, b) => toNum(a) - toNum(b))
				.map((v) => ({
					pos: (scale as unknown as (x: unknown) => number)(v),
					label: fmt ? fmt(v) : String(v),
				}))
				.filter((t) => {
					const key = t.pos.toFixed(2)
					if (seen.has(key)) return false
					seen.add(key)
					return true
				})
		}
		// Honor the explicit "no ticks" request before doing any tick-list
		// construction. Without this short-circuit, `ticks(0)` against a band
		// scale would still iterate the full domain — bypassing the user's
		// intent.
		if (tickCount === 0) return []
		// scalePoint / scaleBand — categorical; formatter still honored if set.
		// scaleBand's scale(d) returns the band's left edge; scalePoint returns
		// the point's center. Offset by bandwidth/2 so band ticks sit under the
		// center of each bar (no-op for scalePoint, which has no bandwidth).
		const domain = s.domain() as string[]
		const halfBand = typeof s.bandwidth === "function" ? s.bandwidth() / 2 : 0
		// Sub-sample categorical ticks when the user has set a stride > 1
		// (e.g. "show every 3rd category" on a long axis). Stride 1 keeps
		// every entry — the default. We always keep the first and last so
		// the axis ends stay anchored, then walk forward by `stride`.
		const stride = Math.max(1, config?.categoricalTickStride ?? 1)
		const visibleIndices = new Set<number>()
		if (stride <= 1) {
			for (let i = 0; i < domain.length; i++) visibleIndices.add(i)
		} else {
			for (let i = 0; i < domain.length; i += stride) {
				visibleIndices.add(i)
			}
			visibleIndices.add(domain.length - 1)
		}
		return domain
			.map((d, i) => ({
				pos: ((scale as unknown as (x: unknown) => number)(d) ?? 0) + halfBand,
				label: customFmt ? customFmt(d) : String(d),
				visible: visibleIndices.has(i),
			}))
			.filter((t) => t.visible)
			.map(({ pos, label }) => ({ pos, label }))
	})()

	// Spread-merge defaults UNDER persisted overrides so a partial config
	// (e.g. `{ color: "..." }` missing `thickness`) doesn't render with
	// undefined `thickness` (which `> 0` evaluates false → spine vanishes).
	// `??` alone only catches null/undefined; an object with missing keys
	// would bypass it and surface the issue user-side as "axis spines
	// aren't showing up unless I change the setting".
	const tick = { ...DEFAULT_TICKMARK_CONFIG, ...config?.tickmarks }
	const spine = { ...DEFAULT_SPINE_CONFIG, ...config?.spine }
	// "Wrap text": fold long tick labels into multi-line blocks. X labels
	// wrap to their per-tick slot width; y labels to the fixed max width.
	// PlotCanvas pre-wraps the panel-input labels the same way, so the
	// solver's chrome reserves match what renders here.
	const wrapEnabled = config?.wrapTickLabels === true
	const wrappedTicks = (() => {
		if (!wrapEnabled || ticks.length === 0) return ticks
		const slotPx = isX
			? ((inner.x1 - inner.x0) / ticks.length) * TICK_WRAP_SLOT_FRACTION
			: tickWrapMaxPx(tickFontSize)
		return ticks.map((t) => ({
			...t,
			label: wrapTickLabel(t.label, slotPx, tickFontSize),
		}))
	})()
	// Single-line labels honor the Alignment setting too: y labels align to
	// a common edge of the label column (as wide as the axis's widest label
	// line); x labels have no column — each sits at its own tick — so they
	// pass 0 and align AT the tick (left = label starts at the tick).
	// Wrapped blocks keep their own within-block line alignment.
	const labelColumnWidth = isX
		? 0
		: wrappedTicks.reduce(
				(w, t) => Math.max(w, estimateLongestLineWidth(t.label, tickFontSize)),
				0
			)
	// Auto-rotate categorical x-axis labels when their natural width
	// exceeds the band width — keeps long category names from overlapping
	// their neighbors without the user having to set tickLabelAngle. The
	// PlotCanvas solver input feeds the same heuristic so the bottom
	// chrome reserves matching vertical room. User's explicit non-zero
	// angle (config.tickLabelAngle) wins inside `autoLabelAngleFor`.
	const effectiveLabelAngle =
		isX && (fieldType === "categorical" || fieldType === "ordinal")
			? autoLabelAngleFor({
					labels: ticks.map((t) => t.label),
					bandWidthPx:
						ticks.length > 0
							? (inner.x1 - inner.x0) / ticks.length
							: 0,
					fontSize: tickFontSize,
					userAngle: config?.tickLabelAngle,
					wrapEnabled,
				})
			: (config?.tickLabelAngle ?? 0)
	// Gridlines — computed from a separate count, span the full plot area
	const grid = { ...DEFAULT_GRIDLINE_CONFIG, ...config?.gridlines }
	const gridPositions: number[] = (() => {
		if (!grid.enabled) return []
		const s = scale as unknown as {
			ticks?: (count: number) => unknown[]
			domain: () => unknown[]
			bandwidth?: () => number
		}
		// Gridline-specific custom breaks (the Gridlines section's own
		// "Custom breaks" box) add pinned lines ON TOP of the automatic
		// layout (match-tick or count) — merged in after `autoPositions`.
		const gridBreakPositions =
			resolveBreaks(grid.breaks)?.map(
				(v) => (scale as unknown as (x: unknown) => number)(v)
			) ?? []
		const autoPositions: number[] = (() => {
			if (typeof s.ticks === "function") {
				// `null` count means "match axis ticks" — the AUTOMATIC tick
				// layout from `tickCount`, deliberately excluding the Ticks
				// section's custom breaks (add gridline breaks above to line a
				// gridline up with a pinned tick). Specific numbers decouple
				// gridlines from ticks entirely.
				const requestedGridCount = grid.count ?? tickCount
				return s
					.ticks(requestedGridCount)
					.map((v) => (scale as unknown as (x: unknown) => number)(v))
			}
			// Categorical — derive gridline positions from the same stride logic
			// the ticks use. The previous behavior was "one gridline per
			// category regardless of stride/count", which made the user's
			// "ticks every 5th category" setting paint vertical lines for
			// every category and turned the chart into a forest. Now the
			// gridlines either match the tick stride (default = "match tick
			// count") or follow `grid.count` as an explicit override.
			const halfBand = typeof s.bandwidth === "function" ? s.bandwidth() / 2 : 0
			const domain = s.domain() as string[]
			const tickStride = Math.max(1, config?.categoricalTickStride ?? 1)
			// `grid.count = null` (Match tick count) means "follow whatever the
			// tick layout chose" — so honor categoricalTickStride here too.
			// `grid.count = N` means "show N evenly-spaced gridlines", subject
			// to the domain length cap.
			const visibleIndices = new Set<number>()
			if (grid.count !== null && grid.count >= 0) {
				if (grid.count === 0) return []
				// Even spacing across the domain — pick `count` indices including
				// endpoints. For count=1 just show the first; for count>=2 the
				// stride spaces them evenly.
				if (grid.count === 1) {
					visibleIndices.add(0)
				} else {
					const denom = Math.max(1, grid.count - 1)
					for (let i = 0; i < grid.count; i++) {
						const idx = Math.round(((domain.length - 1) * i) / denom)
						visibleIndices.add(Math.min(domain.length - 1, idx))
					}
				}
			} else if (tickStride <= 1) {
				for (let i = 0; i < domain.length; i++) visibleIndices.add(i)
			} else {
				for (let i = 0; i < domain.length; i += tickStride) {
					visibleIndices.add(i)
				}
				visibleIndices.add(domain.length - 1)
			}
			return domain.flatMap((d, i) => {
				if (!visibleIndices.has(i)) return []
				const pos =
					((scale as unknown as (x: unknown) => number)(d) ?? 0) + halfBand
				return [pos]
			})
		})()
		// De-dup on pixel position so a break that coincides with an auto
		// gridline doesn't paint twice (visible with translucent strokes).
		// Keyed on a rounded value: scale math carries float noise (e.g.
		// 39.999999… vs 40), and sub-0.01px apart is a duplicate anyway.
		const seen = new Set<string>()
		return [...autoPositions, ...gridBreakPositions].filter((pos) => {
			const key = pos.toFixed(2)
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
	})()

	return (
		<g>
			{/* Gridlines (behind everything) */}
			{drawBack &&
				gridPositions.map((pos, i) => (
					<line
						// eslint-disable-next-line react/no-array-index-key
						key={`grid-${i}`}
						x1={isX ? pos : inner.x0}
						y1={isX ? inner.y0 : pos}
						x2={isX ? pos : inner.x1}
						y2={isX ? inner.y1 : pos}
						stroke={grid.color}
						strokeWidth={grid.thickness}
						opacity={0.6}
					/>
				))}
			<g transform={offsetTransform}>
				{/* Tick strokes (behind marks). Drawn here in the back pass — with
				 *  the gridlines and before the mark renderer — so overlapping
				 *  points/shapes paint over them. The matching labels stay in the
				 *  front pass below. Start each tick just outside the spine so the
				 *  strokes don't overlap at the intersection point. */}
				{drawTickMarks &&
					wrappedTicks.map((t, i) => {
						const [x, y] = isX ? [t.pos, inner.y1] : [inner.x0, t.pos]
						return (
							<line
								// eslint-disable-next-line react/no-array-index-key -- tick list is recomputed per render; label alone can collide
								key={`tickmark-${t.label}-${i}`}
								x1={x + (isX ? 0 : -spine.thickness / 2)}
								y1={y + (isX ? spine.thickness / 2 : 0)}
								x2={x + (isX ? 0 : -(tick.length + spine.thickness / 2))}
								y2={y + (isX ? tick.length + spine.thickness / 2 : 0)}
								stroke={tick.color}
								strokeWidth={tick.thickness}
							/>
						)
					})}
				{/* Spine survives `showTicksAndLabels: false` so faceted panels
				 *  with shared axes still get the user-configured frame line on
				 *  every panel — the user's thickness setting was previously
				 *  bound up with "draw the whole axis", which made only the
				 *  outer panel show a spine. */}
				{layer !== "back" && spine.thickness > 0 && (
					<line
						{...axisLine}
						stroke={spine.color}
						strokeWidth={spine.thickness}
					/>
				)}
				{drawFront && (
					<>
						{wrappedTicks.map((t, i) => {
							const [x, y] = isX ? [t.pos, inner.y1] : [inner.x0, t.pos]
							const labelAngle = effectiveLabelAngle
							const rotated = labelAngle !== 0
							// When rotated, anchor from whichever side keeps text away from
							// the axis. For x-axis: negative angle tilts up-left → end;
							// positive → start. For y-axis: always end.
							const labelAnchor = ((): "start" | "middle" | "end" => {
								if (!rotated) return isX ? "middle" : "end"
								if (!isX) return "end"
								return labelAngle < 0 ? "end" : "start"
							})()
							const labelBaseline = ((): "hanging" | "middle" => {
								if (rotated) return "middle"
								return isX ? "hanging" : "middle"
							})()
							const labelOffsetX = isX ? 0 : -(tick.length + 4)
							const labelOffsetY = isX ? tick.length + (rotated ? 6 : 12) : 0
							return (
								<g
									// eslint-disable-next-line react/no-array-index-key -- tick list is recomputed per render; label alone can collide
									key={`${t.label}-${i}`}
									transform={`translate(${x},${y})`}
								>
									{/* Tick STROKE moved to the back pass above so it draws
										behind overlapping marks; only the label renders here. */}
									<text
										x={labelOffsetX}
										y={labelOffsetY}
										transform={
											rotated
												? `rotate(${labelAngle} ${labelOffsetX} ${labelOffsetY})`
												: undefined
										}
										textAnchor={labelAnchor}
										dominantBaseline={labelBaseline}
										fontSize={tickFontSize}
										fontFamily={tickFamily}
										fontWeight={tickFontWeight}
										fontStyle={tickFontStyle}
										textDecoration={tickDecoration}
										fill={tickFill}
										className={
											tickFill ? undefined : "fill-stone-600 dark:fill-stone-400"
										}
									>
										{/* Wrapped labels render as stacked tspans, honoring
											the user's line alignment. Y labels anchor with
											baseline "middle", so the block centers on the tick;
											x labels hang below the axis and stack downward. */}
										{renderWrappedTickLabel({
											label: t.label,
											x: labelOffsetX,
											blockAnchor: labelAnchor,
											align: config?.wrapTickLabelAlign,
											fontSize: tickFontSize,
											verticallyCentered: !isX,
											columnWidth: labelColumnWidth,
										})}
									</text>
								</g>
							)
						})}
						{showTitle &&
							label &&
							(() => {
								// Anchor along the spine: x-axis spans inner.x0..inner.x1
								// horizontally; y-axis spans inner.y0..inner.y1 vertically.
								// Alignment maps to position along that span.
								const alignAnchor = textAnchorFromAlignment(titleAlignment)
								if (isX) {
									const titleX =
										titleAlignment === "left"
											? inner.x0
											: titleAlignment === "right"
												? inner.x1
												: (inner.x0 + inner.x1) / 2
									const titleY = inner.y1 + 6 + tickFontSize + 20
									return (
										<text
											x={titleX}
											y={titleY}
											textAnchor={alignAnchor}
											dominantBaseline="hanging"
											fontSize={titleFontSize}
											fontWeight={titleFontWeight}
											fontStyle={titleFontStyle}
											textDecoration={titleDecoration}
											fill={titleFill}
											fontFamily={titleFamily}
											className={
												titleFill
													? undefined
													: "fill-stone-700 dark:fill-stone-300"
											}
										>
											{renderMultilineTspans(label, titleX)}
										</text>
									)
								}
								// Y-axis: rotated -90° (default) or upright (yTitleHorizontal).
								// In the rotated branch the text reads bottom-to-top, so the
								// alignment glyphs ("left/right") map to bottom/top of the
								// axis. In the horizontal branch the text reads normally —
								// the user sees the title in reading order — so the mapping
								// flips: "left" pins to the top, "right" to the bottom.
								const titleAlongY = (() => {
									if (titleAlignment === "center")
										return (inner.y0 + inner.y1) / 2
									if (yTitleHorizontal) {
										return titleAlignment === "left" ? inner.y0 : inner.y1
									}
									return titleAlignment === "left" ? inner.y1 : inner.y0
								})()
								// Dynamically position the title left of the longest tick
								// label so a long category name (e.g. "Cardiothoracic
								// Surgery") doesn't render under the title. Estimate using
								// the same per-character heuristic as
								// `lib/estimateMargins.ts` (~0.55 × fontSize per char).
								// Used for BOTH the horizontal and rotated branches so
								// the horizontal title doesn't crash into tick labels.
								// Wrapped labels count their WIDEST LINE — the rendered
								// bounding box of stacked tspans is the widest line, not
								// the joined string.
								const longestLabelChars = wrappedTicks.reduce(
									(max, t) =>
										t.label
											.split("\n")
											.reduce((m, line) => Math.max(m, line.length), max),
									0
								)
								const longestLabelPx = longestLabelChars * tickFontSize * 0.55 + 4
								const dynamicGap = Math.max(
									40 + tickFontSize,
									longestLabelPx + tick.length + 12 + tickFontSize
								)
								if (yTitleHorizontal) {
									// Position the title past the tick labels (same gap as
									// the rotated branch) so it doesn't overlap them. With
									// textAnchor="end" the title's right edge lands at
									// `titleX`; tick labels live in the (inner.x0 -
									// dynamicGap, inner.x0) range, so anchoring at
									// `inner.x0 - dynamicGap` puts the title just to the
									// left of the longest tick label.
									const titleX = inner.x0 - dynamicGap
									// Match the baseline to the alignment so a top-aligned
									// title hangs inside the plot (instead of half-overflowing
									// above it), and a bottom-aligned title sits just inside
									// the plot floor.
									const horizontalBaseline =
										titleAlignment === "left"
											? "hanging"
											: titleAlignment === "right"
												? "auto"
												: "middle"
									return (
										<text
											x={titleX}
											y={titleAlongY}
											textAnchor="end"
											dominantBaseline={horizontalBaseline}
											fontSize={titleFontSize}
											fontWeight={titleFontWeight}
											fontStyle={titleFontStyle}
											textDecoration={titleDecoration}
											fill={titleFill}
											fontFamily={titleFamily}
											className={
												titleFill
													? undefined
													: "fill-stone-700 dark:fill-stone-300"
											}
										>
											{renderMultilineTspans(label, titleX)}
										</text>
									)
								}
								const titleX = inner.x0 - dynamicGap
								return (
									<text
										x={0}
										y={0}
										textAnchor={alignAnchor}
										dominantBaseline="middle"
										transform={`translate(${titleX}, ${titleAlongY}) rotate(-90)`}
										fontSize={titleFontSize}
										fontWeight={500}
										fill={titleFill}
										fontFamily={titleFamily}
										className={
											titleFill ? undefined : "fill-stone-700 dark:fill-stone-300"
										}
									>
										{renderMultilineTspans(label, 0)}
									</text>
								)
							})()}
					</>
				)}
			</g>
		</g>
	)
}

// Satisfy eslint — unused-import guard for scale type imports.
export type _ScaleTypeMarker =
	| ReturnType<typeof scaleLinear>
	| ReturnType<typeof scaleTime>
	| ReturnType<typeof scaleBand>
	| ReturnType<typeof scalePoint>
