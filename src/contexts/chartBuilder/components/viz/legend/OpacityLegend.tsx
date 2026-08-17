import { rgb as d3Rgb } from "d3-color"
import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../../lib/legendBreaks"
import { orderCategories, uniqueValues } from "../../../lib/legendSections"
import { makeOpacityScale } from "../../../lib/scales"
import { renderEntryList } from "./swatches"
import type { ReversibleLegendProps } from "./types"

export const OpacityLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	channelCfg,
	swatchColor,
	entryColumns,
}: ReversibleLegendProps) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const isQuantitative = type === "quantitative" || type === "temporal"
	const domain = isQuantitative
		? (resolveLegendDomain(values, type, channelCfg) ?? undefined)
		: undefined
	const scale = makeOpacityScale(values, type, configs.opacity, domain)
	const swatchHex = swatchColor ?? "#4f8eda"
	// Resolve the swatch color to its r/g/b channels once so the per-stop
	// gradient string can interpolate opacity without re-parsing each time.
	const swatchRgb = d3Rgb(swatchHex)
	const rgbTriple = swatchRgb && !Number.isNaN(swatchRgb.r)
		? `${swatchRgb.r}, ${swatchRgb.g}, ${swatchRgb.b}`
		: "79, 142, 218"
	if (!isQuantitative) {
		const raw = orderCategories(uniqueValues(values, type), type, pinnedOrder)
		const unique = reverseCategorical ? [...raw].reverse() : raw
		return renderEntryList(
			unique.map((v) => {
				const o = scale(v) ?? 1
				return (
					<div key={v} className="flex items-center gap-2">
						<span
							className="block h-3 w-4 rounded-sm"
							style={{ backgroundColor: swatchHex, opacity: o }}
						/>
						<span className="min-w-0 truncate" title={v}>
							{v} ({o.toFixed(2)})
						</span>
					</div>
				)
			}),
			entryColumns,
		)
	}
	const breaks = resolveLegendBreaks(values, type, channelCfg, 5, 2)
	const lo = breaks[0]
	const hi = breaks.at(-1)
	if (lo === undefined || hi === undefined) return null
	const dataExt = legendDataExtent(values, type)
	const customFmt = buildLegendFormatter(merged.format)
	const fallbackFmt = (n: number) =>
		type === "temporal" ? new Date(n).toLocaleDateString() : n.toFixed(2)
	const fmt = customFmt ?? fallbackFmt
	const gradientStops = breaks.map((v, i) => {
		const t = (v - lo) / (hi - lo || 1)
		return {
			t,
			opacity: scale(v) ?? 1,
			label: decorateOpenEndLabel(fmt(v), i, breaks, dataExt),
			i,
		}
	})
	const gradientCss = `linear-gradient(to right, ${gradientStops
		.map((s) => `rgba(${rgbTriple}, ${s.opacity}) ${s.t * 100}%`)
		.join(", ")})`
	return (
		<div className="flex flex-col gap-1">
			<div className="h-3 rounded-sm" style={{ background: gradientCss }} />
			<div className="relative h-5 w-full">
				{gradientStops.map((s) => (
					<span
						key={s.i}
						className="absolute -translate-x-1/2"
						style={{ left: `${s.t * 100}%` }}
					>
						{s.label}
					</span>
				))}
			</div>
		</div>
	)
}
