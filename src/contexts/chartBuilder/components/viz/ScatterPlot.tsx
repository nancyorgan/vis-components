import { useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import { computeKde } from "../../lib/aggregators/distributions"
import {
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	type DistributionOverlayConfig,
} from "../../lib/channelConfig"
import type { ScatterRendererProps } from "../../lib/chartRendererProps"
import { cartesian } from "./coords"
import { buildPatternDefsFromItems } from "../../lib/buildPatternDefs"
import { sampleMarkersByConnection } from "../../lib/connectionSampling"
import { densityCurveGroupField } from "../../lib/colorSlots"
import { sortByDrawOrder } from "../../lib/drawOrder"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import {
	resolveSlotColor,
	slotOpacityResolver,
} from "../../lib/resolveLayerColor"
import { resolveMarkAesthetics } from "../../lib/resolveMarkAesthetics"
import {
	applyPositionScale,
	makePositionScale,
	maxMeaningfulTicks,
	overrideLinearDomain,
} from "../../lib/scales"
import type { Encodings } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
} from "../../store/atoms"
import { useAestheticScales } from "../../store/useAestheticScales"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import {
	useLegendHighlight,
	useMarkHoverHighlight,
} from "../../store/useLegendHighlight"

import { DataLabelsLayer } from "./DataLabelsLayer"
import { HoverTooltip } from "./HoverTooltip"
import { Plot, type CoordFactory, type PlotContext } from "./Plot"
import { renderAxisStems, renderConnectionLines } from "./scatter/connections"
import {
	DensityCurveShape,
	linearDomain,
	renderDistributionOverlays,
} from "./scatter/distributions"
import {
	buildMarks,
	drawOrderSizeTieBreak,
	renderMarkPaths,
	renderTextLabels,
} from "./scatter/marks"
import { RegressionLayer } from "./scatter/RegressionLayer"
import {
	applyBeeswarm,
	applyJitter,
	resolveStripAxes,
	type StripAxes,
} from "./scatter/strip"
import type { HoverState } from "./scatter/types"

// ScatterPlot.tsx stays the import entry point for the scatter renderer: the
// mark building, connection/stem lines, strip-plot packing, regression layer,
// and distribution shapes live under `./scatter/`. The component here is the
// module's only export, matching the pre-split surface.

type ScatterPlotProps = ScatterRendererProps

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
	// Theme source for the connection / stem default single color — the color
	// a "single color" line/stem draws when the slot isn't varying by a field.
	const liveTheme = useCurrentTheme()
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
					// Line hovers supply their own fields (connection value +
					// series-constant fields); point hovers show the full row.
					fields:
						hovered.fields ??
						dataset.fields.map((f) => ({
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
					aestheticScales.hue?.field.type,
					aestheticScales.themeInkFallback,
					setHovered
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
