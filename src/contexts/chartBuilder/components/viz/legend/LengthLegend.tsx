import {
	buildLegendFormatter,
	defaultLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../../lib/legendBreaks"
import { orderCategories } from "../../../lib/legendSections"
import { uniqueValues } from "../../../lib/uniqueFieldValues"
import { makeLengthScale } from "../../../lib/scales"
import { DEFAULT_SEGMENT_THICKNESS } from "../../../lib/channelConfig"
import { segmentStrokeLinecap } from "../../../lib/segmentStroke"
import { SwatchCell } from "./swatches"
import type { LegendProps } from "./types"

export const LengthLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	channelCfg,
	swatchColor,
	orientation = "vertical",
}: LegendProps) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const domain = resolveLegendDomain(values, type, channelCfg) ?? undefined
	const scale = makeLengthScale(values, type, configs.length, domain)
	const color = swatchColor ?? "#4f8eda"
	// Swatches follow Length → Segment properties: the single thickness
	// (per-level Vary-by widths key on another variable, so the legend
	// shows the base width) and the line cap. The swatch box grows with
	// the stroke so thick segments aren't clipped.
	const strokeWidth = configs.length?.segmentThickness ?? DEFAULT_SEGMENT_THICKNESS
	const strokeCap = segmentStrokeLinecap(configs.length)
	const swatchH = Math.max(8, Math.ceil(strokeWidth) + 2)
	// Round caps reach half a stroke past each endpoint — inset so they fit.
	const pad = strokeCap === "round" ? Math.max(2, strokeWidth / 2) : 2
	// Categorical / ordinal length: one swatch per unique category, sized
	// by the length scale (which distributes evenly across categories).
	if (type === "categorical" || type === "ordinal") {
		const unique = orderCategories(uniqueValues(values, { type }), type, pinnedOrder)
		if (unique.length === 0) return null
		// Pin every row to the max swatch width so labels line up in a
		// consistent column (per-row sizing pushes long-segment rows'
		// labels past the legend's width budget and triggers truncation).
		const maxLen = unique.reduce((m, v) => Math.max(m, scale(v) ?? 10), 0)
		const svgWidth = Math.max(24, maxLen + pad * 2)
		return (
			<div className="vc-legend-rows flex flex-col gap-1">
				{unique.map((v) => {
					const len = scale(v) ?? 10
					return (
						<div key={v} className="flex items-center gap-2">
							<SwatchCell>
								<svg
									width={svgWidth}
									height={swatchH}
									aria-hidden="true"
									className="flex-shrink-0"
								>
									<line
										x1={pad}
										y1={swatchH / 2}
										x2={pad + len}
										y2={swatchH / 2}
										stroke={color}
										strokeWidth={strokeWidth}
										strokeLinecap={strokeCap}
									/>
								</svg>
							</SwatchCell>
							<span className="min-w-0 truncate" data-legend-label={v}>
								{v}
							</span>
						</div>
					)
				})}
			</div>
		)
	}
	const breaks = resolveLegendBreaks(values, type, channelCfg, 3, 3)
	if (breaks.length === 0) return null
	const dataExt = legendDataExtent(values, type)
	const fmt = buildLegendFormatter(merged.format, defaultLegendFormatter(breaks, type), {
		values: breaks,
		type,
	})
	const maxBreakLen = breaks.reduce((m, s) => Math.max(m, scale(s) ?? 10), 0)
	const svgWidth = Math.max(24, maxBreakLen + pad * 2)
	if (orientation === "horizontal") {
		return (
			<div className="flex flex-row flex-nowrap items-end gap-3">
				{breaks.map((s, i) => {
					const len = scale(s) ?? 10
					return (
						<div
							key={s}
							className="flex flex-shrink-0 flex-col items-center gap-1"
						>
							<svg width={svgWidth} height={swatchH} aria-hidden="true">
								<line
									x1={pad}
									y1={swatchH / 2}
									x2={pad + len}
									y2={swatchH / 2}
									stroke={color}
									strokeWidth={strokeWidth}
									strokeLinecap={strokeCap}
								/>
							</svg>
							<span>{decorateOpenEndLabel(fmt(s), i, breaks, dataExt)}</span>
						</div>
					)
				})}
			</div>
		)
	}
	// Vertical (stacked): label sits to the right of each segment.
	return (
		<div className="vc-legend-rows flex flex-col gap-1">
			{breaks.map((s, i) => {
				const len = scale(s) ?? 10
				return (
					<div key={s} className="flex items-center gap-2">
						<SwatchCell>
							<svg
								width={svgWidth}
								height={swatchH}
								aria-hidden="true"
								className="flex-shrink-0"
							>
								<line
									x1={pad}
									y1={swatchH / 2}
									x2={pad + len}
									y2={swatchH / 2}
									stroke={color}
									strokeWidth={strokeWidth}
									strokeLinecap={strokeCap}
								/>
							</svg>
						</SwatchCell>
						<span className="min-w-0 truncate">
							{decorateOpenEndLabel(fmt(s), i, breaks, dataExt)}
						</span>
					</div>
				)
			})}
		</div>
	)
}
