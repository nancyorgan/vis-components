import { useMemo, useState } from "react"
import { scaleBand } from "d3-scale"
import { useAtomValue } from "jotai"
import { buildPatternDefs, type FillInput } from "../../lib/buildPatternDefs"
import {
	DEFAULT_FILL,
	DEFAULT_TEXT_CONFIG,
	type TextConfig,
} from "../../lib/channelConfig"
import type { PerAxisScalesRendererProps } from "../../lib/chartRendererProps"
import { cartesian } from "./coords"
import { ptToPx } from "../../lib/fontUnit"
import { effectiveType } from "../../lib/fieldType"
import type { FieldType } from "../../lib/types"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import { combinedGroupValues } from "../../lib/combinedGroupValues"
import { markOutlineResolver } from "../../lib/markOutline"
import type { PatternDefSpec } from "../../lib/patternDefs"
import {
	layerFillProp,
	resolveLayerColor,
	type GroupValues,
} from "../../lib/resolveLayerColor"
import { parseNumericCell, type PositionScale } from "../../lib/scales"
import { applyLevelOrder } from "../../lib/smartSort"
import { aggregateCells, type CellAggregation } from "../../lib/tileCells"
import { uniqueFieldValues } from "../../lib/uniqueFieldValues"
import { formatSingleLabel } from "../../lib/dataLabelsStyle"
import { formatTextValue, resolveTextColor } from "../../lib/textEncoding"
import {
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	renderedLabelsAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderDataLabelsConfigAtom,
	renderDataLabelsEncodingsAtom,
} from "../../store/renderConfigs"
import { useAestheticScales } from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

import { DataLabelsLayer, type DataLabelAnchor } from "./DataLabelsLayer"
import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import { Plot, type CoordFactory, type PlotContext } from "./Plot"

type TilePlotProps = PerAxisScalesRendererProps

const collectCategories = (
	rows: Array<Record<string, unknown>>,
	field: string
): string[] => uniqueFieldValues(rows, field, { skipBlank: true })

const collectOrderedCategories = (
	rows: Array<Record<string, unknown>>,
	field: string,
	type: FieldType,
	pinnedOrder: readonly string[] | undefined
): string[] =>
	applyLevelOrder(collectCategories(rows, field), type, pinnedOrder)

/** Group the chart rows by heatmap cell (`x\u001Fy` key — in-memory only,
 *  never persisted). The cell fill rules and the data-label rules both test
 *  these rows. */
const groupRowsByCell = (
	rows: ReadonlyArray<Record<string, unknown>>,
	xField: string,
	yField: string
): Map<string, Record<string, unknown>[]> => {
	const byCell = new Map<string, Record<string, unknown>[]>()
	for (const row of rows) {
		const xRaw = row[xField]
		const yRaw = row[yField]
		if (xRaw == null || yRaw == null) continue
		const key = `${String(xRaw)}\u001F${String(yRaw)}`
		const list = byCell.get(key)
		if (list) list.push(row)
		else byCell.set(key, [row])
	}
	return byCell
}

export const TilePlot = (props: TilePlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const labels = useAtomValue(renderedLabelsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataLabels = useAtomValue(renderDataLabelsEncodingsAtom)
	const dataLabelsCfg = useAtomValue(renderDataLabelsConfigAtom)
	const dataLabelsDecimals = dataLabelsCfg?.decimals ?? null
	// The mapped value field's Label format spec — cell labels show that
	// field's per-cell aggregate, so its per-field format applies.
	const dataLabelsFormatSpec = dataLabels?.value?.field
		? (dataLabelsCfg?.fieldFormats?.[dataLabels.value.field] ?? null)
		: null
	// Tile labels are cell-keyed (every label sits at the center of its
	// (chart.x, chart.y) cell), so the x/y/hue/size encodings carry no new
	// information until the user picks a value field. Rendering the layer
	// before `value` is set surfaced as the unexpected "I picked x and
	// labels appeared with row counts in them" report. Gate on `value`.
	const anyDataLabelsMapped = Boolean(dataLabels?.value?.field)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
	const [hovered, setHovered] = useState<TooltipState | null>(null)

	const showX = props.showXAxis !== false
	const showY = props.showYAxis !== false

	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)
	// Per-axis rows-for-scales — the facet solver passes these when the user
	// has asked for asymmetric sharing (one axis shared, the other not).
	// Falls back to `scalesRowsOverride` when the per-axis prop isn't set,
	// then to the panel's own rows.
	const rowsForXScale =
		props.scalesRowsOverrideX ?? props.scalesRowsOverride ?? rowsForChart
	const rowsForYScale =
		props.scalesRowsOverrideY ?? props.scalesRowsOverride ?? rowsForChart

	const xField = encodings.x?.field ?? null
	const yField = encodings.y?.field ?? null
	const hueField = aestheticScales.hue?.field?.name ?? null
	const hueType = aestheticScales.hue?.field?.type ?? null
	const hueIsQuantitative = hueType === "quantitative"
	const textField = encodings.text?.field ?? null

	const aggregation = useMemo(() => {
		if (!xField || !yField) return null
		return aggregateCells(
			rowsForChart,
			xField,
			yField,
			hueField,
			hueIsQuantitative
		)
	}, [rowsForChart, xField, yField, hueField, hueIsQuantitative])
	// Each cell's dataset rows, for the cells' `{Variable}` fill rules (the
	// data-label anchors build the same map for their own rules).
	const rowsByCell = useMemo(
		() =>
			xField && yField
				? groupRowsByCell(rowsForChart, xField, yField)
				: new Map<string, Record<string, unknown>[]>(),
		[rowsForChart, xField, yField]
	)

	const xType =
		xField && dataset ? effectiveType(dataset, xField, overrides) : null
	const yType =
		yField && dataset ? effectiveType(dataset, yField, overrides) : null
	const xCategories = useMemo(
		() =>
			xField && xType
				? collectOrderedCategories(
						rowsForXScale,
						xField,
						xType,
						levelOrders[xField]
					)
				: [],
		[rowsForXScale, xField, xType, levelOrders]
	)
	const yCategories = useMemo(
		() =>
			yField && yType
				? collectOrderedCategories(
						rowsForYScale,
						yField,
						yType,
						levelOrders[yField]
					)
				: [],
		[rowsForYScale, yField, yType, levelOrders]
	)

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
		// Zero band padding — cells tile flush, and separation comes solely
		// from the outline stroke (the Shape panel's width; 0 = no visible
		// gaps at all). Same convention as the treemap mosaic.
		const xScale =
			xCategories.length > 0
				? (scaleBand<string>()
						.domain(xCategories)
						.range([inner.x0, inner.x1]) as unknown as PositionScale)
				: null
		const yScale =
			yCategories.length > 0
				? (scaleBand<string>()
						.domain(yCategories)
						.range([inner.y1, inner.y0]) as unknown as PositionScale)
				: null
		return cartesian({
			xScale,
			yScale,
			xAxisConfig: channelConfigs.x,
			xReplaceTicks: props.xTicksOverride,
			yReplaceTicks: props.yTicksOverride,
			yAxisConfig: channelConfigs.y,
			xLabel: labels.xAxisTitle ?? xField ?? "",
			yLabel: labels.yAxisTitle ?? yField ?? "",
			xFieldType: xType,
			yFieldType: yType,
			showXAxis: showX,
			showYAxis: showY,
			// PlotCanvas draws a shared x/y title at the canvas level and
			// passes `showXAxisTitle: false` / `showYAxisTitle: false` to
			// suppress the per-panel one. Forward the prop here so we
			// don't double-render the title in unified-SVG mode.
			showXAxisTitle: props.showXAxisTitle ?? true,
			showYAxisTitle: props.showYAxisTitle ?? true,
			tickFont,
			xAxisTitleFont,
			yAxisTitleFont,
			xAxisTitleAlignment: labels.titleAlignments?.xAxisTitle,
			yAxisTitleAlignment: labels.titleAlignments?.yAxisTitle,
			// Honor the labels-panel "Read y-axis title horizontally" toggle.
			// Without this, TilePlot's margin estimate (yTitleRotated:
			// !labels.yAxisTitleHorizontal) reserves horizontal space for an
			// upright title that never actually renders — the title falls
			// through to the rotated branch in Axes.tsx because the prop
			// defaults to false. (Bug report: "I get the space but the title
			// doesn't shift.")
			yAxisTitleHorizontal: labels.yAxisTitleHorizontal,
		})
	}

	const defaultFill = channelConfigs.defaultFill ?? DEFAULT_FILL
	const patternBgOverride = channelConfigs.pattern?.backgroundColor ?? null

	// A cell is a BODY like a bar or a slice, so it takes the same options
	// through the same pipeline (`resolveLayerColor`): Color, then
	// Saturation / Brightness, Pattern and Opacity. A bar is split by those
	// channels; a cell is not, so each channel takes the cell's combined
	// value — the mean of a numeric variable, the most common level of a
	// discrete one, as its Color always did (`combinedGroupValues`).
	const cellFills = useMemo(() => {
		const out = new Map<string, FillInput & { groupValues: GroupValues }>()
		for (const cell of aggregation ?? []) {
			const key = `${cell.xKey}\u001F${cell.yKey}`
			const rows = rowsByCell.get(key) ?? []
			out.set(key, {
				rows,
				groupValues: combinedGroupValues(
					rows,
					aestheticScales,
					hueField ? { hue: cell.hueValue as GroupValues["hue"] } : {}
				),
			})
		}
		return out
	}, [aggregation, rowsByCell, aestheticScales, hueField])
	// The configured default pattern applies to cells as it does to bars.
	const patternOptions = useMemo(() => ({ includeDefaultPattern: true }), [])
	// Every `<pattern>` the cells will reference, registered before they draw.
	const patternDefs = useMemo<PatternDefSpec[]>(
		() =>
			buildPatternDefs(
				[...cellFills.values()],
				aestheticScales,
				channelConfigs,
				defaultFill,
				patternBgOverride,
				patternOptions
			),
		[cellFills, aestheticScales, channelConfigs, defaultFill, patternBgOverride, patternOptions]
	)

	if (!dataset || !xField || !yField) return null

	/** Build per-cell label anchors for the Data Labels layer. Each anchor
	 * sits at the cell's geometric center (so labels are always visually
	 * inside their tile) and carries an aggregated label value derived from
	 * the user's mapped Data Labels.value field — falling back to the cell's
	 * existing `textValue` (the legacy hue-mean / count default). */
	const buildTileAnchors = ({
		cells,
		xBand,
		yBand,
		cellW,
		cellH,
		decimals,
		formatSpec,
		valueField,
		rows,
		xField,
		yField,
	}: {
		cells: readonly CellAggregation[]
		xBand: ReturnType<typeof scaleBand<string>>
		yBand: ReturnType<typeof scaleBand<string>>
		cellW: number
		cellH: number
		decimals: number | null
		/** The mapped value field's Label format spec (from
		 *  `DataLabelsConfig.fieldFormats`); wins over `decimals` when set. */
		formatSpec?: string | null
		valueField: string | null
		rows: ReadonlyArray<Record<string, unknown>>
		xField: string
		yField: string
	}): DataLabelAnchor[] => {
		// Each cell's dataset rows — what `{Variable}` label rules test.
		const rowsByCell = groupRowsByCell(rows, xField, yField)
		// When the user has mapped a Data Labels.value field, pre-aggregate it
		// per cell. Numeric → mean across rows in the cell; non-numeric → mode
		// (most frequent value).
		const valueByCell = new Map<string, number | string | null>()
		if (valueField) {
			for (const [key, cellRows] of rowsByCell) {
				const vals = cellRows.map((r) => r[valueField])
				// Blank cells are missing data, not zeros — drop them before
				// deciding numeric-vs-mode so they neither drag means toward 0
				// (`Number("") === 0`) nor win the mode as "". An all-blank
				// cell falls through to null and renders no label.
				const present = vals.filter(
					(v) => v != null && String(v).trim() !== ""
				)
				const numeric = present
					.map((v) => parseNumericCell(v))
					.filter((n): n is number => n !== null)
				if (numeric.length > 0 && numeric.length === present.length) {
					valueByCell.set(
						key,
						numeric.reduce((a, b) => a + b, 0) / numeric.length
					)
					continue
				}
				const strings = present.map(String)
				if (strings.length === 0) {
					valueByCell.set(key, null)
					continue
				}
				const counts = new Map<string, number>()
				let bestKey = strings[0] as string
				let bestCount = 0
				for (const s of strings) {
					const next = (counts.get(s) ?? 0) + 1
					counts.set(s, next)
					if (next > bestCount) {
						bestCount = next
						bestKey = s
					}
				}
				valueByCell.set(key, bestKey)
			}
		}

		const anchors: DataLabelAnchor[] = []
		for (const cell of cells) {
			const cx = xBand(cell.xKey)
			const cy = yBand(cell.yKey)
			if (cx === undefined || cy === undefined) continue
			const cellKey = `${cell.xKey}\u001F${cell.yKey}`
			const labelSource = valueField
				? (valueByCell.get(cellKey) ?? null)
				: cell.textValue
			const label = formatSingleLabel(labelSource, formatSpec, decimals)
			anchors.push({
				cx: cx + cellW / 2,
				cy: cy + cellH / 2,
				key: cellKey,
				label,
				hueValue: cell.hueValue,
				labelValue: labelSource,
				sourceRows: rowsByCell.get(cellKey),
			})
		}
		return anchors
	}

	const textCfg: TextConfig = { ...DEFAULT_TEXT_CONFIG, ...channelConfigs.text }
	// Cell borders follow the universal mark outline: its thickness (Size →
	// Cell outline, seeded from the theme; 0 hides), color, shading and
	// opacity through the resolver every mark's outline shares
	// (`lib/markOutline`).
	const outlineFor = markOutlineResolver(channelConfigs, aestheticScales)


	const tooltip = hovered ? <HoverTooltip state={hovered} /> : null

	const marksBody = (ctx: PlotContext) => {
		if (ctx.coord.kind !== "cartesian") return null
		const { xScale, yScale } = ctx.coord.scales
		if (!xScale || !yScale) return null
		const xBand = xScale as unknown as ReturnType<typeof scaleBand<string>>
		const yBand = yScale as unknown as ReturnType<typeof scaleBand<string>>
		const cellW = xBand.bandwidth()
		const cellH = yBand.bandwidth()

		return (
			<g onMouseLeave={() => setHovered(null)}>
				{(aggregation ?? []).map((cell) => {
					const cx = xBand(cell.xKey)
					const cy = yBand(cell.yKey)
					if (cx === undefined || cy === undefined) return null
					// Fill (Color, then its rules: an implicit rule tests the
					// cell's aggregated Color value, a `{Variable}` rule every row
					// the cell combines), saturation / brightness, pattern and
					// opacity — the shared body pipeline.
					const input = cellFills.get(`${cell.xKey}\u001F${cell.yKey}`)
					const rows = input?.rows ?? []
					const layer = resolveLayerColor({
						groupValues: input?.groupValues ?? {},
						defaultFill,
						patternBgOverride,
						aestheticScales,
						channelConfigs,
						patternOptions,
						rows,
					})
					const outline = outlineFor(rows[0] ?? {}, { color: layer.outline })
					const onEnter = (e: React.MouseEvent) => {
						const fields: TooltipState["fields"] = [
							{ name: xField, value: cell.xKey },
							{ name: yField, value: cell.yKey },
						]
						if (hueField) {
							fields.push({ name: hueField, value: cell.hueValue })
						}
						fields.push({ name: "count", value: cell.count })
						setHovered({
							clientX: e.clientX,
							clientY: e.clientY,
							fields,
						})
					}
					return (
						<rect
							key={`${cell.xKey}|${cell.yKey}`}
							x={cx}
							y={cy}
							width={cellW}
							height={cellH}
							fill={layerFillProp(layer)}
							// Full opacity sets no attribute, as before.
							fillOpacity={layer.opacity === 1 ? undefined : layer.opacity}
							stroke={outline.strokeWidth > 0 ? outline.stroke : "none"}
							strokeOpacity={
								outline.strokeWidth > 0 && outline.strokeOpacity !== 1
									? outline.strokeOpacity
									: undefined
							}
							strokeWidth={outline.strokeWidth}
							onMouseEnter={onEnter}
						/>
					)
				})}
				{textField &&
					(aggregation ?? []).map((cell) => {
						const cx = xBand(cell.xKey)
						const cy = yBand(cell.yKey)
						if (cx === undefined || cy === undefined) return null
						const formatted = formatTextValue(
							cell.textValue,
							textCfg.decimals
						)
						if (formatted === null) return null
						const color = resolveTextColor(cell.textValue, textCfg)
						return (
							<text
								key={`txt-${cell.xKey}|${cell.yKey}`}
								x={cx + cellW / 2}
								y={cy + cellH / 2}
								fill={color}
								fontFamily={textCfg.fontFamily}
								fontSize={ptToPx(textCfg.fontSize)}
								fontWeight={textCfg.fontWeight}
								textAnchor="middle"
								dominantBaseline="middle"
								pointerEvents="none"
							>
								{formatted}
							</text>
						)
					})}
				{anyDataLabelsMapped && (
					<DataLabelsLayer
						rows={rowsForChart}
						xScale={xScale}
						yScale={yScale}
						xType="categorical"
						yType="categorical"
						anchors={buildTileAnchors({
							cells: aggregation ?? [],
							xBand,
							yBand,
							cellW,
							cellH,
							decimals: dataLabelsDecimals,
							formatSpec: dataLabelsFormatSpec,
							valueField: dataLabels?.value?.field ?? null,
							rows: rowsForChart,
							xField: xField as string,
							yField: yField as string,
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
