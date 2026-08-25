import { useMemo, useState } from "react"
import { scaleBand } from "d3-scale"
import { useAtomValue } from "jotai"
import {
	DEFAULT_FILL,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	type TextConfig,
} from "../../lib/channelConfig"
import type { PerAxisScalesRendererProps } from "../../lib/chartRendererProps"
import { cartesian } from "./coords"
import { ptToPx } from "../../lib/fontUnit"
import { effectiveType } from "../../lib/fieldType"
import type { FieldType } from "../../lib/types"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import {
	applyHueScale,
	parseNumericCell,
	type PositionScale,
} from "../../lib/scales"
import { applyLevelOrder } from "../../lib/smartSort"
import { formatSingleLabel } from "../../lib/dataLabelsStyle"
import { formatTextValue, resolveTextColor } from "../../lib/textEncoding"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
} from "../../store/atoms"
import { useAestheticScales } from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

import { DataLabelsLayer, type DataLabelAnchor } from "./DataLabelsLayer"
import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import { Plot, type CoordFactory, type PlotContext } from "./Plot"

type TilePlotProps = PerAxisScalesRendererProps

type CellAggregation = {
	xKey: string
	yKey: string
	count: number
	/** Most-recent representative value for the hue field (mean for
	 * quantitative, mode for categorical). `null` when hue is unmapped. */
	hueValue: unknown
	/** Numeric value used for text labels. Defaults to the cell row count when
	 * no other quantity makes sense. */
	textValue: number | string
}

const collectCategories = (
	rows: Array<Record<string, unknown>>,
	field: string
): string[] => [
	...new Set(
		rows
			.map((r) => r[field])
			.filter((v) => v !== undefined && v !== null && String(v) !== "")
			.map(String)
	),
]

const collectOrderedCategories = (
	rows: Array<Record<string, unknown>>,
	field: string,
	type: FieldType,
	pinnedOrder: readonly string[] | undefined
): string[] =>
	applyLevelOrder(collectCategories(rows, field), type, pinnedOrder)

/** Mode (most frequent value) for a list of strings, falling back to the
 * first entry when there's no clear winner. */
const modeValue = (values: string[]): string | null => {
	if (values.length === 0) return null
	const counts = new Map<string, number>()
	let bestKey = values[0] as string
	let bestCount = 0
	for (const v of values) {
		const next = (counts.get(v) ?? 0) + 1
		counts.set(v, next)
		if (next > bestCount) {
			bestCount = next
			bestKey = v
		}
	}
	return bestKey
}

const aggregateCells = (
	rows: Array<Record<string, unknown>>,
	xField: string,
	yField: string,
	hueField: string | null,
	hueIsQuantitative: boolean
): CellAggregation[] => {
	const buckets = new Map<string, Array<Record<string, unknown>>>()
	for (const row of rows) {
		const xRaw = row[xField]
		const yRaw = row[yField]
		if (
			xRaw === undefined ||
			xRaw === null ||
			yRaw === undefined ||
			yRaw === null ||
			String(xRaw) === "" ||
			String(yRaw) === ""
		) {
			continue
		}
		const key = `${String(xRaw)}\u001F${String(yRaw)}`
		const list = buckets.get(key) ?? []
		list.push(row)
		buckets.set(key, list)
	}

	const cells: CellAggregation[] = []
	for (const [key, bucket] of buckets) {
		const sep = key.indexOf("\u001F")
		const xKey = key.slice(0, sep)
		const yKey = key.slice(sep + 1)

		let hueValue: unknown = null
		if (hueField) {
			if (hueIsQuantitative) {
				let sum = 0
				let n = 0
				for (const r of bucket) {
					// parseNumericCell, not Number: blanks are missing data and
					// must not enter the mean as 0 (`Number("") === 0`).
					const v = parseNumericCell(r[hueField])
					if (v !== null) {
						sum += v
						n += 1
					}
				}
				hueValue = n > 0 ? sum / n : null
			} else {
				hueValue = modeValue(
					bucket
						.map((r) => r[hueField])
						.filter((v) => v !== undefined && v !== null)
						.map(String)
				)
			}
		}

		// Text value default: prefer the aggregated hue value when present,
		// otherwise fall back to the row count (classic "n per cell" heatmap).
		const textValue =
			typeof hueValue === "number" && Number.isFinite(hueValue)
				? hueValue
				: typeof hueValue === "string"
					? hueValue
					: bucket.length

		cells.push({ xKey, yKey, count: bucket.length, hueValue, textValue })
	}
	return cells
}

export const TilePlot = (props: TilePlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataLabels = useAtomValue(currentDataLabelsEncodingsAtom)
	const dataLabelsCfg = useAtomValue(currentDataLabelsConfigAtom)
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
	const hueScale = aestheticScales.hue?.scale ?? null

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
		// When the user has mapped a Data Labels.value field, pre-aggregate it
		// per cell. Numeric → mean across rows in the cell; non-numeric → mode
		// (most frequent value).
		const valueByCell = new Map<string, number | string | null>()
		if (valueField) {
			const grouped = new Map<string, unknown[]>()
			for (const row of rows) {
				const xRaw = row[xField]
				const yRaw = row[yField]
				if (xRaw == null || yRaw == null) continue
				const key = `${String(xRaw)}\u001F${String(yRaw)}`
				const list = grouped.get(key) ?? []
				list.push(row[valueField])
				grouped.set(key, list)
			}
			for (const [key, vals] of grouped) {
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
			})
		}
		return anchors
	}

	const textCfg: TextConfig = { ...DEFAULT_TEXT_CONFIG, ...channelConfigs.text }
	const defaultFill = channelConfigs.defaultFill ?? DEFAULT_FILL
	// Cell borders follow the universal mark outline (the Shape panel's
	// color/width, seeded from the theme; width 0 hides) — same chain
	// HexbinPlot and BarPlot use.
	const outlineColor =
		channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor
	const outlineWidth =
		channelConfigs.shape?.outlineWidth ?? DEFAULT_SHAPE_CONFIG.outlineWidth

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
					let fill = defaultFill
					if (hueScale && hueField && cell.hueValue !== null) {
						const c = applyHueScale(
							hueScale,
							cell.hueValue,
							hueType ?? "categorical"
						)
						if (c) fill = c
					}
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
							fill={fill}
							stroke={outlineWidth > 0 ? outlineColor : "none"}
							strokeWidth={outlineWidth}
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
		<Plot inner={props.inner} coord={coord} tooltip={tooltip}>
			{marksBody}
		</Plot>
	)
}
