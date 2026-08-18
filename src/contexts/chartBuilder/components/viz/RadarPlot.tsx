import { useMemo, useState } from "react"
import { useAtomValue } from "jotai"
import {
	DEFAULT_ANGLE_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_SHAPE,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_SPINE_CONFIG,
	type AngleConfig,
	type ChannelConfigs,
	type ConnectionConfig,
} from "../../lib/channelConfig"
import { computePolarCirclePixels } from "../../lib/circleAnnotationGeometry"
import type { ChartRendererBaseProps } from "../../lib/chartRendererProps"
import { sampleMarkersByConnection } from "../../lib/connectionSampling"
import { resolveConnectionStroke } from "../../lib/connectionStroke"
import { resolveConnectionThickness } from "../../lib/connectionThickness"
import { radial } from "../../lib/coords"
import { sortByDrawOrder } from "../../lib/drawOrder"
import { slotOpacityResolver } from "../../lib/resolveLayerColor"
import { resolveMarkAesthetics } from "../../lib/resolveMarkAesthetics"
import { dashArrayFor, sanitizeCustomDasharray } from "../../lib/dashPatterns"
import { effectiveType } from "../../lib/fieldType"
import { resolveTextFont, resolveTitleFont } from "../../lib/labelsConfig"
import { buildRadarScales } from "../../lib/radarScales"
import { GlyphMark, resolveGlyph } from "../../lib/customGlyphs"
import { resolveShapeColors } from "../../lib/shapeColors"
import type { DatasetView, FieldType } from "../../lib/types"
import {
	currentAnnotationsAtom,
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
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

import { HoverTooltip, type TooltipState } from "./HoverTooltip"
import { Plot, type CoordFactory, type PlotContext } from "./Plot"

type RadarPlotProps = ChartRendererBaseProps & {
	/** Per-axis scale-row overrides. When PlotCanvas hands different
	 *  rows to the angle vs. R scale (e.g. faceted polar with shareR
	 *  and shareAngle picking different group modes), the combined
	 *  `scalesRowsOverride` is undefined and only the per-axis props
	 *  carry the row sources. RadarPlot reads X→angle and Y→R. */
	scalesRowsOverrideX?: Array<Record<string, unknown>>
	scalesRowsOverrideY?: Array<Record<string, unknown>>
	/** Explicit R-axis domain bounds. Used by faceted polar charts to
	 *  pin the shared or per-strip R scale to a "pretty" floor / max.
	 *  Either bound may be undefined to keep auto-fit on that side. */
	rMinOverride?: number
	rMaxOverride?: number
	/** "Size panels by unit" — scales the drawn radius by this factor
	 *  (0..1). Faceted polar uses the largest panel's unit (R range
	 *  for radar, slice total for pie) as the 1.0 reference; smaller
	 *  panels get proportionally smaller radii. Undefined / 1.0 = no
	 *  shrinking (default). */
	radiusScale?: number
}

/** Minimum padding between the radar's perimeter and the cell edge. The
 *  actual padding grows past this when the longest angle-tick label
 *  wouldn't fit (see `coord` factory below). */
const PERIMETER_PADDING_MIN = 32

/** Matches `SPOKE_LABEL_PADDING` in coords/radial.tsx — the radial gap
 *  between the spoke tip and the label's anchor point. Duplicated here
 *  to keep RadarPlot's padding math self-contained. */
const SPOKE_LABEL_PADDING = 12

/** Polar coord renderer for radar (spider) charts.
 *
 *  Activated when `r` and `angle` are both mapped with no x or y. The
 *  `r` channel drives radial distance from the center; `angle` drives
 *  angular position. Optional `connection` groups rows into closed
 *  polygons sorted by angle.
 *
 *  Composition mirrors scatter: hue/opacity/saturation/brightness color
 *  the dots, length stays available as an independent scatter-style
 *  vector decoration (not implemented yet — first-cut just renders
 *  dots). */
export const RadarPlot = (props: RadarPlotProps = {}) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const annotations = useAtomValue(currentAnnotationsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const labels = useAtomValue(currentLabelsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const dataset = useCurrentDatasetView()
	const aestheticScales = useAestheticScales()
	const legendHighlight = useLegendHighlight()
	const [hovered, setHovered] = useState<TooltipState | null>(null)

	const rField = encodings.r?.field ?? null
	const angleField = encodings.angle?.field ?? null
	const connectionField = encodings.connection?.field ?? null
	// Direct mark hover highlights the point's series. Radar series are keyed by
	// hue when mapped, else the connection field (one polygon per value).
	const markHoverField =
		aestheticScales.hue?.field.name ?? connectionField ?? null
	const markHover = useMarkHoverHighlight(markHoverField)

	const rowsForChart = useMemo(
		() => props.rowsOverride ?? dataset?.rows ?? [],
		[props.rowsOverride, dataset?.rows],
	)
	// Per-axis scale sources. PlotCanvas can hand different rows to
	// the angle vs. R scale (e.g. shareAngle="all" + shareR="perRow"
	// in a faceted radar grid). The combined `scalesRowsOverride` is
	// only set when BOTH axes use the same source — fall back to the
	// per-axis props so partial sharing actually takes effect.
	const rowsForAngleScale =
		props.scalesRowsOverrideX ?? props.scalesRowsOverride ?? rowsForChart
	const rowsForRScale =
		props.scalesRowsOverrideY ?? props.scalesRowsOverride ?? rowsForChart

	const rType: FieldType | null =
		rField && dataset ? effectiveType(dataset, rField, overrides) : null
	const angleType: FieldType | null =
		angleField && dataset
			? effectiveType(dataset, angleField, overrides)
			: null

	const tickFont = resolveTextFont(labels.baseFont)
	const rAxisTitleFont = resolveTitleFont(
		labels.baseFont,
		"secondary",
		labels.fontOverrides?.xAxisTitle,
	)

	const coord: CoordFactory = (inner) => {
		const cx = (inner.x0 + inner.x1) / 2
		const cy = (inner.y0 + inner.y1) / 2
		const halfW = (inner.x1 - inner.x0) / 2
		const halfH = (inner.y1 - inner.y0) / 2
		// Shrink the radar's radius so the longest angle-tick label fits
		// within the cell. We constrain the two dimensions separately:
		//
		//   Horizontal: a side-anchored label (sin(θ) near ±1, e.g. 3 or
		//   9 o'clock) sits at `r + SPOKE_LABEL_PADDING` and extends a
		//   further `labelWidth` outward.
		//        r ≤ halfW − SPOKE_LABEL_PADDING − labelWidth − 4
		//
		//   Vertical: a top/bottom label (cos(θ) near ±1, e.g. 12 or
		//   6 o'clock) sits at `r + SPOKE_LABEL_PADDING` and extends a
		//   half-line-height vertically.
		//        r ≤ halfH − SPOKE_LABEL_PADDING − lineHeight/2 − 4
		//
		// Keeping them separate matters in faceted layouts where one
		// dimension is much smaller than the other (e.g. N×1 stacks make
		// halfH << halfW). Coupling them via min(halfW, halfH) caused
		// horizontal label widths to crush the radar against the smaller
		// dimension's budget.
		const angleLabelsForFit: string[] = (() => {
			if (!angleField || !angleType) return []
			if (angleType !== "categorical" && angleType !== "ordinal") {
				// Quantitative / temporal ticks are formatted at render time —
				// their text is typically short (≤ ~6 chars), so the default
				// minimum padding is enough. Skip measurement.
				return []
			}
			const seen = new Set<string>()
			const out: string[] = []
			for (const r of rowsForAngleScale) {
				const v = r[angleField]
				if (v == null) continue
				const s = String(v)
				if (!seen.has(s)) {
					seen.add(s)
					out.push(s)
				}
			}
			return out
		})()
		const longestAngleLabelPx = (() => {
			if (typeof document === "undefined") return 0
			if (angleLabelsForFit.length === 0) return 0
			const canvas = document.createElement("canvas")
			const ctx = canvas.getContext("2d")
			if (!ctx) return 0
			ctx.font = `${tickFont.size}px ${tickFont.family ?? "sans-serif"}`
			let max = 0
			for (const label of angleLabelsForFit) {
				const w = ctx.measureText(label).width
				if (w > max) max = w
			}
			return max
		})()
		const lineHeight = tickFont.size * 1.4
		const horizMax =
			halfW - SPOKE_LABEL_PADDING - longestAngleLabelPx - 4
		const vertMax = halfH - SPOKE_LABEL_PADDING - lineHeight / 2 - 4
		// Floor at the historical default (half − 32) so cells without
		// long labels stay the same size as before, and at 8px so the
		// radar never collapses to nothing.
		const defaultMax = Math.min(halfW, halfH) - PERIMETER_PADDING_MIN
		const baseRadius = Math.max(8, Math.min(defaultMax, horizMax, vertMax))
		// Apply "Size panels by unit" scaling. Faceted polar passes a
		// 0..1 factor — 1 for the panel with the largest unit, < 1 for
		// smaller panels. Floor at 8 px so a panel never collapses
		// entirely on extreme data ratios.
		const radiusScale =
			props.radiusScale != null && props.radiusScale > 0
				? Math.min(1, props.radiusScale)
				: 1
		const maxRadius = Math.max(8, baseRadius * radiusScale)
		if (!rField || !angleField || !rType || !angleType) {
			// Degenerate state — return an empty radial coord so the shell
			// renders nothing. The encoding-shelf guard below is the user-facing
			// nudge that explains what's missing.
			return radial({
				scales: {
					angleScale: () => null,
					rScale: () => null,
					center: { cx, cy },
					maxRadius,
					angleTicks: [],
					rTicks: [],
					rGridRadii: [],
				},
				rAxisConfig: channelConfigs.r,
				angleAxisConfig: channelConfigs.angle,
				tickFont,
				rAxisTitleFont,
				rLabel: "",
				showRAxis: false,
			})
		}
		const angleRaws = rowsForAngleScale.map((r) => r[angleField])
		const rRaws = rowsForRScale.map((r) => r[rField])
		const radarScales = buildRadarScales({
			angleField,
			angleType,
			angleRaws,
			angleLevelOrder: levelOrders[angleField],
			rField,
			rType,
			rRaws,
			rLevelOrder: levelOrders[rField],
			center: { cx, cy },
			maxRadius,
			rTickCount: channelConfigs.r?.tickCount,
			// "Match tick count" toggle in the R-axis panel encodes its OFF
			// state as a numeric `gridlines.count` and its ON state as
			// `null`. Forward both forms; buildRadarScales decides whether
			// to generate an independent ring set or mirror rTicks.
			rGridlineCount: channelConfigs.r?.gridlines?.count ?? null,
			rMinOverride: props.rMinOverride,
			rMaxOverride: props.rMaxOverride,
			angleConfig: channelConfigs.angle,
		})
		// The radar-spine color + opacity slots (single value only) override the
		// angle axis's spine styling when configured; otherwise the angle
		// config's own values are used (back-compat).
		const spineSlot = channelConfigs.colorSlots?.spine
		const spineOpacity = slotOpacityResolver(
			"spine",
			channelConfigs,
			aestheticScales
		)({})
		const angleAxisConfig: AngleConfig | undefined =
			spineSlot || channelConfigs.opacitySlots?.spine
				? {
						...DEFAULT_ANGLE_CONFIG,
						...channelConfigs.angle,
						spine: {
							...DEFAULT_SPINE_CONFIG,
							...channelConfigs.angle?.spine,
							...(spineSlot ? { color: spineSlot.singleColor } : {}),
							opacity: spineOpacity,
						},
					}
				: channelConfigs.angle
		return radial({
			scales: radarScales,
			rAxisConfig: channelConfigs.r,
			angleAxisConfig,
			tickFont,
			rAxisTitleFont,
			rLabel: labels.xAxisTitle ?? rField,
			showRAxis: true,
			showRAxisTitle: true,
		})
	}

	// Show a hint if either required channel is missing.
	const missing = !rField || !angleField
	if (!dataset) return null
	if (missing) {
		return (
			<div className="flex h-full items-center justify-center text-center text-sm text-stone-600 dark:text-stone-400">
				Map a field to <span className="mx-1 font-semibold">R position</span>{" "}
				and <span className="mx-1 font-semibold">Angle</span> to render a radar
				chart.
			</div>
		)
	}

	const tooltip = hovered ? <HoverTooltip state={hovered} /> : null

	const marksBody = (ctx: PlotContext) => {
		if (ctx.coord.kind !== "radial") return null
		const { angleScale, rScale, center } = ctx.coord.scales
		if (!rField || !angleField || !rType || !angleType) return null

		// Compute screen position + per-row mark aesthetics up-front.
		// Polygons read these indices when grouping by connection value;
		// dots use the resolved shape/fill/stroke to render `<path>` glyphs.
		const shapeAes = aestheticScales.shape
		type RadarPoint = {
			i: number
			cx: number
			cy: number
			angle: number
			row: Record<string, unknown>
			fill: string
			opacity: number
			radius: number
			shapeIdx: number
			shapeFill: string
			shapeStroke: string
		}
		const points: RadarPoint[] = []
		rowsForChart.forEach((row, i) => {
			const a = angleScale(row[angleField])
			const r = rScale(row[rField])
			if (a === null || r === null) return
			const px = center.cx + Math.sin(a) * r
			const py = center.cy - Math.cos(a) * r
			const { fill, opacity, radius } = resolveMarkAesthetics(
				row,
				aestheticScales,
				channelConfigs,
			)
			// Shape index — per-row palette index when shape is mapped,
			// else the user's `defaultShape`. Matches ScatterPlot's path.
			const shapeIdx = shapeAes
				? shapeAes.idx(row[shapeAes.field.name])
				: (channelConfigs.defaultShape ?? DEFAULT_SHAPE)
			const shapeKey = shapeAes
				? String(row[shapeAes.field.name] ?? "")
				: null
			const { fill: shapeFill, stroke: shapeStroke } = resolveShapeColors({
				hueFill: fill,
				shapeCategoryValue: shapeKey,
				shapeConfig: channelConfigs.shape,
				hueMapped: !!aestheticScales.hue,
				fallbackOutline:
					channelConfigs.shape?.outlineColor ?? DEFAULT_SHAPE_CONFIG.outlineColor,
			})
			points.push({
				i,
				cx: px,
				cy: py,
				angle: a,
				row,
				fill,
				opacity,
				radius,
				shapeIdx,
				shapeFill,
				shapeStroke,
			})
		})

		const polygons = connectionField
			? buildPolygons(
					points,
					rowsForChart,
					connectionField,
					channelConfigs,
					aestheticScales.colorSlots.line,
					aestheticScales,
					legendHighlight,
					dataset,
					channelConfigs.drawOrder?.field
						? levelOrders[channelConfigs.drawOrder.field]
						: undefined
				)
			: null

		// Point-sampling: when a connection field is mapped the user can
		// thin out which DOTS render (every Nth, first-and-last, etc.).
		// The polygon outline always passes through every point — only the
		// dot markers respect the sampling preference, mirroring how
		// scatter's `renderConnectionLines` keeps the polyline intact
		// while filtering point shapes. Groups sort by ANGLE (the order
		// points appear around the dial) rather than scatter's cx.
		const markedIndices = connectionField
			? sampleMarkersByConnection(
					points,
					connectionField,
					channelConfigs,
					(p) => p.angle,
				)
			: null

		const outlineWidth = channelConfigs.shape?.outlineWidth ?? 1
		// Per-point border (stroke) opacity from the Border slot.
		const pointBorderOpacity = slotOpacityResolver(
			"border",
			channelConfigs,
			aestheticScales
		)

		// Value-mode circle annotations. Percent-mode circles (and all
		// rectangles) still render in PlotCanvas's annotation layer against
		// the panel's inner rect; only DATA-unit circles need the polar
		// scales, which live here. Center is polar — centerX is an angle-axis
		// value, centerY an r-axis value — and the radius is in r-axis units.
		const renderValueCircles = (layer: "behind" | "front") =>
			(annotations.circles ?? [])
				.filter((c) => c.coordSystem === "values" && c.zOrder === layer)
				.map((c) => {
					const geo = computePolarCirclePixels(c, {
						angleScale,
						rScale,
						center,
						rType,
					})
					if (geo === null) return null
					return (
						<circle
							key={c.id}
							data-annotation-circle={c.id}
							data-annotation-coord="values"
							aria-hidden="true"
							pointerEvents="none"
							cx={geo.cx}
							cy={geo.cy}
							r={geo.r}
							fill={c.backgroundColor}
							fillOpacity={c.backgroundOpacity}
							stroke={c.borderColor}
							strokeWidth={c.borderThickness}
							strokeOpacity={c.borderOpacity}
							strokeDasharray={
								(c.borderDasharray
									? sanitizeCustomDasharray(c.borderDasharray)
									: null) ??
								dashArrayFor(c.borderDash) ??
								undefined
							}
						/>
					)
				})

		return (
			<g
				onMouseLeave={() => {
					setHovered(null)
					markHover.leave()
				}}
			>
				{renderValueCircles("behind")}
				{polygons}
				{points.map((p) => {
					if (markedIndices !== null && !markedIndices.has(p.i)) return null
					// Render every dot as a path so the shape encoding applies.
					// `shapeFill === "none"` keeps the glyph outlined (matches
					// the Shape panel's per-category "hollow" override).
					const baseFillForShape =
						p.shapeFill === "none" ? "none" : p.shapeFill
					const mh = rowHighlight(legendHighlight, p.row)
					const fillForShape = mh.fill ?? baseFillForShape
					return (
						<GlyphMark
							key={p.i}
							glyph={resolveGlyph(
								p.shapeIdx,
								channelConfigs.shape?.customGlyphs
							)}
							r={p.radius}
							transform={`translate(${p.cx},${p.cy})`}
							fill={fillForShape}
							fillOpacity={
								(fillForShape === "none" ? 0 : p.opacity) * mh.opacityMul
							}
							stroke={mh.outline ?? p.shapeStroke}
							strokeWidth={
								mh.outline
									? Math.max(outlineWidth, mh.outlineWidth)
									: outlineWidth
							}
							strokeOpacity={
								mh.outline ? 1 : pointBorderOpacity(p.row) * mh.opacityMul
							}
							onMouseEnter={(e) => {
								setHovered({
									clientX: e.clientX,
									clientY: e.clientY,
									fields: tooltipFieldsFor(p.row, dataset.fields),
								})
								markHover.enter(
									markHoverField ? p.row[markHoverField] : undefined
								)
							}}
						/>
					)
				})}
				{renderValueCircles("front")}
			</g>
		)
	}

	return (
		<Plot inner={props.inner} coord={coord} tooltip={tooltip}>
			{marksBody}
		</Plot>
	)
}

type LocalPoint = {
	i: number
	cx: number
	cy: number
	angle: number
	row: Record<string, unknown>
	fill: string
	opacity: number
	radius: number
}

/** Group rows by their connection value and emit one closed polygon per
 *  group. Points within a group are sorted by angle so the polygon walks
 *  around the dial cleanly even when row order in the dataset doesn't.
 *
 *  Fill is gated on `channelConfigs.connection.fillPolygon` — the toggle
 *  the Connection panel exposes only in radar mode. When fill is on, the
 *  polygon body uses each group's hue-resolved color (so the per-category
 *  fill palette in the Hue panel drives it), and the OUTLINE color
 *  resolves via the same chain area mode uses:
 *    1. `connection.lineColors[groupValue]` — per-value override
 *    2. `connection.linePalette[idx]` — separate outline palette
 *    3. `connection.strokeColor` — global override
 *    4. The fill color — outline matches fill by default. */
const buildPolygons = (
	points: LocalPoint[],
	_rowsForChart: ReadonlyArray<Record<string, unknown>>,
	connectionField: string,
	channelConfigs: ChannelConfigs,
	lineSlot: AestheticScales["colorSlots"]["line"],
	aestheticScales: AestheticScales,
	highlight: LegendHighlight | null,
	/** Active dataset — lets the Aesthetics "Draw order" setting rank which
	 *  polygon paints on top, the same way it ranks line-chart series. */
	dataset: DatasetView | undefined,
	/** User-defined category order for the draw-order field (if any), so
	 *  polygons rank by legend order rather than alphabetically. */
	drawOrderLevels: readonly string[] | undefined,
): React.ReactNode => {
	const cfg: ConnectionConfig = {
		...DEFAULT_CONNECTION_CONFIG,
		...channelConfigs.connection,
	}
	const groups = new Map<string, LocalPoint[]>()
	for (const p of points) {
		const raw = p.row[connectionField]
		if (raw === undefined || raw === null) continue
		const key = String(raw)
		if (key === "") continue
		const list = groups.get(key) ?? []
		list.push(p)
		groups.set(key, list)
	}
	// Palette index counts over encounter order so a polygon keeps its color
	// regardless of paint order; the paint order itself follows the "Draw
	// order" setting (each group ranked by its representative row), mirroring
	// the line-chart series sort. No setting → encounter order.
	const paletteIdxByKey = new Map<string, number>()
	;[...groups.keys()].forEach((key, idx) => paletteIdxByKey.set(key, idx))
	const orderedGroups = sortByDrawOrder(
		[...groups.entries()],
		([, groupPoints]) => groupPoints[0]?.row ?? {},
		channelConfigs.drawOrder,
		dataset,
		drawOrderLevels,
	)
	const fillEnabled = cfg.fillPolygon === true
	// Border (polygon outline) opacity = the Border slot. Polygons are
	// aggregated per group, so a field-mapped border resolves to the slot's
	// level. The fill uses each group's overall opacity (absolute) below.
	const borderOpacity = slotOpacityResolver(
		"border",
		channelConfigs,
		aestheticScales
	)({})
	const elements: React.ReactNode[] = []
	for (const [key, groupPoints] of orderedGroups) {
		if (groupPoints.length < 2) continue
		const groupIdx = paletteIdxByKey.get(key) ?? 0
		const sorted = [...groupPoints].sort((a, b) => a.angle - b.angle)
		const pts = sorted.map((p) => `${p.cx},${p.cy}`).join(" ")
		// Fill color = the group's hue-resolved color (driven by Hue
		// panel's per-category overrides via `aestheticScales.hue`).
		const fillColor = sorted[0]?.fill ?? "#888"
		// Stroke: the shared connection-stroke chain (same one AreaPlot's
		// layer strokes use). The group's representative row exposes every
		// field, so the line color slot can map to any field (commonly the
		// connection field).
		const stroke = resolveConnectionStroke({
			groupKey: key,
			lineColors: cfg.lineColors,
			linePalette: cfg.linePalette ?? null,
			paletteIdx: groupIdx,
			strokeColor: cfg.strokeColor ?? null,
			fallback: fillColor,
			lineSlotCfg: channelConfigs.colorSlots?.line,
			lineSlot,
			slotRow: sorted[0]?.row ?? { [connectionField]: key },
		})
		const mh = rowHighlight(
			highlight,
			sorted[0]?.row ?? { [connectionField]: key }
		)
		// Per-series polygon thickness — a per-category override (keyed by the
		// series/connection value) when set, else the single `cfg.thickness`.
		const lineThickness = resolveConnectionThickness({
			groupKey: key,
			thickness: cfg.thickness,
			byValue: cfg.thicknessByValue,
		})
		elements.push(
			<polygon
				key={`radar-poly-${key}`}
				points={pts}
				fill={fillEnabled ? (mh.fill ?? fillColor) : "none"}
				fillOpacity={(fillEnabled ? (sorted[0]?.opacity ?? 1) : 0) * mh.opacityMul}
				stroke={mh.outline ?? mh.fill ?? stroke}
				strokeOpacity={mh.outline ? 1 : borderOpacity * mh.opacityMul}
				strokeWidth={
					mh.outline
						? Math.max(lineThickness, mh.outlineWidth)
						: lineThickness
				}
				strokeLinejoin="round"
			/>,
		)
	}
	return <g>{elements}</g>
}

const tooltipFieldsFor = (
	row: Record<string, unknown>,
	fields: ReadonlyArray<{ name: string }>,
): TooltipState["fields"] =>
	fields.map((f) => ({ name: f.name, value: row[f.name] }))

