import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../../lib/legendBreaks"
import { orderCategories, uniqueValues } from "../../../lib/legendSections"
import { makeLengthScale } from "../../../lib/scales"
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
	// Categorical / ordinal length: one swatch per unique category, sized
	// by the length scale (which distributes evenly across categories).
	if (type === "categorical" || type === "ordinal") {
		const unique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
		if (unique.length === 0) return null
		// Pin every row to the max swatch width so labels line up in a
		// consistent column (per-row sizing pushes long-segment rows'
		// labels past the legend's width budget and triggers truncation).
		const maxLen = unique.reduce((m, v) => Math.max(m, scale(v) ?? 10), 0)
		const svgWidth = Math.max(24, maxLen + 4)
		return (
			<div className="flex flex-col gap-1">
				{unique.map((v) => {
					const len = scale(v) ?? 10
					return (
						<div key={v} className="flex items-center gap-2">
							<SwatchCell>
								<svg
									width={svgWidth}
									height={8}
									aria-hidden="true"
									className="flex-shrink-0"
								>
									<line
										x1={2}
										y1={4}
										x2={2 + len}
										y2={4}
										stroke={color}
										strokeWidth={3}
										strokeLinecap="round"
									/>
								</svg>
							</SwatchCell>
							<span className="min-w-0 truncate" title={v}>
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
	const customFmt = buildLegendFormatter(merged.format)
	const fmt = customFmt ?? ((n: number) => (Number.isFinite(n) ? n.toFixed(2) : ""))
	const maxBreakLen = breaks.reduce((m, s) => Math.max(m, scale(s) ?? 10), 0)
	const svgWidth = Math.max(24, maxBreakLen + 4)
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
							<svg width={svgWidth} height={8} aria-hidden="true">
								<line
									x1={2}
									y1={4}
									x2={2 + len}
									y2={4}
									stroke={color}
									strokeWidth={3}
									strokeLinecap="round"
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
		<div className="flex flex-col gap-1">
			{breaks.map((s, i) => {
				const len = scale(s) ?? 10
				return (
					<div key={s} className="flex items-center gap-2">
						<SwatchCell>
							<svg
								width={svgWidth}
								height={8}
								aria-hidden="true"
								className="flex-shrink-0"
							>
								<line
									x1={2}
									y1={4}
									x2={2 + len}
									y2={4}
									stroke={color}
									strokeWidth={3}
									strokeLinecap="round"
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
