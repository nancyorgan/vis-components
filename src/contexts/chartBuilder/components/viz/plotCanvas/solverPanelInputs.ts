import { autoLabelAngleFor } from "../../../lib/autoLabelAngle"
import {
	migrateProportionalSizing,
	migrateShareValue,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import type { SolverPanelInput } from "../../../lib/facetLayoutSolver"
import { effectiveType } from "../../../lib/fieldType"
import { resolveTickFontSizePx } from "../../../lib/fontUnit"
import { buildTickFormatter } from "../../../lib/formatTick"
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
import { measureMaxLabelWidth } from "./measureText"
import { groupRowsByShareGroup, panelGroupKeys } from "./panelGrouping"

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
}): SolverPanelInput[] => {
	const ds = dataset
	if (!ds) return []
	const xField = encodings.x?.field ?? null
	const yField = encodings.y?.field ?? null
	// Custom tick formatters (d3-format), when the axis sets one. The
	// margin estimate must measure the FORMATTED label — "$140,000" is
	// wider than the raw "140000", and under-measuring it lets the
	// centered edge tick label clip past the plot's right edge.
	const xTickFmt = channelConfigs.x?.customFormat
		? buildTickFormatter({ customFormat: channelConfigs.x.customFormat }, "quantitative")
		: null
	const yTickFmt = channelConfigs.y?.customFormat
		? buildTickFormatter({ customFormat: channelConfigs.y.customFormat }, "quantitative")
		: null
	const labelsAxisFor = (axis: "x" | "y", panelRows: Array<Record<string, unknown>>): string[] => {
		const field = axis === "x" ? xField : yField
		if (!field) return []
		const type = effectiveType(ds, field, overrides)
		if (type === "categorical" || type === "ordinal") {
			return [
				...new Set(
					panelRows.map((r) => String(r[field] ?? "")).filter(Boolean)
				),
			]
		}
		// Quantitative: use min/max as representative tick labels. The
		// rendered axis will format ticks (e.g. d3 picks "150" for an
		// axis whose data goes to 148.50000000001), so we mirror that
		// by truncating to ~4 significant figures here. Otherwise the
		// raw `String(148.50000000001)` produces 14-char labels and
		// `estimateExtraLeftMargin` over-reserves ~80px of left chrome
		// — the user-reported "blank strip on the left" bug (May 2026).
		const nums: number[] = []
		for (const r of panelRows) {
			const n = Number(r[field])
			if (Number.isFinite(n)) nums.push(n)
		}
		if (nums.length === 0) return []
		const customFmt = axis === "x" ? xTickFmt : yTickFmt
		const fmtForMargin = (n: number): string => {
			// When the axis has an explicit d3-format spec, measure the
			// label as it will actually render (e.g. "$140,000") so the
			// chrome reserves match the on-screen width.
			if (customFmt) return customFmt(n)
			if (n === 0) return "0"
			// Trim trailing zeros / unnecessary precision; matches d3's
			// default tick formatter closely enough for character-count
			// estimation purposes (we don't need exact pixel parity).
			return Number(n.toPrecision(4)).toString()
		}
		return [
			fmtForMargin(Math.min(...nums)),
			fmtForMargin(Math.max(...nums)),
		]
	}
	// Pre-compute the quantitative-axis data range per panel for
	// "size panels by unit" mode (spec §4.5). Axis-aware: returns the
	// x-axis range and y-axis range separately so the solver can
	// apply each to the matching dimension. When a panel's axis
	// isn't quantitative/temporal, that axis's range collapses to 0
	// (caller floors to 1).
	const xType = xField ? effectiveType(ds, xField, overrides) : null
	const yType = yField ? effectiveType(ds, yField, overrides) : null
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
		return { min: Math.min(...nums), max: Math.max(...nums) }
	}
	const xQuantExtent = (
		panelRows: Array<Record<string, unknown>>,
	): { min: number; max: number } | null => {
		if (!xField || !xType || !isQuant(xType)) return null
		return extentOnAxis(panelRows, xField, xType)
	}
	const yQuantExtent = (
		panelRows: Array<Record<string, unknown>>,
	): { min: number; max: number } | null => {
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
		? migrateShareValue(facetCfg.shareX, facetCfg.shareAxes)
		: "none"
	const shareYMode: "none" | "perGroup" | "all" = isFacetedHere
		? migrateShareValue(facetCfg.shareY, facetCfg.shareAxes)
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
	return panelData.values.map((key, idx) => {
		const rows = panelData.rowsByValue.get(key) ?? []
		const row = Math.floor(idx / panelData.grid.cols)
		const col = idx % panelData.grid.cols
		// Share-group keys + original facet values: compaction moves
		// panels, so group membership / override lookups key by facet
		// VALUE in grid mode (layout position elsewhere).
		const { rowKey, colKey } = panelGroupKeys(panelData, key, idx)
		const facetVals = panelFacetValues(panelData, key, idx)
		const xLabels = labelsAxisFor("x", rows)
		const yLabels = labelsAxisFor("y", rows)
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
			shareXMode === "none" ? xLabels : labelsAxisFor("x", xWeightRows)
		const yWeightLabels =
			shareYMode === "none" ? yLabels : labelsAxisFor("y", yWeightRows)
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
		// bound — feed it into the weight so "Size rows by unit
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
		const yLegacyOverrideForWeight =
			shareYMode === "none" && panelData.mode === "wrap"
				? facetCfg.panelAxisOverrides?.[key]
				: undefined
		const yWeightOverrideMin =
			yPerGroupOverrideForWeight?.min ??
			yOverallOverrideForWeight?.min ??
			yLegacyOverrideForWeight?.yMin
		const yWeightOverrideMax =
			yPerGroupOverrideForWeight?.max ??
			yOverallOverrideForWeight?.max ??
			yLegacyOverrideForWeight?.yMax
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
			shareXMode === "none" && panelData.mode === "wrap"
				? facetCfg.panelAxisOverrides?.[key]
				: undefined
		const xWeightOverrideMin =
			xPerGroupOverrideForWeight?.min ??
			xOverallOverrideForWeight?.min ??
			xLegacyOverrideForWeight?.xMin
		const xWeightOverrideMax =
			xPerGroupOverrideForWeight?.max ??
			xOverallOverrideForWeight?.max ??
			xLegacyOverrideForWeight?.xMax
		const effectiveRange = (
			extent: { min: number; max: number } | null,
			overrideMin: number | undefined,
			overrideMax: number | undefined,
		): number => {
			const dataMin = extent?.min ?? 0
			const dataMax = extent?.max ?? 0
			const min = overrideMin ?? dataMin
			const max = overrideMax ?? dataMax
			return Math.max(0, max - min)
		}
		// Mirror the wrap / row / col panel's "unambiguous strip" gate
		// at runtime: if the share mode would make a per-strip weight
		// ill-defined (e.g. shareY=none + multi-col, multiple panels
		// per row with their own Y), force the axis's weight to 1 so
		// the row/col distribution stays uniform — even if the user
		// previously checked "Size by …" under a different share
		// mode (the toggle hides, but the stored value persists for
		// when the user switches back).
		//
		// Well-defined weight cases per axis:
		//   - share = "perGroup"               → each strip shares its axis
		//   - share = "none" + perpendicular strip count == 1  → single-panel strips
		//   - share = "all"                    → uniform anyway; the
		//     range-based weight collapses across strips naturally
		//     since every panel sees the same source.
		const ySizingActive =
			shareYMode === "perGroup" ||
			shareYMode === "all" ||
			(shareYMode === "none" && panelData.grid.cols === 1)
		const xSizingActive =
			shareXMode === "perGroup" ||
			shareXMode === "all" ||
			(shareXMode === "none" && panelData.grid.rows === 1)
		const xWeight =
			!xSizingActive || sizeX === "off"
				? 1
				: sizeX === "unit"
					? Math.max(
							RANGE_EPSILON,
							effectiveRange(
								xQuantExtent(xWeightRows),
								xWeightOverrideMin,
								xWeightOverrideMax,
							),
						)
					: Math.max(1, xWeightLabels.length)
		const yWeight =
			!ySizingActive || sizeY === "off"
				? 1
				: sizeY === "unit"
					? Math.max(
							RANGE_EPSILON,
							effectiveRange(
								yQuantExtent(yWeightRows),
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
		const xLabelAngleDeg = autoLabelAngleFor({
			labels: xLabels,
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
					wrapTickLabel(l, bandWidthPx * TICK_WRAP_SLOT_FRACTION, xTickSize),
				)
			: xWeightLabels
		const yChromeLabels = wrapY
			? yWeightLabels.map((l) =>
					wrapTickLabel(l, tickWrapMaxPx(yTickSize), yTickSize),
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
