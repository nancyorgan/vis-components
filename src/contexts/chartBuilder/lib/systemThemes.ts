import type { SavedTheme, Theme } from "./types"

/** The bundled categorical palette. Sole declaration — `store/atoms.ts`
 *  reaches it through `LIGHT_THEME_BASE` rather than keeping a copy. */
const SET3_COLORS = [
	"#8DD3C7",
	"#FFFFB3",
	"#BEBADA",
	"#FB8072",
	"#80B1D3",
	"#FDB462",
	"#B3DE69",
	"#FCCDE5",
	"#D9D9D9",
	"#BC80BD",
	"#CCEBC5",
	"#FFED6F",
]

/** Sequential ordinal palette — light → dark blues. Stands in as the
 *  default for ORDINAL hue mappings (e.g., a "rating: low/mid/high"
 *  field) where the categorical Set 3 would read as unrelated colors. */
const ORDINAL_BLUES = [
	"#deebf7",
	"#c6dbef",
	"#9ecae1",
	"#6baed6",
	"#4292c6",
	"#2171b5",
]

/** The "Light" system theme — these are the values the editor shipped with
 * before per-user themes existed. Used as the baseline for new accounts
 * and the seed for any user theme that the user creates without copying
 * an existing one.
 *
 * Also the single source of truth for `store/atoms.ts`'s `DEFAULT_THEME`
 * (the baseline `themeAtom` falls back to and the floor `migrateTheme`
 * merges legacy blobs onto) — keep the two in one declaration, never two
 * copies. Treat as immutable: it is spread, never mutated in place. */
export const LIGHT_THEME_BASE: Theme = {
	defaultFill: "#d1d5db",
	defaultRadius: 4,
	defaultOpacity: 0.85,
	defaultShape: 0,
	outlineColor: "#ffffff",
	outlineWidth: 1,
	titleFontFamily: "system-ui, sans-serif",
	titleFontColor: "#111827",
	titlePrimarySize: 20,
	titleSubtitleSize: 14,
	titleSecondarySize: 13,
	textFontFamily: "system-ui, sans-serif",
	textFontSize: 12,
	textFontColor: "#4a5568",
	categoricalPalettes: [{ id: "set3", name: "Set 3", colors: SET3_COLORS }],
	ordinalPalettes: [
		{ id: "blues", name: "Blues (light→dark)", colors: ORDINAL_BLUES },
	],
	linearGradients: [
		{
			id: "default-linear",
			name: "Blue scale",
			low: "#f7fbff",
			high: "#08306b",
		},
	],
	divergingGradients: [
		{
			id: "default-diverging",
			name: "Red–Yellow–Green",
			low: "#d73027",
			mid: "#ffffbf",
			high: "#1a9850",
		},
	],
	defaultCategoricalPaletteId: "set3",
	defaultOrdinalPaletteId: "blues",
	defaultTextPaletteId: null,
	defaultGradientPalette: "viridis",
	patternInkColor: "#0f172a",
	patternBackgroundColor: "#e2e8f0",
	gridlineColor: "#e2e8f0",
	gridlineThickness: 1,
	tickmarkColor: "#94a3b8",
	tickmarkThickness: 1,
	tickmarkLength: 4,
	spineColor: "#94a3b8",
	spineThickness: 1,
	textEncodingFontFamily: "system-ui, sans-serif",
	textEncodingFontSize: 11,
	textEncodingFontWeight: 500,
	textEncodingColor: "#111827",
	dataLabelsFontSize: 11,
	dataLabelsFontWeight: 500,
	dataLabelsItalic: false,
	dataLabelsUnderline: false,
	distributionOverlayStroke: "#475569",
	distributionOverlayFill: "#cbd5e1",
	regressionStroke: "#475569",
	regressionCiFill: "#cbd5e1",
	connectionThickness: 2,
	connectionColor: "#888888",
	lengthMin: 4,
	lengthMax: 40,
	angleMin: -180,
	angleMax: 180,
	areaMin: 3,
	areaMax: 18,
	saturationMin: 0.2,
	saturationMax: 1,
	brightnessMin: 0.25,
	brightnessMax: 0.85,
	chartBackgroundColor: null,
	legendBackgroundColor: "#ffffff",
	legendSwatchColor: "#4f8eda",
	legendSwatchStroke: "#ffffff",
}

/** Dark companion to LIGHT_THEME_BASE — same structure, dark backgrounds
 * + lighter text + muted gridlines. Demonstrates that the multi-theme
 * machinery works for non-trivially different palettes. */
const DARK_THEME_BASE: Theme = {
	...LIGHT_THEME_BASE,
	titleFontColor: "#f8fafc",
	textFontColor: "#cbd5e1",
	patternBackgroundColor: "#1f2937",
	gridlineColor: "#334155",
	tickmarkColor: "#64748b",
	spineColor: "#64748b",
	textEncodingColor: "#f8fafc",
	distributionOverlayStroke: "#94a3b8",
	distributionOverlayFill: "#475569",
	regressionStroke: "#94a3b8",
	regressionCiFill: "#475569",
	chartBackgroundColor: "#0f172a",
	legendBackgroundColor: "#1f2937",
	legendSwatchColor: "#7aa8e8",
}

export const SYSTEM_LIGHT_THEME: SavedTheme = {
	id: "system-light",
	name: "System (Light)",
	isSystem: true,
	...LIGHT_THEME_BASE,
}

export const SYSTEM_DARK_THEME: SavedTheme = {
	id: "system-dark",
	name: "System (Dark)",
	isSystem: true,
	...DARK_THEME_BASE,
}

/** Bundled with the app — these always exist in `themesAtom` and aren't
 * editable by the user. */
export const SYSTEM_THEMES: readonly SavedTheme[] = [
	SYSTEM_LIGHT_THEME,
	SYSTEM_DARK_THEME,
]

/** Strip the SavedTheme metadata so callers that need a plain Theme can
 * use it for `configsFromTheme` etc.
 *
 * Backfills any field the saved theme is missing from `LIGHT_THEME_BASE`.
 * Custom themes created (or imported) before a field existed won't carry
 * it, leaving the value `undefined` — which renders as NaN and makes a
 * bound NumberInput drop to its `min` on the first step instead of
 * starting from the theme's number. Merging the base defaults under the
 * saved values guarantees every field resolves to a real value. */
export const themeOf = (saved: SavedTheme): Theme => {
	const { id: _id, name: _name, isSystem: _isSystem, ...rest } = saved
	return { ...LIGHT_THEME_BASE, ...rest }
}
