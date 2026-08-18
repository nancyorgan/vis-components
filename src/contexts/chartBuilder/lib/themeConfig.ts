import {
	DEFAULT_ANGLE,
	DEFAULT_ANGLE_CONFIG,
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_CHORD_AXIS_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DASH_RANGE,
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_OPACITY_QUANTITATIVE,
	DEFAULT_PATTERN_CONFIG,
	DEFAULT_QUANTITATIVE_HUE_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	DEFAULT_SHAPE_CONFIG,
	DEFAULT_TEXT_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type AngleConfig,
	type AxisConfig,
	type ChannelConfigs,
	type ChordAxisConfig,
	type ConnectionConfig,
	type DataLabelsConfig,
	type HueConfig,
	type OpacityConfig,
	type PatternConfig,
	type ShapeConfig,
	type TextConfig,
} from "./channelConfig"
import {
	DEFAULT_BOX_ANNOTATION_STYLE,
	DEFAULT_LINE_ANNOTATION_STYLE,
	DEFAULT_RECTANGLE_TEXT,
	type BoxAnnotationStyle,
	type LineAnnotationStyle,
	type RectangleTextStyle,
} from "./annotationsConfig"
import { DEFAULT_HEXBIN_BIN_COUNT } from "./hexbins"
import {
	DEFAULT_LABELS_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	type LabelsConfig,
	type LegendConfig,
} from "./labelsConfig"
import type { Theme } from "./types"

/** Resolve the default categorical palette from the theme. Returns the
 * color list and the per-color pattern-ink overrides paired with it
 * (entries are `null` when the user hasn't set a per-color override). */
export const resolveCategoricalPalette = (
	t: Theme
): { colors: string[]; patternInks: Array<string | null> } => {
	const pal =
		t.categoricalPalettes.find((p) => p.id === t.defaultCategoricalPaletteId) ??
		t.categoricalPalettes[0]
	const colors = pal?.colors ?? [
		"#8DD3C7",
		"#FFFFB3",
		"#BEBADA",
		"#FB8072",
		"#80B1D3",
		"#FDB462",
	]
	const inks = pal?.patternInks ?? []
	const patternInks = colors.map((_, i) => inks[i] ?? null)
	return { colors, patternInks }
}

/** Palette offered by TEXT-color palette pickers (per-facet title colors,
 * text-encoded labels): the theme's designated text palette when one is set,
 * else the default categorical palette. Text palettes are typically darker
 * shades of the mark palette that stay legible at text sizes. */
export const resolveTextPickerPalette = (t: Theme): string[] =>
	(t.defaultTextPaletteId
		? t.categoricalPalettes.find((p) => p.id === t.defaultTextPaletteId)?.colors
		: undefined) ?? resolveCategoricalPalette(t).colors

/** Same shape as `resolveCategoricalPalette` but targets the theme's
 *  ordinal-palette list. Falls back to a sequential single-hue ramp so
 *  themes that haven't authored an ordinal palette still render ordinal
 *  hue mappings legibly. */
export const resolveOrdinalPalette = (
	t: Theme
): { colors: string[]; patternInks: Array<string | null> } => {
	const list = t.ordinalPalettes ?? []
	const pal =
		list.find((p) => p.id === t.defaultOrdinalPaletteId) ?? list[0]
	const colors = pal?.colors ?? [
		// Sequential blues — light → dark. Stand-in default so themes
		// without explicit ordinal palettes still read as ordered when a
		// user maps an ordinal field to hue.
		"#deebf7",
		"#c6dbef",
		"#9ecae1",
		"#6baed6",
		"#4292c6",
		"#2171b5",
	]
	const inks = pal?.patternInks ?? []
	const patternInks = colors.map((_, i) => inks[i] ?? null)
	return { colors, patternInks }
}

/** Resolve the default gradient colors from the theme. Returns null for
 * d3 preset palettes (those are handled by the interpolator lookup). */
export const resolveGradientColors = (
	t: Theme
): { low: string; mid?: string; high: string } | null => {
	const lin = t.linearGradients.find((g) => g.id === t.defaultGradientPalette)
	if (lin) return { low: lin.low, high: lin.high }
	const div = t.divergingGradients.find(
		(g) => g.id === t.defaultGradientPalette
	)
	if (div) return { low: div.low, mid: div.mid, high: div.high }
	return null
}

/** Resolve the theme's gridline color/thickness for a specific axis,
 * preferring the per-axis fields when set and falling back to the shared
 * legacy fields. `r` is radar's radial axis (concentric rings). */
export const gridlineThemeFor = (
	t: Theme,
	axis: "x" | "y" | "r"
): { color: string; thickness: number } => {
	const perAxisColor =
		axis === "x"
			? t.xGridlineColor
			: axis === "y"
				? t.yGridlineColor
				: t.rGridlineColor
	const perAxisThickness =
		axis === "x"
			? t.xGridlineThickness
			: axis === "y"
				? t.yGridlineThickness
				: t.rGridlineThickness
	return {
		color: perAxisColor ?? t.gridlineColor,
		thickness: perAxisThickness ?? t.gridlineThickness,
	}
}

/** Build a fresh AxisConfig with theme-driven gridline/tick/spine colors. */
export const axisConfigFromTheme = (
	t: Theme,
	axis: "x" | "y" | "r" = "x"
): AxisConfig => {
	const grid = gridlineThemeFor(t, axis)
	return {
		...DEFAULT_AXIS_CONFIG,
		gridlines: {
			...DEFAULT_AXIS_CONFIG.gridlines,
			color: grid.color,
			thickness: grid.thickness,
		},
		// Radar (r-axis) draws no tickmark glyphs and no spine, so seeding
		// those from the theme would just paint defaults that the UI doesn't
		// expose. Leave tickmarks/spine at AxisConfig defaults for r; r-tick
		// label text inherits Text encoding via `tickLabelColor: undefined`.
		tickmarks:
			axis === "r"
				? DEFAULT_AXIS_CONFIG.tickmarks
				: {
						color: t.tickmarkColor,
						thickness: t.tickmarkThickness,
						length: t.tickmarkLength,
					},
		spine:
			axis === "r"
				? DEFAULT_AXIS_CONFIG.spine
				: { color: t.spineColor, thickness: t.spineThickness },
		distributionOverlay: {
			...DEFAULT_AXIS_CONFIG.distributionOverlay,
			color: t.distributionOverlayStroke,
			fillColor: t.distributionOverlayFill,
		},
		// Only the x axis carries the regression overlay (fits are y-on-x), but
		// seeding it on every axis is harmless — `configValuesEqual` treats an
		// absent saved slice as matching any baseline, and the y/r panels never
		// write it.
		regression: {
			...DEFAULT_REGRESSION_CONFIG,
			color: t.regressionStroke,
			ciFillColor: t.regressionCiFill,
		},
	}
}

/** Theme-seeded `shape` slice. Defined as a single builder so the value the
 * Shape panel writes for untouched fields and the value `configsFromTheme`
 * uses as the "changed?" baseline are produced the SAME way — otherwise the
 * panel (which seeds from `DEFAULT_SHAPE_CONFIG`) and the baseline drift, and
 * the encoding row's "changed" dot lights permanently on the first edit. */
export const shapeConfigFromTheme = (t: Theme): ShapeConfig => ({
	...DEFAULT_SHAPE_CONFIG,
	outlineColor: t.outlineColor,
	outlineWidth: t.outlineWidth,
})

/** Theme-seeded `text` slice — see `shapeConfigFromTheme` for why this is a
 * shared builder rather than an inline literal. */
export const textConfigFromTheme = (t: Theme): TextConfig => ({
	...DEFAULT_TEXT_CONFIG,
	color: t.textEncodingColor,
	palette: t.defaultTextPaletteId
		? (t.categoricalPalettes.find((p) => p.id === t.defaultTextPaletteId)
				?.colors ?? [])
		: [],
	fontFamily: t.textEncodingFontFamily,
	fontSize: t.textEncodingFontSize,
	fontWeight: t.textEncodingFontWeight,
})

/** Theme-seeded Data Labels config — see `shapeConfigFromTheme` for why this
 * is a shared builder. Only the font knobs (size / weight / italic /
 * underline) are theme-driven; the `??` fallbacks cover themes saved before
 * these fields existed, which keep the built-in defaults. */
export const dataLabelsConfigFromTheme = (t: Theme): DataLabelsConfig => ({
	...DEFAULT_DATA_LABELS_CONFIG,
	color: t.dataLabelsColor ?? DEFAULT_DATA_LABELS_CONFIG.color,
	fontFamily: t.dataLabelsFontFamily ?? DEFAULT_DATA_LABELS_CONFIG.fontFamily,
	fontSize: t.dataLabelsFontSize ?? DEFAULT_DATA_LABELS_CONFIG.fontSize,
	fontWeight: t.dataLabelsFontWeight ?? DEFAULT_DATA_LABELS_CONFIG.fontWeight,
	italic: t.dataLabelsItalic ?? false,
	underline: t.dataLabelsUnderline ?? false,
})

/** Theme-seeded fill + border style for NEW rectangle and circle annotations.
 * The `??` fallbacks are the historical seed values, so themes without the
 * annotation fields keep the original look. An unset border color follows the
 * fill color — the built-in seed ties them together (and the border is
 * invisible by default anyway: opacity 0). */
export const boxAnnotationStyleFromTheme = (t: Theme): BoxAnnotationStyle => ({
	backgroundColor:
		t.annotationFillColor ?? DEFAULT_BOX_ANNOTATION_STYLE.backgroundColor,
	backgroundOpacity:
		t.annotationFillOpacity ?? DEFAULT_BOX_ANNOTATION_STYLE.backgroundOpacity,
	borderColor:
		t.annotationBorderColor ??
		t.annotationFillColor ??
		DEFAULT_BOX_ANNOTATION_STYLE.borderColor,
	borderThickness:
		t.annotationBorderThickness ??
		DEFAULT_BOX_ANNOTATION_STYLE.borderThickness,
	borderOpacity:
		t.annotationBorderOpacity ?? DEFAULT_BOX_ANNOTATION_STYLE.borderOpacity,
	borderDash: t.annotationBorderDash ?? DEFAULT_BOX_ANNOTATION_STYLE.borderDash,
	borderDasharray: t.annotationBorderDasharray ?? null,
})

/** Theme-seeded style for NEW rectangle annotations: the shared fill + border
 * plus the rectangle-only text styling. Also the reset baseline the
 * Annotations panel's style controls compare against / restore to. */
export const rectangleStyleFromTheme = (
	t: Theme
): BoxAnnotationStyle & RectangleTextStyle => ({
	...boxAnnotationStyleFromTheme(t),
	textFontFamily:
		t.annotationTextFontFamily ?? DEFAULT_RECTANGLE_TEXT.textFontFamily,
	textFontSize: t.annotationTextFontSize ?? DEFAULT_RECTANGLE_TEXT.textFontSize,
	textColor: t.annotationTextColor ?? DEFAULT_RECTANGLE_TEXT.textColor,
	textFontWeight:
		t.annotationTextFontWeight ?? DEFAULT_RECTANGLE_TEXT.textFontWeight,
	textAlign: t.annotationTextAlign ?? DEFAULT_RECTANGLE_TEXT.textAlign,
	textPadding: t.annotationTextPadding ?? DEFAULT_RECTANGLE_TEXT.textPadding,
})

/** Theme-seeded stroke style for NEW line-segment annotations. */
export const lineAnnotationStyleFromTheme = (t: Theme): LineAnnotationStyle => ({
	lineColor: t.annotationLineColor ?? DEFAULT_LINE_ANNOTATION_STYLE.lineColor,
	lineThickness:
		t.annotationLineThickness ?? DEFAULT_LINE_ANNOTATION_STYLE.lineThickness,
	lineOpacity:
		t.annotationLineOpacity ?? DEFAULT_LINE_ANNOTATION_STYLE.lineOpacity,
	lineDash: t.annotationLineDash ?? DEFAULT_LINE_ANNOTATION_STYLE.lineDash,
	lineDasharray: t.annotationLineDasharray ?? null,
})

/** Theme-seeded `connection` slice — see `shapeConfigFromTheme` for why this
 * is a shared builder. `fill` is the built-in default `"line"` (the "Fill
 * polygon" checkbox UNCHECKED): area charts set `fill: "area"` explicitly (via
 * quickStart / the area toggle), and the dot treats `"area"` as a real
 * deviation — so the baseline must be `"line"` or it would dot itself. */
export const connectionConfigFromTheme = (t: Theme): ConnectionConfig => ({
	...DEFAULT_CONNECTION_CONFIG,
	thickness: t.connectionThickness,
})

/** Theme-seeded chord ring-axis defaults: tick marks and spine take the same
 * theme fields the x / y axes seed from (see `axisConfigFromTheme`). Shared
 * by the Connection panel and ChordPlot so the drawn axis and the panel's
 * displayed values can't drift; also the dot baseline for the axis's
 * Tickmark / Spine controls. */
export const chordAxisConfigFromTheme = (t: Theme): ChordAxisConfig => ({
	...DEFAULT_CHORD_AXIS_CONFIG,
	tickmarks: {
		color: t.tickmarkColor,
		thickness: t.tickmarkThickness,
		length: t.tickmarkLength,
	},
	spine: { color: t.spineColor, thickness: t.spineThickness },
})

/** Theme-seeded `pattern` slice — see `shapeConfigFromTheme` for why this is a
 * shared builder. Only `backgroundColor` is theme-driven. */
export const patternConfigFromTheme = (t: Theme): PatternConfig => ({
	...DEFAULT_PATTERN_CONFIG,
	backgroundColor: t.patternBackgroundColor,
})

/** Theme-seeded `angle` slice — see `shapeConfigFromTheme` for why this is a
 * shared builder. MUST spread the full `DEFAULT_ANGLE_CONFIG` (which carries
 * radar-axis fields: `tickCount`, `tickLabelAngle`, `spine`, `donutHoleRadius`)
 * so the baseline matches what the Angle panel writes — otherwise those extra
 * keys (absent in the baseline) read as a change and the dot can't be cleared. */
export const angleConfigFromTheme = (t: Theme): AngleConfig => ({
	...DEFAULT_ANGLE_CONFIG,
	minAngle: t.angleMin,
	maxAngle: t.angleMax,
})

/** Build initial channelConfigs from the user's theme so new visualizations
 * inherit their preferred defaults. */
export const configsFromTheme = (t: Theme): ChannelConfigs => ({
	...EMPTY_CHANNEL_CONFIGS,
	defaultFill: t.defaultFill,
	defaultRadius: t.defaultRadius,
	defaultOpacity: t.defaultOpacity,
	defaultShape: t.defaultShape,
	// `defaultAngle`'s default is 0 (a real value, not "empty"), so the baseline
	// MUST carry it — otherwise setting the angle to its own default (0) reads as
	// `0 ≠ undefined` and the dot can't be cleared. (The other unset default
	// scalars — saturation/brightness/pattern/length — default to null, which
	// the empty-normalization already treats as "unset".)
	defaultAngle: DEFAULT_ANGLE,
	shape: shapeConfigFromTheme(t),
	pattern: patternConfigFromTheme(t),
	categoricalPaletteId: t.defaultCategoricalPaletteId,
	categoricalPalette: resolveCategoricalPalette(t).colors,
	categoricalPalettePatternInks: resolveCategoricalPalette(t).patternInks,
	ordinalPaletteId: t.defaultOrdinalPaletteId,
	ordinalPalette: resolveOrdinalPalette(t).colors,
	ordinalPalettePatternInks: resolveOrdinalPalette(t).patternInks,
	defaultGradientId: t.defaultGradientPalette,
	defaultGradientColors: resolveGradientColors(t),
	patternInkColor: t.patternInkColor,
	defaultPatternInk: t.patternInkColor,
	text: textConfigFromTheme(t),
	length: { minLength: t.lengthMin, maxLength: t.lengthMax },
	angle: angleConfigFromTheme(t),
	area: { minRadius: t.areaMin, maxRadius: t.areaMax },
	saturation: { min: t.saturationMin, max: t.saturationMax },
	brightness: { min: t.brightnessMin, max: t.brightnessMax },
	connection: connectionConfigFromTheme(t),
	backgroundColor: t.chartBackgroundColor,
	x: axisConfigFromTheme(t, "x"),
	y: axisConfigFromTheme(t, "y"),
	r: axisConfigFromTheme(t, "r"),
})

/** Build initial legendConfig from the user's theme. */
export const legendConfigFromTheme = (t: Theme): LegendConfig => ({
	...DEFAULT_LEGEND_CONFIG,
	backgroundColor: t.legendBackgroundColor,
})

/** A config slice is "empty" — and therefore not a customization — when it is
 * absent, null, or an object/array with no entries. Treating `{}` / `[]` the
 * same as absent keeps sparse slices (e.g. `colorSlots`, per-category override
 * maps) from reading as changed before the user has actually put anything in
 * them. */
const isEmptyConfigValue = (v: unknown): boolean => {
	if (v === undefined || v === null) return true
	// A missing optional boolean/string field defaults to `false` / `""`, so a
	// saved config that predates the field (value `undefined`) must read as
	// equal to a baseline that carries the explicit default. Treating `false`
	// and `""` as "unset" makes that comparison hold. Toggling a value to a
	// NON-default (e.g. `true`, or a non-empty string) is still detected,
	// because the other side is then non-empty. `0` is intentionally NOT empty
	// — it's a meaningful numeric value (e.g. tickLabelAngle, gapX).
	if (v === false || v === "") return true
	if (Array.isArray(v)) return v.length === 0
	if (typeof v === "object") return Object.keys(v as object).length === 0
	return false
}

/** Deep equality that treats absent / null / `{}` / `[]` as the SAME "empty"
 * value. Critical for comparing a saved config against a freshly-built theme
 * baseline: config shapes gain optional fields over time, so an older visual's
 * slice (e.g. a 3-key `shape` config) must still read as equal to the current
 * baseline (which carries newer empty fields like `fillOverrides: {}`). A plain
 * `JSON.stringify` compare reports those structural-only differences as a
 * change and lights a phantom dot the user can't clear (worse when the panel is
 * disabled in the current chart mode). Order-insensitive for objects. */
const configValuesEqual = (a: unknown, b: unknown): boolean => {
	// `a` is the SAVED value, `b` the theme default. An absent saved field
	// (`undefined`) means "fall back to the default" at render time, so it is
	// never a customization — it equals whatever the default is, regardless of
	// the default's value (`"all"`, `5`, `"none"`, …). This is the general form
	// of the empty-normalization below and the single rule that closes the
	// whole "older save is missing a field the baseline now specifies" class.
	if (a === undefined) return true
	if (isEmptyConfigValue(a) && isEmptyConfigValue(b)) return true
	if (a === b) return true
	const aArr = Array.isArray(a)
	const bArr = Array.isArray(b)
	if (aArr || bArr) {
		if (!aArr || !bArr || a.length !== b.length) return false
		return a.every((x, i) => configValuesEqual(x, b[i]))
	}
	if (typeof a === "object" && typeof b === "object" && a && b) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)])
		for (const k of keys) {
			if (
				!configValuesEqual(
					(a as Record<string, unknown>)[k],
					(b as Record<string, unknown>)[k]
				)
			) {
				return false
			}
		}
		return true
	}
	return false
}

// ── The encoding-row "changed" dot ─────────────────────────────────────────
//
// MODEL: a dot means "a control in this dropdown is set to something other than
// its DEFAULT" — where default = the value the control shows untouched (the
// theme value for theme-driven controls; a built-in constant for controls the
// theme doesn't model, e.g. stacked-vs-overlay, line-vs-area, tick format).
//
// Each menu DECLARES the controls it owns below, each as { label, changed },
// where `changed` compares the live value to that control's default using the
// SAME default source the panel itself uses (the *FromTheme builders /
// DEFAULT_* constants). This is the single source of truth — the dot can't drift
// from the panels, there's no shared blob to mis-attribute, and a field a menu
// doesn't list simply can't affect its dot. To make the dot track a new control,
// add it here and nowhere else.

type DotControl = { label: string; changed: boolean }
type DotCtx = {
	configs: ChannelConfigs
	theme: Theme
	/** Whether a data field is mapped to THIS channel (some controls only count
	 *  as a deviation when the encoding is active — e.g. a palette colors nothing
	 *  without a hue field). */
	fieldMapped: boolean
}

/** A live value differs from its default. An absent/empty live value falls back
 *  to the default at render time, so it's never a deviation (see
 *  `configValuesEqual`). Exported as `valueChanged` for the panels' subsection /
 *  per-line dots, so those compare the SAME way the top-level dot does. */
const differs = (current: unknown, dflt: unknown): boolean =>
	!configValuesEqual(current, dflt)

export const valueChanged = differs

/** Resolve a palette id to the palette it actually renders as (the named
 *  palette, else the first one — mirrors `resolveCategoricalPalette`). Comparing
 *  RESOLVED identities makes the dot immune to theme migrations that rename a
 *  palette id while keeping the same palette. */
const resolvePaletteId = (
	id: string | undefined,
	palettes: ReadonlyArray<{ id: string }> | undefined
): string | undefined => {
	if (!palettes?.length) return id
	return id && palettes.some((p) => p.id === id) ? id : palettes[0]?.id
}

/** The user picked a palette other than the theme's default (by resolved
 *  identity). */
const palettePicked = (
	storedId: string | undefined,
	defaultId: string | undefined,
	palettes: ReadonlyArray<{ id: string }> | undefined
): boolean =>
	storedId != null &&
	resolvePaletteId(storedId, palettes) !== resolvePaletteId(defaultId, palettes)

/** Per-value color overrides / hand-built gradient / non-default stack mode on a
 *  hue (or outline-hue) scale object. The auto-seeded default scale that field
 *  mapping creates has none of these, so mapping a field never dots. Resolved
 *  stop colors are intentionally ignored (they re-derive from the theme). */
const hueScaleEdited = (hue: HueConfig | undefined): boolean => {
	if (!hue) return false
	if (hue.kind === "categorical") {
		return (
			Object.keys(hue.colors ?? {}).length > 0 ||
			hue.stackMode !== DEFAULT_CATEGORICAL_HUE_CONFIG.stackMode
		)
	}
	return (
		hue.palette === "custom" ||
		(hue.customStops?.length ?? 0) > 0 ||
		(hue.interpolation != null && hue.interpolation !== "rgb") ||
		hue.stackMode !== DEFAULT_QUANTITATIVE_HUE_CONFIG.stackMode
	)
}

/** A non-default opacity scale (range or per-category overrides). The default
 *  scale a field mapping seeds has neither. */
const opacityScaleEdited = (opacity: OpacityConfig | undefined): boolean => {
	if (!opacity) return false
	if (opacity.kind === "quantitative") {
		return (
			opacity.min !== DEFAULT_OPACITY_QUANTITATIVE.min ||
			opacity.max !== DEFAULT_OPACITY_QUANTITATIVE.max
		)
	}
	return Object.keys(opacity.overrides ?? {}).length > 0
}

/** The Color menu's "Outline" subheader for AREA / RADAR charts writes the
 *  outline into the `connection` config (it's the only place that does), so
 *  those edits belong to the Color (hue) dot. Default: null `strokeColor`
 *  ("match fill"), no per-layer overrides, no outline palette. */
const areaOutlineColorEdited = (conn: ChannelConfigs["connection"]): boolean => {
	if (!conn) return false
	return (
		conn.strokeColor != null ||
		Object.keys(conn.lineColors ?? {}).length > 0 ||
		conn.linePaletteId != null
	)
}

/** The controls each menu owns, with each control's default folded into
 *  `changed`. THE source of truth for the dot — see the header comment. */
const CHANNEL_DOT_CONTROLS: Record<string, (ctx: DotCtx) => DotControl[]> = {
	x: ({ configs, theme }) => [
		{ label: "axis", changed: differs(configs.x, axisConfigFromTheme(theme, "x")) },
	],
	y: ({ configs, theme }) => [
		{ label: "axis", changed: differs(configs.y, axisConfigFromTheme(theme, "y")) },
	],
	r: ({ configs, theme }) => [
		{ label: "axis", changed: differs(configs.r, axisConfigFromTheme(theme, "r")) },
	],
	hue: ({ configs, theme, fieldMapped }) => [
		{ label: "default fill", changed: differs(configs.defaultFill, theme.defaultFill) },
		{ label: "color slots", changed: !isEmptyConfigValue(configs.colorSlots) },
		{ label: "fill scale edits", changed: hueScaleEdited(configs.hue) },
		// Hexbin bin count (the Color panel's "Bins" input). Themes carry no
		// hexbin default, so changed = explicitly set to a non-default value;
		// fresh charts have no `hexbin` config → no dot.
		{
			label: "hexbin bins",
			changed:
				configs.hexbin?.binCount != null &&
				configs.hexbin.binCount !== DEFAULT_HEXBIN_BIN_COUNT,
		},
		{
			label: "palette pick",
			changed:
				fieldMapped &&
				(palettePicked(
					configs.categoricalPaletteId,
					theme.defaultCategoricalPaletteId,
					theme.categoricalPalettes
				) ||
					palettePicked(
						configs.ordinalPaletteId,
						theme.defaultOrdinalPaletteId,
						theme.ordinalPalettes
					)),
		},
		// The Color menu styles the area/radar outline via the connection config.
		{ label: "outline color", changed: areaOutlineColorEdited(configs.connection) },
	],
	outlineHue: ({ configs, theme, fieldMapped }) => [
		{ label: "outline scale edits", changed: hueScaleEdited(configs.outlineHue) },
		{
			label: "outline palette pick",
			changed:
				fieldMapped &&
				(palettePicked(
					configs.outlineCategoricalPaletteId,
					theme.defaultCategoricalPaletteId,
					theme.categoricalPalettes
				) ||
					palettePicked(
						configs.outlineOrdinalPaletteId,
						theme.defaultOrdinalPaletteId,
						theme.ordinalPalettes
					)),
		},
	],
	opacity: ({ configs, theme }) => [
		{ label: "default opacity", changed: differs(configs.defaultOpacity, theme.defaultOpacity) },
		{ label: "opacity slots", changed: !isEmptyConfigValue(configs.opacitySlots) },
		{ label: "opacity scale", changed: opacityScaleEdited(configs.opacity) },
		{ label: "opacity stacking", changed: (configs.opacity?.stackMode ?? "stack") !== "stack" },
	],
	shape: ({ configs, theme }) => [
		{ label: "shape config", changed: differs(configs.shape, shapeConfigFromTheme(theme)) },
		{ label: "default shape", changed: differs(configs.defaultShape, theme.defaultShape) },
	],
	pattern: ({ configs, theme }) => [
		{ label: "pattern config", changed: differs(configs.pattern, patternConfigFromTheme(theme)) },
		{ label: "default pattern", changed: differs(configs.defaultPattern, null) },
		{ label: "default pattern ink", changed: differs(configs.defaultPatternInk, theme.patternInkColor) },
		{ label: "pattern ink color", changed: differs(configs.patternInkColor, theme.patternInkColor) },
		// Line-dash state the Pattern menu writes onto the CONNECTION config
		// (the line renderers' source): the no-field default dash, the
		// "Fill dash gaps" choice, and the "Apply pattern to range" window.
		{
			label: "default line dash",
			changed:
				(configs.connection?.defaultDashPattern ?? "solid") !== "solid" ||
				(configs.connection?.customDashPattern ?? null) !== null,
		},
		{
			label: "dash gap fill",
			changed: (configs.connection?.dashGapFill ?? null) !== null,
		},
		{
			label: "dash gap colors",
			changed:
				!isEmptyConfigValue(configs.connection?.dashAlternateColors) ||
				(configs.connection?.dashGapColor ?? null) !== null,
		},
		{
			label: "dash range",
			changed: differs(
				{ ...DEFAULT_DASH_RANGE, ...configs.connection?.dashRange },
				DEFAULT_DASH_RANGE
			),
		},
	],
	// Area / saturation / brightness panels show DIFFERENT controls depending on
	// whether a field is mapped (min/max range + stacking vs a single default),
	// so each dot is gated to the state where its control is actually visible —
	// a deviation the current panel can't clear must not light the dot.
	area: ({ configs, theme, fieldMapped }) => [
		{
			label: "size range",
			changed:
				fieldMapped &&
				differs(configs.area, { minRadius: theme.areaMin, maxRadius: theme.areaMax }),
		},
		{
			label: "default radius",
			changed: !fieldMapped && differs(configs.defaultRadius, theme.defaultRadius),
		},
	],
	length: ({ configs, theme }) => [
		{
			label: "length range",
			// barGapPx is excluded — it has its own entry below, so a set gap
			// doesn't masquerade as a range edit in the changed-dot diagnostics.
			changed: differs(
				configs.length && {
					minLength: configs.length.minLength,
					maxLength: configs.length.maxLength,
				},
				{ minLength: theme.lengthMin, maxLength: theme.lengthMax }
			),
		},
		{ label: "bar gap", changed: (configs.length?.barGapPx ?? null) !== null },
		{ label: "default length", changed: differs(configs.defaultLength, null) },
	],
	angle: ({ configs, theme }) => [
		{ label: "angle config", changed: differs(configs.angle, angleConfigFromTheme(theme)) },
		{ label: "default angle", changed: differs(configs.defaultAngle, DEFAULT_ANGLE) },
	],
	saturation: ({ configs, theme, fieldMapped }) => [
		{
			label: "saturation range",
			changed:
				fieldMapped &&
				differs(
					configs.saturation && { min: configs.saturation.min, max: configs.saturation.max },
					{ min: theme.saturationMin, max: theme.saturationMax },
				),
		},
		{
			label: "saturation per-category",
			changed:
				fieldMapped &&
				Object.keys(configs.saturation?.overrides ?? {}).length > 0,
		},
		{
			label: "saturation stacking",
			changed: fieldMapped && (configs.saturation?.stackMode ?? "stack") !== "stack",
		},
		{
			label: "default saturation",
			changed: !fieldMapped && differs(configs.defaultSaturation, null),
		},
	],
	brightness: ({ configs, theme, fieldMapped }) => [
		{
			label: "brightness range",
			changed:
				fieldMapped &&
				differs(
					configs.brightness && { min: configs.brightness.min, max: configs.brightness.max },
					{ min: theme.brightnessMin, max: theme.brightnessMax },
				),
		},
		{
			label: "brightness per-category",
			changed:
				fieldMapped &&
				Object.keys(configs.brightness?.overrides ?? {}).length > 0,
		},
		{
			label: "brightness stacking",
			changed: fieldMapped && (configs.brightness?.stackMode ?? "stack") !== "stack",
		},
		{
			label: "default brightness",
			changed: !fieldMapped && differs(configs.defaultBrightness, null),
		},
	],
	connection: ({ configs, theme, fieldMapped }) => {
		const c = configs.connection
		return [
			// "Fill polygon" and point-sampling controls only APPEAR in the panel
			// when a connection field is mapped (the Polygon / sampling sections are
			// gated on it). Without one, `fill: "area"` is the chart TYPE, not a
			// dropdown edit the user can clear here → don't dot. With a connection
			// field, checking Fill-polygon ("line"→"area") is a real change.
			{
				label: "fill polygon",
				changed:
					fieldMapped &&
					(c?.fill ?? DEFAULT_CONNECTION_CONFIG.fill) !== DEFAULT_CONNECTION_CONFIG.fill,
			},
			{ label: "line thickness", changed: differs(c?.thickness, theme.connectionThickness) },
			{ label: "line cap", changed: (c?.lineCap ?? "round") !== "round" },
			{
				label: "point sampling",
				changed: fieldMapped && (c?.pointSampling ?? "all") !== "all",
			},
			// Lollipop "connect to axis" is a scatter control, available without a
			// connection field, so it isn't gated.
			{ label: "axis stem", changed: (c?.axisStem ?? "none") !== "none" },
			// Packed-circles nesting: picking an ID column is a real edit (the
			// theme default is null = one grouping level). Gated on a mapped
			// connection field because the control only appears with one.
			{
				label: "hierarchy id column",
				changed: fieldMapped && !!c?.hierarchyIdField,
			},
			// Flow target column: picking one is a real edit (the default is
			// null = auto-detect). Gated on a mapped connection like the id
			// column — the control only appears with one. Known wrinkle: a
			// stored target EQUAL to the connection field (swap, then remap
			// connection in the shelf) resolves as Auto and the panel shows
			// Auto, but still dots here — this context has no field NAME to
			// compare against. Rare, self-heals on the next explicit pick.
			{
				label: "flow target column",
				changed: fieldMapped && !!c?.flowTargetField,
			},
			// Hierarchy layout: switching off packed circles (the default) is
			// a real edit. Not gated on a mapped connection — the layout
			// applies to the flat (area-only) signature too.
			{
				label: "hierarchy layout",
				changed: (c?.hierarchyLayout ?? "pack") !== "pack",
			},
			// Chord axis: showing it is a real edit, and so is any Ticks /
			// Tick Labels / Spine customization left behind while it's
			// toggled off (the panel keeps those so re-enabling restores
			// them — they still count as customization). Tickmarks / spine
			// compare against the THEME baseline: the panel seeds untouched
			// fields from `chordAxisConfigFromTheme`, so their mere presence
			// isn't a deviation.
			{
				label: "chord axis",
				changed: (() => {
					const ax = c?.chordAxis
					if (!ax) return false
					const themeAx = chordAxisConfigFromTheme(theme)
					return (
						ax.enabled ||
						ax.tickCount !== DEFAULT_CHORD_AXIS_CONFIG.tickCount ||
						ax.customFormat !== "" ||
						ax.labelEvery !== DEFAULT_CHORD_AXIS_CONFIG.labelEvery ||
						(ax.tickmarks !== undefined &&
							differs(ax.tickmarks, themeAx.tickmarks)) ||
						!!ax.tickLabelFont ||
						(ax.spine !== undefined && differs(ax.spine, themeAx.spine))
					)
				})(),
			},
		]
	},
	text: ({ configs, theme }) => [
		{ label: "text config", changed: differs(configs.text, textConfigFromTheme(theme)) },
	],
	// facet / facetRow / facetCol: faceting is an ENCODING, not a styling menu —
	// intentionally no entry, so those rows never dot.
}

/** Returns true when any control in the channel's dropdown is set to a
 *  non-default value (its "changed" dot). See `CHANNEL_DOT_CONTROLS`. */
export const channelHasCustomization = (
	channel: string,
	configs: ChannelConfigs,
	theme: Theme,
	fieldMapped = false
): boolean => {
	const spec = CHANNEL_DOT_CONTROLS[channel]
	return spec ? spec({ configs, theme, fieldMapped }).some((c) => c.changed) : false
}

/** DEV diagnostic: the labels of the controls that are non-default for this
 *  channel — exactly what's lighting the dot. Not used in production. */
export const explainChannelCustomization = (
	channel: string,
	configs: ChannelConfigs,
	theme: Theme,
	fieldMapped = false
): string[] => {
	const spec = CHANNEL_DOT_CONTROLS[channel]
	if (!spec) return []
	return spec({ configs, theme, fieldMapped })
		.filter((c) => c.changed)
		.map((c) => c.label)
}

// ── The Legend section "changed" dot ───────────────────────────────────────
//
// Same model as the encoding-row dot above, applied to the Legend sidebar
// section: a group's dot lights when a legend setting it owns differs from the
// theme baseline (`legendConfigFromTheme`, the exact config a fresh chart is
// seeded with — see `saveVisual`). Grouped so each `CollapsibleSubsection` in
// LegendPanel maps to one group, and the section header dots when ANY group
// does. Compared with the SAME `differs`/empty-normalizing logic the encoding
// dots use, so a fresh chart shows no dots. Add a new control here and nowhere
// else to make the dot track it.

/** One legend subsection's worth of controls. Each value maps to a
 *  `CollapsibleSubsection` in LegendPanel. */
export type LegendDotGroup =
	| "shown"
	| "properties"
	| "formatting"
	| "gradient"
	| "auxSwatch"
	| "swatchShape"
	| "shapeSwatch"

/** Which legend subsections deviate from the theme baseline. */
export const explainLegendCustomization = (
	cfg: LegendConfig,
	theme: Theme
): Set<LegendDotGroup> => {
	const base = legendConfigFromTheme(theme)
	// Inside-legend coords only count once the legend is actually positioned
	// inside — a stale coord left over from a previous position isn't a visible
	// deviation anywhere else.
	const isInside = (cfg.position ?? base.position) === "inside"
	const controls: Array<{ group: LegendDotGroup; changed: boolean }> = [
		{ group: "shown", changed: differs(cfg.enabled, base.enabled) },
		{ group: "shown", changed: !isEmptyConfigValue(cfg.hidden) },
		{ group: "properties", changed: differs(cfg.position, base.position) },
		{ group: "properties", changed: differs(cfg.orientation, base.orientation) },
		{ group: "properties", changed: isInside && differs(cfg.insideX, base.insideX) },
		{ group: "properties", changed: isInside && differs(cfg.insideY, base.insideY) },
		{ group: "properties", changed: differs(cfg.showBorder, base.showBorder) },
		{ group: "properties", changed: differs(cfg.borderColor, base.borderColor) },
		{ group: "properties", changed: differs(cfg.borderRadius, base.borderRadius) },
		{
			group: "properties",
			changed: differs(cfg.backgroundColor, base.backgroundColor),
		},
		{ group: "properties", changed: differs(cfg.columns, base.columns) },
		{ group: "properties", changed: differs(cfg.columnGap, base.columnGap) },
		{
			group: "gradient",
			changed: differs(cfg.gradientLegendStyle, base.gradientLegendStyle),
		},
		{
			group: "gradient",
			changed: differs(cfg.gradientBarLength, base.gradientBarLength),
		},
		{
			group: "gradient",
			changed: differs(cfg.gradientBarRadius, base.gradientBarRadius),
		},
		{
			group: "gradient",
			changed: differs(cfg.gradientBarTickLength, base.gradientBarTickLength),
		},
		{
			group: "gradient",
			changed: differs(cfg.gradientBarTickThickness, base.gradientBarTickThickness),
		},
		{
			group: "gradient",
			changed: differs(cfg.gradientBarTickColor, base.gradientBarTickColor),
		},
		{ group: "formatting", changed: !isEmptyConfigValue(cfg.channels) },
		{
			group: "formatting",
			changed: differs(cfg.gradientBarLabelAlign, base.gradientBarLabelAlign),
		},
		{
			group: "auxSwatch",
			changed: differs(cfg.auxLegendSwatchColor, base.auxLegendSwatchColor),
		},
		{
			group: "auxSwatch",
			changed: differs(cfg.auxLegendSwatchStroke, base.auxLegendSwatchStroke),
		},
		// The aux swatch color is also editable from the Swatches section
		// (opacity / saturation / brightness groups host a picker for it),
		// so it lights that section's dot as well.
		{
			group: "swatchShape",
			changed: differs(cfg.auxLegendSwatchColor, base.auxLegendSwatchColor),
		},
		{
			group: "swatchShape",
			changed: differs(cfg.hueLegendSwatchShape, base.hueLegendSwatchShape),
		},
		{
			group: "swatchShape",
			changed: differs(cfg.hueLegendSwatchSize, base.hueLegendSwatchSize),
		},
		{ group: "swatchShape", changed: !isEmptyConfigValue(cfg.swatchShapes) },
		{ group: "swatchShape", changed: !isEmptyConfigValue(cfg.swatchSizes) },
		{
			group: "swatchShape",
			changed: differs(cfg.swatchOutlineColor, base.swatchOutlineColor),
		},
		{
			group: "swatchShape",
			changed: differs(cfg.swatchOutlineWidth, base.swatchOutlineWidth),
		},
		{
			group: "swatchShape",
			changed: !isEmptyConfigValue(cfg.swatchOutlineColors),
		},
		{
			group: "swatchShape",
			changed: !isEmptyConfigValue(cfg.swatchOutlineWidths),
		},
		{
			group: "swatchShape",
			changed: differs(cfg.patternLegendBgColor, base.patternLegendBgColor),
		},
		{
			group: "swatchShape",
			changed: differs(cfg.patternLegendInkColor, base.patternLegendInkColor),
		},
		{
			group: "shapeSwatch",
			changed: differs(cfg.shapeLegendFillColor, base.shapeLegendFillColor),
		},
		{
			group: "shapeSwatch",
			changed: differs(cfg.shapeLegendStrokeColor, base.shapeLegendStrokeColor),
		},
	]
	const out = new Set<LegendDotGroup>()
	for (const c of controls) if (c.changed) out.add(c.group)
	return out
}

/** Any legend deviation → the sidebar "Legend" section header shows a dot. */
export const legendHasCustomization = (
	cfg: LegendConfig,
	theme: Theme
): boolean => explainLegendCustomization(cfg, theme).size > 0

/** Build initial labelsConfig from the user's theme. */
export const labelsFromTheme = (t: Theme): LabelsConfig => ({
	...DEFAULT_LABELS_CONFIG,
	baseFont: {
		titles: {
			family: t.titleFontFamily,
			primarySize: t.titlePrimarySize,
			subtitleSize: t.titleSubtitleSize,
			secondarySize: t.titleSecondarySize,
			color: t.titleFontColor,
			// The numeric weight wins when set; older themes only carry the
			// boolean bold flag, which maps onto the numeric weight model
			// (bold → 700, otherwise inherit the slot default).
			weight: t.titleFontWeight ?? (t.titleFontBold ? 700 : undefined),
			// Per-slot weights / families refine individual title tiers; unset
			// falls back to the shared values at resolve time (resolveTitleFont).
			subtitleWeight: t.subtitleFontWeight,
			secondaryWeight: t.axisTitleFontWeight,
			legendWeight: t.legendTitleFontWeight,
			subtitleFamily: t.subtitleFontFamily,
			legendFamily: t.legendTitleFontFamily,
			// Base alignments for title / subtitle / legend titles — the layer
			// under per-visual titleAlignments (titleAlignmentOf).
			primaryAlignment: t.titleAlignment,
			subtitleAlignment: t.subtitleAlignment,
			legendAlignment: t.legendTitleAlignment,
			italic: t.titleFontItalic ?? false,
			underline: t.titleFontUnderline ?? false,
		},
		text: {
			family: t.textFontFamily,
			size: t.textFontSize,
			color: t.textFontColor,
			weight: t.textFontWeight ?? (t.textFontBold ? 700 : undefined),
			italic: t.textFontItalic ?? false,
			underline: t.textFontUnderline ?? false,
			// Legend entry-label overrides; unset falls back to the shared
			// fields above at resolve time (resolveLegendTextFont).
			legendFamily: t.legendTextFontFamily,
			legendSize: t.legendTextFontSize,
			legendWeight: t.legendTextFontWeight,
			legendColor: t.legendTextColor,
		},
	},
})
