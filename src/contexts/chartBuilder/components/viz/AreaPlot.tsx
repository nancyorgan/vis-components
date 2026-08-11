import { useMemo, useState } from "react"
import { scaleBand, scaleLinear } from "d3-scale"
import { useAtomValue } from "jotai"
import { aggregateStacks, type GroupEncoding } from "../../lib/aggregateBars"
import type { Stack } from "../../lib/aggregators/stacks"
import {
	buildPatternDefs,
	stacksToGroupValues,
} from "../../lib/buildPatternDefs"
import { buildLinePath } from "../../lib/linePath"
import {
	DEFAULT_CONNECTION_CONFIG,
	type ChannelConfigs,
	type LineDashPattern,
	type StackMode,
} from "../../lib/channelConfig"
import { getChartMode } from "../../lib/chartMode"
import type { MeasureAxisRendererProps } from "../../lib/chartRendererProps"
import { resolveConnectionStroke } from "../../lib/connectionStroke"
import { resolveConnectionThickness } from "../../lib/connectionThickness"
import { cartesian } from "../../lib/coords"
import {
	dashArrayFor,
	dashSpecForPatternValue,
	resolveDashGapColor,
	resolveDashGapFill,
	sanitizeCustomDasharray,
} from "../../lib/dashPatterns"
import { splitPolylineAtRange } from "../../lib/dashRange"
import { sampleConnectionPointIndices } from "../../lib/dataLabelsLayout"
import { sortByDrawOrder } from "../../lib/drawOrder"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import type { PatternDefSpec } from "../../lib/patternDefs"
import { inkPaletteForHue } from "../../lib/patterns"
import {
	resolveLayerColor,
	slotOpacityResolver,
} from "../../lib/resolveLayerColor"
import {
	makePositionScale,
	parseNumericCell,
	parseValue,
	type PositionScale,
} from "../../lib/scales"
import { resolveStackMode } from "../../lib/stackMode"
import { formatSingleLabel } from "../../lib/dataLabelsStyle"
import type { DatasetView, Encodings, FieldType } from "../../lib/types"
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
	type MarkHighlight,
} from "../../store/useLegendHighlight"

import { DataLabelsLayer, type DataLabelAnchor } from "./DataLabelsLayer"
import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import { Plot, type CoordFactory, type PlotContext } from "./Plot"

const FALLBACK_FILL = "#6b7280"

type AreaPlotProps = MeasureAxisRendererProps

type Aggregation =
	| {
			kind: "ok"
			mode: "areas-x" | "areas-y"
			isVertical: boolean
			categoryField: string
			/** The field supplying the measure value. For length-based area
			 * charts this is the `length` encoding's field; for the y-based
			 * areas-x variant it's the `y` encoding's field. */
			measureField: string
			categoryType: FieldType
			measureType: FieldType
			stacks: Stack[]
			scaleCategories: string[]
			measureMin: number
			measureMax: number
	  }
	| {
			kind: "error"
			message: string
	  }

/** Resolve the measure-field name for an area chart from the encodings.
 *   - areas-y always uses `length` (orientation-fixed: category on y, measure on x).
 *   - areas-x uses `length` when mapped, otherwise falls back to `y`. The
 *     detect predicate guarantees exactly one of length/y is mapped for the
 *     areas-x mode. */
export const resolveAreaMeasureField = (
	mode: "areas-x" | "areas-y",
	encodings: {
		length: { field: string | null }
		y: { field: string | null }
	}
): string | null => {
	if (mode === "areas-y") return encodings.length.field
	return encodings.length.field ?? encodings.y.field
}

export const AreaPlot = (props: AreaPlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataLabels = useAtomValue(currentDataLabelsEncodingsAtom)
	const dataLabelsCfg = useAtomValue(currentDataLabelsConfigAtom)
	const dataLabelsDecimals = dataLabelsCfg?.decimals ?? null
	// The mapped value field's Label format spec — layer labels show that
	// field's aggregate (textValue), so its per-field format applies.
	const dataLabelsFormatSpec = dataLabels?.value?.field
		? (dataLabelsCfg?.fieldFormats?.[dataLabels.value.field] ?? null)
		: null
	const anyDataLabelsMapped = Boolean(
		dataLabels?.x?.field ||
		dataLabels?.y?.field ||
		dataLabels?.value?.field ||
		dataLabels?.hue?.field ||
		dataLabels?.size?.field
	)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
	const legendHighlight = useLegendHighlight()
	const markHover = useMarkHoverHighlight(aestheticScales.hue?.field.name ?? null)
	const [hovered, setHovered] = useState<TooltipState | null>(null)

	const showX = props.showXAxis !== false
	const showY = props.showYAxis !== false
	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)
	// Per-axis scale rows so shared scaling on one axis (e.g. shareY="all"
	// for the measure axis) doesn't leak into the other (category) axis.
	// See BarPlot for the analogous setup + rationale.
	const rowsForXScale =
		props.scalesRowsOverrideX ?? props.scalesRowsOverride ?? rowsForChart
	const rowsForYScale =
		props.scalesRowsOverrideY ?? props.scalesRowsOverride ?? rowsForChart

	const aggregation = useMemo<Aggregation | null>(() => {
		if (!dataset) return null
		const mode = getChartMode(encodings)
		if (mode !== "areas-x" && mode !== "areas-y") return null
		const categoryField =
			mode === "areas-x" ? encodings.x.field : encodings.y.field
		const measureField = resolveAreaMeasureField(mode, encodings)
		if (!categoryField || !measureField) return null

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

		// Per-channel user-pinned level order so stacked layers order the same
		// way the legend lists them (see BarPlot for the analogous setup).
		const groupOrders: Partial<Record<GroupEncoding["channel"], readonly string[]>> = {}
		for (const g of groups) {
			const order = levelOrders[g.field]
			if (order) groupOrders[g.channel] = order
		}

		const categoryType = effectiveType(dataset, categoryField, overrides)
		const measureType = effectiveType(dataset, measureField, overrides)

		// Surface the user's DataLabels value field so each slice carries a
		// `textValue`. Without this, area-mode labels collapse to the
		// measure value (`slice.value`) — which is "the y-axis number" the
		// user reported as ignoring their value-encoding choice. Bars
		// already passed this through; areas just hadn't caught up.
		const textField = dataLabels?.value?.field ?? undefined
		const textType = textField
			? effectiveType(dataset, textField, overrides)
			: undefined

		const result = aggregateStacks({
			rows: rowsForChart,
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

		// Split per-axis aggregation (same rationale as BarPlot): categories
		// from the category-axis rows source, measureMax from the measure-
		// axis source.
		const isVertical = mode === "areas-x"
		const categoryRows = isVertical ? rowsForXScale : rowsForYScale
		const measureRows = isVertical ? rowsForYScale : rowsForXScale
		const aggOnce = (rows: typeof rowsForChart) =>
			aggregateStacks({
				rows,
				categoryField,
				lengthField: measureField,
				categoryType,
				lengthType: measureType,
				groups,
				categoryOrder: levelOrders[categoryField],
				groupOrders,
			})
		const catAggregation =
			categoryRows === rowsForChart ? result : aggOnce(categoryRows)
		const measureAggregation =
			measureRows === rowsForChart
				? result
				: measureRows === categoryRows
					? catAggregation
					: aggOnce(measureRows)
		const scaleCategories =
			"error" in catAggregation ? result.categories : catAggregation.categories
		const scaleStacks =
			"error" in measureAggregation
				? result.stacks
				: measureAggregation.stacks
		// Areas render "group" as "overlay" — side-by-side areas aren't
		// meaningful. Both reduce the max to the largest single slice.
		// stackMode defaults to "stack" via the resolver (same as bars);
		// unified per spec §15.2.
		const stackMode: StackMode = resolveStackMode(channelConfigs, encodings)
		const measureMax =
			props.measureMaxOverride ?? computeAreaMeasureMax(scaleStacks, stackMode)
		const measureMin = props.measureMinOverride ?? 0

		// For continuous (quantitative/temporal) category fields, sort stacks
		// so the polygon path walks left-to-right along the category axis.
		// Categorical / ordinal-string categories keep the encounter order from
		// aggregateStacks.
		const sortedStacks =
			categoryType === "quantitative" || categoryType === "temporal"
				? sortStacksByParsedCategory(result.stacks, categoryType)
				: result.stacks

		return {
			kind: "ok",
			mode,
			isVertical: mode === "areas-x",
			categoryField,
			measureField,
			categoryType,
			measureType,
			stacks: sortedStacks,
			scaleCategories,
			measureMin,
			measureMax,
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately fine-grained channelConfigs sub-keys: only the listed keys affect stack aggregation; depending on the whole object would recompute on every cosmetic config change
	}, [
		dataset,
		encodings,
		overrides,
		rowsForChart,
		rowsForXScale,
		rowsForYScale,
		aestheticScales,
		channelConfigs.hue,
		levelOrders,
		props.measureMaxOverride,
		props.measureMinOverride,
		// Recompute when the user picks a different DataLabels.value field
		// — without this the per-slice `textValue` aggregate goes stale and
		// labels keep showing the previous mapping.
		dataLabels?.value?.field,
	])

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
		const {
			isVertical,
			scaleCategories,
			measureMin,
			measureMax,
			categoryField,
			measureField,
			categoryType,
			measureType,
		} = aggregation
		const categoryRange: [number, number] = isVertical
			? [inner.x0, inner.x1]
			: [inner.y0, inner.y1]
		const categoryScale = buildCategoryScale(
			scaleCategories,
			categoryType,
			categoryRange
		)
		const measureScale = scaleLinear<number, number>()
			.domain([measureMin, measureMax])
			.range(isVertical ? [inner.y1, inner.y0] : [inner.x0, inner.x1])
			.nice()

		const xScale: PositionScale = isVertical ? categoryScale : measureScale
		const yScale: PositionScale = isVertical ? measureScale : categoryScale

		return cartesian({
			xScale,
			yScale,
			xAxisConfig: channelConfigs.x,
			yAxisConfig: channelConfigs.y,
			xLabel: isVertical
				? labels.xAxisTitle ?? categoryField
				: labels.xAxisTitle ?? measureField,
			yLabel: isVertical
				? labels.yAxisTitle ?? measureField
				: labels.yAxisTitle ?? categoryField,
			xFieldType: isVertical ? categoryType : measureType,
			yFieldType: isVertical ? measureType : categoryType,
			showXAxis: showX,
			showYAxis: showY,
			tickFont,
			xAxisTitleFont,
			yAxisTitleFont,
			xAxisTitleAlignment: labels.titleAlignments?.xAxisTitle,
			yAxisTitleAlignment: labels.titleAlignments?.yAxisTitle,
			yAxisTitleHorizontal: labels.yAxisTitleHorizontal,
			showXAxisTitle: props.showXAxisTitle ?? true,
			showYAxisTitle: props.showYAxisTitle ?? true,
		})
	}

	const tooltip = hovered ? <HoverTooltip state={hovered} /> : null

	const onLayerHover = (
		groupValues: Partial<Record<string, string>>,
		event: React.MouseEvent
	) => {
		// Highlight this layer's series (recolor / outline / fade) exactly like
		// hovering its legend entry.
		markHover.enter(groupValues.hue)
		const fields: TooltipState["fields"] = []
		const namesPushed = new Set<string>()
		for (const [channel, value] of Object.entries(groupValues)) {
			const fieldName = encodings[channel as keyof typeof encodings]?.field
			if (fieldName && !namesPushed.has(fieldName)) {
				fields.push({ name: fieldName, value })
				namesPushed.add(fieldName)
			}
		}
		// Spec §10 / §15.5: surface unmapped dataset fields too. For an
		// area layer (which spans the full x-axis), pick the first row
		// matching the layer's groupValues as the representative — gives
		// the user something to substitute into custom HTML templates and
		// the default checkbox tooltip.
		if (dataset) {
			const matchesLayer = (row: Record<string, unknown>): boolean => {
				for (const [channel, value] of Object.entries(groupValues)) {
					const fieldName =
						encodings[channel as keyof typeof encodings]?.field
					if (!fieldName) continue
					if (String(row[fieldName]) !== value) return false
				}
				return true
			}
			const repRow = rowsForChart.find(matchesLayer)
			if (repRow) {
				for (const f of dataset.fields) {
					if (namesPushed.has(f.name)) continue
					fields.push({ name: f.name, value: repRow[f.name] ?? "" })
					namesPushed.add(f.name)
				}
			}
		}
		if (fields.length === 0) return
		setHovered({
			clientX: event.clientX,
			clientY: event.clientY,
			fields,
		})
	}

	const marksBody = (ctx: PlotContext) => {
		if (!aggregation || aggregation.kind !== "ok") return null
		if (ctx.coord.kind !== "cartesian") return null
		const { xScale, yScale } = ctx.coord.scales
		if (!xScale || !yScale) return null
		const categoryScale = aggregation.isVertical ? xScale : yScale
		const measureScale = (
			aggregation.isVertical ? yScale : xScale
		) as ReturnType<typeof scaleLinear<number, number>>
		const stackMode: StackMode = resolveStackMode(channelConfigs, encodings)
		// A mapped label column (distinct from the measure) is authoritative:
		// layers where it's blank get NO label — sparse columns are the way to
		// label a single arbitrary point, so blanks must never fall back to
		// the measure. Mirrors the aggregator's own textValue condition.
		const labelField = dataLabels?.value?.field
		const valueFieldMapped = Boolean(
			labelField && labelField !== aggregation.measureField
		)
		return (
			<g
				onMouseLeave={() => {
					setHovered(null)
					markHover.leave()
				}}
			>
				{buildAreas({
					aggregation,
					aestheticScales,
					channelConfigs,
					categoryScale,
					measureScale,
					stackMode,
					onLayerHover,
					highlight: legendHighlight,
					dataset,
					drawOrderLevels: channelConfigs.drawOrder?.field
						? levelOrders[channelConfigs.drawOrder.field]
						: undefined,
				})}
				{anyDataLabelsMapped && (
					<DataLabelsLayer
						rows={rowsForChart}
						xScale={xScale}
						yScale={yScale}
						xType={aggregation.isVertical ? "categorical" : "quantitative"}
						yType={aggregation.isVertical ? "quantitative" : "categorical"}
						// Anchor labels at the visible top edge of each layer
						// in each stack — respects stack/overlay so labels
						// stay aligned with the rendered polygon edges
						// instead of falling on raw row positions (which
						// ignored stackMode entirely).
						anchors={buildAreaAnchors({
							aggregation,
							categoryScale,
							measureScale,
							stackMode,
							decimals: dataLabelsDecimals,
							formatSpec: dataLabelsFormatSpec,
							sizeField: dataLabels?.size?.field ?? null,
							encodings,
							rows: rowsForChart,
							valueFieldMapped,
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

/** Build the per-row category scale. For categorical / ordinal-string
 * category types we use `scaleBand` (mirrors bars) so segments anchor to a
 * band center; for quantitative / temporal / ordinal-numeric types we use
 * `makePositionScale` so area polygons trace the actual continuous axis. */
const buildCategoryScale = (
	categories: string[],
	categoryType: FieldType,
	range: [number, number]
): PositionScale => {
	const isContinuous =
		categoryType === "quantitative" || categoryType === "temporal"
	if (isContinuous) {
		// Parse each category string back to its raw numeric/date value so
		// makePositionScale computes a proper continuous domain.
		const parsed = categories
			.map((c) => parseValue(c, categoryType))
			.filter((v) => v !== null) as Array<number | Date>
		return makePositionScale(parsed, categoryType, range)
	}
	if (categoryType === "ordinal") {
		// Ordinal splits in makePositionScale: numeric → scaleLinear, string →
		// scalePoint. Mirror that here so areas look right for ordinal x.
		const parsed = categories
			.map((c) => parseValue(c, "ordinal"))
			.filter((v) => v !== null) as Array<number | string>
		return makePositionScale(parsed, "ordinal", range)
	}
	return scaleBand<string>().domain(categories).range(range).padding(0.15)
}

/** For continuous category axes, walk the polygon left-to-right. Stacks
 * coming out of `aggregateStacks` are in dataset-encounter order, which for
 * unsorted time-series or scatter-ish x values would make the polygon
 * self-intersect. */
const sortStacksByParsedCategory = (
	stacks: Stack[],
	categoryType: FieldType
): Stack[] => {
	const keyed = stacks.map((s) => {
		const parsed = parseValue(s.category, categoryType)
		const sortKey =
			parsed instanceof Date
				? parsed.getTime()
				: typeof parsed === "number"
					? parsed
					: Number.NaN
		return { stack: s, sortKey }
	})
	keyed.sort((a, b) => {
		if (Number.isNaN(a.sortKey) && Number.isNaN(b.sortKey)) return 0
		if (Number.isNaN(a.sortKey)) return 1
		if (Number.isNaN(b.sortKey)) return -1
		return a.sortKey - b.sortKey
	})
	return keyed.map((k) => k.stack)
}

/** Apply the category scale to a raw category string, producing the pixel
 * coord at which the layer polygon should pass through for this stack. For
 * scaleBand the coord is the band center (left + bandwidth/2). For
 * continuous scales the coord is the value's scaled position. */
const applyCategoryScale = (
	scale: PositionScale,
	category: string,
	categoryType: FieldType
): number | null => {
	// scaleBand has a `.bandwidth` method; no other position scale does.
	const maybeBand = scale as ReturnType<typeof scaleBand<string>>
	if (typeof maybeBand.bandwidth === "function") {
		const left = maybeBand(category)
		if (left === undefined) return null
		return left + maybeBand.bandwidth() / 2
	}
	const parsed = parseValue(category, categoryType)
	if (parsed === null) return null
	if (parsed instanceof Date) {
		const timeScale = scale as unknown as (d: Date) => number
		return timeScale(parsed)
	}
	if (typeof parsed === "number") {
		const linScale = scale as unknown as (n: number) => number
		return linScale(parsed)
	}
	const pointScale = scale as unknown as (s: string) => number | undefined
	const out = pointScale(String(parsed))
	return out === undefined ? null : out
}

type BuildAreasArgs = {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
	categoryScale: PositionScale
	measureScale: ReturnType<typeof scaleLinear<number, number>>
	stackMode: StackMode
	/** Optional hover callback. Fires on mouseenter for each layer; receives
	 * the layer's group values and the original event so the caller can
	 * pull viewport coords for tooltip placement. */
	onLayerHover?: (
		groupValues: Partial<Record<string, string>>,
		event: React.MouseEvent
	) => void
	/** Legend-hover highlight state; layers whose group value doesn't match
	 * the hovered legend entry are dimmed. `null` = nothing hovered. */
	highlight: LegendHighlight | null
	/** Active dataset — lets the Aesthetics "Draw order" setting rank which
	 * layer paints on top in overlay mode (stack order is load-bearing, so
	 * draw order is a deliberate no-op there). */
	dataset: DatasetView | undefined
	/** User-defined category order for the draw-order field (if any), so
	 * layers rank by legend order rather than alphabetically. */
	drawOrderLevels: readonly string[] | undefined
}

/** Build one `<path>` per layer (= one per unique slice-tuple). For `stack`
 * mode each layer's top edge walks across every stack at its cumulative top
 * and the bottom edge walks back across its cumulative bottom. For
 * `overlay` mode (and `group`, which degrades to overlay for areas) every
 * layer draws from the baseline (measure=0) up to the slice value. Line
 * mode (`fill === "line"`) omits the bottom edge and the close.
 *
 * When `fill === "area"`, a second stroked polyline is rendered along each
 * layer's top edge using `connection.strokeColor` (falling back to each
 * layer's hue color when unset) and `connection.thickness`. Line mode skips
 * this extra stroke because the polyline IS the top edge. */
const buildAreas = ({
	aggregation,
	aestheticScales,
	channelConfigs,
	categoryScale,
	measureScale,
	stackMode,
	onLayerHover,
	highlight,
	dataset,
	drawOrderLevels,
}: BuildAreasArgs): React.ReactNode[] => {
	// Legend-hover highlight: dim a layer whose group value doesn't match the
	// hovered legend entry, mapping the hovered field back to its group channel.
	const layerHighlight = (
		groupValues: Partial<Record<string, string>>
	): MarkHighlight => groupHighlight(highlight, groupValues, aestheticScales)
	const defaultFill = channelConfigs.defaultFill ?? FALLBACK_FILL
	const patternBgFallback = channelConfigs.pattern?.backgroundColor ?? "#e2e8f0"
	const thickness =
		channelConfigs.connection?.thickness ?? DEFAULT_CONNECTION_CONFIG.thickness
	// "square" maps to SVG's butt cap so line ends and dash segments end
	// flush at the data position instead of extending half a stroke-width
	// past it. Mirrors ScatterPlot's renderConnectionLines.
	const strokeCap =
		(channelConfigs.connection?.lineCap ?? "round") === "square"
			? "butt"
			: "round"
	// Line smoothing: 0 (default) builds straight `M/L` edges exactly as
	// before; > 0 rounds the top edge (and, for the fill polygon, the bottom
	// edge too, so stacked layers keep tiling) via a cardinal spline. Shared
	// with ScatterPlot's connection lines through `buildLinePath`.
	const smoothing =
		channelConfigs.connection?.smoothing ??
		DEFAULT_CONNECTION_CONFIG.smoothing ??
		0
	// Build an edge path from points. `continueFrom` emits a leading `L`
	// (instead of `M`) so the segment appends to an open path — used for the
	// area polygon's return baseline.
	const linePathD = (
		pts: Array<{ x: number; y: number }>,
		continueFrom = false,
	): string => {
		if (smoothing > 0) {
			const d = buildLinePath(pts, smoothing)
			return continueFrom ? d.replace(/^M/, "L") : d
		}
		return pts
			.map(
				(p, i) =>
					`${i === 0 ? (continueFrom ? "L" : "M") : "L"} ${p.x} ${p.y}`,
			)
			.join(" ")
	}
	const fillMode =
		channelConfigs.connection?.fill ?? DEFAULT_CONNECTION_CONFIG.fill
	// `null` means inherit from each layer's hue color (the default).
	// A concrete value applies uniformly to every layer's top-edge stroke.
	const strokeOverride =
		channelConfigs.connection?.strokeColor ??
		DEFAULT_CONNECTION_CONFIG.strokeColor
	// Per-hue-value stroke overrides (keyed by hue value when hue is mapped).
	// Take precedence over the global `strokeColor` override so users can tint
	// individual layers. In scatter mode this map is keyed by connection value
	// and serves a different purpose; area mode reads only the hue entries.
	const perValueLineColors =
		channelConfigs.connection?.lineColors ??
		DEFAULT_CONNECTION_CONFIG.lineColors
	// Optional separate palette for layer outlines (line strokes) in
	// area mode. When set, each layer picks its default stroke from this
	// palette by category position; per-value overrides via
	// `lineColors[v]` still win on top.
	const linePalette = channelConfigs.connection?.linePalette ?? null
	// Category order for assigning line-palette colors. Fills resolve their
	// color from the hue VALUE (via the ordinal hue scale), so the line palette
	// must too — otherwise the two disagree. Indexing by render position
	// (`layerIdx`) is wrong here because overlay mode re-sorts layers by peak
	// value (below), decoupling render order from category.
	const hueScaleForLines = aestheticScales.hue?.scale ?? null
	const hueLineOrder: string[] =
		hueScaleForLines?.kind === "categorical"
			? hueScaleForLines.scale.domain()
			: []
	// Per-layer dash pattern + alternate color overrides. ScatterPlot's
	// renderConnectionLines already reads these; the line-fill branch in
	// AreaPlot was missing the wiring, so dashed patterns silently
	// rendered solid (the user-reported "patterns aren't showing" bug).
	const dashPatterns =
		channelConfigs.connection?.dashPatterns ??
		DEFAULT_CONNECTION_CONFIG.dashPatterns
	const dashAlternateColors =
		channelConfigs.connection?.dashAlternateColors ??
		DEFAULT_CONNECTION_CONFIG.dashAlternateColors
	const defaultDashPattern: LineDashPattern =
		channelConfigs.connection?.defaultDashPattern ??
		DEFAULT_CONNECTION_CONFIG.defaultDashPattern
	// The panel's "Custom" default dash: a user-typed dasharray that wins
	// over the swatch pick when it parses; per-layer `dashPatterns`
	// overrides still win over both. Mirrors ScatterPlot.
	const customDashPattern = channelConfigs.connection?.customDashPattern ?? null
	const defaultDashArray =
		(customDashPattern ? sanitizeCustomDasharray(customDashPattern) : null) ??
		dashArrayFor(defaultDashPattern)
	// Pattern encoding → per-layer LINE DASH, mirroring ScatterPlot's
	// connection polylines: each layer's pattern group value resolves via
	// the shared `dashSpecForPatternValue` (custom dasharray > swatch
	// override > DASH_CYCLE auto-cycle by category position). In area mode
	// the pattern channel GROUPS layers, so the value is constant per layer
	// — no within-line runs needed here.
	const patternField = aestheticScales.pattern?.field?.name ?? null
	const patternDashOverrides = channelConfigs.pattern?.dashOverrides ?? {}
	const patternCustomDashOverrides =
		channelConfigs.pattern?.customDashOverrides ?? {}
	const patternDomain = aestheticScales.pattern?.categories ?? []
	// Dash-gap color inputs — the same palette-paired pattern-ink options
	// area patterns resolve their ink from (see `resolveDashGapColor`).
	const { palette: inkPalette, inks: palettePatternInks } = inkPaletteForHue(
		channelConfigs,
		aestheticScales.hue?.field?.type
	)
	const patternInkColors = channelConfigs.pattern?.inkColors ?? {}
	const defaultPatternInk = channelConfigs.defaultPatternInk ?? null
	// Whether dash gaps get the alternate-color underlay (connected
	// two-color line) or stay empty (truly dashed). Auto unless the user
	// chose: filled, except when pattern and hue map the same field.
	const gapFill = resolveDashGapFill({
		configured: channelConfigs.connection?.dashGapFill ?? null,
		patternField,
		hueField: aestheticScales.hue?.field?.name ?? null,
	})
	// "Apply pattern to range": resolve From/To to pixel boundaries on the
	// category axis (the axis the line walks along) once — raw axis values,
	// band scales resolve to the category's center. A value that doesn't
	// parse = unbounded; neither parsing = the range is inert.
	const dashRange = channelConfigs.connection?.dashRange
	const rangeBoundaryPx = (v: number | string | null): number | null =>
		v === null || v === ""
			? null
			: applyCategoryScale(categoryScale, String(v), aggregation.categoryType)
	const rangeMinPx = dashRange?.enabled ? rangeBoundaryPx(dashRange.min) : null
	const rangeMaxPx = dashRange?.enabled ? rangeBoundaryPx(dashRange.max) : null
	const rangeActive =
		dashRange?.enabled === true && (rangeMinPx !== null || rangeMaxPx !== null)
	const rangeAxis: "x" | "y" = aggregation.isVertical ? "x" : "y"
	// Point sampling — same controls that drive ScatterPlot's marker filter.
	const pointSampling =
		channelConfigs.connection?.pointSampling ??
		DEFAULT_CONNECTION_CONFIG.pointSampling
	const pointEveryN =
		channelConfigs.connection?.pointEveryN ??
		DEFAULT_CONNECTION_CONFIG.pointEveryN
	// Area fill = each layer's overall opacity (the Fill subheader = the opacity
	// encoding). Outline/edge/points = the Border opacity slot. Layers are
	// aggregated (no single row), so a field-mapped border resolves to the
	// slot's static level. Opacity slots are absolute.
	const borderOpacity = slotOpacityResolver(
		"border",
		channelConfigs,
		aestheticScales
	)({})
	// Areas have no meaningful "group" mode — degrade to overlay.
	const effectiveStackMode: "stack" | "overlay" =
		stackMode === "stack" ? "stack" : "overlay"

	// Clamp polygon edges to the measure-axis domain so non-default
	// `measureMin`/`measureMax` don't cause fills to bleed outside the plot
	// area. For the default [0, measureMax], clamping is a no-op because stack
	// bottoms are non-negative.
	const { measureMin, measureMax } = aggregation
	const clampToDomain = (v: number) =>
		Math.max(measureMin, Math.min(measureMax, v))

	// Collect the unique layer keys in the order the first stack surfaces
	// each one — mirrors aggregateStacks' slice-key ordering so the bottom-
	// to-top stack order across stacks stays consistent.
	const layerKeys: string[] = []
	const layerMeta = new Map<
		string,
		{ groupValues: Partial<Record<string, string>> }
	>()
	for (const stack of aggregation.stacks) {
		for (const slice of stack.slices) {
			if (!layerKeys.includes(slice.key)) {
				layerKeys.push(slice.key)
				layerMeta.set(slice.key, { groupValues: slice.groupValues })
			}
		}
	}

	// Build a dense per-stack lookup: stack -> slice-key -> value.
	const stackValues = aggregation.stacks.map((stack) => {
		const byKey = new Map<string, number>()
		for (const slice of stack.slices) byKey.set(slice.key, slice.value)
		return { stack, byKey }
	})

	// In overlay mode, every layer draws from the baseline at full opacity,
	// so the last-drawn layer covers anything smaller behind it. In stack mode
	// the order is load-bearing (defines bottom-to-top stacking order), so
	// leave it alone — draw order is a deliberate no-op there, like bars.
	if (effectiveStackMode === "overlay") {
		if (channelConfigs.drawOrder && dataset) {
			// Explicit "Draw order" wins over the peak-value default (mirrors
			// the line-chart series sort and GeoCircleMarks' preserveOrder).
			// Layers are aggregated, so rank each by a representative row built
			// from its group-channel values — draw order by the hue field (the
			// field that defines the layers) is the meaningful case; sorting by
			// a field that doesn't distinguish layers is a stable no-op.
			const groupFieldByChannel: Partial<Record<string, string>> = {}
			for (const ch of [
				"hue",
				"saturation",
				"brightness",
				"pattern",
				"opacity",
			] as const) {
				const name = aestheticScales[ch]?.field?.name
				if (name) groupFieldByChannel[ch] = name
			}
			const rowForLayer = (key: string): Record<string, unknown> => {
				const groupValues = layerMeta.get(key)?.groupValues ?? {}
				const row: Record<string, unknown> = {}
				for (const [ch, field] of Object.entries(groupFieldByChannel)) {
					const v = groupValues[ch]
					if (field && v !== undefined) row[field] = v
				}
				return row
			}
			const ordered = sortByDrawOrder(
				layerKeys,
				rowForLayer,
				channelConfigs.drawOrder,
				dataset,
				drawOrderLevels
			)
			layerKeys.length = 0
			layerKeys.push(...ordered)
		} else {
			// Default: sort by peak value descending — largest layers go behind,
			// smallest on top — so every layer stays visible (smaller ones sit
			// entirely inside larger ones).
			const peakByKey = new Map<string, number>()
			for (const key of layerKeys) {
				let peak = 0
				for (const sv of stackValues) {
					const v = sv.byKey.get(key) ?? 0
					if (v > peak) peak = v
				}
				peakByKey.set(key, peak)
			}
			layerKeys.sort((a, b) => (peakByKey.get(b) ?? 0) - (peakByKey.get(a) ?? 0))
		}
	}

	// Running cumulative bottoms across layers, one per stack index. Only
	// consulted in `stack` mode; in `overlay` every layer starts from 0.
	const bottoms: number[] = Array.from<number>({
		length: stackValues.length,
	}).fill(0)

	// Z-order differs by mode:
	// - Stack: two-pass — all fills first, all separators on top. Otherwise
	//   layer N+1's fill polygon paints over layer N's top-edge separator
	//   (which sits exactly at layer N+1's baseline).
	// - Overlay: pair fill + separator per-layer (interleaved), so layers
	//   above have their separators beneath layers below them visually —
	//   the "fill + its line" stays grouped as one visual unit.
	const fills: React.ReactNode[] = []
	const edges: React.ReactNode[] = []
	const interleaved: React.ReactNode[] = []

	layerKeys.forEach((layerKey, layerIdx) => {
		const meta = layerMeta.get(layerKey)
		const groupValues = meta?.groupValues ?? {}
		const mh = layerHighlight(groupValues)
		const layerResolved = resolveLayerColor({
			groupValues: groupValues as Partial<
				Record<
					"hue" | "saturation" | "brightness" | "pattern" | "opacity",
					string
				>
			>,
			defaultFill,
			patternBgFallback,
			aestheticScales,
			channelConfigs,
		})

		// Compute per-stack tops and the pixel coords for this layer.
		type Point = { px: number; pyTop: number; pyBottom: number }
		const points: Point[] = []
		stackValues.forEach((sv, i) => {
			const value = sv.byKey.get(layerKey) ?? 0
			const bottom = effectiveStackMode === "stack" ? bottoms[i] : 0
			const top = bottom + value
			if (effectiveStackMode === "stack") bottoms[i] = top
			const px = applyCategoryScale(
				categoryScale,
				sv.stack.category,
				aggregation.categoryType
			)
			if (px === null) return
			points.push({
				px,
				pyTop: measureScale(clampToDomain(top)),
				pyBottom: measureScale(clampToDomain(bottom)),
			})
		})

		if (points.length < 2) return

		const fillProp = layerResolved.patternId
			? `url(#${layerResolved.patternId})`
			: layerResolved.fill
		const isVertical = aggregation.isVertical
		// Per-layer stroke: the shared connection-stroke chain (per-hue-value
		// override → line palette → global stroke override → the layer's
		// hue-resolved fill, with the Line color slot owning the color when
		// configured). The line palette is indexed by the hue value's place
		// in the hue domain so strokes pair with fills; render-order
		// `layerIdx` is only the fallback (overlay mode re-sorts layers by
		// peak value, decoupling render order from category).
		const hueValue = groupValues.hue ?? null
		const linePaletteIdx =
			hueValue != null && hueLineOrder.indexOf(hueValue) >= 0
				? hueLineOrder.indexOf(hueValue)
				: layerIdx
		// Build a row from the mapped group channels so a slot mapped to the
		// hue field (the common case) resolves per layer.
		const slotRow: Record<string, unknown> = {}
		for (const ch of ["hue", "outlineHue", "pattern", "opacity"] as const) {
			const f = aestheticScales[ch]?.field?.name
			if (f) slotRow[f] = groupValues[ch]
		}
		const layerStroke = resolveConnectionStroke({
			groupKey: hueValue,
			lineColors: perValueLineColors,
			linePalette,
			paletteIdx: linePaletteIdx,
			strokeColor: strokeOverride,
			fallback: layerResolved.fill,
			lineSlotCfg: channelConfigs.colorSlots?.line,
			lineSlot: aestheticScales.colorSlots.line,
			slotRow,
		})
		// Legend-hover highlight: recolor the line to the highlight fill,
		// outline (and thicken) it when outline is on, and fade non-matched
		// layers. `effStroke` covers both the line-mode stroke and the area
		// edge; the area fill and point markers read `mh.fill` directly.
		const effStroke = mh.outline ?? mh.fill ?? layerStroke
		// Per-layer thickness: a per-value override (keyed by the hue value,
		// matching the stroke/dash per-value maps) when set, else the single
		// `thickness`.
		const layerThickness = resolveConnectionThickness({
			groupKey: hueValue,
			thickness,
			byValue: channelConfigs.connection?.thicknessByValue,
		})
		const effThickness = mh.outline
			? Math.max(layerThickness, mh.outlineWidth)
			: layerThickness

		// Build the d-string. For areas-x the points walk along x and area
		// fills *down* to the baseline; for areas-y the points walk along y
		// and the area fills *right* to the baseline. `measureScale` already
		// knows which axis is the measure one — positions come from
		// (px, pyTop) in category-axis / measure-axis terms.
		const top = points.map((p) =>
			isVertical ? [p.px, p.pyTop] : [p.pyTop, p.px]
		)
		const bottom = points.map((p) =>
			isVertical ? [p.px, p.pyBottom] : [p.pyBottom, p.px]
		)
		const topD = linePathD(top.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 })))

		const onMouseEnter = onLayerHover
			? (e: React.MouseEvent) => onLayerHover(groupValues, e)
			: undefined

		if (fillMode === "line") {
			// Per-layer dash: the pattern channel's per-category resolution
			// when a pattern field is mapped (its group value is constant per
			// layer), behind the legacy per-line override; falls back to the
			// global default (also defaults to "solid"). Mirrors ScatterPlot's
			// renderConnectionLines so the same UI controls drive both
			// renderers.
			const layerDashKey = hueValue ?? layerKey
			const patternValue =
				patternField && groupValues.pattern !== undefined
					? String(groupValues.pattern)
					: null
			const patternSpec =
				patternValue !== null
					? dashSpecForPatternValue(
							patternValue,
							patternDashOverrides,
							patternCustomDashOverrides,
							patternDomain
						)
					: null
			const dashArray =
				patternSpec?.kind === "custom"
					? patternSpec.dasharray
					: dashPatterns[layerDashKey ?? ""] !== undefined
						? dashArrayFor(dashPatterns[layerDashKey ?? ""] ?? "solid")
						: patternSpec?.kind === "pattern"
							? dashArrayFor(patternSpec.pattern)
							: defaultDashArray
			// Solid → one path. Dashed → underlay (alternate color) +
			// dashed top, so the gaps render as the alternate color
			// instead of transparent.
			const lineEls: React.ReactNode[] = []
			if (dashArray === null) {
				lineEls.push(
					<path
						key={layerKey || "__layer__"}
						d={topD}
						fill="none"
						stroke={effStroke}
						strokeWidth={effThickness}
						strokeLinejoin="round"
						strokeLinecap={strokeCap}
						opacity={borderOpacity * mh.opacityMul}
						onMouseEnter={onMouseEnter}
					/>
				)
			} else {
				const altColor = resolveDashGapColor({
					// The hue value IS the panel's gap-swatch key; the layer key
					// covers hue-less layers and legacy saved visuals.
					overrideKeys: [hueValue, layerDashKey],
					patternValue,
					// The layer's pre-highlight stroke — the hue/palette color
					// when the line inherits it, so the pairing lookup can hit.
					lineColor: layerStroke,
					overrides: dashAlternateColors,
					singleOverride: channelConfigs.connection?.dashGapColor ?? null,
					inkColors: patternInkColors,
					palette: inkPalette,
					patternInks: palettePatternInks,
					defaultInk: defaultPatternInk,
				})
				const lineProps = {
					fill: "none",
					strokeWidth: effThickness,
					strokeLinejoin: "round",
					strokeLinecap: strokeCap,
					opacity: borderOpacity * mh.opacityMul,
				} as const
				// "Apply pattern to range": dash only within [From, To] along
				// the category axis, solid outside (known vs forecast). The
				// alternate-color underlay only backs the dashed segment.
				// IGNORED when a pattern field is mapped — the pattern variable
				// already says where each dash applies, and the two windows
				// would conflict (the panel hides the range rows there too).
				if (rangeActive && !patternField) {
					const segs = splitPolylineAtRange(
						top.map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 })),
						rangeMinPx,
						rangeMaxPx,
						rangeAxis
					)
					const dOf = (seg: Array<{ x: number; y: number }>): string =>
						linePathD(seg)
					for (const [part, seg] of [
						["pre", segs.before],
						["post", segs.after],
					] as const) {
						if (seg.length < 2) continue
						lineEls.push(
							<path
								key={`${layerKey || "__layer__"}__${part}`}
								d={dOf(seg)}
								stroke={effStroke}
								onMouseEnter={onMouseEnter}
								{...lineProps}
							/>
						)
					}
					if (segs.inside.length >= 2) {
						// The underlay (painted gaps) is gated on `gapFill` —
						// off = truly dashed segments with empty gaps.
						if (gapFill) {
							lineEls.push(
								<path
									key={`${layerKey || "__layer__"}__bg`}
									d={dOf(segs.inside)}
									stroke={altColor}
									{...lineProps}
								/>
							)
						}
						lineEls.push(
							<path
								key={layerKey || "__layer__"}
								d={dOf(segs.inside)}
								stroke={effStroke}
								strokeDasharray={dashArray}
								onMouseEnter={onMouseEnter}
								{...lineProps}
							/>
						)
					}
				} else {
					if (gapFill) {
						lineEls.push(
							<path
								key={`${layerKey || "__layer__"}__bg`}
								d={topD}
								stroke={altColor}
								{...lineProps}
							/>
						)
					}
					lineEls.push(
						<path
							key={layerKey || "__layer__"}
							d={topD}
							stroke={effStroke}
							strokeDasharray={dashArray}
							onMouseEnter={onMouseEnter}
							{...lineProps}
						/>
					)
				}
			}
			// Point markers — filtered by the user's `pointSampling`
			// preference (mirrors ScatterPlot's behavior). The line
			// itself always passes through every point regardless of
			// sampling.
			const sampledIndices =
				pointSampling === "none"
					? new Set<number>()
					: new Set(
							sampleConnectionPointIndices(
								top.length,
								pointSampling,
								pointEveryN,
							),
						)
			const pointEls = top.flatMap(([x, y], i) => {
				if (!sampledIndices.has(i)) return []
				return [
					<circle
						// eslint-disable-next-line react/no-array-index-key -- one circle per point in this layer; index is stable per render
						key={`${layerKey || "__layer__"}__pt-${i}`}
						data-area-point="true"
						cx={x}
						cy={y}
						r={Math.max(2, thickness + 1)}
						fill={mh.fill ?? layerStroke}
						stroke="none"
						opacity={borderOpacity * mh.opacityMul}
						pointerEvents="none"
					/>,
				]
			})
			if (effectiveStackMode === "overlay") {
				interleaved.push(...lineEls, ...pointEls)
			} else {
				fills.push(...lineEls, ...pointEls)
			}
			return
		}

		const bottomD = linePathD(
			[...bottom].reverse().map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 })),
			true,
		)
		const d = `${topD} ${bottomD} Z`
		const fillEl = (
			<path
				key={layerKey || "__layer__"}
				d={d}
				fill={mh.fill ?? fillProp}
				fillOpacity={layerResolved.opacity * mh.opacityMul}
				stroke="none"
				onMouseEnter={onMouseEnter}
			/>
		)
		const edgeEl = (
			<path
				key={`${layerKey || "__layer__"}__edge`}
				d={topD}
				fill="none"
				stroke={effStroke}
				strokeWidth={effThickness}
				strokeLinejoin="round"
				strokeLinecap={strokeCap}
				strokeOpacity={borderOpacity * mh.opacityMul}
			/>
		)
		if (effectiveStackMode === "overlay") {
			interleaved.push(fillEl, edgeEl)
		} else {
			fills.push(fillEl)
			edges.push(edgeEl)
		}
	})

	return effectiveStackMode === "overlay" ? interleaved : [...fills, ...edges]
}

/** Build per-layer-per-stack data label anchors that respect stackMode.
 *
 *  For stack mode, each anchor sits at the layer's cumulative TOP edge for
 *  its stack — labels follow the visible top of the stacked area instead of
 *  the raw row's y value. For overlay (and group, which degrades to
 *  overlay), every layer draws from the baseline so each anchor sits at the
 *  layer's slice value directly.
 *
 *  Without this, labels in `AreaPlot` were positioned by the row-based path
 *  (raw `xScale(row[x]), yScale(row[y])`) and ignored the stack the user
 *  could see — that was the "data labels not respecting stack/overlay"
 *  report. Caller passes the stack mode and the same scales the area
 *  paths use, so anchors and visible polygons stay aligned. */
export const buildAreaAnchors = ({
	aggregation,
	categoryScale,
	measureScale,
	stackMode,
	decimals,
	formatSpec,
	sizeField,
	encodings,
	rows,
	valueFieldMapped,
}: {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	categoryScale: PositionScale
	measureScale: ReturnType<typeof scaleLinear<number, number>>
	stackMode: StackMode
	decimals: number | null
	/** The mapped value field's Label format spec (from
	 *  `DataLabelsConfig.fieldFormats`); wins over `decimals` when set. */
	formatSpec?: string | null
	/** When mapped, aggregates the size field across rows in each (stack,
	 *  layer) cell and surfaces the sum as the anchor's `sizeValue` so
	 *  DataLabelsLayer can render the label at the right font size. */
	sizeField?: string | null
	encodings?: Encodings
	rows?: ReadonlyArray<Record<string, unknown>>
	/** True when the label value field is mapped and distinct from the
	 * measure — that field is then authoritative: layers where it's blank
	 * render no label (sparse labeling) instead of falling back to the
	 * layer's measure. */
	valueFieldMapped?: boolean
}): DataLabelAnchor[] => {
	// Areas reduce "group" → "overlay" (no meaningful side-by-side); mirrors
	// the same coercion used in `buildAreas` so the anchor positions match
	// the rendered polygon edges exactly.
	const effectiveStackMode: "stack" | "overlay" =
		stackMode === "stack" ? "stack" : "overlay"

	// Discover every layer key in the same order `buildAreas` does — each
	// stack's slice order, deduped — so anchors emit in a stable, layer-major
	// sequence the "only show last per series" filter can rely on.
	const layerKeys: string[] = []
	const layerMeta = new Map<
		string,
		{ groupValues: Partial<Record<string, string>> }
	>()
	for (const stack of aggregation.stacks) {
		for (const slice of stack.slices) {
			if (!layerKeys.includes(slice.key)) {
				layerKeys.push(slice.key)
				layerMeta.set(slice.key, { groupValues: slice.groupValues })
			}
		}
	}

	const stackValues = aggregation.stacks.map((stack) => {
		const byKey = new Map<string, number>()
		const byKeyText = new Map<string, unknown>()
		for (const slice of stack.slices) {
			byKey.set(slice.key, slice.value)
			// A mapped value field is authoritative — a blank slice stays
			// absent from byKeyText so no label renders, rather than falling
			// back to the layer's measure.
			if (valueFieldMapped) {
				if (slice.textValue !== undefined)
					byKeyText.set(slice.key, slice.textValue)
			} else {
				byKeyText.set(slice.key, slice.textValue ?? slice.value)
			}
		}
		return { stack, byKey, byKeyText }
	})

	// Walking running cumulative tops per stack — only consulted in `stack`
	// mode; in `overlay` every layer's top is just its own value above the
	// baseline.
	const bottoms: number[] = Array.from<number>({
		length: stackValues.length,
	}).fill(0)

	const anchors: DataLabelAnchor[] = []
	layerKeys.forEach((layerKey) => {
		const meta = layerMeta.get(layerKey)
		const hueValue = meta?.groupValues.hue
		stackValues.forEach((sv, i) => {
			const value = sv.byKey.get(layerKey) ?? 0
			const bottom = effectiveStackMode === "stack" ? bottoms[i] : 0
			const top = bottom + value
			if (effectiveStackMode === "stack") bottoms[i] = top
			const px = applyCategoryScale(
				categoryScale,
				sv.stack.category,
				aggregation.categoryType
			)
			if (px === null) return
			// Anchor at the visible TOP edge of this layer's contribution to
			// this stack — that's where the user sees the layer "is".
			const measurePoint = measureScale(top)
			const labelValue = valueFieldMapped
				? sv.byKeyText.get(layerKey)
				: (sv.byKeyText.get(layerKey) ?? value)
			const formatted = formatSingleLabel(labelValue, formatSpec, decimals)
			// Sum the size field for rows in this (stack, layer) cell so
			// DataLabelsLayer can size the label per the user's encoding.
			// Same shape as the bar-anchor aggregation in BarPlot.
			let sizeValue: number | string | undefined
			if (sizeField && encodings && rows) {
				let sum = 0
				let foundNumeric = false
				let firstNonNumeric: string | undefined
				for (const row of rows) {
					if (
						String(row[aggregation.categoryField]) !== sv.stack.category
					)
						continue
					let matches = true
					const layerGroup = meta?.groupValues ?? {}
					for (const [channel, value] of Object.entries(layerGroup)) {
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
					// parseNumericCell, not Number: blanks are missing data and
					// must not enter the size sum as 0 (`Number("") === 0`).
					const n = parseNumericCell(raw)
					if (n !== null) {
						sum += n
						foundNumeric = true
					} else if (
						firstNonNumeric === undefined &&
						raw != null &&
						String(raw).trim() !== ""
					) {
						firstNonNumeric = String(raw)
					}
				}
				sizeValue = foundNumeric ? sum : firstNonNumeric
			}
			anchors.push({
				cx: aggregation.isVertical ? px : measurePoint,
				cy: aggregation.isVertical ? measurePoint : px,
				key: `${sv.stack.category}|${layerKey}`,
				label: formatted,
				hueValue,
				sizeValue,
			})
		})
	})
	return anchors
}

/** Max-measure computation for areas that branches on stackMode. Areas have
 * no meaningful "group" mode — it degrades to overlay, so the only split is
 * stack (sum-per-stack) vs not-stack (max single slice). */
export const computeAreaMeasureMax = (
	stacks: Stack[],
	stackMode: StackMode
): number => {
	if (stackMode === "stack") {
		return Math.max(
			1,
			...stacks.map((s) => s.slices.reduce((acc, sl) => acc + sl.value, 0))
		)
	}
	return Math.max(1, ...stacks.flatMap((s) => s.slices.map((sl) => sl.value)))
}
