import { useId, useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import { area as d3Area, line as d3Line } from "d3-shape"
import { buildLinePath } from "../../lib/linePath"
import {
	aggregateDistributions,
	coerceCategory,
	computeKde,
	type DistributionAggregation,
} from "../../lib/aggregators/distributions"
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	DEFAULT_SHAPE,
	DEFAULT_TEXT_CONFIG,
	type AxisConfig,
	type ChannelConfigs,
	type ColorSlotConfig,
	type DistributionOverlayConfig,
	type LineDashPattern,
	type RegressionConfig,
	type TextConfig,
} from "../../lib/channelConfig"
import { ptToPx } from "../../lib/fontUnit"
import type { ScatterRendererProps } from "../../lib/chartRendererProps"
import { cartesian } from "../../lib/coords"
import {
	buildPatternDefsFromItems,
	resolvePatternDefForItem,
} from "../../lib/buildPatternDefs"
import { sampleMarkersByConnection } from "../../lib/connectionSampling"
import { resolveConnectionStroke } from "../../lib/connectionStroke"
import { resolveConnectionThickness } from "../../lib/connectionThickness"
import {
	dashArrayFor,
	dashSpecForPatternValue,
	resolveDashGapColor,
	resolveDashGapFill,
	sanitizeCustomDasharray,
	splitIntoValueRuns,
} from "../../lib/dashPatterns"
import { densityCurveGroupField } from "../../lib/colorSlots"
import { inkPaletteForHue } from "../../lib/patterns"
import { sortByDrawOrder } from "../../lib/drawOrder"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import {
	resolveSlotColor,
	resolveSlotOpacity,
	slotOpacityResolver,
} from "../../lib/resolveLayerColor"
import { resolveMarkAesthetics } from "../../lib/resolveMarkAesthetics"
import { OPACITY_SLOT_DEFS } from "../../lib/opacitySlots"
import {
	applyHueScale,
	applyPositionScale,
	CATEGORICAL_HUE_PALETTE,
	makeHueScale,
	makePositionScale,
	maxMeaningfulTicks,
	overrideLinearDomain,
	parseValue,
	type PositionScale,
} from "../../lib/scales"
import {
	GlyphMark,
	resolveGlyph,
	type ResolvedGlyph,
} from "../../lib/customGlyphs"
import type { PlotInner } from "../../lib/plotLayout"
import { splitPolylineAtRange } from "../../lib/dashRange"
import { fitPolynomial, sampleRange } from "../../lib/regression"
import { resolveShapeColors } from "../../lib/shapeColors"
import { resolveRuleColor } from "../../lib/textColorRules"
import { formatTextValue, resolveTextColor } from "../../lib/textEncoding"
import type { DatasetView, Encodings, FieldType } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentThemeIdAtom,
	themeAtom,
	themesAtom,
} from "../../store/atoms"
import {
	useAestheticScales,
	type AestheticScales,
} from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import {
	rowHighlight,
	useLegendHighlight,
	useMarkHoverHighlight,
	type LegendHighlight,
} from "../../store/useLegendHighlight"

import { DataLabelsLayer } from "./DataLabelsLayer"
import { HoverTooltip } from "./HoverTooltip"
import { Plot, type CoordFactory, type PlotContext } from "./Plot"

type ScatterPlotProps = ScatterRendererProps

/** Hover state carries the mark index (for dimming siblings) plus the
 * hovered row and the pointer's viewport coordinates so the shared
 * `HoverTooltip` can portal-render itself anywhere on screen. */
type HoverState = {
	i: number
	row: Record<string, unknown>
	clientX: number
	clientY: number
}

export const ScatterPlot = (props: ScatterPlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	// The user-defined category order for the draw-order field (if any), so
	// draw order ranks categories the way the legend lists them rather than
	// alphabetically.
	const drawOrderLevels = channelConfigs.drawOrder?.field
		? levelOrders[channelConfigs.drawOrder.field]
		: undefined
	const labels = useAtomValue(currentLabelsAtom)
	// Data labels atoms are read up-front (before any early-return path) so
	// hook order stays stable across the dataset / missing-field guards
	// below — react-hooks/rules-of-hooks won't accept them inline beside
	// the margin computation later.
	const _dataLabelsCfg = useAtomValue(currentDataLabelsConfigAtom)
	const _dataLabelsEncodings = useAtomValue(currentDataLabelsEncodingsAtom)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
	const legendHighlight = useLegendHighlight()
	// Direct mark hover highlights the point's series (by the hue field), so
	// hovering a point recolors / outlines / fades like hovering its legend.
	const markHoverField = aestheticScales.hue?.field.name ?? null
	const markHover = useMarkHoverHighlight(markHoverField)
	const publishHover = (row: Record<string, unknown>) =>
		markHover.enter(markHoverField ? row[markHoverField] : undefined)
	// Live theme (Settings edits take effect immediately) for the connection /
	// stem default single color — the color a "single color" line/stem draws
	// when the slot isn't varying by a field.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const liveTheme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const connectionColor = liveTheme.connectionColor
	const [hovered, setHovered] = useState<HoverState | null>(null)

	const showX = props.showXAxis !== false
	const showY = props.showYAxis !== false
	// Memoized so the `?? []` fallback doesn't create a fresh array each
	// render (which would invalidate every downstream useMemo). Mirrors
	// BarPlot / AreaPlot.
	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows]
	)
	// Per-axis rows-for-scales. PlotCanvas can supply different rows for X
	// and Y when only one axis is shared, so the "un-shared" axis still
	// computes its domain from the panel's own data.
	const rowsForXScale = useMemo(
		() => props.scalesRowsOverrideX ?? props.scalesRowsOverride ?? rowsForChart,
		[props.scalesRowsOverrideX, props.scalesRowsOverride, rowsForChart]
	)
	const rowsForYScale = useMemo(
		() => props.scalesRowsOverrideY ?? props.scalesRowsOverride ?? rowsForChart,
		[props.scalesRowsOverrideY, props.scalesRowsOverride, rowsForChart]
	)

	// Resolve position-field metadata once — shared by the coord factory and
	// by any upfront work that shouldn't wait for measurement.
	const xField = encodings.x?.field ?? null
	const yField = encodings.y?.field ?? null
	const xType =
		xField && dataset ? effectiveType(dataset, xField, overrides) : null
	const yType =
		yField && dataset ? effectiveType(dataset, yField, overrides) : null
	const xRaw = xField ? rowsForXScale.map((r) => r[xField]) : null
	const yRaw = yField ? rowsForYScale.map((r) => r[yField]) : null

	// Single-variable distribution: exactly ONE position axis mapped (quant),
	// the other empty, with a violin/box enabled on it. ScatterPlot otherwise
	// requires both axes, so this is rendered as a lone shape centered on the
	// empty axis (see the dedicated branch in marksBody).
	const overlayOn = (d: DistributionOverlayConfig | undefined): boolean =>
		!!d && (d.showDensityViolin || d.showBoxPlot || d.showDensityCurve === true)
	const singleVarDist: { valueAxis: "x" | "y" } | null =
		xField && !yField && xType === "quantitative" && overlayOn(channelConfigs.x?.distributionOverlay)
			? { valueAxis: "x" }
			: yField && !xField && yType === "quantitative" && overlayOn(channelConfigs.y?.distributionOverlay)
				? { valueAxis: "y" }
				: null
	const xMaxTicks = xRaw && xType ? maxMeaningfulTicks(xRaw, xType) : undefined
	const yMaxTicks = yRaw && yType ? maxMeaningfulTicks(yRaw, yType) : undefined

	// Coord factory — defers xScale/yScale construction to post-measurement.
	const coord: CoordFactory = (inner) => {
		// The first-tick offsets are honored by `makePositionScale` only for
		// categorical / string-ordinal scales; quantitative axes ignore
		// them. Per-axis: PlotCanvas anchors only SHARED categorical axes.
		const xScale =
			xField && xRaw && xType
				? overrideLinearDomain(
						makePositionScale(
							xRaw,
							xType,
							[inner.x0, inner.x1],
							levelOrders[xField],
							{ firstTickPxOffset: props.firstTickPxOffsetX }
						),
						xType,
						props.xMinOverride,
						props.xMaxOverride
					)
				: null
		const yScale =
			yField && yRaw && yType
				? overrideLinearDomain(
						makePositionScale(
							yRaw,
							yType,
							[inner.y1, inner.y0],
							levelOrders[yField],
							{ firstTickPxOffset: props.firstTickPxOffsetY }
						),
						yType,
						props.yMinOverride,
						props.yMaxOverride
					)
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
			xMaxTicks,
			yMaxTicks,
			showXAxis: showX,
			showYAxis: showY,
			showXAxisTitle: props.showXAxisTitle ?? true,
			showYAxisTitle: props.showYAxisTitle ?? true,
			tickFont: resolveTextFont(labels.baseFont),
			xAxisTitleFont: resolveTitleFont(
				labels.baseFont,
				"secondary",
				labels.fontOverrides?.xAxisTitle
			),
			yAxisTitleFont: resolveTitleFont(
				labels.baseFont,
				"secondary",
				labels.fontOverrides?.yAxisTitle
			),
			xAxisTitleAlignment: labels.titleAlignments?.xAxisTitle,
			yAxisTitleAlignment: labels.titleAlignments?.yAxisTitle,
			yAxisTitleHorizontal: labels.yAxisTitleHorizontal,
		})
	}

	// Pattern defs only depend on aesthetic categories + channelConfigs, not
	// the measured rect — compute upfront and emit into <defs>. Memoized so
	// hover-state re-renders (which flip a frequent local useState) don't
	// re-traverse every row to rebuild defs. Items resolve through the same
	// `resolveMarkAesthetics` pipeline `buildMarks` uses, so the emitted
	// defs' svgIds always match the marks'.
	const patternDefs = useMemo(() => {
		const patternField = aestheticScales.pattern?.field.name ?? null
		if (!patternField && channelConfigs.defaultPattern == null) return []
		return buildPatternDefsFromItems(
			rowsForChart.map((row) => {
				const aes = resolveMarkAesthetics(row, aestheticScales, channelConfigs)
				return {
					patternValue: patternField ? row[patternField] : undefined,
					fill: aes.fill,
					preModulationHue: aes.preModulationHue,
					satUnit: aes.satUnit,
					briUnit: aes.briUnit,
				}
			}),
			aestheticScales,
			channelConfigs,
			channelConfigs.pattern?.backgroundColor ?? "#e2e8f0",
			{
				defaultToNone: !!encodings.connection?.field,
				includeDefaultPattern: true,
			}
		)
	}, [rowsForChart, aestheticScales, channelConfigs, encodings.connection?.field])

	const missing = !encodings.x?.field && !encodings.y?.field

	// Guard: dataset not ready. PlotCanvas's outer wrapper handles the
	// "no dataset" placeholder at the canvas level.
	if (!dataset) return null

	// Guard: user hasn't mapped x or y — render a centered hint. No shell
	// (matches the legacy behavior).
	if (missing) {
		return (
			<div className="flex h-full items-center justify-center text-center text-sm text-stone-600 dark:text-stone-400">
				Map a field to <span className="mx-1 font-semibold">X position</span> or{" "}
				<span className="mx-1 font-semibold">Y position</span> to render.
			</div>
		)
	}

	// Tooltip overlay — `HoverTooltip` portals itself to document.body and
	// positions via viewport coords so it isn't clipped by panel or chart
	// `overflow:hidden` ancestors.
	const tooltip =
		hovered === null ? null : (
			<HoverTooltip
				state={{
					clientX: hovered.clientX,
					clientY: hovered.clientY,
					fields: dataset.fields.map((f) => ({
						name: f.name,
						value: hovered.row[f.name],
					})),
				}}
			/>
		)

	const marksBody = (ctx: PlotContext) => {
		if (ctx.coord.kind !== "cartesian") return null
		const { xScale, yScale } = ctx.coord.scales

		// Single-variable violin/box: only one quant axis is mapped, so render a
		// lone shape centered on the (axis-less) empty side. Uses the existing
		// overlay renderer with a synthetic single-group strip.
		if (singleVarDist) {
			const valueIsX = singleVarDist.valueAxis === "x"
			const valueScale = valueIsX ? xScale : yScale
			const valueField = valueIsX ? xField : yField
			if (!valueScale || !valueField) return null
			const [a, b] = valueIsX
				? [ctx.inner.y0, ctx.inner.y1]
				: [ctx.inner.x0, ctx.inner.x1]
			const center = (a + b) / 2
			const span = Math.abs(b - a)
			// Synthetic category scale: a single group mapped to the axis center.
			const categoryScale = Object.assign(() => center, {
				step: () => span,
			}) as StripAxes["categoryScale"]
			const overlay: DistributionOverlayConfig = {
				...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
				...(valueIsX
					? channelConfigs.x?.distributionOverlay
					: channelConfigs.y?.distributionOverlay),
			}
			// A density curve (unlike a violin) rises from the axis floor — the
			// bottom for an x-value axis, the left edge for a y-value one — and
			// shows its points as a rug along that floor (below).
			const densityCurveOn = overlay.showDensityCurve === true
			const baseline = valueIsX ? b : a
			// Fill + smoothing are shared with the histogram's density overlay
			// (they live on the histogram config), so the choice carries across the
			// Histogram ⇄ Density switch — same as the rug.
			const densityCfg = (valueIsX ? channelConfigs.x : channelConfigs.y)
				?.histogram
			const stripAxes: StripAxes = {
				categoryAxis: valueIsX ? "y" : "x",
				categoryField: "", // single group
				valueField,
				valueType: "quantitative",
				categoryScale,
				valueScale,
				jitterAmount: 0,
				beeswarm: false,
				overlay,
			}
			// Underlying data points, gated on "Show points". There's no
			// category axis here, so the empty axis collapses to a constant
			// scale at the violin/box center and every point stacks on it (no
			// jitter — matching the strip-plot default). Reuse buildMarks so
			// the dots pick up the same hue / shape / pattern / opacity
			// treatment as any other scatter mark.
			const constCenterScale = (() =>
				center) as unknown as NonNullable<
				ReturnType<typeof makePositionScale>
			>
			const syntheticEncodings: Encodings = valueIsX
				? { ...encodings, y: { field: valueField } }
				: { ...encodings, x: { field: valueField } }
			// Violin / box show their underlying points as scatter dots. The
			// density display shows them as rug TASSELS instead (below), so don't
			// build scatter marks for it.
			const marks =
				!densityCurveOn && overlay.showPoints
					? buildMarks({
							rowsForChart,
							encodings: syntheticEncodings,
							channelConfigs,
							aestheticScales,
							xScale: valueIsX ? valueScale : constCenterScale,
							yScale: valueIsX ? constCenterScale : valueScale,
							xType: valueIsX ? "quantitative" : "categorical",
							yType: valueIsX ? "categorical" : "quantitative",
						})
					: []
			// The curve's outline and fill resolve from separate slots (one
			// aggregate color each), falling back to the theme's overlay stroke /
			// fill. The rug resolves independently from the Rug slot (below).
			const densitySlotColor = (
				key: "densityCurveStroke" | "densityCurveFill",
				fallback: string,
				row: Record<string, unknown>
			) => {
				const slotCfg = channelConfigs.colorSlots?.[key]
				return slotCfg
					? resolveSlotColor(aestheticScales.colorSlots[key], slotCfg, row, fallback)
					: fallback
			}
			const densityStrokeOpacity = slotOpacityResolver(
				"densityCurveStroke",
				channelConfigs,
				aestheticScales
			)({})
			const densityFillOpacity = slotOpacityResolver(
				"densityCurveFill",
				channelConfigs,
				aestheticScales
			)({})
			const densityFillOn = densityCfg?.densityFill === true
			const densityCurveProps = (
				grid: number[],
				density: number[],
				row: Record<string, unknown>,
				peakOverride?: number
			) => ({
				grid,
				density,
				valueScale,
				valueAxis: (valueIsX ? "x" : "y") as "x" | "y",
				baseline,
				extent: span * 0.9,
				strokeColor: densitySlotColor(
					"densityCurveStroke",
					liveTheme.distributionOverlayStroke,
					row
				),
				strokeOpacity: densityStrokeOpacity,
				fillColor: densitySlotColor(
					"densityCurveFill",
					liveTheme.distributionOverlayFill,
					row
				),
				fillOpacity: densityFillOpacity,
				fill: densityFillOn,
				peakOverride,
			})
			// Standalone density curve. "Vary by" a field splits it into one KDE
			// per category (overlapping, shared-peak normalized so relative heights
			// read); otherwise a single curve peak-normalized to fill ~90% of the
			// plot — shape, not absolute magnitude (like a violin).
			const densityGroupField = densityCurveGroupField(channelConfigs)
			const densityNode = densityCurveOn
				? (() => {
						const domain = linearDomain(valueScale)
						if (!domain) return null
						if (densityGroupField) {
							const groups = new Map<string, number[]>()
							const order: string[] = []
							for (const r of rowsForChart) {
								const cat = r[densityGroupField]
								if (cat === undefined || cat === null || cat === "") continue
								const v = Number(r[valueField])
								if (!Number.isFinite(v)) continue
								const key = String(cat)
								let list = groups.get(key)
								if (!list) {
									list = []
									groups.set(key, list)
									order.push(key)
								}
								list.push(v)
							}
							const perGroup = order.map((key) => ({
								key,
								...computeKde({
									values: groups.get(key) ?? [],
									domain,
									bandwidthScale: densityCfg?.densityBandwidthScale,
								}),
							}))
							const globalPeak = perGroup.reduce(
								(m, g) => Math.max(m, ...g.density),
								0
							)
							if (!(globalPeak > 0)) return null
							return (
								<g>
									{perGroup.map(({ key, grid, density }) => (
										<DensityCurveShape
											key={key}
											{...densityCurveProps(
												grid,
												density,
												{ [densityGroupField]: key },
												globalPeak
											)}
										/>
									))}
								</g>
							)
						}
						const values = rowsForChart
							.map((r) => Number(r[valueField]))
							.filter((v) => Number.isFinite(v))
						const { grid, density } = computeKde({
							values,
							domain,
							bandwidthScale: densityCfg?.densityBandwidthScale,
						})
						return <DensityCurveShape {...densityCurveProps(grid, density, {})} />
					})()
				: null
			// Density rug: one tassel per row along the floor, reusing the shared
			// histogram rug config (length / width) so the ticks and their sizes
			// persist across the Histogram ⇄ Density switch. Tassels straddle the
			// baseline like the histogram rug.
			const histCfg = valueIsX
				? channelConfigs.x?.histogram
				: channelConfigs.y?.histogram
			const densityRugNode =
				densityCurveOn && histCfg?.showRug
					? (() => {
							const half = (histCfg.rugTickLength ?? 10) / 2
							const thickness = histCfg.rugTickThickness ?? 1
							// Color + opacity come from the Rug slots (same as the
							// histogram rug), resolved per row so a field-mapped Rug
							// color tints each tassel. Legacy fallback: the single
							// rug color, else the theme stroke.
							const rugSlotCfg = channelConfigs.colorSlots?.rug
							const rugFallback =
								histCfg.rugColor ?? liveTheme.distributionOverlayStroke
							const rugOpacityFor = slotOpacityResolver(
								"rug",
								channelConfigs,
								aestheticScales
							)
							const ticks = rowsForChart.map((row, i) => {
								const valuePx = applyPositionScale(
									valueScale,
									row[valueField],
									"quantitative"
								)
								if (valuePx === null) return null
								const stroke = rugSlotCfg
									? resolveSlotColor(
											aestheticScales.colorSlots.rug,
											rugSlotCfg,
											row,
											rugFallback
										)
									: rugFallback
								const op = rugOpacityFor(row)
								return valueIsX ? (
									<line
										// eslint-disable-next-line react/no-array-index-key -- rug ticks map 1:1 to rows, which have no stable id
										key={`drug-${i}`}
										x1={valuePx}
										x2={valuePx}
										y1={baseline - half}
										y2={baseline + half}
										stroke={stroke}
										strokeOpacity={op}
										strokeWidth={thickness}
										strokeLinecap="round"
									/>
								) : (
									<line
										// eslint-disable-next-line react/no-array-index-key -- rug ticks map 1:1 to rows, which have no stable id
										key={`drug-${i}`}
										x1={baseline - half}
										x2={baseline + half}
										y1={valuePx}
										y2={valuePx}
										stroke={stroke}
										strokeOpacity={op}
										strokeWidth={thickness}
										strokeLinecap="round"
									/>
								)
							})
							return <g aria-hidden>{ticks}</g>
						})()
					: null
			return (
				<g
				onMouseLeave={() => {
					setHovered(null)
					markHover.leave()
				}}
			>
					{renderDistributionOverlays({
						rowsForChart,
						stripAxes,
						channelConfigs,
						hueScale: aestheticScales.hue,
						colorSlots: aestheticScales.colorSlots,
						opacitySlots: aestheticScales.opacitySlots,
						// Mirrors the `marks` gate above: the density display swaps
						// points for a rug, so points are only on screen when the
						// curve is off.
						pointsShown: !densityCurveOn && overlay.showPoints,
					})}
					{densityNode}
					{densityRugNode}
					{renderMarkPaths({
						marks: sortByDrawOrder(
							marks,
							(m) => m.row,
							channelConfigs.drawOrder,
							dataset,
							drawOrderLevels,
							drawOrderSizeTieBreak
						),
						markedIndices: null,
						channelConfigs,
						hoveredIdx: hovered?.i ?? null,
						borderOpacity: slotOpacityResolver(
							"border",
							channelConfigs,
							aestheticScales
						),
						setHovered,
						highlight: legendHighlight,
						publishHover,
					})}
				</g>
			)
		}

		if (!xScale || !yScale || !xType || !yType) return null

		// TODO(audit, P1.1): buildMarks runs on every render of this
		// render-prop callback (hover state, resize). Decomposing it
		// into a scale-independent prepass (memoized at the top level)
		// + a scale-application step (cheap, runs here) is in scope
		// for the P1.1 renderer-helper extraction work.
		const marks = buildMarks({
			rowsForChart,
			encodings,
			channelConfigs,
			aestheticScales,
			xScale,
			yScale,
			xType,
			yType,
		})

		// Distribution overlays (violin / box) and jitter both need to
		// know which axis is categorical (band/point scale) and which is
		// quantitative. Compute once and share.
		const stripAxes = resolveStripAxes({
			xScale,
			yScale,
			xType,
			yType,
			xField: encodings.x?.field ?? null,
			yField: encodings.y?.field ?? null,
			rows: rowsForChart,
			channelConfigs,
		})
		const overlays = stripAxes
			? renderDistributionOverlays({
					rowsForChart,
					stripAxes,
					channelConfigs,
					hueScale: aestheticScales.hue,
					colorSlots: aestheticScales.colorSlots,
					opacitySlots: aestheticScales.opacitySlots,
					// Same condition as `showPoints` below: an active overlay
					// respects the "Show points" checkbox.
					pointsShown: stripAxes.overlay.showPoints,
				})
			: null
		// When an overlay is on AND the user has unchecked "Show points",
		// suppress the underlying marks so the chart shows ONLY the
		// distribution shape. Jitter still applies if marks come back.
		const overlayActive =
			stripAxes !== null &&
			(stripAxes.overlay.showDensityViolin || stripAxes.overlay.showBoxPlot)
		const showPoints = overlayActive ? stripAxes.overlay.showPoints : true
		// Half the outline stroke width: SVG centers the stroke on the circle's
		// edge, so packing must reserve this much extra room or the strokes of
		// touching points overlap.
		const beeswarmPad = (channelConfigs.shape?.outlineWidth ?? 1) / 2
		const jitteredMarks = showPoints
			? stripAxes?.beeswarm
				? applyBeeswarm(marks, stripAxes, beeswarmPad)
				: applyJitter(marks, stripAxes)
			: []

		const hoveredIdx = hovered?.i ?? null

		// Regression line (+ optional CI band) — two-quantitative scatter only.
		// The layer draws in front of or behind the dots per the user's
		// `drawPosition`; `null` when disabled or the axes aren't both
		// quantitative (a stale config after remapping an axis).
		const regressionCfg = channelConfigs.x?.regression
		const regressionNode =
			regressionCfg?.enabled &&
			xType === "quantitative" &&
			yType === "quantitative" &&
			encodings.x?.field &&
			encodings.y?.field ? (
				<RegressionLayer
					rows={rowsForChart}
					xField={encodings.x.field}
					yField={encodings.y.field}
					xScale={xScale}
					yScale={yScale}
					regression={regressionCfg}
					channelConfigs={channelConfigs}
					aestheticScales={aestheticScales}
					inner={ctx.inner}
				/>
			) : null
		const regressionInFront =
			(regressionCfg?.drawPosition ?? "front") === "front"

		// When a connection field is mapped AND the user picked a
		// non-default `pointSampling`, filter which marks render
		// MARKERS (the polyline itself stays intact). The set tracks
		// marks by their stable `i` key so the JSX map below can
		// short-circuit anything that's not in the sampled set.
		const markedIndices = encodings.connection?.field
			? sampleMarkersByConnection(
					jitteredMarks,
					encodings.connection.field,
					channelConfigs,
					(m) => m.cx
				)
			: null
		return (
			<g
				onMouseLeave={() => {
					setHovered(null)
					markHover.leave()
				}}
			>
				{!regressionInFront && regressionNode}
				{overlays}
				{renderAxisStems(
					jitteredMarks,
					channelConfigs,
					xScale,
					yScale,
					aestheticScales.colorSlots.stem,
					channelConfigs.colorSlots?.stem,
					slotOpacityResolver("stem", channelConfigs, aestheticScales),
					connectionColor
				)}
				{renderConnectionLines(
					jitteredMarks,
					encodings,
					channelConfigs,
					slotOpacityResolver("line", channelConfigs, aestheticScales)({}),
					aestheticScales.colorSlots.line,
					connectionColor,
					xScale,
					xType,
					dataset,
					drawOrderLevels,
					aestheticScales.hue?.field.type
				)}
				{renderMarkPaths({
					marks: sortByDrawOrder(
						jitteredMarks,
						(m) => m.row,
						channelConfigs.drawOrder,
						dataset,
						drawOrderLevels,
						drawOrderSizeTieBreak
					),
					markedIndices,
					channelConfigs,
					hoveredIdx,
					borderOpacity: slotOpacityResolver(
						"border",
						channelConfigs,
						aestheticScales
					),
					setHovered,
					highlight: legendHighlight,
					publishHover,
				})}
				{regressionInFront && regressionNode}
				{renderTextLabels(
					jitteredMarks,
					encodings.text?.field ?? null,
					channelConfigs
				)}
				<DataLabelsLayer
					rows={rowsForChart}
					xScale={xScale}
					yScale={yScale}
					xType={xType}
					yType={yType}
				/>
			</g>
		)
	}

	// `props.inner` is optional — Plot falls back to DEFAULT_RENDERER_INNER
	return (
		<Plot
			inner={props.inner}
			coord={coord}
			tooltip={tooltip}
			patternDefs={patternDefs}
		>
			{marksBody}
		</Plot>
	)
}

/** Render the per-row data points (shape paths, or length/angle line
 * segments) for a chart. Shared by the standard scatter / strip-plot path and
 * the single-variable violin/box path so the dots get identical hue / shape /
 * pattern / opacity treatment regardless of which branch built them. */
const renderMarkPaths = (args: {
	marks: Mark[]
	markedIndices: Set<number> | null
	channelConfigs: ChannelConfigs
	hoveredIdx: number | null
	/** Per-row border (stroke) opacity from the Border opacity slot. */
	borderOpacity: (row: Record<string, unknown>) => number
	setHovered: (h: HoverState | null) => void
	/** Legend-hover highlight state; dims marks whose field value doesn't
	 * match the hovered legend entry. `null` = nothing hovered. */
	highlight: LegendHighlight | null
	/** Publish the hovered mark's series to the highlight atom on mark enter,
	 * so direct hover recolors / outlines / fades like a legend hover. */
	publishHover: (row: Record<string, unknown>) => void
}): React.ReactNode => {
	const {
		marks,
		markedIndices,
		channelConfigs,
		hoveredIdx,
		borderOpacity,
		setHovered,
		highlight,
		publishHover,
	} = args
	return (
		<g>
			{marks.map((m) => {
				if (markedIndices !== null && !markedIndices.has(m.i)) {
					return null
				}
				// Pattern can apply to points AND lines simultaneously
				// (renderConnectionLines reads the same idx and maps
				// it to DASH_CYCLE for the polyline). Points keep
				// their fill pattern regardless of line-chart context.
				const effectivePatternId = m.patternId
				const fillProp = effectivePatternId
					? `url(#${effectivePatternId})`
					: m.fill
				// `outlineColor` is no longer read at render time —
				// the per-mark `m.shapeStroke` baked it in already
				// (defaulting to hue when hue is mapped, or to the
				// theme's outline color otherwise). Width still comes
				// straight off the config since it's a single number.
				const outlineWidth = channelConfigs.shape?.outlineWidth ?? 1
				// Legend/mark-hover highlight: recolor / outline the matched mark
				// and fade the rest. When the highlight atom is active (a legend
				// entry OR another mark's series is hovered), the atom drives the
				// fade — skip the ad-hoc per-point dim so they don't compound.
				const mh = rowHighlight(highlight, m.row)
				const localDim = highlight
					? 1
					: hoveredIdx === null || hoveredIdx === m.i
						? 1
						: 0.3
				const hoverFocus = localDim * mh.opacityMul
				if (m.line) {
					return (
						<line
							key={m.i}
							{...m.line}
							stroke={mh.fill ?? m.fill}
							strokeWidth={3}
							strokeLinecap="round"
							opacity={hoverFocus * m.markOpacity}
							onMouseEnter={(e) => {
								setHovered({
									i: m.i,
									row: m.row,
									clientX: e.clientX,
									clientY: e.clientY,
								})
								publishHover(m.row)
							}}
						/>
					)
				}
				// Per-shape fill / stroke overrides win over the hue color.
				// `"none"` is the literal SVG sentinel — gives a hollow
				// shape that still picks up the (overridden or default)
				// stroke. Pattern fills always go through `fillProp` since
				// the pattern fills the path itself.
				const baseFillForShape = effectivePatternId
					? fillProp
					: m.shapeFill === "none"
						? "none"
						: m.shapeFill
				// Highlight recolor repaints the fill (overriding pattern / hollow);
				// highlight outline overrides the stroke + thickens it.
				const fillForShape = mh.fill ?? baseFillForShape
				// `m.shapeStroke` already bakes in the outline precedence
				// (explicit Color-menu outline > per-category > hue when
				// mapped > theme outline), so it applies to pattern-filled
				// points too — previously these were forced to `m.fill`,
				// which silently discarded the user's outline color.
				const strokeForShape = mh.outline ?? m.shapeStroke
				return (
					<GlyphMark
						key={m.i}
						glyph={m.glyph ?? { kind: "symbol", idx: 0 }}
						r={m.r}
						transform={`translate(${m.cx},${m.cy})${
							m.rotation == null ? "" : ` rotate(${m.rotation})`
						}`}
						fill={fillForShape}
						fillOpacity={fillForShape === "none" ? 0 : m.markOpacity}
						stroke={strokeForShape}
						strokeWidth={
							mh.outline
								? Math.max(outlineWidth, mh.outlineWidth)
								: outlineWidth
						}
						strokeOpacity={mh.outline ? 1 : borderOpacity(m.row)}
						opacity={hoverFocus}
						onMouseEnter={(e) => {
							setHovered({
								i: m.i,
								row: m.row,
								clientX: e.clientX,
								clientY: e.clientY,
							})
							publishHover(m.row)
						}}
					/>
				)
			})}
		</g>
	)
}

/** Draw text labels for each mark when the `text` encoding is mapped.
 * Anchored just to the right of the mark's centroid so it sits next to the
 * point/line without overlapping its outline. Uses the active `TextConfig`
 * for font, weight, and per-category color overrides. */
const renderTextLabels = (
	marks: Mark[],
	textField: string | null,
	channelConfigs: ChannelConfigs
) => {
	if (!textField) return null
	const cfg: TextConfig = { ...DEFAULT_TEXT_CONFIG, ...channelConfigs.text }
	const offset = 6
	// Build a value→index map so each row gets a stable palette slot.
	const indexByValue = new Map<string, number>()
	for (const m of marks) {
		const raw = m.row[textField]
		if (raw === undefined || raw === null || raw === "") continue
		const key = String(raw)
		if (!indexByValue.has(key)) indexByValue.set(key, indexByValue.size)
	}
	return (
		<g aria-hidden>
			{marks.map((m) => {
				const raw = m.row[textField]
				const formatted = formatTextValue(raw, cfg.decimals)
				if (formatted === null) return null
				const idx =
					raw === undefined || raw === null
						? undefined
						: indexByValue.get(String(raw))
				return (
					<text
						key={`txt-${m.i}`}
						x={m.cx + offset}
						y={m.cy}
						fill={resolveTextColor(raw, cfg, idx)}
						fontFamily={cfg.fontFamily}
						fontSize={ptToPx(cfg.fontSize)}
						fontWeight={cfg.fontWeight}
						dominantBaseline="middle"
						pointerEvents="none"
					>
						{formatted}
					</text>
				)
			})}
		</g>
	)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Mark = {
	i: number
	cx: number
	cy: number
	/** Resolved point radius in pixels (area-encoded or the default). Drives
	 * the symbol path and the beeswarm packing's collision geometry. */
	r: number
	fill: string
	/** Resolved per-shape fill — when the user has overridden the fill
	 * color for the row's shape category, this is that color (or `"none"`
	 * for a hollow look). Otherwise it falls back to the hue-derived
	 * `fill` value above. Pattern fills bypass this and go through fill
	 * as `url(#patternId)` instead. */
	shapeFill: string
	/** Resolved per-shape stroke. Defaults to the same hue-derived color as
	 * `shapeFill` so an outline picks up the encoding's color out of the
	 * box; an explicit per-category override in
	 * `channelConfigs.shape.strokeOverrides` wins when present. The global
	 * `channelConfigs.shape.outlineColor` is only used as a final fallback
	 * when this field is unexpectedly absent (e.g. legacy save shapes). */
	shapeStroke: string
	/** Resolved mark glyph (built-in symbol, custom text, or custom image);
	 * `null` in length/angle line-segment mode where no glyph draws. */
	glyph: ResolvedGlyph | null
	line: { x1: number; y1: number; x2: number; y2: number } | null
	patternId: string | null
	markOpacity: number
	rotation: number | null
	row: Record<string, unknown>
}

/** Tie-break for `sortByDrawOrder`: when the draw-order field can't separate
 * two marks (equal or both-unrankable values — common with a coarse ordinal
 * field), paint the bigger radius first so it lands BEHIND and the smaller
 * mark stays visible on top. Runs only within a field tie, so it never
 * overrides the user's chosen ordering across levels. */
const drawOrderSizeTieBreak = (a: Mark, b: Mark): number => b.r - a.r

type BuildMarksArgs = {
	rowsForChart: Array<Record<string, unknown>>
	encodings: Encodings
	channelConfigs: ChannelConfigs
	aestheticScales: AestheticScales
	xScale: NonNullable<ReturnType<typeof makePositionScale>>
	yScale: NonNullable<ReturnType<typeof makePositionScale>>
	xType: NonNullable<ReturnType<typeof effectiveType>>
	yType: NonNullable<ReturnType<typeof effectiveType>>
}

const buildMarks = ({
	rowsForChart,
	encodings,
	channelConfigs,
	aestheticScales,
	xScale,
	yScale,
	xType,
	yType,
}: BuildMarksArgs): Mark[] => {
	const hue = aestheticScales.hue?.field ?? null
	const outlineHue = aestheticScales.outlineHue?.field ?? null
	const outlineHueScale = aestheticScales.outlineHue?.scale ?? null
	const shape = aestheticScales.shape?.field ?? null
	const length = aestheticScales.length?.field ?? null
	const angle = aestheticScales.angle?.field ?? null
	const pattern = aestheticScales.pattern?.field ?? null
	const shapeIdx = aestheticScales.shape?.idx ?? null
	const lengthScale = aestheticScales.length?.scale ?? null
	const angleScale = aestheticScales.angle?.scale ?? null

	const patternBgFallback = channelConfigs.pattern?.backgroundColor ?? "#e2e8f0"

	const xName = encodings.x?.field as string
	const yName = encodings.y?.field as string

	return rowsForChart
		.map((row, i): Mark | null => {
			const cx = applyPositionScale(xScale, row[xName], xType)
			const cy = applyPositionScale(yScale, row[yName], yType)
			if (cx === null || cy === null) return null

			// Hue → sat/bri modulation → opacity → area radius, via the
			// shared per-row pipeline (also captures the pre-modulation hue
			// color for the pattern-ink lookup below).
			const {
				fill,
				preModulationHue,
				opacity: markOpacity,
				radius: r,
				satUnit,
				briUnit,
			} = resolveMarkAesthetics(row, aestheticScales, channelConfigs)

			// Length/angle: line segment mode (overrides shape)
			let lenValue: number | null = null
			let angValue: number | null = null
			if (lengthScale && length) {
				lenValue = lengthScale(row[length.name])
			} else if (channelConfigs.defaultLength != null) {
				lenValue = channelConfigs.defaultLength
			}
			if (angleScale && angle) {
				angValue = angleScale(row[angle.name])
			} else if (channelConfigs.defaultAngle != null) {
				angValue = (channelConfigs.defaultAngle * Math.PI) / 180
			}

			// Same per-item resolver the upfront pattern-defs pass uses, so a
			// mark's svgId always references an emitted def. `defaultToNone`:
			// in line chart context points stay clean by default — Pattern
			// drives line dash style via `dashOverrides`; per-category point
			// fills require an explicit Point-fill swatch click.
			const resolvedPattern =
				pattern || channelConfigs.defaultPattern != null
					? resolvePatternDefForItem(
							{
								patternValue: pattern ? row[pattern.name] : undefined,
								fill,
								preModulationHue,
								satUnit,
								briUnit,
							},
							aestheticScales,
							channelConfigs,
							patternBgFallback,
							{
								defaultToNone: !!encodings.connection?.field,
								includeDefaultPattern: true,
							}
						)
					: null
			const patternId = resolvedPattern?.svgId ?? null

			// Shape (only used when length is not active)
			const shapeIndex =
				shapeIdx && shape
					? shapeIdx(row[shape.name])
					: (channelConfigs.defaultShape ?? DEFAULT_SHAPE)
			const glyph =
				lenValue === null
					? resolveGlyph(shapeIndex, channelConfigs.shape?.customGlyphs)
					: null
			// Per-category fill / stroke overrides. Keyed by the SHAPE
			// encoding's value when it's mapped, so users can give one
			// category a hollow look (`"none"`) or pair a light fill with a
			// dark stroke without dropping into the hue palette.
			// Per-category fill / stroke resolution lives in
			// `lib/shapeColors.ts` so the precedence rules are testable
			// without spinning up the whole chart pipeline. Pass the
			// hue-derived `fill` and let the helper decide whether the
			// stroke inherits it (hue mapped) or falls back to the theme
			// outline color (hue unmapped).
			const shapeKey = shape ? String(row[shape.name] ?? "") : null
			// Field-driven outline color (the `outlineHue` channel). When
			// mapped, the row's value resolves to a stroke color that sits
			// between any per-category override and the universal outline
			// fallback (see resolveShapeColors precedence).
			const outlineScaleColor =
				outlineHueScale && outlineHue
					? applyHueScale(
							outlineHueScale,
							row[outlineHue.name],
							outlineHue.type
						)
					: null
			// Conditional outline rules test the mapped outline variable's
			// value and override the scale color when one matches. Only fire
			// when an outline field is mapped (nothing to compare otherwise).
			const outlineRuleColor = outlineHue
				? resolveRuleColor(
						channelConfigs.shape?.outlineColorRules,
						row[outlineHue.name]
					)
				: null
			const { fill: shapeFill, stroke: shapeStroke } = resolveShapeColors({
				hueFill: fill,
				shapeCategoryValue: shapeKey,
				shapeConfig: channelConfigs.shape,
				hueMapped: !!hue,
				fallbackOutline: channelConfigs.shape?.outlineColor ?? "#ffffff",
				outlineScaleColor,
				outlineRuleColor,
			})

			// Line endpoints (centered on anchor at (cx, cy))
			let line: { x1: number; y1: number; x2: number; y2: number } | null = null
			if (lenValue !== null) {
				const a = angValue ?? 0
				const half = lenValue / 2
				line = {
					x1: cx - Math.cos(a) * half,
					y1: cy - Math.sin(a) * half,
					x2: cx + Math.cos(a) * half,
					y2: cy + Math.sin(a) * half,
				}
			}

			// Pass angle through for shape rotation (when not in line mode)
			const rotation =
				lenValue === null && angValue != null
					? (angValue * 180) / Math.PI
					: null

			return {
				i,
				cx,
				cy,
				r,
				fill,
				shapeFill,
				shapeStroke,
				glyph,
				line,
				patternId,
				markOpacity,
				rotation,
				row,
			}
		})
		.filter((m): m is Mark => m !== null)
}

/** Group marks by connection-field value and draw one polyline per group.
 * Min 2-point groups only; points sorted by cx; stroke resolves through the
 * shared `resolveConnectionStroke` chain (per-value override → line palette
 * → global stroke override → theme connection color, with the Line color
 * slot owning the color when configured).
 *
 * Each line can carry a per-group dash pattern. Non-solid dashes render
 * via TWO stacked polylines: an "alternate" (gap-filling) underlay drawn
 * solid in the alternate color, and the dashed top line drawn in the
 * usual line color. The visual result is alternating two-color dashes —
 * the user's stated requirement for distinguishing line groups beyond
 * color alone. */
/** Stroke props shared by a connection line whether it renders as a
 *  `<polyline>` (straight) or a `<path>` (smoothed) — see `renderLine`. */
type LineVisualProps = {
	fill?: "none"
	stroke?: string
	strokeWidth?: number
	strokeLinecap?: "round" | "butt" | "square"
	strokeLinejoin?: "round"
	strokeDasharray?: string
	opacity?: number
}

const renderConnectionLines = (
	marks: Mark[],
	encodings: Encodings,
	channelConfigs: ChannelConfigs,
	/** Opacity for every connection line, from the Line opacity slot (absolute:
	 *  a single level for all lines, since a polyline spans many rows). */
	lineOpacity: number,
	/** Line color slot scale (present only when "vary by" a field). */
	lineSlot: AestheticScales["colorSlots"]["line"],
	/** Theme default single color for lines — used in single-color mode or when
	 *  no per-value override / slot field applies (a real color, not the fill). */
	connectionColor: string,
	/** X scale + field type, for resolving the dash-range From/To values
	 *  ("Apply pattern to range") to pixel boundaries. */
	xScale: PositionScale,
	xType: FieldType,
	/** Active dataset — lets the "Draw order" setting rank the SERIES paint
	 *  order the same way it ranks overlapping points. */
	dataset: DatasetView | undefined,
	/** User-defined category order for the draw-order field (if any), so
	 *  series rank by legend order rather than alphabetically. */
	drawOrderLevels: readonly string[] | undefined,
	/** The hue field's type — picks the palette whose paired pattern inks
	 *  the dash-gap color resolves from (ordinal hue fields render from the
	 *  ordinal palette; see `inkPaletteForHue`). */
	hueType: FieldType | undefined
) => {
	const connectionField = encodings.connection?.field ?? null
	if (!connectionField) return null
	const cfg = {
		...DEFAULT_CONNECTION_CONFIG,
		...channelConfigs.connection,
	}
	// "Apply pattern to range": resolve From/To to pixel boundaries once —
	// raw axis values parsed like value-mode annotation coordinates. A value
	// that doesn't parse = unbounded on that side; neither parsing = the
	// range is inert (dash the whole line, same as off).
	const dashRange = cfg.dashRange
	const rangeBoundaryPx = (v: number | string | null): number | null =>
		v === null || v === "" ? null : applyPositionScale(xScale, v, xType)
	const rangeMinPx = dashRange?.enabled ? rangeBoundaryPx(dashRange.min) : null
	const rangeMaxPx = dashRange?.enabled ? rangeBoundaryPx(dashRange.max) : null
	const rangeActive =
		dashRange?.enabled === true && (rangeMinPx !== null || rangeMaxPx !== null)
	// Per-line thickness overrides (keyed by connection group value). Empty /
	// absent → every line uses the single `cfg.thickness`, byte-identical to
	// before. Resolved per group inside the flatMap below.
	const thicknessByValue = cfg.thicknessByValue
	// "square" maps to SVG's butt cap so lines and dash segments end flush
	// at the data position instead of extending half a stroke-width past it.
	const strokeCap = cfg.lineCap === "square" ? "butt" : "round"
	// Line smoothing: 0 (default) keeps the plain straight-segment <polyline>
	// so existing visuals + tests render byte-identically; > 0 swaps in a
	// cardinal-spline <path> through the same points. `renderLine` picks the
	// right element so every solid/dashed/range branch below stays uniform.
	const smoothing = cfg.smoothing ?? 0
	const renderLine = (
		key: string,
		points: Array<{ x: number; y: number }>,
		props: LineVisualProps
	): React.ReactElement =>
		smoothing > 0 ? (
			<path key={key} d={buildLinePath(points, smoothing)} {...props} />
		) : (
			<polyline
				key={key}
				points={points.map((p) => `${p.x},${p.y}`).join(" ")}
				{...props}
			/>
		)
	const lineColors = cfg.lineColors
	const dashPatterns = cfg.dashPatterns ?? {}
	const dashAlternateColors = cfg.dashAlternateColors ?? {}
	const defaultDash: LineDashPattern = cfg.defaultDashPattern ?? "solid"
	// The panel's "Custom" default dash: a user-typed dasharray that wins
	// over the swatch pick when it parses; per-group `dashPatterns`
	// overrides still win over both.
	const defaultDashArray =
		(cfg.customDashPattern
			? sanitizeCustomDasharray(cfg.customDashPattern)
			: null) ?? dashArrayFor(defaultDash)
	// "Blank" dash pick: within the range window the line doesn't draw at
	// all — a true gap, or the gap-color underlay alone when "Fill dash
	// gaps" is on. A parsed custom dasharray wins over the swatch pick
	// (defaultDashArray is non-null then), same precedence as the other
	// swatches; without an active range blank is inert (falls through to
	// solid below, since its dasharray is null).
	const defaultBlank = defaultDash === "blank" && defaultDashArray === null
	// Dash-gap color inputs — the same palette-paired pattern-ink options
	// area patterns resolve their ink from (see `resolveDashGapColor`).
	const { palette: inkPalette, inks: palettePatternInks } = inkPaletteForHue(
		channelConfigs,
		hueType
	)
	const patternInkColors = channelConfigs.pattern?.inkColors ?? {}
	const defaultPatternInk = channelConfigs.defaultPatternInk ?? null
	const dashGapColor = cfg.dashGapColor ?? null
	// The panel's gap swatches key `dashAlternateColors` by HUE value (the
	// color encoding's categories); each line samples its hue value from its
	// first row. The connection-group key is tried second for saved visuals
	// keyed the old way.
	const hueField = encodings.hue?.field ?? null
	// Pattern encoding on line charts drives the LINE DASH STYLE. When the
	// pattern field varies WITHIN a connection group (e.g. a known-vs-
	// projected column on a series that spans both), the polyline splits
	// into runs of constant pattern value and each run renders with its own
	// category's dash — see `splitIntoValueRuns`. Per-category resolution
	// (custom dasharray > swatch override > DASH_CYCLE auto-cycle) is the
	// shared `dashSpecForPatternValue`. Point-fill patterns are tracked
	// SEPARATELY in `pattern.overrides` and resolved in the point render
	// loop above; the two effects don't share storage.
	const patternField = encodings.pattern?.field ?? null
	const dashOverrides = channelConfigs.pattern?.dashOverrides ?? {}
	const customDashOverrides = channelConfigs.pattern?.customDashOverrides ?? {}
	const patternValues = patternField
		? [
				...new Set(
					marks
						.map((m) => m.row[patternField])
						.filter((v) => v !== undefined && v !== null)
						.map(String)
				),
			]
		: []
	// Whether dash gaps get the alternate-color underlay (connected
	// two-color line) or stay empty (truly dashed). Auto unless the user
	// chose: filled, except when pattern and hue map the same field.
	const gapFill = resolveDashGapFill({
		configured: cfg.dashGapFill ?? null,
		patternField,
		hueField: encodings.hue?.field ?? null,
	})
	const groups = new Map<string, Mark[]>()
	marks.forEach((m) => {
		const raw = m.row[connectionField]
		if (raw === undefined || raw === null) return
		const key = String(raw)
		if (key === "") return
		const list = groups.get(key) ?? []
		list.push(m)
		groups.set(key, list)
	})
	// Line-palette index by the group's position in encounter order —
	// counted over ALL groups (including <2-point ones the filter below
	// drops) so a group keeps its palette color as points come and go.
	// Mirrors RadarPlot's groupIdx counting.
	const groupKeys = [...groups.keys()]
	// Series paint order. Palette indices count over `groupKeys` (encounter
	// order) so a line keeps its color regardless of paint order, but WHICH
	// line draws on top follows the Aesthetics "Draw order" setting — ranking
	// each series by its representative row (its connection value and any
	// field constant within the series). Later in the array = painted last =
	// on top, matching the point-mark sort. No setting → encounter order.
	const orderedEntries = sortByDrawOrder(
		[...groups.entries()],
		([, groupMarks]) => groupMarks[0]?.row ?? {},
		channelConfigs.drawOrder,
		dataset,
		drawOrderLevels
	)
	const lines = orderedEntries
		.filter(([, groupMarks]) => groupMarks.length >= 2)
		.flatMap(([groupValue, groupMarks]) => {
			const sorted = [...groupMarks].sort((a, b) => a.cx - b.cx)
			const ptObjs = sorted.map((m) => ({ x: m.cx, y: m.cy }))
			const lineThickness = resolveConnectionThickness({
				groupKey: groupValue,
				thickness: cfg.thickness,
				byValue: thicknessByValue,
			})
			// Line color: the shared connection-stroke chain. The Line color
			// slot owns it when configured — "vary by" a field runs the scale
			// per group, "single color" returns the slot's color. The legacy
			// fallback chain runs per-value override → theme line palette →
			// global stroke override → theme connection color (a real single
			// color, NOT the point fill).
			const stroke = resolveConnectionStroke({
				groupKey: groupValue,
				lineColors,
				linePalette: cfg.linePalette ?? null,
				paletteIdx: groupKeys.indexOf(groupValue),
				strokeColor: cfg.strokeColor ?? null,
				fallback: connectionColor,
				lineSlotCfg: channelConfigs.colorSlots?.line,
				lineSlot,
				slotRow: sorted[0]?.row ?? { [connectionField]: groupValue },
			})
			const lineProps = {
				fill: "none",
				strokeWidth: lineThickness,
				strokeLinecap: strokeCap,
				strokeLinejoin: "round",
				opacity: lineOpacity,
			} as const
			// One segment of this group's line. Solid: a single polyline.
			// Non-solid: a dashed top line, stacked on an underlay (the
			// palette-paired gap color, solid, same thickness) when `gapFill`
			// is on so the gaps between dashes show as the paired color and
			// the line reads as one connected two-color line; with `gapFill`
			// off the gaps stay empty (truly dashed). `blank` = the segment is
			// ALL gap: no top line at all, just the underlay when `gapFill` is
			// on (nothing otherwise) — the range window's "Blank" pick.
			const renderSegment = (
				keyBase: string,
				pts: Array<{ x: number; y: number }>,
				dashArray: string | null,
				patternValue: string | null = null,
				blank = false
			): React.ReactElement[] => {
				if (pts.length < 2) return []
				if (dashArray === null && !blank) {
					return [renderLine(keyBase, pts, { stroke, ...lineProps })]
				}
				const els: React.ReactElement[] = []
				if (gapFill) {
					const hueValueRaw = hueField ? sorted[0]?.row[hueField] : null
					els.push(
						renderLine(`${keyBase}-bg`, pts, {
							stroke: resolveDashGapColor({
								overrideKeys: [
									hueValueRaw === null || hueValueRaw === undefined
										? null
										: String(hueValueRaw),
									groupValue,
								],
								patternValue,
								lineColor: stroke,
								overrides: dashAlternateColors,
								singleOverride: dashGapColor,
								inkColors: patternInkColors,
								palette: inkPalette,
								patternInks: palettePatternInks,
								defaultInk: defaultPatternInk,
							}),
							...lineProps,
						})
					)
				}
				if (dashArray !== null) {
					els.push(
						renderLine(keyBase, pts, {
							stroke,
							strokeDasharray: dashArray,
							...lineProps,
						})
					)
				}
				return els
			}
			// Pattern encoding mapped: split the line into runs of constant
			// pattern value; each run renders with its category's dash.
			// Dash precedence per run: per-line override (legacy data, no UI,
			// kept for back-compat) > Pattern encoding (custom dasharray >
			// swatch override > DASH_CYCLE auto-cycle) > global default.
			// "Apply pattern to range" is IGNORED here — the pattern variable
			// already says where each dash applies, and the two windows would
			// conflict (the panel hides the range rows in this state too).
			if (patternField) {
				const runs = splitIntoValueRuns(sorted, (m) => {
					const raw = m.row[patternField]
					return raw === undefined || raw === null ? null : String(raw)
				})
				return runs.flatMap((run, ri) => {
					const spec =
						run.value !== null
							? dashSpecForPatternValue(
									run.value,
									dashOverrides,
									customDashOverrides,
									patternValues
								)
							: null
					const dashArray =
						spec?.kind === "custom"
							? spec.dasharray
							: dashPatterns[groupValue] !== undefined
								? dashArrayFor(dashPatterns[groupValue] ?? "solid")
								: spec?.kind === "pattern"
									? dashArrayFor(spec.pattern)
									: defaultDashArray
					return renderSegment(
						runs.length === 1
							? `conn-${groupValue}`
							: `conn-${groupValue}-r${ri}`,
						run.items.map((m) => ({ x: m.cx, y: m.cy })),
						dashArray,
						run.value
					)
				})
			}
			// No pattern encoding: one dash for the whole line (per-line
			// override > global default, custom dasharray included).
			const groupDash = dashPatterns[groupValue]
			const dashArray =
				groupDash !== undefined
					? dashArrayFor(groupDash ?? "solid")
					: defaultDashArray
			const blank = groupDash !== undefined ? groupDash === "blank" : defaultBlank
			// "Apply pattern to range": dash only within [From, To] — the
			// parts outside render solid (known vs forecast). Boundary
			// points are interpolated so the segments meet exactly; the
			// alternate-color underlay only backs the dashed segment. A
			// "Blank" pick draws no line inside the window at all — a true
			// gap, or the gap-color underlay alone when `gapFill` is on.
			if ((dashArray !== null || blank) && rangeActive) {
				const segs = splitPolylineAtRange(
					sorted.map((m) => ({ x: m.cx, y: m.cy })),
					rangeMinPx,
					rangeMaxPx,
					"x"
				)
				return [
					...renderSegment(`conn-${groupValue}-pre`, segs.before, null),
					...renderSegment(`conn-${groupValue}-post`, segs.after, null),
					...renderSegment(
						`conn-${groupValue}-in`,
						segs.inside,
						dashArray,
						null,
						blank
					),
				]
			}
			return renderSegment(`conn-${groupValue}`, ptObjs, dashArray)
		})
	return <g>{lines}</g>
}

/** Draw a per-point stem from each mark to an axis line — the primitive
 *  behind lollipop charts. This is a DERIVED per-point mark, not the
 *  connection-group polyline: it needs no connection field and ignores
 *  grouping. The stem lands on the axis line itself (the plot-area edge),
 *  so it reads as a lollipop regardless of whether the value axis starts
 *  at zero. Stem color matches each point's fill; thickness reuses the
 *  connection `thickness`. Rendered before the points so dots sit on top. */
const renderAxisStems = (
	marks: Mark[],
	channelConfigs: ChannelConfigs,
	xScale: PositionScale,
	yScale: PositionScale,
	stemSlot: AestheticScales["colorSlots"]["stem"],
	stemSlotCfg: ColorSlotConfig | undefined,
	/** Per-row stem opacity from the Stem opacity slot. */
	stemOpacity: (row: Record<string, unknown>) => number,
	/** Theme default single color for stems (used when the slot is in
	 *  single-color mode or unconfigured) — a real color, not the point fill. */
	connectionColor: string
) => {
	const cfg = { ...DEFAULT_CONNECTION_CONFIG, ...channelConfigs.connection }
	const stem = cfg.axisStem ?? "none"
	if (stem === "none") return null
	const thickness = cfg.thickness
	// The axis line sits at the plot-area edge: the x-axis along the bottom
	// (largest y pixel), the y-axis along the left (smallest x pixel).
	// Reading the edge off the scale's range keeps us agnostic to range
	// direction (the y-scale's range is inverted top-to-bottom).
	const baselineY = Math.max(...yScale.range())
	const baselineX = Math.min(...xScale.range())
	// Optional INDEPENDENT stem-color encoding:
	//   - "point" (default): each stem inherits its point's fill.
	//   - "single": every stem uses the one `stemColor` swatch.
	//   - "field": stems are colored by `stemColorField` through the
	//     user-picked categorical palette (colors snapshotted on the config).
	const stemMode = cfg.stemColorMode ?? "point"
	const stemColorField = cfg.stemColorField ?? null
	const stemPalette =
		cfg.stemColorPalette && cfg.stemColorPalette.length > 0
			? cfg.stemColorPalette
			: CATEGORICAL_HUE_PALETTE
	const stemHueScale =
		stemMode === "field" && stemColorField
			? makeHueScale(
					marks.map((m) => m.row[stemColorField]),
					"categorical",
					undefined,
					stemPalette
				)
			: null
	const colorFor = (m: Mark): string => {
		// The stem color slot, when configured, owns the color (independent
		// field mapping or single color). In single-color mode (or with no
		// slot) stems draw the theme connection color — a real single color
		// matching the swatch — NOT the point fill.
		if (stemSlotCfg)
			return resolveSlotColor(stemSlot, stemSlotCfg, m.row, connectionColor)
		if (stemMode === "single") return cfg.stemColor ?? connectionColor
		if (stemMode === "field" && stemColorField && stemHueScale) {
			return (
				applyHueScale(stemHueScale, m.row[stemColorField], "categorical") ??
				connectionColor
			)
		}
		return connectionColor
	}
	const stems = marks.map((m) => {
		const [x2, y2] =
			stem === "x-axis" ? [m.cx, baselineY] : [baselineX, m.cy]
		return (
			<line
				key={`stem-${m.i}`}
				className="vc-axis-stem"
				x1={m.cx}
				y1={m.cy}
				x2={x2}
				y2={y2}
				stroke={colorFor(m)}
				strokeWidth={thickness}
				strokeLinecap="round"
				opacity={stemOpacity(m.row)}
			/>
		)
	})
	return <g>{stems}</g>
}

// ---------------------------------------------------------------------------
// Strip-plot overlays: jitter + violin + box. All require one axis to be a
// band/point scale (categorical) and the other to be quantitative.
// ---------------------------------------------------------------------------

type StripAxes = {
	categoryAxis: "x" | "y"
	categoryField: string
	valueField: string
	valueType: FieldType
	categoryScale: { (cat: unknown): number | undefined; step: () => number }
	valueScale: PositionScale
	jitterAmount: number
	/** When true, pack points into a beeswarm instead of random jitter. */
	beeswarm: boolean
	overlay: DistributionOverlayConfig
}

const isBandScale = (
	scale: unknown
): scale is { step: () => number; (cat: unknown): number | undefined } => {
	return (
		typeof (scale as { step?: unknown })?.step === "function" &&
		typeof scale === "function"
	)
}

/** Wrap a `scaleLinear` (used by ordinal-numeric fields) so the violin / box
 * overlay code can treat it like a band scale: position lookups go through
 * `Number(value)` into the linear scale; `step()` reports the average gap
 * between unique values in the data so violinHalfWidth doesn't go to zero
 * (one-or-two-category edge cases get a sensible minimum).
 *
 * Without this, ordinal-numeric axes (e.g. fields like "Stage 1, Stage 2,
 * Stage 3" stored as 1/2/3) wouldn't satisfy `isBandScale`'s shape check,
 * so the overlay layer would silently bail out — exactly the bug users
 * reported as "violins don't draw on ordinal axes". */
const wrapLinearAsBand = (
	linear: PositionScale,
	uniqueValues: string[]
): { step: () => number; (cat: unknown): number | undefined } => {
	const sorted = [...uniqueValues]
		.map(Number)
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => a - b)
	const positions = sorted.map((n) =>
		(linear as unknown as (x: number) => number)(n)
	)
	let step = 0
	if (positions.length >= 2) {
		const first = positions[0] ?? 0
		const last = positions.at(-1) ?? 0
		step = Math.abs(last - first) / (positions.length - 1)
	} else {
		// Single category — fall back to a fraction of the linear range so the
		// violin/box still has visible width.
		const dom = (linear as unknown as { range?: () => number[] }).range?.()
		step = dom ? Math.abs((dom[1] ?? 0) - (dom[0] ?? 0)) / 4 : 40
	}
	const wrapped = (cat: unknown): number | undefined => {
		const n = Number(cat)
		if (!Number.isFinite(n)) return undefined
		return (linear as unknown as (x: number) => number)(n)
	}
	;(wrapped as unknown as { step: () => number }).step = () => step
	return wrapped as {
		step: () => number
		(cat: unknown): number | undefined
	}
}

const resolveStripAxes = (args: {
	xScale: PositionScale
	yScale: PositionScale
	xType: FieldType
	yType: FieldType
	xField: string | null
	yField: string | null
	rows: ReadonlyArray<Record<string, unknown>>
	channelConfigs: ChannelConfigs
}): StripAxes | null => {
	const { xScale, yScale, xType, yType, xField, yField, rows, channelConfigs } =
		args
	if (!xField || !yField) return null

	// "Category-like" = anything that displays as discrete groups: native
	// scaleBand / scalePoint, plus ordinal-numeric axes whose scaleLinear
	// can be wrapped to behave like a band scale (see `wrapLinearAsBand`).
	// Without that fallback, violin / box overlays silently fail on ordinal
	// axes — even though the sidebar happily offers the toggle.
	const xIsBand = isBandScale(xScale)
	const yIsBand = isBandScale(yScale)
	const xIsCategoryLike =
		xIsBand || xType === "categorical" || xType === "ordinal"
	const yIsCategoryLike =
		yIsBand || yType === "categorical" || yType === "ordinal"
	const xIsQuant = xType === "quantitative"
	const yIsQuant = yType === "quantitative"

	const uniqueValuesFor = (field: string): string[] => [
		...new Set(
			rows
				.map((r) => r[field])
				.filter((v) => v !== undefined && v !== null && String(v) !== "")
				.map(String)
		),
	]

	let categoryAxis: "x" | "y"
	let categoryField: string
	let valueField: string
	let valueType: FieldType
	let categoryScale: StripAxes["categoryScale"]
	let valueScale: PositionScale
	if (xIsCategoryLike && yIsQuant && !yIsBand) {
		categoryAxis = "x"
		categoryField = xField
		valueField = yField
		valueType = yType
		categoryScale = xIsBand
			? (xScale as StripAxes["categoryScale"])
			: wrapLinearAsBand(xScale, uniqueValuesFor(xField))
		valueScale = yScale
	} else if (yIsCategoryLike && xIsQuant && !xIsBand) {
		categoryAxis = "y"
		categoryField = yField
		valueField = xField
		valueType = xType
		categoryScale = yIsBand
			? (yScale as StripAxes["categoryScale"])
			: wrapLinearAsBand(yScale, uniqueValuesFor(yField))
		valueScale = xScale
	} else {
		return null
	}

	const cfg: AxisConfig | undefined =
		categoryAxis === "x" ? channelConfigs.x : channelConfigs.y
	const valueCfg: AxisConfig | undefined =
		categoryAxis === "x" ? channelConfigs.y : channelConfigs.x
	// Spread defaults UNDER the saved value so older visuals (saved before
	// `colorOverrides` / `fillColorOverrides` / `usePalette` existed) don't
	// crash on `overlay.colorOverrides[cat]` with `undefined['A']`.
	const overlay: DistributionOverlayConfig = {
		...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
		...valueCfg?.distributionOverlay,
	}

	return {
		categoryAxis,
		categoryField,
		valueField,
		valueType,
		categoryScale,
		valueScale,
		jitterAmount: cfg?.jitterAmount ?? 0,
		beeswarm: cfg?.beeswarm ?? false,
		overlay,
	}
}

/** Deterministic [0, 1] value derived from a row index. mulberry32-flavored
 * mixing — re-renders for the same row index produce the same offset, so
 * jittered points don't dance across re-renders. */
const stableRandom = (i: number): number => {
	let x = (i + 1) * 0x9e3779b1
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
	return ((x ^ (x >>> 16)) >>> 0) / 4294967295
}

const applyJitter = (marks: Mark[], strip: StripAxes | null): Mark[] => {
	if (!strip || strip.jitterAmount <= 0) return marks
	const step = strip.categoryScale.step()
	if (!step) return marks
	const maxOffset = step * 0.5 * strip.jitterAmount
	const axis = strip.categoryAxis
	return marks.map((m) => {
		const delta = (stableRandom(m.i) - 0.5) * 2 * maxOffset
		if (axis === "x") {
			const cx = m.cx + delta
			const line = m.line
				? { ...m.line, x1: m.line.x1 + delta, x2: m.line.x2 + delta }
				: null
			return { ...m, cx, line }
		}
		const cy = m.cy + delta
		const line = m.line
			? { ...m.line, y1: m.line.y1 + delta, y2: m.line.y2 + delta }
			: null
		return { ...m, cy, line }
	})
}

/** One-dimensional beeswarm packing. Given points described by their position
 * along the VALUE axis and their radius, return the offset to apply along the
 * CATEGORY axis for each — packed as close to the band center (offset 0) as
 * possible without any two circles overlapping. Deterministic: the result
 * depends only on the inputs, so points don't dance across re-renders.
 *
 * Algorithm (the standard d3-beeswarm "swarm"): place points in order of
 * value position. For each point, every already-placed neighbor whose value
 * gap is smaller than the sum of radii forbids a horizontal band around its
 * offset (width = the chord that keeps the circles just touching). Pick the
 * offset nearest 0 that sits outside every forbidden band. O(n²) per group,
 * which is fine for the point counts a strip plot renders. */
const computeSwarmOffsets = (
	points: ReadonlyArray<{ pos: number; r: number }>
): number[] => {
	const order = points
		.map((_, i) => i)
		.sort((a, b) => points[a].pos - points[b].pos)
	const offsets = new Array<number>(points.length).fill(0)
	const placed: Array<{ pos: number; r: number; offset: number }> = []
	const EPS = 1e-6
	for (const idx of order) {
		const p = points[idx]
		// Forbidden intervals along the category axis, from each placed neighbor
		// whose circle could overlap this one given their value-axis gap.
		const intervals: Array<[number, number]> = []
		for (const q of placed) {
			const sumR = p.r + q.r
			const dv = Math.abs(p.pos - q.pos)
			if (dv < sumR) {
				const sep = Math.sqrt(sumR * sumR - dv * dv)
				intervals.push([q.offset - sep, q.offset + sep])
			}
		}
		// Candidate offsets: 0 (band center) plus each forbidden boundary.
		// The nearest candidate to 0 that lies outside every interval wins.
		const candidates = [0]
		for (const [lo, hi] of intervals) {
			candidates.push(lo, hi)
		}
		candidates.sort((a, b) => Math.abs(a) - Math.abs(b))
		let chosen = 0
		for (const c of candidates) {
			const free = !intervals.some(([lo, hi]) => c > lo + EPS && c < hi - EPS)
			if (free) {
				chosen = c
				break
			}
		}
		offsets[idx] = chosen
		placed.push({ pos: p.pos, r: p.r, offset: chosen })
	}
	return offsets
}

/** Pack points into a beeswarm along the category axis, leaving their value-axis
 * position untouched. Groups marks by their (shared) category-axis center, packs
 * each group with {@link computeSwarmOffsets}, then shifts cx/cy (and any
 * length/angle line endpoints) by the resulting offset.
 *
 * `pad` widens each point's collision radius — pass the stroke's half-width so
 * the packing accounts for the outline that SVG centers on the circle's edge.
 * Without it, circles pack to touching CENTERS-apart and their strokes visibly
 * overlap. */
const applyBeeswarm = (
	marks: Mark[],
	strip: StripAxes | null,
	pad: number
): Mark[] => {
	if (!strip) return marks
	const axis = strip.categoryAxis
	// Group by the base center along the category axis — applyPositionScale puts
	// every point in a category at that band's center, so equal centers = same
	// category. Round to absorb floating-point noise from the scale.
	const groups = new Map<number, Mark[]>()
	for (const m of marks) {
		const base = axis === "x" ? m.cx : m.cy
		const key = Math.round(base * 1000) / 1000
		const bucket = groups.get(key)
		if (bucket) bucket.push(m)
		else groups.set(key, [m])
	}
	const offsetByIndex = new Map<number, number>()
	for (const bucket of groups.values()) {
		const swarm = computeSwarmOffsets(
			bucket.map((m) => ({ pos: axis === "x" ? m.cy : m.cx, r: m.r + pad }))
		)
		bucket.forEach((m, i) => offsetByIndex.set(m.i, swarm[i]))
	}
	return marks.map((m) => {
		const delta = offsetByIndex.get(m.i) ?? 0
		if (axis === "x") {
			const cx = m.cx + delta
			const line = m.line
				? { ...m.line, x1: m.line.x1 + delta, x2: m.line.x2 + delta }
				: null
			return { ...m, cx, line }
		}
		const cy = m.cy + delta
		const line = m.line
			? { ...m.line, y1: m.line.y1 + delta, y2: m.line.y2 + delta }
			: null
		return { ...m, cy, line }
	})
}

/** Regression line + optional pointwise-CI band over a two-quantitative
 * scatter. One fit over all rows, or one per value of the configured
 * grouping variable. Fits are y-on-x and never extrapolate past the fitted
 * rows' x-extent; the whole layer clips to the panel's plot rect (a
 * polynomial or a CI band can swing outside the dot-driven domain) and is
 * inert to the pointer so it never blocks dot hover. */
const RegressionLayer = ({
	rows,
	xField,
	yField,
	xScale,
	yScale,
	regression,
	channelConfigs,
	aestheticScales,
	inner,
}: {
	rows: Array<Record<string, unknown>>
	xField: string
	yField: string
	xScale: PositionScale
	yScale: PositionScale
	regression: RegressionConfig
	channelConfigs: ChannelConfigs
	aestheticScales: AestheticScales
	inner: PlotInner
}) => {
	const clipId = useId()
	const reg = { ...DEFAULT_REGRESSION_CONFIG, ...regression }
	const degree =
		reg.kind === "linear" ? 1 : Math.min(6, Math.max(2, Math.round(reg.degree)))
	// "Line per group" with no variable chosen yet falls back to the pooled
	// line (the panel prompts for a field; drawing nothing would read as
	// broken).
	const groupField = reg.perGroup ? reg.groupField : null

	// Partition rows into fit groups — a single null-keyed pooled group when
	// not grouping. Rows whose group value is missing are skipped (they
	// belong to no group's fit).
	const groups = new Map<string | null, Array<Record<string, unknown>>>()
	if (groupField) {
		for (const r of rows) {
			const g = coerceCategory(r[groupField])
			if (g === null) continue
			const bucket = groups.get(g)
			if (bucket) bucket.push(r)
			else groups.set(g, [r])
		}
	} else {
		groups.set(null, rows)
	}

	// Inherit per-group line/band colors from the hue encoding when it maps
	// the SAME field the fits are grouped by (mirrors the violin overlay's
	// hue inheritance — and uses the pre-modulation hue color by
	// construction, since it reads the hue scale directly).
	const hueScale = aestheticScales.hue
	const hueGroupScale =
		groupField !== null &&
		hueScale &&
		hueScale.field.name === groupField &&
		hueScale.scale.kind === "categorical"
			? hueScale.scale
			: null

	const px = (v: number): number | null =>
		applyPositionScale(xScale, v, "quantitative")
	const py = (v: number): number | null =>
		applyPositionScale(yScale, v, "quantitative")
	const lineGen = d3Line<[number, number]>()
		.x((d) => d[0])
		.y((d) => d[1])

	// Effective dash + "Apply pattern to range" boundaries — shared by every
	// fit group (per-group fits share the one dash choice and window).
	// Custom dasharray wins; unparseable input falls back to the picked
	// style (same rule as per-category customDashOverrides).
	const regDashArray =
		(reg.customDasharray
			? sanitizeCustomDasharray(reg.customDasharray)
			: null) ?? dashArrayFor(reg.lineStyle)
	const regBoundaryPx = (v: number | string | null): number | null =>
		v === null || v === ""
			? null
			: applyPositionScale(xScale, v, "quantitative")
	const regRange = reg.dashRange
	const regMinPx = regRange?.enabled ? regBoundaryPx(regRange.min) : null
	const regMaxPx = regRange?.enabled ? regBoundaryPx(regRange.max) : null
	const regRangeActive =
		regRange?.enabled === true &&
		regDashArray !== null &&
		(regMinPx !== null || regMaxPx !== null)

	const shapes: React.ReactNode[] = []
	for (const [groupKey, groupRows] of groups) {
		const pts: Array<[number, number]> = []
		for (const r of groupRows) {
			const x = parseValue(r[xField], "quantitative")
			const y = parseValue(r[yField], "quantitative")
			if (typeof x === "number" && typeof y === "number") pts.push([x, y])
		}
		const fit = fitPolynomial(pts, degree)
		if (!fit) continue
		const samples = sampleRange(fit.xExtent[0], fit.xExtent[1], 100)

		// Color/opacity resolution per group, against a representative row
		// (the group's first data row — same convention as the violin/box
		// overlay's slot resolution).
		const slotRow = groupRows[0] ?? {}
		const inherited =
			hueGroupScale && groupKey !== null
				? (applyHueScale(hueGroupScale, groupKey, "categorical") ?? null)
				: null
		const legacyStroke = inherited ?? reg.color
		const legacyFill = inherited ?? reg.ciFillColor
		const stroke = channelConfigs.colorSlots?.regressionStroke
			? resolveSlotColor(
					aestheticScales.colorSlots.regressionStroke,
					channelConfigs.colorSlots.regressionStroke,
					slotRow,
					legacyStroke
				)
			: legacyStroke
		const bandFill = channelConfigs.colorSlots?.regressionCiFill
			? resolveSlotColor(
					aestheticScales.colorSlots.regressionCiFill,
					channelConfigs.colorSlots.regressionCiFill,
					slotRow,
					legacyFill
				)
			: legacyFill
		const strokeOpacity = resolveSlotOpacity(
			aestheticScales.opacitySlots.regressionStroke,
			channelConfigs.opacitySlots?.regressionStroke,
			slotRow,
			OPACITY_SLOT_DEFS.regressionStroke.defaultLevel
		)
		const bandOpacity = resolveSlotOpacity(
			aestheticScales.opacitySlots.regressionCiFill,
			channelConfigs.opacitySlots?.regressionCiFill,
			slotRow,
			OPACITY_SLOT_DEFS.regressionCiFill.defaultLevel
		)

		// CI band first (under the line). `ciAt` is all-or-nothing per fit
		// (null on a saturated fit), so one null sample means no band.
		let bandPath: string | null = null
		if (reg.showCi) {
			const level = reg.ciLevel / 100
			const bandPts: Array<{ x: number; lo: number; hi: number }> = []
			let ciAvailable = true
			for (const sx of samples) {
				const ci = fit.ciAt(sx, level)
				if (!ci) {
					ciAvailable = false
					break
				}
				const xPix = px(sx)
				const lo = py(ci[0])
				const hi = py(ci[1])
				if (
					xPix === null ||
					lo === null ||
					hi === null ||
					!Number.isFinite(lo) ||
					!Number.isFinite(hi)
				) {
					continue
				}
				bandPts.push({ x: xPix, lo, hi })
			}
			if (ciAvailable && bandPts.length >= 2) {
				const areaGen = d3Area<{ x: number; lo: number; hi: number }>()
					.x((d) => d.x)
					.y0((d) => d.lo)
					.y1((d) => d.hi)
				bandPath = areaGen(bandPts) ?? null
			}
		}

		const linePts: Array<[number, number]> = []
		for (const sx of samples) {
			const xPix = px(sx)
			const yPix = py(fit.predict(sx))
			if (xPix === null || yPix === null || !Number.isFinite(yPix)) continue
			linePts.push([xPix, yPix])
		}
		if (linePts.length < 2) continue
		const linePath = lineGen(linePts)
		if (!linePath) continue
		// "Apply pattern to range": dash only within [From, To], solid
		// outside (known vs forecast). Without an active range, the single
		// full-extent path carries the dash (or none) as before.
		const lineSegments: Array<{ key: string; d: string; dashed: boolean }> =
			[]
		if (regRangeActive) {
			const segs = splitPolylineAtRange(
				linePts.map(([x, y]) => ({ x, y })),
				regMinPx,
				regMaxPx,
				"x"
			)
			for (const [part, seg, dashed] of [
				["pre", segs.before, false],
				["in", segs.inside, true],
				["post", segs.after, false],
			] as const) {
				if (seg.length < 2) continue
				const d = lineGen(seg.map((p) => [p.x, p.y] as [number, number]))
				if (d) lineSegments.push({ key: part, d, dashed })
			}
		} else {
			lineSegments.push({ key: "line", d: linePath, dashed: true })
		}

		shapes.push(
			<g key={groupKey ?? "__all__"}>
				{bandPath && (
					<path d={bandPath} fill={bandFill} fillOpacity={bandOpacity} stroke="none" />
				)}
				{lineSegments.map((s) => (
					<path
						key={s.key}
						d={s.d}
						fill="none"
						stroke={stroke}
						strokeWidth={reg.strokeWidth}
						strokeOpacity={strokeOpacity}
						strokeDasharray={
							s.dashed ? (regDashArray ?? undefined) : undefined
						}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				))}
			</g>
		)
	}

	if (shapes.length === 0) return null
	return (
		<g aria-hidden pointerEvents="none">
			<clipPath id={clipId}>
				<rect
					x={inner.x0}
					y={inner.y0}
					width={Math.max(0, inner.x1 - inner.x0)}
					height={Math.max(0, inner.y1 - inner.y0)}
				/>
			</clipPath>
			<g clipPath={`url(#${clipId})`}>{shapes}</g>
		</g>
	)
}

const renderDistributionOverlays = (args: {
	rowsForChart: Array<Record<string, unknown>>
	stripAxes: StripAxes
	channelConfigs: ChannelConfigs
	hueScale: AestheticScales["hue"]
	colorSlots: AestheticScales["colorSlots"]
	opacitySlots: AestheticScales["opacitySlots"]
	/** Whether the underlying scatter marks are rendered alongside the
	 * overlay. When they are, the box's own outlier circles would duplicate
	 * the real data points underneath them, so BoxShape suppresses them. */
	pointsShown: boolean
}): React.ReactNode => {
	const { rowsForChart, stripAxes, hueScale, channelConfigs, colorSlots, opacitySlots } =
		args
	const { overlay } = stripAxes
	if (!overlay.showDensityViolin && !overlay.showBoxPlot) return null

	const aggregation: DistributionAggregation = aggregateDistributions({
		rows: rowsForChart,
		categoryField: stripAxes.categoryField,
		valueField: stripAxes.valueField,
		categoryType: "categorical",
		valueType: stripAxes.valueType,
	})
	if ("error" in aggregation) return null

	const step = stripAxes.categoryScale.step()
	if (!step) return null
	const violinHalfWidth = step * 0.4
	// The box's thickness (perpendicular to the value axis) scales off the
	// category band step. `boxWidthScale` lets the user fatten/thin it; a
	// horizontal box gets taller, a vertical one gets wider (same knob, since
	// the fat dimension just tracks orientation).
	const boxHalfWidth = step * 0.18 * (overlay.boxWidthScale ?? 1)
	// Inherit per-category colors from the hue encoding when it's mapped to
	// the same field as the strip's category axis. Any hue field is selectable
	// while the overlay is on, so a mismatched hue falls back to the global
	// stroke/fill instead of mis-keying colors (to vary by a different field,
	// map it on the Violin / Box Fill or Outline color slot).
	const inheritFromHue =
		hueScale &&
		hueScale.field.name === stripAxes.categoryField &&
		hueScale.scale.kind === "categorical"
	// A violin/box is an aggregate, but color/opacity slots resolve per-row —
	// so resolve each shape against a representative row: the first data row
	// of its category. This lets a slot vary by any field that's constant
	// within a category (e.g. a facet field, constant across the whole panel),
	// not just the category-axis field. A field that varies within a category
	// resolves from that first row (ambiguous for a single shape by
	// construction). The single-variable path has no category field, so its
	// lone group takes the panel's first row.
	const firstRowByCategory = new Map<string, Record<string, unknown>>()
	if (stripAxes.categoryField) {
		for (const r of rowsForChart) {
			const cat = coerceCategory(r[stripAxes.categoryField])
			if (cat !== null && !firstRowByCategory.has(cat)) {
				firstRowByCategory.set(cat, r)
			}
		}
	}
	const slotRowFor = (category: string): Record<string, unknown> =>
		stripAxes.categoryField
			? (firstRowByCategory.get(category) ?? {
					[stripAxes.categoryField]: category,
				})
			: (rowsForChart[0] ?? {})
	// Build category-index lookup for the optional split palettes. The
	// stats array preserves the categoryScale's ordering, so indexing into
	// `aggregation.stats` matches the axis tick order (which is what users
	// see and reason about).
	const categoryIndex = new Map<string, number>(
		aggregation.stats.map((s, i) => [s.category, i])
	)
	const strokePalette = overlay.strokePalette ?? []
	const fillPalette = overlay.fillPalette ?? []
	const colorFromPalette = (
		palette: string[],
		category: string
	): string | null => {
		if (palette.length === 0) return null
		const i = categoryIndex.get(category) ?? 0
		return palette[i % palette.length] ?? null
	}

	return (
		<g aria-hidden>
			{aggregation.stats.map((s) => {
				const catCenter = stripAxes.categoryScale(s.category)
				if (catCenter === undefined) return null
				const inheritedColor = inheritFromHue
					? (applyHueScale(hueScale.scale, s.category, "categorical") ?? null)
					: null
				const strokeFromPalette = colorFromPalette(strokePalette, s.category)
				const fillFromPalette = colorFromPalette(fillPalette, s.category)
				// Resolution order for stroke/fill (highest priority first):
				//   1. per-category override
				//   2. split palette (strokePalette / fillPalette) when set
				//   3. hue inheritance when applicable
				//   4. single fallback color / fillColor
				const legacyStroke =
					overlay.colorOverrides[s.category] ??
					strokeFromPalette ??
					inheritedColor ??
					overlay.color
				const legacyFill =
					overlay.fillColorOverrides[s.category] ??
					fillFromPalette ??
					inheritedColor ??
					overlay.fillColor
				// The violinStroke / violinFill color slots, when configured, own
				// the color (independent field mapping or single color). Absent
				// slots fall through to the legacy resolution above (back-compat).
				const slotRow = slotRowFor(s.category)
				const stroke = channelConfigs.colorSlots?.violinStroke
					? resolveSlotColor(
							colorSlots.violinStroke,
							channelConfigs.colorSlots.violinStroke,
							slotRow,
							legacyStroke
						)
					: legacyStroke
				const fill = channelConfigs.colorSlots?.violinFill
					? resolveSlotColor(
							colorSlots.violinFill,
							channelConfigs.colorSlots.violinFill,
							slotRow,
							legacyFill
						)
					: legacyFill
				// Per-part opacity from the Violin Fill / Outline opacity slots,
				// resolved per category (a field-mapped slot keys off the category
				// value, mirroring the color slots above).
				const fillOpacity = resolveSlotOpacity(
					opacitySlots.violinFill,
					channelConfigs.opacitySlots?.violinFill,
					slotRow,
					OPACITY_SLOT_DEFS.violinFill.defaultLevel
				)
				const strokeOpacity = resolveSlotOpacity(
					opacitySlots.violinStroke,
					channelConfigs.opacitySlots?.violinStroke,
					slotRow,
					OPACITY_SLOT_DEFS.violinStroke.defaultLevel
				)
				return (
					<g key={s.category}>
						{overlay.showDensityViolin && (
							<ViolinShape
								stats={s}
								center={catCenter}
								halfWidth={violinHalfWidth}
								axis={stripAxes.categoryAxis}
								valueScale={stripAxes.valueScale}
								valueType={stripAxes.valueType}
								color={stroke}
								fillColor={fill}
								fillOpacity={fillOpacity}
								strokeOpacity={strokeOpacity}
							/>
						)}
						{overlay.showBoxPlot && (
							<BoxShape
								box={s.box}
								center={catCenter}
								halfWidth={boxHalfWidth}
								axis={stripAxes.categoryAxis}
								valueScale={stripAxes.valueScale}
								valueType={stripAxes.valueType}
								color={stroke}
								fillColor={fill}
								fillOpacity={fillOpacity}
								strokeOpacity={strokeOpacity}
								showOutliers={!args.pointsShown}
							/>
						)}
					</g>
				)
			})}
		</g>
	)
}

const ViolinShape = ({
	stats,
	center,
	halfWidth,
	axis,
	valueScale,
	valueType,
	color,
	fillColor,
	fillOpacity,
	strokeOpacity,
}: {
	stats: { kde: { grid: number[]; density: number[] } }
	center: number
	halfWidth: number
	axis: "x" | "y"
	valueScale: PositionScale
	valueType: FieldType
	color: string
	fillColor: string
	fillOpacity: number
	strokeOpacity: number
}) => {
	const { grid, density } = stats.kde
	const points: Array<[number, number]> = []
	// Forward sweep — left/upper edge.
	for (const [i, element] of grid.entries()) {
		const valuePx = applyPositionScale(valueScale, element as number, valueType)
		if (valuePx === null) continue
		const offset = -((density[i] as number) * halfWidth)
		points.push(
			axis === "x" ? [center + offset, valuePx] : [valuePx, center + offset]
		)
	}
	// Reverse sweep — right/lower edge (mirror).
	for (let i = grid.length - 1; i >= 0; i--) {
		const valuePx = applyPositionScale(valueScale, grid[i] as number, valueType)
		if (valuePx === null) continue
		const offset = (density[i] as number) * halfWidth
		points.push(
			axis === "x" ? [center + offset, valuePx] : [valuePx, center + offset]
		)
	}
	if (points.length < 3) return null
	const d =
		"M " +
		points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ") +
		" Z"
	return (
		<path
			d={d}
			fill={fillColor}
			fillOpacity={fillOpacity}
			stroke={color}
			strokeOpacity={strokeOpacity}
			strokeWidth={1}
			strokeLinejoin="round"
		/>
	)
}

/** Read a continuous scale's numeric `[lo, hi]` domain, or null if it isn't a
 * linear/quantitative scale (band scales expose categories, not numbers). Used
 * to span the density curve's KDE grid across the visible value axis, honoring
 * any pinned min/max baked into the scale. */
const linearDomain = (scale: PositionScale): [number, number] | null => {
	const d = (scale as { domain?: () => unknown[] }).domain?.()
	if (!d || d.length < 2) return null
	const lo = d[0]
	const hi = d.at(-1)
	if (typeof lo !== "number" || typeof hi !== "number" || !(hi > lo)) return null
	return [lo, hi]
}

/** A standalone density curve: one KDE line rising from the axis floor (the
 * bottom for an x-value axis, the left edge for a y-value one). Peak-normalized
 * to `extent`, so it shows distribution shape, not absolute density — matching
 * how the single-variable violin presents. Optionally fills the area beneath. */
const DensityCurveShape = ({
	grid,
	density,
	valueScale,
	valueAxis,
	baseline,
	extent,
	strokeColor,
	strokeOpacity,
	fillColor,
	fillOpacity,
	fill,
	peakOverride,
}: {
	grid: number[]
	/** Un-normalized KDE density; peak-normalized here to fill `extent`. */
	density: number[]
	valueScale: PositionScale
	/** Which axis carries the data value (the other is the density direction). */
	valueAxis: "x" | "y"
	/** Pixel coordinate of the floor the curve grows from. */
	baseline: number
	/** Pixel height (x-value axis) / width (y-value axis) the peak reaches. */
	extent: number
	strokeColor: string
	strokeOpacity: number
	fillColor: string
	fillOpacity: number
	fill: boolean
	/** Shared normalization peak across a group of curves, so grouped curves
	 *  keep their relative heights. Omit for a single curve (normalizes to its
	 *  own peak, filling `extent`). */
	peakOverride?: number
}) => {
	const peak = peakOverride ?? density.reduce((m, v) => Math.max(m, v), 0)
	if (!(peak > 0)) return null
	const pts: Array<[number, number]> = []
	for (const [i, g] of grid.entries()) {
		const valuePx = applyPositionScale(valueScale, g, "quantitative")
		if (valuePx === null) continue
		// Grow toward the plot interior: up (−y) from a bottom floor, right (+x)
		// from a left floor.
		const reach = ((density[i] as number) / peak) * extent
		pts.push(
			valueAxis === "x" ? [valuePx, baseline - reach] : [baseline + reach, valuePx]
		)
	}
	if (pts.length < 2) return null
	const line =
		"M " + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L ")
	// Close the area down to the baseline at both ends for the fill variant.
	const first = pts[0] as [number, number]
	const last = pts.at(-1) as [number, number]
	const area =
		valueAxis === "x"
			? `M ${first[0].toFixed(2)},${baseline.toFixed(2)} ${line.slice(2)} L ${last[0].toFixed(2)},${baseline.toFixed(2)} Z`
			: `M ${baseline.toFixed(2)},${first[1].toFixed(2)} ${line.slice(2)} L ${baseline.toFixed(2)},${last[1].toFixed(2)} Z`
	return (
		<g aria-hidden>
			{fill && (
				<path d={area} fill={fillColor} fillOpacity={fillOpacity} stroke="none" />
			)}
			<path
				d={line}
				fill="none"
				stroke={strokeColor}
				strokeOpacity={strokeOpacity}
				strokeWidth={2}
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
		</g>
	)
}

const BoxShape = ({
	box,
	center,
	halfWidth,
	axis,
	valueScale,
	valueType,
	color,
	fillColor,
	fillOpacity,
	strokeOpacity,
	showOutliers,
}: {
	box: {
		q1: number
		q3: number
		median: number
		lowerWhisker: number
		upperWhisker: number
		outliers: number[]
	}
	center: number
	halfWidth: number
	axis: "x" | "y"
	valueScale: PositionScale
	valueType: FieldType
	color: string
	fillColor: string
	fillOpacity: number
	strokeOpacity: number
	/** The outlier circles duplicate real data points when "Show points" is
	 * on, so the caller turns them off in that case. */
	showOutliers: boolean
}) => {
	const v = (n: number) => applyPositionScale(valueScale, n, valueType)
	const q1Px = v(box.q1)
	const q3Px = v(box.q3)
	const medianPx = v(box.median)
	const loPx = v(box.lowerWhisker)
	const hiPx = v(box.upperWhisker)
	if (
		q1Px === null ||
		q3Px === null ||
		medianPx === null ||
		loPx === null ||
		hiPx === null
	) {
		return null
	}

	const lo = center - halfWidth
	const hi = center + halfWidth
	const outlierR = 2

	if (axis === "x") {
		// Vertical orientation: value goes top-to-bottom, category across.
		const yTop = Math.min(q1Px, q3Px)
		const yBot = Math.max(q1Px, q3Px)
		return (
			// stroke-opacity is inherited by every stroked child below.
			<g strokeOpacity={strokeOpacity}>
				<line x1={center} y1={loPx} x2={center} y2={hiPx} stroke={color} />
				<line
					x1={lo + halfWidth * 0.4}
					y1={loPx}
					x2={hi - halfWidth * 0.4}
					y2={loPx}
					stroke={color}
				/>
				<line
					x1={lo + halfWidth * 0.4}
					y1={hiPx}
					x2={hi - halfWidth * 0.4}
					y2={hiPx}
					stroke={color}
				/>
				<rect
					x={lo}
					y={yTop}
					width={hi - lo}
					height={yBot - yTop}
					fill={fillColor}
					fillOpacity={fillOpacity}
					stroke={color}
				/>
				<line
					x1={lo}
					y1={medianPx}
					x2={hi}
					y2={medianPx}
					stroke={color}
					strokeWidth={1.5}
				/>
				{showOutliers &&
					box.outliers.map((o, i) => {
						const oy = v(o)
						if (oy === null) return null
						return (
							<circle
								// Outliers are raw values, not unique on their own, so we
								// disambiguate with the index — purely a stable React key,
								// not an ordering signal.
								// eslint-disable-next-line react/no-array-index-key
								key={`${i}-${o}`}
								cx={center}
								cy={oy}
								r={outlierR}
								fill="none"
								stroke={color}
							/>
						)
					})}
			</g>
		)
	}

	const xLeft = Math.min(q1Px, q3Px)
	const xRight = Math.max(q1Px, q3Px)
	return (
		// stroke-opacity is inherited by every stroked child below.
		<g strokeOpacity={strokeOpacity}>
			<line x1={loPx} y1={center} x2={hiPx} y2={center} stroke={color} />
			<line
				x1={loPx}
				y1={lo + halfWidth * 0.4}
				x2={loPx}
				y2={hi - halfWidth * 0.4}
				stroke={color}
			/>
			<line
				x1={hiPx}
				y1={lo + halfWidth * 0.4}
				x2={hiPx}
				y2={hi - halfWidth * 0.4}
				stroke={color}
			/>
			<rect
				x={xLeft}
				y={lo}
				width={xRight - xLeft}
				height={hi - lo}
				fill={fillColor}
				fillOpacity={fillOpacity}
				stroke={color}
			/>
			<line
				x1={medianPx}
				y1={lo}
				x2={medianPx}
				y2={hi}
				stroke={color}
				strokeWidth={1.5}
			/>
			{showOutliers &&
				box.outliers.map((o, i) => {
					const ox = v(o)
					if (ox === null) return null
					return (
						<circle
							// Outliers are raw values, not unique on their own, so we
							// disambiguate with the index — purely a stable React key,
							// not an ordering signal.
							// eslint-disable-next-line react/no-array-index-key
							key={`${i}-${o}`}
							cx={ox}
							cy={center}
							r={outlierR}
							fill="none"
							stroke={color}
						/>
					)
				})}
		</g>
	)
}
