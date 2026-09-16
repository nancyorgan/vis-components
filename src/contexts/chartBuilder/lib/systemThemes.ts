import type {
	SavedCategoricalPalette,
	SavedTheme,
	SavedThemeMeta,
	Theme,
} from "./types"

// ---------------------------------------------------------------------------
// Bundled palettes. Lifted from Nancy's hand-built "Test Theme" pair
// (2026-09-15). Palette ids are kept VERBATIM from those themes — a visual
// picks palettes by id, so visuals built on the originals keep their picks
// when switched to the system themes.
// ---------------------------------------------------------------------------

/** Pattern inks shared by the light and dark categorical palettes. */
const CATEGORICAL_INKS = [
	"#f2c5cf",
	"#fbe7bc",
	"#c6fbee",
	"#80dfff",
	"#fbb67e",
	"#5cb0cc",
	"#dcdbdb",
	"#fafafa",
]

/** Deep, saturated shades — the light theme's text palette. */
const DEEP_COLORS = ["#BD002C", "#C28800", "#009970", "#118AB2", "#DB8000"]
const DEEP_INKS = ["#ff8fab", "#fbdc98", "#74ecce", "#8bddf9", "#ffc085"]

/** Pale tints — the light theme's background-fill palette. */
const TINT_COLORS = ["#FFCCD8", "#FFF1D1", "#D1FFF3", "#D6F5FF", "#FFE6D1"]
const TINT_INKS = ["#fdecf1", "#f9dea4", "#e5fff9", "#ecf9fd", "#f8efe7"]

/** Mid tints — the area-fill palette. */
const AREA_COLORS = ["#FFA3B9", "#FFE5A8", "#AAEEDC", "#96D8EE", "#FFC18F"]
const AREA_INKS = ["#fde8ed", "#fff7e5", "#d3f8ef", "#ccf2ff", "#fde5c9"]

const LIGHT_CATEGORICAL_PALETTES: SavedCategoricalPalette[] = [
	{
		id: "migrated",
		name: "Categorical palette",
		colors: [
			"#EF476F",
			"#FFD166",
			"#0AD6A0",
			"#118AB2",
			"#EE7D20",
			"#083B4D",
			"#B0B0B0",
			"#D1D1D1",
		],
		patternInks: CATEGORICAL_INKS,
	},
	{
		id: "cat-mohtmuv1-dcxj",
		name: "Text Palette",
		colors: [...DEEP_COLORS, "#0A3B4D", "#888888"],
		patternInks: [...DEEP_INKS, "#92c3d3", "#d6d6d6"],
	},
	{
		id: "cat-mpd3z8av-n270",
		name: "Area Fill Palette",
		colors: [...AREA_COLORS, "#92B7C3"],
		patternInks: [...AREA_INKS, "#d4ebf2"],
	},
	{
		id: "cat-mqphdwv2-255y",
		name: "Background Fill Palette",
		colors: [...TINT_COLORS, "#efefef"],
		patternInks: [...TINT_INKS, "#dedede"],
	},
]

/** Dark-theme swatches: cream (`#FEFFF0`) and its pattern ink replace the
 *  navy sixth swatch in every palette, and the pale tints are the text
 *  palette. Same ids as the light list, so palette picks survive a
 *  light↔dark switch. */
const CREAM = "#FEFFF0"
const CREAM_INK = "#eaecc5"

const DARK_CATEGORICAL_PALETTES: SavedCategoricalPalette[] = [
	{
		id: "migrated",
		name: "Categorical palette",
		colors: [
			"#EF476F",
			"#FFD166",
			"#0AD6A0",
			"#118AB2",
			"#EE7D20",
			CREAM,
			"#B0B0B0",
			"#D1D1D1",
		],
		patternInks: CATEGORICAL_INKS.map((ink, i) => (i === 5 ? CREAM_INK : ink)),
	},
	{
		id: "cat-mqphdwv2-255y",
		name: "Text Palette",
		colors: [...TINT_COLORS, CREAM, "#efefef"],
		patternInks: [...TINT_INKS, CREAM_INK, "#dedede"],
	},
	{
		id: "cat-mpd3z8av-n270",
		name: "Area Fill Palette",
		colors: [...AREA_COLORS, CREAM],
		patternInks: [...AREA_INKS, CREAM_INK],
	},
	{
		id: "cat-mohtmuv1-dcxj",
		name: "Background Fill Palette",
		colors: [...DEEP_COLORS, CREAM, "#888888"],
		patternInks: [...DEEP_INKS, CREAM_INK, "#d6d6d6"],
	},
]

/** Sequential palettes for ORDINAL hue mappings (e.g. "rating:
 *  low/mid/high"), where a categorical palette would read as unrelated
 *  colors. Shared by both system themes. */
const ORDINAL_PALETTES: SavedCategoricalPalette[] = [
	{
		id: "ord-mu3311sr-gznl",
		name: "Pinks",
		colors: ["#F8B4C4", "#F698AE", "#F47C98", "#EF476F", "#B73754", "#7E273A"],
	},
	// Id predates the recolor (it started life as the bundled Blues ramp).
	{ id: "blues", name: "Yellows", colors: ["#FFD166", "#FFC233", "#FFB300", "#C08600"] },
	{
		id: "ord-mqpgl958-6x39",
		name: "Greens",
		colors: ["#b5f2dc", "#47dda7", "#1cb57d", "#1b9367", "#007043", "#005232"],
	},
	{
		id: "ord-mqpggw0o-3rea",
		name: "Blues",
		colors: ["#b2d6f7", "#84bff5", "#3c98eb", "#107cda", "#0563c7", "#003063"],
	},
	{ id: "ord-mqpglg0a-egea", name: "Stoplight Bold", colors: ["#47DDA7", "#FFB300", "#DB0000"] },
	{ id: "ord-mqpglpy2-j5no", name: "Stoplight Fill", colors: ["#daf8ed", "#fef1c0", "#fdefec"] },
]

const FRAUNCES = "'Fraunces', system-ui, sans-serif"
const QUICKSAND = "'Quicksand', system-ui, sans-serif"

/** The "Light" system theme's REQUIRED fields. Used as the baseline for new
 * accounts and the seed for any user theme that the user creates without
 * copying an existing one.
 *
 * Also the single source of truth for `store/atoms.ts`'s `DEFAULT_THEME`
 * (the baseline `themeAtom` falls back to and the floor `migrateTheme`
 * merges legacy blobs onto) — keep the two in one declaration, never two
 * copies. Treat as immutable: it is spread, never mutated in place.
 *
 * ONLY required `Theme` fields belong here. This object is the backfill floor
 * `themeOf` merges under every saved theme, so an OPTIONAL field placed here
 * would be frozen into every old custom theme that never set it (and would
 * shadow the per-consumer `??` fallback that "absent" is supposed to reach).
 * The system themes' optional styling lives in `SYSTEM_THEME_STYLE`. */
export const LIGHT_THEME_BASE: Theme = {
	defaultFill: "#EF476F",
	defaultRadius: 6,
	defaultOpacity: 1,
	defaultShape: 0,
	outlineColor: "#ffffff",
	outlineWidth: 1.5,
	titleFontFamily: FRAUNCES,
	titleFontColor: "#000000",
	titlePrimarySize: 16,
	titleSubtitleSize: 14,
	titleSecondarySize: 12,
	textFontFamily: QUICKSAND,
	textFontSize: 12,
	textFontColor: "#000000",
	categoricalPalettes: LIGHT_CATEGORICAL_PALETTES,
	ordinalPalettes: ORDINAL_PALETTES,
	linearGradients: [
		{
			id: "migrated-linear",
			name: "Light Theme Gradient",
			low: "#ffe5e5",
			high: "#b30027",
		},
	],
	divergingGradients: [
		{
			id: "migrated-diverging",
			name: "Light Theme Diverging",
			low: "#0763c7",
			mid: "#ffffff",
			high: "#ef476f",
		},
	],
	defaultCategoricalPaletteId: "migrated",
	defaultOrdinalPaletteId: "ord-mu3311sr-gznl",
	defaultTextPaletteId: "cat-mohtmuv1-dcxj",
	defaultGradientPalette: "migrated-linear",
	patternInkColor: "#000000",
	patternBackgroundColor: "#EFEFEF",
	gridlineColor: "#cfcfcf",
	gridlineThickness: 1,
	tickmarkColor: "#ffffff",
	tickmarkThickness: 1,
	tickmarkLength: 3,
	spineColor: "#0A1E33",
	spineThickness: 0,
	textEncodingFontFamily: "system-ui, sans-serif",
	textEncodingFontSize: 12,
	textEncodingFontWeight: 300,
	textEncodingColor: "#0A1E33",
	dataLabelsFontSize: 12,
	dataLabelsFontWeight: 300,
	dataLabelsItalic: false,
	dataLabelsUnderline: false,
	distributionOverlayStroke: "#000000",
	distributionOverlayFill: "#DBDBDB",
	regressionStroke: "#000000",
	regressionCiFill: "#DBDBDB",
	connectionThickness: 2,
	connectionColor: "#000000",
	lengthMin: 4,
	lengthMax: 40,
	angleMin: -180,
	angleMax: 180,
	areaMin: 3,
	areaMax: 18,
	// Saturation / brightness levels are ANCHORED on 0.5 = the palette color
	// itself (see `anchoredComponent` in lib/scales): the middle of a
	// category spread lands on the real color, darker/grayer below and
	// lighter/more saturated above.
	saturationMin: 0.2,
	saturationMax: 1,
	brightnessMin: 0.25,
	brightnessMax: 0.85,
	chartBackgroundColor: null,
	legendBackgroundColor: null,
	legendSwatchColor: "#e0e0e0",
	legendSwatchStroke: "#ffffff",
}

/** Dark companion to LIGHT_THEME_BASE — same structure on a navy chart
 * background: near-white text, ticks, connections and overlays, the dark
 * palette variants, and navy pattern ink / legend swatches. */
const DARK_INK = "#FAFAFA"
const DARK_BG = "#040038"

const DARK_THEME_BASE: Theme = {
	...LIGHT_THEME_BASE,
	outlineColor: DARK_BG,
	titleFontColor: DARK_INK,
	textFontColor: DARK_INK,
	categoricalPalettes: DARK_CATEGORICAL_PALETTES,
	// The pale tints are the dark theme's "Text Palette".
	defaultTextPaletteId: "cat-mqphdwv2-255y",
	patternInkColor: DARK_BG,
	tickmarkColor: DARK_INK,
	distributionOverlayStroke: "#EF476F",
	distributionOverlayFill: "#F2C5CF",
	regressionStroke: CREAM,
	regressionCiFill: "#FCFDF7",
	connectionColor: DARK_INK,
	chartBackgroundColor: DARK_BG,
	legendSwatchColor: DARK_BG,
	legendSwatchStroke: DARK_INK,
}

/** OPTIONAL `Theme` fields the two system themes ship with. Kept out of
 * `LIGHT_THEME_BASE` on purpose (see its doc) — these are applied to the
 * bundled `SavedTheme`s only, never backfilled into user themes. */
const SYSTEM_THEME_STYLE: Partial<Theme> = {
	titleFontWeight: 700,
	titleAlignment: "left",
	subtitleFontFamily: QUICKSAND,
	subtitleFontWeight: 300,
	axisTitleFontFamily: FRAUNCES,
	axisTitleFontWeight: 300,
	legendTitleFontFamily: QUICKSAND,
	legendTitleFontWeight: 500,
	legendTitleAlignment: "left",
	textFontWeight: 300,
	dataLabelsFontFamily: QUICKSAND,
	dataLabelsColor: "#000000",
	xGridlineThickness: 0,
	xSpineColor: "#000000",
	xSpineThickness: 1,
	ySpineColor: "#000000",
	polarSpineColor: "#000000",
	polarSpineThickness: 1,
	annotationFillColor: "#eeeeee",
	annotationFillOpacity: 1,
	annotationLineColor: "#000000",
	annotationLineThickness: 1,
	annotationTextFontFamily: "'DM Sans', ui-sans-serif, sans-serif",
	annotationTextFontSize: 12,
	annotationTextFontWeight: 300,
	annotationTextColor: "#000000",
	annotationTextBoxFillOpacity: 1,
	annotationTextBoxBorderColor: "#000000",
}

export const SYSTEM_LIGHT_THEME: SavedTheme = {
	id: "system-light",
	name: "System (Light)",
	isSystem: true,
	managed: true,
	...LIGHT_THEME_BASE,
	...SYSTEM_THEME_STYLE,
}

/** Dark overrides of `SYSTEM_THEME_STYLE`: every ink that is black in the
 * light theme goes near-white, plus per-axis gridlines, the annotation text
 * box fill and map leader lines that the light theme leaves unset. */
const DARK_THEME_STYLE: Partial<Theme> = {
	dataLabelsColor: DARK_INK,
	xGridlineColor: DARK_INK,
	yGridlineColor: DARK_INK,
	rGridlineColor: DARK_INK,
	xSpineColor: DARK_INK,
	ySpineColor: DARK_INK,
	polarSpineColor: DARK_INK,
	annotationLineColor: DARK_INK,
	annotationTextColor: DARK_INK,
	annotationTextBoxFillColor: DARK_BG,
	annotationTextBoxBorderColor: DARK_INK,
	mapLeaderLineColor: DARK_INK,
}

export const SYSTEM_DARK_THEME: SavedTheme = {
	id: "system-dark",
	name: "System (Dark)",
	isSystem: true,
	managed: true,
	...DARK_THEME_BASE,
	...SYSTEM_THEME_STYLE,
	...DARK_THEME_STYLE,
}

/** Bundled with the app — these always exist in `themesAtom` and start out
 * in the Managed Themes folder, so editing them goes through the
 * administrator gate. */
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
	const {
		id: _id,
		name: _name,
		isSystem: _isSystem,
		managed: _managed,
		...rest
	} = saved
	return { ...LIGHT_THEME_BASE, ...rest }
}

/** Whether a theme lives in the "Managed Themes" folder. The stored flag
 *  wins; an absent one falls back to `isSystem`, which makes the two
 *  bundled themes managed on a fresh install and leaves every theme saved
 *  before the folders existed in Custom. Sole reader of `.managed` — the
 *  fallback only holds if nothing tests the raw field.
 *
 *  Managed is about the ADMINISTRATOR gate, not about editability: the two
 *  system themes are managed AND permanently read-only (`isSystem`), while
 *  a promoted user theme is editable once the gate is passed. */
export const isManagedTheme = (theme: SavedThemeMeta): boolean =>
	theme.managed ?? theme.isSystem

/** Move a theme between the two folders. Writes the flag EXPLICITLY (both
 *  ways) so a promotion isn't undone by the `isSystem` fallback on the way
 *  back in. Callers refuse system themes, which are pinned to Managed. */
export const withManaged = <T extends SavedThemeMeta>(
	theme: T,
	managed: boolean
): T => ({ ...theme, managed })

/** Rehydrate one persisted theme entry: keep its identity, backfill any
 * missing `Theme` fields via `themeOf`. Persisted custom themes can predate
 * fields that were later added to `LIGHT_THEME_BASE` (and old theme-export
 * files re-import that sparseness), so entries must be completed BEFORE they
 * reach `themesAtom` — most readers (`useCurrentTheme`, `useResetVisual`,
 * Legend, the dash/pattern panels) take the atom's entries as-is, without a
 * `themeOf` call, and an `undefined` number field renders as NaN.
 *
 * Backfilling from the LIGHT base is intent-preserving, not a light-theme
 * bias: every field where the dark base differs has existed since the dark
 * theme shipped, so a theme can only be missing fields whose value is shared
 * by both bases. (A future field that differs per-base needs its own
 * migration — clones carry no record of which base they came from.) */
export const normalizeSavedTheme = (saved: SavedTheme): SavedTheme => ({
	...themeOf(saved),
	id: saved.id,
	name: saved.name,
	isSystem: saved.isSystem,
	// Left absent when absent: that's what makes a pre-folders theme read
	// as custom rather than as an explicit `managed: false`.
	...(saved.managed === undefined ? {} : { managed: saved.managed }),
})

/** Normalize a persisted themes list for `themesAtom`. System entries are
 * re-stamped from the bundled `SYSTEM_THEMES` (they're read-only in the UI,
 * so the code copy is authoritative and a stale stored copy is never a user
 * edit); user themes keep their values and get missing fields backfilled.
 *
 * This holds even though system themes sit in the Managed Themes folder:
 * passing the administrator gate unlocks the OTHER managed themes for
 * editing, never these two. */
export const normalizeSavedThemes = (stored: SavedTheme[]): SavedTheme[] =>
	stored.map((t) => {
		const bundled = SYSTEM_THEMES.find((s) => s.id === t.id)
		return bundled ?? normalizeSavedTheme(t)
	})
