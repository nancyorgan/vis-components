import { useMemo, useState } from "react"
import { scaleBand } from "d3-scale"
import { arc as d3arc } from "d3-shape"
import { useAtomValue } from "jotai"
import { aggregateBars, type GroupEncoding } from "../../lib/aggregateBars"
import type { Stack } from "../../lib/aggregators/stacks"
import { DEFAULT_ANGLE_CONFIG, type ChannelConfigs } from "../../lib/channelConfig"
import { getChartMode } from "../../lib/chartMode"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { cartesian } from "../../lib/coords"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import type { PatternDefSpec } from "../../lib/patternDefs"
import {
	buildPatternDefs,
	stacksToGroupValues,
} from "../../lib/buildPatternDefs"
import {
	layerFillProp,
	resolveLayerColor,
	slotOpacityResolver,
} from "../../lib/resolveLayerColor"
import { type PositionScale } from "../../lib/scales"
import type { FieldType } from "../../lib/types"
import { formatSingleLabel } from "../../lib/dataLabelsStyle"
import type { Encodings } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
} from "../../store/atoms"
import {
	useAestheticScales,
	type AestheticScales,
} from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import {
	groupHighlight,
	useLegendHighlight,
	useMarkHoverHighlight,
	type LegendHighlight,
} from "../../store/useLegendHighlight"

import { DataLabelsLayer, type DataLabelAnchor } from "./DataLabelsLayer"
import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import { Plot, type CoordFactory, type PlotContext } from "./Plot"

const FALLBACK_FILL = "#6b7280"

type PiePlotProps = ChartRendererBaseProps & {
	/** Per-axis scale-row override. Pies only have an angle axis;
	 *  PlotCanvas passes the angle-share's row source via X.
	 *  See RadarPlot for the parallel rationale. */
	scalesRowsOverrideX?: Array<Record<string, unknown>>
	/** Hide just the shared axis TITLE (pie-x / pie-y faceted modes carry a
	 *  shared category-axis title). PlotCanvas sets these to `false` so the
	 *  per-panel title doesn't double up with the one it draws outside the
	 *  grid. Default `true` (title renders) on standalone paths. */
	showXAxisTitle?: boolean
	showYAxisTitle?: boolean
	/** "Size panels by unit" — scales the drawn radius by this factor
	 *  (0..1). Faceted pies use the largest panel's slice total as
	 *  the 1.0 reference; smaller panels get proportionally smaller
	 *  radii. Undefined / 1.0 = no shrinking (default). Only applies
	 *  to the single-pie path (`aggregation.mode === "pies"`); the
	 *  band path with grouped pies is unaffected. */
	radiusScale?: number
}

type Aggregation =
	| {
			kind: "ok"
			// `pies` is the single-centered-pie case (no x/y mapping);
			// `pies-x` / `pies-y` arrange multiple pies along a band.
			mode: "pies" | "pies-x" | "pies-y"
			/** For `pies-x` / `pies-y`: which axis holds the category band.
			 * Undefined for `pies` — there is no band. */
			isVertical: boolean | null
			/** Category field name. Undefined for `pies` mode (we synthesize a
			 * single-row stack manually). */
			categoryField: string | null
			measureField: string
			categoryType: FieldType | null
			measureType: FieldType
			stacks: Stack[]
			scaleCategories: string[]
	  }
	| {
			kind: "error"
			message: string
	  }

/** Synthetic category key used to coerce `aggregateBars` into producing one
 * stack for the single-pie case. Prefixed with an unlikely string so it
 * doesn't collide with a user's real field name. */
const SINGLE_PIE_CATEGORY = "__vc_single_pie__"

export const PiePlot = (props: PiePlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataLabels = useAtomValue(currentDataLabelsEncodingsAtom)
	const dataLabelsCfg = useAtomValue(currentDataLabelsConfigAtom)
	const dataLabelsDecimals = dataLabelsCfg?.decimals ?? null
	// The mapped value field's Label format spec — wedge labels show that
	// field's aggregate (textValue), so its per-field format applies.
	const dataLabelsFormatSpec = dataLabels?.value?.field
		? (dataLabelsCfg?.fieldFormats?.[dataLabels.value.field] ?? null)
		: null
	// Radial placement of labels — the Distance % knob always drives it.
	// Its default is 100 % (the pie's border), so labels read cleanly with
	// no tuning; lower values pull them inside the wedge.
	const dataLabelsRadiusPct = dataLabelsCfg?.polarLabelRadius ?? 100
	const anyDataLabelsMapped = Boolean(
		dataLabels?.x?.field ||
			dataLabels?.y?.field ||
			dataLabels?.angle?.field ||
			dataLabels?.r?.field ||
			dataLabels?.value?.field ||
			dataLabels?.hue?.field ||
			dataLabels?.size?.field,
	)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
	const legendHighlight = useLegendHighlight()
	const markHover = useMarkHoverHighlight(aestheticScales.hue?.field.name ?? null)
	const [hovered, setHovered] = useState<TooltipState | null>(null)

	const showX = props.showXAxis !== false
	const showY = props.showYAxis !== false
	// Memoize the rows-derivation so downstream useMemo deps don't see a fresh
	// `[]` fallback every render (which otherwise busts the aggregation cache).
	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)
	// Pies have only an angle axis (no R). PlotCanvas hands the angle
	// share's row source via scalesRowsOverrideX; fall back to the
	// combined override, then the panel's own rows. Without the
	// per-axis read, picking "Share angle = All" on a faceted-pie
	// chart had no effect when shareR / shareY happened to differ.
	const rowsForScales =
		props.scalesRowsOverrideX ?? props.scalesRowsOverride ?? rowsForChart

	// Aggregation runs outside the coord factory — it's independent of the
	// measured inner rect. Only the categoryScale depends on the rect and gets
	// built inside the factory below. Pies have no measure axis — the angle
	// carries the measure via `slice.value / totalForStack * 2π`.
	const aggregation = useMemo<Aggregation | null>(() => {
		if (!dataset) return null
		const mode = getChartMode(encodings)
		if (mode !== "pies" && mode !== "pies-x" && mode !== "pies-y") return null
		const measureField = encodings.angle.field
		if (!measureField) return null
		// For pies-x / pies-y the categoryField is the mapped position; for
		// the single-pie `pies` mode we synthesize a constant so `aggregateBars`
		// produces exactly one stack (all rows pooled into one pie).
		const categoryField =
			mode === "pies-x"
				? encodings.x.field
				: mode === "pies-y"
					? encodings.y.field
					: SINGLE_PIE_CATEGORY
		if (!categoryField) return null

		// Build the groups list from the aesthetic scales so the plot and the
		// hook agree exactly on which channels are mapped. Order matches the
		// previous GROUP_CHANNELS constant for stable slice-key tuples.
		const groups: GroupEncoding[] = (
			[
				aestheticScales.hue &&
					({
						channel: "hue",
						field: aestheticScales.hue.field.name,
						type: aestheticScales.hue.field.type,
					} satisfies GroupEncoding),
				aestheticScales.saturation &&
					({
						channel: "saturation",
						field: aestheticScales.saturation.field.name,
						type: aestheticScales.saturation.field.type,
					} satisfies GroupEncoding),
				aestheticScales.brightness &&
					({
						channel: "brightness",
						field: aestheticScales.brightness.field.name,
						type: aestheticScales.brightness.field.type,
					} satisfies GroupEncoding),
				aestheticScales.pattern &&
					({
						channel: "pattern",
						field: aestheticScales.pattern.field.name,
						type: aestheticScales.pattern.field.type,
					} satisfies GroupEncoding),
				aestheticScales.opacity &&
					({
						channel: "opacity",
						field: aestheticScales.opacity.field.name,
						type: aestheticScales.opacity.field.type,
					} satisfies GroupEncoding),
			] as Array<GroupEncoding | null>
		).filter((g): g is GroupEncoding => g !== null)

		// Per-channel user-pinned level order so pie wedges order the same way
		// the legend lists them (see BarPlot for the analogous setup).
		const groupOrders: Partial<Record<GroupEncoding["channel"], readonly string[]>> = {}
		for (const g of groups) {
			const order = levelOrders[g.field]
			if (order) groupOrders[g.channel] = order
		}

		// For `pies` mode, augment the row objects with the synthetic
		// category column so `aggregateBars` produces a single stack. The
		// cost of the extra columns is negligible (one string per row) and
		// keeps the aggregation pipeline uniform across all three pie modes.
		const isSinglePie = mode === "pies"
		const rowsWithCategory = isSinglePie
			? rowsForChart.map((r) => ({
					...r,
					[SINGLE_PIE_CATEGORY]: SINGLE_PIE_CATEGORY,
				}))
			: rowsForChart
		const rowsForScalesWithCategory = isSinglePie
			? rowsForScales.map((r) => ({
					...r,
					[SINGLE_PIE_CATEGORY]: SINGLE_PIE_CATEGORY,
				}))
			: rowsForScales

		const categoryType: FieldType = isSinglePie
			? "categorical"
			: effectiveType(dataset, categoryField, overrides)
		const measureType = effectiveType(dataset, measureField, overrides)

		// The Data Labels "Value" channel drives the per-slice label text.
		// Aggregating it here stamps each slice's `textValue` (numeric → sum,
		// otherwise → first value), so labels can show a field other than the
		// slice's measure. Falls back to the legacy chart `text` encoding for
		// saved visuals. When unset (or equal to the measure), buildPieAnchors
		// falls back to `slice.value`.
		const textField =
			dataLabels?.value?.field ?? encodings.text?.field ?? undefined
		const textType = textField
			? effectiveType(dataset, textField, overrides)
			: undefined

		const result = aggregateBars({
			rows: rowsWithCategory,
			categoryField,
			lengthField: measureField,
			categoryType,
			lengthType: measureType,
			groups,
			textField,
			textType,
			categoryOrder: levelOrders[categoryField],
			groupOrders,
		})
		if ("error" in result) {
			return { kind: "error", message: result.error }
		}

		// When scalesRowsOverride differs from rowsForChart (faceting + shared
		// axes), run a second aggregation on the full set to derive the shared
		// category list.
		const scaleAggregation =
			rowsForScalesWithCategory === rowsWithCategory
				? result
				: aggregateBars({
						rows: rowsForScalesWithCategory,
						categoryField,
						lengthField: measureField,
						categoryType,
						lengthType: measureType,
						groups,
						textField,
						textType,
						categoryOrder: levelOrders[categoryField],
						groupOrders,
					})
		const scaleCategories =
			"error" in scaleAggregation
				? result.categories
				: scaleAggregation.categories

		return {
			kind: "ok",
			mode,
			// Single-pie mode has no band axis, so isVertical is meaningless.
			// Consumers must check `mode === "pies"` before reading isVertical.
			isVertical: mode === "pies-x" ? true : mode === "pies-y" ? false : null,
			categoryField: isSinglePie ? null : categoryField,
			measureField,
			categoryType: isSinglePie ? null : categoryType,
			measureType,
			stacks: result.stacks,
			scaleCategories,
		}
	}, [
		dataset,
		encodings,
		overrides,
		rowsForChart,
		rowsForScales,
		aestheticScales,
		levelOrders,
		dataLabels?.value?.field,
	])

	// Pattern defs depend only on aesthetic categories + slice group values +
	// channelConfigs — not on the measured rect. Pre-compute so they can be
	// registered in `<defs>` before marks render.
	const patternDefs = useMemo<PatternDefSpec[]>(() => {
		if (!aggregation || aggregation.kind === "error") return []
		return buildPatternDefs(
			stacksToGroupValues(aggregation.stacks),
			aestheticScales,
			channelConfigs,
			channelConfigs.defaultFill ?? FALLBACK_FILL,
			channelConfigs.pattern?.backgroundColor ?? "#e2e8f0"
		)
	}, [aggregation, aestheticScales, channelConfigs])

	const tickFont = resolveTextFont(labels.baseFont)
	const xAxisTitleFont = resolveTitleFont(
		labels.baseFont,
		"secondary",
		labels.fontOverrides?.xAxisTitle
	)
	const yAxisTitleFont = resolveTitleFont(
		labels.baseFont,
		"secondary",
		labels.fontOverrides?.yAxisTitle
	)

	// Coord factory — defers category-scale construction to after measurement.
	// Pies have no measure axis; the unused perpendicular axis is passed as
	// `null` and `cartesian()` skips rendering it. For `pies-x`, the category
	// axis is x; for `pies-y`, it's y.
	const coord: CoordFactory = (inner) => {
		if (!aggregation || aggregation.kind === "error") {
			return cartesian({
				xScale: null,
				yScale: null,
				xLabel: "",
				yLabel: "",
				xFieldType: null,
				yFieldType: null,
				showXAxis: false,
				showYAxis: false,
				tickFont,
				xAxisTitleFont,
				yAxisTitleFont,
			})
		}
		const { mode, isVertical, scaleCategories, categoryField } = aggregation
		// Single-pie mode: no axes at all. The renderer places one pie in the
		// center of the inner rect regardless of measurement.
		if (mode === "pies") {
			return cartesian({
				xScale: null,
				yScale: null,
				xLabel: "",
				yLabel: "",
				xFieldType: null,
				yFieldType: null,
				showXAxis: false,
				showYAxis: false,
				tickFont,
				xAxisTitleFont,
				yAxisTitleFont,
			})
		}
		const categoryScale = scaleBand<string>()
			.domain(scaleCategories)
			.range(isVertical ? [inner.x0, inner.x1] : [inner.y0, inner.y1])
			.padding(0.15)

		return cartesian({
			xScale: isVertical ? (categoryScale as unknown as PositionScale) : null,
			yScale: isVertical ? null : (categoryScale as unknown as PositionScale),
			xAxisConfig: isVertical ? channelConfigs.x : undefined,
			yAxisConfig: isVertical ? undefined : channelConfigs.y,
			xLabel: isVertical ? labels.xAxisTitle ?? categoryField ?? "" : "",
			yLabel: isVertical ? "" : labels.yAxisTitle ?? categoryField ?? "",
			xFieldType: isVertical ? "categorical" : null,
			yFieldType: isVertical ? null : "categorical",
			showXAxis: isVertical ? showX : false,
			showYAxis: isVertical ? false : showY,
			// Match the other renderers: when PlotCanvas draws the shared
			// title outside the panel grid, it passes `showXAxisTitle: false`
			// here so the per-panel title doesn't double up. Default `true`
			// when the prop isn't set (single-panel non-PlotCanvas paths).
			showXAxisTitle: props.showXAxisTitle ?? true,
			showYAxisTitle: props.showYAxisTitle ?? true,
			tickFont,
			xAxisTitleFont,
			yAxisTitleFont,
		})
	}

	const tooltip = hovered ? <HoverTooltip state={hovered} /> : null

	const onSliceHover = (
		stack: Stack,
		slice: Stack["slices"][number],
		event: React.MouseEvent
	) => {
		if (!aggregation || aggregation.kind !== "ok") return
		const fields: TooltipState["fields"] = []
		// `pies` mode synthesises a single category, so the field name is empty;
		// suppress that row in the tooltip to avoid an awkward `:` line.
		if (aggregation.categoryField) {
			fields.push({ name: aggregation.categoryField, value: stack.category })
		}
		fields.push({ name: aggregation.measureField, value: slice.value })
		for (const [channel, value] of Object.entries(slice.groupValues)) {
			const fieldName = encodings[channel as keyof typeof encodings]?.field
			if (fieldName) fields.push({ name: fieldName, value })
		}
		setHovered({
			clientX: event.clientX,
			clientY: event.clientY,
			fields,
		})
		// Highlight this wedge's series (recolor / outline / fade) exactly like
		// hovering its legend entry.
		markHover.enter(slice.groupValues.hue)
	}

	const marksBody = (ctx: PlotContext) => {
		if (!aggregation || aggregation.kind !== "ok") return null
		if (ctx.coord.kind !== "cartesian") return null

		// Single-pie mode: no category axis, one pie centered in the
		// inner rect. The single stack produced by the synthetic
		// categoryField feeds straight into `buildWedges`.
		if (aggregation.mode === "pies") {
			const w = ctx.inner.x1 - ctx.inner.x0
			const h = ctx.inner.y1 - ctx.inner.y0
			const basePieRadius = Math.min(w, h) * 0.45
			// "Size panels by unit" scales the radius by 0..1 (largest
			// panel = 1, smaller panels proportional to their slice
			// total). Floor at 4 px so a panel never disappears.
			const radiusScale =
				props.radiusScale != null && props.radiusScale > 0
					? Math.min(1, props.radiusScale)
					: 1
			const pieRadius = Math.max(4, basePieRadius * radiusScale)
			const cx = (ctx.inner.x0 + ctx.inner.x1) / 2
			const cy = (ctx.inner.y0 + ctx.inner.y1) / 2
			return (
				<g
				onMouseLeave={() => {
					setHovered(null)
					markHover.leave()
				}}
			>
					{buildSinglePieWedges({
						stacks: aggregation.stacks,
						aestheticScales,
						channelConfigs,
						cx,
						cy,
						pieRadius,
						onSliceHover,
						highlight: legendHighlight,
					})}
					{anyDataLabelsMapped && (
						<DataLabelsLayer
							rows={rowsForChart}
							xScale={ctx.coord.scales.xScale}
							yScale={ctx.coord.scales.yScale}
							xType={"quantitative"}
							yType={"quantitative"}
							positionGate="polar"
							anchors={buildPieAnchors({
								stacks: aggregation.stacks,
								pieCenters: [{ stackKey: null, cx, cy }],
								pieRadius,
								measureField: aggregation.measureField,
								categoryField: aggregation.categoryField,
								decimals: dataLabelsDecimals,
								formatSpec: dataLabelsFormatSpec,
								sizeField: dataLabels?.size?.field ?? null,
								encodings,
								rows: rowsForChart,
								arc: resolvePieArc(channelConfigs.angle),
								labelRadiusPct: dataLabelsRadiusPct,
								labelAngleDeg: dataLabelsCfg?.polarLabelAngle,
							})}
						/>
					)}
				</g>
			)
		}

		const categoryScale = (aggregation.isVertical
			? ctx.coord.scales.xScale
			: ctx.coord.scales.yScale) as unknown as ReturnType<
			typeof scaleBand<string>
		> | null
		if (!categoryScale) return null

		const bandSize = categoryScale.bandwidth()
		const perpendicular = aggregation.isVertical
			? ctx.inner.y1 - ctx.inner.y0
			: ctx.inner.x1 - ctx.inner.x0
		// Pies get 90% of the smaller of their band slot and the perpendicular
		// plot dimension, so they don't overflow on either axis.
		const pieRadius = Math.max(4, Math.min(bandSize, perpendicular) * 0.45)
		const perpCenter = aggregation.isVertical
			? (ctx.inner.y0 + ctx.inner.y1) / 2
			: (ctx.inner.x0 + ctx.inner.x1) / 2

		// Per-pie center coordinates — same math `buildWedges` uses to
		// position each band's wedge. We pre-compute them so the anchor
		// builder doesn't need to know about scaleBand internals.
		const pieCenters = aggregation.stacks.map((stack) => {
			const bandPos = categoryScale(stack.category) ?? 0
			const bandCenter = bandPos + bandSize / 2
			return {
				stackKey: stack.category,
				cx: aggregation.isVertical ? bandCenter : perpCenter,
				cy: aggregation.isVertical ? perpCenter : bandCenter,
			}
		})

		return (
			<g
				onMouseLeave={() => {
					setHovered(null)
					markHover.leave()
				}}
			>
				{buildWedges({
					aggregation,
					aestheticScales,
					channelConfigs,
					categoryScale,
					bandSize,
					pieRadius,
					perpCenter,
					onSliceHover,
					highlight: legendHighlight,
				})}
				{anyDataLabelsMapped && (
					<DataLabelsLayer
						rows={rowsForChart}
						xScale={ctx.coord.scales.xScale}
						yScale={ctx.coord.scales.yScale}
						xType={"quantitative"}
						yType={"quantitative"}
						positionGate="polar"
						anchors={buildPieAnchors({
							stacks: aggregation.stacks,
							pieCenters,
							pieRadius,
							measureField: aggregation.measureField,
							categoryField: aggregation.categoryField,
							decimals: dataLabelsDecimals,
							formatSpec: dataLabelsFormatSpec,
							sizeField: dataLabels?.size?.field ?? null,
							encodings,
							rows: rowsForChart,
							arc: resolvePieArc(channelConfigs.angle),
						})}
					/>
				)}
			</g>
		)
	}

	// `props.inner` is optional — Plot falls back to DEFAULT_RENDERER_INNER
	return (
		<Plot
			inner={props.inner}
			coord={coord}
			tooltip={tooltip}
			patternDefs={patternDefs}
		>
			{marksBody}
		</Plot>
	)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BuildWedgesArgs = {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
	categoryScale: ReturnType<typeof scaleBand<string>>
	bandSize: number
	pieRadius: number
	perpCenter: number
	onSliceHover?: SliceHoverHandler
	highlight: LegendHighlight | null
}

/** Callback fired when a wedge is hovered. The event carries viewport
 * coords (`clientX`/`clientY`) so the tooltip can portal to document.body
 * without inheriting the chart's clipping ancestors. */
type SliceHoverHandler = (
	stack: Stack,
	slice: Stack["slices"][number],
	event: React.MouseEvent
) => void

/** Render one `<path>` wedge per stack slice using `d3-shape`'s arc generator.
 * Each pie's total is the sum of its slice values, and each slice's sweep is
 * `value / total * 2π` walked cumulatively. Colors resolve through the hue →
 * saturation → brightness → pattern → opacity pipeline, matching the legacy
 * mark code. */
const buildWedges = ({
	aggregation,
	aestheticScales,
	channelConfigs,
	categoryScale,
	bandSize,
	pieRadius,
	perpCenter,
	onSliceHover,
	highlight,
}: BuildWedgesArgs): React.ReactNode[] => {
	const deps = resolveWedgeDeps(
		aestheticScales,
		channelConfigs,
		pieRadius,
		highlight
	)
	const wedges: React.ReactNode[] = []
	aggregation.stacks.forEach((stack) => {
		const bandPos = categoryScale(stack.category) ?? 0
		const bandCenter = bandPos + bandSize / 2
		const cx = aggregation.isVertical ? bandCenter : perpCenter
		const cy = aggregation.isVertical ? perpCenter : bandCenter
		wedges.push(...renderWedgesForStack(stack, cx, cy, deps, onSliceHover))
	})
	return wedges
}

type SinglePieArgs = {
	stacks: Stack[]
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
	cx: number
	cy: number
	pieRadius: number
	onSliceHover?: SliceHoverHandler
	highlight: LegendHighlight | null
}

/** Render the wedges for a single centered pie. Used by `pies` mode (no x/y
 * mapping) — the aggregation produces exactly one stack whose slices are the
 * pie wedges. */
const buildSinglePieWedges = ({
	stacks,
	aestheticScales,
	channelConfigs,
	cx,
	cy,
	pieRadius,
	onSliceHover,
	highlight,
}: SinglePieArgs): React.ReactNode[] => {
	const deps = resolveWedgeDeps(
		aestheticScales,
		channelConfigs,
		pieRadius,
		highlight
	)
	const wedges: React.ReactNode[] = []
	stacks.forEach((stack) => {
		wedges.push(...renderWedgesForStack(stack, cx, cy, deps, onSliceHover))
	})
	return wedges
}

/** Per-slice DataLabelAnchor builder for pies. Each slice gets one
 *  anchor positioned at the slice's centroid in screen coordinates —
 *  midRadius is 65% of pieRadius so the label sits comfortably within
 *  the wedge area without crowding the outer edge. Geometry mirrors
 *  `renderWedgesForStack`'s running-angle math so anchors land at the
 *  same midpoints as the rendered wedges.
 *
 *  When the user mapped `size` on the data-labels layer, we sum the
 *  size field across rows that match each slice's (category +
 *  groupValues) signature so the rendered label font size varies per
 *  slice — same aggregation rule BarPlot's anchors use. */
export const buildPieAnchors = ({
	stacks,
	pieCenters,
	pieRadius,
	measureField,
	categoryField,
	decimals,
	formatSpec,
	sizeField,
	encodings,
	rows,
	arc,
	labelRadiusPct,
	labelAngleDeg,
}: {
	stacks: Stack[]
	pieCenters: ReadonlyArray<{
		stackKey: string | null
		cx: number
		cy: number
	}>
	pieRadius: number
	measureField: string
	categoryField: string | null
	decimals: number | null
	/** The mapped value field's Label format spec (from
	 *  `DataLabelsConfig.fieldFormats`); wins over `decimals` when set. */
	formatSpec?: string | null
	sizeField?: string | null
	encodings?: Encodings
	rows?: ReadonlyArray<Record<string, unknown>>
	/** Angular bounds (radians) of the pie sweep — must match the wedges'
	 *  (`resolvePieArc`) so labels land at the same midpoints. Defaults to a
	 *  full circle starting at 12 o'clock. */
	arc?: { start: number; sweep: number }
	/** Label distance from center as a PERCENT of `pieRadius` (Data Labels'
	 *  `polarLabelRadius`). Defaults to 100 — the pie's border. */
	labelRadiusPct?: number
	/** Angular nudge in DEGREES added to every label's midpoint angle (Data
	 *  Labels' `polarLabelAngle`). Positive = clockwise. Defaults to 0. */
	labelAngleDeg?: number
}): DataLabelAnchor[] => {
	const anchors: DataLabelAnchor[] = []
	const midRadius = pieRadius * ((labelRadiusPct ?? 100) / 100)
	const angleOffset = ((labelAngleDeg ?? 0) * Math.PI) / 180
	const arcStart = arc?.start ?? 0
	const arcSweep = arc?.sweep ?? Math.PI * 2
	stacks.forEach((stack, stackIdx) => {
		const center =
			pieCenters.find((c) => c.stackKey === stack.category) ??
			pieCenters[stackIdx]
		if (!center) return
		const total = stack.slices.reduce((acc, s) => acc + s.value, 0)
		if (total <= 0) return
		let runningAngle = arcStart
		stack.slices.forEach((slice) => {
			const sweep = (slice.value / total) * arcSweep
			const startAngle = runningAngle
			const endAngle = runningAngle + sweep
			runningAngle = endAngle
			const midAngle = (startAngle + endAngle) / 2 + angleOffset
			// d3 arc convention: angle 0 = 12 o'clock, growing clockwise.
			// Screen coords: y grows down, so cos drives the y offset
			// negatively at angle 0 (top) and positively at angle π (bottom).
			const cx = center.cx + Math.sin(midAngle) * midRadius
			const cy = center.cy - Math.cos(midAngle) * midRadius
			const labelValue = slice.textValue ?? slice.value
			const formatted = formatSingleLabel(labelValue, formatSpec, decimals)
			const hueValue = slice.groupValues.hue
			// Aggregate the size field across rows in this slice (matching
			// category + groupValues). Same shape as `buildBarAnchors`.
			// `categoryField` is null for single-pie mode (incl. faceted
			// single pies) — there all rows belong to the one pie, so we skip
			// the category filter and match slices by group values alone.
			let sizeValue: number | string | undefined
			if (sizeField && encodings && rows) {
				let sum = 0
				let foundNumeric = false
				let firstNonNumeric: string | undefined
				for (const row of rows) {
					if (categoryField && String(row[categoryField]) !== stack.category)
						continue
					let matches = true
					for (const [channel, value] of Object.entries(slice.groupValues)) {
						const fieldName =
							encodings[channel as keyof typeof encodings]?.field
						if (!fieldName) continue
						if (String(row[fieldName]) !== value) {
							matches = false
							break
						}
					}
					if (!matches) continue
					const raw = row[sizeField]
					const n = Number(raw)
					if (Number.isFinite(n)) {
						sum += n
						foundNumeric = true
					} else if (firstNonNumeric === undefined && raw !== undefined) {
						firstNonNumeric = String(raw)
					}
				}
				sizeValue = foundNumeric ? sum : firstNonNumeric
			}
			void measureField // measureField currently unused — slice.value already carries the aggregated measure
			anchors.push({
				cx,
				cy,
				key: `${stack.category}|${slice.key}`,
				label: formatted,
				hueValue,
				sizeValue,
			})
		})
	})
	return anchors
}

type WedgeDeps = {
	outlineColor: string
	outlineWidth: number
	defaultFill: string
	patternBgFallback: string
	/** Per-slice fill / pattern / opacity resolves through the shared
	 *  `resolveLayerColor` pipeline, which consumes these two directly. */
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
	/** Absolute border opacity from the Border opacity slot (slices are
	 *  aggregated, so a field-mapped border resolves to the slot's level). */
	borderOpacity: number
	arcGen: ReturnType<typeof d3arc<{ startAngle: number; endAngle: number }>>
	arcStart: number
	arcSweep: number
	/** Legend-hover highlight state; wedges whose group value doesn't match the
	 * hovered legend entry are dimmed. `null` = nothing hovered. */
	highlight: LegendHighlight | null
}

/** Angular bounds (radians) for a pie/donut, derived from the Angle
 *  channel's min/max degrees. Mirrors radar's `resolveAngleBounds`: the
 *  default (-180°, 180°) maps to the canonical 0 → 2π full circle starting
 *  at 12 o'clock — so existing pies render unchanged — while any other
 *  pair is honored verbatim, enabling partial sweeps and gauge charts
 *  (e.g. 0°/180° for a bottom semicircle). d3-arc draws clockwise from
 *  `start`, so a negative sweep (max < min) winds counter-clockwise. */
const resolvePieArc = (
	angleCfg: ChannelConfigs["angle"]
): { start: number; sweep: number } => {
	const minDeg = angleCfg?.minAngle ?? DEFAULT_ANGLE_CONFIG.minAngle
	const maxDeg = angleCfg?.maxAngle ?? DEFAULT_ANGLE_CONFIG.maxAngle
	if (
		minDeg === DEFAULT_ANGLE_CONFIG.minAngle &&
		maxDeg === DEFAULT_ANGLE_CONFIG.maxAngle
	) {
		return { start: 0, sweep: Math.PI * 2 }
	}
	const start = (minDeg * Math.PI) / 180
	return { start, sweep: (maxDeg * Math.PI) / 180 - start }
}

const resolveWedgeDeps = (
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs,
	pieRadius: number,
	highlight: LegendHighlight | null
): WedgeDeps => ({
	highlight,
	outlineColor: channelConfigs.shape?.outlineColor ?? "#ffffff",
	outlineWidth: channelConfigs.shape?.outlineWidth ?? 1,
	defaultFill: channelConfigs.defaultFill ?? FALLBACK_FILL,
	patternBgFallback: channelConfigs.pattern?.backgroundColor ?? "#e2e8f0",
	aestheticScales,
	channelConfigs,
	borderOpacity: slotOpacityResolver("border", channelConfigs, aestheticScales)({}),
	arcGen: d3arc<{ startAngle: number; endAngle: number }>()
		// Donut hole: `angle.donutHoleRadius` is a 0–90 percentage of the
		// outer radius. 0 (or unset) keeps innerRadius at 0 → solid pie.
		.innerRadius(
			pieRadius *
				(Math.min(Math.max(channelConfigs.angle?.donutHoleRadius ?? 0, 0), 90) /
					100)
		)
		.outerRadius(pieRadius),
	arcStart: resolvePieArc(channelConfigs.angle).start,
	arcSweep: resolvePieArc(channelConfigs.angle).sweep,
})

/** Render the wedges belonging to a single stack (= a single pie) centered at
 * (cx, cy). Extracted so the multi-pie band path and the single-pie centered
 * path share the per-slice color / pattern / opacity pipeline. */
const renderWedgesForStack = (
	stack: Stack,
	cx: number,
	cy: number,
	deps: WedgeDeps,
	onSliceHover?: SliceHoverHandler
): React.ReactNode[] => {
	const total = stack.slices.reduce((acc, s) => acc + s.value, 0)
	if (total <= 0) return []

	const nodes: React.ReactNode[] = []
	let runningAngle = deps.arcStart
	stack.slices.forEach((slice) => {
		const sweep = (slice.value / total) * deps.arcSweep
		const startAngle = runningAngle
		const endAngle = runningAngle + sweep
		runningAngle = endAngle

		// Fill / pattern / opacity resolve through the shared pipeline —
		// hue → sat/bri modulation → pattern (ink keyed on the
		// pre-modulation hue color) → opacity. Same helper the bars/areas
		// renderers use, so the pie can never drift from them (or from the
		// pattern-defs pass, which shares the same color resolution).
		const resolved = resolveLayerColor({
			groupValues: slice.groupValues,
			defaultFill: deps.defaultFill,
			patternBgFallback: deps.patternBgFallback,
			aestheticScales: deps.aestheticScales,
			channelConfigs: deps.channelConfigs,
		})
		const baseFillProp = layerFillProp(resolved)
		// Legend-hover highlight: recolor / outline the matched wedge, fade rest.
		const mh = groupHighlight(
			deps.highlight,
			slice.groupValues,
			deps.aestheticScales
		)
		const opacity = resolved.opacity * mh.opacityMul
		const fillProp = mh.fill ?? baseFillProp

		const d = deps.arcGen({ startAngle, endAngle })
		if (d === null) return

		nodes.push(
			<path
				key={`${stack.category}|${slice.key}`}
				d={d}
				transform={`translate(${cx},${cy})`}
				fill={fillProp}
				fillOpacity={opacity}
				stroke={mh.outline ?? deps.outlineColor}
				strokeOpacity={mh.outline ? 1 : deps.borderOpacity}
				strokeWidth={
					mh.outline
						? Math.max(deps.outlineWidth, mh.outlineWidth)
						: deps.outlineWidth
				}
				onMouseEnter={
					onSliceHover ? (e) => onSliceHover(stack, slice, e) : undefined
				}
			/>
		)
	})
	return nodes
}

