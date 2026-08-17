import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../../lib/legendBreaks"
import { orderCategories, uniqueValues } from "../../../lib/legendSections"
import { makeAngleScale } from "../../../lib/scales"
import type { LegendProps } from "./types"

export const AngleLegend = ({
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
	const scale = makeAngleScale(values, type, configs.angle, domain)
	const color = swatchColor ?? "#4f8eda"
	// Categorical / ordinal angle: one swatch per category, rotated by the
	// angle scale (which evenly distributes categories across the range).
	if (type === "categorical" || type === "ordinal") {
		const unique = orderCategories(uniqueValues(values, type), type, pinnedOrder)
		if (unique.length === 0) return null
		const lineLen = 10
		return (
			<div className="flex flex-col gap-1">
				{unique.map((v) => {
					const rad = scale(v) ?? 0
					const dx = Math.cos(rad) * lineLen
					const dy = Math.sin(rad) * lineLen
					return (
						<div key={v} className="flex items-center gap-2">
							<svg width={24} height={24} aria-hidden="true">
								<line
									x1={12 - dx}
									y1={12 + dy}
									x2={12 + dx}
									y2={12 - dy}
									stroke={color}
									strokeWidth={2}
									strokeLinecap="round"
								/>
							</svg>
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
	const lineLen = 10
	const angleSvgFor = (s: number) => {
		const rad = scale(s) ?? 0
		const dx = Math.cos(rad) * lineLen
		const dy = Math.sin(rad) * lineLen
		// Default angle label is the resolved degrees, not the raw input
		// value — degrees are what the swatch actually shows so the label
		// reading "0°", "45°", "90°" matches the rotation visually. Users
		// who want raw-value labels can pick a custom d3-format and the
		// raw break value is fed through it instead.
		const rawLabel = customFmt
			? customFmt(s)
			: Number.isFinite(s)
				? `${((rad * 180) / Math.PI).toFixed(0)}°`
				: ""
		return { dx, dy, rawLabel }
	}
	if (orientation === "horizontal") {
		return (
			<div className="flex flex-row flex-nowrap items-end gap-3">
				{breaks.map((s, i) => {
					const { dx, dy, rawLabel } = angleSvgFor(s)
					const label = decorateOpenEndLabel(rawLabel, i, breaks, dataExt)
					return (
						<div
							key={s}
							className="flex flex-shrink-0 flex-col items-center gap-1"
						>
							<svg width={24} height={24} aria-hidden="true">
								<line
									x1={12 - dx}
									y1={12 + dy}
									x2={12 + dx}
									y2={12 - dy}
									stroke={color}
									strokeWidth={2}
									strokeLinecap="round"
								/>
							</svg>
							<span>{label}</span>
						</div>
					)
				})}
			</div>
		)
	}
	return (
		<div className="flex flex-col gap-1">
			{breaks.map((s, i) => {
				const { dx, dy, rawLabel } = angleSvgFor(s)
				const label = decorateOpenEndLabel(rawLabel, i, breaks, dataExt)
				return (
					<div key={s} className="flex items-center gap-2">
						<svg
							width={24}
							height={24}
							aria-hidden="true"
							className="flex-shrink-0"
						>
							<line
								x1={12 - dx}
								y1={12 + dy}
								x2={12 + dx}
								y2={12 - dy}
								stroke={color}
								strokeWidth={2}
								strokeLinecap="round"
							/>
						</svg>
						<span className="min-w-0 truncate">{label}</span>
					</div>
				)
			})}
		</div>
	)
}
