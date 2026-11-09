import { useEffect } from "react"
import { useSetAtom } from "jotai"
import { autoLabelAngleFor } from "../../lib/autoLabelAngle"
import { currentResolvedXTickLabelAngleAtom } from "../../store/atoms"
import { measureLabelWidths } from "./plotCanvas/measureText"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_GRIDLINE_CONFIG,
	DEFAULT_SPINE_CONFIG,
	DEFAULT_TICKMARK_CONFIG,
	axisFlipped,
	type AxisConfig,
} from "../../lib/channelConfig"
import { ptToPx, resolveTickFontSizePx } from "../../lib/fontUnit"
import { estimateLongestLineWidth } from "../../lib/estimateMargins"
import { format as d3Format } from "d3-format"

import { evenlySpacedTicks, evenlySpacedTimeTicks } from "../../lib/evenTicks"
import { buildTickFormatter, type TickFormatterOptions } from "../../lib/formatTick"
import { uniformTimeFormat, uniformTimeLiteral } from "../../lib/timeTickFormat"
import { type DateColumnText, literalTimeLabel } from "../../lib/rawTextByTime"
import { mirrorTickBreaks } from "../../lib/mirrorAxis"
import { resolveRuleColor } from "../../lib/textColorRules"
import { useFacetPanelRow } from "./plotCanvas/FacetPanelContext"
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
	/** When true, the y-axis title is drawn upright (0°) sitting beside the
	 * spine, outside the tick labels (left of a left axis, right of a
	 * right one — `config.side`). Ignored on x-axes. */
	yTitleHorizontal?: boolean
	/** When false, suppress the axis title only (still draw spine + ticks).
	 * Used by faceted panels so a single shared title can be drawn outside
	 * the panel grid. Defaults to true. */
	showTitle?: boolean
	/** The perpendicular axis, when one is rendered. This axis's gridlines
	 * run parallel to the opposing spine, so a gridline can land exactly
	 * under it (x-gridline at the y spine's edge — inner.x0, or inner.x1
	 * when that axis sits on the right; y-gridline at the x spine's edge —
	 * inner.y1, or inner.y0 for a top x axis) — the translucent gridline
	 * antialiases against the spine edge and the line looks blurry. When
	 * the opposing spine is visible, it replaces any gridline its stroke
	 * covers. Object presence = the opposing axis renders; `config` may
	 * still be undefined (defaults apply). Typed as the subset the
	 * suppression reads — `spine` for visibility, `side` for which edge
	 * its default position is — so callers can pass a full AxisConfig or
	 * just those fields. */
	opposingAxis?: {
		config?: Pick<AxisConfig, "spine" | "side">
		/** Where the opposing spine actually sits when it has been moved off
		 * its default plot edge ("Set spine at 0" — see `spinePosition` below).
		 * The gridline suppression must track the moved spine, not the edge. */
		spinePosition?: number
	}
	/** Perpendicular pixel coordinate to draw this axis's SPINE at, overriding
	 * the plot-edge default (an x-axis takes a y pixel, a y-axis an x pixel).
	 * Set by the coord system when THIS axis's `spineAtZero` is on, so its
	 * spine crosses the OPPOSING scale at 0 instead of hugging the edge.
	 * Only the spine line moves — ticks, labels, and title stay at the edge
	 * the axis sits on (`config.side`: bottom / top for x, left / right for y). */
	spinePosition?: number
	/** True when BOTH ends of this continuous axis are user-pinned (Scale
	 * range min + max, or a facet range override). The automatic tick layout
	 * then places exactly `tickCount` evenly spaced ticks from min to max
	 * inclusive instead of d3's "nice" density-hint ticks, so the Count and
	 * Scale range controls compose the way users expect (0.04–0.24 with
	 * Count 6 → 0.04, 0.08, …, 0.24). Exception: with Count still at its
	 * default (never touched), a pinned range whose ends d3's nice ticks already land on
	 * keeps those nice ticks, so a pinned axis reads the same as an auto
	 * axis over the same range (facet panels pinned to a sibling's range).
	 * Gridlines in "match tick count" mode (and explicit gridline counts)
	 * follow the same rule. Ignored on categorical axes. */
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
	/** A date axis's data cells keyed by the instant they parse to
	 * (`dateColumnText`). The tick Format's "Literal" prints every tick in
	 * the column's own text shape ("1949" for a column of "1947"-style
	 * cells), the cell itself when a tick lands on one, and ISO text at the
	 * tick set's granularity only when the shape isn't recognised. Only temporal axes with a field pass this. */
	rawTextByValue?: DateColumnText
	/** A facet panel's "Custom breaks" (the facet range editors —
	 * `AxisRangeOverride.ticks`): these axis values REPLACE this continuous
	 * axis's whole tick layout, the auto ticks and the Ticks section's
	 * Custom breaks alike, and gridlines in "match tick count" mode follow
	 * them. Values outside the domain aren't drawn. Empty / absent = the
	 * normal layout. Ignored on categorical axes. */
	replaceTicks?: readonly number[]
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
	rawTextByValue,
	replaceTicks,
}: Props) => {
	// The facet panel this axis draws in, as one data row (`{ Company:
	// "Merck" }`) — the only rows a tick label has, so a tick-label color
	// rule can test the panel's facet variable(s). Undefined unfaceted.
	const facetRow = useFacetPanelRow()
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
	// Which plot edge this axis sits on ("Side"): x is bottom unless flipped
	// to the top, y is left unless flipped to the right. `edgeY` / `edgeX`
	// are the axis's OWN edge — where its tick marks start, its labels hang
	// off and its title sits — while gridlines stay at data positions.
	// Everything that extends away from the plot flips sign with `out`.
	const flipped = axisFlipped(orientation, config?.side)
	const edgeY = flipped ? inner.y0 : inner.y1
	const edgeX = flipped ? inner.x1 : inner.x0
	// Outward direction along the axis's perpendicular, in screen px: x
	// bottom grows +y (down), x top −y (up); y left grows −x, y right +x.
	const out = isX ? (flipped ? -1 : 1) : flipped ? 1 : -1
	// The spine's perpendicular position — the axis's edge unless the coord
	// system moved it to the opposing scale's zero crossing ("Set spine at 0").
	const spineAt = spinePosition ?? (isX ? edgeY : edgeX)
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
	// Mirrored measure axis: labels show magnitudes on both sides of zero.
	// Applied to the value BEFORE whichever formatter ends up applying
	// (custom spec, Before / After text, or the scale's default) so the
	// paths stay in step.
	const toMagnitude = (v: unknown): unknown =>
		mirrored && typeof v === "number" ? Math.abs(v) : v
	/** The tick Format resolved over `auto`, the default label text for this
	 * axis: the user's spec when set, `auto` wrapped in any Before / After
	 * text when the spec is Auto, `auto` itself when nothing is set. */
	const formatterOver = (
		auto: (v: unknown) => string,
		opts?: TickFormatterOptions
	) => (config ? buildTickFormatter(config, fieldType, auto, opts) : auto)

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
	const resolveBreaks = (
		raw: readonly number[] | undefined
	): unknown[] | null => {
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
	// A facet panel's Custom breaks stand in for the whole layout —
	// auto + breaks — so a list wholly outside the domain draws no ticks
	// rather than falling back. `null` = no replacement.
	const replacedTicks =
		isContinuousScale && replaceTicks && replaceTicks.length > 0
			? (resolveBreaks(replaceTicks) ?? [])
			: null

	// The AUTOMATIC tick layout for a continuous axis, shared by the tick
	// list and the gridlines' "match tick count" / explicit-count modes.
	// Default: d3's nice ticks (`count` is a density hint). Fully pinned
	// domain: exactly `count` evenly spaced values from min to max inclusive
	// — the user chose both ends, so the ticks land on them. A pinned DATE
	// axis snaps those even values to calendar boundaries (year starts for
	// a ten-year step), or leap days leave them hours off midnight and the
	// time formatter labels the stray hours / milliseconds.
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
		const lo = toNum(dom[0])
		const hi = toNum(dom[dom.length - 1])
		// Count untouched + pinned ends that are already "nice": keep d3's
		// ticks. Otherwise a panel pinned to its sibling's auto range lays
		// out DEFAULT_TICK_COUNT even ticks while the sibling gets d3's
		// denser nice set — same range, different breaks.
		if (requestedCount === DEFAULT_AXIS_CONFIG.tickCount) {
			const nice = s.ticks(count)
			const eps = Math.abs(hi - lo) * 1e-9
			const hits = (end: number) => nice.some((t) => Math.abs(toNum(t) - end) <= eps)
			if (nice.length >= 2 && hits(lo) && hits(hi)) return nice
		}
		return fieldType === "temporal"
			? evenlySpacedTimeTicks(lo, hi, count).map((ms) => new Date(ms))
			: evenlySpacedTicks(lo, hi, count)
	}

	// `value` is what the label shows — the category text or the number (a
	// mirrored axis's magnitude) — and what the tick-label color rules test.
	const ticks: Array<{ pos: number; label: string; value: unknown }> = (() => {
		const s = scale as unknown as {
			ticks?: (count: number) => unknown[]
			tickFormat?: (count: number) => (v: unknown) => string
			domain: () => unknown[]
			bandwidth?: () => number
		}
		if (typeof s.ticks === "function") {
			// `tickCount: 0` is a valid "no automatic ticks" request — custom
			// breaks (if any) then carry the whole tick list.
			const values =
				replacedTicks ?? [...autoTicks(tickCount), ...(customBreaks ?? [])]
			if (values.length === 0) return []
			// A date axis labels EVERY tick in one format, chosen from the tick
			// set's finest calendar component ("1949 … 2019" for year starts,
			// "Jan 1988 … Oct 1988" once a month start is among them). d3's
			// own multi-scale `tickFormat` picks per tick and mixes "1988",
			// "Jul" and "04 PM" on one axis. Literal prints the same ticks as
			// ISO text at that granularity.
			const dates =
				fieldType === "temporal"
					? values.filter((v): v is Date => v instanceof Date)
					: null
			// Even ticks on a pinned quantitative axis can step by values d3's
			// nice-step precision would truncate (0–1 in 4 → 0.333…), so
			// format them at their own precision, trimming trailing zeros —
			// as with replaced ticks, which follow no d3 step at all.
			const fallback = dates
				? ((f) => (v: unknown) => (v instanceof Date ? f(v) : String(v)))(
						uniformTimeFormat(dates)
					)
				: useEvenTicks || replacedTicks
					? (v: unknown) => d3Format(",~f")(Number(v))
					: s.tickFormat?.(
							tickCount > 0 ? tickCount : Math.max(2, DEFAULT_TICK_COUNT)
						)
			// Sort by axis value (breaks land between the auto ticks) and de-dup
			// on pixel position so a break that coincides with an auto tick
			// draws one tick + label, not two.
			const toNum = (v: unknown) =>
				v instanceof Date ? v.getTime() : Number(v)
			const sorted = values.sort((a, b) => toNum(a) - toNum(b))
			// The sorted set goes to the formatter too: the `year-ends` format
			// spells the first and last tick's years in full.
			const fmt = formatterOver(fallback ?? ((v: unknown) => String(v)), {
				tickValues: sorted,
				...(dates
					? { literalDate: literalTimeLabel(rawTextByValue, uniformTimeLiteral(dates)) }
					: {}),
			})
			const seen = new Set<string>()
			return sorted
				.map((v) => ({
					pos: (scale as unknown as (x: unknown) => number)(v),
					label: fmt(toMagnitude(v)),
					value: toMagnitude(v),
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
		// The visible categories, in axis order, go to the formatter: the
		// `year-ends` format spells the first and last one's years in full
		// (the stride always keeps both ends, so the ends stay the ends).
		const categoryFmt = formatterOver((v: unknown) => String(v), {
			tickValues: domain.filter((_, i) => visibleIndices.has(i)),
		})
		return domain
			.map((d, i) => ({
				pos: ((scale as unknown as (x: unknown) => number)(d) ?? 0) + halfBand,
				label: categoryFmt(toMagnitude(d)),
				value: toMagnitude(d),
				visible: visibleIndices.has(i),
			}))
			.filter((t) => t.visible)
			.map(({ pos, label, value }) => ({ pos, label, value }))
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
			label: wrapTickLabel(
				t.label,
				slotPx,
				tickFontSize,
				config?.wrapTickLabelChars
			),
		}))
	})()
	// Auto-rotate categorical x-axis labels when neighboring labels would
	// collide — keeps long category names from overlapping without the
	// user having to set tickLabelAngle. Widths are canvas-measured in the
	// rendered font (char-count fallback without a DOM). The PlotCanvas
	// solver input feeds the same heuristic so the bottom chrome reserves
	// matching vertical room. An explicit angle (any stored number,
	// including 0) wins inside `autoLabelAngleFor`.
	const autoAngleApplies =
		isX && (fieldType === "categorical" || fieldType === "ordinal")
	const effectiveLabelAngle = autoAngleApplies
		? autoLabelAngleFor({
				labels: ticks.map((t) => t.label),
				labelWidthsPx: measureLabelWidths(
					ticks.map((t) => t.label),
					tickFamily,
					tickFontSize,
					tickFontWeight,
					tickItalic
				),
				positionsPx: ticks.map((t) => t.pos),
				bandWidthPx:
					ticks.length > 0 ? (inner.x1 - inner.x0) / ticks.length : 0,
				fontSize: tickFontSize,
				userAngle: config?.tickLabelAngle,
				wrapEnabled,
			})
		: (config?.tickLabelAngle ?? 0)
	// Tell the X panel what auto resolved to, so its blank Angle input can
	// show the value and offer "set to 0". Only the front pass of a
	// categorical x-axis under auto publishes; an explicit angle leaves the
	// last auto value in place (the panel ignores it while a value is set).
	const setResolvedAngle = useSetAtom(currentResolvedXTickLabelAngleAtom)
	const publishResolved =
		drawFront && autoAngleApplies && config?.tickLabelAngle == null
	useEffect(() => {
		if (publishResolved) setResolvedAngle(effectiveLabelAngle)
	}, [publishResolved, effectiveLabelAngle, setResolvedAngle])
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
				// Replaced ticks ARE the panel's tick layout, so matching
				// gridlines follow them.
				if (grid.count == null && replacedTicks) {
					return replacedTicks.map((v) =>
						(scale as unknown as (x: unknown) => number)(v)
					)
				}
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
		// The opposing spine sits at ITS plot edge — which follows its own
		// "Side" (a right-hand y axis defaults to inner.x1, a top x axis to
		// inner.y0) — unless it was moved to a zero crossing ("Set spine at
		// 0"), which is tracked at its moved position — the gridline there is
		// the one it replaces, while the edge gridline stays. The "Adjust
		// position" nudge does NOT enter here: it moves tick labels only,
		// never the spine.
		const oppSide = opposingAxis.config?.side
		const spinePos = isX
			? (opposingAxis.spinePosition ??
				(axisFlipped("y", oppSide) ? inner.x1 : inner.x0))
			: (opposingAxis.spinePosition ??
				(axisFlipped("x", oppSide) ? inner.y0 : inner.y1))
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
				 *  strokes don't overlap at the intersection point, and extend
				 *  AWAY from the plot (`out`) from whichever edge the axis sits on. */}
				{drawTickMarks &&
					wrappedTicks.map((t, i) => {
						const [x, y] = isX ? [t.pos, edgeY] : [edgeX, t.pos]
						return (
							<line
								// eslint-disable-next-line react/no-array-index-key -- tick list is recomputed per render; label alone can collide
								key={`tickmark-${t.label}-${i}`}
								x1={x + (isX ? 0 : out * tickSpineInset)}
								y1={y + (isX ? out * tickSpineInset : 0)}
								x2={x + (isX ? 0 : out * (tick.length + tickSpineInset))}
								y2={y + (isX ? out * (tick.length + tickSpineInset) : 0)}
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
							const [x, y] = isX ? [t.pos, edgeY] : [edgeX, t.pos]
							const labelAngle = effectiveLabelAngle
							const rotated = labelAngle !== 0
							// Anchor from whichever side keeps text away from the axis.
							// Y: "end" against a left axis, "start" off a right one
							// (rotated or not). X rotated on the bottom: a negative
							// angle tilts up-left → "end", positive → "start"; on the
							// TOP the same tilt must lean the other way, so the rule
							// mirrors (negative → "start", positive → "end").
							// `naturalWrapAlignFor` (tickLabelWrap.tsx) restates these
							// for the panel — keep them in step.
							const labelAnchor = ((): "start" | "middle" | "end" => {
								if (!isX) return flipped ? "start" : "end"
								if (!rotated) return "middle"
								const leansEnd = labelAngle < 0
								return leansEnd !== flipped ? "end" : "start"
							})()
							// Bottom x labels HANG below the axis; top x labels sit on
							// their alphabetic baseline above it so the ink gap mirrors.
							const labelBaseline = ((): "hanging" | "middle" | "auto" => {
								if (rotated || !isX) return "middle"
								return flipped ? "auto" : "hanging"
							})()
							// Perpendicular offsets grow AWAY from the plot (`out`). The
							// top-edge unrotated gap is 8 rather than 12 because the
							// alphabetic baseline already sits a descender's height
							// above the ink's bottom edge.
							const labelOffsetX = isX ? 0 : out * (tick.length + 4)
							const labelOffsetY = isX
								? out * (tick.length + (rotated ? 6 : flipped ? 8 : 12))
								: 0
							// Tick-label color rules: the first rule matching THIS
							// tick's value recolors just this label; the rest keep
							// the axis's font color. A `{Variable}` piece can only
							// name a facet variable (the panel row), e.g.
							// `== Cardiology AND {Company} == Merck`.
							const labelFill =
								resolveRuleColor(
									config?.tickLabelColorRules,
									t.value,
									facetRow && [facetRow]
								) ?? tickFill
							return (
								<g
									// eslint-disable-next-line react/no-array-index-key -- tick list is recomputed per render; label alone can collide
									key={`${t.label}-${i}`}
									transform={`translate(${x + labelDx},${y + labelDy})`}
								>
									{/* Tick STROKE moved to the back pass above so it draws
										behind overlapping marks; only the label renders here. */}
									<text
										data-vc-tick-label={orientation}
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
										fill={labelFill}
										className={
											labelFill ? undefined : "fill-stone-600 dark:fill-stone-400"
										}
									>
										{/* Wrapped labels render as stacked tspans, honoring
											the user's line alignment. Y labels anchor with
											baseline "middle", so the block centers on the tick;
											bottom x labels hang below the axis and stack
											downward; top x labels stack UPWARD so the last
											line stays nearest the axis. */}
										{renderWrappedTickLabel({
											label: t.label,
											x: labelOffsetX,
											blockAnchor: labelAnchor,
											align: config?.wrapTickLabelAlign,
											fontSize: tickFontSize,
											verticallyCentered: !isX,
											columnWidth: labelColumnWidth,
											growUp: isX && flipped,
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
									// Mirror of the y-side gap fix: labels nudged toward the
									// title (DOWN — positive labelDy — on the bottom edge, UP
									// — negative — on the top) push the title the same way.
									// The title clears the tick-label band (6 + tickFontSize
									// + 20) on the axis's own side of the edge: hanging
									// below it on the bottom; on the TOP its baseline sits
									// above and a wrapped title stacks upward, so the
									// bottom line stays nearest the labels either way.
									const titleY = flipped
										? inner.y0 - (6 + tickFontSize + 20) - Math.max(0, -labelDy)
										: inner.y1 + 6 + tickFontSize + 20 + Math.max(0, labelDy)
									return (
										<text
											x={titleX}
											y={titleY}
											textAnchor={alignAnchor}
											dominantBaseline={flipped ? "auto" : "hanging"}
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
											{renderMultilineTspans(
												label,
												titleX,
												flipped
													? { growUp: true, fontSize: titleFontSize }
													: undefined
											)}
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
								// Dynamically position the title outside the longest tick
								// label (left of a left axis, right of a right one) so a
								// long category name (e.g. "Cardiothoracic Surgery")
								// doesn't render under the title. Estimate using
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
								// component so the title keeps clear; a nudge toward the
								// plot is ignored (the title never chases labels inward).
								// "Toward the title" is leftward (negative labelDx) for a
								// left axis and rightward (positive) for a right one.
								const dynamicGap =
									Math.max(
										40 + tickFontSize,
										longestLabelPx + tick.length + 12 + tickFontSize
									) + Math.max(0, flipped ? labelDx : -labelDx)
								if (yTitleHorizontal) {
									// The block's edge NEAREST THE PLOT lands past the tick
									// labels (same gap as the rotated branch) so it doesn't
									// overlap them. Left axis: tick labels live in the
									// (inner.x0 - dynamicGap, inner.x0) range, so the block's
									// RIGHT edge sits at `inner.x0 - dynamicGap` and the text
									// extends `blockWidth` leftward from there. Right axis:
									// the mirror — the block's LEFT edge sits at `inner.x1 +
									// dynamicGap` and the text extends rightward. Alignment
									// slides the ANCHOR inside that fixed box — the widest
									// line spans the whole box either way — so the wrapped
									// lines align against each other without the ink moving
									// into the labels or off-canvas.
									const blockWidth = estimateLongestLineWidth(
										label,
										titleFontSize
									)
									const leftEdge = flipped
										? inner.x1 + dynamicGap
										: inner.x0 - dynamicGap - blockWidth
									const titleX =
										titleAlignment === "left"
											? leftEdge
											: titleAlignment === "center"
												? leftEdge + blockWidth / 2
												: leftEdge + blockWidth
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
								// Rotated title past the tick labels on the axis's own side.
								// It keeps rotate(-90) on the RIGHT edge too — reading
								// bottom-to-top on both sides keeps the alignment semantics
								// ("left" starts at the floor, "right" ends at the ceiling).
								const titleX = flipped
									? inner.x1 + dynamicGap
									: inner.x0 - dynamicGap
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
