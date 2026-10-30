// ---------------------------------------------------------------------------
// Plotted data — the values the marks encode (pure)
// ---------------------------------------------------------------------------
//
// The data table under the chart (`dataTable.ts`, APPLICATION.md §10b) lists
// what the chart SHOWS. For most chart types that is one row per data row —
// a dot, a line vertex, a map region. The aggregating types draw one mark
// per GROUP of rows instead (a bar is a sum, a histogram bar a count, a box
// five statistics), so for them the table lists the aggregated marks.
//
// Every aggregation here runs through the SAME code the renderer runs —
// `aggregateStacks` (bars, areas, pies), `histogramBinningForAxis` +
// `toDensityStacks` (histograms), `aggregateCells` (heatmap tiles),
// `resolveHexbinCells` (hexbins), `aggregateDistributions` (box / violin),
// `buildHierarchyFromEdges` + `hierarchyNodeRows` (trees), `buildFlowGraph`
// + `breakCycles` (flows) — so the table can't disagree with the picture.
// What this module adds is only the shaping: which columns, in what order,
// split per facet panel.
//
// Facets: each panel aggregates its own rows (as each panel renderer does);
// bins and hex lattices take their edges from ALL rows, matching the default
// shared category / position axes.

import { aggregateDistributions } from "./aggregators/distributions"
import {
	aggregateStacks,
	resolveAreaMeasureField,
	toDensityStacks,
	type GroupChannel,
	type GroupEncoding,
	type Stack,
} from "./aggregators/stacks"
import {
	breakCycles,
	buildFlowGraph,
	resolveFlowEndpoints,
} from "./buildFlowGraph"
import {
	buildHierarchyFromEdges,
	hierarchyNodeRows,
	resolveHierarchyIdField,
} from "./buildHierarchy"
import type { ChannelConfigs, DistributionOverlayConfig } from "./channelConfig"
import type { EncodingChannel } from "./channelNames"
import { isAreaModeId, isBarModeId, isFlowModeId, isHierarchyModeId, isPieModeId } from "./chartModes/families"
import { DEFAULT_HEXBIN_BIN_COUNT, resolveHexbinCells } from "./hexbins"
import { histogramBinningForAxis } from "./histogramBins"
import { applyLevelOrder } from "./smartSort"
import { aggregateCells } from "./tileCells"
import type { DatasetView, Encodings, FieldType } from "./types"

type Row = Record<string, unknown>

export type PlottedColumn = {
	/** Header text. */
	name: string
	type: FieldType
	/** The variable whose inherited format the cells print with — the field
	 * itself for a group column, the MEASURE for an aggregate of it. Null =
	 * no variable behind the column (Bin, Count, Share, Level). */
	formatField: string | null
	/** A fixed format used when the variable has none (Count → integer,
	 * Share → percent). */
	format?: string
}

export type PlottedCell = string | number | null

export type PlottedData =
	| {
			aggregated: false
			/** Shown under the table when the chart draws a curve COMPUTED
			 * from the rows (density curve, regression line) — the rows are
			 * the honest table, the curve is not a list of values. */
			note: string | null
	  }
	| {
			aggregated: true
			columns: PlottedColumn[]
			/** One cell per column, in column order. */
			rows: PlottedCell[][]
			/** One line for under the table: what each row aggregates. */
			note: string
	  }

export type PlottedDataInput = {
	view: Pick<DatasetView, "rows" | "fields">
	encodings: Encodings
	/** The detected chart mode id — from `useChartModeDef()`, never bare
	 * `getChartModeDef(encodings)` (which misdetects histograms). */
	mode: string
	channelConfigs: ChannelConfigs
	getType: (field: string) => FieldType
	levelOrders: Readonly<Record<string, readonly string[]>>
}

// ── Shared helpers ─────────────────────────────────────────────────────────

const FACET_CHANNELS = ["facetRow", "facetCol", "facet"] as const

/** Group channels the bar renderer stacks / groups by, in its order. */
const BAR_GROUP_CHANNELS: readonly GroupChannel[] = [
	"hue",
	"outlineHue",
	"saturation",
	"brightness",
	"pattern",
	"opacity",
]
/** Pies and areas don't split by outline color. */
const LAYER_GROUP_CHANNELS: readonly GroupChannel[] = [
	"hue",
	"saturation",
	"brightness",
	"pattern",
	"opacity",
]

const fieldOf = (enc: Encodings, ch: EncodingChannel): string | null =>
	enc[ch]?.field ?? null

const groupsFor = (
	input: PlottedDataInput,
	channels: readonly GroupChannel[]
): GroupEncoding[] => {
	const out: GroupEncoding[] = []
	for (const channel of channels) {
		const field = fieldOf(input.encodings, channel)
		if (field) out.push({ channel, field, type: input.getType(field) })
	}
	return out
}

const groupOrdersFor = (
	groups: readonly GroupEncoding[],
	levelOrders: PlottedDataInput["levelOrders"]
): Partial<Record<GroupChannel, readonly string[]>> => {
	const out: Partial<Record<GroupChannel, readonly string[]>> = {}
	for (const g of groups) {
		const order = levelOrders[g.field]
		if (order) out[g.channel] = order
	}
	return out
}

/** Sums of decimals drift ("0.30000000000000004"); 12 significant digits
 * keep every real digit and drop the float noise. */
const clean = (n: number): number => (Number.isFinite(n) ? Number(n.toPrecision(12)) : n)

/** A rounder to the decimals that resolve steps of `step` (plus one). */
const roundTo = (step: number): ((n: number) => number) => {
	const decimals =
		step > 0 && Number.isFinite(step) ? Math.min(10, Math.max(0, Math.ceil(-Math.log10(step)) + 1)) : 6
	return (n) => clean(Number(n.toFixed(decimals)))
}

const cellText = (v: unknown): string =>
	v === undefined || v === null ? "" : String(v)

type Panel = { values: string[]; rows: Row[] }

/** Facet fields (distinct, mapped) and the rows split per panel, panels in
 * the facet fields' level order. No facets → one panel of every row. */
const splitPanels = (
	input: PlottedDataInput
): { fields: string[]; panels: Panel[] } => {
	const fields: string[] = []
	for (const ch of FACET_CHANNELS) {
		const f = fieldOf(input.encodings, ch)
		if (f && !fields.includes(f)) fields.push(f)
	}
	const rows = input.view.rows as Row[]
	if (fields.length === 0) return { fields, panels: [{ values: [], rows }] }
	const byKey = new Map<string, Panel>()
	for (const row of rows) {
		const values = fields.map((f) => cellText(row[f]))
		const key = values.join("\u001F")
		const panel = byKey.get(key)
		if (panel) panel.rows.push(row)
		else byKey.set(key, { values, rows: [row] })
	}
	const ranks = fields.map((f, i) => {
		const seen = [...new Set([...byKey.values()].map((p) => p.values[i] ?? ""))]
		const order = applyLevelOrder(seen, input.getType(f), input.levelOrders[f])
		return new Map(order.map((v, k) => [v, k]))
	})
	const panels = [...byKey.values()].sort((a, b) => {
		for (let i = 0; i < fields.length; i++) {
			const d =
				(ranks[i]?.get(a.values[i] ?? "") ?? 0) -
				(ranks[i]?.get(b.values[i] ?? "") ?? 0)
			if (d !== 0) return d
		}
		return 0
	})
	return { fields, panels }
}

/** Run a per-panel builder and append the facet columns (facets last, as
 * in the row table). A facet field already among the columns isn't
 * repeated. */
const perPanel = (
	input: PlottedDataInput,
	columns: PlottedColumn[],
	build: (rows: Row[]) => PlottedCell[][]
): { columns: PlottedColumn[]; rows: PlottedCell[][] } => {
	const { fields, panels } = splitPanels(input)
	const extra = fields.filter((f) => !columns.some((c) => c.formatField === f && c.name === f))
	const outCols = [
		...columns,
		...extra.map((f) => ({ name: f, type: input.getType(f), formatField: f })),
	]
	const rows: PlottedCell[][] = []
	for (const panel of panels) {
		const facetCells = extra.map((f) => panel.values[fields.indexOf(f)] ?? "")
		for (const r of build(panel.rows)) rows.push([...r, ...facetCells])
	}
	return { columns: outCols, rows }
}

const fieldColumn = (input: PlottedDataInput, field: string): PlottedColumn => ({
	name: field,
	type: input.getType(field),
	formatField: field,
})

const measureColumn = (field: string, aggregate: "sum" | "mean"): PlottedColumn => ({
	name: `${field} (${aggregate})`,
	type: "quantitative",
	formatField: field,
})

const COUNT_COLUMN: PlottedColumn = {
	name: "Count",
	type: "quantitative",
	formatField: null,
	format: ",d",
}

const SHARE_COLUMN: PlottedColumn = {
	name: "Share",
	type: "quantitative",
	formatField: null,
	format: ".1%",
}

const rowsNote = (input: PlottedDataInput): string => {
	const n = input.view.rows.length
	return `the underlying data has ${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`
}

/** Distinct group fields (a field on two channels is one column), minus
 * any already listed. */
const groupFieldColumns = (
	input: PlottedDataInput,
	groups: readonly GroupEncoding[],
	exclude: readonly string[]
): { fields: string[]; columns: PlottedColumn[] } => {
	const fields: string[] = []
	for (const g of groups)
		if (!exclude.includes(g.field) && !fields.includes(g.field)) fields.push(g.field)
	return { fields, columns: fields.map((f) => fieldColumn(input, f)) }
}

/** The group field's value for a slice (via whichever channel carries it). */
const sliceGroupValue = (
	groups: readonly GroupEncoding[],
	groupValues: Partial<Record<GroupChannel, string>>,
	field: string
): string => {
	const g = groups.find((x) => x.field === field)
	return g ? (groupValues[g.channel] ?? "") : ""
}

// ── Bars, histograms, areas, pies (stacked aggregation) ───────────────────

const stackRows = (
	stacks: readonly Stack[],
	groups: readonly GroupEncoding[],
	groupFields: readonly string[],
	opts: { withCategory: boolean; share?: boolean; categoryAs?: (c: string) => string }
): PlottedCell[][] => {
	const out: PlottedCell[][] = []
	for (const stack of stacks) {
		const total = stack.slices.reduce((a, s) => a + s.value, 0)
		for (const slice of stack.slices) {
			const row: PlottedCell[] = []
			if (opts.withCategory) row.push(opts.categoryAs ? opts.categoryAs(stack.category) : stack.category)
			for (const f of groupFields) row.push(sliceGroupValue(groups, slice.groupValues, f))
			row.push(clean(slice.value))
			if (opts.share) row.push(total !== 0 ? clean(slice.value / total) : null)
			out.push(row)
		}
	}
	return out
}

const barsData = (input: PlottedDataInput): PlottedData => {
	const { encodings, channelConfigs, getType, levelOrders, mode } = input
	// Vertical bars (bars-x and its combo twin) categorize along x.
	const categoryChannel =
		mode === "bars-x" || mode === "combo-x" ? "x" : "y"
	const categoryField = fieldOf(encodings, categoryChannel)
	if (!categoryField) return { aggregated: false, note: null }
	const categoryType = getType(categoryField)
	const axisCfg = channelConfigs[categoryChannel]
	const isHistogram = axisCfg?.histogram?.enabled === true && categoryType === "quantitative"
	const lengthField = fieldOf(encodings, "length") ?? ""
	if (!isHistogram && !lengthField) return { aggregated: false, note: null }
	const lengthType: FieldType = lengthField ? getType(lengthField) : "categorical"
	const groups = groupsFor(input, BAR_GROUP_CHANNELS)
	const groupOrders = groupOrdersFor(groups, levelOrders)

	if (isHistogram) {
		// Bin edges from ALL rows — the default shared category axis.
		const binning = histogramBinningForAxis(
			input.view.rows.map((r) => (r as Row)[categoryField]),
			axisCfg
		)
		if (!binning) return { aggregated: false, note: null }
		const isDensity = axisCfg?.histogram?.mode === "density"
		const { fields: gFields, columns: gCols } = groupFieldColumns(input, groups, [categoryField])
		const binCol: PlottedColumn = {
			name: `${categoryField} (bin)`,
			type: "ordinal",
			formatField: null,
		}
		const { columns, rows } = perPanel(
			input,
			[binCol, ...gCols, isDensity ? SHARE_COLUMN : COUNT_COLUMN],
			(panelRows) => {
				const binned: Row[] = []
				for (const row of panelRows) {
					const label = binning.labelForValue(row[categoryField])
					if (label !== null) binned.push({ ...row, [categoryField]: label })
				}
				const result = aggregateStacks({
					rows: binned,
					categoryField,
					lengthField,
					categoryType: "ordinal",
					lengthType,
					groups,
					categoryOrder: binning.order,
					groupOrders,
					countRows: true,
				})
				if ("error" in result) return []
				const stacks = isDensity ? toDensityStacks(result.stacks) : result.stacks
				// Ungrouped: every bin is a row, empty ones too (the axis
				// draws them, and a gap is part of the distribution).
				if (groups.length === 0) {
					const byBin = new Map(stacks.map((s) => [s.category, s]))
					return binning.order.map((label) => [
						label,
						clean(byBin.get(label)?.slices.reduce((a, s) => a + s.value, 0) ?? 0),
					])
				}
				return stackRows(stacks, groups, gFields, { withCategory: true })
			}
		)
		return {
			aggregated: true,
			columns,
			rows,
			note: `${isDensity ? "Shares of rows" : "Row counts"} per bin; ${rowsNote(input)}.`,
		}
	}

	const quantLength = lengthType === "quantitative"
	const { fields: gFields, columns: gCols } = groupFieldColumns(input, groups, [categoryField])
	// A categorical length counts rows; it's then one of the group fields.
	const valueCol = quantLength ? measureColumn(lengthField, "sum") : COUNT_COLUMN
	const { columns, rows } = perPanel(
		input,
		[fieldColumn(input, categoryField), ...gCols, valueCol],
		(panelRows) => {
			const result = aggregateStacks({
				rows: panelRows,
				categoryField,
				lengthField,
				categoryType,
				lengthType,
				groups,
				categoryOrder: levelOrders[categoryField],
				groupOrders,
			})
			if ("error" in result) return []
			return stackRows(result.stacks, groups, gFields, { withCategory: true })
		}
	)
	const per = groups.length > 0 ? "bar segment" : "bar"
	return {
		aggregated: true,
		columns,
		rows,
		note: `${quantLength ? "Values are sums" : "Values are row counts"} per ${per}; ${rowsNote(input)}.`,
	}
}

const areasData = (input: PlottedDataInput): PlottedData => {
	const { encodings, getType, levelOrders } = input
	const mode = input.mode as "areas-x" | "areas-y"
	const categoryField = fieldOf(encodings, mode === "areas-x" ? "x" : "y")
	const measureField = resolveAreaMeasureField(mode, encodings)
	if (!categoryField || !measureField) return { aggregated: false, note: null }
	const categoryType = getType(categoryField)
	const measureType = getType(measureField)
	const groups = groupsFor(input, LAYER_GROUP_CHANNELS)
	const groupOrders = groupOrdersFor(groups, levelOrders)
	const { fields: gFields, columns: gCols } = groupFieldColumns(input, groups, [categoryField])
	const quant = measureType === "quantitative"
	const { columns, rows } = perPanel(
		input,
		[fieldColumn(input, categoryField), ...gCols, quant ? measureColumn(measureField, "sum") : COUNT_COLUMN],
		(panelRows) => {
			const result = aggregateStacks({
				rows: panelRows,
				categoryField,
				lengthField: measureField,
				categoryType,
				lengthType: measureType,
				groups,
				categoryOrder: levelOrders[categoryField],
				groupOrders,
			})
			if ("error" in result) return []
			return stackRows(result.stacks, groups, gFields, { withCategory: true })
		}
	)
	return {
		aggregated: true,
		columns,
		rows,
		note: `${quant ? "Values are sums" : "Values are row counts"} per point of each layer; ${rowsNote(input)}.`,
	}
}

/** The single-pie mode pools every row into one pie (the renderer's
 * synthetic category does the same). */
const SINGLE_PIE = "\u0000pie"

const piesData = (input: PlottedDataInput): PlottedData => {
	const { encodings, getType, levelOrders, mode } = input
	const measureField = fieldOf(encodings, "angle")
	if (!measureField) return { aggregated: false, note: null }
	const single = mode === "pies"
	const categoryField = single ? SINGLE_PIE : fieldOf(encodings, mode === "pies-x" ? "x" : "y")
	if (!categoryField) return { aggregated: false, note: null }
	const categoryType: FieldType = single ? "categorical" : getType(categoryField)
	const measureType = getType(measureField)
	const groups = groupsFor(input, LAYER_GROUP_CHANNELS)
	const groupOrders = groupOrdersFor(groups, levelOrders)
	const { fields: gFields, columns: gCols } = groupFieldColumns(input, groups, single ? [] : [categoryField])
	const quant = measureType === "quantitative"
	const { columns, rows } = perPanel(
		input,
		[
			...(single ? [] : [fieldColumn(input, categoryField)]),
			...gCols,
			quant ? measureColumn(measureField, "sum") : COUNT_COLUMN,
			SHARE_COLUMN,
		],
		(panelRows) => {
			const rowsIn = single ? panelRows.map((r) => ({ ...r, [SINGLE_PIE]: SINGLE_PIE })) : panelRows
			const result = aggregateStacks({
				rows: rowsIn,
				categoryField,
				lengthField: measureField,
				categoryType,
				lengthType: measureType,
				groups,
				categoryOrder: single ? undefined : levelOrders[categoryField],
				groupOrders,
			})
			if ("error" in result) return []
			return stackRows(result.stacks, groups, gFields, { withCategory: !single, share: true })
		}
	)
	return {
		aggregated: true,
		columns,
		rows,
		note: `${quant ? "Values are sums" : "Values are row counts"} per wedge, with each wedge's share of its pie; ${rowsNote(input)}.`,
	}
}

// ── Heatmap tiles ─────────────────────────────────────────────────────────

const tileData = (input: PlottedDataInput): PlottedData => {
	const { encodings, getType, levelOrders } = input
	const xField = fieldOf(encodings, "x")
	const yField = fieldOf(encodings, "y")
	if (!xField || !yField) return { aggregated: false, note: null }
	const hueField = fieldOf(encodings, "hue")
	const hueQuant = hueField ? getType(hueField) === "quantitative" : false
	const hueCol: PlottedColumn | null = hueField
		? hueQuant
			? measureColumn(hueField, "mean")
			: { name: `${hueField} (most common)`, type: getType(hueField), formatField: hueField }
		: null
	const order = (field: string, values: string[]) => {
		const ordered = applyLevelOrder([...new Set(values)], getType(field), levelOrders[field])
		return new Map(ordered.map((v, i) => [v, i]))
	}
	const { columns, rows } = perPanel(
		input,
		[
			fieldColumn(input, xField),
			fieldColumn(input, yField),
			COUNT_COLUMN,
			...(hueCol ? [hueCol] : []),
		],
		(panelRows) => {
			const cells = aggregateCells(panelRows, xField, yField, hueField, hueQuant)
			const xr = order(xField, cells.map((c) => c.xKey))
			const yr = order(yField, cells.map((c) => c.yKey))
			return [...cells]
				.sort(
					(a, b) =>
						(xr.get(a.xKey) ?? 0) - (xr.get(b.xKey) ?? 0) ||
						(yr.get(a.yKey) ?? 0) - (yr.get(b.yKey) ?? 0)
				)
				.map((c) => {
					const hue =
						typeof c.hueValue === "number" ? clean(c.hueValue) : c.hueValue == null ? null : String(c.hueValue)
					return [c.xKey, c.yKey, c.count, ...(hueCol ? [hue] : [])]
				})
		}
	)
	return {
		aggregated: true,
		columns,
		rows,
		note: `One row per tile${hueCol ? (hueQuant ? `, with the mean of ${hueField}` : `, with the most common ${hueField}`) : ""}; ${rowsNote(input)}.`,
	}
}

// ── Hexbins ───────────────────────────────────────────────────────────────

const hexbinData = (input: PlottedDataInput): PlottedData => {
	const { encodings, channelConfigs } = input
	const xField = fieldOf(encodings, "x")
	const yField = fieldOf(encodings, "y")
	if (!xField || !yField) return { aggregated: false, note: null }
	const all = input.view.rows as Row[]
	const binCount = channelConfigs.hexbin?.binCount ?? DEFAULT_HEXBIN_BIN_COUNT
	const bound = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)
	const xBounds = { min: bound(channelConfigs.x?.min), max: bound(channelConfigs.x?.max) }
	const yBounds = { min: bound(channelConfigs.y?.min), max: bound(channelConfigs.y?.max) }
	const { columns, rows } = perPanel(
		input,
		[
			{ name: `${xField} (hexagon center)`, type: "quantitative", formatField: xField },
			{ name: `${yField} (hexagon center)`, type: "quantitative", formatField: yField },
			COUNT_COLUMN,
		],
		(panelRows) => {
			const hex = resolveHexbinCells(
				panelRows.map((r) => r[xField]),
				panelRows.map((r) => r[yField]),
				binCount,
				xBounds,
				yBounds,
				{ domainXRaw: all.map((r) => r[xField]), domainYRaw: all.map((r) => r[yField]) }
			)
			if (!hex) return []
			const [x0, x1] = hex.xDomain
			const [y0, y1] = hex.yDomain
			const sx = x1 - x0 || 1
			const sy = y1 - y0 || 1
			// Round centers to the lattice's own resolution (half a hexagon
			// step, plus one digit) — enough to tell neighbors apart without
			// printing "0.421052631579".
			const dx = roundTo(hex.radius * (Math.sqrt(3) / 2) * sx)
			const dy = roundTo(hex.radius * 0.75 * sy)
			return hex.cells
				.map((c) => [dx(x0 + c.cx * sx), dy(y0 + c.cy * sy), c.count] as [number, number, number])
				.sort((a, b) => a[0] - b[0] || a[1] - b[1])
		}
	)
	return {
		aggregated: true,
		columns,
		rows,
		note: `Point counts per hexagon, located by the hexagon's center; ${rowsNote(input)}.`,
	}
}

// ── Box / violin (scatter distribution overlays) ──────────────────────────

const overlayOf = (cfg: DistributionOverlayConfig | undefined) => ({
	box: !!cfg && (cfg.showBoxPlot || cfg.showDensityViolin),
	curve: !!cfg && cfg.showDensityCurve === true,
})

const isCategoryLike = (t: FieldType) => t === "categorical" || t === "ordinal"

const distributionData = (input: PlottedDataInput): PlottedData | null => {
	const { encodings, channelConfigs, getType, levelOrders } = input
	const xField = fieldOf(encodings, "x")
	const yField = fieldOf(encodings, "y")
	let categoryField = ""
	let valueField: string | null = null
	let overlay: ReturnType<typeof overlayOf> | null = null
	if (xField && yField) {
		const xt = getType(xField)
		const yt = getType(yField)
		if (isCategoryLike(xt) && yt === "quantitative") {
			categoryField = xField
			valueField = yField
			overlay = overlayOf(channelConfigs.y?.distributionOverlay)
		} else if (isCategoryLike(yt) && xt === "quantitative") {
			categoryField = yField
			valueField = xField
			overlay = overlayOf(channelConfigs.x?.distributionOverlay)
		}
	} else if (xField && !yField && getType(xField) === "quantitative") {
		valueField = xField
		overlay = overlayOf(channelConfigs.x?.distributionOverlay)
	} else if (yField && !xField && getType(yField) === "quantitative") {
		valueField = yField
		overlay = overlayOf(channelConfigs.y?.distributionOverlay)
	}
	if (!valueField || !overlay) return null
	if (!overlay.box) {
		return overlay.curve && !categoryField
			? { aggregated: false, note: "The density curve is computed from these rows." }
			: null
	}
	const vf = valueField
	const stat = (name: string): PlottedColumn => ({ name, type: "quantitative", formatField: vf })
	const { columns, rows } = perPanel(
		input,
		[
			...(categoryField ? [fieldColumn(input, categoryField)] : []),
			stat("Min"),
			stat("Lower whisker"),
			stat("Q1"),
			stat("Median"),
			stat("Q3"),
			stat("Upper whisker"),
			stat("Max"),
			{ name: "N", type: "quantitative", formatField: null, format: ",d" },
		],
		(panelRows) => {
			const agg = aggregateDistributions({
				rows: panelRows,
				categoryField,
				valueField: vf,
				categoryType: "categorical",
				valueType: "quantitative",
			})
			if ("error" in agg) return []
			const ordered = categoryField
				? applyLevelOrder(agg.categories, getType(categoryField), levelOrders[categoryField])
				: agg.categories
			const byCat = new Map(agg.stats.map((s) => [s.category, s]))
			return ordered.flatMap((cat) => {
				const s = byCat.get(cat)
				if (!s) return []
				const b = s.box
				return [
					[
						...(categoryField ? [cat] : []),
						clean(b.min),
						clean(b.lowerWhisker),
						clean(b.q1),
						clean(b.median),
						clean(b.q3),
						clean(b.upperWhisker),
						clean(b.max),
						s.values.length,
					],
				]
			})
		}
	)
	return {
		aggregated: true,
		columns,
		rows,
		note: `Distribution of ${vf}${categoryField ? ` per ${categoryField}` : ""}: whiskers reach the furthest value within 1.5 × the interquartile range; ${rowsNote(input)}.`,
	}
}

// ── Trees ─────────────────────────────────────────────────────────────────

/** The renderer's "no parent" stand-in (an absent column: every row a
 * top-level leaf). */
const NO_PARENT = "no-parent"

const hierarchyData = (input: PlottedDataInput): PlottedData => {
	const { encodings, channelConfigs, view } = input
	const parentField = fieldOf(encodings, "connection")
	const valueField = fieldOf(encodings, "area")
	const idField = parentField
		? resolveHierarchyIdField(
				channelConfigs.connection?.hierarchyIdField ?? null,
				view.rows,
				view.fields.map((f) => f.name),
				parentField,
				valueField
			)
		: null
	const built = (rows: Row[]) =>
		hierarchyNodeRows(
			buildHierarchyFromEdges(rows, {
				parentField: parentField ?? NO_PARENT,
				idField,
				valueField,
			}).root
		)
	const maxDepth = built(view.rows as Row[]).reduce((m, n) => Math.max(m, n.depth), 1)
	const levelCols: PlottedColumn[] = Array.from({ length: maxDepth }, (_, i) => ({
		name: `Level ${i + 1}`,
		type: "categorical",
		formatField: null,
	}))
	const valueCol: PlottedColumn = valueField
		? measureColumn(valueField, "sum")
		: { name: "Leaves", type: "quantitative", formatField: null, format: ",d" }
	const { columns, rows } = perPanel(input, [...levelCols, valueCol], (panelRows) =>
		built(panelRows).map((n) => [
			...Array.from({ length: maxDepth }, (_, i) => n.path[i] ?? ""),
			valueField ? clean(n.total) : n.leaves,
		])
	)
	return {
		aggregated: true,
		columns,
		rows,
		note: `One row per node; a group's value is the sum of the values inside it; ${rowsNote(input)}.`,
	}
}

// ── Flows ─────────────────────────────────────────────────────────────────

const flowData = (input: PlottedDataInput): PlottedData => {
	const { sourceField, targetField, valueField } = resolveFlowEndpoints(
		input.encodings,
		input.channelConfigs.connection,
		input.view
	)
	if (!sourceField || !targetField || !valueField) return { aggregated: false, note: null }
	const sankey = input.mode === "sankey"
	const { columns, rows } = perPanel(
		input,
		[
			fieldColumn(input, sourceField),
			fieldColumn(input, targetField),
			measureColumn(valueField, "sum"),
		],
		(panelRows) => {
			const { edges } = buildFlowGraph(panelRows, { sourceField, targetField, valueField })
			// The sankey draws only an acyclic subset (self-loops and the
			// smallest cycle-closing flows drop); the chord draws them all.
			const drawn = sankey ? breakCycles(edges).kept : edges
			return drawn.map((e) => [e.source, e.target, clean(e.value)])
		}
	)
	return {
		aggregated: true,
		columns,
		rows,
		note: `Values are sums per link${sankey ? " (links the diagram can't draw — loops — are left out)" : ""}; ${rowsNote(input)}.`,
	}
}

// ── Entry point ───────────────────────────────────────────────────────────

/** True when the chart draws one mark per GROUP of rows, so the table lists
 * aggregated values instead of rows (and the "Columns" option is inert).
 * Cheap: decides from the mode + config without aggregating. */
export const plotsAggregates = (
	input: Pick<PlottedDataInput, "mode" | "encodings" | "channelConfigs" | "getType">
): boolean => {
	const { mode } = input
	if (isBarModeId(mode) || isAreaModeId(mode) || isPieModeId(mode)) return true
	if (isHierarchyModeId(mode) || isFlowModeId(mode)) return true
	if (mode === "tile" || mode === "hexbin") return true
	if (mode === "scatter") {
		const d = distributionData({
			...input,
			view: { rows: [], fields: [] },
			levelOrders: {},
		})
		return d?.aggregated === true
	}
	return false
}

/** What the chart's marks encode — see the module comment. Non-aggregating
 * modes return `{ aggregated: false }` (the table lists the view rows),
 * with a note when a curve is computed from them. */
export const plottedRows = (input: PlottedDataInput): PlottedData => {
	const { mode } = input
	if (isBarModeId(mode)) return barsData(input)
	if (isAreaModeId(mode)) return areasData(input)
	if (isPieModeId(mode)) return piesData(input)
	if (mode === "tile") return tileData(input)
	if (mode === "hexbin") return hexbinData(input)
	if (isHierarchyModeId(mode)) return hierarchyData(input)
	if (isFlowModeId(mode)) return flowData(input)
	if (mode === "scatter") {
		const dist = distributionData(input)
		if (dist) return dist
		if (input.channelConfigs.x?.regression?.enabled === true)
			return { aggregated: false, note: "The regression line is computed from these rows." }
	}
	return { aggregated: false, note: null }
}
