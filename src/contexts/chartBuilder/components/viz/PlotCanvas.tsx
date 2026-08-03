import { useEffect, useId, useMemo } from "react"
import useMeasure from "react-use-measure"
import { useAtomValue, useSetAtom } from "jotai"
import { autoLabelAngleFor } from "../../lib/autoLabelAngle"
import {
	TICK_WRAP_SLOT_FRACTION,
	tickWrapMaxPx,
	wrapTickLabel,
} from "../../lib/tickLabelWrap"
import { axisFieldsFor, hasXAxis, hasYAxis } from "../../lib/axisFields"
import {
	DEFAULT_FACET_CONFIG,
	migrateProportionalSizing,
	rowSizingMeaningful,
	colSizingMeaningful,
	migratePolarShareValue,
	migrateShareValue,
	type FacetConfig,
} from "../../lib/channelConfig"
import { getChartModeDef, type ChartMode } from "../../lib/chartMode"
import { MODE_RENDERERS } from "./rendererRegistry"
import { binnedCounts, computeHistogramBins } from "../../lib/histogramBins"
import { effectiveType } from "../../lib/fieldType"
import { buildTickFormatter } from "../../lib/formatTick"
import {
	solveFacetLayout,
	type FacetLayoutSpec,
	type SolverInput,
	type SolverPanelInput,
	type TextRect,
} from "../../lib/facetLayoutSolver"
import {
	layerFacetOverride,
	resolveTextFont,
	resolveTitleFont,
	type LabelAlignment,
	type VerticalAlignment,
} from "../../lib/labelsConfig"
import {
	lineCount,
	renderMultilineTspans,
	wrapTextToWidth,
} from "../../lib/multilineText"
import {
	DEFAULT_CAPTION_CONFIG,
	type CaptionConfig,
	type CaptionUnit,
} from "../../lib/captionConfig"
import {
	BASE_MARGIN,
	type ExtraMargin,
	type PlotInner,
} from "../../lib/plotLayout"
import {
	panelFacetValues,
	resolveFacetPanels,
	type FacetPanels,
} from "../../lib/resolveFacetPanels"
import { resolveStackModes, type StackModeEntry } from "../../lib/stackMode"
import { PLOT_SVG_ID } from "../../lib/captureThumbnail"
import {
	currentAnnotationsAtom,
	currentCaptionConfigAtom,
	currentChannelConfigsAtom,
	currentRenderedCaptionBoxAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentMapConfigAtom,
	currentRenderedFigureSlackAtom,
	currentRenderedPanelInnerDimsAtom,
} from "../../store/atoms"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	effectiveLabelPoints,
	type EndpointLabelOverrides,
} from "../../lib/channelConfig"
import { buildLabelText } from "../../lib/dataLabelsStyle"
import {
	DEFAULT_RECTANGLE_TEXT,
	type CircleAnnotation,
	type LineSegmentAnnotation,
	type RectangleAnnotation,
} from "../../lib/annotationsConfig"
import { computeCirclePixels } from "../../lib/circleAnnotationGeometry"
import { computeLineSegmentPixels } from "../../lib/lineSegmentAnnotationGeometry"
import { dashArrayFor } from "../../lib/dashPatterns"
import type { Rect } from "../../lib/facetLayoutSolver"
import {
	applyPositionScale,
	makePositionScale,
	type PositionScale,
} from "../../lib/scales"
import type { FieldType } from "../../lib/types"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import type { UniversalRendererProps } from "../../lib/chartRendererProps"

/** Unified single-SVG renderer for both single-panel and faceted charts.
 *
 *  PlotCanvas:
 *    1. Measures container bounds (one useMeasure for the entire chart)
 *    2. Builds SolverInput from Jotai state
 *    3. Calls solveFacetLayout → spec
 *    4. Renders ONE <svg id={PLOT_SVG_ID}> containing:
 *       - Shared chart title, subtitle, x-title, y-title as <text>
 *       - Per-panel facet labels as <text>
 *       - Each panel's renderer (Bar/Scatter/Area/Pie/Tile) with `inner`
 *         set to the panel's solver-computed plot rect (in CANVAS coords).
 *
 *  Alignment by construction: every coordinate comes from the solver,
 *  which folds margin estimation, gap math, and share-overlap into a
 *  single typed FacetLayoutSpec. */

const FACET_LABEL_HEIGHT_PX = 20
/** Polar facet-label band. Polar charts (radar / pie) don't carry x-axis
 *  tick labels at the top of the panel so the label can sit closer to
 *  the chart without crowding anything; shaving 4px off each row's
 *  facet band materially reduces between-row whitespace in 2×N grids. */
const FACET_LABEL_HEIGHT_PX_POLAR = 16

const TITLE_FILL_FALLBACK = "fill-stone-700 dark:fill-stone-300"

const rectToInner = (rect: {
	x: number
	y: number
	width: number
	height: number
}): PlotInner => ({
	x0: rect.x,
	y0: rect.y,
	x1: rect.x + rect.width,
	y1: rect.y + rect.height,
})

/** Reusable canvas context for text measurement. Created lazily so we
 *  don't allocate during SSR. Subsequent measurements reuse the same
 *  context (cheap), only re-setting the font when it changes. */
let _measureCtx: CanvasRenderingContext2D | null = null
const getMeasureContext = (): CanvasRenderingContext2D | null => {
	if (typeof document === "undefined") return null
	if (!_measureCtx) {
		const canvas = document.createElement("canvas")
		_measureCtx = canvas.getContext("2d")
	}
	return _measureCtx
}

/** Measure the widest label in `labels` using canvas measureText with
 *  the chart's actual tick-font. Returns 0 when the canvas API isn't
 *  available (SSR / non-DOM env) — the solver then falls back to its
 *  character-count estimate. Accurate widths matter for y-title
 *  positioning: the title sits a fixed gap from the rendered label
 *  edge, so a 30% over-estimate (the 0.55-char-width heuristic on
 *  narrow fonts) shows up as visible "weird gap" between title and
 *  labels (user-reported May 2026).
 *
 *  Multi-line (wrapped, `\n`-joined) labels measure their widest LINE —
 *  the rendered bounding box of stacked tspans is the widest line. */
const measureMaxLabelWidth = (
	labels: readonly string[],
	fontFamily: string | null | undefined,
	fontSize: number,
	fontWeight?: number,
	italic?: boolean,
): number => {
	const ctx = getMeasureContext()
	if (!ctx || labels.length === 0) return 0
	// Match the RENDERED font — weight and style included. Omitting the
	// weight made a 600-weight "$140,000" measure narrower than it draws,
	// so the reserved right margin landed on the glyph edge and clipped the
	// last character. Canvas font shorthand: `[style] [weight] size family`.
	const stylePrefix = italic ? "italic " : ""
	const weightPrefix = fontWeight ? `${fontWeight} ` : ""
	ctx.font = `${stylePrefix}${weightPrefix}${fontSize}px ${fontFamily ?? "sans-serif"}`
	let max = 0
	for (const label of labels) {
		for (const line of label.split("\n")) {
			const w = ctx.measureText(line).width
			if (w > max) max = w
		}
	}
	return max
}

/** Share-group keys for a panel. Grid mode keys by ORIGINAL facet value
 *  (compaction moves panels, so layout position lies); wrap/single fall
 *  back to layout position, matching prior behavior. */
const panelGroupKeys = (
	panelData: FacetPanels,
	key: string,
	idx: number,
): { rowKey: string; colKey: string } => {
	const layoutRow = Math.floor(idx / panelData.grid.cols)
	const layoutCol = idx % panelData.grid.cols
	if (panelData.mode !== "grid")
		return { rowKey: String(layoutRow), colKey: String(layoutCol) }
	const fv = panelFacetValues(panelData, key, idx)
	return {
		rowKey: fv.rowValue ?? String(layoutRow),
		colKey: fv.colValue ?? String(layoutCol),
	}
}

/** Group panel rows by their share group. Returns two maps keyed by
 *  column group key (rows in that column, unioned across all its panels)
 *  and row group key (rows in that row, unioned across all its panels) —
 *  facet VALUES in grid mode, layout indices as strings otherwise (see
 *  `panelGroupKeys`). Both shareX="perGroup" and the panelInputs weight
 *  calculation consult these to find the wider row source under
 *  per-group sharing. */
const groupRowsByShareGroup = (
	panelData: FacetPanels,
): {
	colRowsByColKey: Map<string, Array<Record<string, unknown>>>
	rowRowsByRowKey: Map<string, Array<Record<string, unknown>>>
} => {
	const colRowsByColKey = new Map<string, Array<Record<string, unknown>>>()
	const rowRowsByRowKey = new Map<string, Array<Record<string, unknown>>>()
	panelData.values.forEach((k, i) => {
		const { rowKey, colKey } = panelGroupKeys(panelData, k, i)
		const rs = panelData.rowsByValue.get(k) ?? []
		const colRows = colRowsByColKey.get(colKey)
		if (colRows) colRows.push(...rs)
		else colRowsByColKey.set(colKey, [...rs])
		const rowRows = rowRowsByRowKey.get(rowKey)
		if (rowRows) rowRows.push(...rs)
		else rowRowsByRowKey.set(rowKey, [...rs])
	})
	return { colRowsByColKey, rowRowsByRowKey }
}

/** Per-panel measure-axis max for bar / area charts. Used to compute a
 *  shared measure-axis bound that's the MAX OF PANEL-LOCAL MAXES across
 *  the share group — NOT the max of the pooled aggregation. Pooling
 *  rows first then aggregating sums same-category values across panels
 *  (e.g. a "2024" stack in panel A + a "2024" stack in panel B become
 *  one bigger stack), which user-reported as the shared y-axis going
 *  ~10× higher than any individual panel's max. The fix is to aggregate
 *  each panel individually then max the maxes.
 *
 *  Aesthetic groups (hue / saturation / etc.) aren't consulted here: under
 *  the default stack mode, the per-category sum is unaffected by how
 *  values split across groups, so the shared axis bound is correct. Under
 *  group / overlay, computing without groups gives an UPPER bound (the
 *  category sum is ≥ any single group's value), which is safe — axis
 *  has extra headroom but never clips.
 *
 *  Leaf-aware: bars are grouped side-by-side on the category axis by the
 *  `group`-mode channels and stacked on the measure axis by the `stack`-mode
 *  channels, so the bound is the max over (category × group-mode-leaf) of the
 *  stacked total within that leaf (or the max single row when no channel
 *  stacks). Mirrors BarPlot's `computeBarMeasureMax` on raw rows. */
export const computePanelMeasureMax = (
	rows: ReadonlyArray<Record<string, unknown>>,
	categoryField: string | null,
	measureField: string | null,
	modes: StackModeEntry[],
	groupModeFields: string[]
): number => {
	if (!rows.length || !categoryField || !measureField) return 1
	const hasStack = modes.some((m) => m.mode === "stack")
	// Unit separator (U+001F) prevents leaf-key collisions across value
	// boundaries — consistent with BarPlot's leafKey and the aggregator.
	const SEP = "\u001F"
	const perLeaf = new Map<string, number>()
	for (const r of rows) {
		const cv = r[categoryField]
		if (cv == null) continue
		const raw = r[measureField]
		const n = typeof raw === "number" ? raw : Number(raw)
		if (!Number.isFinite(n)) continue
		const leaf =
			String(cv) + SEP + groupModeFields.map((f) => String(r[f] ?? "")).join(SEP)
		const prev = perLeaf.get(leaf)
		perLeaf.set(leaf, hasStack ? (prev ?? 0) + n : Math.max(prev ?? 0, n))
	}
	if (perLeaf.size === 0) return 1
	return Math.max(1, ...perLeaf.values())
}

/** Whether an annotation is drawn on the panel with the given key.
 *  `facetKeys` null/undefined ⇒ all facets (legacy default); an array
 *  restricts to listed keys. The `"__all__"` panel is the non-faceted
 *  chart's single panel — always show there so scoping set on a previously
 *  faceted chart doesn't make annotations vanish after faceting is removed. */
const annotationOnPanel = (
	a: { facetKeys?: string[] | null },
	panelKey: string,
): boolean =>
	a.facetKeys == null ||
	panelKey === "__all__" ||
	a.facetKeys.includes(panelKey)

export const PlotCanvas = () => {
	const [ref, bounds] = useMeasure()
	const dataset = useCurrentDatasetView()
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const dataLabels = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...useAtomValue(currentDataLabelsConfigAtom),
	}
	const dataLabelsEncodings = useAtomValue(currentDataLabelsEncodingsAtom)
	const annotations = useAtomValue(currentAnnotationsAtom)
	const caption: CaptionConfig = {
		...DEFAULT_CAPTION_CONFIG,
		...useAtomValue(currentCaptionConfigAtom),
	}
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const setRenderedPanelDims = useSetAtom(
		currentRenderedPanelInnerDimsAtom,
	)
	const setFigureSlack = useSetAtom(currentRenderedFigureSlackAtom)
	const setRenderedCaptionBox = useSetAtom(currentRenderedCaptionBoxAtom)
	// Estimate the data-label overflow on every edge. A label rendered
	// at an outermost data point may extend past the plot's natural
	// margins depending on alignment + offset + size encoding. We
	// reserve extra room in the canvas so labels stay in view. The 0.55
	// px/char heuristic matches the legend's longest-label estimate;
	// cap at 200px so a pathological dataset doesn't blow out the plot.
	const dataLabelOverflow = useMemo(() => {
		const empty = { left: 0, right: 0 }
		if (!dataset) return empty
		// Data labels have their own encoding atom; the rendered text comes
		// from that `value` mapping. Fall back to the chart's measure encoding
		// when the data-labels value isn't explicitly mapped (mirrors
		// DataLabelsLayer's fallback).
		// Rebuild the pieces `buildLabelText` needs from primitive fields so the
		// memo depends on those (stable) primitives, not the freshly-spread
		// `dataLabels` object (new every render → would defeat memoization).
		const value = {
			field: dataLabelsEncodings.value?.field ?? null,
			multiField: dataLabelsEncodings.value?.multiField,
			fields: dataLabelsEncodings.value?.fields,
		}
		const fallbackField =
			encodings.length?.field ?? encodings.y?.field ?? null
		const isMulti =
			value.multiField === true && (value.fields?.length ?? 0) > 0
		if (!isMulti && !(value.field ?? fallbackField)) return empty
		// Endpoint labels (`labelPoints: "first-last"`) can carry their own
		// template / offset / alignment — that's the only mode where the
		// override blocks apply (single first / last modes use the base
		// profile directly, mirroring the renderer). The reserve must cover
		// whichever labels actually render: the last label is exactly the
		// one that clips off the right edge, so its (often wider) template
		// drives the right-side reserve.
		const labelPointsMode = effectiveLabelPoints({
			labelPoints: dataLabels.labelPoints,
			onlyLastLabel: dataLabels.onlyLastLabel,
		})
		type ReserveProfile = {
			template: string | undefined
			xOffset: number
			alignment: "left" | "center" | "right"
		}
		const baseProfile: ReserveProfile = {
			template: dataLabels.labelTemplate,
			xOffset: dataLabels.xOffset ?? 0,
			alignment: dataLabels.alignment ?? "center",
		}
		const withOverrides = (ov?: EndpointLabelOverrides): ReserveProfile => ({
			// Endpoint templates only apply in multi-field mode (row path);
			// empty string means "inherit".
			template:
				isMulti && ov?.labelTemplate ? ov.labelTemplate : baseProfile.template,
			xOffset: ov?.xOffset ?? baseProfile.xOffset,
			alignment: ov?.alignment ?? baseProfile.alignment,
		})
		const profiles: ReserveProfile[] =
			labelPointsMode === "first-last"
				? [
						withOverrides(dataLabels.firstLabel),
						withOverrides(dataLabels.lastLabel),
					]
				: [baseProfile]
		// Longest RENDERED label across all rows per distinct template,
		// composed identically to the layer via `buildLabelText`. In
		// multi-field mode that's the full template output (wider than any
		// single field), so the reserved margin tracks what actually draws —
		// otherwise the combined label clips off the right, the very bug the
		// measure-based reserve fixes.
		const longestByTemplate = new Map<string | undefined, string>()
		for (const p of profiles) {
			if (longestByTemplate.has(p.template)) continue
			const labelCfg = {
				decimals: dataLabels.decimals,
				labelTemplate: p.template,
				fieldFormats: dataLabels.fieldFormats,
			}
			let longestStr = ""
			for (const row of dataset.rows) {
				const text = buildLabelText(row, value, labelCfg, fallbackField)
				if (text && text.length > longestStr.length) longestStr = text
			}
			longestByTemplate.set(p.template, longestStr)
		}
		// When the user maps the `size` channel on data labels, each
		// label's rendered font size lerps into `[sizeMin, sizeMax]`.
		// The label width estimate has to use the LARGEST possible size
		// (sizeMax) so the canvas reserves enough room for the biggest
		// label, not just the default font-size case.
		const sizeMapped = !!dataLabelsEncodings.size?.field
		const fontSizeForEstimate = sizeMapped
			? Math.max(dataLabels.fontSize, dataLabels.sizeMax ?? dataLabels.fontSize)
			: dataLabels.fontSize
		// Cap the reserve so a pathological label doesn't collapse the plot,
		// but keep it generous enough for long series names (e.g. a full
		// category label on the last point of a line) — 200px clipped those.
		const cap = (n: number) => Math.max(0, Math.min(400, Math.ceil(n)))
		let right = 0
		let left = 0
		for (const p of profiles) {
			const longestStr = longestByTemplate.get(p.template) ?? ""
			if (longestStr === "") continue
			// Measure the actual rendered width of the longest label with the
			// data-label font (family + weight + style) via canvas measureText,
			// mirroring the axis-tick fix (see measureMaxLabelWidth). The old
			// `chars * fontSize * 0.55` heuristic ignored font family/weight and
			// under-reserved for wide/bold faces, so end-of-line series labels
			// (a category name on the last point of a line) clipped off the right
			// edge. Fall back to the heuristic when canvas isn't available (SSR /
			// non-DOM env), where measureMaxLabelWidth returns 0.
			const measured = measureMaxLabelWidth(
				[longestStr],
				dataLabels.fontFamily,
				fontSizeForEstimate,
				dataLabels.fontWeight,
				dataLabels.italic,
			)
			const labelPx =
				measured > 0 ? measured : longestStr.length * fontSizeForEstimate * 0.55
			// Fraction of label width that lands to each side of the anchor:
			//   left  align → full width to the RIGHT, none to the left
			//   center      → half each way
			//   right align → none to the right, full width to the LEFT
			const rightFraction =
				p.alignment === "left" ? 1 : p.alignment === "center" ? 0.5 : 0
			const leftFraction =
				p.alignment === "right" ? 1 : p.alignment === "center" ? 0.5 : 0
			// Subtract BASE_MARGIN on each side — the chart already reserves
			// space there; only excess past the natural margin counts.
			right = Math.max(
				right,
				cap(p.xOffset + labelPx * rightFraction - BASE_MARGIN.right)
			)
			left = Math.max(
				left,
				cap(-p.xOffset + labelPx * leftFraction - BASE_MARGIN.left)
			)
		}
		return { left, right }
	}, [
		dataset,
		dataLabels.alignment,
		dataLabels.xOffset,
		dataLabels.fontSize,
		dataLabels.fontFamily,
		dataLabels.fontWeight,
		dataLabels.italic,
		dataLabels.sizeMax,
		dataLabels.decimals,
		dataLabels.labelTemplate,
		dataLabels.fieldFormats,
		// Endpoint-mode primitives + override blocks. The blocks are stable
		// references (module default `{}` or the atom's stored object), so
		// they're safe memo deps — unlike the freshly-spread `dataLabels`.
		dataLabels.labelPoints,
		dataLabels.onlyLastLabel,
		dataLabels.firstLabel,
		dataLabels.lastLabel,
		dataLabelsEncodings.value?.field,
		dataLabelsEncodings.value?.multiField,
		dataLabelsEncodings.value?.fields,
		dataLabelsEncodings.size?.field,
		encodings.length?.field,
		encodings.y?.field,
	])

	const titleFont = resolveTitleFont(
		labels.baseFont,
		"primary",
		labels.fontOverrides?.title
	)
	const subtitleFont = resolveTitleFont(
		labels.baseFont,
		"subtitle",
		labels.fontOverrides?.subtitle
	)
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
	// Facet titles share the "secondary" title tier with the axis titles, so
	// by default they match — but they carry their own override slot so users
	// can style them independently (family / color / size / B-I-U / offset).
	const facetTitleFont = resolveTitleFont(
		labels.baseFont,
		"secondary",
		labels.fontOverrides?.facetTitle
	)
	const facetTitleOffset = {
		x: labels.titleOffsets?.facetTitle?.x ?? 0,
		y: labels.titleOffsets?.facetTitle?.y ?? 0,
	}
	const facetTitleAlign: LabelAlignment =
		(labels.titleAlignments?.facetTitle as LabelAlignment) ?? "center"
	// When BOTH facetCol and facetRow are mapped, the grid's top (column) and
	// left (row) header strips can be styled independently. Each per-strip slot
	// layers on top of the shared `facetTitle` styling. When only one facet axis
	// is mapped (or wrap mode), there's a single strip styled by the unified
	// `facetTitle` — any leftover per-strip override from a previous both-mapped
	// state is intentionally ignored, so the lone strip never surprises the user.
	const facetGridSplit =
		Boolean(encodings.facetCol?.field) && Boolean(encodings.facetRow?.field)
	const facetColTitleFont = facetGridSplit
		? resolveTitleFont(
				labels.baseFont,
				"secondary",
				layerFacetOverride(
					labels.fontOverrides?.facetTitle,
					labels.fontOverrides?.facetColTitle
				)
			)
		: facetTitleFont
	const facetRowTitleFont = facetGridSplit
		? resolveTitleFont(
				labels.baseFont,
				"secondary",
				layerFacetOverride(
					labels.fontOverrides?.facetTitle,
					labels.fontOverrides?.facetRowTitle
				)
			)
		: facetTitleFont
	const facetColTitleAlign: LabelAlignment = facetGridSplit
		? ((labels.titleAlignments?.facetColTitle ??
				labels.titleAlignments?.facetTitle ??
				"center") as LabelAlignment)
		: facetTitleAlign
	const facetRowTitleAlign: LabelAlignment = facetGridSplit
		? ((labels.titleAlignments?.facetRowTitle ??
				labels.titleAlignments?.facetTitle ??
				"center") as LabelAlignment)
		: facetTitleAlign
	// Vertical placement of the row-title within each row's own plot rect (rows
	// can differ in height). Mirrors the horizontal-align resolution: in a
	// both-axes grid the `facetRowTitle` slot layers over `facetTitle`; in a
	// row-only facet the lone strip is styled by `facetTitle` directly. Any
	// leftover `facetRowTitle` value from a previous both-mapped state is
	// intentionally ignored in the non-split case so the lone strip never
	// surprises the user. Defaults to the legacy centered behavior.
	const facetTitleVAlign: VerticalAlignment =
		labels.titleVerticalAlignments?.facetTitle ?? "middle"
	const facetRowTitleVAlign: VerticalAlignment = facetGridSplit
		? (labels.titleVerticalAlignments?.facetRowTitle ??
			labels.titleVerticalAlignments?.facetTitle ??
			"middle")
		: facetTitleVAlign
	const facetColTitleOffset = facetGridSplit
		? {
				x:
					labels.titleOffsets?.facetColTitle?.x ??
					labels.titleOffsets?.facetTitle?.x ??
					0,
				y:
					labels.titleOffsets?.facetColTitle?.y ??
					labels.titleOffsets?.facetTitle?.y ??
					0,
			}
		: facetTitleOffset
	const facetRowTitleOffset = facetGridSplit
		? {
				x:
					labels.titleOffsets?.facetRowTitle?.x ??
					labels.titleOffsets?.facetTitle?.x ??
					0,
				y:
					labels.titleOffsets?.facetRowTitle?.y ??
					labels.titleOffsets?.facetTitle?.y ??
					0,
			}
		: facetTitleOffset
	// Hide-empty compaction's per-panel title bands (grid mode only — both
	// facet axes mapped) get their own style slot, layered over `facetTitle`
	// exactly like the per-strip slots above. Wrap-mode per-panel titles keep
	// `facetTitle` directly (the non-split fallback keeps them byte-identical).
	const facetPanelTitleFont = facetGridSplit
		? resolveTitleFont(
				labels.baseFont,
				"secondary",
				layerFacetOverride(
					labels.fontOverrides?.facetTitle,
					labels.fontOverrides?.facetPanelTitle
				)
			)
		: facetTitleFont
	const facetPanelTitleAlign: LabelAlignment = facetGridSplit
		? ((labels.titleAlignments?.facetPanelTitle ??
				labels.titleAlignments?.facetTitle ??
				"center") as LabelAlignment)
		: facetTitleAlign
	const facetPanelTitleOffset = facetGridSplit
		? {
				x:
					labels.titleOffsets?.facetPanelTitle?.x ??
					labels.titleOffsets?.facetTitle?.x ??
					0,
				y:
					labels.titleOffsets?.facetPanelTitle?.y ??
					labels.titleOffsets?.facetTitle?.y ??
					0,
			}
		: facetTitleOffset
	const tickFont = resolveTextFont(labels.baseFont)

	const bgStyle: React.CSSProperties | undefined = channelConfigs.backgroundColor
		? { backgroundColor: channelConfigs.backgroundColor }
		: undefined

	const facetField = encodings.facet?.field ?? null
	// "Faceted" means any multi-panel mode: wrap (`facet`), or grid
	// (`facetRow` and/or `facetCol`). Downstream, this gates the shared
	// title rendering, panel size overrides, and share-axes behavior —
	// all of which apply equally to wrap and grid modes. The wrap-only
	// path inside `panelData` still keys off `facetField` directly, so
	// broadening `isFaceted` doesn't change panel partitioning.
	const isFaceted =
		(!!facetField ||
			!!encodings.facetRow?.field ||
			!!encodings.facetCol?.field) &&
		!!dataset

	const facetCfg: FacetConfig = useMemo(
		() => ({ ...DEFAULT_FACET_CONFIG, ...channelConfigs.facet }),
		[channelConfigs.facet]
	)

	// ─── Resolve panel partition ─────────────────────────────────────────
	// Shared with the annotations sidebar (`resolveFacetPanels`) so the panel
	// KEYS the user scopes an annotation to match the keys we render against.
	const panelData = useMemo(
		() => resolveFacetPanels(dataset, encodings, levelOrders, overrides, facetCfg),
		[
			dataset,
			encodings,
			levelOrders,
			overrides,
			facetCfg,
		],
	)

	// ─── Resolve mode + Renderer ──────────────────────────────────────────
	const getType = (fieldName: string) =>
		dataset ? effectiveType(dataset, fieldName, overrides) : undefined
	const mode = useMemo(
		() => getChartModeDef(encodings, getType, channelConfigs, mapConfig),
		// dataset/overrides change rarely; recomputing on every render is fine
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[encodings, dataset, overrides, channelConfigs.x?.histogram, channelConfigs.y?.histogram, mapConfig]
	)
	// Narrow the registry's `string` id back to the ChartMode union for use
	// with helpers that take a typed mode (axisFieldsFor, hasXAxis, etc.).
	const modeId = mode.id as ChartMode
	// Polar chart family — radar / pie variants. Drives the solver's
	// per-cell chrome reduction (POLAR_MARGIN vs BASE_MARGIN) and the
	// share-mode migration that maps angle/r tri-states to x/y.
	const isPolar = mode.canvas.coordFamily === "polar"

	// Resolve which encoding field drives each AXIS for the current mode.
	// `null` means that axis doesn't exist in this mode (e.g. y in pies-x)
	// OR that the relevant encoding isn't mapped. The value-mode annotation
	// conversion below consults these to look up the right scale; the
	// shared axis-title fallback below uses them to populate the title with
	// the bound field name when the user hasn't typed one.
	const axisFields: {
		xField: string | null
		yField: string | null
		xType: FieldType | null
		yType: FieldType | null
	} = useMemo(() => {
		const { xField, yField } = axisFieldsFor(modeId, encodings)
		const xType: FieldType | null =
			xField && dataset ? effectiveType(dataset, xField, overrides) : null
		const yType: FieldType | null =
			yField && dataset ? effectiveType(dataset, yField, overrides) : null
		return { xField, yField, xType, yType }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [modeId, encodings.x?.field, encodings.y?.field, encodings.length?.field, dataset, overrides])

	// ─── Resolve shared axis-title text (mode-dependent fallback) ─────────
	//
	// Per chart mode, ONE axis is the "real" axis (gets a title) and the
	// other may not be drawn at all — `hasXAxis/hasYAxis` suppresses the
	// title for the missing axis so a stale `labels.xAxisTitle` left over
	// from a prior chart configuration doesn't surface on an axis the new
	// mode never draws.
	// Three-state title: `undefined` = not customized → field-name fallback,
	// `""` = user cleared it → draw no title (so the `!== undefined` check,
	// not a truthiness check, gates the custom/blank branch).
	const sharedXAxisTitle = (() => {
		if (!hasXAxis(modeId)) return ""
		if (labels.xAxisTitle !== undefined) return labels.xAxisTitle
		if (!isFaceted) return ""
		return axisFields.xField ?? ""
	})()
	const sharedYAxisTitle = (() => {
		if (!hasYAxis(modeId)) return ""
		if (labels.yAxisTitle !== undefined) return labels.yAxisTitle
		if (!isFaceted) return ""
		return axisFields.yField ?? ""
	})()

	// ─── Per-panel label sample for solver margin estimation ──────────────
	const panelInputs = useMemo<SolverPanelInput[]>(() => {
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
			const xTickSize = channelConfigs.x?.tickLabelFont?.size ?? tickFont.size
			const yTickSize = channelConfigs.y?.tickLabelFont?.size ?? tickFont.size
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
	}, [
		dataset,
		encodings,
		isFaceted,
		overrides,
		panelData,
		// React Compiler infers the whole `channelConfigs.x` / `.y` objects as
		// the dependency (the memo body reads several sub-properties of each),
		// so we depend on the parent objects rather than the individual
		// tick-label fields. Listing the fine-grained optional-chain paths
		// instead makes the compiler bail out ("inferred less specific property
		// than source") — depending on the parent satisfies exhaustive-deps and
		// keeps the compiler's memoization intact.
		channelConfigs.x,
		channelConfigs.y,
		tickFont.size,
		tickFont.family,
		tickFont.weight,
		tickFont.italic,
		facetCfg.proportionalSizing,
		facetCfg.proportionalSizingByUnit,
		facetCfg.proportionalSizingX,
		facetCfg.proportionalSizingY,
		facetCfg.shareX,
		facetCfg.shareY,
		facetCfg.shareAxes,
		// Override maps drive the effective-range weight computation, so
		// the panelInputs memo must recompute when they change — otherwise
		// updating per-panel / per-row / overall ranges doesn't reflow
		// the proportional row/col sizing.
		facetCfg.panelAxisOverrides,
		facetCfg.rowAxisOverrides,
		facetCfg.colAxisOverrides,
		facetCfg.overallYRange,
		facetCfg.overallXRange,
		bounds.width,
	])

	// ─── Build SolverInput + call solver ──────────────────────────────────
	// Measure the caption box against the container so the solver can reserve a
	// matching band at the bottom of the canvas. Width/height are independent of
	// that vertical reserve (a bottom reserve doesn't change canvas width, and
	// the canvas matches the container when it fits), so there's no circular
	// dependency — the post-solve box re-measures against the final canvas and
	// lands at the same size.
	const captionReserve = captionReservePx(
		measureCaptionBox(caption, bounds.width || 0, bounds.height || 0),
	)

	const spec: FacetLayoutSpec = useMemo(() => {
		// Recompute share modes and per-axis sizing flags at this scope
		// (panelInputs scopes them privately). We need them to gate the
		// panelWidth / panelHeight overrides — when proportional sizing
		// is actively driving a dimension, the explicit dim must be
		// ignored at render time even if the cfg still carries a stale
		// value (loaded saved visual, sidebar collapsed, etc.).
		const shareXModeSpec: "none" | "perGroup" | "all" = isFaceted
			? migrateShareValue(facetCfg.shareX, facetCfg.shareAxes)
			: "none"
		const shareYModeSpec: "none" | "perGroup" | "all" = isFaceted
			? migrateShareValue(facetCfg.shareY, facetCfg.shareAxes)
			: "none"
		const sizeXSpec = migrateProportionalSizing(
			facetCfg.proportionalSizingX,
			facetCfg.proportionalSizing,
			facetCfg.proportionalSizingByUnit,
		)
		const sizeYSpec = migrateProportionalSizing(
			facetCfg.proportionalSizingY,
			facetCfg.proportionalSizing,
			facetCfg.proportionalSizingByUnit,
		)
		// Same "unambiguous strip" gate the panelInputs memo uses for
		// weight calculation — share mode that makes a per-strip weight
		// well-defined is the same condition under which the sizing
		// should win over an explicit panel dim.
		// Mirror FacetOptionsPanel's showRowSizing / showColSizing exactly
		// (shared helpers — see their doc): sizing only wins over an explicit
		// panel dim in the grid/share shapes where it produces meaningful
		// (non-uniform-capable) weights. The previous broader condition also
		// claimed shareY="all" (where sizing is a hidden no-op), silently
		// swallowing the pixel value the UI had offered an input for.
		const isProportionalXActive =
			colSizingMeaningful(
				panelData.grid.rows,
				panelData.grid.cols,
				shareXModeSpec,
			) && sizeXSpec !== "off"
		const isProportionalYActive =
			rowSizingMeaningful(
				panelData.grid.rows,
				panelData.grid.cols,
				shareYModeSpec,
			) && sizeYSpec !== "off"
		// Aesthetics → Fix aspect ratio. Unlike the pixel panel overrides
		// (facet-only), this applies to single-panel charts too — that's
		// its headline use (square hexbin plots).
		const aspectCfg = channelConfigs.aspectRatio
		const aspectRatio =
			aspectCfg?.enabled && aspectCfg.length > 0 && aspectCfg.width > 0
				? aspectCfg.length / aspectCfg.width
				: null
		// Per-panel facet-title band. Wrap mode always uses it; grid mode
		// only under hide-empty compaction, where the compacted dimension's
		// values move out of their strip into these per-panel bands.
		const facetLabelInput = {
			fontSize: facetTitleFont.size,
			// Grow the band so a larger user-chosen font doesn't
			// clip into the panel; small fonts keep the pinned
			// default that defeats font-metric drift.
			height: Math.max(
				isPolar ? FACET_LABEL_HEIGHT_PX_POLAR : FACET_LABEL_HEIGHT_PX,
				Math.ceil(facetTitleFont.size * 1.4)
			),
			align:
				(labels.titleAlignments?.facetTitle as LabelAlignment) ?? "center",
		}
		// Compacted-grid variant of the band above: same shape, but styled by
		// the `facetPanelTitle` slot (layered over `facetTitle`), so compact
		// per-panel titles can diverge from the wrap-mode / strip styling.
		const facetPanelLabelInput = {
			fontSize: facetPanelTitleFont.size,
			height: Math.max(
				isPolar ? FACET_LABEL_HEIGHT_PX_POLAR : FACET_LABEL_HEIGHT_PX,
				Math.ceil(facetPanelTitleFont.size * 1.4)
			),
			align: facetPanelTitleAlign,
		}
		// Hide-empty compaction: which header strips SURVIVE. Undefined
		// compactStrip (grid without compaction, or non-grid modes) keeps
		// both; strip "none" suppresses both. The strip inputs below still
		// gate on mode + channel mapping — these booleans only encode the
		// compaction veto, shared so rowHeaders and rowHeaderWidth can't
		// drift apart.
		const compactStrip =
			panelData.mode === "grid" ? panelData.compact?.strip : undefined
		const colStripSurvives =
			compactStrip === undefined || compactStrip === "cols"
		const rowStripSurvives =
			compactStrip === undefined || compactStrip === "rows"
		const input: SolverInput = {
			containerWidth: bounds.width,
			containerHeight: bounds.height,
			rows: panelData.grid.rows,
			cols: panelData.grid.cols,
			panels: panelInputs,
			chartTitle: labels.title
				? {
						text: labels.title,
						fontSize: titleFont.size,
						align: (labels.titleAlignments?.title as LabelAlignment) ?? "center",
						offsetX: labels.titleOffsets?.title?.x ?? 0,
						offsetY: labels.titleOffsets?.title?.y ?? 0,
					}
				: undefined,
			chartSubtitle: labels.subtitle
				? {
						text: labels.subtitle,
						fontSize: subtitleFont.size,
						align:
							(labels.titleAlignments?.subtitle as LabelAlignment) ?? "center",
						offsetX: labels.titleOffsets?.subtitle?.x ?? 0,
						offsetY: labels.titleOffsets?.subtitle?.y ?? 0,
					}
				: undefined,
			xTitle: sharedXAxisTitle
				? {
						text: sharedXAxisTitle,
						fontSize: xAxisTitleFont.size,
						align:
							(labels.titleAlignments?.xAxisTitle as LabelAlignment) ?? "center",
						offsetX: labels.titleOffsets?.xAxisTitle?.x ?? 0,
						offsetY: labels.titleOffsets?.xAxisTitle?.y ?? 0,
					}
				: undefined,
			yTitle: sharedYAxisTitle
				? {
						text: sharedYAxisTitle,
						fontSize: yAxisTitleFont.size,
						align:
							(labels.titleAlignments?.yAxisTitle as LabelAlignment) ?? "center",
						horizontal: labels.yAxisTitleHorizontal === true,
						offsetX: labels.titleOffsets?.yAxisTitle?.x ?? 0,
						offsetY: labels.titleOffsets?.yAxisTitle?.y ?? 0,
					}
				: undefined,
			facetLabel:
				panelData.mode === "grid"
					? panelData.compact !== undefined
						? facetPanelLabelInput
						: undefined
					: isFaceted
						? facetLabelInput
						: undefined,
			// Grid-style modes: column and row header strips replace
			// per-panel facet labels (except under hide-empty compaction,
			// which combines one surviving strip with per-panel labels —
			// see below). A strip is only emitted when the
			// CORRESPONDING channel is actually mapped — the row-only
			// sub-case has a placeholder `["__all__"]` colValues that must
			// NOT surface as a column-header strip, and vice versa for
			// col-only. The corner intersection (top-left) is dead space —
			// strips don't span it.
			// Hide-empty compaction gate: only the SURVIVING strip renders —
			// the compacted dimension's values move into per-panel title
			// bands, so its strip must neither draw nor reserve space
			// (strip "none" suppresses both).
			columnHeaders:
				panelData.mode === "grid" &&
				Boolean(encodings.facetCol?.field) &&
				colStripSurvives
					? panelData.colValues.map((v) => ({
							text: v,
							fontSize: facetColTitleFont.size,
							align: facetColTitleAlign,
							offsetX: facetColTitleOffset.x,
							offsetY: facetColTitleOffset.y,
						}))
					: undefined,
			rowHeaders:
				panelData.mode === "grid" &&
				Boolean(encodings.facetRow?.field) &&
				rowStripSurvives
					? panelData.rowValues.map((v) => ({
							text: v,
							fontSize: facetRowTitleFont.size,
							align: facetRowTitleAlign,
							verticalAlign: facetRowTitleVAlign,
							offsetX: facetRowTitleOffset.x,
							offsetY: facetRowTitleOffset.y,
						}))
					: undefined,
			// Grow the strip bands so a larger user-chosen facet-title font
			// doesn't clip; small fonts keep the pinned defaults.
			columnHeaderHeight: Math.max(20, Math.ceil(facetColTitleFont.size * 1.4)),
			// Row-header labels render centered in a left band. A fixed band
			// clipped long facet values ("Garbanzo Bean") past the canvas's
			// left edge. Measure the widest label at the facet-title font and
			// grow the band to fit it (+24px breathing room, split as padding
			// on each side), with the 80px default as a floor so short labels
			// keep their current spacing. Mirrors the y-axis-label measurement
			// at `measureMaxLabelWidth` above.
			// Same gate as rowHeaders: a compaction-suppressed left strip
			// must not reserve width.
			rowHeaderWidth:
				panelData.mode === "grid" &&
				Boolean(encodings.facetRow?.field) &&
				rowStripSurvives
					? Math.max(
							80,
							Math.ceil(
								measureMaxLabelWidth(
									panelData.rowValues,
									facetRowTitleFont.family,
									facetRowTitleFont.size,
								),
							) + 24,
						)
					: 80,
			gapX: facetCfg.gapX,
			gapY: facetCfg.gapY,
			// Pixel-precise panel-size overrides. Only honored when
			// faceted (single-panel doesn't need them — the lone panel
			// just fills the canvas). Null / undefined / 0 = auto.
			//
			// Hard invariant: when proportional sizing is actively driving
			// row/col distribution along an axis, the explicit dim on that
			// axis is ignored — even if stored. The sidebar effect that
			// clears stale dims only fires when the wrap panel is mounted
			// (Disclosure-collapsed → unmounted in Headless UI), so the
			// runtime is the only reliable enforcement point for
			// loaded-visual + sidebar-closed cases.
			panelWidthOverride:
				isFaceted && !isProportionalXActive
					? facetCfg.panelWidth ?? null
					: null,
			panelHeightOverride:
				isFaceted && !isProportionalYActive
					? facetCfg.panelHeight ?? null
					: null,
			aspectRatio,
			// The solver's shareX/shareY booleans suppress interior axis
			// ticks (x: all but each column's bottom-most panel; y: all but
			// each row's leftmost panel). That's only safe when the hidden
			// axes are truly redundant. Under hide-empty compaction a layout
			// row (compact-cols) or column (compact-rows) can mix panels
			// from DIFFERENT share groups, so with "perGroup" the visible
			// edge axis may show another group's domain — every panel must
			// keep its own ticks. Suppress only when the scale is global
			// ("all") or the dimension's layout tracks still coincide with
			// facet values (its strip survives). The *StripSurvives booleans
			// are true whenever compaction is off (incl. wrap mode), so
			// non-compact behavior is unchanged. (shareXModeSpec /
			// shareYModeSpec already fold in the isFaceted gate — they're
			// "none" for single-panel charts.)
			shareX:
				shareXModeSpec !== "none" &&
				(shareXModeSpec === "all" || colStripSurvives),
			shareY:
				shareYModeSpec !== "none" &&
				(shareYModeSpec === "all" || rowStripSurvives),
			// Any per-axis sizing mode other than "off" activates the
			// solver's proportional path; the weight value (assigned per
			// panel above) determines what each panel scales by — category
			// count vs. data range — independently per axis.
			proportionalSizing: isFaceted
				? migrateProportionalSizing(
						facetCfg.proportionalSizingX,
						facetCfg.proportionalSizing,
						facetCfg.proportionalSizingByUnit,
					) !== "off" ||
					migrateProportionalSizing(
						facetCfg.proportionalSizingY,
						facetCfg.proportionalSizing,
						facetCfg.proportionalSizingByUnit,
					) !== "off"
				: false,
			// Global scrollMode (from AestheticsPanel). Default "fit" →
			// canvas matches container, panels/categories shrink to fit, no
			// scrollbar. "scroll" → preserve 200px minimum per panel AND
			// 20px per categorical tick, scrollbar appears when needed.
			// Applies to BOTH faceted and single-panel charts: a non-faceted
			// chart with 50 categories on its y-axis can also overflow.
			minPanelPx: (channelConfigs.scrollMode ?? "fit") === "scroll" ? 200 : 0,
			extraRightMargin: dataLabelOverflow.right,
			extraLeftMargin: dataLabelOverflow.left,
			extraBottomMargin: captionReserve,
			isPolar,
		}
		return solveFacetLayout(input)
		// eslint-disable-next-line react-hooks/exhaustive-deps -- facet title aligns/offsets and facetRow/Col fields are pure derivations of labels.titleAlignments / labels.titleOffsets / encodings via panelData, which are already deps, so they can never go stale
	}, [
		bounds.width,
		bounds.height,
		panelData,
		panelInputs,
		labels.title,
		labels.subtitle,
		labels.titleAlignments,
		labels.titleOffsets,
		labels.yAxisTitleHorizontal,
		titleFont.size,
		subtitleFont.size,
		xAxisTitleFont.size,
		yAxisTitleFont.size,
		facetTitleFont.size,
		facetTitleFont.family,
		facetColTitleFont.size,
		facetColTitleFont.family,
		facetRowTitleFont.size,
		facetRowTitleFont.family,
		facetPanelTitleFont.size,
		facetPanelTitleFont.family,
		sharedXAxisTitle,
		sharedYAxisTitle,
		isFaceted,
		facetCfg.gapX,
		facetCfg.gapY,
		facetCfg.panelWidth,
		facetCfg.panelHeight,
		facetCfg.shareX,
		facetCfg.shareY,
		facetCfg.shareAxes,
		facetCfg.proportionalSizing,
		facetCfg.proportionalSizingByUnit,
		facetCfg.proportionalSizingX,
		facetCfg.proportionalSizingY,
		channelConfigs.scrollMode,
		channelConfigs.aspectRatio,
		dataLabelOverflow,
		captionReserve,
		isPolar,
	])

	// Publish the first panel's inner dimensions so the Facet sidebar's
	// Panel width / Panel height inputs can step UP/DOWN from the current
	// auto-computed value instead of jumping to 0 on the first arrow press.
	// All panels share the same inner width within a column (and height
	// within a row), so the first panel's dims are representative for the
	// "currently displayed" auto value.
	useEffect(() => {
		// Publish the aspect-ratio slack on EVERY pass — including the
		// no-panels early return below — so ChartCanvas's legend pull always
		// tracks the latest solve ({0,0} whenever the ratio is off). Bail
		// out (returning `prev` keeps the reference, so Jotai skips the
		// notify) when the values are unchanged: ChartCanvas — PlotCanvas's
		// ANCESTOR — subscribes to this atom, so publishing a fresh object
		// per pass would re-render it and loop back here forever.
		setFigureSlack((prev) =>
			prev.x === spec.figureSlack.x && prev.y === spec.figureSlack.y
				? prev
				: spec.figureSlack,
		)
		const p = spec.panels[0]
		if (!p) {
			setRenderedPanelDims(null)
			return
		}
		setRenderedPanelDims({
			widthPx: Math.round(p.inner.width),
			heightPx: Math.round(p.inner.height),
		})
	}, [spec, setRenderedPanelDims, setFigureSlack])

	// Re-measure the caption against the final canvas and publish its rendered
	// box dims so the Caption panel's Width / Height inputs can step UP/DOWN from
	// the current size (converting to percent when selected) on first arrow press.
	const captionBox = measureCaptionBox(
		caption,
		spec.canvas.width,
		spec.canvas.height,
	)
	const captionBoxW = captionBox ? Math.round(captionBox.width) : 0
	const captionBoxH = captionBox ? Math.round(captionBox.height) : 0
	const captionCanvasW = Math.round(spec.canvas.width)
	const captionCanvasH = Math.round(spec.canvas.height)
	useEffect(() => {
		if (captionBoxW <= 0 || captionBoxH <= 0) {
			setRenderedCaptionBox(null)
			return
		}
		setRenderedCaptionBox({
			widthPx: captionBoxW,
			heightPx: captionBoxH,
			canvasWidth: captionCanvasW,
			canvasHeight: captionCanvasH,
		})
	}, [
		captionBoxW,
		captionBoxH,
		captionCanvasW,
		captionCanvasH,
		setRenderedCaptionBox,
	])

	if (!dataset) {
		return (
			<div
				ref={ref}
				className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-stone-600 dark:text-stone-400"
				style={bgStyle}
			>
				<div className="text-sm">No data set loaded.</div>
				<div className="text-sm">Upload a CSV from the sidebar to get started.</div>
			</div>
		)
	}

	const Renderer = MODE_RENDERERS[modeId]

	// ─── Tri-state share-axis: resolve modes + per-group row sources ──────
	//
	// shareXMode / shareYMode are the migrated tri-state ("none" / "perGroup"
	// / "all"); colRowsByColKey / rowRowsByRowKey are the per-column /
	// per-row row unions used under "perGroup", keyed by share-group key
	// (facet value in grid mode — see panelGroupKeys). Computed once for the
	// whole render so every panel below picks its scale source via the same
	// logic.
	const shareXMode: "none" | "perGroup" | "all" = isFaceted
		? migrateShareValue(facetCfg.shareX, facetCfg.shareAxes)
		: "none"
	const shareYMode: "none" | "perGroup" | "all" = isFaceted
		? migrateShareValue(facetCfg.shareY, facetCfg.shareAxes)
		: "none"
	const allDatasetRows = dataset.rows
	const { colRowsByColKey, rowRowsByRowKey } = groupRowsByShareGroup(panelData)

	// For bar / area charts under shared measure-axis modes ("all" or
	// "perGroup"), pre-compute the group's max measure value. Pooling rows
	// then aggregating in the renderer summed same-category values across
	// panels and inflated the axis. Aggregating panel-by-panel and taking
	// the max here keeps the shared axis tight to the largest actual panel.
	const measureAxis = mode.canvas.measureAxis
	const isBarOrArea = measureAxis !== null
	const isVerticalBarOrArea = measureAxis === "y"
	const groupMeasureMaxByKey = new Map<string, number>()
	if (isBarOrArea) {
		const measureShareMode = isVerticalBarOrArea ? shareYMode : shareXMode
		if (measureShareMode !== "none") {
			const categoryField = isVerticalBarOrArea
				? encodings.x?.field ?? null
				: encodings.y?.field ?? null
			const panelMeasureMax = new Map<string, number>()

			// Histogram: there's no measure field — the measure is the COUNT of
			// rows per bin. Bin the POOLED rows so every panel shares the same
			// edges, then each panel's measure max is its largest per-bin count.
			const catChannel = isVerticalBarOrArea ? "x" : "y"
			const histogramCfg = channelConfigs[catChannel]?.histogram
			const isHistogram =
				!!histogramCfg?.enabled &&
				!!categoryField &&
				getType(categoryField) === "quantitative"

			if (isHistogram && categoryField) {
				const isDensity = histogramCfg?.mode === "density"
				const pooled = panelData.values.flatMap(
					(k) => panelData.rowsByValue.get(k) ?? []
				)
				const binning = computeHistogramBins(
					pooled.map((r) => r[categoryField]),
					histogramCfg?.binCount ?? 10,
					undefined,
					{
						min: channelConfigs[catChannel]?.min ?? null,
						max: channelConfigs[catChannel]?.max ?? null,
					}
				)
				panelData.values.forEach((key) => {
					const panelRows = panelData.rowsByValue.get(key) ?? []
					const counts = binning
						? binnedCounts(
								panelRows.map((r) => r[categoryField]),
								binning
							)
						: new Map<string, number>()
					const maxCount =
						counts.size > 0 ? Math.max(0, ...counts.values()) : 0
					// Density: bars are bin shares (count / panel total), so the
					// panel max is the largest share (≤1). The shared-axis floor
					// below (Math.max(1, …)) then pins the density axis to 0–1,
					// matching the non-faceted path's computeBarMeasureMax.
					const panelTotal = [...counts.values()].reduce((a, b) => a + b, 0)
					panelMeasureMax.set(
						key,
						isDensity && panelTotal > 0 ? maxCount / panelTotal : maxCount
					)
				})
			} else {
				// Measure field: each mode declares its own fallback chain
				// (areas read `length` first) via canvas.resolveMeasureField.
				const measureField =
					mode.canvas.resolveMeasureField?.(encodings) ?? null
				const modes = resolveStackModes(channelConfigs, encodings)
				const groupModeFields = modes
					.filter((m) => m.mode === "group")
					.map((m) => encodings[m.channel]?.field)
					.filter((f): f is string => !!f)
				panelData.values.forEach((key) => {
					const panelRows = panelData.rowsByValue.get(key) ?? []
					panelMeasureMax.set(
						key,
						computePanelMeasureMax(
							panelRows,
							categoryField,
							measureField,
							modes,
							groupModeFields,
						)
					)
				})
			}
			if (measureShareMode === "all") {
				const allMax = Math.max(1, ...panelMeasureMax.values())
				for (const key of panelData.values)
					groupMeasureMaxByKey.set(key, allMax)
			} else {
				// perGroup: vertical bars/areas share Y per row; horizontal
				// share X per col. Group by the dimension perpendicular to
				// the measure axis, keyed by share-group key (facet value in
				// grid mode — compaction moves panels off their layout row).
				const groupMax = new Map<string, number>()
				panelData.values.forEach((key, i) => {
					const { rowKey, colKey } = panelGroupKeys(panelData, key, i)
					const groupKey = isVerticalBarOrArea ? rowKey : colKey
					const v = panelMeasureMax.get(key) ?? 1
					const cur = groupMax.get(groupKey) ?? 0
					if (v > cur) groupMax.set(groupKey, v)
				})
				panelData.values.forEach((key, i) => {
					const { rowKey, colKey } = panelGroupKeys(panelData, key, i)
					const groupKey = isVerticalBarOrArea ? rowKey : colKey
					groupMeasureMaxByKey.set(key, groupMax.get(groupKey) ?? 1)
				})
			}
		}
	}

	// "Size panels by unit" for polar (radar / pie): compute a 0..1
	// scale per panel that the renderer multiplies into its drawn
	// radius. The largest-unit panel = 1.0; smaller panels render
	// proportionally smaller.
	//
	//   Radar: unit = panel's effective max R (override.max wins over
	//                 data max, mirroring how RadarPlot itself derives
	//                 the r-scale domain — otherwise a user pinning R
	//                 to [0, 1] on every panel would see panels still
	//                 sized by their data max, contradicting the pin)
	//   Pie:   unit = panel's slice total (sum of `length` values)
	//
	// Reference (the 1.0 panel) is the max unit across ALL panels —
	// independent of shareR / shareAngle so users can read panel
	// magnitudes off the visual regardless of share mode.
	const panelRadiusScale = new Map<string, number>()
	if (isPolar && facetCfg.proportionalPanelSizing === true && isFaceted) {
		const rField = encodings.r?.field ?? null
		// Pies carry their slice values on the ANGLE channel (see PiePlot's
		// `measureField = encodings.angle.field`), not `length`. Reading
		// `length` here left `unit` at 0 for every pie panel, so maxUnit was
		// 0 and panelRadiusScale stayed empty — "size pies by unit" silently
		// did nothing.
		const pieMeasureField = encodings.angle?.field ?? null
		// Resolve the R-axis share mode once for the radar branch — the
		// per-panel override lookup mirrors the renderer's path at line
		// ~1664 so the SIZE math and the SCALE math agree on which
		// override wins.
		const shareRModeForSize = isPolar
			? migratePolarShareValue(
					facetCfg.shareR,
					facetCfg.shareY,
					facetCfg.shareAxes,
					"R",
				)
			: undefined
		const cols = panelData.grid.cols
		const resolveROverride = (
			key: string,
			idx: number,
			row: number,
			col: number,
		): { min?: number; max?: number } | undefined => {
			if (mode.canvas.polarUnit !== "rAxisMax") return undefined
			// Grid mode keys per-row / per-col overrides by ORIGINAL facet
			// value (compaction moves panels off their layout position);
			// wrap keys by layout index, as before. `__all__` placeholder
			// values still mean "no key" → fall back to the index string.
			const fv = panelFacetValues(panelData, key, idx)
			const rowKey =
				panelData.mode === "grid"
					? fv.rowValue !== null && fv.rowValue !== "__all__"
						? fv.rowValue
						: undefined
					: String(row)
			const colKey =
				panelData.mode === "grid"
					? fv.colValue !== null && fv.colValue !== "__all__"
						? fv.colValue
						: undefined
					: String(col)
			const polarPanelKey =
				panelData.mode === "wrap" ? key : `${row}|${col}`
			return shareRModeForSize === "all"
				? facetCfg.overallRRange
				: shareRModeForSize === "perRow"
					? facetCfg.rowRAxisOverrides?.[rowKey ?? String(row)]
					: shareRModeForSize === "perCol"
						? facetCfg.colRAxisOverrides?.[colKey ?? String(col)]
						: facetCfg.panelRAxisOverrides?.[polarPanelKey]
		}
		const panelUnit = new Map<string, number>()
		panelData.values.forEach((key, i) => {
			const panelRows = panelData.rowsByValue.get(key) ?? []
			let unit = 0
			if (mode.canvas.polarUnit === "rAxisMax" && rField) {
				let dataMax = 0
				for (const r of panelRows) {
					const raw = r[rField]
					const n = typeof raw === "number" ? raw : Number(raw)
					if (Number.isFinite(n) && n > dataMax) dataMax = n
				}
				const row = Math.floor(i / cols)
				const col = i % cols
				const override = resolveROverride(key, i, row, col)
				// Effective max: override.max wins (matches the r-scale
				// domain RadarPlot builds via buildRScale's rMaxOverride).
				// `dataMax` is the floor so an undefined override still
				// gives a sensible weight.
				unit = override?.max ?? dataMax
			} else if (mode.canvas.polarUnit === "angleSum" && pieMeasureField) {
				// Pies: the panel's "unit" is the sum of its slice values
				// (the angle measure). No equivalent R-range override exists
				// for pie modes — use the raw data sum.
				for (const r of panelRows) {
					const raw = r[pieMeasureField]
					const n = typeof raw === "number" ? raw : Number(raw)
					if (Number.isFinite(n) && n > 0) unit += n
				}
			}
			panelUnit.set(key, unit)
		})
		// For radar, fold per-panel units into share groups so the
		// drawn-radius math matches the R-scale-sharing math:
		//   - shareR = "all":     every panel uses the global max → all
		//                          panels render at the same size (1.0).
		//   - shareR = "perRow":  panels in a row use that row's max →
		//                          rows differ in size, panels within a
		//                          row are uniform (their R scales are
		//                          the same).
		//   - shareR = "perCol":  symmetric for columns.
		//   - shareR = "none":    keep per-panel units (existing behavior).
		// Pies don't have an R axis to share, so this regrouping doesn't
		// apply — leave their per-panel slice totals as-is.
		if (mode.canvas.polarUnit === "rAxisMax" && shareRModeForSize !== "none") {
			if (shareRModeForSize === "all") {
				const globalMax = Math.max(0, ...panelUnit.values())
				for (const key of panelData.values) panelUnit.set(key, globalMax)
			} else if (shareRModeForSize === "perRow") {
				// Group by share-group key (facet value in grid mode) so the
				// size groups match the R-scale share groups under compaction.
				const rowMax = new Map<string, number>()
				panelData.values.forEach((key, i) => {
					const { rowKey } = panelGroupKeys(panelData, key, i)
					const u = panelUnit.get(key) ?? 0
					const cur = rowMax.get(rowKey) ?? 0
					if (u > cur) rowMax.set(rowKey, u)
				})
				panelData.values.forEach((key, i) => {
					const { rowKey } = panelGroupKeys(panelData, key, i)
					panelUnit.set(key, rowMax.get(rowKey) ?? 0)
				})
			} else if (shareRModeForSize === "perCol") {
				const colMax = new Map<string, number>()
				panelData.values.forEach((key, i) => {
					const { colKey } = panelGroupKeys(panelData, key, i)
					const u = panelUnit.get(key) ?? 0
					const cur = colMax.get(colKey) ?? 0
					if (u > cur) colMax.set(colKey, u)
				})
				panelData.values.forEach((key, i) => {
					const { colKey } = panelGroupKeys(panelData, key, i)
					panelUnit.set(key, colMax.get(colKey) ?? 0)
				})
			}
		}
		const maxUnit = Math.max(0, ...panelUnit.values())
		if (maxUnit > 0) {
			for (const [key, unit] of panelUnit) {
				panelRadiusScale.set(key, unit / maxUnit)
			}
		}
	}

	// Position the caption in the reserved bottom band. The solver already
	// shrank the plot by `captionReserve`, so the default placement fits inside
	// the canvas; the SVG only grows if the user NUDGES the box past the edge.
	const captionLayout = captionBox
		? positionCaptionBox(caption, captionBox, spec.canvas.width, spec.canvas.height)
		: null
	const svgWidth = captionLayout
		? Math.max(spec.canvas.width, captionLayout.left + captionLayout.width)
		: spec.canvas.width
	const svgHeight = captionLayout
		? Math.max(spec.canvas.height, captionLayout.top + captionLayout.height)
		: spec.canvas.height

	const svg = (
		<svg
			id={PLOT_SVG_ID}
			width={svgWidth}
			height={svgHeight}
			className="block"
		>
			{/* Shared titles (chart + axes) */}
			{spec.title && (
				<SharedText
					rect={spec.title}
					text={labels.title ?? ""}
					fontFamily={titleFont.family}
					fontSize={titleFont.size}
					fill={titleFont.color}
					weight={titleFont.weight}
					italic={titleFont.italic}
					underline={titleFont.underline}
				/>
			)}
			{spec.subtitle && (
				<SharedText
					rect={spec.subtitle}
					text={labels.subtitle ?? ""}
					fontFamily={subtitleFont.family}
					fontSize={subtitleFont.size}
					fill={subtitleFont.color}
					weight={subtitleFont.weight}
					italic={subtitleFont.italic}
					underline={subtitleFont.underline}
				/>
			)}
			{spec.xTitle && (
				<SharedText
					rect={spec.xTitle}
					text={sharedXAxisTitle}
					fontFamily={xAxisTitleFont.family}
					fontSize={xAxisTitleFont.size}
					fontWeight={500}
					fill={xAxisTitleFont.color}
					weight={xAxisTitleFont.weight}
					italic={xAxisTitleFont.italic}
					underline={xAxisTitleFont.underline}
				/>
			)}
			{spec.yTitle && (
				<SharedText
					rect={spec.yTitle}
					text={sharedYAxisTitle}
					fontFamily={yAxisTitleFont.family}
					fontSize={yAxisTitleFont.size}
					fontWeight={500}
					fill={yAxisTitleFont.color}
					weight={yAxisTitleFont.weight}
					italic={yAxisTitleFont.italic}
					underline={yAxisTitleFont.underline}
				/>
			)}
			{/* Grid-mode column / row header strips. Empty in wrap and
			    single modes (solver returns empty arrays). The corner
			    intersection between strips is intentionally blank — strips
			    don't span it. */}
			{spec.columnHeaders.map((h) => (
				<text
					key={`colhdr-${h.text}`}
					data-column-header
					x={h.x}
					y={h.y}
					textAnchor={h.textAnchor}
					fontFamily={facetColTitleFont.family}
					fontSize={facetColTitleFont.size}
					fontWeight={facetColTitleFont.weight ?? 500}
					fontStyle={facetColTitleFont.italic ? "italic" : undefined}
					textDecoration={facetColTitleFont.underline ? "underline" : undefined}
					fill={facetColTitleFont.color}
					dominantBaseline="middle"
					className={facetColTitleFont.color ? undefined : TITLE_FILL_FALLBACK}
				>
					{h.text}
				</text>
			))}
			{spec.rowHeaders.map((h) => (
				<text
					key={`rowhdr-${h.text}`}
					data-row-header
					x={h.x}
					y={h.y}
					textAnchor={h.textAnchor}
					fontFamily={facetRowTitleFont.family}
					fontSize={facetRowTitleFont.size}
					fontWeight={facetRowTitleFont.weight ?? 500}
					fontStyle={facetRowTitleFont.italic ? "italic" : undefined}
					textDecoration={facetRowTitleFont.underline ? "underline" : undefined}
					fill={facetRowTitleFont.color}
					dominantBaseline={
						h.verticalAnchor === "top"
							? "hanging"
							: h.verticalAnchor === "bottom"
								? "auto"
								: "middle"
					}
					className={facetRowTitleFont.color ? undefined : TITLE_FILL_FALLBACK}
				>
					{h.text}
				</text>
			))}
			{/* Per-panel marks + per-panel facet label */}
			{spec.panels.map((p) => {
				const rows = panelData.rowsByValue.get(p.key) ?? []
				// Share-group keys + original facet values for this panel.
				// `values` is row-major, so the layout (row, col) recovers the
				// panel's index; panelGroupKeys / panelFacetValues then key by
				// facet VALUE in grid mode (compaction moves panels, so layout
				// position lies) and by layout position elsewhere.
				const panelIdx = p.row * panelData.grid.cols + p.col
				const { rowKey: panelRowKey, colKey: panelColKey } =
					panelGroupKeys(panelData, p.key, panelIdx)
				const panelFV = panelFacetValues(panelData, p.key, panelIdx)
				// When share-axes is on, scales must be built from a wider
				// row source than just this panel's filtered rows so the
				// axis spans the unified extent across the sharing group
				// — that's what "shared axis" means per APPLICATION.md
				// §5.2. Without this, each panel uses its own scale and
				// shareX merely suppresses label rendering on non-bottom
				// rows, leaving the visible bottom-row labels showing
				// only THAT panel's range.
				//   "all"      → full dataset's rows
				//   "perGroup" → all rows in this panel's COLUMN (x) /
				//                ROW (y)
				//   "none"     → undefined (renderer falls back to the
				//                panel's own rows via rowsOverride)
				// Polar charts (radar / pie) read the polar share modes,
				// which support per-row AND per-col grouping for each axis
				// (R + angle) independently. For everything else we keep
				// the cartesian shareX / shareY → row-or-col grouping
				// mapping (shareY=perGroup → row, shareX=perGroup → col).
				const resolveByShare = (
					mode: "none" | "perRow" | "perCol" | "all",
				) =>
					mode === "all"
						? allDatasetRows
						: mode === "perRow"
							? rowRowsByRowKey.get(panelRowKey) ?? undefined
							: mode === "perCol"
								? colRowsByColKey.get(panelColKey) ?? undefined
								: undefined
				const xScaleRows = isPolar
					? resolveByShare(
							migratePolarShareValue(
								facetCfg.shareAngle,
								facetCfg.shareX,
								facetCfg.shareAxes,
								"angle",
							),
						)
					: shareXMode === "all"
						? allDatasetRows
						: shareXMode === "perGroup"
							? colRowsByColKey.get(panelColKey) ?? undefined
							: undefined
				const yScaleRows = isPolar
					? resolveByShare(
							migratePolarShareValue(
								facetCfg.shareR,
								facetCfg.shareY,
								facetCfg.shareAxes,
								"R",
							),
						)
					: shareYMode === "all"
						? allDatasetRows
						: shareYMode === "perGroup"
							? rowRowsByRowKey.get(panelRowKey) ?? undefined
							: undefined
				// Per-group axis-range overrides (Phase 2 refinement).
				// Surfaced as inputs in Facet (row) / Facet (col) panels
				// only when shareY/shareX === "perGroup" AND the variable
				// is continuous; the same gate applies here so we don't
				// silently constrain scales for a hidden control.
				// The MEASURE axis of a bar/area chart is always continuous, even
				// when no field drives it directly — e.g. a histogram's count
				// axis (bars-x → measure on Y) has no `length` field, so
				// `axisFields.yType` is null. Treat it as continuous so its
				// min/max (and other continuous controls) apply.
				const yIsMeasureAxis = measureAxis === "y"
				const xIsMeasureAxis = measureAxis === "x"
				const yIsContinuous =
					axisFields.yType === "quantitative" ||
					axisFields.yType === "temporal" ||
					yIsMeasureAxis
				const xIsContinuous =
					axisFields.xType === "quantitative" ||
					axisFields.xType === "temporal" ||
					xIsMeasureAxis
				const rowValueForPanel =
					panelData.mode === "grid"
						? panelFV.rowValue ?? undefined
						: undefined
				const colValueForPanel =
					panelData.mode === "grid"
						? panelFV.colValue ?? undefined
						: undefined
				// Group-axis overrides: grid mode keys by facet value (e.g.
				// "Ideal"); wrap mode keys by layout row/col INDEX as string
				// ("0", "1", …) because wrap layout rows don't have a value.
				// Both modes consult the same `rowAxisOverrides` /
				// `colAxisOverrides` maps — keys never collide because grid
				// values are real names while wrap keys are bare integers.
				const yPerGroupKey =
					panelData.mode === "grid"
						? rowValueForPanel !== undefined &&
							rowValueForPanel !== "__all__"
							? rowValueForPanel
							: undefined
						: String(p.row)
				const xPerGroupKey =
					panelData.mode === "grid"
						? colValueForPanel !== undefined &&
							colValueForPanel !== "__all__"
							? colValueForPanel
							: undefined
						: String(p.col)
				// Row-axis override applies under:
				//   - shareY === "perGroup": pins the row's shared scale.
				//   - shareY === "none" + grid mode + cols === 1: each row
				//     is a single panel, so the row override = per-panel
				//     bound (the row/col sidebar exposes the editor under
				//     this case too).
				// Wrap mode shareY=none uses `panelAxisOverrides` via
				// `legacyPanelOverride` below, not this map.
				const rowOverrideApplies =
					shareYMode === "perGroup" ||
					(shareYMode === "none" &&
						panelData.mode === "grid" &&
						panelData.grid.cols === 1)
				const colOverrideApplies =
					shareXMode === "perGroup" ||
					(shareXMode === "none" &&
						panelData.mode === "grid" &&
						panelData.grid.rows === 1)
				const yGroupOverride =
					rowOverrideApplies && yIsContinuous && yPerGroupKey != null
						? facetCfg.rowAxisOverrides?.[yPerGroupKey]
						: undefined
				const xGroupOverride =
					colOverrideApplies && xIsContinuous && xPerGroupKey != null
						? facetCfg.colAxisOverrides?.[xPerGroupKey]
						: undefined
				// Overall axis range: applies under share=="all" with a
				// continuous axis. Lets the user pin the shared scale to a
				// "pretty" start (e.g. 0) or fixed upper bound.
				const yOverallOverride =
					shareYMode === "all" && yIsContinuous
						? facetCfg.overallYRange
						: undefined
				const xOverallOverride =
					shareXMode === "all" && xIsContinuous
						? facetCfg.overallXRange
						: undefined
				// Wrap-mode legacy per-panel overrides keyed by the single
				// facet value (== p.key). Preserved as-is so saved visuals
				// keep working; in grid mode we ignore this branch.
				const legacyPanelOverride =
					panelData.mode === "wrap"
						? facetCfg.panelAxisOverrides?.[p.key]
						: undefined
				// Per-encoding base bounds from the X / Y axis option panels.
				// Lowest precedence — facet-level overrides above win where set,
				// but on single-panel charts (and faceted panels without a more
				// specific override) these are the only source. Only consulted
				// on continuous axes; `null`/absent coerces to undefined so the
				// renderer falls through to auto-fit. (`?? undefined` turns a
				// stored `null` into `undefined`.)
				const xCfgMin = xIsContinuous
					? channelConfigs.x?.min ?? undefined
					: undefined
				const xCfgMax = xIsContinuous
					? channelConfigs.x?.max ?? undefined
					: undefined
				const yCfgMin = yIsContinuous
					? channelConfigs.y?.min ?? undefined
					: undefined
				const yCfgMax = yIsContinuous
					? channelConfigs.y?.max ?? undefined
					: undefined
				const xMinOverride =
					xGroupOverride?.min ??
					xOverallOverride?.min ??
					legacyPanelOverride?.xMin ??
					xCfgMin
				const xMaxOverride =
					xGroupOverride?.max ??
					xOverallOverride?.max ??
					legacyPanelOverride?.xMax ??
					xCfgMax
				const yMinOverride =
					yGroupOverride?.min ??
					yOverallOverride?.min ??
					legacyPanelOverride?.yMin ??
					yCfgMin
				const yMaxOverride =
					yGroupOverride?.max ??
					yOverallOverride?.max ??
					legacyPanelOverride?.yMax ??
					yCfgMax
				// Bar / Area renderers consume a single "measure axis"
				// bound (the quantitative axis). bars-x / areas-x → y is
				// the measure axis; bars-y / areas-y → x is the measure
				// axis. Translate the per-axis overrides here so the
				// renderer doesn't have to know about modes.
				const measureMinOverride =
					measureAxis === "y"
						? yMinOverride
						: measureAxis === "x"
							? xMinOverride
							: undefined
				// User-set per-group min/max wins; otherwise fall back to the
				// shared-group max computed above (so an unset override on a
				// shared axis still gets the correct tighter bound, not the
				// inflated pooled-aggregation value).
				const sharedGroupMax = groupMeasureMaxByKey.get(p.key)
				const measureMaxOverride =
					measureAxis === "y"
						? yMaxOverride ?? sharedGroupMax
						: measureAxis === "x"
							? xMaxOverride ?? sharedGroupMax
							: undefined
				// Polar R-axis overrides. Mirrors the cartesian Y override
				// resolution above but reads dedicated polar-specific
				// fields (overallRRange, rowRAxisOverrides, etc.) so
				// switching between cartesian and polar modes doesn't
				// cross-pollute settings.
				const shareRMode = isPolar
					? migratePolarShareValue(
							facetCfg.shareR,
							facetCfg.shareY,
							facetCfg.shareAxes,
							"R",
						)
					: undefined
				const polarPanelKey =
					panelData.mode === "wrap" ? p.key : `${p.row}|${p.col}`
				const rRangeOverride: { min?: number; max?: number } | undefined =
					!isPolar
						? undefined
						: shareRMode === "all"
							? facetCfg.overallRRange
							: shareRMode === "perRow"
								? facetCfg.rowRAxisOverrides?.[
										yPerGroupKey ?? String(p.row)
									]
								: shareRMode === "perCol"
									? facetCfg.colRAxisOverrides?.[
											xPerGroupKey ?? String(p.col)
										]
									: facetCfg.panelRAxisOverrides?.[polarPanelKey]
				const rMinOverride = rRangeOverride?.min
				const rMaxOverride = rRangeOverride?.max
				const radiusScale = panelRadiusScale.get(p.key)

				const rendererProps: UniversalRendererProps = {
					rowsOverride: rows,
					inner: rectToInner(p.inner),
					showXAxis: p.showXTicks,
					showYAxis: p.showYTicks,
					showXAxisTitle: false,
					showYAxisTitle: false,
					titleOverride: null,
					subtitleOverride: null,
					// In the new model, `inner` already accounts for margin
					// estimates (the solver folded them in). Renderers using
					// the inner-prop branch ignore extraMarginFloor, but we
					// pass them anyway for defensive compatibility.
					extraMarginFloorLeft: 0,
					extraMarginFloorBottom: 0,
					// Categorical ticks use d3's natural `padding(0.5)` (half-step
					// insets: two categories at the quarter points, a lone
					// category centered) — NOT the fixed-pixel edge pinning
					// (`firstTickPxOffset`) faceted charts briefly used. The
					// pinning squished the first tick against the axis spine and
					// left one-category panels uncentered (user-reported July
					// 2026), and the alignment it bought is already guaranteed:
					// panels sharing an axis have identical domains AND identical
					// panel widths (the solver keeps column widths / row heights
					// uniform), so half-step positions align across the share
					// group by construction.
					// Per-axis scale-source overrides for renderers that
					// support them (ScatterPlot, TilePlot). Combined
					// override (`scalesRowsOverride`) is set only when BOTH
					// axes use the same source (currently only when both
					// are "all") so renderers without per-axis support
					// (BarPlot, AreaPlot) pick it up. Under "perGroup", x
					// and y sources differ per panel position so the
					// combined override is intentionally left undefined.
					scalesRowsOverrideX: xScaleRows,
					scalesRowsOverrideY: yScaleRows,
					scalesRowsOverride:
						xScaleRows && yScaleRows && xScaleRows === yScaleRows
							? xScaleRows
							: undefined,
					// Per-axis numeric domain overrides. Scatter consumes
					// xMin/xMax/yMin/yMax directly; Bar/Area consume the
					// translated measureMin/measureMax. Pie/Tile ignore
					// both. Undefined → renderer auto-computes from data.
					xMinOverride,
					xMaxOverride,
					yMinOverride,
					yMaxOverride,
					measureMinOverride,
					measureMaxOverride,
					// Polar-only: R-axis bounds + "size panels by unit"
					// scaling. RadarPlot/PiePlot ignore these for non-
					// polar inputs; cartesian renderers ignore them
					// (they only read the cartesian min/max). Undefined
					// preserves the renderer's auto behavior.
					rMinOverride,
					rMaxOverride,
					radiusScale,
				}
				// Test-observable: row count actually fed to the
				// scale-source for each axis. Falls back to the panel's
				// own row count when no override applies (== "none" mode)
				// so the attribute is always a usable number for
				// assertions across all three modes.
				const xScaleRowCount = (xScaleRows ?? rows).length
				const yScaleRowCount = (yScaleRows ?? rows).length
				// Value-mode annotations must build their position scale from the
				// SAME inputs the renderer uses for this panel — share-aware row
				// source, per-axis domain override, and facet tick-offset — so a
				// data-unit rectangle tracks the marks instead of being derived
				// from the panel's own (possibly narrower) extent. Mirror the
				// renderer's measure-axis translation: bars-y/areas-y put the
				// measure on the X pixel-axis; bars-x/areas-x put it on Y.
				const annoXScaleRows = xScaleRows ?? rows
				const annoYScaleRows = yScaleRows ?? rows
				const annoXDomainOverride =
					measureAxis === "x"
						? { min: measureMinOverride, max: measureMaxOverride }
						: { min: xMinOverride, max: xMaxOverride }
				const annoYDomainOverride =
					measureAxis === "y"
						? { min: measureMinOverride, max: measureMaxOverride }
						: { min: yMinOverride, max: yMaxOverride }
				// Scope annotations to this panel — those whose `facetKeys`
				// exclude this facet are dropped before either layer renders.
				const panelRectangles = annotations.rectangles.filter((r) =>
					annotationOnPanel(r, p.key),
				)
				const panelCircles = (annotations.circles ?? []).filter((c) =>
					annotationOnPanel(c, p.key),
				)
				const panelLineSegments = (annotations.lineSegments ?? []).filter(
					(l) => annotationOnPanel(l, p.key),
				)
				// Per-panel title text. Compacted grid panels carry their
				// compact label (row value / col value / "row · col"
				// depending on which strip survived); wrap mode keeps the
				// raw panel key as before.
				const facetLabelText =
					panelData.mode === "grid"
						? panelData.compact?.panels[p.key]?.label ?? p.key
						: p.key
				// Compact-grid panel titles are styled by the `facetPanelTitle`
				// slot; wrap-mode panel titles keep the shared `facetTitle`.
				const isCompactPanelLabel =
					panelData.mode === "grid" && panelData.compact !== undefined
				const panelLabelFont = isCompactPanelLabel
					? facetPanelTitleFont
					: facetTitleFont
				const panelLabelOffset = isCompactPanelLabel
					? facetPanelTitleOffset
					: facetTitleOffset
				return (
					<g
						key={p.key}
						data-panel={p.key}
						data-panel-key={p.key}
						data-x-scale-rows={xScaleRowCount}
						data-y-scale-rows={yScaleRowCount}
					>
						{p.facetLabel && (
							<g data-facet-label>
								<SharedText
									rect={
										panelLabelOffset.x || panelLabelOffset.y
											? {
													...p.facetLabel,
													x: p.facetLabel.x + panelLabelOffset.x,
													y: p.facetLabel.y + panelLabelOffset.y,
												}
											: p.facetLabel
									}
									text={facetLabelText}
									fontFamily={panelLabelFont.family}
									fontSize={panelLabelFont.size}
									fontWeight={500}
									fill={panelLabelFont.color}
									weight={panelLabelFont.weight}
									italic={panelLabelFont.italic}
									underline={panelLabelFont.underline}
								/>
							</g>
						)}
						<AnnotationRects
							rectangles={panelRectangles}
							circles={panelCircles}
							lineSegments={panelLineSegments}
							inner={p.inner}
							layer="behind"
							xScaleRows={annoXScaleRows}
							yScaleRows={annoYScaleRows}
							axisFields={axisFields}
							xDomainOverride={annoXDomainOverride}
							yDomainOverride={annoYDomainOverride}
							levelOrders={levelOrders}
							isRadar={mode.canvas.valueAnnotationsInRenderer ?? false}
							radiusScale={radiusScale}
						/>
						{/* The Renderer reads from Jotai for everything else;
						    inner + rowsOverride steer the per-panel render.
						    Typed dispatch: Renderer is ComponentType<
						    UniversalRendererProps>, so this call is checked
						    against every registered renderer's contract. */}
						<Renderer {...rendererProps} />
						<AnnotationRects
							rectangles={panelRectangles}
							circles={panelCircles}
							lineSegments={panelLineSegments}
							inner={p.inner}
							layer="front"
							xScaleRows={annoXScaleRows}
							yScaleRows={annoYScaleRows}
							axisFields={axisFields}
							xDomainOverride={annoXDomainOverride}
							yDomainOverride={annoYDomainOverride}
							levelOrders={levelOrders}
							isRadar={mode.canvas.valueAnnotationsInRenderer ?? false}
							radiusScale={radiusScale}
						/>
					</g>
				)
			})}
			{captionLayout && (
				<CaptionOverlay caption={caption} layout={captionLayout} />
			)}
		</svg>
	)

	// A caption nudged/sized past the solved canvas grows the SVG; when that
	// happens (and the solver didn't already ask for a scroll viewport), pin the
	// SVG inside an overflow-auto box sized to the container so the overflow
	// scrolls into view instead of bleeding out of the chart area.
	const captionOverflows =
		svgWidth > spec.canvas.width || svgHeight > spec.canvas.height
	const wrapped =
		spec.scroll || captionOverflows ? (
			<div
				style={{
					width: spec.scroll?.width ?? (bounds.width || svgWidth),
					height: spec.scroll?.height ?? (bounds.height || svgHeight),
					overflow: "auto",
				}}
			>
				{svg}
			</div>
		) : (
			svg
		)

	return (
		<div ref={ref} className="relative h-full w-full" style={bgStyle}>
			{wrapped}
		</div>
	)
}

/** Render a TextRect as an SVG <text> at its spec coordinates. Handles
 *  rotation (-90 for rotated y-titles) and multi-line text. */
const SharedText = ({
	rect,
	text,
	fontFamily,
	fontSize,
	fontWeight,
	fill,
	weight,
	italic,
	underline,
}: {
	rect: TextRect
	text: string
	fontFamily?: string
	fontSize?: number
	fontWeight?: number
	fill?: string
	/** User-chosen numeric font weight. When set it overrides `fontWeight`
	 * (the renderer's default for this slot), so a weight picked in the Labels
	 * panel trumps e.g. the axis title's default 500. */
	weight?: number
	italic?: boolean
	underline?: boolean
}) => {
	const transform =
		rect.rotation === -90
			? `rotate(-90, ${rect.x}, ${rect.y})`
			: undefined
	return (
		<text
			x={rect.x}
			y={rect.y}
			textAnchor={rect.textAnchor}
			transform={transform}
			fontFamily={fontFamily}
			fontSize={fontSize}
			fontWeight={weight ?? fontWeight}
			fontStyle={italic ? "italic" : undefined}
			textDecoration={underline ? "underline" : undefined}
			fill={fill}
			className={fill ? undefined : TITLE_FILL_FALLBACK}
		>
			{renderMultilineTspans(text, rect.x)}
		</text>
	)
}

/** Vertical gap above and below the caption box within its reserved band. */
const CAPTION_GAP = 8

/** Resolve a caption px/% measure against its basis (canvas width or height). */
const resolveCaptionUnit = (
	value: number,
	unit: CaptionUnit,
	basis: number
): number => (unit === "%" ? (value / 100) * basis : value)

/** The caption box's size, independent of where it's placed. Width defaults
 *  to the full canvas width (auto); height grows to fit the wrapped text
 *  (auto). Measured first so the layout solver can reserve a matching band at
 *  the bottom of the canvas — see `captionReserve`. */
type CaptionBox = {
	width: number
	height: number
	lines: string[]
}

const measureCaptionBox = (
	caption: CaptionConfig,
	widthBasis: number,
	heightBasis: number
): CaptionBox | null => {
	if (!caption.enabled || caption.text.trim().length === 0) return null
	const fontSize = Math.max(1, caption.fontSize)
	const padding = Math.max(0, caption.padding)
	const lineHeight = fontSize * 1.2

	// Auto width spans the canvas but is inset by a gap on each side so the
	// border (and the box edges) sit INSIDE the SVG rather than clipping against
	// its left/right boundary. An explicit width is honored as-is.
	const width =
		caption.width > 0
			? resolveCaptionUnit(caption.width, caption.widthUnit, widthBasis)
			: Math.max(1, widthBasis - CAPTION_GAP * 2)
	const wrapWidth = Math.max(1, width - padding * 2)
	const lines = wrapTextToWidth(caption.text, wrapWidth, fontSize)
	const autoHeight = padding * 2 + lineHeight * lines.length
	const height =
		caption.height > 0
			? resolveCaptionUnit(caption.height, caption.heightUnit, heightBasis)
			: autoHeight

	return { width: Math.max(1, width), height: Math.max(1, height), lines }
}

/** Vertical space the caption reserves at the bottom of the canvas (box height
 *  plus a gap above and below). Fed to the solver as `extraBottomMargin` so the
 *  plot shrinks and the caption never pushes content past the viewport. */
const captionReservePx = (box: CaptionBox | null): number =>
	box ? box.height + CAPTION_GAP * 2 : 0

type CaptionLayout = {
	left: number
	top: number
	width: number
	height: number
	textX: number
	firstBaseline: number
	textAnchor: "start" | "middle" | "end"
	lines: string[]
}

/** Position a measured caption box within the reserved bottom band. The box
 *  defaults to horizontally centered and pinned to the bottom of the canvas
 *  (`CAPTION_GAP` above the canvas edge); the position adjusters NUDGE it from
 *  there. Percent offsets resolve against canvas width (x) / height (y). */
const positionCaptionBox = (
	caption: CaptionConfig,
	box: CaptionBox,
	canvasW: number,
	canvasH: number
): CaptionLayout => {
	const padding = Math.max(0, caption.padding)
	const fontSize = Math.max(1, caption.fontSize)

	const defaultLeft = (canvasW - box.width) / 2
	const defaultTop = canvasH - box.height - CAPTION_GAP
	const left =
		defaultLeft +
		resolveCaptionUnit(caption.offsetX, caption.offsetXUnit, canvasW)
	const top =
		defaultTop +
		resolveCaptionUnit(caption.offsetY, caption.offsetYUnit, canvasH)

	const textAnchor =
		caption.align === "center"
			? "middle"
			: caption.align === "right"
				? "end"
				: "start"
	const textX =
		caption.align === "center"
			? left + box.width / 2
			: caption.align === "right"
				? left + box.width - padding
				: left + padding
	const firstBaseline = top + padding + fontSize

	return {
		left,
		top,
		width: box.width,
		height: box.height,
		textX,
		firstBaseline,
		textAnchor,
		lines: box.lines,
	}
}

/** Render the caption box (optional background rect + border + wrapped text)
 *  inside the plot SVG, so it travels with thumbnails and image exports. */
const CaptionOverlay = ({
	caption,
	layout,
}: {
	caption: CaptionConfig
	layout: CaptionLayout
}) => {
	const hasBg = caption.backgroundOpacity > 0
	const hasBorder = caption.borderEnabled && caption.borderWidth > 0
	return (
		<g data-caption>
			{(hasBg || hasBorder) && (
				<rect
					x={layout.left}
					y={layout.top}
					width={layout.width}
					height={layout.height}
					rx={caption.borderRadius}
					fill={hasBg ? caption.backgroundColor : "none"}
					fillOpacity={hasBg ? caption.backgroundOpacity : undefined}
					stroke={hasBorder ? caption.borderColor : "none"}
					strokeWidth={hasBorder ? caption.borderWidth : undefined}
				/>
			)}
			<text
				x={layout.textX}
				y={layout.firstBaseline}
				textAnchor={layout.textAnchor}
				fontFamily={caption.fontFamily}
				fontSize={caption.fontSize}
				fontWeight={caption.fontWeight}
				fill={caption.textColor || undefined}
				className={caption.textColor ? undefined : TITLE_FILL_FALLBACK}
			>
				{renderMultilineTspans(layout.lines.join("\n"), layout.textX)}
			</text>
		</g>
	)
}

/** Coerce a stored xMin/yMin/etc. to a number. Stored values are
 *  `number | string` to accommodate categorical "values" mode; for the
 *  percent fallback we need a numeric coordinate. */
const toNumber = (v: number | string): number => {
	if (typeof v === "number") return v
	const n = Number(v)
	return Number.isFinite(n) ? n : 0
}

/** Apply a numeric domain pin to an already-built position scale. Mirrors
 *  ScatterPlot's helper of the same name so value-mode annotations honor
 *  the same axis-range overrides the renderer does. No-op for categorical /
 *  temporal scales (only quantitative + numeric-ordinal carry a numeric
 *  domain that an override can pin). */
const overrideLinearDomain = (
	scale: PositionScale,
	type: FieldType,
	min: number | undefined,
	max: number | undefined
): PositionScale => {
	if (min === undefined && max === undefined) return scale
	if (type !== "quantitative" && type !== "ordinal") return scale
	const linear = scale as { domain: (d?: [number, number]) => unknown }
	const [loCur, hiCur] = (linear.domain as () => [number, number])()
	linear.domain([min ?? loCur, max ?? hiCur])
	return scale
}

/** Draws a rectangle annotation's optional text label inside the box. The
 *  text block is centered VERTICALLY within the rect; horizontally it follows
 *  `textAlign`, inset from the box edge by `textPadding`. Renders nothing when
 *  the rectangle carries no (non-whitespace) text. Styling fields fall back to
 *  `DEFAULT_RECTANGLE_TEXT` so rectangles saved before text shipped still draw
 *  sensibly. Multi-line text (literal `\n`) stacks via shared `<tspan>`s. */
const AnnotationText = ({
	rect,
	left,
	top,
	width,
	height,
}: {
	rect: RectangleAnnotation
	left: number
	top: number
	width: number
	height: number
}) => {
	const text = rect.text ?? DEFAULT_RECTANGLE_TEXT.text
	if (text.trim().length === 0) return null
	const fontSize = rect.textFontSize ?? DEFAULT_RECTANGLE_TEXT.textFontSize
	const align = rect.textAlign ?? DEFAULT_RECTANGLE_TEXT.textAlign
	const padding = rect.textPadding ?? DEFAULT_RECTANGLE_TEXT.textPadding
	const anchor =
		align === "left" ? "start" : align === "right" ? "end" : "middle"
	const x =
		align === "left"
			? left + padding
			: align === "right"
				? left + width - padding
				: left + width / 2
	// Center the multi-line block vertically: a line box is `fontSize * 1.2`
	// tall, so the block spans `lines * lineHeight`. The first baseline sits one
	// `fontSize` below the block's top (matching the caption convention).
	const lineHeight = fontSize * 1.2
	const blockTop = top + (height - lineCount(text) * lineHeight) / 2
	const firstBaseline = blockTop + fontSize
	return (
		<text
			data-annotation-text={rect.id}
			x={x}
			y={firstBaseline}
			textAnchor={anchor}
			fontFamily={rect.textFontFamily ?? DEFAULT_RECTANGLE_TEXT.textFontFamily}
			fontSize={fontSize}
			fontWeight={rect.textFontWeight ?? DEFAULT_RECTANGLE_TEXT.textFontWeight}
			fill={rect.textColor ?? DEFAULT_RECTANGLE_TEXT.textColor}
		>
			{renderMultilineTspans(text, x)}
		</text>
	)
}

/** Renders user-defined rectangle annotations against a panel's inner
 *  rect. Percent-mode coordinates are plot-area-normalized:
 *    xMin=0 → left edge of plot   |   xMax=1 → right edge of plot
 *    yMin=0 → BOTTOM edge of plot (cartesian convention; flipped to SVG
 *             top-down internally)
 *    yMax=1 → TOP edge of plot
 *  Value-mode coordinates are fed through a position scale built to MATCH
 *  the panel renderer's axis scale — same share-aware row source
 *  (`xScaleRows` / `yScaleRows`), same per-axis domain override, same
 *  per-axis first-tick offset, same level order. Without that match a data-unit
 *  rectangle drifts from the marks: under shared axes it would otherwise
 *  be built from the panel's own (narrower) extent and land "all over the
 *  place" across panels.
 *  `layer` filters to only the rectangles requesting "behind" or "front"
 *  so the caller can interleave the renderer's marks between them. */
const AnnotationRects = ({
	rectangles,
	circles,
	lineSegments,
	inner,
	layer,
	xScaleRows,
	yScaleRows,
	axisFields,
	xDomainOverride,
	yDomainOverride,
	firstTickPxOffsetX,
	firstTickPxOffsetY,
	levelOrders,
	isRadar,
	radiusScale,
}: {
	rectangles: readonly RectangleAnnotation[]
	circles: readonly CircleAnnotation[]
	lineSegments: readonly LineSegmentAnnotation[]
	inner: Rect
	layer: "behind" | "front"
	xScaleRows: readonly Record<string, unknown>[]
	yScaleRows: readonly Record<string, unknown>[]
	axisFields: {
		xField: string | null
		yField: string | null
		xType: FieldType | null
		yType: FieldType | null
	}
	xDomainOverride?: { min?: number; max?: number }
	yDomainOverride?: { min?: number; max?: number }
	firstTickPxOffsetX?: number
	firstTickPxOffsetY?: number
	levelOrders: Record<string, readonly string[]>
	/** Radar panels render VALUE-mode circles themselves (RadarPlot owns the
	 *  radial scales), so skip them here to avoid a wrong (percent-fallback)
	 *  double-render. Percent-mode circles + all rectangles still render here.
	 *  Pies keep the percent-fallback render for any legacy value circles. */
	isRadar?: boolean
	/** Polar "Size panels by unit" factor (0..1) for this panel. The radar /
	 *  pie disc is drawn at `baseRadius · radiusScale` about the panel center,
	 *  but `inner` is uniform across panels — so percent annotations (sized off
	 *  `inner`) would stay the same size everywhere. Scaling them about the
	 *  panel center by this factor locks them to the disc, so they vary per
	 *  panel like the marks do. Undefined / 1 = no scaling (the default). */
	radiusScale?: number
}) => {
	// Stable, document-unique id so each panel's clip region is its own.
	const clipId = useId()
	const visibleRects = rectangles.filter((r) => r.zOrder === layer)
	const visibleCircles = circles.filter(
		(c) =>
			c.zOrder === layer && !(isRadar && c.coordSystem === "values")
	)
	// Value-mode lines on radar would need polar projection (RadarPlot owns
	// those scales); skip them here to avoid a wrong percent-fallback render,
	// matching the circle handling. Percent-mode lines still render.
	const visibleLines = lineSegments.filter(
		(l) => l.zOrder === layer && !(isRadar && l.coordSystem === "values")
	)
	if (
		visibleRects.length === 0 &&
		visibleCircles.length === 0 &&
		visibleLines.length === 0
	)
		return null
	// Lazily-built position scales for value-mode annotations. Match the
	// per-axis range to the panel's inner rect; y is inverted from SVG's
	// top-down to data-axis bottom-up so the user's "yMin" data value
	// renders at the BOTTOM of the rectangle. Rectangles and circles share
	// these scales (and the share-aware row source) so both track the marks.
	const xRange: [number, number] = [inner.x, inner.x + inner.width]
	const yRange: [number, number] = [inner.y + inner.height, inner.y]
	let xScale: PositionScale | null = null
	let yScale: PositionScale | null = null
	const needValues =
		visibleRects.some((r) => r.coordSystem === "values") ||
		visibleCircles.some((c) => c.coordSystem === "values") ||
		visibleLines.some((l) => l.coordSystem === "values")
	if (needValues && axisFields.xField && axisFields.xType) {
		const raws = xScaleRows.map((r) => r[axisFields.xField as string])
		xScale = overrideLinearDomain(
			makePositionScale(
				raws,
				axisFields.xType,
				xRange,
				levelOrders[axisFields.xField],
				{ firstTickPxOffset: firstTickPxOffsetX }
			),
			axisFields.xType,
			xDomainOverride?.min,
			xDomainOverride?.max
		)
	}
	if (needValues && axisFields.yField && axisFields.yType) {
		const raws = yScaleRows.map((r) => r[axisFields.yField as string])
		yScale = overrideLinearDomain(
			makePositionScale(
				raws,
				axisFields.yType,
				yRange,
				levelOrders[axisFields.yField],
				{ firstTickPxOffset: firstTickPxOffsetY }
			),
			axisFields.yType,
			yDomainOverride?.min,
			yDomainOverride?.max
		)
	}
	// Detect categorical-style scales (scalePoint, used for categorical
	// and string-ordinal axes). Their value-positions are point centers,
	// not band edges — `step()` gives the per-band span we need to
	// extend the annotation rectangle across the full bands.
	const isPointScale = (s: PositionScale | null): boolean =>
		s !== null && "step" in s && typeof (s as { step?: unknown }).step === "function"
	const pointStep = (s: PositionScale): number => {
		const step = (s as unknown as { step: () => number }).step()
		return Number.isFinite(step) ? step : 0
	}
	// "Size panels by unit" (polar): shrink percent annotations about the
	// panel center by the same factor the disc shrinks, so they track the
	// marks across differently-sized panels instead of staying full-panel.
	const s = radiusScale ?? 1
	const annoScaleTransform =
		Number.isFinite(s) && s > 0 && s !== 1
			? `translate(${inner.x + inner.width / 2} ${inner.y + inner.height / 2}) scale(${s}) translate(${-(inner.x + inner.width / 2)} ${-(inner.y + inner.height / 2)})`
			: undefined
	return (
		<g aria-hidden="true" pointerEvents="none">
			{/* Clip every annotation to this panel's plot area. A value-mode
			    rectangle whose data coords fall outside the panel's (possibly
			    narrow, independent-axis) domain keeps its true geometry — so
			    the configured min/max are honored — but only the in-bounds
			    portion paints. Fully out-of-bounds annotations clip to nothing
			    and draw no visible pixels. Percent-mode rects sit within
			    [0,1] of inner, so the clip is a no-op for them. */}
			<defs>
				<clipPath id={clipId}>
					<rect
						x={inner.x}
						y={inner.y}
						width={inner.width}
						height={inner.height}
					/>
				</clipPath>
			</defs>
			<g clipPath={`url(#${clipId})`}>
				<g transform={annoScaleTransform}>
				{visibleRects.map((r) => {
				const useValues = r.coordSystem === "values"
				let left: number, width: number
				let top: number, height: number
				if (useValues && xScale && axisFields.xType) {
					const a = applyPositionScale(xScale, r.xMin, axisFields.xType)
					const b = applyPositionScale(xScale, r.xMax, axisFields.xType)
					if (a === null || b === null) return null
					// For point-scale (categorical / string-ordinal) axes,
					// expand from the point's CENTER to its band's EDGES so
					// the rectangle covers the full categories the user
					// named — not just the strip between their centers.
					const pad = isPointScale(xScale) ? pointStep(xScale) / 2 : 0
					const lo = Math.min(a, b) - pad
					const hi = Math.max(a, b) + pad
					left = lo
					width = hi - lo
				} else {
					// Percent fallback (also used when value-mode is selected
					// but the axis field/type isn't available — e.g. pie
					// chart's missing axis).
					const x0 = Math.min(toNumber(r.xMin), toNumber(r.xMax))
					const x1 = Math.max(toNumber(r.xMin), toNumber(r.xMax))
					left = inner.x + inner.width * x0
					width = inner.width * (x1 - x0)
				}
				if (useValues && yScale && axisFields.yType) {
					const a = applyPositionScale(yScale, r.yMin, axisFields.yType)
					const b = applyPositionScale(yScale, r.yMax, axisFields.yType)
					if (a === null || b === null) return null
					const pad = isPointScale(yScale) ? pointStep(yScale) / 2 : 0
					const lo = Math.min(a, b) - pad
					const hi = Math.max(a, b) + pad
					top = lo
					height = hi - lo
				} else {
					// Percent fallback. SVG y is top-down; data convention has
					// y=0 at the BOTTOM of the plot — flip so yMax→top.
					const y0 = Math.min(toNumber(r.yMin), toNumber(r.yMax))
					const y1 = Math.max(toNumber(r.yMin), toNumber(r.yMax))
					top = inner.y + inner.height * (1 - y1)
					height = inner.height * (y1 - y0)
				}
				const dash = dashArrayFor(r.borderDash) ?? undefined
				return (
					<g key={r.id}>
						<rect
							data-annotation={r.id}
							data-annotation-coord={r.coordSystem}
							x={left}
							y={top}
							width={width}
							height={height}
							fill={r.backgroundColor}
							fillOpacity={r.backgroundOpacity}
							stroke={r.borderColor}
							strokeWidth={r.borderThickness}
							strokeOpacity={r.borderOpacity}
							strokeDasharray={dash}
						/>
						<AnnotationText
							rect={r}
							left={left}
							top={top}
							width={width}
							height={height}
						/>
					</g>
				)
			})}
			{visibleCircles.map((c) => {
				// Reuse the same per-panel scales as the rectangles so a
				// data-unit circle tracks the marks across facets. Returns
				// null when the circle can't be placed (e.g. a data-unit
				// radius against a categorical axis).
				const geom = computeCirclePixels(c, inner, {
					xScale,
					yScale,
					xType: axisFields.xType,
					yType: axisFields.yType,
				})
				if (geom === null) return null
				const dash = dashArrayFor(c.borderDash) ?? undefined
				return (
					<circle
						key={c.id}
						data-annotation-circle={c.id}
						data-annotation-coord={c.coordSystem}
						cx={geom.cx}
						cy={geom.cy}
						r={geom.r}
						fill={c.backgroundColor}
						fillOpacity={c.backgroundOpacity}
						stroke={c.borderColor}
						strokeWidth={c.borderThickness}
						strokeOpacity={c.borderOpacity}
						strokeDasharray={dash}
					/>
				)
			})}
				{visibleLines.map((l) => {
					// Reuse the same per-panel scales as the rectangles so a
					// data-unit line tracks the marks across facets. Returns
					// null when an endpoint can't be projected.
					const geom = computeLineSegmentPixels(l, inner, {
						xScale,
						yScale,
						xType: axisFields.xType,
						yType: axisFields.yType,
					})
					if (geom === null) return null
					const dash = dashArrayFor(l.lineDash) ?? undefined
					return (
						<line
							key={l.id}
							data-annotation-line={l.id}
							data-annotation-coord={l.coordSystem}
							x1={geom.x1}
							y1={geom.y1}
							x2={geom.x2}
							y2={geom.y2}
							stroke={l.lineColor}
							strokeWidth={l.lineThickness}
							strokeOpacity={l.lineOpacity}
							strokeDasharray={dash}
						/>
					)
				})}
				</g>
			</g>
		</g>
	)
}
// Re-export shared font helpers don't fit here; rely on the renderer's
// own font resolution.
export type { ExtraMargin }
