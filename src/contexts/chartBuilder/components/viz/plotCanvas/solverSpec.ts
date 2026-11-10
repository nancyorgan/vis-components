import { max } from "d3-array"
import type { AnnotationReserve } from "./annotationReserve"
import {
	axisFlipped,
	colSizingMeaningful,
	DEFAULT_TICKMARK_CONFIG,
	migrateProportionalSizing,
	migrateShareValue,
	rowSizingMeaningful,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { estimateLongestLineWidth } from "../../../lib/estimateMargins"
import {
	FACET_SIDE_BAND_PAD,
	type FacetLabelInput,
	type SolverInput,
	type SolverPanelInput,
	type TitleOverhang,
} from "../../../lib/facetLayoutSolver"
import {
	chartTitlePrefixOf,
	hasChartTitle,
	hiddenFacetTitles,
	titleAlignmentOf,
	type FontConfig,
	type LabelAlignment,
	type LabelsConfig,
} from "../../../lib/labelsConfig"
import type { FacetPanels } from "../../../lib/resolveFacetPanels"
import type { Encodings } from "../../../lib/types"
import type { resolveFacetTitleStyles } from "./facetTitleStyles"
import { measureMaxLabelWidth, measureTitleWidth } from "./measureText"
import { lineCount } from "../../../lib/multilineText"

/** The text a panel's facet-label band shows. Compacted grid panels carry
 *  their compact label (row value / col value / "row · col" depending on
 *  which strip survived); wrap mode shows the raw panel key. Shared by the
 *  renderer (PlotCanvas) and the band sizing below so they can't drift. */
export const panelLabelTextOf = (panelData: FacetPanels, key: string): string =>
	panelData.mode === "grid"
		? (panelData.compact?.panels[key]?.label ?? key)
		: key

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
	annotationReserve,
	titlePrefixFont,
	titleOverhang,
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
	/** Per-side room for annotations placed past the plot edge — see
	 *  `annotationReserve.ts`. Left / right add to the data-label reserve
	 *  (and share its fit-mode clamp); bottom adds to the caption band; top
	 *  is the only top-side reserve. */
	annotationReserve: AnnotationReserve
	/** Resolved font of the chart-title prefix run (`resolveTitlePrefixFont`),
	 *  for measuring the title's first line; the prefix TEXT comes from
	 *  `labels`. Omitted = the prefix measures in the title font. */
	titlePrefixFont?: FontConfig
	/** Room past the canvas edges the chart title / subtitle may paint into
	 *  (the column beside a left / right legend) — `SolverInput.titleOverhang`.
	 *  Omitted = none. */
	titleOverhang?: TitleOverhang
}): SolverInput => {
	const {
		facetTitleFont,
		facetTitleOffset,
		facetTitleAngle,
		facetTitlePlacement,
		facetTitleVAlign,
		facetColTitleFont,
		facetColTitleAlign,
		facetColTitleOffset,
		facetColTitleAngle,
		facetRowTitleFont,
		facetRowTitleAlign,
		facetRowTitleVAlign,
		facetRowTitleOffset,
		facetRowTitleAngle,
		facetPanelTitleFont,
		facetPanelTitleAlign,
		facetPanelTitleOffset,
		facetPanelTitleAngle,
		facetPanelTitlePlacement,
		facetPanelTitleVAlign,
	} = facetTitles
	// Recompute share modes and per-axis sizing flags at this scope
	// (panelInputs scopes them privately). We need them to gate the
	// panelWidth / panelHeight overrides — when proportional sizing
	// is actively driving a dimension, the explicit dim must be
	// ignored at render time even if the cfg still carries a stale
	// value (loaded saved visual, sidebar collapsed, etc.).
	const shareXModeSpec: "none" | "perGroup" | "all" = isFaceted
		? migrateShareValue(facetCfg.shareX)
		: "none"
	const shareYModeSpec: "none" | "perGroup" | "all" = isFaceted
		? migrateShareValue(facetCfg.shareY)
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
	// A label with explicit line breaks grows its band upward (one line step
	// per extra line; every label's bottom line at the single-line position),
	// and the band is per-cell chrome shared by every panel, so size it for
	// the tallest label.
	const panelLabelTexts = panelInputs.map((p) => panelLabelTextOf(panelData, p.key))
	const facetLabelLines = Math.max(
		1,
		max(panelLabelTexts, (t) => lineCount(t)) ?? 1,
	)
	// Widest title line at the slot's font, for the solver's keep-in-view
	// pass and the upright side band's width. Canvas-measured like the row
	// strip, at the weight the title DRAWS at (every facet-title render
	// site defaults an unset weight to 500 — measuring at 400 under-reads
	// a long title by a few px); the character estimate stands in where
	// no canvas exists.
	const FACET_TITLE_DEFAULT_WEIGHT = 500
	const widestPanelLabel = (font: FontConfig): number =>
		measureMaxLabelWidth(
			panelLabelTexts,
			font.family,
			font.size,
			font.weight ?? FACET_TITLE_DEFAULT_WEIGHT,
			font.italic,
		) || (max(panelLabelTexts, (t) => estimateLongestLineWidth(t, font.size)) ?? 0)
	// Grow the band so a larger user-chosen font doesn't clip into the
	// panel; small fonts keep the pinned default that defeats font-metric
	// drift. The same single-line band is the width of a VERTICAL side band
	// (Placement left / right); an upright side band is as wide as the
	// widest title plus its padding, so the title never runs off the canvas.
	const facetLabelBand = (font: FontConfig): number =>
		Math.max(
			isPolar ? FACET_LABEL_HEIGHT_PX_POLAR : FACET_LABEL_HEIGHT_PX,
			Math.ceil(font.size * 1.4),
		)
	const facetLabelInputFor = (
		font: FontConfig,
		align: LabelAlignment,
		placement: typeof facetTitlePlacement,
		verticalAlign: typeof facetTitleVAlign,
		offset: { x: number; y: number },
		angle: number,
	): FacetLabelInput => {
		const textWidth = widestPanelLabel(font)
		return {
			fontSize: font.size,
			lines: facetLabelLines,
			height: facetLabelBand(font),
			align,
			side: placement.side,
			width:
				placement.side === "top"
					? undefined
					: placement.horizontal
						? Math.ceil(textWidth) + 2 * FACET_SIDE_BAND_PAD
						: facetLabelBand(font),
			horizontal: placement.side !== "top" && placement.horizontal === true,
			verticalAlign,
			textWidth,
			offsetX: offset.x,
			offsetY: offset.y,
			angleDeg: angle,
		}
	}
	const facetLabelInput = facetLabelInputFor(
		facetTitleFont,
		(labels.titleAlignments?.facetTitle as LabelAlignment) ?? "center",
		facetTitlePlacement,
		facetTitleVAlign,
		facetTitleOffset,
		facetTitleAngle,
	)
	// Compacted-grid variant of the band above: same shape, but styled by
	// the `facetPanelTitle` slot (layered over `facetTitle`), so compact
	// per-panel titles can diverge from the wrap-mode / strip styling.
	const facetPanelLabelInput = facetLabelInputFor(
		facetPanelTitleFont,
		facetPanelTitleAlign,
		facetPanelTitlePlacement,
		facetPanelTitleVAlign,
		facetPanelTitleOffset,
		facetPanelTitleAngle,
	)
	// Header-strip titles carry their measured width + paint-time angle for
	// the same keep-in-view pass.
	const stripTextWidth = (text: string, font: FontConfig): number =>
		measureMaxLabelWidth(
			[text],
			font.family,
			font.size,
			font.weight ?? FACET_TITLE_DEFAULT_WEIGHT,
			font.italic,
		) || estimateLongestLineWidth(text, font.size)
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
	// "Titles shown" facet unchecks: a hidden area is dropped from the
	// solver input, so it neither draws nor reserves its band / strip.
	// Unlike the compaction veto above, this is display-only — the
	// share-scale gates below keep reading the *StripSurvives booleans.
	const facetHidden = hiddenFacetTitles(
		labels,
		Boolean(encodings.facetCol?.field) && Boolean(encodings.facetRow?.field),
	)
	// The chart title's prefix run rides its first line in its own font, so
	// the measured width below includes it (see measureTitleWidth).
	const prefixText = chartTitlePrefixOf(labels)
	const prefixRun =
		prefixText !== null
			? { text: prefixText, ...(titlePrefixFont ?? titleFont) }
			: null
	const input: SolverInput = {
		containerWidth: bounds.width,
		containerHeight: bounds.height,
		rows: panelData.grid.rows,
		cols: panelData.grid.cols,
		panels: panelInputs,
		// A title band exists for typed text OR an active prefix (the prefix
		// rides the first line, so the band's height is the same either way).
		chartTitle: hasChartTitle(labels)
			? {
					text: labels.title,
					fontSize: titleFont.size,
					align: titleAlignmentOf(labels, "title"),
					offsetX: labels.titleOffsets?.title?.x ?? 0,
					offsetY: labels.titleOffsets?.title?.y ?? 0,
					// Canvas-measured so the solver can keep the title in view
					// horizontally (LAYOUT.md §7); 0 (no canvas) = unmeasured.
					textWidth: measureTitleWidth(labels.title, titleFont, prefixRun),
				}
			: undefined,
		chartSubtitle: labels.subtitle
			? {
					text: labels.subtitle,
					fontSize: subtitleFont.size,
					align: titleAlignmentOf(labels, "subtitle"),
					offsetX: labels.titleOffsets?.subtitle?.x ?? 0,
					offsetY: labels.titleOffsets?.subtitle?.y ?? 0,
					textWidth: measureTitleWidth(labels.subtitle, subtitleFont),
				}
			: undefined,
		titleOverhang,
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
		// Tick-label "Adjust position" nudges, with the legacy single
		// `offset` folded in exactly like Axes.tsx's labelDx/labelDy
		// (legacy y: positive = left; legacy x: positive = down). The
		// solver widens the axis-title gaps by the toward-the-title
		// component so titles keep clear of the shifted labels.
		yTickLabelDx:
			channelConfigs.y?.offsetX ?? -(channelConfigs.y?.offset ?? 0),
		xTickLabelDy: channelConfigs.x?.offsetY ?? (channelConfigs.x?.offset ?? 0),
		// Tick-mark lengths: Axes.tsx insets the labels by the tick length
		// plus a pad, so a longer tick pushes the labels' rendered edge
		// toward the title and the gap must track it.
		xTickLength:
			channelConfigs.x?.tickmarks?.length ?? DEFAULT_TICKMARK_CONFIG.length,
		yTickLength:
			channelConfigs.y?.tickmarks?.length ?? DEFAULT_TICKMARK_CONFIG.length,
		// Axis sides ("Side" in each axis panel's Spine section): the solver
		// moves the axis chrome and the shared title to the chosen edge and
		// faceted panels draw the shared axis on that edge's row / column.
		xAxisTop: axisFlipped("x", channelConfigs.x?.side),
		yAxisRight: axisFlipped("y", channelConfigs.y?.side),
		facetLabel: facetHidden.panel
			? undefined
			: panelData.mode === "grid"
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
			colStripSurvives &&
			!facetHidden.col
				? panelData.colValues.map((v) => ({
						text: v,
						fontSize: facetColTitleFont.size,
						align: facetColTitleAlign,
						offsetX: facetColTitleOffset.x,
						offsetY: facetColTitleOffset.y,
						textWidth: stripTextWidth(v, facetColTitleFont),
						angleDeg: facetColTitleAngle,
					}))
				: undefined,
		rowHeaders:
			panelData.mode === "grid" &&
			Boolean(encodings.facetRow?.field) &&
			rowStripSurvives &&
			!facetHidden.row
				? panelData.rowValues.map((v) => ({
						text: v,
						fontSize: facetRowTitleFont.size,
						align: facetRowTitleAlign,
						verticalAlign: facetRowTitleVAlign,
						offsetX: facetRowTitleOffset.x,
						offsetY: facetRowTitleOffset.y,
						textWidth: stripTextWidth(v, facetRowTitleFont),
						angleDeg: facetRowTitleAngle,
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
			rowStripSurvives &&
			!facetHidden.row
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
		extraRightMargin: dataLabelOverflow.right + annotationReserve.right,
		extraLeftMargin: dataLabelOverflow.left + annotationReserve.left,
		extraBottomMargin: captionReserve + annotationReserve.bottom,
		extraTopMargin: annotationReserve.top,
		isPolar,
	}
	return input
}
