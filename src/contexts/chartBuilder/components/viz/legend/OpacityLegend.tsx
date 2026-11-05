import { rgb as d3Rgb } from "d3-color"
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
import { makeOpacityScale } from "../../../lib/scales"
import {
	DEFAULT_GRADIENT_BAR_STYLE,
	GradientBarRamp,
	renderEntryList,
	SwatchCell,
} from "./swatches"
import type { GradientBarStyle } from "../../../lib/labelsConfig"
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
	orientation = "vertical",
	rampStyle = "bar",
	barStyle = DEFAULT_GRADIENT_BAR_STYLE,
}: ReversibleLegendProps & {
	/** Continuous legend as a gradient bar (the historical look) or one
	 *  swatch per break — the Legend panel's Gradient legend style. */
	rampStyle?: "bar" | "swatches"
	/** Shared gradient-bar settings (length / thickness / ticks / …). */
	barStyle?: GradientBarStyle
}) => {
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
		const raw = orderCategories(uniqueValues(values, { type }), type, pinnedOrder)
		const unique = reverseCategorical ? [...raw].reverse() : raw
		return renderEntryList(
			unique.map((v) => {
				const o = scale(v) ?? 1
				return (
					<div key={v} className="flex items-center gap-2">
						<SwatchCell>
							<span
								className="block h-3 w-4 flex-shrink-0 rounded-sm"
								style={{ backgroundColor: swatchHex, opacity: o }}
							/>
						</SwatchCell>
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
	const fmt = buildLegendFormatter(merged.format, defaultLegendFormatter(breaks, type), {
		values: breaks,
		type,
	})
	const rgba = (o: number) => `rgba(${rgbTriple}, ${o})`
	const label = (v: number, i: number) =>
		decorateOpenEndLabel(fmt(v), i, breaks, dataExt)
	if (rampStyle === "swatches") {
		const rows = breaks.map((v, i) => (
			<div key={v} className="flex items-center gap-2">
				<SwatchCell>
					<span
						className="block h-3 w-4 flex-shrink-0 rounded-sm"
						style={{ backgroundColor: rgba(scale(v) ?? 1) }}
					/>
				</SwatchCell>
				<span className="min-w-0 truncate">{label(v, i)}</span>
			</div>
		))
		return orientation === "horizontal" ? (
			<div className="flex flex-row flex-nowrap items-center gap-3">{rows}</div>
		) : (
			renderEntryList(rows, entryColumns)
		)
	}
	// The same gradient bar as a continuous Color legend: honors the
	// orientation and the shared bar settings.
	return (
		<GradientBarRamp
			stops={breaks.map((v, i) => ({
				t: (v - lo) / (hi - lo || 1),
				color: rgba(scale(v) ?? 1),
				label: label(v, i),
				key: i,
			}))}
			cssStops={Array.from({ length: 32 }, (_, i) => {
				const v = lo + ((hi - lo) * i) / 31
				return { t: i / 31, color: rgba(scale(v) ?? 1) }
			})}
			orientation={orientation}
			barStyle={barStyle}
		/>
	)
}
