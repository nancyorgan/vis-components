import type {
	ChannelConfigs,
	ColorSlotConfig,
	ColorSlotKey,
} from "./channelConfig"
import type { ChartMode } from "./chartMode"
import { CATEGORICAL_HUE_PALETTE } from "./scales"
import type { Encodings, Theme } from "./types"

/** Static description of one color-slot target: its label, which chart modes
 * surface it, an extra applicability gate (e.g. the violin/box overlay must be
 * on), the theme color it defaults to, and whether it supports mapping a
 * variable (the spine-like single lines are single-color only). */
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
	 * dropdown. */
	acceptsFieldMapping: boolean
	/** Present when an UNCONFIGURED slot does NOT render the default single
	 * color but follows the main Color (hue) encoding (regression, combo points).
	 * The panel then leads the Vary-by list with this "Automatic" option —
	 * which clears the stored slot — so the untouched state displays
	 * truthfully, and "Single color" is an explicit stored choice that really
	 * renders one color. Slots whose fall-through is just a single color must
	 * NOT set this: there, "Single color" already describes the default. */
	inherit?: { label: string; help?: string }
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

/** True when the chart is a radar whose series polygons are FILLED — the
 * gate for the polygon BODY's own targets (the Polygon fill color / opacity /
 * saturation / brightness slots and the Pattern menu's "Polygon fill"
 * section): an unfilled polygon has no body to style. Shared so the
 * registries and panels can't drift. */
export const filledRadarOn = (mode: ChartMode, configs: ChannelConfigs): boolean =>
	mode === "radar" && configs.connection?.fillPolygon === true

/** True when an area chart draws point markers on its layer edges: a
 * Connection field mapped and Connection → "Show points" not "No points".
 * The gate for the area modes' Point fill / Point outline targets in every
 * aesthetic menu — with no points there is nothing for them to style. */
export const areaPointsOn = (encodings: Encodings, configs: ChannelConfigs): boolean =>
	!!encodings.connection?.field &&
	(configs.connection?.pointSampling ?? "all") !== "none"

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
		// Scatter connection lines, the combo modes' marks-layer lines
		// (ScatterPlot's line builder over the bars), and the radar polygon
		// OUTLINE — the Color menu's "Connection line", where the untouched
		// slot matches each polygon's fill (see `RADAR_LINE_INHERIT`). The
		// area modes' layer outline is still the split-palette editor (it owns
		// `connection.lineColors`), so the slot would duplicate it there.
		modes: m("scatter", "combo-x", "combo-y", "radar"),
		isApplicable: (encodings) => !!encodings.connection?.field,
		themeColor: (t) => t.connectionColor,
		acceptsFieldMapping: true,
	},
	{
		key: "areaPointFill",
		label: "Point fill",
		// Area charts (filled or line mode): the point markers on each
		// layer's edge. Unconfigured, a point takes its LINE's color (and
		// the Line's saturation / brightness shading). "Vary by" (resolved
		// off the layer's representative row) / a single color recolor the
		// points on their own. The Color panel renders this one right after
		// the Area fill, so the four parts read line, area fill, point fill,
		// point outline. (The Point outline is NOT a slot: it is the
		// marks' outline — `shape.outlineColor` / the `outlineHue` encoding —
		// exactly as on a scatter or line chart.)
		modes: m("areas-x", "areas-y"),
		isApplicable: areaPointsOn,
		themeColor: (t) => t.connectionColor,
		acceptsFieldMapping: true,
		inherit: {
			label: "Match line",
			help: "Each point takes its line's color.",
		},
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
		label: "Violin / box fill",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
		themeColor: (t) => t.distributionOverlayFill,
		acceptsFieldMapping: true,
		// Unconfigured, it varies by the Color variable (when that's the
		// category-axis variable) in the theme's fill palette — a real
		// "Vary by" default, see `defaultColorSlot` (lib/colorSlotDefaults).
	},
	{
		key: "violinStroke",
		label: "Violin / box outline",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => overlayOn(configs),
		themeColor: (t) => t.distributionOverlayStroke,
		acceptsFieldMapping: true,
		// Unconfigured, it varies by the Color variable in Color's own
		// palette — see `defaultColorSlot`.
	},
	{
		key: "densityCurveFill",
		label: "Density curve fill",
		// Standalone curve renders in scatter (single-variable distribution);
		// the histogram overlay renders in bars-x / bars-y.
		modes: m("scatter", "bars-x", "bars-y"),
		// Only when "Fill under curve" is on — an unfilled curve has no fill to
		// color (the outline slot below stays whenever the curve is shown).
		isApplicable: (_encodings, configs) => densityCurveFillOn(configs),
		themeColor: (t) => t.distributionOverlayFill,
		// "Vary by" a field splits the curve into one KDE per category, each
		// filled with its category color. Unconfigured, it varies by a
		// discrete Color variable in the theme's fill palette — see
		// `defaultColorSlot`.
		acceptsFieldMapping: true,
	},
	{
		key: "densityCurveStroke",
		label: "Density curve outline",
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
		// Unconfigured, each per-group regression line inherits its hue group's
		// color (see RegressionLayer) — same truth-in-labeling as the violin.
		inherit: { label: "Auto" },
	},
	{
		key: "regressionCiFill",
		label: "Confidence interval",
		modes: m("scatter"),
		isApplicable: (_encodings, configs) => regressionCiOn(configs),
		themeColor: (t) => t.regressionCiFill,
		acceptsFieldMapping: true,
		inherit: { label: "Auto" },
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
		key: "polygonFill",
		label: "Polygon fill",
		// Filled radar: the series polygon's BODY, a target of its own beside
		// the points (Point fill), their outlines (Point outline) and the
		// polygon outline (Connection line). Unconfigured, each body fills
		// with its series' point color — the Color mapping, shaded by the
		// Point fill's saturation / brightness — so the panel leads with an
		// explicit "Match point fill" option. "Vary by" / a single color
		// recolor the bodies on their own (resolved off each series'
		// representative row, like the Line slot); the Polygon fill
		// saturation / brightness slots then shade THAT color.
		modes: m("radar"),
		isApplicable: (_encodings, configs, mode) => filledRadarOn(mode, configs),
		themeColor: (t) => t.defaultFill,
		acceptsFieldMapping: true,
		inherit: {
			label: "Match point fill",
			help: "Each polygon fills with its series' point color.",
		},
	},
	{
		key: "comboPointFill",
		label: "Point fill",
		// Bar + marks combo (§3.3): the marks-layer points. Unconfigured, a
		// point takes its LINE's color (the Line slot / legacy connection
		// chain for its Connection value), never the bars' Color mapping —
		// the points belong to the line they sit on. "Vary by" / a single
		// color recolor the points on their own.
		modes: m("combo-x", "combo-y"),
		isApplicable: () => true,
		themeColor: (t) => t.connectionColor,
		acceptsFieldMapping: true,
		inherit: {
			label: "Auto",
			help: "Matches the line color: the Line color's mapping, else its single color.",
		},
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
		case "stem":
		case "comboPointFill":
		case "polygonFill":
		case "areaPointFill":
			// No legacy per-feature color field to seed from; the slot's
			// theme-seeded singleColor is the source of truth.
			return undefined
		case "line":
			return connection?.strokeColor ?? undefined
		case "regressionStroke":
			return configs.x?.regression?.color
		case "regressionCiFill":
			return configs.x?.regression?.ciFillColor
	}
}

const sameValue = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
		return a.every((x, i) => sameValue(x, b[i]))
	}
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
	const ka = Object.keys(a)
	const rb = b as Record<string, unknown>
	return (
		ka.length === Object.keys(b).length &&
		ka.every((k) => sameValue((a as Record<string, unknown>)[k], rb[k]))
	)
}

/** A Line slot that says no more than "vary by the Color variable, on the
 * Color mapping's own palette or gradient": what mapping Color on a line
 * chart seeds (`lib/lineFollowsColor.ts`), so it reads as untouched. A
 * per-value color, a rule, or another palette is an edit. */
export const lineSlotFollowsHue = (
	slot: ColorSlotConfig,
	configs: ChannelConfigs,
	hueField: string | null
): boolean => {
	if (!hueField || slot.field !== hueField) return false
	if ((slot.colorRules?.length ?? 0) > 0) return false
	const hue = slot.hue
	if (hue?.kind === "quantitative")
		return configs.hue?.kind === "quantitative" && sameValue(hue, configs.hue)
	if (hue && Object.keys(hue.colors ?? {}).length > 0) return false
	const palette = slot.palette
	if (!palette) return false
	// With no palette stored, the Color mapping draws the hue scale's
	// built-in palette, which is what a follow-seeded line took.
	return [
		configs.categoricalPalette ?? CATEGORICAL_HUE_PALETTE,
		configs.ordinalPalette,
	].some((p) => !!p && sameValue(p, palette))
}

/** This slot deviates from its untouched state: a field mapped, a palette
 * picked, or its single color moved off the slot's default (the legacy
 * per-feature color, else the theme color). A slot OBJECT merely existing is
 * NOT an edit — the panel writes a well-formed `{field: null, singleColor:
 * default}` on any touch (a reset included), so presence alone must not count.
 * The single source for both the panel's subsection dot and the encoding row's
 * channel dot, so the two can't drift. */
export const colorSlotEdited = (
	key: ColorSlotKey,
	slotCfg: ColorSlotConfig | undefined,
	configs: ChannelConfigs,
	theme: Theme,
	/** The Color (hue) variable, when the caller knows it: a Line slot that
	 *  only follows it (`lineSlotFollowsHue`) is what mapping Color on a line
	 *  chart seeds, not an edit. */
	hueField?: string | null
): boolean => {
	if (!slotCfg) return false
	if (key === "line" && lineSlotFollowsHue(slotCfg, configs, hueField ?? null)) return false
	// An inherit-capable slot's untouched state is "Automatic" (no stored
	// config; renderers follow the Color mapping). There the panel stores a
	// config only on an explicit choice — "Single color" or a field — and
	// picking Automatic deletes it, so presence IS the edit.
	if (COLOR_SLOT_DEFS[key]?.inherit) return true
	if (slotCfg.field != null || slotCfg.paletteId != null) return true
	// A conditional color rule is an edit; an emptied list (every rule
	// removed) is not.
	if ((slotCfg.colorRules?.length ?? 0) > 0) return true
	if (slotCfg.singleColor == null) return false
	// A stray key with no registry entry renders nowhere (nothing to clear), so
	// it never dots.
	const defaultColor =
		legacySlotColor(key, configs) ?? COLOR_SLOT_DEFS[key]?.themeColor(theme)
	return defaultColor != null && slotCfg.singleColor !== defaultColor
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
