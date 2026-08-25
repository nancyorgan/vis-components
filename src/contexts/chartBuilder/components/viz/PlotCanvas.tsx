import { useEffect, useMemo } from "react"
import useMeasure from "react-use-measure"
import { useAtomValue, useSetAtom } from "jotai"
import { axisFieldsFor, hasXAxis, hasYAxis } from "../../lib/axisFields"
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
} from "../../lib/facetLayoutSolver"
import {
	facetTitleColorOf,
	resolveTextFont,
	resolveTitleFont,
} from "../../lib/labelsConfig"
import {
	DEFAULT_CAPTION_CONFIG,
	type CaptionConfig,
} from "../../lib/captionConfig"
import { type ExtraMargin } from "../../lib/plotLayout"
import { resolveFacetPanels } from "../../lib/resolveFacetPanels"
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
import { DEFAULT_DATA_LABELS_CONFIG } from "../../lib/channelConfig"
import type { FieldType } from "../../lib/types"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import type { UniversalRendererProps } from "../../lib/chartRendererProps"
import { computeDataLabelOverflow } from "./plotCanvas/dataLabelReserve"
import { resolveFacetTitleStyles } from "./plotCanvas/facetTitleStyles"
import { buildSolverPanelInputs } from "./plotCanvas/solverPanelInputs"
import { buildSolverInput } from "./plotCanvas/solverSpec"
import {
	computeGroupMeasureMax,
	computeGroupMeasureMin,
	computePanelRadiusScale,
} from "./plotCanvas/shareScales"
import {
	computePanelMeasureMax,
	groupRowsByShareGroup,
	rectToInner,
} from "./plotCanvas/panelGrouping"
import { resolvePanelRenderInputs } from "./plotCanvas/panelRenderInputs"
import { SharedText, TITLE_FILL_FALLBACK } from "./plotCanvas/SharedText"
import {
	CaptionOverlay,
	captionReservePx,
	measureCaptionBox,
	positionCaptionBox,
} from "./plotCanvas/captionLayout"
import { AnnotationRects, annotationOnPanel } from "./plotCanvas/annotations"

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
			// Whole `encodings` (covers the length/y fallback fields) + the geo
			// gate's mode-detection inputs, mirroring the `mode` memo's own deps.
			encodings,
			overrides,
			channelConfigs,
			mapConfig,
		],
	)

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
	// Facet-title style slots (shared + per-strip col/row + per-panel
	// variants) — the layered resolution lives in resolveFacetTitleStyles.
	// The bundle is also forwarded whole to buildSolverInput below.
	const facetTitles = resolveFacetTitleStyles(labels, encodings)
	const {
		facetTitleFont,
		facetTitleOffset,
		facetColTitleFont,
		facetRowTitleFont,
		facetPanelTitleFont,
		facetPanelTitleOffset,
		facetTitleAngle,
		facetColTitleAngle,
		facetRowTitleAngle,
		facetPanelTitleAngle,
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
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the callback forwards whole objects (channelConfigs, facetCfg, tickFont, bounds) to buildSolverPanelInputs, but the deps below list exactly the fields it reads — including the channelConfigs.x/.y parent-object choice the comment inside explains; widening to the whole objects would over-invalidate
		[
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
		],
	)

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

	const spec: FacetLayoutSpec = useMemo(
		() =>
			solveFacetLayout(
				buildSolverInput({
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
				}),
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- facet title aligns/offsets and facetRow/Col fields are pure derivations of labels.titleAlignments / labels.titleOffsets / encodings via panelData, which are already deps, so they can never go stale; the callback also forwards whole objects (labels, channelConfigs, facetCfg, bounds, facetTitles) to buildSolverInput, but the deps below list exactly the fields it reads
		[
			bounds.width,
			bounds.height,
			panelData,
			panelInputs,
			labels.title,
			labels.subtitle,
			labels.titleAlignments,
			// titleAlignmentOf also reads the theme-seeded base alignments.
			labels.baseFont.titles,
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

	// Shared measure-axis max per panel for bar / area charts — see
	// computeGroupMeasureMax (empty when not bar/area or share mode "none").
	const measureAxis = mode.canvas.measureAxis
	const groupMeasureMaxByKey = computeGroupMeasureMax({
		mode,
		measureAxis,
		shareXMode,
		shareYMode,
		encodings,
		channelConfigs,
		panelData,
		getType,
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
	})

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
			{spec.columnHeaders.map((h) => {
				// "Color by facet": a per-value color wins over the strip's font
				// color. Header text IS the facet value, so it doubles as the key.
				const colHdrFill =
					facetTitleColorOf(labels, h.text) ?? facetColTitleFont.color
				return (
					<text
						key={`colhdr-${h.text}`}
						data-column-header
						x={h.x}
						y={h.y}
						textAnchor={h.textAnchor}
						transform={
							facetColTitleAngle
								? `rotate(${facetColTitleAngle}, ${h.x}, ${h.y})`
								: undefined
						}
						fontFamily={facetColTitleFont.family}
						fontSize={facetColTitleFont.size}
						fontWeight={facetColTitleFont.weight ?? 500}
						fontStyle={facetColTitleFont.italic ? "italic" : undefined}
						textDecoration={facetColTitleFont.underline ? "underline" : undefined}
						fill={colHdrFill}
						dominantBaseline="middle"
						className={colHdrFill ? undefined : TITLE_FILL_FALLBACK}
					>
						{h.text}
					</text>
				)
			})}
			{spec.rowHeaders.map((h) => {
				const rowHdrFill =
					facetTitleColorOf(labels, h.text) ?? facetRowTitleFont.color
				return (
					<text
						key={`rowhdr-${h.text}`}
						data-row-header
						x={h.x}
						y={h.y}
						textAnchor={h.textAnchor}
						transform={
							facetRowTitleAngle
								? `rotate(${facetRowTitleAngle}, ${h.x}, ${h.y})`
								: undefined
						}
						fontFamily={facetRowTitleFont.family}
						fontSize={facetRowTitleFont.size}
						fontWeight={facetRowTitleFont.weight ?? 500}
						fontStyle={facetRowTitleFont.italic ? "italic" : undefined}
						textDecoration={facetRowTitleFont.underline ? "underline" : undefined}
						fill={rowHdrFill}
						dominantBaseline={
							h.verticalAnchor === "top"
								? "hanging"
								: h.verticalAnchor === "bottom"
									? "auto"
									: "middle"
						}
						className={rowHdrFill ? undefined : TITLE_FILL_FALLBACK}
					>
						{h.text}
					</text>
				)
			})}
			{/* Per-panel marks + per-panel facet label */}
			{spec.panels.map((p) => {
				const rows = panelData.rowsByValue.get(p.key) ?? []
				// Per-panel render inputs: share-aware scale-row sources, numeric
				// domain overrides (incl. the measure-axis translation), and the
				// polar R overrides + radius scale — see resolvePanelRenderInputs.
				const {
					panelFV,
					xScaleRows,
					yScaleRows,
					xMinOverride,
					xMaxOverride,
					yMinOverride,
					yMaxOverride,
					measureMinOverride,
					measureMaxOverride,
					rMinOverride,
					rMaxOverride,
					radiusScale,
				} = resolvePanelRenderInputs({
					p,
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
				})

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
					// Histogram measure-color global domain max (undefined
					// unless a Count/Density color/opacity source is active).
					measureColorMaxOverride,
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
				const panelTexts = (annotations.texts ?? []).filter((t) =>
					annotationOnPanel(t, p.key),
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
				const panelLabelAngle = isCompactPanelLabel
					? facetPanelTitleAngle
					: facetTitleAngle
				// "Color by facet": per-value title colors keyed by the facet
				// VALUE. Wrap panels key by the panel key (the facet value);
				// compact-grid panel labels key by the value their label actually
				// shows — the row value under a surviving column strip, the col
				// value under a surviving row strip, either for the wrap-fallback
				// "row · col" label (row wins when both have a color).
				const compactStripKind =
					panelData.mode === "grid" ? panelData.compact?.strip : undefined
				const panelLabelColor = isCompactPanelLabel
					? compactStripKind === "cols"
						? facetTitleColorOf(labels, panelFV.rowValue)
						: compactStripKind === "rows"
							? facetTitleColorOf(labels, panelFV.colValue)
							: (facetTitleColorOf(labels, panelFV.rowValue) ??
								facetTitleColorOf(labels, panelFV.colValue))
					: facetTitleColorOf(labels, p.key)
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
									fill={panelLabelColor ?? panelLabelFont.color}
									weight={panelLabelFont.weight}
									italic={panelLabelFont.italic}
									underline={panelLabelFont.underline}
									angleDeg={panelLabelAngle}
								/>
							</g>
						)}
						<AnnotationRects
							rectangles={panelRectangles}
							circles={panelCircles}
							lineSegments={panelLineSegments}
							texts={panelTexts}
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
							texts={panelTexts}
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

// Re-export shared font helpers don't fit here; rely on the renderer's
// own font resolution.
export type { ExtraMargin }
// Re-exported from its extracted home so existing importers (the measureMax
// unit test) keep their import path.
export { computePanelMeasureMax }
