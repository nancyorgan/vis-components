import { scalePow } from "d3-scale"
import { DEFAULT_AREA_CONFIG } from "../../../lib/channelConfig"
import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../../lib/legendBreaks"
import {
	applyAreaScale,
	makeAreaScale,
	ordinalAreaCategories,
} from "../../../lib/scales"
import type { LegendProps } from "./types"

export const AreaLegend = ({
	type,
	values,
	configs,
	channelCfg,
	swatchColor,
	swatchStroke,
	orientation = "vertical",
	defaultSwatchOpacity = 1,
	proportionalSizeExponent,
}: LegendProps & {
	defaultSwatchOpacity?: number
	/** Hierarchy modes: swatch radii mirror the layout's TRUE proportions —
	 * zero-anchored value^exponent scaled so the largest break fills the
	 * maxRadius budget — instead of the min→max px range mapping (which
	 * stretches a narrow data range across the full swatch ramp and
	 * promises size differences the chart correctly refuses to draw).
	 * `0.5` = area-true (√); `1` = packed circles' Scale-by-diameter.
	 * Undefined = the historical range mapping (bubble charts, where the
	 * marks themselves use it). Computed by the parent, which knows the
	 * mode. */
	proportionalSizeExponent?: number
}) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const domain = resolveLegendDomain(values, type, channelCfg) ?? undefined
	const dataExt = legendDataExtent(values, type)
	const scale =
		proportionalSizeExponent !== undefined
			? ({
					kind: "numeric" as const,
					scale: scalePow()
						.exponent(proportionalSizeExponent)
						.domain([0, domain?.[1] ?? dataExt?.[1] ?? 1])
						.range([
							0,
							configs.area?.maxRadius ?? DEFAULT_AREA_CONFIG.maxRadius,
						])
						.clamp(true),
				} satisfies ReturnType<typeof makeAreaScale>)
			: makeAreaScale(values, type, configs.area, domain)
	const color = swatchColor ?? "#4f8eda"
	const stroke = swatchStroke ?? "#ffffff"
	// Each swatch to draw: its radius + its label. Numeric fields sample
	// value breaks; a NON-numeric ordinal draws one swatch per category
	// (sized by the category's rank), so the size key reads the same way the
	// per-category sidebar editor does.
	const ordinalCats = type === "ordinal" ? ordinalAreaCategories(values) : null
	let entries: Array<{ key: string; label: string; r: number }>
	if (ordinalCats) {
		entries = ordinalCats.map((c) => ({
			key: c,
			label: c,
			r: applyAreaScale(scale, c, type) ?? 4,
		}))
	} else {
		// Size legends historically showed 3 stops (lo/mid/hi); keep that as the
		// floor so a user typing breakCount=1 doesn't degenerate to a single
		// circle that reads as "show all marks at one size".
		const breaks = resolveLegendBreaks(values, type, channelCfg, 3, 3)
		if (breaks.length === 0) return null
		const customFmt = buildLegendFormatter(merged.format)
		const fmt =
			customFmt ?? ((n: number) => (Number.isFinite(n) ? n.toFixed(2) : ""))
		entries = breaks.map((s, i) => ({
			key: String(s),
			label: decorateOpenEndLabel(fmt(s), i, breaks, dataExt),
			r: applyAreaScale(scale, s, type) ?? 4,
		}))
	}
	if (entries.length === 0) return null
	const maxR = entries.reduce((m, e) => Math.max(m, e.r), 4)
	const colWidth = Math.max(24, Math.ceil(maxR * 2) + 4)
	if (orientation === "horizontal") {
		// Single row of swatches, NO wrap. The legend's outer container
		// expands to accommodate; horizontal layouts get a long row, not
		// a wrapped grid.
		return (
			<div className="flex flex-row flex-nowrap items-end gap-3">
				{entries.map((e) => (
					<div
						key={e.key}
						className="flex flex-shrink-0 flex-col items-center gap-1"
					>
						<svg
							width={Math.max(24, e.r * 2 + 4)}
							height={Math.max(24, e.r * 2 + 4)}
							aria-hidden="true"
						>
							<circle
								cx={Math.max(12, e.r + 2)}
								cy={Math.max(12, e.r + 2)}
								r={e.r}
								fill={color}
								fillOpacity={0.8 * defaultSwatchOpacity}
								stroke={stroke}
							/>
						</svg>
						<span>{e.label}</span>
					</div>
				))}
			</div>
		)
	}
	// Vertical (stacked): one swatch per row, label sits to the right.
	// All circles share the same SVG width so labels align in a column.
	return (
		<div className="flex flex-col gap-1">
			{entries.map((e) => {
				const rowH = Math.max(24, Math.ceil(e.r * 2) + 4)
				return (
					<div key={e.key} className="flex items-center gap-2">
						<svg
							width={colWidth}
							height={rowH}
							aria-hidden="true"
							className="flex-shrink-0"
						>
							<circle
								cx={colWidth / 2}
								cy={rowH / 2}
								r={e.r}
								fill={color}
								fillOpacity={0.8 * defaultSwatchOpacity}
								stroke={stroke}
							/>
						</svg>
						<span className="min-w-0 truncate">{e.label}</span>
					</div>
				)
			})}
		</div>
	)
}
