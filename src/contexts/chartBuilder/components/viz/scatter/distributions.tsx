import {
	aggregateDistributions,
	coerceCategory,
	type DistributionAggregation,
} from "../../../lib/aggregators/distributions"
import type { ChannelConfigs } from "../../../lib/channelConfig"
import {
	resolveSlotColor,
	resolveSlotOpacity,
} from "../../../lib/resolveLayerColor"
import { OPACITY_SLOT_DEFS } from "../../../lib/opacitySlots"
import {
	applyHueScale,
	applyPositionScale,
	type PositionScale,
} from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import type { AestheticScales } from "../../../store/useAestheticScales"
import type { StripAxes } from "./strip"

export const renderDistributionOverlays = (args: {
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
export const linearDomain = (scale: PositionScale): [number, number] | null => {
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
export const DensityCurveShape = ({
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
