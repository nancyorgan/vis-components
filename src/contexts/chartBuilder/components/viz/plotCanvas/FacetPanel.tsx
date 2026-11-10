import type { ComponentType } from "react"
import type { AnnotationsConfig } from "../../../lib/annotationsConfig"
import type { UniversalRendererProps } from "../../../lib/chartRendererProps"
import type { SolverPanelOutput } from "../../../lib/facetLayoutSolver"
import { facetTitleColorOf, type LabelsConfig } from "../../../lib/labelsConfig"
import { AnnotationRects, annotationOnPanel } from "./annotations"
import { FacetPanelContext, FacetPanelRowContext } from "./FacetPanelContext"
import type { resolveFacetTitleStyles } from "./facetTitleStyles"
import { rectToInner } from "./panelGrouping"
import { resolvePanelRenderInputs } from "./panelRenderInputs"
import { SharedText } from "./SharedText"
import { panelLabelTextOf } from "./solverSpec"

/** The render-wide inputs `resolvePanelRenderInputs` reads — everything but
 *  the panel itself: the share-mode row sources, the measure-group maxes /
 *  mins, the polar radius scale, and the configs they key into. PlotCanvas
 *  assembles them once per render and hands the SAME object to every panel
 *  (and to the annotation reserve, which resolves the same inputs ahead of
 *  the solve). */
export type SharedPanelRenderInputs = Omit<
	Parameters<typeof resolvePanelRenderInputs>[0],
	"p"
>

/** One facet panel of the PlotCanvas SVG: the annotation layer behind the
 *  marks, the mode's renderer steered to the panel's solver rect, the
 *  annotation layer in front, and the per-panel facet label. Was the inline
 *  body of PlotCanvas's `spec.panels.map` — extracted verbatim, so every
 *  element, attribute and paint order is unchanged. Deliberately NOT
 *  memoized: the inline loop re-ran on every PlotCanvas render (several of
 *  `shared`'s maps are rebuilt per render, and the renderer reads Jotai for
 *  everything else), so a memo could never bail out and would only add a
 *  prop comparison per panel. */
export const FacetPanel = ({
	p,
	Renderer,
	shared,
	measureColorMaxOverride,
	annotations,
	levelOrders,
	isRadar,
	multiPanel,
	labels,
	facetTitles,
	facetRow,
}: {
	p: SolverPanelOutput
	/** This panel's facet variables as one row (`facetPanelRow`), provided
	 *  to the renderer subtree for rules on row-less targets (tick labels). */
	facetRow: Record<string, unknown> | undefined
	/** The mode's renderer — `MODE_RENDERERS[modeId]`, resolved once by
	 *  PlotCanvas so every panel dispatches through the same component. */
	Renderer: ComponentType<UniversalRendererProps>
	shared: SharedPanelRenderInputs
	/** Histogram measure-color global domain max (undefined unless a
	 *  Count/Density color/opacity source is active) — see PlotCanvas. */
	measureColorMaxOverride: number | undefined
	annotations: AnnotationsConfig
	levelOrders: Record<string, readonly string[]>
	/** `mode.canvas.valueAnnotationsInRenderer` — the renderer owns the
	 *  value-mode annotations, so the annotation layers here skip them. */
	isRadar: boolean
	/** True when the chart has more than one panel — the only case in which
	 *  value-mode annotations clip to their panel (`annotationClipsToPanel`). */
	multiPanel: boolean
	/** Only the "Color by facet" lookups (`facetTitleColorOf`) read this. */
	labels: Pick<LabelsConfig, "facetTitleColorByValue" | "facetTitleColors">
	facetTitles: Pick<
		ReturnType<typeof resolveFacetTitleStyles>,
		| "facetTitleFont"
		| "facetTitleAngle"
		| "facetPanelTitleFont"
		| "facetPanelTitleAngle"
	>
}) => {
	const { panelData, measureAxis, axisFields } = shared
	const {
		facetTitleFont,
		facetTitleAngle,
		facetPanelTitleFont,
		facetPanelTitleAngle,
	} = facetTitles
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
		measurePinnedBounds,
		xTicksOverride,
		yTicksOverride,
		rMinOverride,
		rMaxOverride,
		radiusScale,
	} = resolvePanelRenderInputs({ p, ...shared })

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
		measurePinnedBounds,
		// Facet range editors' "Custom breaks" — replace this panel's
		// tick layout on that axis.
		xTicksOverride,
		yTicksOverride,
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
	const panelImages = (annotations.images ?? []).filter((m) =>
		annotationOnPanel(m, p.key),
	)
	// Per-panel title text — the same text the solver sized the
	// label band for (see `panelLabelTextOf`).
	const facetLabelText = panelLabelTextOf(panelData, p.key)
	// Compact-grid panel titles are styled by the `facetPanelTitle`
	// slot; wrap-mode panel titles keep the shared `facetTitle`.
	const isCompactPanelLabel =
		panelData.mode === "grid" && panelData.compact !== undefined
	const panelLabelFont = isCompactPanelLabel
		? facetPanelTitleFont
		: facetTitleFont
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
			data-panel={p.key}
			data-panel-key={p.key}
			// The plot area's right edge (where the x axis ends), in this
			// group's coordinates: the data table's View data / Chart · Data
			// links right-align to it (DataTableBlock).
			data-inner-right={p.inner.x + p.inner.width}
			data-x-scale-rows={xScaleRowCount}
			data-y-scale-rows={yScaleRowCount}
		>
			<AnnotationRects
				rectangles={panelRectangles}
				circles={panelCircles}
				lineSegments={panelLineSegments}
				texts={panelTexts}
				images={panelImages}
				inner={p.inner}
				layer="behind"
				xScaleRows={annoXScaleRows}
				yScaleRows={annoYScaleRows}
				axisFields={axisFields}
				xDomainOverride={annoXDomainOverride}
				yDomainOverride={annoYDomainOverride}
				levelOrders={levelOrders}
				isRadar={isRadar}
				radiusScale={radiusScale}
				multiPanel={multiPanel}
			/>
			{/* The Renderer reads from Jotai for everything else;
			    inner + rowsOverride steer the per-panel render.
			    Typed dispatch: Renderer is ComponentType<
			    UniversalRendererProps>, so this call is checked
			    against every registered renderer's contract. The
			    panel key is provided by context so layers nested in
			    any renderer (Data Labels' "Label all facets" scope)
			    know which facet they draw in. */}
			<FacetPanelContext.Provider value={p.key}>
				<FacetPanelRowContext.Provider value={facetRow}>
					<Renderer {...rendererProps} />
				</FacetPanelRowContext.Provider>
			</FacetPanelContext.Provider>
			<AnnotationRects
				rectangles={panelRectangles}
				circles={panelCircles}
				lineSegments={panelLineSegments}
				texts={panelTexts}
				images={panelImages}
				inner={p.inner}
				layer="front"
				xScaleRows={annoXScaleRows}
				yScaleRows={annoYScaleRows}
				axisFields={axisFields}
				xDomainOverride={annoXDomainOverride}
				yDomainOverride={annoYDomainOverride}
				levelOrders={levelOrders}
				isRadar={isRadar}
				radiusScale={radiusScale}
				multiPanel={multiPanel}
			/>
			{/* Drawn AFTER the marks so a facet label nudged over the
			    panel (Labels panel offset) paints on top of them. The
			    solver already folded the offset and the Placement side into
			    the rect (`FacetLabelInput.offsetX/Y`, `.side`), so it is
			    drawn as-is. */}
			{p.facetLabel && (
				<g data-facet-label>
					<SharedText
						rect={p.facetLabel}
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
		</g>
	)
}
