import type { GradientBarStyle, LegendSwatchShape } from "../../../lib/labelsConfig"
import {
	buildLegendFormatter,
	decorateOpenEndLabel,
	legendDataExtent,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "../../../lib/legendBreaks"
import {
	orderCategories,
	sampleRampCssStops,
	uniqueValues,
} from "../../../lib/legendSections"
import { applyHueScale, makeHueScale } from "../../../lib/scales"
import {
	DEFAULT_GRADIENT_BAR_STYLE,
	EntryHoverWrap,
	GradientBarRamp,
	renderEntryList,
	Swatch,
} from "./swatches"
import type { ReversibleLegendProps } from "./types"

export const HueLegend = ({
	type,
	values,
	configs,
	pinnedOrder,
	reverseCategorical,
	gradientLegendStyle = "bar",
	gradientBarStyle = DEFAULT_GRADIENT_BAR_STYLE,
	orientation = "vertical",
	channelCfg,
	splitOutline,
	swatchShape,
	swatchSize,
	swatchOutline = null,
	defaultSwatchOpacity = 1,
	entryColumns,
	highlightField,
}: ReversibleLegendProps & {
	gradientLegendStyle?: "bar" | "swatches"
	/** Resolved gradient-bar display options (length / radius / ticks /
	 * label alignment). Only consulted when the bar branch fires. */
	gradientBarStyle?: GradientBarStyle
	orientation?: "vertical" | "horizontal"
	/** User-chosen outline drawn around every color swatch (the Legend panel's
	 *  "Swatch outline" controls). Applies only where no encoded stroke (the
	 *  area/radar `splitOutline`) already claims the border. `null` = none. */
	swatchOutline?: { color: string; width: number } | null
	/** Opacity for swatch graphics, matching marks at the global default
	 *  opacity when opacity isn't encoded. */
	defaultSwatchOpacity?: number
	/** `SHAPE_PALETTE` index to draw for each swatch instead of the
	 *  default rectangle. `null` / undefined keeps the rectangle. */
	swatchShape?: LegendSwatchShape
	/** Symbol radius (px) for the swatch shape. `null` / undefined → 5. */
	swatchSize?: number | null
	/** Area + radar charts pass the line/outline palette so each
	 *  categorical swatch can draw a border in the matching stroke color.
	 *  `null` (non area/radar modes) → no border, identical to the old
	 *  fill-only swatches. */
	splitOutline?: {
		linePalette: ReadonlyArray<string> | null
		lineColors: Record<string, string>
		/** Global outline color (`connection.strokeColor`) — the renderer's
		 *  stroke fallback after per-value overrides and the line palette. */
		strokeOverride: string | null
	} | null
}) => {
	const merged = resolveLegendChannelConfig(channelCfg)
	const domain = resolveLegendDomain(values, type, channelCfg) ?? undefined
	const scale = makeHueScale(
		values,
		type,
		configs.hue,
		type === "ordinal"
			? (configs.ordinalPalette ?? configs.categoricalPalette)
			: configs.categoricalPalette,
		domain,
	)
	if (scale.kind === "categorical") {
		// `raw` stays in discovery order so `strokeFor` indexes the line
		// palette against the renderer's group iteration; only the displayed
		// order follows the user's pinned field ordering.
		const raw = uniqueValues(values, type)
		const ordered = orderCategories(raw, type, pinnedOrder)
		const unique = reverseCategorical ? [...ordered].reverse() : ordered
		// Stroke resolution per category — matches AreaPlot/RadarPlot's
		// layer-stroke chain: per-value override → palette by index →
		// fall back to fill (returns null when fill = stroke so no
		// border is drawn).
		const strokeFor = (v: string, _i: number, fill: string): string | null => {
			if (!splitOutline) return null
			const override = splitOutline.lineColors[v]
			if (override) return override === fill ? null : override
			const palette = splitOutline.linePalette
			if (palette && palette.length > 0) {
				// Index against the original (pre-reverse) order so palette
				// position lines up with the renderer's group iteration.
				const origIdx = raw.indexOf(v)
				const paletteColor = palette[origIdx % palette.length]
				if (paletteColor) return paletteColor === fill ? null : paletteColor
			}
			// Global outline color (matches AreaPlot/RadarPlot's `strokeColor`
			// fallback). Without this, an area whose lines use one outline color
			// set globally showed no border in the legend.
			const globalStroke = splitOutline.strokeOverride
			if (globalStroke) return globalStroke === fill ? null : globalStroke
			return null
		}
		if (orientation === "horizontal") {
			return (
				<div className="flex flex-row flex-nowrap items-center gap-3">
					{unique.map((v, i) => {
						const c = applyHueScale(scale, v, type) ?? "#888"
						const split = strokeFor(v, i, c)
						return (
							<EntryHoverWrap key={v} field={highlightField} value={v}>
								<Swatch
									color={c}
									strokeColor={split ?? swatchOutline?.color}
									strokeWidth={split ? undefined : swatchOutline?.width}
									shape={swatchShape}
									size={swatchSize}
									opacity={defaultSwatchOpacity}
									horizontal
								>
									{v}
								</Swatch>
							</EntryHoverWrap>
						)
					})}
				</div>
			)
		}
		return renderEntryList(
			unique.map((v, i) => {
				const c = applyHueScale(scale, v, type) ?? "#888"
				const split = strokeFor(v, i, c)
				return (
					<EntryHoverWrap key={v} field={highlightField} value={v}>
						<Swatch
							color={c}
							strokeColor={split ?? swatchOutline?.color}
							strokeWidth={split ? undefined : swatchOutline?.width}
							shape={swatchShape}
							size={swatchSize}
							opacity={defaultSwatchOpacity}
						>
							{v}
						</Swatch>
					</EntryHoverWrap>
				)
			}),
			entryColumns,
		)
	}
	// Quantitative gradient. Break values come from the merged channel
	// config — either the user's custom list or `breakCount` evenly spaced
	// across the data extent (or user-supplied domain if set).
	const breaks = resolveLegendBreaks(values, type, channelCfg, 5, 2)
	const lo = breaks[0]
	const hi = breaks.at(-1)
	if (lo === undefined || hi === undefined) return null
	const dataExt = legendDataExtent(values, type)
	const customFmt = buildLegendFormatter(merged.format)
	const fallbackFmt = (n: number) =>
		type === "temporal"
			? new Date(n).toLocaleDateString()
			: Number.isFinite(n)
				? n.toFixed(2)
				: String(n)
	const fmt = customFmt ?? fallbackFmt
	// When the user's chosen top break sits below the data max, append a
	// "+" to that label — signals "this value or higher, all the same
	// color" (matches the clamp-out-of-range behavior).
	const labelAt = (v: number, i: number) =>
		decorateOpenEndLabel(fmt(v), i, breaks, dataExt)
	if (gradientLegendStyle === "swatches") {
		if (orientation === "horizontal") {
			return (
				<div className="flex flex-row flex-nowrap items-center gap-3">
					{breaks.map((v, i) => (
						<Swatch
							key={v}
							color={applyHueScale(scale, v, type) ?? "#888"}
							strokeColor={swatchOutline?.color}
							strokeWidth={swatchOutline?.width}
							shape={swatchShape}
							size={swatchSize}
							opacity={defaultSwatchOpacity}
							horizontal
						>
							{labelAt(v, i)}
						</Swatch>
					))}
				</div>
			)
		}
		return (
			<div className="flex flex-col gap-1">
				{breaks.map((v, i) => (
					<Swatch
						key={v}
						color={applyHueScale(scale, v, type) ?? "#888"}
						strokeColor={swatchOutline?.color}
						strokeWidth={swatchOutline?.width}
						shape={swatchShape}
						size={swatchSize}
						opacity={defaultSwatchOpacity}
					>
						{labelAt(v, i)}
					</Swatch>
				))}
			</div>
		)
	}
	// Gradient bar: sample colors at each break and emit one stop per break
	// (so the visual gradient transitions are evenly spaced even when the
	// breaks aren't — matches the user's mental model of "this band of
	// color spans from break N to break N+1"). Labels render at the same
	// proportional positions as the break stops.
	const gradientStops = breaks.map((v, i) => ({
		t: (v - lo) / (hi - lo || 1),
		color: applyHueScale(scale, v, type) ?? "#888",
		label: labelAt(v, i),
		key: i,
	}))
	return (
		<GradientBarRamp
			stops={gradientStops}
			cssStops={sampleRampCssStops(scale, lo, hi, type)}
			orientation={orientation}
			barStyle={gradientBarStyle}
		/>
	)
}
