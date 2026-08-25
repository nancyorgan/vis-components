import { useMemo, useState } from "react"
import { scaleBand, scaleLinear } from "d3-scale"
import { useAtomValue } from "jotai"
import {
	aggregateBars,
	type GroupChannel,
	type GroupEncoding,
	type Stack,
} from "../../lib/aggregators/stacks"
import {
	buildPatternDefs,
	stacksToGroupValues,
	type PatternDefOptions,
} from "../../lib/buildPatternDefs"
import {
	AUTO_BAR_GAP_FRACTION,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	type ChannelConfigs,
	type ColorSlotConfig,
	type HistogramConfig,
	type TextConfig,
} from "../../lib/channelConfig"
import { ptToPx } from "../../lib/fontUnit"
import { getChartMode } from "../../lib/chartMode"
import type { MeasureAxisRendererProps } from "../../lib/chartRendererProps"
import { buildTickFormatter } from "../../lib/formatTick"
import { densityCurveGroupField } from "../../lib/colorSlots"
import { densityCurveMeasures } from "../../lib/densityCurve"
import { computeHistogramBins } from "../../lib/histogramBins"
import { cartesian } from "./coords"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import type { PatternDefSpec } from "../../lib/patternDefs"
import {
	layerFillProp,
	resolveLayerColor,
	resolveSlotColor,
	slotOpacityResolver,
} from "../../lib/resolveLayerColor"
import {
	applyHueScale,
	makeHueScale,
	makeOpacityScale,
	parseNumericCell,
	type HueScale,
	type PositionScale,
	type UnitScale,
} from "../../lib/scales"
import {
	resolveStackModes,
	type StackModeEntry,
} from "../../lib/stackMode"
import { formatSingleLabel } from "../../lib/dataLabelsStyle"
import { formatTextValue } from "../../lib/textEncoding"
import type { Encodings, FieldType } from "../../lib/types"
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
import { useCurrentTheme } from "../../store/useCurrentTheme"
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

/** Rescale every slice value to its share of the grand total across all
 * stacks (count → relative frequency in 0–1). Used for histogram "density"
 * mode. Returns the input unchanged when the total is non-positive. */
export const toDensityStacks = (stacks: Stack[]): Stack[] => {
	const total = stacks.reduce(
		(sum, s) => sum + s.slices.reduce((a, sl) => a + sl.value, 0),
		0
	)
	if (total <= 0) return stacks
	return stacks.map((s) => ({
		...s,
		slices: s.slices.map((sl) => ({ ...sl, value: sl.value / total })),
	}))
}

type BarPlotProps = MeasureAxisRendererProps

type Aggregation =
	| {
			kind: "ok"
			mode: "bars-x" | "bars-y"
			isVertical: boolean
			categoryField: string
			lengthField: string
			categoryType: FieldType
			lengthType: FieldType
			stacks: Stack[]
			scaleCategories: string[]
			measureMin: number
			measureMax: number
			/** True when the category axis is a binned quantitative field
			 * (histogram). Drives zero-padding so bars touch. */
			isHistogram: boolean
			/** True when the histogram shows relative frequency (count/total in
			 * 0–1) rather than raw counts. */
			isDensity: boolean
			/** Binned value extent `[low, high]` when this is a histogram, else
			 * null. Equal-width bins tile this range, so a linear scale over it
			 * lines up with the band scale — used to place rug ticks. */
			binDomain: [number, number] | null
	  }
	| {
			kind: "error"
			message: string
	  }

export const BarPlot = (props: BarPlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataLabels = useAtomValue(currentDataLabelsEncodingsAtom)
	const dataLabelsCfg = useAtomValue(currentDataLabelsConfigAtom)
	const dataLabelsDecimals = dataLabelsCfg?.decimals ?? null
	// The mapped value field's Label format spec — slice labels show that
	// field's aggregate (textValue), so its per-field format applies.
	const dataLabelsFormatSpec = dataLabels?.value?.field
		? (dataLabelsCfg?.fieldFormats?.[dataLabels.value.field] ?? null)
		: null
	// Source of the density curve's pre-slot default color (slate stroke).
	const liveTheme = useCurrentTheme()
	// Bar charts route Data Labels through `buildBarAnchors` (slice-center
	// positioning instead of raw-row positioning). Only fire when the user
	// has mapped at least one DataLabels field — otherwise an empty Data
	// Labels section would unintentionally stamp slice values onto every
	// bar.
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

	const showX = props.showXAxis !== false
	const showY = props.showYAxis !== false
	// Memoize the rows-derivation so downstream useMemo deps don't see a fresh
	// `[]` fallback every render (which otherwise busts the aggregation cache).
	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)
	// Bar charts have a CATEGORY axis and a MEASURE axis (orthogonal).
	// Under faceted sharing, the two can share scales independently —
	// e.g. shareX="all" + shareY="none" means all panels show the same
	// x-categories but their y measure maxes are panel-local. Resolve
	// per-axis rows here and feed them to two scale aggregations below
	// (one for the category list, one for measureMax). Falls back to
	// the legacy combined `scalesRowsOverride` when the per-axis props
	// aren't set, and finally to rowsForChart.
	const rowsForXScale =
		props.scalesRowsOverrideX ?? props.scalesRowsOverride ?? rowsForChart
	const rowsForYScale =
		props.scalesRowsOverrideY ?? props.scalesRowsOverride ?? rowsForChart

	// Aggregation runs outside the coord factory — it's independent of the
	// measured inner rect. Only the scales (categoryScale / measureScale)
	// depend on the rect and get built inside the factory below.
	const aggregation = useMemo<Aggregation | null>(() => {
		if (!dataset) return null
		const getType = (name: string) => effectiveType(dataset, name, overrides)
		const mode = getChartMode(encodings, getType, channelConfigs)
		if (mode !== "bars-x" && mode !== "bars-y") return null
		const categoryField =
			mode === "bars-x" ? encodings.x.field : encodings.y.field
		if (!categoryField) return null
		const categoryType = effectiveType(dataset, categoryField, overrides)
		// Histogram: the category axis is a binned quantitative field and bar
		// height is the COUNT of rows per bin — no measure field. Otherwise
		// it's a normal bar chart, which requires a `length` measure.
		const categoryChannel = mode === "bars-x" ? "x" : "y"
		const histogramCfg = channelConfigs[categoryChannel]?.histogram
		const isHistogram =
			histogramCfg?.enabled === true && categoryType === "quantitative"
		const lengthField = encodings.length?.field ?? ""
		if (!isHistogram && !lengthField) return null

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
				aestheticScales.outlineHue &&
					({
						channel: "outlineHue",
						field: aestheticScales.outlineHue.field.name,
						type: aestheticScales.outlineHue.field.type,
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

		// User-pinned level order for each grouping field (Fields reorder UI),
		// keyed by channel. Lets the aggregator stack slices in the same order
		// the legend lists them. Skips fields the user hasn't reordered.
		const groupOrders: Partial<Record<GroupEncoding["channel"], readonly string[]>> = {}
		for (const g of groups) {
			const order = levelOrders[g.field]
			if (order) groupOrders[g.channel] = order
		}

		const lengthType: FieldType = lengthField
			? effectiveType(dataset, lengthField, overrides)
			: "categorical"
		// Prefer the new DataLabels.value field for per-slice text aggregation.
		// Fall back to the legacy `encodings.text.field` so older saved visuals
		// keep showing labels through the same pipeline.
		const textField =
			dataLabels?.value?.field ?? encodings.text?.field ?? undefined
		const textType = textField
			? effectiveType(dataset, textField, overrides)
			: undefined

		// Category/measure axis row sources. For bars-x: x=category,
		// measure=y → categoryRows=rowsForXScale, measureRows=rowsForYScale.
		// Reversed for bars-y. (Resolved here so histogram bin edges can be
		// derived from the CATEGORY-axis source — keeping faceted panels that
		// share the category axis on the same bins.)
		const isVertical = mode === "bars-x"
		const categoryRows = isVertical ? rowsForXScale : rowsForYScale
		const measureRows = isVertical ? rowsForYScale : rowsForXScale

		// Histogram transform: partition the quantitative category field into
		// equal-width bins and relabel each row's category value with its bin.
		// Bar height is then the COUNT of rows per bin (see `countRows` below),
		// and hue stacking still works via the group encodings. Bin edges come
		// from the category scale source so shared-axis facets agree on the
		// buckets.
		// Bin-edge labels honor the binned axis's tick-format setting (e.g. an
		// SI format renders "20000 – 30000" as "20k – 30k"). `buildTickFormatter`
		// returns null when no custom format is set, in which case the binner
		// uses its built-in precision formatter.
		const categoryAxisConfig = channelConfigs[categoryChannel]
		const tickFormatter = categoryAxisConfig
			? buildTickFormatter(categoryAxisConfig, "quantitative")
			: null
		const binning = isHistogram
			? computeHistogramBins(
					categoryRows.map((r) => r[categoryField]),
					histogramCfg?.binCount ?? 10,
					tickFormatter ? (n: number) => tickFormatter(n) : undefined,
					{ min: categoryAxisConfig?.min ?? null, max: categoryAxisConfig?.max ?? null },
					histogramCfg?.labelMode ?? "range"
			  )
			: null
		const prep = (rows: typeof rowsForChart): typeof rowsForChart => {
			if (!binning) return rows
			const out: Array<Record<string, unknown>> = []
			for (const row of rows) {
				const label = binning.labelForValue(row[categoryField])
				if (label === null) continue
				out.push({ ...row, [categoryField]: label })
			}
			return out
		}
		// Binned categories are string labels: feed them as an ordinal field
		// with an explicit ascending order so they sort by bin edge, not by
		// encounter. Unbinned bars keep their native type + pinned order.
		const aggCategoryType: FieldType = binning ? "ordinal" : categoryType
		const aggCategoryOrder = binning
			? binning.order
			: levelOrders[categoryField]

		const result = aggregateBars({
			rows: prep(rowsForChart),
			categoryField,
			lengthField,
			categoryType: aggCategoryType,
			lengthType,
			groups,
			textField,
			textType,
			categoryOrder: aggCategoryOrder,
			groupOrders,
			countRows: isHistogram,
		})
		if ("error" in result) {
			return { kind: "error", message: result.error }
		}

		const aggOnce = (rows: typeof rowsForChart) =>
			aggregateBars({
				rows: prep(rows),
				categoryField,
				lengthField,
				categoryType: aggCategoryType,
				lengthType,
				groups,
				categoryOrder: aggCategoryOrder,
				groupOrders,
				countRows: isHistogram,
			})
		// Reuse the main `result` when the scale source is the same array
		// (referential check on the SOURCE, before `prep` clones it).
		const catAggregation =
			categoryRows === rowsForChart ? result : aggOnce(categoryRows)
		const measureAggregation =
			measureRows === rowsForChart
				? result
				: measureRows === categoryRows
					? catAggregation
					: aggOnce(measureRows)
		// Histograms render EVERY bin across the (possibly pinned) range — even
		// empty ones — so the distribution's gaps show and a pinned min/max
		// actually extends the axis (e.g. a min below the data adds empty bins
		// down to it). The aggregator only emits bins that contain rows, so use
		// the binning's full ordered bin list for the category-axis domain.
		const scaleCategories = binning
			? binning.order
			: "error" in catAggregation
				? result.categories
				: catAggregation.categories
		const scaleStacks =
			"error" in measureAggregation
				? result.stacks
				: measureAggregation.stacks
		// Histogram "density" mode: rescale counts to each bin's share of the
		// total (0–1, relative frequency). Applied to both the rendered stacks
		// and the measure-scale stacks so the axis bound matches the bars.
		const isDensity = isHistogram && histogramCfg?.mode === "density"
		const renderStacks = isDensity ? toDensityStacks(result.stacks) : result.stacks
		const measureStacks = isDensity ? toDensityStacks(scaleStacks) : scaleStacks
		// Density bars are PER-PANEL shares (count / this panel's total), so the
		// axis must be bounded by the rendered bars — not by `measureStacks`,
		// whose grand-total denominator is the (possibly pooled) measure-scale
		// rows and so differs from each panel's. Count bars keep `measureStacks`
		// so a pooled/shared measure axis still bounds the largest bin. Faceted
		// shared axes pass an explicit `measureMaxOverride` that wins over both.
		const modes = resolveStackModes(channelConfigs, encodings)
		const measureMax =
			props.measureMaxOverride ??
			computeBarMeasureMax(isDensity ? renderStacks : measureStacks, modes)
		const measureMin =
			props.measureMinOverride ??
			computeBarMeasureMin(isDensity ? renderStacks : measureStacks, modes)

		return {
			kind: "ok",
			mode,
			isVertical: mode === "bars-x",
			categoryField,
			lengthField,
			categoryType,
			lengthType,
			stacks: renderStacks,
			scaleCategories,
			measureMin,
			measureMax,
			isHistogram,
			isDensity,
			binDomain: binning ? binning.domain : null,
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
		channelConfigs.x?.histogram,
		channelConfigs.y?.histogram,
		channelConfigs.x?.customFormat,
		channelConfigs.y?.customFormat,
		channelConfigs.x?.min,
		channelConfigs.x?.max,
		channelConfigs.y?.min,
		channelConfigs.y?.max,
		levelOrders,
		props.measureMaxOverride,
		props.measureMinOverride,
		dataLabels?.value?.field,
	])

	// Pattern defs depend only on aesthetic categories + slice group values +
	// channelConfigs — not on the measured rect. Pre-compute so they can be
	// registered in `<defs>` before marks render. The options MUST match the
	// ones `buildRects` hands `resolveLayerColor` below (same default-pattern
	// opt-in + line-context default-to-none as ScatterPlot).
	const connectionMapped = !!encodings.connection?.field
	const patternDefs = useMemo<PatternDefSpec[]>(() => {
		if (!aggregation || aggregation.kind === "error") return []
		return buildPatternDefs(
			stacksToGroupValues(aggregation.stacks),
			aestheticScales,
			channelConfigs,
			channelConfigs.defaultFill ?? FALLBACK_FILL,
			channelConfigs.pattern?.backgroundColor ?? "#e2e8f0",
			{ defaultToNone: connectionMapped, includeDefaultPattern: true }
		)
	}, [aggregation, aestheticScales, channelConfigs, connectionMapped])

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

	// Coord factory — defers scale construction to after measurement. For
	// vertical bars (bars-x), the category axis is x and the measure axis is
	// y; for horizontal bars (bars-y), the roles swap.
	const coord: CoordFactory = (inner) => {
		if (!aggregation || aggregation.kind === "error") {
			// Null coord for error/empty states — axis sandwich renders nothing.
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
			lengthField,
		} = aggregation
		// Histograms derive the measure from row counts (no length field), so
		// the measure axis is labeled "Count" — or "Density" in relative-
		// frequency mode — rather than a field name.
		const measureLabel = aggregation.isHistogram
			? aggregation.isDensity
				? "Density"
				: "Count"
			: lengthField
		// Gap between bars: the Length panel's "Bar gap" pixels when set, else
		// the proportional 15%-of-slot auto. d3's band padding is a FRACTION of
		// the category step, so a pixel gap g converts per panel: with n
		// categories in a span of `range` px and `.padding()` setting inner and
		// outer alike, step·(n + p) = range and gap = step·p = g, giving
		// p = g·n / (range − g). Per-panel conversion keeps the pixel gap
		// uniform across facet panels of different widths. Clamped defensively —
		// a padding ≥ 1 would collapse every bar to zero width.
		const barGapPx = channelConfigs.length?.barGapPx ?? null
		const bandRange = Math.abs(
			isVertical ? inner.x1 - inner.x0 : inner.y1 - inner.y0
		)
		const barGapFraction =
			barGapPx === null || scaleCategories.length === 0
				? AUTO_BAR_GAP_FRACTION
				: Math.min(
						(Math.max(barGapPx, 0) * scaleCategories.length) /
							Math.max(bandRange - Math.max(barGapPx, 0), 1),
						0.95
					)
		const categoryScale = scaleBand<string>()
			.domain(scaleCategories)
			.range(isVertical ? [inner.x0, inner.x1] : [inner.y0, inner.y1])
			// Histogram bars abut (no gaps); categorical bars keep their gap.
			.padding(aggregation.isHistogram ? 0 : barGapFraction)
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
				: labels.xAxisTitle ?? measureLabel,
			yLabel: isVertical
				? labels.yAxisTitle ?? measureLabel
				: labels.yAxisTitle ?? categoryField,
			xFieldType: isVertical ? "categorical" : "quantitative",
			yFieldType: isVertical ? "quantitative" : "categorical",
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

	const [hovered, setHovered] = useState<TooltipState | null>(null)
	const tooltip = hovered ? <HoverTooltip state={hovered} /> : null

	const marksBody = (ctx: PlotContext) => {
		if (!aggregation || aggregation.kind !== "ok") return null
		if (ctx.coord.kind !== "cartesian") return null
		const { xScale, yScale } = ctx.coord.scales
		if (!xScale || !yScale) return null
		// For bars, one scale is a scaleBand (category) and the other is a
		// scaleLinear (measure). `isVertical` tells us which is which.
		const categoryScale = (
			aggregation.isVertical ? xScale : yScale
		) as ReturnType<typeof scaleBand<string>>
		const measureScale = (
			aggregation.isVertical ? yScale : xScale
		) as ReturnType<typeof scaleLinear<number, number>>
		const modes = resolveStackModes(channelConfigs, encodings)
		// A mapped label column (distinct from the measure) is authoritative:
		// slices where it's blank get NO label — sparse columns are the way to
		// label a single arbitrary point, so blanks must never fall back to the
		// measure. Mirrors the aggregator's own textValue condition.
		const labelField = dataLabels?.value?.field ?? encodings.text?.field
		const valueFieldMapped = Boolean(
			labelField && labelField !== aggregation.lengthField
		)
		const onSliceHover = (
			stack: Stack,
			slice: Stack["slices"][number],
			event: React.MouseEvent
		) => {
			if (aggregation.kind !== "ok") return
			// Histograms have no length field — the measure is a row count
			// (or relative frequency in density mode).
			const measureName = aggregation.isHistogram
				? aggregation.isDensity
					? "Density"
					: "Count"
				: aggregation.lengthField
			const fields: TooltipState["fields"] = [
				{ name: aggregation.categoryField, value: stack.category },
				{ name: measureName, value: slice.value },
			]
			const namesPushed = new Set([aggregation.categoryField, measureName])
			for (const [channel, value] of Object.entries(slice.groupValues)) {
				const fieldName = encodings[channel as keyof typeof encodings]?.field
				if (fieldName && !namesPushed.has(fieldName)) {
					fields.push({ name: fieldName, value })
					namesPushed.add(fieldName)
				}
			}
			// Surface unmapped dataset fields too (spec §10 / §15.5: the
			// Fields-shown list contains every variable in the dataset).
			// Find a representative row matching the slice's category +
			// groupValues and take that row's value for each remaining
			// field. Aggregating modes lose row-level information for
			// unmapped fields; "first matching row" is the documented
			// fallback when the user opts an unmapped column into the
			// tooltip.
			if (dataset) {
				const matchesSlice = (row: Record<string, unknown>): boolean => {
					if (String(row[aggregation.categoryField]) !== stack.category)
						return false
					for (const [channel, value] of Object.entries(slice.groupValues)) {
						const fieldName =
							encodings[channel as keyof typeof encodings]?.field
						if (!fieldName) continue
						if (String(row[fieldName]) !== value) return false
					}
					return true
				}
				const repRow = rowsForChart.find(matchesSlice)
				if (repRow) {
					for (const f of dataset.fields) {
						if (namesPushed.has(f.name)) continue
						fields.push({ name: f.name, value: repRow[f.name] ?? "" })
						namesPushed.add(f.name)
					}
				}
			}
			setHovered({
				clientX: event.clientX,
				clientY: event.clientY,
				fields,
			})
			// Highlight this slice's series (recolor / outline / fade) exactly
			// like hovering its legend entry.
			markHover.enter(slice.groupValues.hue)
		}
		// Histogram rug: one tick per raw row along the binned axis. Read the
		// rug config off the CATEGORY (binned) axis. Drawn ON TOP of the bars so
		// each tick stays centered on (straddling) the axis baseline — bars grow
		// up from that baseline and would otherwise paint over the tick's inner
		// half, making a centered tick look like it only hangs below the axis.
		const rugHistogram = aggregation.isHistogram
			? channelConfigs[aggregation.isVertical ? "x" : "y"]?.histogram
			: undefined
		// Histogram-only: Fill color / opacity can vary by each bin's derived
		// measure (Count/Density) instead of a field. Build the quantitative
		// scales over the GLOBAL measure-color domain PlotCanvas provides
		// (`measureColorMaxOverride`, from `histogramMeasureColorDomain`) so
		// every facet panel AND the legend ramp share one [0, max] scale —
		// equal counts get equal colors everywhere, and the tallest bin in
		// any panel maps to the gradient's high end / max opacity. Standalone
		// renders without the override fall back to this panel's own
		// measureMax (identical for a single-panel chart).
		const measureColorMax =
			props.measureColorMaxOverride ?? aggregation.measureMax
		const hueMeasureSource = aggregation.isHistogram
			? encodings.hue?.measureSource
			: undefined
		const opacityMeasureSource = aggregation.isHistogram
			? encodings.opacity?.measureSource
			: undefined
		const measureHueScale = hueMeasureSource
			? makeHueScale(
					[0, measureColorMax],
					"quantitative",
					channelConfigs.hue
				)
			: null
		const measureOpacityScale = opacityMeasureSource
			? makeOpacityScale(
					[0, measureColorMax],
					"quantitative",
					channelConfigs.opacity
				)
			: null
		return (
			<g
				onMouseLeave={() => {
					setHovered(null)
					markHover.leave()
				}}
			>
				{buildRects({
					aggregation,
					aestheticScales,
					channelConfigs,
					categoryScale,
					measureScale,
					modes,
					onSliceHover,
					measureHueScale,
					measureOpacityScale,
					highlight: legendHighlight,
					patternOptions: {
						defaultToNone: connectionMapped,
						includeDefaultPattern: true,
					},
				})}
				{rugHistogram?.showRug &&
					buildRug({
						aggregation,
						rows: rowsForChart,
						histogram: rugHistogram,
						hue: aestheticScales.hue,
						rugSlot: aestheticScales.colorSlots.rug,
						rugSlotCfg: channelConfigs.colorSlots?.rug,
						rugOpacity: slotOpacityResolver(
							"rug",
							channelConfigs,
							aestheticScales
						),
						categoryScale,
						measureScale,
					})}
				{rugHistogram?.showDensity &&
					buildDensityCurve({
						aggregation,
						rows: rowsForChart,
						histogram: rugHistogram,
						groupField: densityCurveGroupField(channelConfigs),
						strokeFor: (row) =>
							channelConfigs.colorSlots?.densityCurveStroke
								? resolveSlotColor(
										aestheticScales.colorSlots.densityCurveStroke,
										channelConfigs.colorSlots.densityCurveStroke,
										row,
										liveTheme.distributionOverlayStroke
									)
								: liveTheme.distributionOverlayStroke,
						fillFor: (row) =>
							channelConfigs.colorSlots?.densityCurveFill
								? resolveSlotColor(
										aestheticScales.colorSlots.densityCurveFill,
										channelConfigs.colorSlots.densityCurveFill,
										row,
										liveTheme.distributionOverlayFill
									)
								: liveTheme.distributionOverlayFill,
						strokeOpacity: slotOpacityResolver(
							"densityCurveStroke",
							channelConfigs,
							aestheticScales
						)({}),
						fillOpacity: slotOpacityResolver(
							"densityCurveFill",
							channelConfigs,
							aestheticScales
						)({}),
						categoryScale,
						measureScale,
					})}
				{encodings.text?.field &&
					buildSliceLabels({
						aggregation,
						channelConfigs,
						categoryScale,
						measureScale,
						modes,
						valueFieldMapped,
					})}
				{anyDataLabelsMapped && (
					<DataLabelsLayer
						rows={rowsForChart}
						xScale={xScale}
						yScale={yScale}
						xType={aggregation.isVertical ? "categorical" : "quantitative"}
						yType={aggregation.isVertical ? "quantitative" : "categorical"}
						anchors={buildBarAnchors({
							aggregation,
							categoryScale,
							measureScale,
							modes,
							decimals: dataLabelsDecimals,
							formatSpec: dataLabelsFormatSpec,
							position: dataLabelsCfg?.barLabelPosition ?? "center",
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

type BuildRectsArgs = {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	aestheticScales: AestheticScales
	channelConfigs: ChannelConfigs
	categoryScale: ReturnType<typeof scaleBand<string>>
	measureScale: ReturnType<typeof scaleLinear<number, number>>
	modes: StackModeEntry[]
	/** When the histogram's Fill color varies by the bins' derived measure
	 *  (Count/Density) rather than a field, this is the quantitative color scale
	 *  over `[0, measureMax]`; each bar is filled by `colorScale(slice.value)`.
	 *  Null when no measure source is active (the normal field/single-color
	 *  path applies). */
	measureHueScale?: HueScale | null
	/** Same idea for Fill opacity by measure: each bar's opacity is
	 *  `opacityScale(slice.value)`. Null when no opacity measure source. */
	measureOpacityScale?: UnitScale | null
	/** Optional hover callback. Fired when the user mouses onto a slice;
	 * receives the stack, slice, and original mouse event so the caller can
	 * pull viewport coords for tooltip placement. */
	onSliceHover?: (
		stack: Stack,
		slice: Stack["slices"][number],
		event: React.MouseEvent
	) => void
	/** Legend-hover highlight state; slices whose group value doesn't match
	 * the hovered legend entry are dimmed. `null` = nothing hovered. */
	highlight: LegendHighlight | null
	/** Pattern-channel context flags (default-pattern opt-in + line-context
	 * default-to-none). MUST match the options the component's pattern-defs
	 * memo passes to `buildPatternDefs`. */
	patternOptions?: PatternDefOptions
}

/** Default total length (px) of a rug tick, centered on the axis baseline.
 * Used when the histogram config doesn't override `rugTickLength`. */
const RUG_TICK_LEN = 10
/** Default rug tick thickness (px), used when `rugTickThickness` is unset. */
const RUG_TICK_THICKNESS = 1

/** Render a rug for a histogram: one short tick per raw row at its exact value
 * along the binned axis. Equal-width bins tile `binDomain`, so a linear scale
 * over that extent aligns with the band scale of bin labels. Ticks are vertical
 * (centered on the bottom baseline) for an x-axis histogram, horizontal
 * (centered on the left baseline) for a y-axis one. Color is a single swatch,
 * or per hue category from the rug palette when one is picked and hue is
 * mapped. */
const buildRug = ({
	aggregation,
	rows,
	histogram,
	hue,
	rugSlot,
	rugSlotCfg,
	rugOpacity,
	categoryScale,
	measureScale,
}: {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	rows: Array<Record<string, unknown>>
	histogram: HistogramConfig
	hue: AestheticScales["hue"]
	/** The rug color slot's scale (present only when a field is mapped) and its
	 * config. When the config is present the slot owns the rug color; otherwise
	 * the legacy `histogram.rug*` coloring runs (back-compat). */
	rugSlot: AestheticScales["colorSlots"]["rug"]
	rugSlotCfg: ColorSlotConfig | undefined
	/** Per-row opacity from the Rug opacity slot (level, or field-resolved). */
	rugOpacity: (row: Record<string, unknown>) => number
	categoryScale: ReturnType<typeof scaleBand<string>>
	measureScale: ReturnType<typeof scaleLinear<number, number>>
}): React.ReactNode[] => {
	const { binDomain, isVertical, categoryField, measureMin } = aggregation
	if (!binDomain) return []
	const [lo, hi] = binDomain
	// Degenerate single-value domain has no width to scale across — skip.
	if (!(hi > lo)) return []
	const [r0, r1] = categoryScale.range()
	const valueScale = scaleLinear<number, number>().domain([lo, hi]).range([r0, r1])
	// Bars grow from the measure floor; the rug sits on that same baseline.
	const baseline = measureScale(measureMin)
	// Tick straddles the baseline: `half` above and `half` below keep it centered
	// on the axis regardless of the chosen length.
	const tickLen = histogram.rugTickLength ?? RUG_TICK_LEN
	const half = tickLen / 2
	const thickness = histogram.rugTickThickness ?? RUG_TICK_THICKNESS

	// Per-category coloring only kicks in when a palette is picked AND a
	// categorical hue is mapped; otherwise every tick uses the single color.
	const palette = histogram.rugPalette ?? []
	const hueCategorical = hue !== null && hue.scale.kind === "categorical"
	const usePalette =
		!!histogram.rugPaletteId && palette.length > 0 && hueCategorical
	const hueField = hue?.field.name
	const hueDomain =
		usePalette && hue && hue.scale.kind === "categorical"
			? hue.scale.scale.domain()
			: []
	const colorFor = (row: Record<string, unknown>): string => {
		// When the rug color slot is configured it fully owns the color
		// (independent field mapping or single color); fall back to the legacy
		// hue-indexed rug coloring only when no slot exists.
		if (rugSlotCfg) return resolveSlotColor(rugSlot, rugSlotCfg, row, histogram.rugColor)
		if (!usePalette || !hueField) return histogram.rugColor
		const idx = hueDomain.indexOf(String(row[hueField]))
		return idx >= 0 ? palette[idx % palette.length] : histogram.rugColor
	}

	const ticks: React.ReactNode[] = []
	rows.forEach((row, i) => {
		const raw = row[categoryField]
		const n = typeof raw === "number" ? raw : Number(raw)
		if (!Number.isFinite(n) || n < lo || n > hi) return
		const p = valueScale(n)
		const color = colorFor(row)
		const tickOpacity = rugOpacity(row)
		ticks.push(
			isVertical ? (
				<line
					// eslint-disable-next-line react/no-array-index-key -- rug ticks map 1:1 to rows, which have no stable id
					key={`rug-${i}`}
					x1={p}
					x2={p}
					y1={baseline - half}
					y2={baseline + half}
					stroke={color}
					strokeOpacity={tickOpacity}
					strokeWidth={thickness}
					strokeLinecap="round"
				/>
			) : (
				<line
					// eslint-disable-next-line react/no-array-index-key -- rug ticks map 1:1 to rows, which have no stable id
					key={`rug-${i}`}
					x1={baseline - half}
					x2={baseline + half}
					y1={p}
					y2={p}
					stroke={color}
					strokeOpacity={tickOpacity}
					strokeWidth={thickness}
					strokeLinecap="round"
				/>
			)
		)
	})
	return ticks
}

/** Render a density curve over a histogram: a Gaussian KDE rescaled into the
 * bars' own units (row count, or relative frequency in density mode) so its
 * height tracks the bars. Drawn on top as a single stroked line, optionally
 * filled to the baseline. Mirrors `buildRug`'s axis handling — the value axis
 * is horizontal for an x-histogram, vertical for a y-histogram — and aligns to
 * the band scale via a linear scale over the same `binDomain`. */
const buildDensityCurve = ({
	aggregation,
	rows,
	histogram,
	groupField,
	strokeFor,
	fillFor,
	strokeOpacity,
	fillOpacity,
	categoryScale,
	measureScale,
}: {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	rows: Array<Record<string, unknown>>
	histogram: HistogramConfig
	/** Field the curve is split by ("vary by" a color), or null for one curve. */
	groupField: string | null
	/** Outline color for a curve, resolved per group row (`{}` = single curve). */
	strokeFor: (row: Record<string, unknown>) => string
	/** Fill color for a curve, resolved per group row. */
	fillFor: (row: Record<string, unknown>) => string
	/** Outline opacity from the Density Curve Outline opacity slot. */
	strokeOpacity: number
	/** Fill opacity from the Density Curve Fill opacity slot. */
	fillOpacity: number
	categoryScale: ReturnType<typeof scaleBand<string>>
	measureScale: ReturnType<typeof scaleLinear<number, number>>
}): React.ReactNode => {
	const { binDomain, isVertical, categoryField, isDensity, scaleCategories, measureMin } =
		aggregation
	if (!binDomain) return null
	const [lo, hi] = binDomain
	if (!(hi > lo)) return null
	const binCount = scaleCategories.length
	// Equal-width bins tile binDomain, so a linear scale over that extent aligns
	// the curve's value axis with the band scale of bin labels (same as buildRug).
	const [r0, r1] = categoryScale.range()
	const valueScale = scaleLinear<number, number>().domain([lo, hi]).range([r0, r1])
	const baseline = measureScale(measureMin)
	const numFor = (raw: unknown) => (typeof raw === "number" ? raw : Number(raw))

	const renderCurve = (
		grid: number[],
		measure: number[],
		stroke: string,
		fill: string,
		key: string
	): React.ReactNode => {
		if (grid.length < 2) return null
		const pts: Array<[number, number]> = grid.map((g, i) => {
			const vp = valueScale(g)
			const mp = measureScale(measure[i] as number)
			return isVertical ? [vp, mp] : [mp, vp]
		})
		const line =
			"M " + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ")
		const first = pts[0] as [number, number]
		const last = pts.at(-1) as [number, number]
		const area = isVertical
			? `M ${first[0].toFixed(2)},${baseline.toFixed(2)} ${line.slice(2)} L ${last[0].toFixed(2)},${baseline.toFixed(2)} Z`
			: `M ${baseline.toFixed(2)},${first[1].toFixed(2)} ${line.slice(2)} L ${baseline.toFixed(2)},${last[1].toFixed(2)} Z`
		return (
			<g key={key} aria-hidden>
				{histogram.densityFill === true && (
					<path d={area} fill={fill} fillOpacity={fillOpacity} stroke="none" />
				)}
				<path
					d={line}
					fill="none"
					stroke={stroke}
					strokeOpacity={strokeOpacity}
					strokeWidth={2}
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
			</g>
		)
	}

	if (groupField) {
		// One KDE per category, scaled to that category's count so the curves
		// decompose the bars: count mode → each group's expected rows/bin;
		// density mode → each group's share (group's count curve ÷ grand total),
		// so the per-group curves sum to the single-curve total.
		const groups = new Map<string, number[]>()
		const order: string[] = []
		let totalN = 0
		for (const r of rows) {
			const v = numFor(r[categoryField])
			if (!Number.isFinite(v) || v < lo || v > hi) continue
			const cat = r[groupField]
			if (cat === undefined || cat === null || cat === "") continue
			totalN++
			const key = String(cat)
			let list = groups.get(key)
			if (!list) {
				list = []
				groups.set(key, list)
				order.push(key)
			}
			list.push(v)
		}
		if (totalN === 0) return null
		return (
			<g aria-hidden>
				{order.map((key) => {
					const { grid, measure } = densityCurveMeasures({
						values: groups.get(key) ?? [],
						domain: binDomain,
						binCount,
						mode: "count",
						bandwidthScale: histogram.densityBandwidthScale,
					})
					const scaled = isDensity ? measure.map((m) => m / totalN) : measure
					const row = { [groupField]: key }
					return renderCurve(grid, scaled, strokeFor(row), fillFor(row), key)
				})}
			</g>
		)
	}

	const values = rows.map((r) => numFor(r[categoryField]))
	const { grid, measure } = densityCurveMeasures({
		values,
		domain: binDomain,
		binCount,
		mode: isDensity ? "density" : "count",
		bandwidthScale: histogram.densityBandwidthScale,
	})
	return renderCurve(grid, measure, strokeFor({}), fillFor({}), "single")
}

/** Render one `<rect>` per stack slice. Geometry comes from the shared
 * `layoutSlices` engine, so per-channel group/stack/overlay composition is
 * honored: `group`-mode channels partition the category band into side-by-side
 * sub-bands; `stack`-mode channels stack cumulatively on the measure axis
 * within each sub-band; `overlay` draws each slice 0→value.
 * Colors resolve through the hue → saturation → brightness → pattern →
 * opacity pipeline, matching the legacy mark code. */
const buildRects = ({
	aggregation,
	aestheticScales,
	channelConfigs,
	categoryScale,
	measureScale,
	modes,
	onSliceHover,
	measureHueScale,
	measureOpacityScale,
	highlight,
	patternOptions,
}: BuildRectsArgs): React.ReactNode[] => {
	// Legend-hover highlight: recolor / outline the matched slice and fade the
	// rest. Maps the hovered field back to whichever group channel carries it
	// via the aesthetic scales.
	const sliceHighlight = (
		groupValues: Partial<Record<GroupChannel, string>>
	): MarkHighlight => groupHighlight(highlight, groupValues, aestheticScales)
	const outlineColor =
		channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
	const outlineWidth = channelConfigs.shape?.outlineWidth ?? 1
	// Border opacity from the Border slot. Bars are aggregated slices (no single
	// row), so a field-mapped border resolves to the slot's static level. Fill
	// opacity is each slice's overall opacity (the Fill subheader = the opacity
	// encoding), applied directly — opacity slots are absolute.
	const borderOpacity = slotOpacityResolver(
		"border",
		channelConfigs,
		aestheticScales
	)({})
	const defaultFill = channelConfigs.defaultFill ?? FALLBACK_FILL
	const patternBgFallback = channelConfigs.pattern?.backgroundColor ?? "#e2e8f0"

	// Per-slice color/pattern/opacity resolution is delegated to
	// `resolveLayerColor` below — the channel-by-channel field/scale
	// extraction that used to live here has moved into that helper.

	const rects: React.ReactNode[] = []

	// Clamp bar extents to the measure-axis domain. When the user has set a
	// non-default `measureMin` / `measureMax`, slice portions falling outside
	// that range collapse to zero height (stacks below a raised floor or
	// above a lowered ceiling). The auto domain is derived from the bars
	// themselves — [min(0, lowest), max(1, highest)] — so it never clips them:
	// an all-positive chart keeps its zero floor, and negative measures widen
	// the floor rather than flattening the bar against it.
	const { measureMin, measureMax } = aggregation
	const clampToDomain = (v: number) =>
		Math.max(measureMin, Math.min(measureMax, v))

	// Bar width in "group" mode is uniform across the chart: every bar gets
	// catSize / maxLeaves, so a category with fewer leaves doesn't get
	// wider bars than one with more. Stacks with fewer-than-max leaves are
	// centered within their bandwidth so the visual stays balanced.
	const maxLeaves = countMaxLeaves(aggregation.stacks, modes)

	aggregation.stacks.forEach((stack) => {
		const catPos = categoryScale(stack.category) ?? 0
		const catSize = categoryScale.bandwidth()
		const geo = layoutSlices(stack, modes, catPos, catSize, maxLeaves)
		const geoByKey = new Map(geo.map((g) => [g.key, g]))
		stack.slices.forEach((slice) => {
			const g = geoByKey.get(slice.key)
			if (!g) return
			const sliceCatPos = g.catPos
			const sliceCatSize = g.catSize
			// buildRects clamps the measure extents to the axis domain (see above).
			const sliceStart = clampToDomain(g.measureStart)
			const sliceEnd = clampToDomain(g.measureEnd)

			// Resolve per-slice color/opacity/pattern via the shared
			// pipeline so BarPlot/AreaPlot/PiePlot/ScatterPlot all stay
			// in lockstep on hue/saturation/brightness/pattern/opacity
			// precedence.
			const layer = resolveLayerColor({
				groupValues: slice.groupValues,
				defaultFill,
				patternBgFallback,
				aestheticScales,
				channelConfigs,
				patternOptions,
			})
			// Vary-by-measure (histogram Count/Density) overrides the normal
			// fill / opacity for this bin, mapping its measure (`slice.value`,
			// already density-rescaled in density mode) through the scale built
			// over the global `[0, measureColorMax]` domain the legend shares.
			// Falls back to the resolved layer value when the scale can't
			// place the value.
			const measureFill = measureHueScale
				? applyHueScale(measureHueScale, slice.value, "quantitative")
				: null
			const measureOpacity = measureOpacityScale
				? measureOpacityScale(slice.value)
				: null
			const mh = sliceHighlight(slice.groupValues)
			const opacity = (measureOpacity ?? layer.opacity) * mh.opacityMul
			// Highlight recolor repaints the fill; highlight outline overrides
			// the stroke and thickens it.
			const fillProp: string =
				mh.fill ?? measureFill ?? layerFillProp(layer)
			// Field-driven outline color (the `outlineHue` channel) wins over
			// the universal outline color when an outline field is mapped.
			const sliceStroke = mh.outline ?? layer.outline ?? outlineColor
			const sliceStrokeWidth = mh.outline
				? Math.max(outlineWidth, mh.outlineWidth)
				: outlineWidth
			const sliceStrokeOpacity = mh.outline ? 1 : borderOpacity

			// Rect geometry is sign-agnostic: a negative slice runs from the
			// zero baseline AWAY from the positive direction, so its end pixel
			// lands on the near side of its start. Take the nearer pixel as the
			// origin and the absolute span as the extent rather than assuming
			// the end is always the far edge — subtracting in a fixed order
			// yields a negative extent, which SVG floors to an invisible rect.
			const startPx = measureScale(sliceStart)
			const endPx = measureScale(sliceEnd)
			const nearPx = Math.min(startPx, endPx)
			const spanPx = Math.abs(endPx - startPx)

			if (aggregation.isVertical) {
				rects.push(
					<rect
						key={`${stack.category}|${slice.key}`}
						x={sliceCatPos}
						y={nearPx}
						width={sliceCatSize}
						height={spanPx}
						fill={fillProp}
						fillOpacity={opacity}
						stroke={sliceStroke}
						strokeOpacity={sliceStrokeOpacity}
						strokeWidth={sliceStrokeWidth}
						onMouseEnter={
							onSliceHover ? (e) => onSliceHover(stack, slice, e) : undefined
						}
					/>
				)
			} else {
				rects.push(
					<rect
						key={`${stack.category}|${slice.key}`}
						x={nearPx}
						y={sliceCatPos}
						width={spanPx}
						height={sliceCatSize}
						fill={fillProp}
						fillOpacity={opacity}
						stroke={sliceStroke}
						strokeOpacity={sliceStrokeOpacity}
						onMouseEnter={
							onSliceHover ? (e) => onSliceHover(stack, slice, e) : undefined
						}
						strokeWidth={sliceStrokeWidth}
					/>
				)
			}
		})
	})

	return rects
}

type BuildSliceLabelsArgs = {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	channelConfigs: ChannelConfigs
	categoryScale: ReturnType<typeof scaleBand<string>>
	measureScale: ReturnType<typeof scaleLinear<number, number>>
	modes: StackModeEntry[]
	/** True when the label field is mapped and distinct from the measure —
	 * that field is then authoritative: slices where it's blank render no
	 * label instead of falling back to the slice's measure. */
	valueFieldMapped?: boolean
}

/** Render the bar's measured value as a `<text>` label centered on each
 * slice. The text encoding's *field* is just an enable flag — the actual
 * label content is the slice's aggregated value (sum or count), formatted
 * via TextConfig.decimals. */
const buildSliceLabels = ({
	aggregation,
	channelConfigs,
	categoryScale,
	measureScale,
	modes,
	valueFieldMapped,
}: BuildSliceLabelsArgs): React.ReactNode[] => {
	const cfg: TextConfig = { ...DEFAULT_TEXT_CONFIG, ...channelConfigs.text }
	const labels: React.ReactNode[] = []

	const maxLeaves = countMaxLeaves(aggregation.stacks, modes)

	aggregation.stacks.forEach((stack) => {
		const catPos = categoryScale(stack.category) ?? 0
		const catSize = categoryScale.bandwidth()
		const geo = layoutSlices(stack, modes, catPos, catSize, maxLeaves)
		const geoByKey = new Map(geo.map((g) => [g.key, g]))
		stack.slices.forEach((slice) => {
			const g = geoByKey.get(slice.key)
			if (!g) return
			const sliceCatPos = g.catPos
			const sliceCatSize = g.catSize
			// Labels use raw geometry (no clamp), matching prior behavior.
			const sliceStart = g.measureStart
			const sliceEnd = g.measureEnd
			const catCenter = sliceCatPos + sliceCatSize / 2

			// When text encodes a different field than length, the aggregator
			// stamps the per-slice `textValue` (numeric → sum; otherwise →
			// first non-empty) and that field is authoritative — a blank slice
			// gets no label. The `slice.value` fallback only applies when text
			// is unset / same as length (label shows the bar's measure).
			const labelValue = valueFieldMapped
				? slice.textValue
				: (slice.textValue ?? slice.value)
			const formatted = formatTextValue(labelValue, cfg.decimals)
			if (formatted === null) return

			const colorKey = Object.values(slice.groupValues)[0]
			const color =
				colorKey !== undefined && cfg.colorOverrides[colorKey]
					? cfg.colorOverrides[colorKey]
					: cfg.color

			if (aggregation.isVertical) {
				const measureCenter =
					(measureScale(sliceStart) + measureScale(sliceEnd)) / 2
				labels.push(
					<text
						key={`lbl-${stack.category}|${slice.key}`}
						x={catCenter}
						y={measureCenter}
						fill={color}
						fontFamily={cfg.fontFamily}
						fontSize={ptToPx(cfg.fontSize)}
						fontWeight={cfg.fontWeight}
						textAnchor="middle"
						dominantBaseline="middle"
						pointerEvents="none"
					>
						{formatted}
					</text>
				)
			} else {
				const measureCenter =
					(measureScale(sliceStart) + measureScale(sliceEnd)) / 2
				labels.push(
					<text
						key={`lbl-${stack.category}|${slice.key}`}
						x={measureCenter}
						y={catCenter}
						fill={color}
						fontFamily={cfg.fontFamily}
						fontSize={ptToPx(cfg.fontSize)}
						fontWeight={cfg.fontWeight}
						textAnchor="middle"
						dominantBaseline="middle"
						pointerEvents="none"
					>
						{formatted}
					</text>
				)
			}
		})
	})

	return labels
}

/** Build per-slice label anchors from a bar aggregation, honoring the
 * per-channel group/stack/overlay layout. Shares the `layoutSlices` geometry
 * engine with `buildRects`/`buildSliceLabels` so legacy text-encoding labels
 * and new Data Labels sit at exactly the same positions.
 *
 * Each anchor's label content is the slice's pre-aggregated `textValue`
 * (which the aggregator computes when the user mapped a value field to
 * Data Labels) — authoritative when `valueFieldMapped`, so blank slices
 * render no label. The `slice.value` (bar measure) fallback only applies
 * when no distinct value field is mapped. Hue inheritance pulls from the
 * slice's groupValues so stacked bars colored by hue get same-color
 * labels. */
export const buildBarAnchors = ({
	aggregation,
	categoryScale,
	measureScale,
	modes,
	decimals,
	formatSpec,
	position,
	outsideOffsetPx,
	sizeField,
	encodings,
	rows,
	valueFieldMapped,
}: {
	aggregation: Extract<Aggregation, { kind: "ok" }>
	categoryScale: ReturnType<typeof scaleBand<string>>
	measureScale: ReturnType<typeof scaleLinear<number, number>>
	modes: StackModeEntry[]
	decimals: number | null
	/** The mapped value field's Label format spec (from
	 *  `DataLabelsConfig.fieldFormats`); wins over `decimals` when set. */
	formatSpec?: string | null
	/** Where the label sits on the slice's measure axis. Defaults to "center". */
	position?: "center" | "inside-base" | "inside-end" | "outside-end"
	/** Pixel pad pushing "inside-base" / "inside-end" / "outside-end" off the
	 * literal slice edge so labels don't kiss the edge. */
	outsideOffsetPx?: number
	/** When the user maps Data Labels' Size channel, pass the field name
	 *  here so labels can be sized per-slice. We aggregate the size field
	 *  across rows matching the slice's category + groupValues, then
	 *  surface the sum as the anchor's `sizeValue`. */
	sizeField?: string | null
	encodings?: Encodings
	rows?: ReadonlyArray<Record<string, unknown>>
	/** True when the label value field is mapped and distinct from the
	 * measure — that field is then authoritative: slices where it's blank
	 * render no label (sparse labeling) instead of falling back to the
	 * bar's measure. */
	valueFieldMapped?: boolean
}): DataLabelAnchor[] => {
	const anchors: DataLabelAnchor[] = []
	const maxLeaves = countMaxLeaves(aggregation.stacks, modes)
	const pos = position ?? "center"
	const pad = outsideOffsetPx ?? 4
	for (const stack of aggregation.stacks) {
		const catPos = categoryScale(stack.category) ?? 0
		const catSize = categoryScale.bandwidth()
		const geo = layoutSlices(stack, modes, catPos, catSize, maxLeaves)
		const geoByKey = new Map(geo.map((g) => [g.key, g]))
		stack.slices.forEach((slice) => {
			const g = geoByKey.get(slice.key)
			if (!g) return
			const sliceCatPos = g.catPos
			const sliceCatSize = g.catSize
			// Anchors use raw geometry (no clamp), matching prior behavior.
			const sliceStart = g.measureStart
			const sliceEnd = g.measureEnd
			const catCenter = sliceCatPos + sliceCatSize / 2

			// Pixel positions of the slice's start/end on the measure axis. For
			// vertical bars, end is "up" (smaller y); for horizontal, end is
			// "right" (larger x). The scale already encodes that orientation.
			const startPx = measureScale(sliceStart)
			const endPx = measureScale(sliceEnd)
			const measurePoint = (() => {
				if (pos === "center") return (startPx + endPx) / 2
				const direction = endPx >= startPx ? 1 : -1
				if (pos === "inside-base") return startPx + direction * pad
				if (pos === "inside-end") return endPx - direction * pad
				// outside-end: just past the slice end
				return endPx + direction * pad
			})()

			const labelValue = valueFieldMapped
				? slice.textValue
				: (slice.textValue ?? slice.value)
			const formatted = formatSingleLabel(labelValue, formatSpec, decimals)
			// `groupValues` carries the slice's hue (when hue is mapped) so
			// stacked / grouped bars colored by hue get matching label fills.
			const hueValue = slice.groupValues.hue
			// Aggregate the size field across rows that belong to this
			// slice (same category + matching mapped group-channel values).
			// Numeric sum mirrors `textValue`'s aggregation rule; non-
			// numeric size fields fall back to the first matching row.
			let sizeValue: number | string | undefined
			if (sizeField && encodings && rows) {
				let sum = 0
				let foundNumeric = false
				let firstNonNumeric: string | undefined
				for (const row of rows) {
					if (
						String(row[aggregation.categoryField]) !== stack.category
					)
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
				cx: aggregation.isVertical ? catCenter : measurePoint,
				cy: aggregation.isVertical ? measurePoint : catCenter,
				key: `${stack.category}|${slice.key}`,
				label: formatted,
				hueValue,
				sizeValue,
			})
		})
	}
	return anchors
}

/** Category-axis leaf key for a slice = the tuple of its group-mode channel
 *  values (the channels that subdivide the band). Slices sharing this key
 *  share a sub-band and thus stack/overlay together on the measure axis. */
const leafKey = (
	groupValues: Partial<Record<GroupChannel, string>>,
	groupModeChannels: GroupChannel[],
): string =>
	// Join on the unit separator (U+001F), not "": an empty delimiter lets
	// distinct tuples collide across value boundaries (hue"a"+pattern"bc" vs
	// hue"ab"+pattern"c" both → "abc"), which would merge two sub-bands in
	// layoutSlices. Matches the aggregator's GROUP_KEY_SEP convention.
	groupModeChannels.map((ch) => groupValues[ch] ?? "").join("\u001F")

/** Shared leaf walk behind `computeBarMeasureMax` / `computeBarMeasureMin`.
 *  The category axis is partitioned by `group`-mode channels; within each
 *  leaf the measure axis sums `stack` slices (or takes the extreme slice when
 *  there is no stack channel). When a `stack`-mode channel is present, every
 *  slice in a leaf is summed — including any `overlay`-mode slices (overlay
 *  is treated as stack in mixed layouts).
 *
 *  `sign` picks the direction: +1 walks only the POSITIVE slices, -1 only the
 *  negatives. The two must stay separate because `layoutSlices` stacks them
 *  on separate ledgers — summing a mixed-sign leaf's slices together would
 *  report its net total as the bound and clip whichever half runs taller. */
const computeBarMeasureBound = (
	stacks: Stack[],
	modes: StackModeEntry[],
	sign: 1 | -1,
): number => {
	const groupModeChannels: GroupChannel[] = modes
		.filter((m) => m.mode === "group")
		.map((m) => m.channel)
	const hasStackChannel = modes.some((m) => m.mode === "stack")
	let bound = 0
	for (const stack of stacks) {
		const perLeaf = new Map<string, number>()
		for (const slice of stack.slices) {
			// Opposite-sign slices belong to the other direction's ledger.
			if (slice.value * sign < 0) continue
			const k = leafKey(slice.groupValues, groupModeChannels)
			const prev = perLeaf.get(k)
			const next = hasStackChannel
				? (prev ?? 0) + slice.value
				: sign > 0
					? Math.max(prev ?? 0, slice.value)
					: Math.min(prev ?? 0, slice.value)
			perLeaf.set(k, next)
		}
		for (const v of perLeaf.values())
			bound = sign > 0 ? Math.max(bound, v) : Math.min(bound, v)
	}
	return bound
}

/** Leaf-aware measure-axis CEILING for bars: the highest point any bar
 *  reaches, floored at 1 so a chart with nothing to draw still gets a usable
 *  axis (and so a density histogram, whose bars are shares ≤ 1, keeps its
 *  0–1 axis). */
export const computeBarMeasureMax = (
	stacks: Stack[],
	modes: StackModeEntry[],
): number => {
	const max = computeBarMeasureBound(stacks, modes, 1)
	// All-negative data tops out AT the zero baseline: every bar hangs below
	// it, so the usual floor of 1 would strand a unit of empty axis above the
	// whole chart. The floor still applies when there's nothing below zero
	// either — that's the empty chart the floor exists for.
	if (max === 0 && computeBarMeasureBound(stacks, modes, -1) < 0) return 0
	return Math.max(1, max)
}

/** Leaf-aware measure-axis FLOOR for bars: the lowest point any bar reaches,
 *  capped at 0. Negative measures pull the axis below zero so the bar has
 *  somewhere to point; all-positive data keeps the zero-based axis bars have
 *  always had. */
export const computeBarMeasureMin = (
	stacks: Stack[],
	modes: StackModeEntry[],
): number => Math.min(0, computeBarMeasureBound(stacks, modes, -1))

export type SliceGeometry = {
	key: string
	catPos: number
	catSize: number
	measureStart: number
	measureEnd: number
}

/** Compute per-slice geometry for one category band.
 *  - `group`-mode channels partition the CATEGORY axis into nested sub-bands
 *    (precedence order = outer→inner). Sub-band width = `bandSize / maxLeaves`,
 *    uniform chart-wide; fewer-than-max leaves are centered.
 *  - `stack`/`overlay`-mode channels partition the MEASURE axis within each
 *    leaf sub-band (stack = cumulative in slice order; overlay = 0→value). */
export const layoutSlices = (
	stack: Stack,
	modes: StackModeEntry[],
	bandPos: number,
	bandSize: number,
	maxLeaves: number,
): SliceGeometry[] => {
	const groupModeChannels: GroupChannel[] = modes
		.filter((m) => m.mode === "group")
		.map((m) => m.channel)
	const hasStack = modes.some((m) => m.mode === "stack")

	// Distinct leaf keys IN SLICE ORDER (slices arrive pre-ordered by the
	// aggregator's level-order sort, so sub-bands follow the legend order).
	const leafOrder: string[] = []
	for (const slice of stack.slices) {
		const k = leafKey(slice.groupValues, groupModeChannels)
		if (!leafOrder.includes(k)) leafOrder.push(k)
	}

	const subBand = bandSize / Math.max(1, maxLeaves)
	// Center this category's leaves when it has fewer than the chart-wide max.
	const centerOffset = (bandSize - leafOrder.length * subBand) / 2
	const leafPos = new Map<string, number>()
	leafOrder.forEach((k, i) => {
		leafPos.set(k, bandPos + centerOffset + i * subBand)
	})

	// Diverging stacks: within a leaf, positive slices cumulate UP from zero
	// and negative slices cumulate DOWN from zero, each on its own ledger.
	// All-positive data is unaffected (the negative ledger stays empty); a
	// mixed-sign leaf grows in both directions off the shared zero baseline
	// instead of letting a negative slice eat into the positive stack.
	const runningPosByLeaf = new Map<string, number>()
	const runningNegByLeaf = new Map<string, number>()
	return stack.slices.map((slice) => {
		const k = leafKey(slice.groupValues, groupModeChannels)
		const ledger = slice.value < 0 ? runningNegByLeaf : runningPosByLeaf
		const start = hasStack ? ledger.get(k) ?? 0 : 0
		const end = start + slice.value
		if (hasStack) ledger.set(k, end)
		return {
			key: slice.key,
			catPos: leafPos.get(k) ?? bandPos,
			catSize: subBand,
			measureStart: start,
			measureEnd: end,
		}
	})
}

/** Chart-wide count of distinct category sub-bands = the max over stacks of
 *  the number of distinct group-mode leaf keys. Drives a uniform sub-band
 *  width so a category with fewer leaves doesn't get wider bars. */
const countMaxLeaves = (stacks: Stack[], modes: StackModeEntry[]): number => {
	const groupModeChannels = modes
		.filter((m) => m.mode === "group")
		.map((m) => m.channel)
	let max = 1
	for (const stack of stacks) {
		const seen = new Set<string>()
		for (const slice of stack.slices)
			seen.add(leafKey(slice.groupValues, groupModeChannels))
		max = Math.max(max, seen.size)
	}
	return max
}
