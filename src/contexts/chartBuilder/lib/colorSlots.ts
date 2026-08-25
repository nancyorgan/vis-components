import type { ChannelConfigs, ColorSlotKey } from "./channelConfig"
import type { ChartMode } from "./chartMode"
import type { Encodings, Theme } from "./types"

/** Static description of one color-slot target: its label, which chart modes
 * surface it, an extra applicability gate (e.g. the violin/box overlay must be
 * on), the theme color it defaults to, and whether it supports mapping a
 * variable (the radar spine is a single line, so it's single-color only). */
export type ColorSlotDef = {
	key: ColorSlotKey
	label: string
	modes: ReadonlySet<ChartMode>
	/** Extra gate beyond chart mode — the underlying feature must be active for
	 * the subheader to be meaningful (overlay on, histogram on, stem on, …). */
	isApplicable: (
		encodings: Encodings,
		configs: ChannelConfigs,
		mode: ChartMode
	) => boolean
	/** Default single ("None") color, sourced from the theme. */
	themeColor: (theme: Theme) => string
	/** When false, the slot offers a single color only — no "vary by" field
	 * dropdown (e.g. the radar spine). */
	acceptsFieldMapping: boolean
}

const m = (...modes: ChartMode[]): ReadonlySet<ChartMode> => new Set(modes)

/** True when the chart's category axis is a histogram (drives the rug slot).
 * Exported so the opacity-slot registry reuses the same gate. */
export const histogramOn = (configs: ChannelConfigs): boolean =>
	configs.x?.histogram?.enabled === true || configs.y?.histogram?.enabled === true

/** True when a violin or box overlay is active on either position axis.
 * Exported so the opacity-slot registry reuses the same gate. */
export const overlayOn = (configs: ChannelConfigs): boolean => {
	const ov = (c: typeof configs.x) =>
		!!c?.distributionOverlay &&
		(c.distributionOverlay.showDensityViolin || c.distributionOverlay.showBoxPlot)
	return ov(configs.x) || ov(configs.y)
}

/** True when a density curve is active on either position axis — the standalone
 * single-variable curve (a Distribution display) OR the histogram overlay.
 * Drives the densityCurve fill / outline slots. Exported so the opacity-slot
 * registry reuses the same gate. */
export const densityCurveOn = (configs: ChannelConfigs): boolean => {
	const standalone = (c: typeof configs.x) =>
		c?.distributionOverlay?.showDensityCurve === true
	const overlay = (c: typeof configs.x) =>
		c?.histogram?.enabled === true && c?.histogram?.showDensity === true
	return (
		standalone(configs.x) ||
		standalone(configs.y) ||
		overlay(configs.x) ||
		overlay(configs.y)
	)
}

/** True when an active density curve's under-curve fill is on. The "Fill under
 * curve" flag lives on `HistogramConfig.densityFill` for BOTH curve forms (the
 * standalone Density display and the histogram overlay share it, so the choice
 * persists across the Histogram ⇄ Density switch). Gates the Density Curve
 * Fill color/opacity slots — an unfilled curve has no fill to style. */
export const densityCurveFillOn = (configs: ChannelConfigs): boolean => {
	const on = (c: typeof configs.x) =>
		(c?.distributionOverlay?.showDensityCurve === true ||
			(c?.histogram?.enabled === true && c?.histogram?.showDensity === true)) &&
		c?.histogram?.densityFill === true
	return on(configs.x) || on(configs.y)
}

/** True when the scatter regression-line overlay is on. Exported so the
 * opacity-slot registry and the renderer reuse the same gate. */
export const regressionOn = (configs: ChannelConfigs): boolean =>
	configs.x?.regression?.enabled === true

/** True when the regression overlay's confidence band is on. */
export const regressionCiOn = (configs: ChannelConfigs): boolean =>
	regressionOn(configs) && configs.x?.regression?.showCi === true

/** The field a density curve is grouped (split) by — whichever field is mapped
 * to the curve's outline or fill color slot (outline wins if both are set).
 * `null` = a single aggregate curve. Both render paths and the legend read this
 * so grouping, coloring, and the legend agree. */
export const densityCurveGroupField = (configs: ChannelConfigs): string | null =>
	configs.colorSlots?.densityCurveStroke?.field ??
	configs.colorSlots?.densityCurveFill?.field ??
	null

/** Registry of every color slot, in display order. Fill and Outline are NOT
 * here — they keep their own storage (`hue` / `outlineHue`) and are rendered
 * by the Color panel via adapters before this list. */
export const COLOR_SLOT_REGISTRY: readonly ColorSlotDef[] = [
	{
		key: "line",
		label: "Line",
		// Scatter connection lines only. Area/radar line + outline color is still
		// handled by the Fill panel's split-palette editor (it owns
		// `connection.lineColors`), so the slot would duplicate it there.
		modes: m("scatter"),
		isApplicable: (encodings) => !!encodings.connection?.field,
		themeColor: (t) => t.connectionColor,
		acceptsFieldMapping: true,
	},
	{
		key: "rug",
		label: "Rug",
		// Histogram rug (bars) + the density display's rug (scatter), which
		// reuses the same tassel config — so the Rug color stays put across the
		// Histogram ⇄ Density switch.
		modes: m("bars-x", "bars-y", "scatter"),
		isApplicable: (_encodings, configs) =>
			histogramOn(configs) || densityCurveOn(configs),
		themeColor: (t) => t.distributionOverlayStroke,
		acceptsFieldMapping: true,
	},
	{
		key: "violinFill",
		label: "Violin / Box Fill",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
		themeColor: (t) => t.distributionOverlayFill,
		acceptsFieldMapping: true,
	},
	{
		key: "violinStroke",
		label: "Violin / Box Outline",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
		themeColor: (t) => t.distributionOverlayStroke,
		acceptsFieldMapping: true,
	},
	{
		key: "densityCurveFill",
		label: "Density Curve Fill",
		// Standalone curve renders in scatter (single-variable distribution);
		// the histogram overlay renders in bars-x / bars-y.
		modes: m("scatter", "bars-x", "bars-y"),
		// Only when "Fill under curve" is on — an unfilled curve has no fill to
		// color (the outline slot below stays whenever the curve is shown).
		isApplicable: (_encodings, configs) => densityCurveFillOn(configs),
		themeColor: (t) => t.distributionOverlayFill,
		// "Vary by" a field splits the curve into one KDE per category, each
		// filled with its category color.
		acceptsFieldMapping: true,
	},
	{
		key: "densityCurveStroke",
		label: "Density Curve Outline",
		modes: m("scatter", "bars-x", "bars-y"),
		isApplicable: (_encodings, configs) => densityCurveOn(configs),
		themeColor: (t) => t.distributionOverlayStroke,
		acceptsFieldMapping: true,
	},
	{
		key: "regressionStroke",
		label: "Regression line",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => regressionOn(configs),
		themeColor: (t) => t.regressionStroke,
		acceptsFieldMapping: true,
	},
	{
		key: "regressionCiFill",
		label: "Confidence interval",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => regressionCiOn(configs),
		themeColor: (t) => t.regressionCiFill,
		acceptsFieldMapping: true,
	},
	{
		key: "stem",
		label: "Stem",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) =>
			(configs.connection?.axisStem ?? "none") !== "none",
		themeColor: (t) => t.connectionColor,
		acceptsFieldMapping: true,
	},
	{
		key: "spine",
		label: "Radar Spine",
		modes: m("radar"),
		isApplicable: () => true,
		themeColor: (t) => t.spineColor,
		acceptsFieldMapping: false,
	},
	{
		key: "geoPointFill",
		label: "Point fill",
		// Bubble / symbol maps render points ON TOP of regions; this slot colors
		// the point fill independently of the choropleth region scale. Also offered
		// on the lat/long dot map (geo-points) — its points benefit from the same
		// dedicated fill color.
		modes: m("geo-symbols", "geo-points"),
		isApplicable: () => true,
		themeColor: (t) => t.defaultFill,
		acceptsFieldMapping: true,
	},
	{
		key: "geoPointStroke",
		label: "Point outline",
		modes: m("geo-symbols", "geo-points"),
		isApplicable: () => true,
		// White by default (the theme's mark outline color) so points read against
		// dark fills / dense choropleth palettes.
		themeColor: (t) => t.outlineColor,
		acceptsFieldMapping: true,
	},
]

export const COLOR_SLOT_DEFS: Record<ColorSlotKey, ColorSlotDef> = Object.fromEntries(
	COLOR_SLOT_REGISTRY.map((d) => [d.key, d])
) as Record<ColorSlotKey, ColorSlotDef>

/** The legacy single-color a slot superseded, read off the old per-feature
 * config field. Used to seed the slot control's single-color swatch so the
 * Color panel reflects a saved visual's color before the user touches it
 * (rendering still uses the legacy field until the slot is created). */
export const legacySlotColor = (
	key: ColorSlotKey,
	configs: ChannelConfigs
): string | undefined => {
	const overlay = configs.x?.distributionOverlay ?? configs.y?.distributionOverlay
	const histogram = configs.x?.histogram ?? configs.y?.histogram
	const connection = configs.connection
	switch (key) {
		case "rug":
			return histogram?.rugColor
		case "violinStroke":
			return overlay?.color
		case "violinFill":
			return overlay?.fillColor
		case "densityCurveFill":
		case "densityCurveStroke":
			// New feature — no legacy per-feature color field to seed from; the
			// slot's theme-seeded singleColor is the source of truth.
			return undefined
		case "line":
			return connection?.strokeColor ?? undefined
		case "stem":
			return connection?.stemColor ?? undefined
		case "spine":
			return configs.angle?.spine?.color
		case "regressionStroke":
			return configs.x?.regression?.color
		case "regressionCiFill":
			return configs.x?.regression?.ciFillColor
	}
}

/** Slots shown for a given chart mode + config — mode matches AND the feature
 * gate passes. Used by the Color panel to pick subheaders. */
export const applicableColorSlots = (
	mode: ChartMode,
	encodings: Encodings,
	configs: ChannelConfigs
): ColorSlotDef[] =>
	COLOR_SLOT_REGISTRY.filter(
		(d) => d.modes.has(mode) && d.isApplicable(encodings, configs, mode)
	)
