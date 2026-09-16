import { autoLabelAngleFor } from "../../lib/autoLabelAngle"
import {
	DEFAULT_GRIDLINE_CONFIG,
	DEFAULT_SPINE_CONFIG,
	DEFAULT_TICKMARK_CONFIG,
	type AxisConfig,
} from "../../lib/channelConfig"
import { ptToPx, resolveTickFontSizePx } from "../../lib/fontUnit"
import { estimateLongestLineWidth } from "../../lib/estimateMargins"
import { format as d3Format } from "d3-format"

import { evenlySpacedTicks } from "../../lib/evenTicks"
import { buildTickFormatter } from "../../lib/formatTick"
import { mirrorTickBreaks } from "../../lib/mirrorAxis"
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
	/** The perpendicular axis, when one is rendered. This axis's gridlines
	 * run parallel to the opposing spine, so a gridline can land exactly
	 * under it (x-gridline at inner.x0, y-gridline at inner.y1) — the
	 * translucent gridline antialiases against the spine edge and the line
	 * looks blurry. When the opposing spine is visible, it replaces any
	 * gridline its stroke covers. Object presence = the opposing axis
	 * renders; `config` may still be undefined (defaults apply). Typed as
	 * the subset the suppression reads so callers can pass a full
	 * AxisConfig or just the spine field. */
	opposingAxis?: {
		config?: Pick<AxisConfig, "spine">
		/** Where the opposing spine actually sits when it has been moved off
		 * its default plot edge ("Set spine at 0" — see `spinePosition` below).
		 * The gridline suppression must track the moved spine, not the edge. */
		spinePosition?: number
	}
	/** Perpendicular pixel coordinate to draw this axis's SPINE at, overriding
	 * the plot-edge default (an x-axis takes a y pixel, a y-axis an x pixel).
	 * Set by the coord system when THIS axis's `spineAtZero` is on, so its
	 * spine crosses the OPPOSING scale at 0 instead of hugging the edge.
	 * Only the spine line moves — ticks, labels, and title stay at the edge. */
	spinePosition?: number
	/** True when BOTH ends of this continuous axis are user-pinned (Scale
	 * range min + max, or a facet range override). The automatic tick layout
	 * then places exactly `tickCount` evenly spaced ticks from min to max
	 * inclusive instead of d3's "nice" density-hint ticks, so the Count and
	 * Scale range controls compose the way users expect (0.04–0.24 with
	 * Count 6 → 0.04, 0.08, …, 0.24). Gridlines in "match tick count" mode
	 * (and explicit gridline counts) follow the same rule. Ignored on
	 * categorical axes. */
	domainPinned?: boolean
	/** True when this is a bar chart's measure axis under "Use a mirrored
	 * axis": the domain runs through 0 with one direction level's bars on
	 * each side, but the values are magnitudes — so every tick label shows
	 * |value| (the user's format spec still applies, to the magnitude), and
	 * the Ticks section's mirrored custom breaks (`config.mirror.breaks`,
	 * each magnitude pinning a tick at -b AND +b) replace the plain `breaks`
	 * list. Set by the coord system from the bar renderer only — the flag on
	 * a config is inert for every other renderer. */
	mirrored?: boolean
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
	opposingAxis,
	spinePosition,
	domainPinned = false,
	mirrored = false,
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
	// The spine's perpendicular position — the plot edge unless the coord
	// system moved it to the opposing scale's zero crossing ("Set spine at 0").
	const spineAt = spinePosition ?? (isX ? inner.y1 : inner.x0)
	const axisLine = isX
		? { x1: inner.x0, y1: spineAt, x2: inner.x1, y2: spineAt }
		: { x1: spineAt, y1: inner.y0, x2: spineAt, y2: inner.y1 }
	// "Adjust position" nudge — shifts the TICK LABELS only. The control lives
	// in the Tick Labels section, so nothing else moves: the spine, tick
	// marks, title, and gridlines all stay pinned where they were. Stored in
	// screen coords (+x right, +y down). The legacy single `offset` was
	// perpendicular-only (x-axis: positive = down, y-axis: positive = left);
	// it's folded in only while the new fields are unset — the panel clears it
	// on the first write of offsetX/offsetY.
	const legacyOffset = config?.offset ?? 0
	const labelDx = config?.offsetX ?? (isX ? 0 : -legacyOffset)
	const labelDy = config?.offsetY ?? (isX ? legacyOffset : 0)

	const requestedCount = config?.tickCount ?? DEFAULT_TICK_COUNT
	// Clamp to 0..maxMeaningfulTicks. `tickCount: 0` is a valid request that
	// means "no ticks at all" — the user can use it to suppress tickmarks /
	// labels on a quantitative axis when the spine alone is sufficient (or
	// when data labels cover the axis labeling).
	const tickCount = Math.max(0, Math.min(requestedCount, maxMeaningfulTicks))
	const baseCustomFmt = config ? buildTickFormatter(config, fieldType) : null
	// Mirrored measure axis: labels show magnitudes on both sides of zero.
	// Wraps whichever formatter ends up applying (custom spec or the scale's
	// default) so the two paths stay in step.
	const toMagnitude = (v: unknown): unknown =>
		mirrored && typeof v === "number" ? Math.abs(v) : v
	const customFmt = baseCustomFmt
		? (v: unknown) => baseCustomFmt(toMagnitude(v))
		: null

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
	const customBreaks = resolveBreaks(
		mirrored ? mirrorTickBreaks(config?.mirror?.breaks) : config?.breaks
	)

	// The AUTOMATIC tick layout for a continuous axis, shared by the tick
	// list and the gridlines' "match tick count" / explicit-count modes.
	// Default: d3's nice ticks (`count` is a density hint). Fully pinned
	// domain: exactly `count` evenly spaced values from min to max inclusive
	// — the user chose both ends, so the ticks land on them.
	const useEvenTicks = domainPinned && isContinuousScale
	const autoTicks = (count: number): unknown[] => {
		if (count <= 0 || !isContinuousScale) return []
		const s = scale as unknown as {
			ticks: (count: number) => unknown[]
			domain: () => unknown[]
		}
		if (!useEvenTicks) return s.ticks(count)
		const dom = s.domain()
		const toNum = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v))
		const even = evenlySpacedTicks(
			toNum(dom[0]),
			toNum(dom[dom.length - 1]),
			count
		)
		return fieldType === "temporal" ? even.map((ms) => new Date(ms)) : even
	}

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
			const auto = autoTicks(tickCount)
			const values = [...auto, ...(customBreaks ?? [])]
			if (values.length === 0) return []
			// Even ticks on a pinned quantitative axis can step by values d3's
			// nice-step precision would truncate (0–1 in 4 → 0.333…), so
			// format them at their own precision, trimming trailing zeros.
			// Temporal axes keep d3's multi-scale time formatter.
			const fallback =
				useEvenTicks && fieldType !== "temporal"
					? (v: unknown) => d3Format(",~f")(Number(v))
					: s.tickFormat?.(
							tickCount > 0 ? tickCount : Math.max(2, DEFAULT_TICK_COUNT)
						)
			const fmt =
				customFmt ?? (fallback ? (v: unknown) => fallback(toMagnitude(v)) : undefined)
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
					label: fmt ? fmt(v) : String(toMagnitude(v)),
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
	// Ticks start just outside the spine so the strokes don't overlap at the
	// intersection — but only while the spine actually sits at the plot edge.
	// A spine moved to a zero crossing leaves the ticks anchored at the edge,
	// where there's no spine stroke to clear.
	const tickSpineInset = spinePosition === undefined ? spine.thickness / 2 : 0
	// "Wrap text": fold long tick labels into multi-line blocks. X labels
	// wrap to their per-tick slot width; y labels to the fixed max width.
	// PlotCanvas pre-wraps the panel-input labels the same way, so the
	// solver's chrome reserves match what renders here.
	const wrapEnabled = config?.wrapTickLabels === true
	// Per-tick slot width — the wrap budget for x labels, and (when wrapping)
	// the shared alignment frame every x label aligns within (below).
	const xSlotPx =
		ticks.length > 0
			? ((inner.x1 - inner.x0) / ticks.length) * TICK_WRAP_SLOT_FRACTION
			: 0
	const wrappedTicks = (() => {
		if (!wrapEnabled || ticks.length === 0) return ticks
		const slotPx = isX ? xSlotPx : tickWrapMaxPx(tickFontSize)
		return ticks.map((t) => ({
			...t,
			label: wrapTickLabel(t.label, slotPx, tickFontSize),
		}))
	})()
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
	// Every label on an axis aligns within the SAME frame, wrapped or not —
	// otherwise mixed label lengths render with mixed-looking alignment
	// (single-line labels hugging their tick while wrapped neighbors straddle
	// it). Y labels align within the shared label column (as wide as the
	// axis's widest label line); unrotated x labels within their per-tick
	// wrap slot, centered on the tick. Rotated x labels have no horizontal
	// frame (the tspan coords live in rotated space), so they pass 0 and
	// align AT the anchor point.
	const labelColumnWidth = isX
		? wrapEnabled && effectiveLabelAngle === 0
			? xSlotPx
			: 0
		: wrappedTicks.reduce(
				(w, t) => Math.max(w, estimateLongestLineWidth(t.label, tickFontSize)),
				0
			)
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
				return autoTicks(requestedGridCount).map((v) =>
					(scale as unknown as (x: unknown) => number)(v)
				)
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
	})().filter((pos) => {
		// Spine-over-gridline: drop any gridline whose stroke overlaps the
		// PERPENDICULAR axis's spine (this axis's gridlines run parallel to
		// it). Both passes always render, so a visible opposing spine is
		// guaranteed to paint where the dropped gridline would have — the
		// spine replaces the gridline instead of blurring against it.
		if (!opposingAxis) return true
		const oppSpine = { ...DEFAULT_SPINE_CONFIG, ...opposingAxis.config?.spine }
		if (!(oppSpine.thickness > 0)) return true
		// The opposing spine sits at the plot edge unless it was moved to a
		// zero crossing ("Set spine at 0"), which is tracked at its moved
		// position — the gridline there is the one it replaces, while the
		// edge gridline stays. The "Adjust position" nudge does NOT enter
		// here: it moves tick labels only, never the spine.
		const spinePos = isX
			? (opposingAxis.spinePosition ?? inner.x0)
			: (opposingAxis.spinePosition ?? inner.y1)
		return Math.abs(pos - spinePos) > (oppSpine.thickness + grid.thickness) / 2 + 0.01
	})

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
			<g>
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
								x1={x + (isX ? 0 : -tickSpineInset)}
								y1={y + (isX ? tickSpineInset : 0)}
								x2={x + (isX ? 0 : -(tick.length + tickSpineInset))}
								y2={y + (isX ? tick.length + tickSpineInset : 0)}
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
									transform={`translate(${x + labelDx},${y + labelDy})`}
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
									// Mirror of the y-side gap fix: labels nudged DOWN
									// (positive labelDy) move toward the x-title, so push
									// the title down by the same amount.
									const titleY =
										inner.y1 + 6 + tickFontSize + 20 + Math.max(0, labelDy)
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
								// Rotated, the text reads bottom-to-top between the two axis
								// ends, so alignment picks WHICH END it reads from: "left"
								// starts the title at the panel FLOOR, "right" finishes it at
								// the panel TOP. Upright, the title always centers on the axis
								// and alignment aligns its wrapped LINES instead (below) —
								// top/bottom placement is the Adjust-position Y nudge's job.
								const titleAlongY = yTitleHorizontal
									? (inner.y0 + inner.y1) / 2
									: titleAlignment === "center"
										? (inner.y0 + inner.y1) / 2
										: titleAlignment === "left"
											? inner.y1
											: inner.y0
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
								// The "Adjust position" nudge moves ONLY the tick labels
								// (`labelDx` above), so a leftward nudge shifts the labels'
								// rendered edge toward the title. Widen the gap by that
								// component so the title keeps clear; a rightward nudge is
								// ignored (the title never chases labels inward).
								const dynamicGap =
									Math.max(
										40 + tickFontSize,
										longestLabelPx + tick.length + 12 + tickFontSize
									) + Math.max(0, -labelDx)
								if (yTitleHorizontal) {
									// The block's RIGHT EDGE lands past the tick labels (same
									// gap as the rotated branch) so it doesn't overlap them:
									// tick labels live in the (inner.x0 - dynamicGap, inner.x0)
									// range, so the edge sits at `inner.x0 - dynamicGap` and
									// the text extends `blockWidth` leftward from there.
									// Alignment slides the ANCHOR inside that fixed box — the
									// widest line spans the whole box either way — so the
									// wrapped lines align against each other without the ink
									// moving into the labels or off-canvas.
									const rightEdge = inner.x0 - dynamicGap
									const blockWidth = estimateLongestLineWidth(
										label,
										titleFontSize
									)
									const titleX =
										titleAlignment === "left"
											? rightEdge - blockWidth
											: titleAlignment === "center"
												? rightEdge - blockWidth / 2
												: rightEdge
									return (
										<text
											x={titleX}
											y={titleAlongY}
											textAnchor={alignAnchor}
											dominantBaseline="middle"
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
											{/* `verticallyCentered` pairs with the "middle"
												baseline so a WRAPPED title centers as a block
												on the axis, not from its first line. */}
											{renderMultilineTspans(label, titleX, {
												verticallyCentered: true,
											})}
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
