import {
	colSizingMeaningful,
	migrateProportionalSizing,
	migrateShareValue,
	rowSizingMeaningful,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import type {
	SolverInput,
	SolverPanelInput,
} from "../../../lib/facetLayoutSolver"
import {
	titleAlignmentOf,
	type FontConfig,
	type LabelAlignment,
	type LabelsConfig,
} from "../../../lib/labelsConfig"
import type { FacetPanels } from "../../../lib/resolveFacetPanels"
import type { Encodings } from "../../../lib/types"
import type { resolveFacetTitleStyles } from "./facetTitleStyles"
import { measureMaxLabelWidth } from "./measureText"

const FACET_LABEL_HEIGHT_PX = 20
/** Polar facet-label band. Polar charts (radar / pie) don't carry x-axis
 *  tick labels at the top of the panel so the label can sit closer to
 *  the chart without crowding anything; shaving 4px off each row's
 *  facet band materially reduces between-row whitespace in 2×N grids. */
const FACET_LABEL_HEIGHT_PX_POLAR = 16

/** Assemble the SolverInput PlotCanvas feeds to solveFacetLayout: canvas
 *  dims, per-panel inputs, title/header text rects, strip gating under
 *  hide-empty compaction, share/proportional-sizing flags, and the extra
 *  margins (data-label reserve, caption band). Pure: PlotCanvas calls this
 *  inside its `spec` useMemo, whose dep array governs recomputation. */
export const buildSolverInput = ({
	bounds,
	isFaceted,
	isPolar,
	facetCfg,
	panelData,
	panelInputs,
	channelConfigs,
	labels,
	encodings,
	titleFont,
	subtitleFont,
	xAxisTitleFont,
	yAxisTitleFont,
	facetTitles,
	sharedXAxisTitle,
	sharedYAxisTitle,
	dataLabelOverflow,
	captionReserve,
}: {
	bounds: { width: number; height: number }
	isFaceted: boolean
	isPolar: boolean
	facetCfg: FacetConfig
	panelData: FacetPanels
	panelInputs: SolverPanelInput[]
	channelConfigs: ChannelConfigs
	labels: LabelsConfig
	encodings: Encodings
	titleFont: FontConfig
	subtitleFont: FontConfig
	xAxisTitleFont: FontConfig
	yAxisTitleFont: FontConfig
	facetTitles: ReturnType<typeof resolveFacetTitleStyles>
	sharedXAxisTitle: string
	sharedYAxisTitle: string
	dataLabelOverflow: { left: number; right: number }
	captionReserve: number
}): SolverInput => {
	const {
		facetTitleFont,
		facetColTitleFont,
		facetColTitleAlign,
		facetColTitleOffset,
		facetRowTitleFont,
		facetRowTitleAlign,
		facetRowTitleVAlign,
		facetRowTitleOffset,
		facetPanelTitleFont,
		facetPanelTitleAlign,
	} = facetTitles
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
					align: titleAlignmentOf(labels, "title"),
					offsetX: labels.titleOffsets?.title?.x ?? 0,
					offsetY: labels.titleOffsets?.title?.y ?? 0,
				}
			: undefined,
		chartSubtitle: labels.subtitle
			? {
					text: labels.subtitle,
					fontSize: subtitleFont.size,
					align: titleAlignmentOf(labels, "subtitle"),
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
	return input
}
