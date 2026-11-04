import {
	aggregateDistributions,
	coerceCategory,
	type DistributionAggregation,
	type DistributionStats,
} from "../../../lib/aggregators/distributions"
import {
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	type ChannelConfigs,
	type DistributionOverlayConfig,
} from "../../../lib/channelConfig"
import type { PatternDefSpec } from "../../../lib/patternDefs"
import {
	resolveSlotColor,
	resolveSlotOpacity,
	resolveViolinPatternDef,
	slotModulationResolver,
	slotModulationUnitsResolver,
} from "../../../lib/resolveLayerColor"
import { OPACITY_SLOT_DEFS } from "../../../lib/opacitySlots"
import {
	applyPositionScale,
	modulateColor,
	type PositionScale,
} from "../../../lib/scales"
import type { Encodings, FieldType } from "../../../lib/types"
import type { AestheticScales } from "../../../store/useAestheticScales"
import {
	rowHighlight,
	type LegendHighlight,
} from "../../../store/useLegendHighlight"
import type { TooltipField } from "../HoverTooltip"
import type { StripAxes } from "./strip"
import type { HoverState } from "./types"

type Row = Record<string, unknown>

/** One violin / box body's resolved paint. */
export type OverlayStyle = {
	/** Outline color, after the Violin / box outline sat/bri slots. */
	stroke: string
	/** Body color as drawn, after the Violin / box fill sat/bri slots. */
	fill: string
	/** The fill before modulation — what the pattern ink pairs on (the
	 * palette's exact swatch hex; see `PatternDefItem.preModulationHue`). */
	preModulationFill: string
	/** The fill slots' unit levels (null = untouched), so a pattern tile
	 * modulates like the body (`patternTile`). */
	satUnit: number | null
	briUnit: number | null
	fillOpacity: number
	strokeOpacity: number
	/** The representative row the slots resolved against (see
	 * `overlayStyler`); the fill pattern's category value reads off it too. */
	slotRow: Row
}

/** The distinct categories of `categoryField` in first-seen order, keyed
 * exactly as the aggregation keys them. An empty field = the single-variable
 * case: one group, keyed `""` like `aggregateDistributions` does. */
const overlayCategories = (rows: ReadonlyArray<Row>, categoryField: string) => {
	if (!categoryField) return [""]
	const seen = new Set<string>()
	for (const r of rows) {
		const cat = coerceCategory(r[categoryField])
		if (cat !== null) seen.add(cat)
	}
	return [...seen]
}

/** Per-category stroke / fill / opacity resolution for the violin and box
 * shapes — ONE implementation shared by the renderer and the upfront
 * `<pattern>` defs pass (`buildOverlayPatternDefs`), so a patterned body's
 * tile color is exactly the fill it would otherwise draw. */
export const overlayStyler = (args: {
	rowsForChart: ReadonlyArray<Row>
	categoryField: string
	overlay: DistributionOverlayConfig
	channelConfigs: ChannelConfigs
	aestheticScales: AestheticScales
}): ((category: string) => OverlayStyle) => {
	const { rowsForChart, categoryField, overlay, channelConfigs } = args
	const { colorSlots, opacitySlots } = args.aestheticScales
	// Following the Color variable is NOT done here: an untouched Violin /
	// box fill or outline slot arrives already varying by it (the render-side
	// `withColorSlotDefaults`, fill in the theme's fill palette), so the slot
	// branch below draws it like any explicit "Vary by".
	// A violin/box is an aggregate, but color/opacity slots resolve per-row —
	// so resolve each shape against a representative row: the first data row
	// of its category. This lets a slot vary by any field that's constant
	// within a category (e.g. a facet field, constant across the whole panel),
	// not just the category-axis field. A field that varies within a category
	// resolves from that first row (ambiguous for a single shape by
	// construction). The single-variable path has no category field, so its
	// lone group takes the panel's first row.
	const firstRowByCategory = new Map<string, Row>()
	if (categoryField) {
		for (const r of rowsForChart) {
			const cat = coerceCategory(r[categoryField])
			if (cat !== null && !firstRowByCategory.has(cat)) {
				firstRowByCategory.set(cat, r)
			}
		}
	}
	const slotRowFor = (category: string): Row =>
		categoryField
			? (firstRowByCategory.get(category) ?? { [categoryField]: category })
			: (rowsForChart[0] ?? {})
	// The Saturation / Brightness menus' Violin / box slots — absolute per
	// part, like the points' Outline slot (identity when untouched).
	const modulateStroke = slotModulationResolver(
		"violinStroke",
		channelConfigs,
		args.aestheticScales
	)
	const fillUnits = slotModulationUnitsResolver(
		"violinFill",
		channelConfigs,
		args.aestheticScales
	)
	return (category) => {
		// Legacy resolution (visuals saved before the color slots): the
		// per-category override, else the single color / fillColor.
		const legacyStroke = overlay.colorOverrides[category] ?? overlay.color
		const legacyFill = overlay.fillColorOverrides[category] ?? overlay.fillColor
		// The violinStroke / violinFill color slots, when configured, own
		// the color (independent field mapping or single color). Absent
		// slots fall through to the legacy resolution above (back-compat).
		const slotRow = slotRowFor(category)
		const stroke = channelConfigs.colorSlots?.violinStroke
			? resolveSlotColor(
					colorSlots.violinStroke,
					channelConfigs.colorSlots.violinStroke,
					slotRow,
					legacyStroke
				)
			: legacyStroke
		const preModulationFill = channelConfigs.colorSlots?.violinFill
			? resolveSlotColor(
					colorSlots.violinFill,
					channelConfigs.colorSlots.violinFill,
					slotRow,
					legacyFill
				)
			: legacyFill
		const units = fillUnits?.(slotRow) ?? { sat: null, bri: null }
		const fill =
			units.sat === null && units.bri === null
				? preModulationFill
				: modulateColor(preModulationFill, units.sat, units.bri)
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
		return {
			stroke: modulateStroke(stroke, slotRow),
			fill,
			preModulationFill,
			satUnit: units.sat,
			briUnit: units.bri,
			fillOpacity,
			strokeOpacity,
			slotRow,
		}
	}
}

/** The `<pattern>` def a violin / box body references, or null for a plain
 * fill — the Pattern menu's separate "Violin / box fill" pick
 * (`resolveViolinPatternDef`). The tile sits on the body's own fill; the
 * pattern category (with a pattern variable mapped) reads off the body's
 * representative row, like its color slots. The ink pairs on the fill
 * BEFORE the Violin / box fill sat/bri slots, and the tile modulates by the
 * same units, exactly as a mark's does. */
export const overlayPatternDef = (
	style: OverlayStyle,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): PatternDefSpec | null => {
	const scales = bodyPatternScales(aestheticScales, channelConfigs)
	const bodyField = scales.pattern?.field.name ?? null
	return resolveViolinPatternDef(
		{
			patternValue: bodyField ? style.slotRow[bodyField] : undefined,
			fill: style.fill,
			preModulationHue: style.preModulationFill,
			satUnit: style.satUnit,
			briUnit: style.briUnit,
		},
		scales,
		channelConfigs,
		channelConfigs.pattern?.backgroundColor ?? null
	)
}

/** The scales the body's pattern resolves against, per its "Vary by"
 * (`PatternConfig.violinField`): absent = the Pattern variable's scale, as
 * for the points; null = no variable (the default violin pattern alone); a
 * name = the body's own scale (`AestheticScales.violinPattern`). */
const bodyPatternScales = (
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): AestheticScales => {
	const varyBy = channelConfigs.pattern?.violinField
	if (varyBy === undefined) return aestheticScales
	return {
		...aestheticScales,
		pattern: varyBy === null ? null : (aestheticScales.violinPattern ?? null),
	}
}

/** Every `<pattern>` def the violin / box bodies will reference, for the
 * renderer's upfront `<defs>` pass (a body must never reference a def that
 * wasn't emitted). Walks each position axis carrying an active overlay —
 * the category field is the OTHER axis's field (none = the single-variable
 * overlay) — and resolves one item per category through the same styler
 * the renderer uses. A stale overlay on a non-value axis only adds unused
 * defs. Empty unless a pattern variable or a default violin pattern is
 * set. */
export const buildOverlayPatternDefs = (args: {
	rowsForChart: ReadonlyArray<Row>
	encodings: Encodings
	channelConfigs: ChannelConfigs
	aestheticScales: AestheticScales
}): PatternDefSpec[] => {
	const { rowsForChart, encodings, channelConfigs, aestheticScales } = args
	const bodyMapped =
		bodyPatternScales(aestheticScales, channelConfigs).pattern !== null
	if (
		!bodyMapped &&
		(channelConfigs.pattern?.defaultViolinPattern ?? null) === null
	) {
		return []
	}
	const defs = new Map<string, PatternDefSpec>()
	for (const valueAxis of ["x", "y"] as const) {
		const cfg = channelConfigs[valueAxis]?.distributionOverlay
		if (!cfg || (!cfg.showDensityViolin && !cfg.showBoxPlot)) continue
		const overlay = { ...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG, ...cfg }
		const categoryField =
			(valueAxis === "x" ? encodings.y?.field : encodings.x?.field) ?? ""
		const styleFor = overlayStyler({
			rowsForChart,
			categoryField,
			overlay,
			channelConfigs,
			aestheticScales,
		})
		for (const category of overlayCategories(rowsForChart, categoryField)) {
			const d = overlayPatternDef(styleFor(category), aestheticScales, channelConfigs)
			if (d && !defs.has(d.svgId)) defs.set(d.svgId, d)
		}
	}
	return [...defs.values()]
}

/** A summary statistic's tooltip row: the value variable summarized, so it
 * prints with that variable's format and shows while its "Fields shown"
 * checkbox is on. */
const statField = (
	name: string,
	value: number,
	valueField: string
): TooltipField => ({ name, value, formatAs: valueField, shownWith: valueField })

/** The category row every violin / box element's tooltip leads with (none
 * for the single-variable shape). */
const categoryFields = (categoryField: string, category: unknown): TooltipField[] =>
	categoryField ? [{ name: categoryField, value: category }] : []

/** The hover tooltip for one violin / box body: its category, then the same
 * summary the data table lists for it (Min … Max, N). N is a count, so it
 * only follows the value variable's checkbox, never its format. */
export const distributionTooltipFields = (
	s: DistributionStats,
	categoryField: string,
	valueField: string
): TooltipField[] => {
	const b = s.box
	return [
		...categoryFields(categoryField, s.category),
		statField("Min", b.min, valueField),
		statField("Lower whisker", b.lowerWhisker, valueField),
		statField("Q1", b.q1, valueField),
		statField("Median", b.median, valueField),
		statField("Q3", b.q3, valueField),
		statField("Upper whisker", b.upperWhisker, valueField),
		statField("Max", b.max, valueField),
		{ name: "N", value: s.values.length, shownWith: valueField },
	]
}

/** The hover tooltip for a box's "Mark mean" point, read off its synthetic
 * row (`buildMeanMarks`: the category and the mean). */
export const meanTooltipFields = (
	row: Record<string, unknown>,
	categoryField: string,
	valueField: string
): TooltipField[] => [
	...categoryFields(categoryField, row[categoryField]),
	{ ...statField("Mean", Number(row[valueField]), valueField) },
]

/** Single-element hover keys for a violin / box chart's aggregate parts
 * (`rowHighlight`'s `nodeKey`), before the caller's per-panel scope. */
export const overlayElementKey = {
	violin: (category: string) => `violin:${category}`,
	box: (category: string) => `box:${category}`,
	mean: (category: string) => `mean:${category}`,
	outlier: (category: string, i: number) => `outlier:${category}:${i}`,
	point: (i: number) => `point:${i}`,
}

export const renderDistributionOverlays = (args: {
	rowsForChart: Array<Record<string, unknown>>
	stripAxes: StripAxes
	channelConfigs: ChannelConfigs
	aestheticScales: AestheticScales
	/** Whether the underlying scatter marks are rendered alongside the
	 * overlay. When they are, the box's own outlier circles would duplicate
	 * the real data points underneath them, so they're suppressed. */
	pointsShown: boolean
	setHovered: (h: HoverState | null) => void
	highlight: LegendHighlight | null
	publishHover: (row: Record<string, unknown>, node?: string) => void
	/** Scopes an `overlayElementKey` to this panel, so hovering a box lights
	 * that box alone and not its twin in the next facet panel. */
	elementKey: (local: string) => string
}): React.ReactNode => {
	const { rowsForChart, stripAxes, channelConfigs, aestheticScales } = args
	const { setHovered, highlight, publishHover, elementKey } = args
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
	const styleFor = overlayStyler({
		rowsForChart,
		categoryField: stripAxes.categoryField,
		overlay,
		channelConfigs,
		aestheticScales,
	})
	// Border thickness from the Shape panel's "Violin / box outline" knob —
	// deliberately independent of `shape.outlineWidth` (which the point marks
	// read). 0 hides.
	const strokeWidth = channelConfigs.shape?.distributionOutlineWidth ?? 1
	const { categoryField, valueField } = stripAxes
	const toPx = (v: number) =>
		applyPositionScale(stripAxes.valueScale, v, stripAxes.valueType)

	return (
		<g aria-hidden>
			{aggregation.stats.map((s) => {
				const catCenter = stripAxes.categoryScale(s.category)
				if (catCenter === undefined) return null
				const style = styleFor(s.category)
				// The category is what an aggregate part publishes as its series
				// (any other variable can vary inside it), so a legend hover on
				// the category fades the other categories' parts and one on any
				// other variable leaves them untouched.
				const identity: Row = categoryField ? { [categoryField]: s.category } : {}
				// A "Violin / box fill" pattern tiles over the body's fill
				// (`<PatternDefs>` emitted the def upfront, see
				// `buildOverlayPatternDefs`).
				const pattern = overlayPatternDef(style, aestheticScales, channelConfigs)
				const baseFill = pattern ? `url(#${pattern.svgId})` : style.fill
				/** One hoverable part: its own highlight (a direct hover on it
				 * lights it alone) and its own tooltip, tracking the pointer. `i:
				 * null` — no part is a single data row, so the per-point dim
				 * stays off. `visible`: the whole drawn footprint hovers, the
				 * body included even with a "none" fill. */
				const part = (local: string, fields: TooltipField[]) => {
					const key = elementKey(local)
					const mh = rowHighlight(highlight, identity, key)
					const onHover = (e: React.MouseEvent) =>
						setHovered({
							i: null,
							row: identity,
							clientX: e.clientX,
							clientY: e.clientY,
							fields,
						})
					return {
						mh,
						// The highlight recolor wins over a pattern, as on a point.
						fill: mh.fill ?? baseFill,
						stroke: mh.outline ?? style.stroke,
						strokeOpacity: mh.outline ? 1 : style.strokeOpacity,
						strokeWidth: mh.outline
							? Math.max(strokeWidth, mh.outlineWidth)
							: strokeWidth,
						hoverProps: {
							opacity: mh.opacityMul,
							pointerEvents: "visible",
							onMouseEnter: (e: React.MouseEvent) => {
								onHover(e)
								publishHover(identity, key)
							},
							onMouseMove: onHover,
						} as const,
					}
				}
				const summary = distributionTooltipFields(s, categoryField, valueField)
				const violin = overlay.showDensityViolin
					? part(overlayElementKey.violin(s.category), summary)
					: null
				const box = overlay.showBoxPlot
					? part(overlayElementKey.box(s.category), summary)
					: null
				// The box's Tukey outliers, each its own hover target — only while
				// the data points are hidden (the points already mark them).
				const outliers =
					overlay.showBoxPlot && !args.pointsShown ? s.box.outliers : []
				return (
					<g key={s.category}>
						{violin && (
							<g {...violin.hoverProps}>
								<ViolinShape
									stats={s}
									center={catCenter}
									halfWidth={violinHalfWidth}
									axis={stripAxes.categoryAxis}
									valueScale={stripAxes.valueScale}
									valueType={stripAxes.valueType}
									color={violin.stroke}
									fillColor={violin.fill}
									fillOpacity={style.fillOpacity}
									strokeOpacity={violin.strokeOpacity}
									strokeWidth={violin.strokeWidth}
								/>
							</g>
						)}
						{box && (
							<g {...box.hoverProps}>
								<BoxShape
									box={s.box}
									center={catCenter}
									halfWidth={boxHalfWidth}
									axis={stripAxes.categoryAxis}
									valueScale={stripAxes.valueScale}
									valueType={stripAxes.valueType}
									color={box.stroke}
									fillColor={box.fill}
									fillOpacity={style.fillOpacity}
									strokeOpacity={box.strokeOpacity}
									strokeWidth={box.strokeWidth}
								/>
							</g>
						)}
						{outliers.map((o, i) => {
							const valuePx = toPx(o)
							if (valuePx === null) return null
							const [cx, cy] =
								stripAxes.categoryAxis === "x"
									? [catCenter, valuePx]
									: [valuePx, catCenter]
							const dot = part(overlayElementKey.outlier(s.category, i), [
								...categoryFields(categoryField, s.category),
								statField("Outlier", o, valueField),
							])
							return (
								<g
									// Outliers are raw values, not unique on their own, so we
									// disambiguate with the index — purely a stable React key,
									// not an ordering signal.
									// eslint-disable-next-line react/no-array-index-key
									key={`${i}-${o}`}
									{...dot.hoverProps}
								>
									{/* A 2px ring is unhoverable; a transparent disc around
									    it takes the pointer. */}
									<circle cx={cx} cy={cy} r={OUTLIER_HIT_R} fill="transparent" />
									<circle
										cx={cx}
										cy={cy}
										r={OUTLIER_R}
										fill={dot.mh.fill ?? "none"}
										stroke={dot.stroke}
										strokeOpacity={dot.strokeOpacity}
										strokeWidth={dot.strokeWidth}
									/>
								</g>
							)
						})}
					</g>
				)
			})}
		</g>
	)
}

/** Outlier ring radius, and the radius of the transparent disc that takes
 * the pointer around it. */
const OUTLIER_R = 2
const OUTLIER_HIT_R = 6

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
	strokeWidth,
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
	strokeWidth: number
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
			strokeWidth={strokeWidth}
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
	strokeWidth,
}: {
	box: {
		q1: number
		q3: number
		median: number
		lowerWhisker: number
		upperWhisker: number
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
	strokeWidth: number
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

	if (axis === "x") {
		// Vertical orientation: value goes top-to-bottom, category across.
		const yTop = Math.min(q1Px, q3Px)
		const yBot = Math.max(q1Px, q3Px)
		return (
			// stroke-opacity and stroke-width are inherited by every stroked
			// child below; the median line overrides width for emphasis.
			<g strokeOpacity={strokeOpacity} strokeWidth={strokeWidth}>
				{/* The whisker stems stop at the box edges rather than running
				    through the box: a translucent or empty fill would otherwise
				    show the stem bisecting the body. */}
				<line
					x1={center}
					y1={Math.min(loPx, hiPx)}
					x2={center}
					y2={yTop}
					stroke={color}
				/>
				<line
					x1={center}
					y1={yBot}
					x2={center}
					y2={Math.max(loPx, hiPx)}
					stroke={color}
				/>
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
					strokeWidth={strokeWidth * 1.5}
				/>
			</g>
		)
	}

	const xLeft = Math.min(q1Px, q3Px)
	const xRight = Math.max(q1Px, q3Px)
	return (
		// stroke-opacity and stroke-width are inherited by every stroked
		// child below; the median line overrides width for emphasis.
		<g strokeOpacity={strokeOpacity} strokeWidth={strokeWidth}>
			{/* Stems stop at the box edges — see the vertical branch. */}
			<line
				x1={Math.min(loPx, hiPx)}
				y1={center}
				x2={xLeft}
				y2={center}
				stroke={color}
			/>
			<line
				x1={xRight}
				y1={center}
				x2={Math.max(loPx, hiPx)}
				y2={center}
				stroke={color}
			/>
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
				strokeWidth={strokeWidth * 1.5}
			/>
		</g>
	)
}
