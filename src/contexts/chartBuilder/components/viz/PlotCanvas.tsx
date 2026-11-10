import { applyMirrorSign, resolveMirrorDirection } from "../../lib/mirrorAxis"
import { useEffect, useId, useMemo } from "react"
import useMeasure from "react-use-measure"
import { useAtomValue, useSetAtom } from "jotai"
import { axisFieldsFor, hasXAxis, hasYAxis } from "../../lib/axisFields"
import { defaultAxisTitles } from "../../lib/axisTitleDefaults"
import { resolveHistogramMeasure } from "../../lib/histogramMeasure"
import {
	DEFAULT_FACET_CONFIG,
	migrateShareValue,
	type FacetConfig,
} from "../../lib/channelConfig"
import { getChartModeDef, type ChartMode } from "../../lib/chartMode"
import { MODE_RENDERERS } from "./rendererRegistry"
import { effectiveType } from "../../lib/fieldType"
import { histogramMeasureColorDomain } from "../../lib/histogramMeasureColor"
import {
	solveFacetLayout,
	type FacetLayoutSpec,
	type SolverPanelInput,
	NO_TITLE_OVERHANG,
	type TitleOverhang,
} from "../../lib/facetLayoutSolver"
import {
	resolveTextFont,
	chartTitlePrefixOf,
	resolveTitleFont,
	resolveTitlePrefixFont,
} from "../../lib/labelsConfig"
import {
	DEFAULT_CAPTION_CONFIG,
	type CaptionConfig,
} from "../../lib/captionConfig"
import { type ExtraMargin } from "../../lib/plotLayout"
import { facetPanelRow, resolveFacetPanels } from "../../lib/resolveFacetPanels"
import { PLOT_SVG_ID } from "../../lib/captureThumbnail"
import {
	chartAccessibleTitle,
	resolveChartDescription,
} from "../../lib/accessibilityConfig"
import {
	currentAccessibilityConfigAtom,
	currentAnnotationsAtom,
	currentCaptionConfigAtom,
	currentLabelsAtom,
	currentVisualNameAtom,
	currentRenderedCaptionBoxAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	renderedLabelsAtom,
	currentMapConfigAtom,
	currentRenderedFigureSlackAtom,
	currentRenderedLayoutVersionAtom,
	currentRenderedPanelInnerDimsAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	renderDataLabelsConfigAtom,
	renderDataLabelsEncodingsAtom,
} from "../../store/renderConfigs"
import { DEFAULT_DATA_LABELS_CONFIG } from "../../lib/channelConfig"
import type { FieldType } from "../../lib/types"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { computeDataLabelOverflow } from "./plotCanvas/dataLabelReserve"
import { useFontsVersion } from "./plotCanvas/useFontsVersion"
import { resolveFacetTitleStyles } from "./plotCanvas/facetTitleStyles"
import { buildSolverPanelInputs } from "./plotCanvas/solverPanelInputs"
import { buildSolverInput } from "./plotCanvas/solverSpec"
import {
	computeGroupMeasureMax,
	computeGroupMeasureMin,
	type MirrorRows,
	identityRows,
	computePanelRadiusScale,
} from "./plotCanvas/shareScales"
import {
	computePanelMeasureMax,
	groupRowsByShareGroup,
} from "./plotCanvas/panelGrouping"
import { resolvePanelRenderInputs } from "./plotCanvas/panelRenderInputs"
import { SharedText } from "./plotCanvas/SharedText"
import {
	CaptionOverlay,
	captionDrawnExtent,
	captionReservePx,
	measureCaptionBox,
	positionCaptionBox,
} from "./plotCanvas/captionLayout"
import type { PanelAnnotationScaleInputs } from "./plotCanvas/annotationLayout"
import {
	measureAnnotationSpill,
	NO_ANNOTATION_RESERVE,
	solveWithAnnotationReserves,
	type AnnotationReserve,
} from "./plotCanvas/annotationReserve"
import {
	FacetPanel,
	type SharedPanelRenderInputs,
} from "./plotCanvas/FacetPanel"
import { StripHeaders } from "./plotCanvas/StripHeaders"
import { measureScrollbarWidth } from "../../lib/scrollbarWidth"

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

export const PlotCanvas = ({
	titleOverhang = NO_TITLE_OVERHANG,
}: {
	/** Room past the canvas's left / right edge the chart title / subtitle
	 *  may paint into — the column beside a left / right edge legend, which
	 *  ChartCanvas measures. The SVG lets exactly those two texts escape its
	 *  box (see the canvas clip below); `SolverInput.titleOverhang`. */
	titleOverhang?: TitleOverhang
} = {}) => {
	// Layout size, not the transformed rect — see ChartCanvas.
	const [ref, bounds] = useMeasure({ offsetSize: true })
	// Clip for everything but the chart title / subtitle (see the SVG below).
	const canvasClipId = useId()
	// The figure's accessible name (`<desc>` below). Sanitized so the id is a
	// valid XML name in SVG exports (React's ids carry colons).
	const descId = `vc-chart-desc-${useId().replace(/[^\w-]/g, "")}`
	// AUTHORED title / subtitle — not `renderedLabelsAtom`: a title hidden by
	// "Titles shown" still describes the chart to someone who can't see it.
	const authoredLabels = useAtomValue(currentLabelsAtom)
	const visualName = useAtomValue(currentVisualNameAtom)
	const accessibility = useAtomValue(currentAccessibilityConfigAtom)
	const a11yTexts = {
		title: authoredLabels.title,
		subtitle: authoredLabels.subtitle,
		visualName,
	}
	const description = resolveChartDescription(accessibility, a11yTexts)
	const dataset = useCurrentDatasetView()
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	const labels = useAtomValue(renderedLabelsAtom)
	const dataLabels = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...useAtomValue(renderDataLabelsConfigAtom),
	}
	const dataLabelsEncodings = useAtomValue(renderDataLabelsEncodingsAtom)
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
	const setLayoutVersion = useSetAtom(currentRenderedLayoutVersionAtom)
	const setRenderedCaptionBox = useSetAtom(currentRenderedCaptionBoxAtom)
	// Bumps when webfonts finish loading so the canvas-measured widths below
	// (tick labels, data-label reserve) are recomputed against the real face
	// instead of the fallback they may have been measured with on first paint.
	const fontsVersion = useFontsVersion()
	// Extra canvas room reserved on the left/right so edge data labels stay
	// in view — the estimate itself lives in computeDataLabelOverflow. Deps
	// are primitives because `dataLabels` is freshly spread each render (the
	// new-every-render object would defeat memoization).
	const dataLabelOverflow = useMemo(
		() =>
			computeDataLabelOverflow({
				dataset,
				encodings,
				overrides,
				channelConfigs,
				mapConfig,
				dataLabels,
				dataLabelsEncodings,
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the callback forwards the whole freshly-spread `dataLabels` / `dataLabelsEncodings` objects, but every field computeDataLabelOverflow reads from them is listed individually below; depending on the spread object itself (new every render) would defeat the memo
		[
			dataset,
			dataLabels.alignment,
			dataLabels.xOffset,
			dataLabels.fontSize,
			dataLabels.fontFamily,
			dataLabels.fontWeight,
			dataLabels.italic,
			dataLabels.sizeMax,
			// Stored maps — stable references unless a per-variable size is edited.
			dataLabels.fieldSizes,
			dataLabels.pieces,
			dataLabels.decimals,
			dataLabels.labelTemplate,
			dataLabels.combineVariables,
			dataLabels.fieldAlignments,
			dataLabels.fieldOffsets,
			dataLabels.fieldFormats,
			// Endpoint-mode primitives + override blocks. The blocks are stable
			// references (module default `{}` or the atom's stored object), so
			// they're safe memo deps — unlike the freshly-spread `dataLabels`.
			dataLabels.labelPoints,
			dataLabels.onlyLastLabel,
			dataLabels.fieldLabelPoints,
			dataLabels.firstLabel,
			dataLabels.lastLabel,
			// Stored array / map — stable references unless the rules are edited.
			dataLabels.positionRules,
			dataLabels.fieldPositionRules,
			dataLabels.wrapText,
			dataLabels.wrapMaxChars,
			dataLabels.fieldLayouts,
			// The render gate reads the (inherited or picked) position fields.
			dataLabelsEncodings.x?.field,
			dataLabelsEncodings.y?.field,
			dataLabelsEncodings.angle?.field,
			dataLabelsEncodings.value?.field,
			dataLabelsEncodings.value?.multiField,
			dataLabelsEncodings.value?.fields,
			dataLabelsEncodings.size?.field,
			// Whole `encodings` (covers the length/y fallback fields) + the geo
			// gate's mode-detection inputs, mirroring the `mode` memo's own deps.
			encodings,
			overrides,
			channelConfigs,
			mapConfig,
			// Re-measure once the label font has actually loaded.
			fontsVersion,
		],
	)

	const titleFont = resolveTitleFont(
		labels.baseFont,
		"primary",
		labels.fontOverrides?.title
	)
	// Chart-title prefix ("FIGURE 5."): its font layers over the RESOLVED
	// title font so unset fields match the title exactly.
	const titlePrefixText = chartTitlePrefixOf(labels)
	const titlePrefixFont = resolveTitlePrefixFont(
		titleFont,
		labels.baseFont.titles,
		labels.titlePrefix?.font
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
	// Facet-title style slots (shared + per-strip col/row + per-panel
	// variants) — the layered resolution lives in resolveFacetTitleStyles.
	// The bundle is also forwarded whole to buildSolverInput below.
	const facetTitles = resolveFacetTitleStyles(labels, encodings)
	const {
		facetTitleFont,
		facetColTitleFont,
		facetRowTitleFont,
		facetPanelTitleFont,
	} = facetTitles
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
		// dataset/overrides change rarely; recomputing on every render is fine.
		// Every config-gated detection input must be listed here: the histogram
		// toggles (bars-x/-y), the hierarchy Layout picker (packed circles /
		// treemap / sunburst / chord / sankey) and the Length panel's "Draw as"
		// (segments ⇄ the bar + marks combo) — omitting one means the picker
		// appears dead until the next remount.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			encodings,
			dataset,
			overrides,
			channelConfigs.x?.histogram,
			channelConfigs.y?.histogram,
			channelConfigs.connection?.hierarchyLayout,
			channelConfigs.length?.render,
			mapConfig,
		]
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
		const { xField, yField } = axisFieldsFor(mode, encodings)
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
	// Three-state title: `undefined` = not customized → the default the
	// Labels panel shows in its box (`defaultAxisTitles`: the axis's field,
	// or "Count" / "Density" on a histogram's measure axis), faceted or not —
	// a single-panel chart draws its titles through this shared strip too
	// (FacetPanel turns the per-panel titles off), so what the box shows is
	// what the figure draws; `""` = user cleared it → draw no title (so the
	// `!== undefined` check, not a truthiness check, gates the custom/blank
	// branch).
	const axisTitleDefaults = defaultAxisTitles(
		mode,
		encodings,
		dataset
			? resolveHistogramMeasure(
					encodings,
					(n) => effectiveType(dataset, n, overrides),
					channelConfigs
				)
			: null
	)
	const sharedXAxisTitle = (() => {
		if (!hasXAxis(mode)) return ""
		if (labels.xAxisTitle !== undefined) return labels.xAxisTitle
		return axisTitleDefaults.x
	})()
	const sharedYAxisTitle = (() => {
		if (!hasYAxis(mode)) return ""
		if (labels.yAxisTitle !== undefined) return labels.yAxisTitle
		return axisTitleDefaults.y
	})()

	// ─── Per-panel label sample for solver margin estimation ──────────────
	const panelInputs = useMemo<SolverPanelInput[]>(
		() =>
			buildSolverPanelInputs({
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
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the callback forwards whole objects (channelConfigs, facetCfg, tickFont, bounds) to buildSolverPanelInputs, but the deps below list exactly the fields it reads — including the channelConfigs.x/.y parent-object choice the comment inside explains; widening to the whole objects would over-invalidate
		[
		dataset,
		encodings,
		isFaceted,
		overrides,
		panelData,
		// The mode picks which encoding each axis draws and whether an axis
		// is the stacked measure axis; the stack channels' configs carry
		// the Stack / Group / Overlay choice that decides the measure max.
		mode,
		channelConfigs.hue,
		channelConfigs.pattern,
		channelConfigs.brightness,
		channelConfigs.opacity,
		channelConfigs.saturation,
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
		// Tick-label widths are canvas-measured with the tick font; re-run
		// once that font has actually loaded.
		fontsVersion,
		],
	)

	// ─── Tri-state share-axis: resolve modes + per-group row sources ──────
	//
	// shareXMode / shareYMode are the migrated tri-state ("none" / "perGroup"
	// / "all"); colRowsByColKey / rowRowsByRowKey are the per-column /
	// per-row row unions used under "perGroup", keyed by share-group key
	// (facet value in grid mode — see panelGroupKeys). Computed once for the
	// whole render so every panel below picks its scale source via the same
	// logic.
	const shareXMode: "none" | "perGroup" | "all" = isFaceted
		? migrateShareValue(facetCfg.shareX)
		: "none"
	const shareYMode: "none" | "perGroup" | "all" = isFaceted
		? migrateShareValue(facetCfg.shareY)
		: "none"
	// Empty before a data set loads — this block now runs ahead of the
	// no-data early return so the annotation reserve below can use it.
	const allDatasetRows = dataset?.rows ?? []
	const { colRowsByColKey, rowRowsByRowKey } = groupRowsByShareGroup(panelData)

	// Shared measure-axis max per panel for bar / area charts — see
	// computeGroupMeasureMax (empty when not bar/area or share mode "none").
	const measureAxis = mode.canvas.measureAxis
	// "Use a mirrored axis" (bar measure axis): the flag lives on the measure
	// axis's config. `mirrorActive` swaps that axis's pinned bounds to the
	// mirror's side maxes; `mirrorRows` applies the direction sign to a
	// panel's rows so the shared floor / ceiling match the bars the renderer
	// draws (BarPlot runs the same `applyMirrorSign` before aggregating).
	// Gated on the mode trait — the flag is inert on every other renderer.
	const measureAxisConfig = measureAxis ? channelConfigs[measureAxis] : undefined
	// A histogram's count axis is never mirrored (BarPlot ignores the flag
	// there), so its pinned bounds must not swap to the side maxes either.
	const categoryAxis =
		measureAxis === "x" ? "y" : measureAxis === "y" ? "x" : null
	const categoryField = categoryAxis ? encodings[categoryAxis]?.field : undefined
	const histogramBars =
		categoryAxis !== null &&
		!!categoryField &&
		channelConfigs[categoryAxis]?.histogram?.enabled === true &&
		getType(categoryField) === "quantitative"
	const mirrorActive =
		measureAxis !== null &&
		mode.canvas.supportsNegativeMeasure === true &&
		!histogramBars &&
		measureAxisConfig?.mirror?.enabled === true &&
		!!encodings.length?.field
	const mirrorDirection = mirrorActive
		? resolveMirrorDirection(
				measureAxisConfig?.mirror,
				allDatasetRows,
				(name) => getType(name) ?? "categorical",
				levelOrders
			)
		: null
	const mirrorMeasureField = mode.canvas.resolveMeasureField?.(encodings) ?? null
	const mirrorRows: MirrorRows =
		mirrorDirection && mirrorMeasureField
			? (rows) => applyMirrorSign(rows, mirrorMeasureField, mirrorDirection)
			: identityRows
	const groupMeasureMaxByKey = computeGroupMeasureMax({
		mode,
		measureAxis,
		shareXMode,
		shareYMode,
		encodings,
		channelConfigs,
		panelData,
		getType,
		mirrorRows,
	})
	// Its mirror for the axis floor — non-empty only for modes whose marks
	// can point below zero (bars). See computeGroupMeasureMin.
	const groupMeasureMinByKey = computeGroupMeasureMin({
		mode,
		measureAxis,
		shareXMode,
		shareYMode,
		encodings,
		channelConfigs,
		panelData,
		getType,
		mirrorRows,
	})


	// Polar "Size panels by unit": per-panel 0..1 drawn-radius factors — see
	// computePanelRadiusScale (empty when the feature is off).
	const panelRadiusScale = computePanelRadiusScale({
		isPolar,
		isFaceted,
		facetCfg,
		encodings,
		panelData,
		mode,
	})

	// Everything `resolvePanelRenderInputs` reads besides the panel itself —
	// assembled once so the annotation reserve below and every FacetPanel
	// resolve their scale rows / domain overrides from the same inputs.
	const sharedPanelInputs: SharedPanelRenderInputs = {
		panelData,
		isPolar,
		shareXMode,
		shareYMode,
		allDatasetRows,
		colRowsByColKey,
		rowRowsByRowKey,
		measureAxis,
		axisFields,
		channelConfigs,
		facetCfg,
		groupMeasureMaxByKey,
		groupMeasureMinByKey,
		panelRadiusScale,
		mirrorActive,
	}

	// ─── Annotation reserve inputs ────────────────────────────────────────
	// Per-panel scale inputs for the annotation layout — the same share-aware
	// row sources and domain overrides each FacetPanel resolves below, built
	// here (ahead of the solve) so the solver can measure how far annotations
	// spill past the canvas and reserve room for them. Empty when the visual
	// has no annotations, which keeps the solve single-pass.
	const isRadar = mode.canvas.valueAnnotationsInRenderer ?? false
	const hasAnnotations =
		annotations.rectangles.length > 0 ||
		(annotations.circles?.length ?? 0) > 0 ||
		(annotations.lineSegments?.length ?? 0) > 0 ||
		(annotations.texts?.length ?? 0) > 0 ||
		(annotations.images?.length ?? 0) > 0
	const annotationScaleInputsByPanel = useMemo(() => {
		const map = new Map<string, PanelAnnotationScaleInputs>()
		if (!hasAnnotations) return map
		for (const pi of panelInputs) {
			const rows = panelData.rowsByValue.get(pi.key) ?? []
			const r = resolvePanelRenderInputs({ p: pi, ...sharedPanelInputs })
			map.set(pi.key, {
				xScaleRows: r.xScaleRows ?? rows,
				yScaleRows: r.yScaleRows ?? rows,
				xDomainOverride:
					measureAxis === "x"
						? { min: r.measureMinOverride, max: r.measureMaxOverride }
						: { min: r.xMinOverride, max: r.xMaxOverride },
				yDomainOverride:
					measureAxis === "y"
						? { min: r.measureMinOverride, max: r.measureMaxOverride }
						: { min: r.yMinOverride, max: r.yMaxOverride },
				radiusScale: r.radiusScale,
			})
		}
		return map
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the share-mode / measure-group maps and mirror helpers captured here are rebuilt every render from exactly the inputs listed below (dataset, overrides, encodings, channelConfigs, facetCfg, panelData, mode, levelOrders); depending on the per-render Maps themselves would recompute every render
	}, [
		hasAnnotations,
		panelInputs,
		panelData,
		isPolar,
		isFaceted,
		dataset,
		overrides,
		encodings,
		channelConfigs,
		facetCfg,
		mode,
		axisFields,
		levelOrders,
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

	// Annotations placed past the plot edge (percent coords outside 0–100, or
	// an out-of-domain value on a single panel) reserve canvas margins the
	// same way data labels and the caption do, so they stay in view instead
	// of clipping at the SVG edge. The reserve depends on the solved plot
	// size (a percent coordinate is a fraction of the plot), so
	// solveWithAnnotationReserves re-solves until the spill is gone — one
	// plain solve when the visual has no annotations.
	const spec: FacetLayoutSpec = useMemo(() => {
		const solveAt = (box: { width: number; height: number }): FacetLayoutSpec => {
			const solve = (annotationReserve: AnnotationReserve) =>
				solveFacetLayout(
					buildSolverInput({
						bounds: box,
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
					}),
				)
			if (annotationScaleInputsByPanel.size === 0)
				return solve(NO_ANNOTATION_RESERVE)
			return solveWithAnnotationReserves(solve, (solved) =>
				measureAnnotationSpill({
					spec: solved,
					annotations,
					scaleInputsByPanel: annotationScaleInputsByPanel,
					axisFields,
					levelOrders,
					isRadar,
				}),
			)
		}
		const full = solveAt(bounds)
		// Scrollbar gutter. A canvas that overflows the container on ONE axis
		// (a tall ridgeline with a pixel panel height, a wide many-column
		// grid) scrolls inside a box the size of the container, and on a
		// platform with classic scrollbars that bar takes its width out of
		// the other axis — a canvas solved to the full container width then
		// overflows by exactly the bar's width and grows a second, pointless
		// scrollbar (user-reported Oct 2026). Re-solve with the gutter taken
		// out of the non-scrolling axis so the figure fits beside the bar.
		// Overlay scrollbars measure 0 and skip this; a canvas that overflows
		// both ways needs both bars anyway.
		const gutter = full.scroll ? measureScrollbarWidth() : 0
		if (gutter > 0 && bounds.width > 0 && bounds.height > 0) {
			const overflowsX = full.canvas.width > bounds.width
			const overflowsY = full.canvas.height > bounds.height
			if (overflowsY && !overflowsX)
				return solveAt({ width: bounds.width - gutter, height: bounds.height })
			if (overflowsX && !overflowsY)
				return solveAt({ width: bounds.width, height: bounds.height - gutter })
		}
		return full
	},
		// eslint-disable-next-line react-hooks/exhaustive-deps -- facet title aligns/offsets/vertical aligns and facetRow/Col fields are pure derivations of labels.titleAlignments / labels.titleOffsets / labels.titleVerticalAlignments / encodings via panelData, which are already deps, so they can never go stale; the callback also forwards whole objects (labels, channelConfigs, facetCfg, bounds, facetTitles) to buildSolverInput, but the deps below list exactly the fields it reads
		[
			bounds.width,
			bounds.height,
			panelData,
			panelInputs,
			labels.title,
			labels.titlePrefix,
			labels.subtitle,
			labels.titleAlignments,
			// titleAlignmentOf also reads the theme-seeded base alignments.
			labels.baseFont.titles,
			labels.titleOffsets,
			labels.titleVerticalAlignments,
			labels.yAxisTitleHorizontal,
			// "Titles shown" facet unchecks gate the strips / panel bands
			// (`hiddenFacetTitles`) without changing any other label field.
			labels.hiddenTitles,
			titleFont.size,
			subtitleFont.size,
			// The chart title / subtitle are canvas-measured (keep-in-view clamp),
			// so their whole font matters, prefix font included.
			titleFont.family,
			titleFont.weight,
			titleFont.italic,
			subtitleFont.family,
			subtitleFont.weight,
			subtitleFont.italic,
			titlePrefixFont.family,
			titlePrefixFont.size,
			titlePrefixFont.weight,
			titlePrefixFont.italic,
			titleOverhang.left,
			titleOverhang.right,
			xAxisTitleFont.size,
			yAxisTitleFont.size,
			// Facet titles are canvas-measured for the upright side band and
			// the keep-in-view pass, so weight / italic matter too; the
			// Placement side and the paint-time angle both feed the solver.
			labels.titlePlacements,
			labels.titleAngles,
			facetTitleFont.size,
			facetTitleFont.family,
			facetTitleFont.weight,
			facetTitleFont.italic,
			facetColTitleFont.size,
			facetColTitleFont.family,
			facetColTitleFont.weight,
			facetColTitleFont.italic,
			facetRowTitleFont.size,
			facetRowTitleFont.family,
			facetRowTitleFont.weight,
			facetRowTitleFont.italic,
			facetPanelTitleFont.size,
			facetPanelTitleFont.family,
			facetPanelTitleFont.weight,
			facetPanelTitleFont.italic,
			sharedXAxisTitle,
			sharedYAxisTitle,
			isFaceted,
			facetCfg.gapX,
			facetCfg.gapY,
			facetCfg.panelWidth,
			facetCfg.panelHeight,
			facetCfg.shareX,
			facetCfg.shareY,
			facetCfg.proportionalSizing,
			facetCfg.proportionalSizingByUnit,
			facetCfg.proportionalSizingX,
			facetCfg.proportionalSizingY,
			channelConfigs.scrollMode,
			channelConfigs.aspectRatio,
			dataLabelOverflow,
			captionReserve,
			isPolar,
			// Annotation reserve inputs. Text annotations are canvas-measured,
			// so re-run once their font has loaded.
			annotations,
			annotationScaleInputsByPanel,
			axisFields,
			levelOrders,
			isRadar,
			fontsVersion,
		],
	)

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
		// Every committed solve bumps the layout version: the fixed-canvas
		// margin frame (ChartCanvas) re-measures the rendered ink on each
		// bump, which is the only moment the DOM is known to reflect `spec`.
		setLayoutVersion((v) => v + 1)
		const p = spec.panels[0]
		if (!p) {
			setRenderedPanelDims(null)
			return
		}
		setRenderedPanelDims({
			widthPx: Math.round(p.inner.width),
			heightPx: Math.round(p.inner.height),
		})
	}, [spec, setRenderedPanelDims, setFigureSlack, setLayoutVersion])

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
				className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center vc-muted"
				style={bgStyle}
			>
				<div className="text-sm">No data set loaded.</div>
			</div>
		)
	}

	const Renderer = MODE_RENDERERS[modeId]

	// Histogram measure-color (Fill color / opacity varying by Count /
	// Density): ONE global [0, max] domain shared by every panel's bars and
	// the legend ramp. Color scales are global in this app (aesthetic scales
	// build once over the whole dataset), so the measure-color domain must
	// NOT follow the per-panel / share-group measure axis — it tops out at
	// the largest per-panel bin across all panels, the same value the legend
	// section computes (`histogramMeasureColorDomain` is the shared seam).
	const measureColorActive =
		encodings.hue?.measureSource === "count" ||
		encodings.hue?.measureSource === "density" ||
		encodings.opacity?.measureSource === "count" ||
		encodings.opacity?.measureSource === "density"
	const measureColorMaxOverride = measureColorActive
		? histogramMeasureColorDomain(
				dataset,
				encodings,
				channelConfigs,
				overrides,
				levelOrders,
				panelData
			)?.max
		: undefined

	// Position the caption in the reserved bottom band. The solver already
	// shrank the plot by `captionReserve`, so the default placement fits inside
	// the canvas; the SVG only grows if the user NUDGES what the caption DRAWS
	// past the edge. The auto-width box spans the whole canvas, so an invisible
	// box counts only its text ink — otherwise a few px of nudge would grow the
	// SVG (and add scrollbars) while the text still has plenty of room.
	const captionLayout = captionBox
		? positionCaptionBox(caption, captionBox, spec.canvas.width, spec.canvas.height)
		: null
	const captionExtent = captionLayout
		? captionDrawnExtent(caption, captionLayout)
		: null
	const svgWidth = captionExtent
		? Math.max(spec.canvas.width, captionExtent.right)
		: spec.canvas.width
	const svgHeight = captionExtent
		? Math.max(spec.canvas.height, captionExtent.bottom)
		: spec.canvas.height

	const svg = (
		<svg
			id={PLOT_SVG_ID}
			width={svgWidth}
			height={svgHeight}
			className="block"
			overflow="visible"
			// The container measures 0×0 for one frame after mount (the
			// ResizeObserver reports after the first paint) and for as long as
			// the host is hidden; the solver then collapses the canvas to its
			// chrome and this SVG paints full-size text in a ~150px box. The
			// marker lets every capture (autosave thumbnail, offscreen refresh,
			// export) refuse that frame — see `chartLayoutReady`.
			data-unmeasured={
				bounds.width === 0 || bounds.height === 0 ? "" : undefined
			}
			role="img"
			aria-labelledby={description ? descId : undefined}
			aria-label={description ? undefined : "Chart"}
			data-a11y-title={chartAccessibleTitle(a11yTexts)}
		>
			{/* Screen-reader description (Accessibility section; APPLICATION.md
			    §10d) — the figure's accessible name. A `<desc>`, not a
			    `<title>`: a live `<title>` would pop the browser's native
			    tooltip over every mark. SVG exports add the `<title>` from
			    the data attribute above (captureThumbnail). Not `<text>`, so
			    the layout solver never measures it. */}
			{description && <desc id={descId}>{description}</desc>}
			{/* `overflow="visible"` lets the chart title / subtitle paint past
			    the SVG box — into the blank band over a left / right legend
			    (LAYOUT.md §7, `titleOverhang`). Everything else stays clipped
			    to the canvas by the group below, exactly as the box clipped it
			    before. An attribute, not a class, so the export clone keeps it
			    (captureThumbnail nests this SVG in the composed figure). */}
			<defs>
				<clipPath id={canvasClipId} data-canvas-clip>
					<rect x={0} y={0} width={svgWidth} height={svgHeight} />
				</clipPath>
			</defs>
			{/* data-canvas-clip tells tests apart from a per-panel clip. */}
			<g clipPath={`url(#${canvasClipId})`} data-canvas-clip>
				{/* Per-panel marks + per-panel facet label */}
				{spec.panels.map((p) => (
					<FacetPanel
						key={p.key}
						p={p}
						Renderer={Renderer}
						shared={sharedPanelInputs}
						measureColorMaxOverride={measureColorMaxOverride}
						annotations={annotations}
						levelOrders={levelOrders}
						isRadar={isRadar}
						multiPanel={spec.panels.length > 1}
						labels={labels}
						facetTitles={facetTitles}
						facetRow={facetPanelRow(
							panelData,
							p.key,
							p.row * panelData.grid.cols + p.col,
							encodings
						)}
					/>
				))}
				{/* Shared axis titles and facet header strips — drawn AFTER the
				    panels so a title nudged into the plot area paints on top of
				    the marks instead of behind opaque fills. SVG paints in
				    document order. */}
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
				{/* Grid-mode column / row header strips (empty in wrap and
				    single modes) — see StripHeaders. */}
				<StripHeaders spec={spec} labels={labels} facetTitles={facetTitles} />
				{captionLayout && (
					<CaptionOverlay caption={caption} layout={captionLayout} />
				)}
			</g>
			{/* The chart title and subtitle sit OUTSIDE the canvas clip, so
			    they may run past the SVG's edge into the room `titleOverhang`
			    measured — and still paint above everything else. */}
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
					prefix={
						titlePrefixText !== null
							? {
									text: titlePrefixText,
									fontFamily: titlePrefixFont.family,
									fontSize: titlePrefixFont.size,
									fontWeight: titlePrefixFont.weight,
									fill: titlePrefixFont.color,
									italic: titlePrefixFont.italic,
									underline: titlePrefixFont.underline,
								}
							: undefined
					}
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
		</svg>
	)

	// A caption nudged/sized past the solved canvas grows the SVG; when that
	// happens (and the solver didn't already ask for a scroll viewport), pin the
	// SVG inside an overflow-auto box sized to the container so the overflow
	// scrolls into view instead of bleeding out of the chart area.
	const captionOverflows =
		svgWidth > spec.canvas.width || svgHeight > spec.canvas.height
	// The box is the CONTAINER, not the solved viewport: after the scrollbar-
	// gutter re-solve the viewport is a gutter narrower than the container,
	// and the bar belongs at the container's edge with the SVG beside it.
	// Each axis scrolls only when the SVG really overflows it, so a canvas
	// that is merely tall never shows a horizontal bar for the gutter.
	const boxWidth = bounds.width || spec.scroll?.width || svgWidth
	const boxHeight = bounds.height || spec.scroll?.height || svgHeight
	const wrapped =
		spec.scroll || captionOverflows ? (
			<div
				style={{
					width: boxWidth,
					height: boxHeight,
					overflowX: svgWidth > boxWidth ? "auto" : "hidden",
					overflowY: svgHeight > boxHeight ? "auto" : "hidden",
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

// Re-export shared font helpers don't fit here; rely on the renderer's
// own font resolution.
export type { ExtraMargin }
// Re-exported from its extracted home so existing importers (the measureMax
// unit test) keep their import path.
export { computePanelMeasureMax }
