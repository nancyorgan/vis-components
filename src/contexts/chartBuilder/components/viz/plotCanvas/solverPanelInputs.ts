import { extent } from "d3-array"
import { format as d3Format } from "d3-format"
import { scaleLinear, scaleTime } from "d3-scale"
import { autoLabelAngleFor } from "../../../lib/autoLabelAngle"
import { axisFieldsFor } from "../../../lib/axisFields"
import {
	migrateProportionalSizing,
	migrateShareValue,
	type ChannelConfigs,
	type FacetConfig,
	gridPanelAxisOverride,
} from "../../../lib/channelConfig"
import { comboOverlayChannel } from "../../../lib/chartModes/families"
import type { ChartModeDef } from "../../../lib/chartModes/types"
import { overlayMeasureExtent } from "../../../lib/comboOverlay"
import { evenlySpacedTicks, evenlySpacedTimeTicks } from "../../../lib/evenTicks"
import type { SolverPanelInput } from "../../../lib/facetLayoutSolver"
import { effectiveType } from "../../../lib/fieldType"
import { parseValue } from "../../../lib/scales"
import { resolveTickFontSizePx } from "../../../lib/fontUnit"
import { buildTickFormatter } from "../../../lib/formatTick"
import { uniformTimeFormat, uniformTimeLiteral } from "../../../lib/timeTickFormat"
import { type DateColumnText, dateColumnText, literalTimeLabel } from "../../../lib/rawTextByTime"
import { binnedCounts, computeHistogramBins } from "../../../lib/histogramBins"
import type { TextFontConfig } from "../../../lib/labelsConfig"
import {
	panelFacetValues,
	type FacetPanels,
} from "../../../lib/resolveFacetPanels"
import {
	TICK_WRAP_SLOT_FRACTION,
	tickWrapMaxPx,
	wrapTickLabel,
} from "../../../lib/tickLabelWrap"
import type {
	DatasetView,
	Encodings,
	FieldType,
} from "../../../lib/types"
import { resolveStackModes } from "../../../lib/stackMode"
import { measureLabelWidths, measureMaxLabelWidth } from "./measureText"
import {
	panelTicksOverrides,
	resolvePanelRangeOverrides,
} from "./panelRenderInputs"
import {
	computePanelMeasureMax,
	computePanelMeasureMin,
	groupRowsByShareGroup,
	panelGroupKeys,
} from "./panelGrouping"

/** Mirror of Axes.tsx's `DEFAULT_TICK_COUNT`: the tick density a continuous
 *  axis draws when the user hasn't set a Count. */
const DEFAULT_TICK_COUNT = 5

/** Per-panel label sample for solver margin estimation: one SolverPanelInput
 *  per panel — representative tick labels (formatted, wrapped, canvas-
 *  measured), the auto label angle, and the per-axis proportional-sizing
 *  weights under the tri-state share modes. Pure: PlotCanvas calls this
 *  inside its `panelInputs` useMemo, whose dep array governs recomputation. */
export const buildSolverPanelInputs = ({
	dataset,
	encodings,
	overrides,
	channelConfigs,
	bounds,
	isFaceted,
	facetCfg,
	panelData,
	tickFont,
	mode,
}: {
	dataset: DatasetView | undefined
	encodings: Encodings
	overrides: Record<string, FieldType>
	channelConfigs: ChannelConfigs
	bounds: { width: number }
	isFaceted: boolean
	facetCfg: FacetConfig
	panelData: FacetPanels
	tickFont: TextFontConfig
	/** The detected chart mode. Decides which encoding each axis actually
	 *  draws (vertical bars / areas put the `length` measure on y) and
	 *  whether an axis is the stacked / counted measure axis. Omitted (older
	 *  callers, tests) → x/y read their own channels, as a scatter does. */
	mode?: ChartModeDef
}): SolverPanelInput[] => {
	const ds = dataset
	if (!ds) return []
	// The field each axis DRAWS, per mode — not the channel that shares the
	// axis's name. Vertical bars / areas draw `length` on y (horizontal ones
	// on x); reading `encodings.y` here sampled NO labels for that whole
	// chart family, so the measured width came back 0 and the y-title gap
	// collapsed onto its floor, overlapping the tick labels.
	const axisFields = mode
		? axisFieldsFor(mode, encodings)
		: {
				xField: encodings.x?.field ?? null,
				yField: encodings.y?.field ?? null,
			}
	const xField = axisFields.xField
	const yField = axisFields.yField
	const xType = xField ? effectiveType(ds, xField, overrides) : null
	const yType = yField ? effectiveType(ds, yField, overrides) : null
	// Measure-axis geometry the renderer applies on top of the raw column:
	// stacked bars / areas tick up to the per-category STACK TOTAL (a 100%
	// stack ticks "100%" when no single row exceeds 73), diverging bars
	// reach below zero, and a histogram's axis is a row COUNT with no
	// field behind it at all.
	const measureAxis = mode?.canvas.measureAxis ?? null
	const measureField = mode?.canvas.resolveMeasureField?.(encodings) ?? null
	const stackModes = resolveStackModes(channelConfigs, encodings)
	const groupModeFields = stackModes
		.filter((m) => m.mode === "group")
		.map((m) => encodings[m.channel]?.field)
		.filter((f): f is string => !!f)
	// Stand-in for d3's default tick formatter: trim trailing zeros /
	// unnecessary precision. The rendered axis formats ticks (e.g. d3 picks
	// "150" for an axis whose data goes to 148.50000000001), so we mirror
	// that by truncating to ~4 significant figures here. Otherwise the raw
	// `String(148.50000000001)` produces 14-char labels and
	// `estimateExtraLeftMargin` over-reserves ~80px of left chrome — the
	// user-reported "blank strip on the left" bug (May 2026). Close enough
	// for character-count estimation (no exact pixel parity needed).
	const autoMarginLabel = (v: unknown): string => {
		const n = Number(v)
		return n === 0 ? "0" : Number(n.toPrecision(4)).toString()
	}
	// The axis tick Format over that stand-in. The margin estimate must
	// measure the FORMATTED label — "$140,000" is wider than the raw
	// "140000", and "25 units" wider than "25" — or under-measuring lets the
	// centered edge tick label clip past the plot's right edge.
	// The formatter takes the sorted tick set it labels, as `Axis` does, so
	// the `year-ends` format measures "’22" between its full-year ends.
	const tickFmtFor = (axis: "x" | "y", ticks: readonly number[]) =>
		buildTickFormatter(
			{ customFormat: channelConfigs[axis]?.customFormat ?? "" },
			"quantitative",
			autoMarginLabel,
			{ tickValues: ticks },
		)
	// Replaced ticks (facet Custom breaks) draw at their own precision
	// with thousands separators (`Axis`'s ",~f" fallback), not d3's step
	// precision — measure them the same way.
	const replacedTickFmt = (axis: "x" | "y", ticks: readonly number[]) =>
		buildTickFormatter(
			{ customFormat: channelConfigs[axis]?.customFormat ?? "" },
			"quantitative",
			(v) => d3Format(",~f")(Number(v)),
			{ tickValues: ticks },
		)
	type Extent = { min: number; max: number }
	const fieldExtent = (
		field: string,
		panelRows: Array<Record<string, unknown>>,
		type: FieldType | null = null,
	): Extent | null => {
		const nums: number[] = []
		for (const r of panelRows) {
			// A temporal cell is a date string ("2024-03-01", "1947"): read it
			// through the same parser the scale uses, as epoch ms. `Number()`
			// on an ISO date is NaN, which sampled NO labels for the axis.
			const n =
				type === "temporal"
					? (() => {
							const d = parseValue(r[field], "temporal")
							return d instanceof Date ? d.getTime() : NaN
						})()
					: Number(r[field])
			if (Number.isFinite(n)) nums.push(n)
		}
		if (nums.length === 0) return null
		const [min, max] = extent(nums) as [number, number]
		return { min, max }
	}
	/** The measure axis's data extent as the bar / area renderer builds its
	 *  scale: per-category stack totals (`computePanelMeasureMax`, the same
	 *  walk the shared-axis path uses), a negative floor only for modes whose
	 *  marks can hang below zero, and per-bin row counts for a histogram. */
	const measureExtent = (
		axis: "x" | "y",
		panelRows: Array<Record<string, unknown>>,
	): Extent | null => {
		const catChannel = axis === "y" ? "x" : "y"
		const categoryField = encodings[catChannel]?.field ?? null
		const histogramCfg = channelConfigs[catChannel]?.histogram
		if (
			histogramCfg?.enabled &&
			categoryField &&
			effectiveType(ds, categoryField, overrides) === "quantitative"
		) {
			const values = panelRows.map((r) => r[categoryField])
			const binning = computeHistogramBins(
				values,
				histogramCfg.binCount ?? 10,
				undefined,
				{
					min: channelConfigs[catChannel]?.min ?? null,
					max: channelConfigs[catChannel]?.max ?? null,
				},
			)
			const counts = binning
				? binnedCounts(values, binning)
				: new Map<string, number>()
			const maxCount = counts.size > 0 ? Math.max(0, ...counts.values()) : 0
			const total = [...counts.values()].reduce((a, b) => a + b, 0)
			// Density: bars are bin shares (count / panel total), so the axis
			// tops out at the largest share (≤ 1).
			return {
				min: 0,
				max:
					histogramCfg.mode === "density" && total > 0
						? maxCount / total
						: maxCount,
			}
		}
		if (!measureField) return null
		if (!categoryField) return fieldExtent(measureField, panelRows)
		const bars = {
			min: mode?.canvas.supportsNegativeMeasure
				? computePanelMeasureMin(
						panelRows,
						categoryField,
						measureField,
						stackModes,
						groupModeFields,
					)
				: 0,
			max: computePanelMeasureMax(
				panelRows,
				categoryField,
				measureField,
				stackModes,
				groupModeFields,
			),
		}
		// Combo: the marks layer rides the same axis, so the ticks the solver
		// samples must cover its values as well (BarPlot bounds the axis the
		// same way).
		const overlayChannel = mode ? comboOverlayChannel(mode.id) : null
		const overlayField = overlayChannel
			? (encodings[overlayChannel]?.field ?? null)
			: null
		const overlay = overlayField
			? overlayMeasureExtent(panelRows, overlayField)
			: null
		if (!overlay) return bars
		return {
			min: Math.min(bars.min, overlay.min),
			max: Math.max(bars.max, overlay.max),
		}
	}
	/** A DATE axis's tick labels, as Axes.tsx draws them: a `scaleTime` over
	 *  the data extent, nice'd to calendar boundaries, with a user-pinned
	 *  Scale-range end replacing the nice'd end (`overrideLinearDomain`
	 *  never re-nices); d3's time ticks at the axis Count, or the calendar-
	 *  snapped even ticks when BOTH ends are pinned; the axis's ONE uniform
	 *  time format (`uniformTimeFormat`) under the axis Format. Sampling the epoch-ms numbers
	 *  instead ("-662688000000", thirteen characters a tick) made the
	 *  solver's auto-rotate see collisions the real "1949" labels never
	 *  have, and it reserved a rotated-label band under a level axis —
	 *  the blank strip between the tick labels and the x title on a line
	 *  chart with a pinned date range (user-reported October 2026). */
	const timeTickLabelsFor = (
		cfg: typeof channelConfigs.x,
		extent: Extent,
		pinMin: number | null,
		pinMax: number | null,
		rawText?: DateColumnText,
		replaceTicks?: readonly number[],
	): string[] => {
		const scale = scaleTime()
			.domain([new Date(extent.min), new Date(extent.max)])
			.nice()
		const [niceLo, niceHi] = scale.domain()
		const lo = pinMin ?? niceLo.getTime()
		const hi = pinMax ?? niceHi.getTime()
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
		scale.domain([new Date(lo), new Date(hi)])
		const count = cfg?.tickCount ?? DEFAULT_TICK_COUNT
		const auto: Date[] =
			count <= 0
				? []
				: pinMin !== null && pinMax !== null
					? evenlySpacedTimeTicks(lo, hi, count).map((ms) => new Date(ms))
					: scale.ticks(count)
		const dLo = Math.min(lo, hi)
		const dHi = Math.max(lo, hi)
		const breaks = (cfg?.breaks ?? [])
			.filter((b) => b >= dLo && b <= dHi)
			.map((b) => new Date(b))
		// A panel's Custom breaks replace the layout outright.
		const ticks = (
			replaceTicks ? replaceTicks.map((b) => new Date(b)) : [...auto, ...breaks]
		).sort((a, b) => a.getTime() - b.getTime())
		const timeFmt = uniformTimeFormat(ticks)
		const fmt = buildTickFormatter(
			{ customFormat: cfg?.customFormat ?? "" },
			"temporal",
			(v) => timeFmt(v as Date),
			{
				literalDate: literalTimeLabel(rawText, uniformTimeLiteral(ticks)),
				tickValues: ticks,
			}
		)
		return ticks.map(fmt)
	}
	/** The tick labels a continuous axis draws over `extent`, laid out the
	 *  way Axes.tsx lays them out: a user-pinned Scale range end replaces the
	 *  data end, the auto ticks are d3's nice ticks at the axis's Count (or
	 *  `count` evenly spaced values when BOTH ends are pinned), and Custom
	 *  breaks inside the domain add their own labels — or, when the panel
	 *  has facet "Custom breaks", exactly those (`replaceTicks`; not
	 *  domain-filtered, since the per-panel bounds aren't known here, so an
	 *  out-of-range value over-reserves rather than clips). Sampling only the raw
	 *  data min / max under-measured here: "148.5" is narrower than the
	 *  "150" d3 actually draws, and a nice'd top of "100" is a digit wider
	 *  than a data max of "98". */
	const tickLabelsFor = (
		axis: "x" | "y",
		extent: Extent,
		type: FieldType | null = null,
		rawText?: DateColumnText,
		replaceTicks?: readonly number[],
	): string[] => {
		const cfg = axis === "x" ? channelConfigs.x : channelConfigs.y
		const pinMin = typeof cfg?.min === "number" ? cfg.min : null
		const pinMax = typeof cfg?.max === "number" ? cfg.max : null
		if (type === "temporal") {
			return timeTickLabelsFor(cfg, extent, pinMin, pinMax, rawText, replaceTicks)
		}
		if (replaceTicks) {
			const sorted = [...replaceTicks].sort((a, b) => a - b)
			return sorted.map(replacedTickFmt(axis, sorted))
		}
		const lo = pinMin ?? extent.min
		const hi = pinMax ?? extent.max
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
		const count = cfg?.tickCount ?? DEFAULT_TICK_COUNT
		const auto: number[] =
			count <= 0
				? []
				: pinMin !== null && pinMax !== null
					? evenlySpacedTicks(lo, hi, count)
					: scaleLinear().domain([lo, hi]).nice().ticks(count)
		const dLo = Math.min(lo, hi)
		const dHi = Math.max(lo, hi)
		const breaks = (cfg?.breaks ?? []).filter((b) => b >= dLo && b <= dHi)
		const ticks = [...auto, ...breaks].sort((a, b) => a - b)
		return ticks.map(tickFmtFor(axis, ticks))
	}
	const labelsAxisFor = (
		axis: "x" | "y",
		panelRows: Array<Record<string, unknown>>,
		replaceTicks?: readonly number[],
	): string[] => {
		const field = axis === "x" ? xField : yField
		const type = field ? effectiveType(ds, field, overrides) : null
		if (field && (type === "categorical" || type === "ordinal")) {
			return [
				...new Set(
					panelRows.map((r) => String(r[field] ?? "")).filter(Boolean)
				),
			]
		}
		// Continuous: sample the tick labels the axis will draw. The measure
		// axis has its own extent rules (stacking, negative floor, counts) and
		// may have no field of its own (histogram).
		const extent =
			axis === measureAxis
				? measureExtent(axis, panelRows)
				: field
					? fieldExtent(field, panelRows, type)
					: null
		if (!extent) return []
		// The measure axis of bars / areas is always numeric (sums, counts).
		const axisType = axis === measureAxis ? null : type
		return tickLabelsFor(
			axis,
			extent,
			axisType,
			field && axisType === "temporal" ? dateColumnText(panelRows, field) : undefined,
			replaceTicks,
		)
	}
	// Pre-compute the quantitative-axis data range per panel for
	// "size panels by unit" mode (spec §4.5). Axis-aware: returns the
	// x-axis range and y-axis range separately so the solver can
	// apply each to the matching dimension. When a panel's axis
	// isn't quantitative/temporal, that axis's range collapses to 0
	// (caller floors to 1).
	const isQuant = (t: FieldType | null): boolean =>
		t === "quantitative" || t === "temporal"
	const extentOnAxis = (
		panelRows: Array<Record<string, unknown>>,
		field: string,
		type: FieldType,
	): { min: number; max: number } | null => {
		const nums: number[] = []
		for (const r of panelRows) {
			const raw = r[field]
			if (raw === null || raw === undefined || raw === "") continue
			const n =
				type === "temporal"
					? new Date(String(raw)).getTime()
					: Number(raw)
			if (Number.isFinite(n)) nums.push(n)
		}
		if (nums.length < 2) return null
		const [min, max] = extent(nums) as [number, number]
		return { min, max }
	}
	// The measure axis of bars / areas weighs by the extent its scale is
	// built from (zero baseline, stack totals, histogram counts) — not the
	// raw Length column, which a histogram doesn't even have.
	const xQuantExtent = (
		panelRows: Array<Record<string, unknown>>,
	): { min: number; max: number } | null => {
		if (measureAxis === "x") return measureExtent("x", panelRows)
		if (!xField || !xType || !isQuant(xType)) return null
		return extentOnAxis(panelRows, xField, xType)
	}
	const yQuantExtent = (
		panelRows: Array<Record<string, unknown>>,
	): { min: number; max: number } | null => {
		if (measureAxis === "y") return measureExtent("y", panelRows)
		if (!yField || !yType || !isQuant(yType)) return null
		return extentOnAxis(panelRows, yField, yType)
	}
	// Estimate the per-band width each panel's x-axis would get under
	// equal sizing: the container's width minus base side margins,
	// split across cols, then divided by the panel's category count.
	// Approximate (the solver may tweak final widths via proportional
	// sizing) but accurate enough to decide whether x-tick labels
	// will overlap — and to feed the solver a non-zero angle so the
	// bottom chrome reserves the right amount of room.
	const approxPanelInnerW = Math.max(
		60,
		(bounds.width - 60 - 24) / Math.max(panelData.grid.cols, 1),
	)
	// share-axes + proportional: when an axis is shared, every panel
	// builds its scale from a wider row source (the FULL dataset for
	// "all", or all panels in the same column / row for "perGroup"),
	// so per-panel category counts (or quant ranges) for that axis
	// become identical across the sharing group. We mirror that here
	// by using the same wider source for the shared axis's weight,
	// which makes colWeights / rowWeights naturally uniform across
	// the shared dimension — no special-case collapse rule needed in
	// the solver.
	const isFacetedHere = isFaceted
	const shareXMode: "none" | "perGroup" | "all" = isFacetedHere
		? migrateShareValue(facetCfg.shareX)
		: "none"
	const shareYMode: "none" | "perGroup" | "all" = isFacetedHere
		? migrateShareValue(facetCfg.shareY)
		: "none"
	// Resolve per-axis sizing modes once per memo run. Each axis chooses
	// independently between "off" (equal-sized along that axis),
	// "categoryCount" (weight = #ticks), or "unit" (weight = quant range).
	// Reads the per-axis fields when present; falls back to the legacy
	// global flags so saved visuals continue to render as before.
	const sizeX = migrateProportionalSizing(
		facetCfg.proportionalSizingX,
		facetCfg.proportionalSizing,
		facetCfg.proportionalSizingByUnit,
	)
	const sizeY = migrateProportionalSizing(
		facetCfg.proportionalSizingY,
		facetCfg.proportionalSizing,
		facetCfg.proportionalSizingByUnit,
	)
	const allRows = dataset?.rows ?? []
	// Per-column and per-row row groupings — under "perGroup", each
	// panel's scale source is the union of its column's (for x) or
	// row's (for y) rows. Iterating once over panelData.values is
	// cheaper than recomputing per panel.
	const { colRowsByColKey, rowRowsByRowKey } = groupRowsByShareGroup(panelData)
	// Same continuity gate the render loop applies to the facet range
	// overrides: the measure axis is always continuous, field or not.
	const xIsContinuous =
		xType === "quantitative" || xType === "temporal" || measureAxis === "x"
	const yIsContinuous =
		yType === "quantitative" || yType === "temporal" || measureAxis === "y"
	return panelData.values.map((key, idx) => {
		const rows = panelData.rowsByValue.get(key) ?? []
		const row = Math.floor(idx / panelData.grid.cols)
		const col = idx % panelData.grid.cols
		// Share-group keys + original facet values: compaction moves
		// panels, so group membership / override lookups key by facet
		// VALUE in grid mode (layout position elsewhere).
		const { rowKey, colKey } = panelGroupKeys(panelData, key, idx)
		const facetVals = panelFacetValues(panelData, key, idx)
		// Facet "Custom breaks" replace a continuous axis's ticks —
		// resolved exactly as the render loop resolves them.
		const { xTicksOverride, yTicksOverride } = isFacetedHere
			? panelTicksOverrides(
					resolvePanelRangeOverrides({
						p: { key, row, col },
						panelData,
						shareXMode,
						shareYMode,
						facetCfg,
						xIsContinuous,
						yIsContinuous,
					}),
				)
			: {}
		const xLabels = labelsAxisFor("x", rows, xTicksOverride)
		const yLabels = labelsAxisFor("y", rows, yTicksOverride)
		// For WEIGHTS only: use the appropriate row source per the
		// tri-state mode so xWeight / yWeight are uniform across
		// panels in the same sharing group. xLabels / yLabels (above)
		// stay per-panel because they drive PER-PANEL label rendering.
		const xWeightRows =
			shareXMode === "all"
				? allRows
				: shareXMode === "perGroup"
					? colRowsByColKey.get(colKey) ?? rows
					: rows
		const yWeightRows =
			shareYMode === "all"
				? allRows
				: shareYMode === "perGroup"
					? rowRowsByRowKey.get(rowKey) ?? rows
					: rows
		const xWeightLabels =
			shareXMode === "none"
				? xLabels
				: labelsAxisFor("x", xWeightRows, xTicksOverride)
		const yWeightLabels =
			shareYMode === "none"
				? yLabels
				: labelsAxisFor("y", yWeightRows, yTicksOverride)
		// Axis-aware weights. Under "by unit" the weight is each
		// axis's quantitative range (so per-unit spacing stays
		// constant across panels); under "by category count" it's
		// each axis's category count. When neither flag is on the
		// solver collapses both to 1 → equal-sized panels.
		//
		// Floor: 1 for category count (a "no categories" panel still
		// reserves one slot). Any tiny positive epsilon for quant
		// range — the actual floor value doesn't matter because the
		// solver distributes by RATIO; we just need to avoid 0 (so
		// the colWeightSum doesn't degenerate). The previous floor
		// of 1 silently clamped sub-1 ranges (e.g. dumbbelldat2
		// Value 0.01–0.25) to uniform, breaking size-by-unit.
		const RANGE_EPSILON = 1e-9
		// "Size by unit range" weight: derive from the panel's effective
		// axis bounds AFTER applying any user override (per-panel,
		// per-row/col, or overall). Otherwise the user setting a custom
		// range had no effect on the proportional row/col sizing —
		// user-reported with size-rows-by-unit and per-panel y ranges.
		//
		// Override lookup mirrors the renderer's bound-resolution order
		// in the panel render loop: group key first (perGroup) → overall
		// (all) → legacy wrap per-panel (none). First non-null bound
		// wins; missing bounds fall through to the data extent.
		// Same expansion as the render-loop's override-applies gate:
		// in a row-only grid (cols===1) with shareY=none, each row is
		// a single panel and the row override doubles as a per-panel
		// bound — feed it into the weight so "Size row heights by unit
		// range" reflects the user's pinned range here too.
		const yRowOverrideAppliesForWeight =
			shareYMode === "perGroup" ||
			(shareYMode === "none" &&
				panelData.mode === "grid" &&
				panelData.grid.cols === 1)
		const yPerGroupOverrideForWeight = yRowOverrideAppliesForWeight
			? panelData.mode === "grid"
				? facetCfg.rowAxisOverrides?.[
						facetVals.rowValue ?? "__none__"
					]
				: facetCfg.rowAxisOverrides?.[String(row)]
			: undefined
		const yOverallOverrideForWeight =
			shareYMode === "all" ? facetCfg.overallYRange : undefined
		// Per-panel bounds: wrap mode's `panelAxisOverrides` (keyed by the
		// facet value) and grid mode's "range per panel" editor (row /
		// column panels, share = none with 2+ panels across, writing
		// `gridPanelAxisOverrides`) — read under share "none" in either
		// faceted mode.
		const panelOverrideForWeight =
			panelData.mode === "grid"
				? gridPanelAxisOverride(facetCfg, facetVals.rowValue, facetVals.colValue)
				: panelData.mode === "wrap"
					? facetCfg.panelAxisOverrides?.[key]
					: undefined
		const yLegacyOverrideForWeight =
			shareYMode === "none" ? panelOverrideForWeight : undefined
		const yWeightOverrideMin =
			yPerGroupOverrideForWeight?.min ??
			yOverallOverrideForWeight?.min ??
			yLegacyOverrideForWeight?.yMin ??
			channelConfigs.y?.min ??
			undefined
		const yWeightOverrideMax =
			yPerGroupOverrideForWeight?.max ??
			yOverallOverrideForWeight?.max ??
			yLegacyOverrideForWeight?.yMax ??
			channelConfigs.y?.max ??
			undefined
		const xColOverrideAppliesForWeight =
			shareXMode === "perGroup" ||
			(shareXMode === "none" &&
				panelData.mode === "grid" &&
				panelData.grid.rows === 1)
		const xPerGroupOverrideForWeight = xColOverrideAppliesForWeight
			? panelData.mode === "grid"
				? facetCfg.colAxisOverrides?.[
						facetVals.colValue ?? "__none__"
					]
				: facetCfg.colAxisOverrides?.[String(col)]
			: undefined
		const xOverallOverrideForWeight =
			shareXMode === "all" ? facetCfg.overallXRange : undefined
		const xLegacyOverrideForWeight =
			shareXMode === "none" ? panelOverrideForWeight : undefined
		const xWeightOverrideMin =
			xPerGroupOverrideForWeight?.min ??
			xOverallOverrideForWeight?.min ??
			xLegacyOverrideForWeight?.xMin ??
			channelConfigs.x?.min ??
			undefined
		const xWeightOverrideMax =
			xPerGroupOverrideForWeight?.max ??
			xOverallOverrideForWeight?.max ??
			xLegacyOverrideForWeight?.xMax ??
			channelConfigs.x?.max ??
			undefined
		// The weight is the span of the domain the axis DRAWS, not the raw
		// data min–max: every renderer rounds the auto-fit ends outward with
		// d3's `.nice()` (a box plot over 1.2k–32k draws 0–35k) and only a
		// user-pinned end stays exact. Weighing the raw extent put a
		// different px-per-unit in every panel — "$30k" sat at a different
		// height in each one (user-reported October 2026). Pins resolve in
		// the renderer's order (panelRenderInputs): facet override, then the
		// axis panel's own Scale range.
		const effectiveRange = (
			extent: { min: number; max: number } | null,
			temporal: boolean,
			overrideMin: number | undefined,
			overrideMax: number | undefined,
		): number => {
			const dataMin = extent?.min ?? 0
			const dataMax = extent?.max ?? 0
			const [niceMin, niceMax] = temporal
				? scaleTime()
						.domain([new Date(dataMin), new Date(dataMax)])
						.nice()
						.domain()
						.map((d) => d.getTime())
				: scaleLinear().domain([dataMin, dataMax]).nice().domain()
			const min = overrideMin ?? niceMin
			const max = overrideMax ?? niceMax
			return Math.max(0, max - min)
		}
		// Weights follow the share group (xWeightRows / yWeightRows), so
		// share = "all" collapses to uniform on its own and share = "none"
		// gives every panel its own weight — the solver shrinks a panel
		// inside its row / column cell when it's smaller than the strip's
		// max (per-panel sizing, LAYOUT.md §6).
		const xWeight =
			sizeX === "off"
				? 1
				: sizeX === "unit"
					? Math.max(
							RANGE_EPSILON,
							effectiveRange(
								xQuantExtent(xWeightRows),
								measureAxis !== "x" && xType === "temporal",
								xWeightOverrideMin,
								xWeightOverrideMax,
							),
						)
					: Math.max(1, xWeightLabels.length)
		const yWeight =
			sizeY === "off"
				? 1
				: sizeY === "unit"
					? Math.max(
							RANGE_EPSILON,
							effectiveRange(
								yQuantExtent(yWeightRows),
								measureAxis !== "y" && yType === "temporal",
								yWeightOverrideMin,
								yWeightOverrideMax,
							),
						)
					: Math.max(1, yWeightLabels.length)
		const bandWidthPx =
			xLabels.length > 0 ? approxPanelInnerW / xLabels.length : 0
		// Per-axis tick-label font overrides shift the chrome reserves:
		// a larger x-tick font needs more bottom room, a larger y-tick
		// font more left room. Fall through to the global text font when
		// the axis hasn't overridden the size / family.
		const xTickSize = resolveTickFontSizePx(
			channelConfigs.x?.tickLabelFont?.size,
			tickFont.size
		)
		const yTickSize = resolveTickFontSizePx(
			channelConfigs.y?.tickLabelFont?.size,
			tickFont.size
		)
		const xTickFamily =
			channelConfigs.x?.tickLabelFont?.family ?? tickFont.family
		const yTickFamily =
			channelConfigs.y?.tickLabelFont?.family ?? tickFont.family
		// Weight / style feed the width measurement so it matches the
		// rendered glyphs (Axes.tsx resolves the same fallback chain).
		const xTickWeight =
			channelConfigs.x?.tickLabelFont?.weight ?? tickFont.weight
		const yTickWeight =
			channelConfigs.y?.tickLabelFont?.weight ?? tickFont.weight
		const xTickItalic =
			channelConfigs.x?.tickLabelFont?.italic ?? tickFont.italic
		const yTickItalic =
			channelConfigs.y?.tickLabelFont?.italic ?? tickFont.italic
		const wrapX = channelConfigs.x?.wrapTickLabels === true
		const wrapY = channelConfigs.y?.wrapTickLabels === true
		// Same neighbor-collision check Axes.tsx runs at render, with the
		// same measured widths — so the angle the solver reserves bottom
		// chrome for is the angle that draws.
		const xLabelAngleDeg = autoLabelAngleFor({
			labels: xLabels,
			labelWidthsPx: measureLabelWidths(
				xLabels,
				xTickFamily,
				xTickSize,
				xTickWeight,
				xTickItalic,
			),
			bandWidthPx,
			fontSize: xTickSize,
			userAngle: channelConfigs.x?.tickLabelAngle,
			wrapEnabled: wrapX,
		})
		// "Wrap text": pre-wrap the chrome labels the same way Axes.tsx
		// wraps at render time, so the solver reserves multi-line room
		// (line count for bottom chrome, widest line for left chrome)
		// that matches what actually draws. X labels wrap to the per-tick
		// slot estimate; y labels to the fixed font-relative max width.
		const xChromeLabels = wrapX
			? xWeightLabels.map((l) =>
					wrapTickLabel(
						l,
						bandWidthPx * TICK_WRAP_SLOT_FRACTION,
						xTickSize,
						channelConfigs.x?.wrapTickLabelChars,
					),
				)
			: xWeightLabels
		const yChromeLabels = wrapY
			? yWeightLabels.map((l) =>
					wrapTickLabel(
						l,
						tickWrapMaxPx(yTickSize),
						yTickSize,
						channelConfigs.y?.wrapTickLabelChars,
					),
				)
			: yWeightLabels
		// Pre-measure the widest label per axis via canvas measureText.
		// The solver uses these for chrome reserves and y-title
		// positioning. Without measurement, the 0.55-char-width
		// estimate overshoots narrow fonts by 20-30%.
		//
		// IMPORTANT: under shareX="all"/"perGroup" or shareY="all"/
		// "perGroup", the rendered axis shows labels from the WIDER
		// row source (full dataset or row/col group), not just this
		// panel's data. So we measure against `xWeightLabels` /
		// `yWeightLabels`, which already account for the share mode.
		// Under shareX/Y="none", the weight-labels collapse to per-
		// panel `xLabels`/`yLabels`, so this is equivalent.
		//
		// (The solver never forwards xLabels/yLabels to renderers —
		// renderers generate their own ticks from the scale. The
		// solver only uses these for chrome math, so feeding it the
		// share-aware label set is the right choice.)
		const xLabelMaxWidthPx = measureMaxLabelWidth(
			xChromeLabels,
			xTickFamily,
			xTickSize,
			xTickWeight,
			xTickItalic,
		)
		const yLabelMaxWidthPx = measureMaxLabelWidth(
			yChromeLabels,
			yTickFamily,
			yTickSize,
			yTickWeight,
			yTickItalic,
		)
		return {
			key,
			row,
			col,
			xLabels: xChromeLabels,
			yLabels: yChromeLabels,
			xLabelAngleDeg,
			xLabelFontSize: xTickSize,
			yLabelFontSize: yTickSize,
			xLabelMaxWidthPx,
			yLabelMaxWidthPx,
			xWeight,
			yWeight,
			// Continuous x-axes place ticks at the domain edges, so the
			// centered edge tick label overhangs the plot rect — the
			// solver reserves right-margin room for it. Categorical bands
			// inset their edge ticks by half a step, so they don't.
			xAxisContinuous: isQuant(xType),
		}
	})
}
