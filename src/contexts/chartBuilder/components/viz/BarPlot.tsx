import { useMemo, useState } from "react"
import { scaleBand, scaleLinear, scalePoint } from "d3-scale"
import { useAtomValue } from "jotai"
import {
	aggregateBars,
	type GroupChannel,
	type GroupEncoding,
	type Stack,
	toDensityStacks,
} from "../../lib/aggregators/stacks"
import { aggregateField } from "../../lib/aggregateField"
import {
	buildPatternDefs,
	buildPatternDefsFromItems,
	stacksToFillInputs,
	type PatternDefOptions,
} from "../../lib/buildPatternDefs"
import {
	DEFAULT_DENSITY_CURVE_WIDTH,
	AUTO_BAR_GAP_FRACTION,
	DEFAULT_TEXT_CONFIG,
	type ChannelConfigs,
	type ColorSlotConfig,
	type FieldBarPlacement,
	type HistogramConfig,
	type LabelPointsScope,
	type TextConfig,
} from "../../lib/channelConfig"
import { ptToPx } from "../../lib/fontUnit"
import { getChartMode } from "../../lib/chartMode"
import { comboOverlayChannel, isBarModeId } from "../../lib/chartModes/families"
import {
	comboMarksFields,
	comboPointFillResolver,
	dataLabelLayerFor,
	overlayMeasureExtent,
} from "../../lib/comboOverlay"
import { sampleMarkersByConnection } from "../../lib/connectionSampling"
import { sortByDrawOrder } from "../../lib/drawOrder"
import { resolveMarkAesthetics } from "../../lib/resolveMarkAesthetics"
import type { MeasureAxisRendererProps } from "../../lib/chartRendererProps"
import { densityCurveGroupField } from "../../lib/colorSlots"
import { densityCurveMeasures } from "../../lib/densityCurve"
import { histogramBinningForAxis } from "../../lib/histogramBins"
import { applyMirrorSign, resolveMirrorDirection } from "../../lib/mirrorAxis"
import { cartesian } from "./coords"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import type { PatternDefSpec } from "../../lib/patternDefs"
import { aestheticGroupEncodings } from "../../lib/groupEncodings"
import { markOutlineResolver } from "../../lib/markOutline"
import {
	layerFillProp,
	resolveLayerColor,
	resolveSlotColor,
	slotModulationResolver,
	slotOpacityResolver,
} from "../../lib/resolveLayerColor"
import {
	applyHueScale,
	makeHueScale,
	makeOpacityScale,
	type HueScale,
	type PositionScale,
	type UnitScale,
} from "../../lib/scales"
import {
	labelSeriesChannelsFromModes,
	labelSeriesResolverAll,
} from "../../lib/labelSeries"
import {
	resolveStackModes,
	type StackModeEntry,
} from "../../lib/stackMode"
import {
	barLedgerKey,
	barTotalFieldName,
	barTotalsByLedger,
} from "../../lib/barTotalLabel"
import { BAR_LABEL_EDGE_PAD_PX } from "../../lib/dataLabelsLayout"
import { formatSingleLabel } from "../../lib/dataLabelsStyle"
import { formatTextValue } from "../../lib/textEncoding"
import type { Encodings, FieldType } from "../../lib/types"
import {
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentTooltipConfigAtom,
	renderedLabelsAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderDataLabelsConfigAtom,
	renderDataLabelsEncodingsAtom,
} from "../../store/renderConfigs"
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
import { renderAxisStems, renderConnectionLines } from "./scatter/connections"
import {
	buildMarks,
	drawOrderSizeTieBreak,
	renderMarkPaths,
} from "./scatter/marks"
import type { HoverState } from "./scatter/types"

const FALLBACK_FILL = "#6b7280"

/** Moved to `lib/aggregators/stacks.ts` (shared with the data table);
 *  re-exported for existing importers. */
export { toDensityStacks } from "../../lib/aggregators/stacks"

type BarPlotProps = MeasureAxisRendererProps

type BarMode = "bars-x" | "bars-y" | "combo-x" | "combo-y"

type Aggregation =
	| {
			kind: "ok"
			mode: BarMode
			isVertical: boolean
			categoryField: string
			lengthField: string
			categoryType: FieldType
			lengthType: FieldType
			/** Combo modes only: the position variable drawn as scatter MARKS
			 * on the measure axis (y on combo-x, x on combo-y) — a line when
			 * Connection is mapped. Null on plain bars. The measure bounds
			 * below already cover its values. */
			overlayField: string | null
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
			/** "Use a mirrored axis" is on with a valid two-level direction:
			 * the negative direction level's measures were sign-flipped before
			 * aggregation, so its bars hang on the negative side of zero. The
			 * data is still positive counts, so every displayed value (tooltip,
			 * data labels, tick labels) shows the magnitude. */
			mirrored: boolean
	  }
	| {
			kind: "error"
			message: string
	  }

export const BarPlot = (props: BarPlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const labels = useAtomValue(renderedLabelsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataLabels = useAtomValue(renderDataLabelsEncodingsAtom)
	const dataLabelsCfg = useAtomValue(renderDataLabelsConfigAtom)
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
		(dataLabels?.value?.multiField === true &&
			(dataLabels.value.fields?.length ?? 0) > 0) ||
		dataLabels?.hue?.field ||
		dataLabels?.size?.field
	)
	// Multi-field labels: every selected field is aggregated per slice into
	// the anchor's synthetic `row`, which the layer arranges with the
	// templates. Single-field anchors stay pre-formatted (no row).
	const dataLabelsRowFields =
		dataLabels?.value?.multiField === true
			? (dataLabels.value.fields ?? [])
			: undefined
	const dataset = useCurrentDatasetView()
	// Bars layered by a channel offer the derived BAR TOTAL under Value
	// (`lib/barTotalLabel.ts`): there is no column to aggregate —
	// `buildBarAnchors` sums each bar's layers. A data set column of that
	// name is just a column.
	const barTotalField = barTotalFieldName(
		(dataset?.fields ?? []).map((f) => f.name)
	)
	const valueIsBarTotal =
		barTotalField !== null && dataLabels?.value?.field === barTotalField
	const aestheticScales = useAestheticScales()
	const legendHighlight = useLegendHighlight()
	const markHover = useMarkHoverHighlight(aestheticScales.hue?.field.name ?? null)
	// Combo marks layer: the same hover plumbing ScatterPlot gives its points
	// and lines. "Show tooltips only at points" and the Draw-order ranking
	// apply to the layer exactly as on a scatter.
	const tooltipPointsOnly = !!useAtomValue(currentTooltipConfigAtom).pointsOnly
	const drawOrderLevels = channelConfigs.drawOrder?.field
		? levelOrders[channelConfigs.drawOrder.field]
		: undefined
	const [overlayHovered, setOverlayHovered] = useState<HoverState | null>(null)
	const hueFieldName = aestheticScales.hue?.field.name ?? null
	const publishOverlayHover = (row: Record<string, unknown>) =>
		markHover.enter(hueFieldName ? row[hueFieldName] : undefined)

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
		const detected = getChartMode(encodings, getType, channelConfigs)
		if (!isBarModeId(detected)) return null
		const mode = detected as BarMode
		// Vertical bars: categories along x, measure up y. The combo modes
		// follow the same orientation rule as their bar twins.
		const isVertical = mode === "bars-x" || mode === "combo-x"
		const categoryField = isVertical ? encodings.x.field : encodings.y.field
		if (!categoryField) return null
		const categoryType = effectiveType(dataset, categoryField, overrides)
		// Combo: the OTHER position variable rides the measure axis as marks.
		const overlayChannel = comboOverlayChannel(mode)
		const overlayField = overlayChannel
			? (encodings[overlayChannel]?.field ?? null)
			: null
		// Histogram: the category axis is a binned quantitative field and bar
		// height is the COUNT of rows per bin — no measure field. Otherwise
		// it's a normal bar chart, which requires a `length` measure.
		const categoryChannel = isVertical ? "x" : "y"
		const histogramCfg = channelConfigs[categoryChannel]?.histogram
		// A combo always has a Length measure; a leftover histogram toggle on
		// its category axis must not swap the bars for row counts.
		const isHistogram =
			overlayField === null &&
			histogramCfg?.enabled === true &&
			categoryType === "quantitative"
		const lengthField = encodings.length?.field ?? ""
		if (!isHistogram && !lengthField) return null
		// "Use a mirrored axis" lives on the MEASURE axis's config (the
		// field-less position axis the length feeds). Levels are discovered
		// over the whole dataset so faceted panels agree on sides.
		const measureChannel = isVertical ? "y" : "x"
		const mirrorDirection =
			!isHistogram && lengthField
				? resolveMirrorDirection(
						channelConfigs[measureChannel]?.mirror,
						dataset.rows,
						getType,
						levelOrders
					)
				: null

		// The channels that split a bar into segments — one list for every
		// aggregating renderer (`lib/groupEncodings`), so the plot and the
		// hook agree exactly on which channels are mapped.
		const groups: GroupEncoding[] = aestheticGroupEncodings(aestheticScales)

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
		const textField = valueIsBarTotal
			? undefined
			: (dataLabels?.value?.field ?? encodings.text?.field ?? undefined)
		const textType = textField
			? effectiveType(dataset, textField, overrides)
			: undefined

		// Category/measure axis row sources. For bars-x: x=category,
		// measure=y → categoryRows=rowsForXScale, measureRows=rowsForYScale.
		// Reversed for bars-y. (Resolved here so histogram bin edges can be
		// derived from the CATEGORY-axis source — keeping faceted panels that
		// share the category axis on the same bins.)
		const categoryRows = isVertical ? rowsForXScale : rowsForYScale
		const measureRows = isVertical ? rowsForYScale : rowsForXScale

		// Histogram transform: partition the quantitative category field into
		// equal-width bins and relabel each row's category value with its bin.
		// Bar height is then the COUNT of rows per bin (see `countRows` below),
		// and hue stacking still works via the group encodings. Bin edges come
		// from the category scale source so shared-axis facets agree on the
		// buckets.
		// Bin-edge labels honor the binned axis's tick-format setting (e.g. an
		// SI format renders "20000 – 30000" as "20k – 30k"; Before / After
		// text wraps each edge) — `histogramBinningForAxis`, shared with the data
		// table. Its tick formatter is null
		// when the format is fully Auto, in which case the binner uses its
		// built-in precision formatter.
		const binning = isHistogram
			? histogramBinningForAxis(
					categoryRows.map((r) => r[categoryField]),
					channelConfigs[categoryChannel]
			  )
			: null
		const prep = (rows: typeof rowsForChart): typeof rowsForChart => {
			// Mirror first: rows of the negative direction level get their
			// measure negated, and the existing diverging-stack geometry
			// (separate ledgers per sign) puts them on the other side of zero.
			if (mirrorDirection)
				rows = applyMirrorSign(rows, lengthField, mirrorDirection)
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
		// Combo: the marks ride the same measure axis, so its bounds cover
		// their values too (the shared-axis path does the same per panel in
		// shareScales.ts). Auto-fit only — a faceted override or a pinned
		// range wins as it does for the bars.
		const overlayExtent = overlayField
			? overlayMeasureExtent(measureRows, overlayField)
			: null
		const measureMax =
			props.measureMaxOverride ??
			Math.max(
				computeBarMeasureMax(isDensity ? renderStacks : measureStacks, modes),
				overlayExtent?.max ?? -Infinity
			)
		const measureMin =
			props.measureMinOverride ??
			Math.min(
				computeBarMeasureMin(isDensity ? renderStacks : measureStacks, modes),
				overlayExtent?.min ?? Infinity
			)

		return {
			kind: "ok",
			mode,
			isVertical,
			categoryField,
			lengthField,
			categoryType,
			lengthType,
			overlayField,
			stacks: renderStacks,
			scaleCategories,
			measureMin,
			measureMax,
			isHistogram,
			isDensity,
			binDomain: binning ? binning.domain : null,
			mirrored: mirrorDirection !== null,
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
		channelConfigs.length?.render,
		channelConfigs.x?.histogram,
		channelConfigs.y?.histogram,
		channelConfigs.x?.customFormat,
		channelConfigs.y?.customFormat,
		channelConfigs.x?.min,
		channelConfigs.x?.max,
		channelConfigs.y?.min,
		channelConfigs.y?.max,
		channelConfigs.x?.mirror,
		channelConfigs.y?.mirror,
		levelOrders,
		props.measureMaxOverride,
		props.measureMinOverride,
		dataLabels?.value?.field,
		valueIsBarTotal,
	])

	// Pattern defs depend only on aesthetic categories + slice group values +
	// channelConfigs — not on the measured rect. Pre-compute so they can be
	// registered in `<defs>` before marks render. The options MUST match the
	// ones `buildRects` hands `resolveLayerColor` below (same default-pattern
	// opt-in + line-context default-to-none as ScatterPlot).
	const connectionMapped = !!encodings.connection?.field
	const patternDefs = useMemo<PatternDefSpec[]>(() => {
		if (!aggregation || aggregation.kind === "error") return []
		const patternOptions = {
			defaultToNone: connectionMapped,
			includeDefaultPattern: true,
		}
		const barDefs = buildPatternDefs(
			stacksToFillInputs(aggregation.stacks),
			aestheticScales,
			channelConfigs,
			channelConfigs.defaultFill ?? FALLBACK_FILL,
			channelConfigs.pattern?.backgroundColor ?? null,
			patternOptions
		)
		if (!aggregation.overlayField) return barDefs
		// Combo marks resolve their fills per ROW (ScatterPlot's pipeline), so
		// their pattern ids come from the per-item builder; both key on the
		// same svgId, so a def the bars already emitted is skipped.
		const patternField = aestheticScales.pattern?.field.name ?? null
		if (!patternField && channelConfigs.defaultPattern == null) return barDefs
		const seen = new Set(barDefs.map((d) => d.svgId))
		const markDefs = buildPatternDefsFromItems(
			rowsForChart.map((row) => {
				const aes = resolveMarkAesthetics(row, aestheticScales, channelConfigs)
				return {
					patternValue: patternField ? row[patternField] : undefined,
					fill: aes.fill,
					preModulationHue: aes.preModulationHue,
					satUnit: aes.satUnit,
					briUnit: aes.briUnit,
				}
			}),
			aestheticScales,
			channelConfigs,
			channelConfigs.pattern?.backgroundColor ?? null,
			patternOptions
		).filter((d) => !seen.has(d.svgId))
		return markDefs.length ? [...barDefs, ...markDefs] : barDefs
	}, [
		aggregation,
		aestheticScales,
		channelConfigs,
		connectionMapped,
		rowsForChart,
	])

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
		// `.nice()` rounds the auto-fit ends outward; a USER-pinned end
		// (Scale range / facet override) must stay exactly where typed.
		const pinned = props.measurePinnedBounds
		if (pinned?.min != null || pinned?.max != null) {
			const [d0, d1] = measureScale.domain()
			measureScale.domain([pinned.min ?? d0, pinned.max ?? d1])
		}
		const measurePinned = pinned?.min != null && pinned?.max != null

		const xScale: PositionScale = isVertical ? categoryScale : measureScale
		const yScale: PositionScale = isVertical ? measureScale : categoryScale

		return cartesian({
			xScale,
			yScale,
			xDomainPinned: !isVertical && measurePinned,
			yDomainPinned: isVertical && measurePinned,
			xMirrored: !isVertical && aggregation.mirrored,
			yMirrored: isVertical && aggregation.mirrored,
			xAxisConfig: channelConfigs.x,
			xReplaceTicks: props.xTicksOverride,
			yReplaceTicks: props.yTicksOverride,
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
	// Bar slices compose their own aggregate fields; a hovered combo MARK
	// shows its full row (or, on a line hover, the fields the line supplies),
	// exactly as ScatterPlot's points do.
	const tooltip = hovered ? (
		<HoverTooltip state={hovered} />
	) : overlayHovered && dataset ? (
		<HoverTooltip
			state={{
				clientX: overlayHovered.clientX,
				clientY: overlayHovered.clientY,
				fields:
					overlayHovered.fields ??
					dataset.fields.map((f) => ({
						name: f.name,
						value: overlayHovered.row[f.name],
					})),
				seriesOnly: overlayHovered.seriesOnly,
			}}
		/>
	) : null

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
				// Mirrored bars carry a render-time sign; the data is positive.
				{
					name: measureName,
					value: aggregation.mirrored ? Math.abs(slice.value) : slice.value,
				},
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
		// Combo marks layer: the overlay position variable as scatter marks on
		// the measure axis, joined into lines by Connection — ScatterPlot's own
		// mark / line / stem builders over the bars' scales. The category
		// scale is a BAND; the marks need the band CENTERS, which a point
		// scale over the same categories spanning first-center → last-center
		// reproduces exactly (uniform padding spaces both evenly). Length and
		// angle are stripped from the aesthetics the marks resolve: here
		// Length IS the bars, not a segment on every point.
		const labelLayerCfg = { fieldLayers: dataLabelsCfg?.fieldLayers }
		const marksFields = comboMarksFields(aggregation.mode, encodings, channelConfigs)
		const overlayNode = (() => {
			if (!aggregation.overlayField) return null
			const categories = categoryScale.domain()
			if (categories.length === 0) return null
			const half = categoryScale.bandwidth() / 2
			const first = (categoryScale(categories[0]) ?? 0) + half
			const last = (categoryScale(categories[categories.length - 1]) ?? 0) + half
			const centerScale = scalePoint<string>()
				.domain(categories)
				.range([first, last])
			const oxScale: PositionScale = aggregation.isVertical
				? centerScale
				: measureScale
			const oyScale: PositionScale = aggregation.isVertical
				? measureScale
				: centerScale
			const oxType: FieldType = aggregation.isVertical
				? "categorical"
				: "quantitative"
			const oyType: FieldType = aggregation.isVertical
				? "quantitative"
				: "categorical"
			const connectionColor = liveTheme.connectionColor
			// Point fill: a point belongs to the LINE it sits on, so it takes
			// the line's color (or the Point fill slot's), not the bars' Color
			// mapping the shared mark pipeline resolved. The per-shape fill /
			// stroke follow when they were derived from that fill; explicit
			// per-category shape overrides and pattern fills stay.
			const pointFill = comboPointFillResolver({
				rows: rowsForChart,
				encodings,
				channelConfigs,
				aestheticScales,
				connectionColor,
			})
			// The points' own Saturation / Brightness and Opacity (Point fill in
			// those menus). Untouched they change nothing: the fill is the
			// resolved color as it was, and the opacity stays the one the shared
			// mark pipeline gave the points (the bars'), so saved combos draw
			// as before. Set, the opacity is the points' own.
			const pointShade = slotModulationResolver(
				"comboPointFill",
				channelConfigs,
				aestheticScales
			)
			const pointOpacity = channelConfigs.opacitySlots?.comboPointFill
				? slotOpacityResolver("comboPointFill", channelConfigs, aestheticScales)
				: null
			const marks = buildMarks({
				rowsForChart,
				encodings,
				channelConfigs: { ...channelConfigs, defaultLength: null },
				aestheticScales: { ...aestheticScales, length: null, angle: null },
				xScale: oxScale,
				yScale: oyScale,
				xType: oxType,
				yType: oyType,
			}).map((built) => {
				const m = pointOpacity
					? { ...built, markOpacity: pointOpacity(built.row) }
					: built
				if (m.patternId !== null) return m
				const fill = pointShade(pointFill(m.row), m.row)
				return {
					...m,
					fill,
					shapeFill: m.shapeFill === m.fill ? fill : m.shapeFill,
					shapeStroke: m.shapeStroke === m.fill ? fill : m.shapeStroke,
				}
			})
			if (marks.length === 0) return null
			const connectionField = encodings.connection?.field ?? null
			const markedIndices = connectionField
				? sampleMarkersByConnection(
						marks,
						connectionField,
						channelConfigs,
						(m) => m.cx
					)
				: null
			return (
				<g data-combo-marks>
					{renderAxisStems(
						marks,
						channelConfigs,
						oxScale,
						oyScale,
						aestheticScales.colorSlots.stem,
						channelConfigs.colorSlots?.stem,
						slotOpacityResolver("stem", channelConfigs, aestheticScales),
						connectionColor,
						legendHighlight
					)}
					{renderConnectionLines(
						marks,
						encodings,
						channelConfigs,
						slotOpacityResolver("line", channelConfigs, aestheticScales),
						aestheticScales.colorSlots.line,
						connectionColor,
						oxScale,
						oxType,
						dataset,
						drawOrderLevels,
						aestheticScales.hue?.field.type,
						aestheticScales.themeInkFallback,
						setOverlayHovered,
						legendHighlight,
						publishOverlayHover,
						markedIndices,
						tooltipPointsOnly,
						slotModulationResolver("line", channelConfigs, aestheticScales),
						(row) =>
							resolveMarkAesthetics(row, aestheticScales, channelConfigs)
								.preModulationHue
					)}
					{renderMarkPaths({
						marks: sortByDrawOrder(
							marks,
							(m) => m.row,
							channelConfigs.drawOrder,
							dataset,
							drawOrderLevels,
							drawOrderSizeTieBreak
						),
						markedIndices,
						channelConfigs,
						hoveredIdx: overlayHovered?.i ?? null,
						borderOpacity: slotOpacityResolver(
							"border",
							channelConfigs,
							aestheticScales
						),
						setHovered: setOverlayHovered,
						highlight: legendHighlight,
						publishHover: publishOverlayHover,
					})}
					{/* Labels on the marks: one per row at the point, ranked per
					 *  Connection series like a line chart's (the row path over
					 *  the marks' scales) — the labels `dataLabelLayerFor` puts on
					 *  this layer; the bars' layer below draws the rest. */}
					{anyDataLabelsMapped && (
						<DataLabelsLayer
							rows={rowsForChart}
							xScale={oxScale}
							yScale={oyScale}
							xType={oxType}
							yType={oyType}
							positionFields={{
								x: encodings.x?.field ?? null,
								y: encodings.y?.field ?? null,
							}}
							labelFilter={(key, fields) =>
								dataLabelLayerFor(labelLayerCfg, key, fields, marksFields) ===
								"marks"
							}
						/>
					)}
				</g>
			)
		})()
		return (
			<g
				onMouseLeave={() => {
					setHovered(null)
					setOverlayHovered(null)
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
						rugShade: slotModulationResolver("rug", channelConfigs, aestheticScales),
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
						strokeWidth: channelConfigs.shape?.densityCurveOutlineWidth,
						// Each part's color, then its own Saturation / Brightness.
						strokeFor: (row) =>
							slotModulationResolver("densityCurveStroke", channelConfigs, aestheticScales)(
								channelConfigs.colorSlots?.densityCurveStroke
									? resolveSlotColor(
											aestheticScales.colorSlots.densityCurveStroke,
											channelConfigs.colorSlots.densityCurveStroke,
											row,
											liveTheme.distributionOverlayStroke
										)
									: liveTheme.distributionOverlayStroke,
								row
							),
						fillFor: (row) =>
							slotModulationResolver("densityCurveFill", channelConfigs, aestheticScales)(
								channelConfigs.colorSlots?.densityCurveFill
									? resolveSlotColor(
											aestheticScales.colorSlots.densityCurveFill,
											channelConfigs.colorSlots.densityCurveFill,
											row,
											liveTheme.distributionOverlayFill
										)
									: liveTheme.distributionOverlayFill,
								row
							),
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
				{overlayNode}
				{encodings.text?.field &&
					buildSliceLabels({
						aggregation,
						channelConfigs,
						categoryScale,
						measureScale,
						modes,
						valueFieldMapped,
						sliceOpacity: (groupValues) =>
							groupHighlight(legendHighlight, groupValues, aestheticScales)
								.opacityMul,
					})}
				{anyDataLabelsMapped && (
					<DataLabelsLayer
						rows={rowsForChart}
						xScale={xScale}
						yScale={yScale}
						xType={aggregation.isVertical ? "categorical" : "quantitative"}
						yType={aggregation.isVertical ? "quantitative" : "categorical"}
						// Combo: the labels on the marks draw in the marks layer.
						labelFilter={
							aggregation.overlayField
								? (key, fields) =>
										dataLabelLayerFor(labelLayerCfg, key, fields, marksFields) ===
										"bars"
								: undefined
						}
						anchors={buildBarAnchors({
							aggregation,
							categoryScale,
							measureScale,
							modes,
							decimals: dataLabelsDecimals,
							formatSpec: dataLabelsFormatSpec,
							position: dataLabelsCfg?.barLabelPosition ?? "center",
							side: dataLabelsCfg?.barLabelSide ?? "center",
							// Own labels (standalone variables, combinations) read their
							// placement by key; the arranged label never does.
							fieldPlacements: dataLabelsCfg?.fieldBarPlacements,
							sizeField: dataLabels?.size?.field ?? null,
							labelFields: dataLabelsRowFields,
							encodings,
							rows: rowsForChart,
							valueFieldMapped,
							barTotalField,
							valueIsBarTotal,
							sliceOpacity: (groupValues) =>
								groupHighlight(legendHighlight, groupValues, aestheticScales)
									.opacityMul,
							labelPointsScope: dataLabelsCfg?.labelPointsScope,
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
	rugShade,
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
	/** The rug's own Saturation / Brightness, applied to each tick's color. */
	rugShade: (color: string, row: Record<string, unknown>) => string
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
	const baseColorFor = (row: Record<string, unknown>): string => {
		// When the rug color slot is configured it fully owns the color
		// (independent field mapping or single color); fall back to the legacy
		// hue-indexed rug coloring only when no slot exists.
		if (rugSlotCfg) return resolveSlotColor(rugSlot, rugSlotCfg, row, histogram.rugColor)
		if (!usePalette || !hueField) return histogram.rugColor
		const idx = hueDomain.indexOf(String(row[hueField]))
		return idx >= 0 ? palette[idx % palette.length] : histogram.rugColor
	}
	const colorFor = (row: Record<string, unknown>): string =>
		rugShade(baseColorFor(row), row)

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
	strokeWidth = DEFAULT_DENSITY_CURVE_WIDTH,
	fillOpacity,
	categoryScale,
	measureScale,
}: {
	/** The curve's line thickness (Size → Density curve outline). */
	strokeWidth?: number
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
					strokeWidth={strokeWidth}
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
		// A curve is one mark built from many rows: its color and shading
		// resolve off its FIRST row, like every other per-part target, so a
		// "Vary by" on any variable reaches it (it used to be handed a row
		// holding the group value alone, and other variables did nothing).
		const firstRows = new Map<string, Record<string, unknown>>()
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
				firstRows.set(key, r)
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
					const row = firstRows.get(key) ?? { [groupField]: key }
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
	// The one curve over every row: off the first row drawn.
	const first = rows.find((r) => Number.isFinite(numFor(r[categoryField]))) ?? {}
	return renderCurve(grid, measure, strokeFor(first), fillFor(first), "single")
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
	// Each segment's outline — its color (rule, Outline variable, or the one
	// outline color), saturation / brightness, opacity and thickness — through the
	// resolver every mark's outline shares (`lib/markOutline`). A segment is
	// built from several rows, so the per-part targets resolve off its first
	// row. Fill opacity is each slice's overall opacity (the Fill subheader =
	// the opacity encoding), applied directly — opacity slots are absolute.
	const outlineFor = markOutlineResolver(channelConfigs, aestheticScales)
	const defaultFill = channelConfigs.defaultFill ?? FALLBACK_FILL
	const patternBgOverride = channelConfigs.pattern?.backgroundColor ?? null

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
				patternBgOverride,
				aestheticScales,
				channelConfigs,
				patternOptions,
				rows: slice.rows,
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
			// `layer.outline` is the segment's rule / Outline-variable color
			// (resolved off its group value), or null for the one outline color.
			const outline = outlineFor(slice.rows?.[0] ?? {}, { color: layer.outline })
			const sliceStroke = mh.outline ?? outline.stroke
			const sliceStrokeWidth = mh.outline
				? Math.max(outline.strokeWidth, mh.outlineWidth)
				: outline.strokeWidth
			const sliceStrokeOpacity = mh.outline ? 1 : outline.strokeOpacity

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
	/** Legend-hover fade for the slice a label sits on (1 = no fade), so a
	 * label recedes with its own bar. */
	sliceOpacity?: (groupValues: Record<string, string | undefined>) => number
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
	sliceOpacity,
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
			// A mirrored bar's sign is render-time only — label the magnitude.
			const measureValue = aggregation.mirrored
				? Math.abs(slice.value)
				: slice.value
			const labelValue = valueFieldMapped
				? slice.textValue
				: (slice.textValue ?? measureValue)
			const formatted = formatTextValue(labelValue, cfg.decimals)
			if (formatted === null) return

			const colorKey = Object.values(slice.groupValues)[0]
			const color =
				colorKey !== undefined && cfg.colorOverrides[colorKey]
					? cfg.colorOverrides[colorKey]
					: cfg.color
			// Legend-hover fade: the label recedes with its own slice.
			const fadeMul = sliceOpacity?.(slice.groupValues) ?? 1
			const fadeOpacity = fadeMul < 1 ? fadeMul : undefined

			if (aggregation.isVertical) {
				const measureCenter =
					(measureScale(sliceStart) + measureScale(sliceEnd)) / 2
				labels.push(
					<text
						key={`lbl-${stack.category}|${slice.key}`}
						x={catCenter}
						y={measureCenter}
						opacity={fadeOpacity}
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
						opacity={fadeOpacity}
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
 * labels.
 *
 * Multi-field labels (`labelFields` set): each anchor additionally carries
 * a synthetic `row` — the slice's category, its group values (hue /
 * pattern / … under their field names), the measure under the length
 * field, and every label field aggregated over the slice's rows (numeric
 * → sum, else first non-empty — the `textValue` rule). The label layer
 * arranges that row with the user's templates. The derived Bar total
 * (`lib/barTotalLabel.ts`) is summed here — the layers of the slice's
 * physical bar — and rides on every row under `barTotalField`; as the
 * single-field Value (`valueIsBarTotal`) it is the label itself. */
export const buildBarAnchors = ({
	aggregation,
	categoryScale,
	measureScale,
	modes,
	decimals,
	formatSpec,
	position,
	side,
	fieldPlacements,
	outsideOffsetPx,
	sizeField,
	labelFields,
	encodings,
	rows,
	valueFieldMapped,
	sliceOpacity,
	labelPointsScope,
	barTotalField,
	valueIsBarTotal,
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
	/** Which side of the slice the label sits on across the CATEGORY axis
	 *  (`DataLabelsConfig.barLabelSide`). "before" / "after" anchor the label
	 *  on the slice's leading / trailing category edge plus the pad — so the
	 *  Adjust-position nudge measures from the bar's edge and a label beside
	 *  a bar stays beside it however wide the bar renders — and set the
	 *  anchor's `hAlign` (vertical bars: the block hangs away from the bar)
	 *  or `vAlign` (horizontal bars: the block's near edge meets the anchor).
	 *  Defaults to "center". */
	side?: "center" | "before" | "after"
	/** Separate-variables mode: each label field's OWN placement
	 *  (`DataLabelsConfig.fieldBarPlacements`), position / side falling back
	 *  to `position` / `side`. Every anchor then also carries
	 *  `fieldPlacements` — the resolved point + hanging alignment per field
	 *  that has an entry — which the layer uses for that variable's box
	 *  instead of the anchor's base point. */
	fieldPlacements?: Record<string, FieldBarPlacement>
	/** Pixel pad pushing "inside-base" / "inside-end" / "outside-end" off the
	 * literal slice edge — and a "before" / "after" side off the category
	 * edge — so labels don't kiss the bar. */
	outsideOffsetPx?: number
	/** When the user maps Data Labels' Size channel, pass the field name
	 *  here so labels can be sized per-slice. We aggregate the size field
	 *  across rows matching the slice's category + groupValues, then
	 *  surface the sum as the anchor's `sizeValue`. */
	sizeField?: string | null
	/** Multi-field Data Labels: the selected fields, each aggregated per
	 *  slice into the anchor's `row` (see above). Unset → no row. */
	labelFields?: readonly string[]
	encodings?: Encodings
	rows?: ReadonlyArray<Record<string, unknown>>
	/** True when the label value field is mapped and distinct from the
	 * measure — that field is then authoritative: slices where it's blank
	 * render no label (sparse labeling) instead of falling back to the
	 * bar's measure. */
	valueFieldMapped?: boolean
	/** Legend-hover fade for the slice a label annotates (1 = no fade), so a
	 * label recedes with its own bar. Resolved by the caller, which holds the
	 * highlight state and the aesthetic scales. */
	sliceOpacity?: (groupValues: Record<string, string | undefined>) => number
	/** What "first" / "last" run over (`DataLabelsConfig.labelPointsScope`).
	 *  Drives each anchor's `series` + `rank`; defaults to "series". */
	labelPointsScope?: LabelPointsScope
	/** The name the derived Bar total is exposed under (`BAR_TOTAL_FIELD`)
	 *  when the data set has no column of that name; null otherwise. A
	 *  multi-field row carries the slice's bar total under it when it's
	 *  among `labelFields` — a column of that name aggregates like any
	 *  field. */
	barTotalField?: string | null
	/** The single-field Value IS the derived Bar total: every slice labels
	 *  its bar's total — the sum of the layers in its physical bar (its leaf
	 *  sub-band, on its sign side) — in place of its `textValue`. */
	valueIsBarTotal?: boolean
}): DataLabelAnchor[] => {
	const anchors: DataLabelAnchor[] = []
	const maxLeaves = countMaxLeaves(aggregation.stacks, modes)
	// Every scope's series + rank per anchor: the layer-wide one fills the
	// anchor's `series` / `rank`, and the whole map rides along so each
	// composed label can be ranked by its OWN "Of each" choice.
	const seriesAllOf = labelSeriesResolverAll(
		labelSeriesChannelsFromModes(modes),
		aggregation.categoryField,
		encodings
	)
	const layerScope = labelPointsScope ?? "series"
	const pos = position ?? "center"
	const pad = outsideOffsetPx ?? BAR_LABEL_EDGE_PAD_PX
	const catSide = side ?? "center"
	// Beside the bar: the block hangs away from the slice. Vertical bars fix
	// the text alignment (left of the bar → text ends at the anchor; right →
	// starts there); horizontal bars fix which vertical edge of the block
	// meets the anchor (above → block bottom; below → block top).
	const hangFor = (
		s: NonNullable<typeof side>
	): Pick<DataLabelAnchor, "hAlign" | "vAlign"> => ({
		hAlign:
			aggregation.isVertical && s !== "center"
				? s === "after"
					? "left"
					: "right"
				: undefined,
		vAlign:
			!aggregation.isVertical && s !== "center"
				? s === "after"
					? "top"
					: "bottom"
				: undefined,
	})
	const { hAlign, vAlign } = hangFor(catSide)
	// Per-variable placements resolve against the layer-wide pair; only
	// fields with an entry get a resolved point on the anchor.
	const ownPlacements = Object.entries(fieldPlacements ?? {}).map(
		([field, p]) =>
			[field, p.position ?? pos, p.side ?? catSide] as const
	)
	// Rows belonging to each slice (same category + matching mapped
	// group-channel values), indexed once so per-slice field aggregation
	// (the size field, the multi-field label fields) doesn't rescan the
	// dataset per slice. Only built when something needs it.
	const needsSliceRows =
		encodings && rows && (sizeField || (labelFields?.length ?? 0) > 0)
	const sliceRowsIndex = new Map<string, Record<string, unknown>[]>()
	if (needsSliceRows && encodings && rows) {
		const groupFields = Object.keys(
			aggregation.stacks[0]?.slices[0]?.groupValues ?? {}
		)
			.map((ch) => ({
				channel: ch,
				field: encodings[ch as keyof typeof encodings]?.field ?? null,
			}))
			.filter((g): g is { channel: string; field: string } => g.field !== null)
		for (const row of rows) {
			const cat = String(row[aggregation.categoryField])
			const gv = groupFields
				.map((g) => `${g.channel}=${String(row[g.field])}`)
				.join("|")
			const k = `${cat}\u0000${gv}`
			const bucket = sliceRowsIndex.get(k)
			if (bucket) bucket.push(row)
			else sliceRowsIndex.set(k, [row])
		}
	}
	const sliceRowsFor = (
		category: string,
		groupValues: Record<string, string | undefined>
	): Record<string, unknown>[] => {
		if (!encodings) return []
		const gv = Object.entries(groupValues)
			.filter(([ch]) => encodings[ch as keyof typeof encodings]?.field)
			.map(([ch, v]) => `${ch}=${v}`)
			.join("|")
		return sliceRowsIndex.get(`${category}\u0000${gv}`) ?? []
	}
	// One field over a slice's rows — `lib/aggregateField.ts` (numeric sum,
	// else first non-empty; the aggregator's `textValue` rule), shared with
	// the pie anchors.
	for (const stack of aggregation.stacks) {
		const catPos = categoryScale(stack.category) ?? 0
		const catSize = categoryScale.bandwidth()
		const geo = layoutSlices(stack, modes, catPos, catSize, maxLeaves)
		const geoByKey = new Map(geo.map((g) => [g.key, g]))
		// Each physical bar's total — one ledger per leaf sub-band and sign
		// side, the unit the "stack" scope ranks layers in.
		const totals = barTotalsByLedger(
			stack.slices.map((s) => ({
				leafIndex: geoByKey.get(s.key)?.leafIndex ?? 0,
				value: s.value,
			}))
		)
		stack.slices.forEach((slice) => {
			const g = geoByKey.get(slice.key)
			if (!g) return
			const sliceCatPos = g.catPos
			const sliceCatSize = g.catSize
			// Anchors use raw geometry (no clamp), matching prior behavior.
			const sliceStart = g.measureStart
			const sliceEnd = g.measureEnd
			const catCenter = sliceCatPos + sliceCatSize / 2
			// Category-axis point: the slice's center, or — beside the bar —
			// its leading / trailing edge pushed off by the pad. The band
			// runs left→right (vertical bars) or top→bottom (horizontal), so
			// "before" is left / above and "after" is right / below.
			const catPointFor = (s: NonNullable<typeof side>) =>
				s === "before"
					? sliceCatPos - pad
					: s === "after"
						? sliceCatPos + sliceCatSize + pad
						: catCenter
			const catPoint = catPointFor(catSide)

			// Pixel positions of the slice's start/end on the measure axis. For
			// vertical bars, end is "up" (smaller y); for horizontal, end is
			// "right" (larger x). The scale already encodes that orientation.
			const startPx = measureScale(sliceStart)
			const endPx = measureScale(sliceEnd)
			const measurePointFor = (p: NonNullable<typeof position>) => {
				if (p === "center") return (startPx + endPx) / 2
				const direction = endPx >= startPx ? 1 : -1
				if (p === "inside-base") return startPx + direction * pad
				if (p === "inside-end") return endPx - direction * pad
				// outside-end: just past the slice end
				return endPx + direction * pad
			}
			const measurePoint = measurePointFor(pos)
			let fieldPoints: DataLabelAnchor["fieldPlacements"]
			if (ownPlacements.length > 0) {
				fieldPoints = {}
				for (const [field, p, s] of ownPlacements) {
					const m = measurePointFor(p)
					const c = catPointFor(s)
					fieldPoints[field] = {
						cx: aggregation.isVertical ? c : m,
						cy: aggregation.isVertical ? m : c,
						...hangFor(s),
					}
				}
			}

			// A mirrored bar's sign is render-time only — label the magnitude.
			const measureValue = aggregation.mirrored
				? Math.abs(slice.value)
				: slice.value
			// The slice's bar total (`lib/barTotalLabel.ts`) — the magnitude on
			// a mirrored bar, like the measure.
			const rawTotal =
				totals.get(barLedgerKey(g.leafIndex, slice.value)) ?? slice.value
			const barTotal = aggregation.mirrored ? Math.abs(rawTotal) : rawTotal
			const labelValue = valueIsBarTotal
				? barTotal
				: valueFieldMapped
					? slice.textValue
					: (slice.textValue ?? measureValue)
			const formatted = formatSingleLabel(labelValue, formatSpec, decimals)
			// `groupValues` carries the slice's hue (when hue is mapped) so
			// stacked / grouped bars colored by hue get matching label fills.
			const hueValue = slice.groupValues.hue
			// Aggregate the size field across rows that belong to this
			// slice (same category + matching mapped group-channel values).
			// Numeric sum mirrors `textValue`'s aggregation rule; non-
			// numeric size fields fall back to the first matching row.
			const sliceRows = needsSliceRows
				? sliceRowsFor(stack.category, slice.groupValues)
				: []
			const sizeValue =
				sizeField && needsSliceRows
					? aggregateField(sliceRows, sizeField)
					: undefined
			// Multi-field labels: the slice as one record. Aggregated label
			// fields first, then the slice's own identity on top — category,
			// group values under their field names, the measure under the
			// length field (so a mirrored bar labels its magnitude, and a
			// histogram's count-per-bin reads through the binned field).
			let row: Record<string, unknown> | undefined
			if (labelFields && labelFields.length > 0 && encodings) {
				row = {}
				for (const f of labelFields)
					row[f] =
						f === barTotalField ? barTotal : aggregateField(sliceRows, f)
				row[aggregation.categoryField] = stack.category
				for (const [channel, value] of Object.entries(slice.groupValues)) {
					const fieldName = encodings[channel as keyof typeof encodings]?.field
					if (fieldName) row[fieldName] = value
				}
				if (aggregation.lengthField) row[aggregation.lengthField] = measureValue
			}

			const seriesByScope = seriesAllOf({
				category: stack.category,
				groupValues: slice.groupValues,
				categoryRank: g.catPos,
				leafIndex: g.leafIndex,
				layerIndex: g.stackIndex,
				negative: slice.value < 0,
			})
			const { series, rank } = seriesByScope[layerScope]
			anchors.push({
				row,
				sourceRows: slice.rows,
				cx: aggregation.isVertical ? catPoint : measurePoint,
				cy: aggregation.isVertical ? measurePoint : catPoint,
				hAlign,
				vAlign,
				fieldPlacements: fieldPoints,
				key: `${stack.category}|${slice.key}`,
				series,
				rank,
				seriesByScope,
				label: formatted,
				// Raw (unformatted) value so conditional text-color / position
				// rules compare against the number, not its display string.
				labelValue,
				hueValue,
				sizeValue,
				opacityMul: sliceOpacity?.(slice.groupValues),
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
	/** Sub-band position inside the category band (0 = first leaf in legend
	 *  order). Every slice in an ungrouped bar reads 0. */
	leafIndex: number
	/** Layer order within the slice's leaf AND sign ledger (0 = the layer
	 *  touching the baseline). Overlay layers count in slice order. */
	stackIndex: number
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
	// Layer counters per (leaf, sign) ledger — the data-label "stack" scope
	// ranks slices by this, so "first" is always the layer on the baseline.
	const layerCount = new Map<string, number>()
	return stack.slices.map((slice) => {
		const k = leafKey(slice.groupValues, groupModeChannels)
		const negative = slice.value < 0
		const ledger = negative ? runningNegByLeaf : runningPosByLeaf
		const start = hasStack ? ledger.get(k) ?? 0 : 0
		const end = start + slice.value
		if (hasStack) ledger.set(k, end)
		const layerKey = `${k}\u001F${negative ? "-" : "+"}`
		const stackIndex = layerCount.get(layerKey) ?? 0
		layerCount.set(layerKey, stackIndex + 1)
		return {
			key: slice.key,
			catPos: leafPos.get(k) ?? bandPos,
			catSize: subBand,
			measureStart: start,
			measureEnd: end,
			leafIndex: leafOrder.indexOf(k),
			stackIndex,
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
