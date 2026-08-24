import { useId } from "react"
import { area as d3Area, line as d3Line } from "d3-shape"
import { coerceCategory } from "../../../lib/aggregators/distributions"
import {
	DEFAULT_REGRESSION_CONFIG,
	type ChannelConfigs,
	type RegressionConfig,
} from "../../../lib/channelConfig"
import {
	dashArrayFor,
	sanitizeCustomDasharray,
} from "../../../lib/dashPatterns"
import {
	resolveSlotColor,
	resolveSlotOpacity,
} from "../../../lib/resolveLayerColor"
import { OPACITY_SLOT_DEFS } from "../../../lib/opacitySlots"
import {
	applyHueScale,
	applyPositionScale,
	parseValue,
	type PositionScale,
} from "../../../lib/scales"
import type { PlotInner } from "../../../lib/plotLayout"
import { splitPolylineAtRange } from "../../../lib/dashRange"
import { fitPolynomial, sampleRange } from "../../../lib/regression"
import type { AestheticScales } from "../../../store/useAestheticScales"

/** Regression line + optional pointwise-CI band over a two-quantitative
 * scatter. One fit over all rows, or one per value of the configured
 * grouping variable. Fits are y-on-x and never extrapolate past the fitted
 * rows' x-extent; the whole layer clips to the panel's plot rect (a
 * polynomial or a CI band can swing outside the dot-driven domain) and is
 * inert to the pointer so it never blocks dot hover. */
export const RegressionLayer = ({
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
