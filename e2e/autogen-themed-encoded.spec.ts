import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import {
	TESTDATA_DIR,
	buildIndexHtml,
	collectIssues,
	isIgnorableConsoleError,
	slug,
	type ScaffoldResult,
} from "./autogen-helpers"

/** Themed, manually-encoded autogen smoke. Skips the random-gen quick
 *  start; instead, this spec drives the encoding shelves directly to
 *  stack as many channels as each chart type accepts, then applies the
 *  "Custom Basic" theme and a set of custom titles
 *  (chart title, subtitle, x-axis title, y-axis title). One screenshot
 *  per chart type. */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(
	__dirname,
	"screenshots/autogen-themed-encoded",
)

/** A complete custom (non-system) theme — the `theme` payload of a real
 *  export envelope, with `id` pinned so the dropdown selection in the
 *  Theme panel can target it deterministically. */
const CUSTOM_THEME = {
	id: "custom-basic",
	name: "Custom Basic",
	isSystem: false,
	defaultFill: "#8e81ee",
	defaultRadius: 6,
	defaultOpacity: 1,
	defaultShape: 0,
	outlineColor: "#ffffff",
	outlineWidth: 1.5,
	titleFontFamily: "'DM Sans', ui-sans-serif, sans-serif",
	titleFontColor: "#003063",
	titlePrimarySize: 25,
	titleSubtitleSize: 20,
	titleSecondarySize: 15,
	textFontFamily: "'DM Sans', ui-sans-serif, sans-serif",
	textFontSize: 15,
	textFontColor: "#003063",
	categoricalPalettes: [
		{
			id: "migrated",
			name: "My palette",
			colors: [
				"#003063",
				"#8e81ee",
				"#48dda7",
				"#f3aea0",
				"#3d99ec",
				"#ff8a00",
				"#adadad",
				"#d2d2d2",
				"#4530e3",
				"#fff04d",
				"#e86247",
			],
			patternInks: [
				"#0d7cf2",
				"#d6c7ff",
				"#66ff9c",
				"#f7e7d9",
				"#9ecdff",
				"#ffc085",
				"#e8e8e8",
				"#d9d9d9",
				"#9694e5",
				"#feffc2",
				"#fba656",
			],
		},
		{
			id: "cat-mohtmuv1-dcxj",
			name: "Text Palette",
			colors: [
				"#003063",
				"#4530e3",
				"#1d9b6d",
				"#e86147",
				"#1573ca",
				"#e3740d",
				"#828282",
			],
		},
		{
			id: "cat-mpd3z8av-n270",
			name: "Fill Palette",
			colors: [
				"#95a2b4",
				"#d2cdf8",
				"#b6f1dc",
				"#fadfd9",
				"#b1d6f7",
				"#ffd099",
				"#ffffff",
			],
		},
	],
	linearGradients: [
		{
			id: "migrated-linear",
			name: "My gradient",
			low: "#f4dbff",
			high: "#30008a",
		},
	],
	divergingGradients: [
		{
			id: "migrated-diverging",
			name: "My diverging",
			low: "#ff8800",
			mid: "#ffffff",
			high: "#4732ec",
		},
	],
	defaultCategoricalPaletteId: "migrated",
	defaultTextPaletteId: null,
	defaultGradientPalette: "migrated-linear",
	patternInkColor: "#003063",
	patternBackgroundColor: "#EFEFEF",
	gridlineColor: "#cfcfcf",
	gridlineThickness: 1,
	tickmarkColor: "#cfcfcf",
	tickmarkThickness: 1,
	tickmarkLength: 3,
	spineColor: "#000000",
	spineThickness: 1,
	textEncodingFontFamily: "system-ui, sans-serif",
	textEncodingFontSize: 11,
	textEncodingFontWeight: 500,
	textEncodingColor: "#111827",
	distributionOverlayStroke: "#475569",
	distributionOverlayFill: "#cbd5e1",
	connectionThickness: 2,
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
	legendBackgroundColor: null,
	gridlineCount: 5,
	xGridlineThickness: 0,
	ordinalPalettes: [
		{
			id: "blues",
			name: "Blues (light→dark)",
			colors: [
				"#deebf7",
				"#c6dbef",
				"#9ecae1",
				"#6baed6",
				"#4292c6",
				"#2171b5",
			],
		},
	],
	defaultOrdinalPaletteId: "blues",
}

/** Per-test scenario: which dataset, which encodings to assign, which
 *  titles to set. The chart type emerges from the encoding mix
 *  (e.g., `x + length` ⇒ bars, `x + length + connection` ⇒ areas).
 *  Order matters for mutual-exclusion channels — assign non-
 *  conflicting encodings first. */
type Scenario = {
	id: string
	name: string
	dataset: string
	encodings: Array<{ channel: string; field: string }>
	titles: {
		title: string
		subtitle: string
		xAxisTitle: string
		yAxisTitle: string
	}
	/** When set, after encodings are applied we expand the Facet disclosure
	 *  and set the column count in the FacetOptionsPanel. Use 1 for the
	 *  "tall stack of panels" scenarios. */
	facetCols?: number
	/** When true, also check the "Size panels by category count" box —
	 *  panels with more categories on the non-measure axis get
	 *  proportionally more space. Only visible when `facetCols=1` and the
	 *  panels actually have different category counts. */
	proportionalByCategoryCount?: boolean
	/** Optional override for the facet `Gap Y` input. Default in the
	 *  channel config is 60, which eats most of the canvas when 4 panels
	 *  stack in one column — drop to ~8 for 1-col scenarios where we
	 *  want proportional heights to be visible. */
	facetGapY?: number
	/** Override the inferred type for one or more fields via the
	 *  Fields-panel dropdown. Needed when a numeric-looking field
	 *  should be treated as categorical (e.g. `Year` 2021/2024 → tile
	 *  heatmap needs categorical X AND categorical Y). */
	fieldTypeOverrides?: Record<
		string,
		"quantitative" | "categorical" | "temporal" | "ordinal"
	>
	/** Mirror of `facetGapY` for the Gap X input. Useful when packing
	 *  many panels into one row (1×N). */
	facetGapX?: number
	/** Toggle the per-axis "Share axes" checkboxes in FacetOptionsPanel.
	 *  shareX=true → only the bottom row draws x-axis tick labels and
	 *  the shared x-title sits below the grid. shareY=true → only the
	 *  leftmost column draws y-axis tick labels. Each defaults to the
	 *  config's value (undefined ↔ leave alone). */
	shareX?: boolean
	shareY?: boolean
	/** Pass-through to `collectIssues` — turn on the per-row/per-col
	 *  alignment check for scenarios where shared axes make alignment
	 *  load-bearing. */
	checkPanelAlignment?: boolean
}

const IRIS = "iris.csv"
const HEATMAP = "funny_animals_heatmap_data.csv"
const DUMBBELL = "dumbbelldat2.csv"
const LINEDATA = "linedata.csv"

const SCENARIOS: Scenario[] = [
	// ─── iris.csv — 4 quantitative + 1 categorical, no facet field ───
	{
		id: "iris-bar",
		name: "iris · Bar — 7 encodings",
		dataset: IRIS,
		encodings: [
			{ channel: "X position", field: "Species" },
			{ channel: "Length", field: "Sepal.Length" },
			{ channel: "Color", field: "Species" },
			{ channel: "Pattern", field: "Species" },
			{ channel: "Brightness", field: "Sepal.Width" },
			{ channel: "Saturation", field: "Petal.Length" },
			{ channel: "Opacity", field: "Petal.Width" },
		],
		titles: {
			title: "Iris Sepal Measurements",
			subtitle: "Mean sepal length per species",
			xAxisTitle: "Species name",
			yAxisTitle: "Sepal length (cm)",
		},
	},
	{
		id: "iris-scatter",
		name: "iris · Scatter — 7 encodings",
		dataset: IRIS,
		encodings: [
			{ channel: "X position", field: "Sepal.Length" },
			{ channel: "Y position", field: "Sepal.Width" },
			{ channel: "Color", field: "Species" },
			{ channel: "Shape", field: "Species" },
			{ channel: "Area", field: "Petal.Length" },
			{ channel: "Brightness", field: "Sepal.Width" },
			{ channel: "Saturation", field: "Petal.Length" },
			{ channel: "Opacity", field: "Petal.Width" },
			{ channel: "Pattern", field: "Species" },
		],
		titles: {
			title: "Iris Morphometry",
			subtitle: "Sepal length vs sepal width, with petal size",
			xAxisTitle: "Sepal length (cm)",
			yAxisTitle: "Sepal width (cm)",
		},
	},
	{
		id: "iris-line",
		name: "iris · Line — 7 encodings",
		dataset: IRIS,
		encodings: [
			{ channel: "X position", field: "Sepal.Length" },
			{ channel: "Y position", field: "Sepal.Width" },
			{ channel: "Connection", field: "Species" },
			{ channel: "Color", field: "Species" },
			{ channel: "Pattern", field: "Species" },
			{ channel: "Shape", field: "Species" },
			{ channel: "Brightness", field: "Petal.Length" },
			{ channel: "Saturation", field: "Sepal.Width" },
			{ channel: "Area", field: "Petal.Width" },
			{ channel: "Opacity", field: "Petal.Width" },
		],
		titles: {
			title: "Iris Species Trajectories",
			subtitle: "Sepal width as a function of length, by species",
			xAxisTitle: "Sepal length (cm)",
			yAxisTitle: "Sepal width (cm)",
		},
	},
	{
		id: "iris-area",
		name: "iris · Area — 7 encodings",
		dataset: IRIS,
		encodings: [
			{ channel: "X position", field: "Sepal.Length" },
			{ channel: "Length", field: "Petal.Length" },
			{ channel: "Connection", field: "Species" },
			{ channel: "Color", field: "Species" },
			{ channel: "Pattern", field: "Species" },
			{ channel: "Brightness", field: "Sepal.Width" },
			{ channel: "Saturation", field: "Petal.Length" },
			{ channel: "Opacity", field: "Petal.Width" },
		],
		titles: {
			title: "Iris Petal Distribution",
			subtitle: "Petal length across sepal-length range",
			xAxisTitle: "Sepal length (cm)",
			yAxisTitle: "Petal length (cm)",
		},
	},
	{
		id: "iris-pies",
		name: "iris · Pies-x — 6 encodings",
		dataset: IRIS,
		encodings: [
			{ channel: "X position", field: "Species" },
			{ channel: "Angle", field: "Sepal.Length" },
			{ channel: "Color", field: "Species" },
			{ channel: "Pattern", field: "Species" },
			{ channel: "Brightness", field: "Sepal.Width" },
			{ channel: "Saturation", field: "Petal.Length" },
			{ channel: "Opacity", field: "Petal.Width" },
		],
		titles: {
			title: "Iris Sepal-Length Share by Species",
			subtitle: "Wedges colored by species",
			xAxisTitle: "Species",
			yAxisTitle: "Total sepal length",
		},
	},
	{
		id: "iris-violin",
		name: "iris · Violin/box — 6 encodings",
		dataset: IRIS,
		encodings: [
			{ channel: "X position", field: "Species" },
			{ channel: "Y position", field: "Sepal.Length" },
			{ channel: "Color", field: "Species" },
			{ channel: "Opacity", field: "Petal.Width" },
			{ channel: "Brightness", field: "Sepal.Width" },
			{ channel: "Saturation", field: "Petal.Length" },
			{ channel: "Pattern", field: "Species" },
			{ channel: "Shape", field: "Species" },
			{ channel: "Area", field: "Petal.Length" },
		],
		titles: {
			title: "Iris Sepal Length Distribution",
			subtitle: "By species, jittered with overlay",
			xAxisTitle: "Species",
			yAxisTitle: "Sepal length (cm)",
		},
	},

	// ─── dumbbelldat2.csv — Facet, Group, Year, Value — faceted! ───
	{
		id: "dumbbell-bar-faceted",
		name: "dumbbell · Bar — 6 encodings + facet",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Group" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Year" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Dumbbell Distribution — Faceted",
			subtitle: "One panel per Facet, bars by group",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
	},
	{
		id: "dumbbell-line-faceted",
		name: "dumbbell · Line — 6 encodings + facet",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Year" },
			{ channel: "Y position", field: "Value" },
			{ channel: "Connection", field: "Group" },
			{ channel: "Color", field: "Group" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Shape", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Area", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Trends Over Time",
			subtitle: "Lines grouped per panel by facet",
			xAxisTitle: "Year",
			yAxisTitle: "Measured value",
		},
	},

	// ─── linedata.csv — Group, Step, Value, Facet — faceted ───
	{
		id: "linedata-area-faceted",
		name: "linedata · Area — 7 encodings + facet",
		dataset: LINEDATA,
		encodings: [
			{ channel: "X position", field: "Step" },
			{ channel: "Length", field: "Value" },
			{ channel: "Connection", field: "Group" },
			{ channel: "Color", field: "Group" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Step" },
			{ channel: "Saturation", field: "Value" },
			{ channel: "Opacity", field: "Step" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Stacked Areas Across Steps",
			subtitle: "Per-facet panels, grouped by Group",
			xAxisTitle: "Step",
			yAxisTitle: "Value",
		},
	},

	// ─── funny_animals_heatmap_data.csv — animal, activity, silliness_score ───
	{
		id: "animals-tile",
		name: "animals · Tile heatmap — 5 encodings",
		dataset: HEATMAP,
		// Tile forbids glyph channels (length/angle/shape/area/opacity/
		// connection) — mapping opacity silently dropped this to scatter.
		// Hue/Pattern/Brightness/Saturation are all tile-legal, so we max
		// those (silliness drives the gradient; animal drives the pattern).
		encodings: [
			{ channel: "X position", field: "animal" },
			{ channel: "Y position", field: "activity" },
			{ channel: "Color", field: "silliness_score" },
			{ channel: "Pattern", field: "animal" },
			{ channel: "Brightness", field: "silliness_score" },
			{ channel: "Saturation", field: "silliness_score" },
		],
		titles: {
			title: "Animal Silliness by Activity",
			subtitle: "Heatmap of silliness scores",
			xAxisTitle: "Animal",
			yAxisTitle: "Activity",
		},
	},
	{
		id: "animals-bar-faceted",
		name: "animals · Bar — 5 encodings + facet by activity",
		dataset: HEATMAP,
		encodings: [
			{ channel: "X position", field: "animal" },
			{ channel: "Length", field: "silliness_score" },
			{ channel: "Color", field: "animal" },
			{ channel: "Pattern", field: "animal" },
			{ channel: "Brightness", field: "silliness_score" },
			{ channel: "Saturation", field: "silliness_score" },
			{ channel: "Opacity", field: "silliness_score" },
			{ channel: "Facet", field: "activity" },
		],
		titles: {
			title: "Silliness Per Animal — by Activity",
			subtitle: "Bars per animal, one panel per activity",
			xAxisTitle: "Animal",
			yAxisTitle: "Silliness score",
		},
	},

	// ─── More faceting + hue across chart types ─────────────────────────
	// Coverage gap: pies, scatter, and violin/box had no faceted + hued
	// scenario. dumbbelldat2 (4 Facet panels) and the animals heatmap
	// (facet by activity) drive these. Faceting composes orthogonally with
	// every chart mode, so each becomes small multiples colored by hue.
	{
		id: "dumbbell-pie-faceted",
		name: "dumbbell · Pie — hue slices + facet",
		dataset: DUMBBELL,
		encodings: [
			// No x/y → single centered pie per facet panel; wedges come from
			// the hue grouping (Group). One pie per Facet value.
			{ channel: "Angle", field: "Value" },
			{ channel: "Color", field: "Group" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Value Share by Group — Faceted Pies",
			subtitle: "One pie per facet, wedges colored by group",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
	},
	{
		id: "dumbbell-pies-x-faceted",
		name: "dumbbell · Pies-x — hue by year + facet",
		dataset: DUMBBELL,
		// Year is inferred quantitative (2021/2024); force categorical so it
		// slices each pie into two wedges (one per year) rather than driving
		// a gradient. Without this every pie is a single full-circle wedge.
		fieldTypeOverrides: { Year: "categorical" },
		encodings: [
			// x=Group → a band of pies (one per group); Facet=Facet → one such
			// band per panel. Each pie is split by Year (hue), so wedges are
			// actually visible instead of degenerate single-slice circles.
			{ channel: "X position", field: "Group" },
			{ channel: "Angle", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Year" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Value Share by Year — Pies per Group, Faceted",
			subtitle: "A pie per group in each facet, split by year",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
	},
	{
		id: "dumbbell-scatter-faceted",
		name: "dumbbell · Scatter — hue + facet",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Year" },
			{ channel: "Y position", field: "Value" },
			{ channel: "Color", field: "Group" },
			{ channel: "Shape", field: "Group" },
			{ channel: "Area", field: "Value" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Score" },
			{ channel: "Saturation", field: "Value" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Value vs Year — Faceted Scatter",
			subtitle: "One panel per facet, points colored by group",
			xAxisTitle: "Year",
			yAxisTitle: "Value",
		},
	},
	{
		id: "dumbbell-violin-faceted",
		name: "dumbbell · Violin/box — hue + facet",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Y position", field: "Value" },
			{ channel: "Color", field: "Group" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Shape", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Area", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Value Distribution by Group — Faceted",
			subtitle: "Box/violin per group, one panel per facet",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
	},

	// ─── 1-column, proportional-by-category-count scenarios ───
	// dumbbelldat2.csv has 4 Facet panels with Group counts [1, 2, 3, 6]
	// — so when the solver weights panels by category count the heights
	// should visibly differ (1px-per-cat × 6 ≈ 6× taller than the 1-cat
	// panel). All four scenarios use the same dataset but vary which
	// axis is categorical, to exercise how the solver's weight pick
	// (max of x/y categories) flows into the layout.
	{
		id: "dumbbell-hbar-1col-prop",
		name: "dumbbell · Horizontal bar — 1 col, size by category count",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "Y position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Group Performance Across Facets — Horizontal",
			subtitle: "1 column, panel height ∝ group count",
			xAxisTitle: "Value",
			yAxisTitle: "Group",
		},
		facetCols: 1,
		facetGapY: 8,
		proportionalByCategoryCount: true,
	},
	{
		id: "dumbbell-vbar-1col-prop",
		name: "dumbbell · Vertical bar — 1 col, size by category count",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Group Performance Across Facets — Vertical",
			subtitle: "1 column, weight = group count (note: applies to height)",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
		facetCols: 1,
		facetGapY: 8,
		proportionalByCategoryCount: true,
	},
	{
		id: "dumbbell-tile-1col-prop",
		name: "dumbbell · Tile heatmap — 1 col, size by category count",
		dataset: DUMBBELL,
		// Year is inferred quantitative (2021/2024 are numbers); for a
		// tile heatmap we need both x and y categorical. Override Year →
		// categorical BEFORE assigning encodings so the chart-mode picker
		// selects tile, not scatter.
		fieldTypeOverrides: { Year: "categorical" },
		encodings: [
			{ channel: "X position", field: "Year" },
			{ channel: "Y position", field: "Group" },
			{ channel: "Color", field: "Value" },
			// NOTE: tile mode requires NO glyph-implying channels (length,
			// angle, shape, area, opacity, connection). Mapping any of
			// those drops back to scatter — see chartModes/tile.ts. Pattern /
			// brightness / saturation are tile-legal, so we max those.
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Score" },
			{ channel: "Saturation", field: "Value" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Group × Year Heatmap — Per Facet",
			subtitle: "Tile cell height should stay roughly constant",
			xAxisTitle: "Year",
			yAxisTitle: "Group",
		},
		facetCols: 1,
		facetGapY: 8,
		proportionalByCategoryCount: true,
	},
	// ─── Ridgeline scenarios (negative gapY = cumulative overlap) ────────
	// The classic ridgeline / joy-plot use case: stack many panels with
	// negative gapY so their content overlaps the next panel above. The
	// solver has dedicated math here — naturalGridH growth is suppressed
	// when gapY<0 (user opted into overlap; cells should compress to fit
	// the container instead of triggering scroll). These scenarios stress
	// that path and the cumulative-shift cell positioning.
	{
		id: "dumbbell-bar-ridgeline-4x1",
		name: "dumbbell · 4×1 bar · ridgeline gapY=-40",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Ridgeline · 4 facets stacked with -40 gap",
			subtitle: "Peaks should pop above the panel below them",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
		facetCols: 1,
		facetGapY: -40,
		checkPanelAlignment: true,
	},
	{
		id: "animals-bar-ridgeline-5x1",
		name: "animals · 5×1 bar · ridgeline gapY=-30 (faceted by activity)",
		dataset: HEATMAP,
		encodings: [
			{ channel: "X position", field: "animal" },
			{ channel: "Length", field: "silliness_score" },
			{ channel: "Color", field: "animal" },
			{ channel: "Pattern", field: "animal" },
			{ channel: "Brightness", field: "silliness_score" },
			{ channel: "Saturation", field: "silliness_score" },
			{ channel: "Opacity", field: "silliness_score" },
			{ channel: "Facet", field: "activity" },
		],
		titles: {
			title: "Animal Silliness · Activity Ridgeline",
			subtitle: "5 activities stacked with cumulative -30 overlap",
			xAxisTitle: "Animal",
			yAxisTitle: "Silliness score",
		},
		facetCols: 1,
		facetGapY: -30,
		checkPanelAlignment: true,
	},
	{
		id: "linedata-area-ridgeline-2x1",
		name: "linedata · 2×1 area · ridgeline gapY=-60 (strong overlap)",
		dataset: LINEDATA,
		encodings: [
			{ channel: "X position", field: "Step" },
			{ channel: "Length", field: "Value" },
			{ channel: "Connection", field: "Group" },
			{ channel: "Color", field: "Group" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Step" },
			{ channel: "Opacity", field: "Value" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Density Ridgeline · 2 facets",
			subtitle: "Stronger -60 gap pulls panel 2 well into panel 1",
			xAxisTitle: "Step",
			yAxisTitle: "Value",
		},
		facetCols: 1,
		facetGapY: -60,
		checkPanelAlignment: true,
	},
	{
		id: "dumbbell-bar-ridgeline-shareY",
		name: "dumbbell · 4×1 bar · ridgeline + shareY (interaction)",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Ridgeline + Shared Y · 4×1",
			subtitle: "Y-axis shared across panels; should still pop above neighbors",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
		facetCols: 1,
		facetGapY: -40,
		shareY: true,
		checkPanelAlignment: true,
	},

	// ─── Shared-axes scenarios ───────────────────────────────────────────
	// Layout-sensitive cases for shareX / shareY / both. Each enables the
	// panel-alignment check so misaligned rows/cols (the whole point of
	// "share axes") surface as issues. All use dumbbelldat2 (4 facets) so
	// the grid choice fully accounts for every panel.
	{
		id: "dumbbell-share-x-2x2",
		name: "dumbbell · 2×2 · shareX (only bottom row x-axis)",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Shared X-Axis · 2×2",
			subtitle: "Only the bottom row should draw x-axis tick labels and title",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
		facetCols: 2,
		shareX: true,
		shareY: false,
		// Intentionally leave proportionalByCategoryCount at its
		// default (true). The solver's share-axes rule auto-collapses
		// the proportional weights on whichever axis is shared, so
		// cols (under shareY) and rows (under shareX) stay uniform
		// even with proportional on.
		checkPanelAlignment: true,
	},
	{
		id: "dumbbell-share-y-2x2",
		name: "dumbbell · 2×2 · shareY (only left col y-axis)",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "Y position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Shared Y-Axis · 2×2",
			subtitle: "Only the left column should draw y-axis tick labels and title",
			xAxisTitle: "Value",
			yAxisTitle: "Group",
		},
		facetCols: 2,
		shareX: false,
		shareY: true,
		// Default proportionalByCategoryCount (true). Solver's
		// share-axes rule collapses col weights under shareY.
		checkPanelAlignment: true,
	},
	{
		id: "dumbbell-share-both-2x2",
		name: "dumbbell · 2×2 · shareX + shareY (interior cells stripped)",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Shared Both Axes · 2×2",
			subtitle: "Top-right panel should have minimal chrome (no x or y axis)",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
		facetCols: 2,
		shareX: true,
		shareY: true,
		// Default proportionalByCategoryCount (true). Solver collapses
		// col weights (shareY) AND row weights (shareX) → uniform grid.
		checkPanelAlignment: true,
	},
	{
		id: "dumbbell-share-x-4x1",
		name: "dumbbell · 4×1 · shareX (tall stack, only bottom x-axis)",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Shared X-Axis · 4×1",
			subtitle: "All 4 panels stack; only the bottom shows x-axis labels",
			xAxisTitle: "Group",
			yAxisTitle: "Value",
		},
		facetCols: 1,
		facetGapY: 8,
		shareX: true,
		shareY: false,
		// Intentionally leave proportionalByCategoryCount at its
		// default (true). The solver's share-axes rule auto-collapses
		// the proportional weights on whichever axis is shared, so
		// cols (under shareY) and rows (under shareX) stay uniform
		// even with proportional on.
		checkPanelAlignment: true,
	},
	{
		id: "dumbbell-share-y-1x4",
		name: "dumbbell · 1×4 · shareY (wide row, only left y-axis)",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "Y position", field: "Group" },
			{ channel: "Length", field: "Value" },
			{ channel: "Color", field: "Year" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Shared Y-Axis · 1×4",
			subtitle: "All 4 panels in one row; only the leftmost shows y-axis labels",
			xAxisTitle: "Value",
			yAxisTitle: "Group",
		},
		facetCols: 4,
		facetGapX: 8,
		shareX: false,
		shareY: true,
		// Default proportionalByCategoryCount (true). Solver collapses
		// col weights under shareY → 4 cols all the same width.
		checkPanelAlignment: true,
	},

	{
		id: "dumbbell-line-1col-prop",
		name: "dumbbell · Line — 1 col, size by category count (control)",
		dataset: DUMBBELL,
		encodings: [
			{ channel: "X position", field: "Year" },
			{ channel: "Y position", field: "Value" },
			{ channel: "Connection", field: "Group" },
			{ channel: "Color", field: "Group" },
			{ channel: "Pattern", field: "Group" },
			{ channel: "Shape", field: "Group" },
			{ channel: "Brightness", field: "Value" },
			{ channel: "Saturation", field: "Score" },
			{ channel: "Area", field: "Score" },
			{ channel: "Opacity", field: "Year" },
			{ channel: "Facet", field: "Facet" },
		],
		titles: {
			title: "Line Trends Per Facet",
			subtitle: "Control case — weights are uniform (no categorical y), panels equal-sized",
			xAxisTitle: "Year",
			yAxisTitle: "Value",
		},
		facetCols: 1,
		facetGapY: 8,
		proportionalByCategoryCount: true,
	},
]

const results: ScaffoldResult[] = []

test.beforeAll(() => {
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
})

test.afterAll(() => {
	writeFileSync(
		path.join(SCREENSHOT_DIR, "index.html"),
		buildIndexHtml(
			"Themed + manually-encoded charts (Custom Basic)",
			results,
		),
		"utf-8",
	)
})

/** Seed the custom theme PLUS the system themes into localStorage
 *  before the editor loads. Without this, `themesAtom` only contains
 *  the system themes (Light + Dark) and the dropdown would never have
 *  "Custom Basic" to pick. */
const seedTheme = async (page: Page): Promise<void> => {
	await page.addInitScript((themeJson) => {
		// Storage envelope mirrors `loadVersioned` / `saveVersioned`:
		// `{ _v: version, data: T }`. THEMES_VERSION is 2 in the current
		// migration list, but the migration backfills ordinalPalettes
		// on older entries so passing v1 is fine; we set v2 to skip the
		// migration entirely.
		const SYSTEM_LIGHT_SEED = {
			id: "system-light",
			name: "System (Light)",
			isSystem: true,
		}
		/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions -- runs inside page.addInitScript (browser context) */
		localStorage.setItem(
			"vis-components:themes",
			JSON.stringify({
				_v: 2,
				data: [SYSTEM_LIGHT_SEED, JSON.parse(themeJson)],
			}),
		)
		/* eslint-enable no-restricted-globals, @th/no-storage-outside-try */
	}, JSON.stringify(CUSTOM_THEME))
	/* eslint-enable @th/use-wrapped-json-functions */
}

const applyTheme = async (page: Page, themeId: string): Promise<void> => {
	const themePanel = page.locator('[id="aside-section-Theme"]')
	const select = themePanel.getByLabel("Theme", { exact: true })
	if ((await select.count()) === 0) return
	await select.selectOption(themeId).catch(() => {})
	await page.waitForTimeout(250)
}

const setEncoding = async (
	page: Page,
	channel: string,
	field: string,
): Promise<void> => {
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	// The facet channel's control label is "Facet (wrap)" (see CHANNELS in
	// lib/channels.ts); scenarios refer to it as "Facet" for brevity. Map it
	// through so the exact-match getByLabel actually finds the select —
	// otherwise the Facet field is silently never mapped and nothing facets.
	const label = channel === "Facet" ? "Facet (wrap)" : channel
	const select = encodingsPanel.getByLabel(label, { exact: true })
	if ((await select.count()) === 0) return
	await select.selectOption(field).catch(() => {})
}

/** Override a field's inferred type via the Fields-panel dropdown.
 *  Each field row has a hidden-labeled select with aria-label
 *  "Type for <fieldName>"; selecting categorical/ordinal/etc. updates
 *  the fieldTypeOverrides atom which then flows through the encoder. */
const setFieldType = async (
	page: Page,
	fieldName: string,
	type: "quantitative" | "categorical" | "temporal" | "ordinal",
): Promise<void> => {
	const fieldsPanel = page.locator('[id="aside-section-Fields"]')
	const select = fieldsPanel.getByLabel(`Type for ${fieldName}`, {
		exact: true,
	})
	if ((await select.count()) === 0) return
	await select.selectOption(type).catch(() => {})
}

const setTitle = async (
	page: Page,
	label: string,
	value: string,
): Promise<void> => {
	const labelsPanel = page.locator(
		'[id="aside-section-Axis Labels and Titles"]',
	)
	const textarea = labelsPanel.getByLabel(label, { exact: true })
	if ((await textarea.count()) === 0) return
	// fill() emits a single change event after setting the value — much
	// faster than `type()` (per-character keystrokes) and avoids the
	// `press("Tab")` chain that previously blocked the test indefinitely
	// when focus moved to the disclosure-button next to the textarea.
	await textarea.fill(value).catch(() => {})
}

/** Expand the per-channel "Toggle options for Facet" disclosure in the
 *  Encodings panel. The FacetOptionsPanel (rows/cols + sizing checkboxes)
 *  is rendered inside that disclosure, so the inputs aren't queryable
 *  until it's open. The disclosure button only exists when a field is
 *  mapped to Facet — call this AFTER setEncoding(..., "Facet", ...). */
const expandFacetOptions = async (page: Page): Promise<void> => {
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	const btn = encodingsPanel.getByRole("button", {
		name: /Toggle options for Facet \(wrap\)/,
	})
	if ((await btn.count()) === 0) return
	const expanded = await btn.getAttribute("aria-expanded")
	if (expanded === "true") return
	await btn.click().catch(() => {})
}

/** Within the (already-expanded) FacetOptionsPanel, set the Cols number
 *  input. The panel has two number inputs labelled "Rows" and "Cols" —
 *  the second one is what we target. Sets cols=1 for the "tall stack"
 *  scenarios. */
const setFacetCols = async (page: Page, cols: number): Promise<void> => {
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	// FacetOptionsPanel uses placeholder=String(grid.cols) on the number
	// input nested in <label><span>Cols</span><input/></label>. Scope
	// through the label text to disambiguate from Rows.
	const colsInput = encodingsPanel.locator("label").filter({
		hasText: /^Cols$/,
	}).locator("input[type=\"number\"]")
	if ((await colsInput.count()) === 0) return
	await colsInput.first().fill(String(cols)).catch(() => {})
}

/** Within the (already-expanded) FacetOptionsPanel, set the Gap X
 *  number input. Mirror of `setFacetGapY` for wide 1×N layouts. */
const setFacetGapX = async (page: Page, gapX: number): Promise<void> => {
	// GapInput renders a NumberInput: `type="text"` with the label associated
	// via htmlFor — locate by accessible label, not label>input descendant.
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	const gapInput = encodingsPanel.getByLabel(/^Gap X/)
	if ((await gapInput.count()) === 0) return
	await gapInput.first().fill(String(gapX)).catch(() => {})
}

/** Within the (already-expanded) FacetOptionsPanel, toggle the
 *  X-axis or Y-axis share checkbox. The labels in the panel are
 *  "X-axis (only the bottom row labels)" and "Y-axis (only the left
 *  column labels)". */
const setShareX = async (page: Page, on: boolean): Promise<void> => {
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	const cb = encodingsPanel.getByLabel(/^X-axis \(only the bottom row labels\)/)
	if ((await cb.count()) === 0) return
	if (on) await cb.check().catch(() => {})
	else await cb.uncheck().catch(() => {})
}

const setShareY = async (page: Page, on: boolean): Promise<void> => {
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	const cb = encodingsPanel.getByLabel(/^Y-axis \(only the left column labels\)/)
	if ((await cb.count()) === 0) return
	if (on) await cb.check().catch(() => {})
	else await cb.uncheck().catch(() => {})
}

/** Within the (already-expanded) FacetOptionsPanel, set the Gap Y
 *  number input. Default in channelConfig is 60; for stacked 1-col
 *  layouts that gap × (rows-1) overflows the canvas, so we drop it. */
const setFacetGapY = async (page: Page, gapY: number): Promise<void> => {
	// See setFacetGapX — locate the NumberInput by accessible label.
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	const gapInput = encodingsPanel.getByLabel(/^Gap Y/)
	if ((await gapInput.count()) === 0) return
	await gapInput.first().fill(String(gapY)).catch(() => {})
}

/** Within the (already-expanded) FacetOptionsPanel, toggle every
 *  "Size {columns,rows} by category count" checkbox that's currently
 *  visible. Wrap mode now exposes one toggle per axis (each appears
 *  only when its axis variable is categorical/ordinal), so checking
 *  "all of them" matches the old single-global-flag intent: enable
 *  category-count weighting on whichever axes can carry it. */
const setProportionalByCategoryCount = async (
	page: Page,
	on: boolean,
): Promise<void> => {
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	const cbs = encodingsPanel.getByLabel(/Size (columns|rows) by category count/)
	const count = await cbs.count()
	for (let i = 0; i < count; i++) {
		const cb = cbs.nth(i)
		if (on) await cb.check().catch(() => {})
		else await cb.uncheck().catch(() => {})
	}
}

// Each test drives a lot of UI: select theme → fill 4 title fields →
// assign 5–7 encodings (each with possible conflict-confirm). The
// default 30s Playwright timeout isn't enough; bump it.
test.describe.configure({ timeout: 90_000 })

// The scenario datasets live in the gitignored testdata/ dir (removed before
// the repo went public — not public-friendly). Only run scenarios whose CSV
// exists, so the suite is green on CI (where testdata/ is absent → zero cases)
// and still runs locally for anyone who has the files. Mirrors autogen.spec.
const AVAILABLE_SCENARIOS = SCENARIOS.filter((scenario) =>
	existsSync(path.join(TESTDATA_DIR, scenario.dataset)),
)

for (const scenario of AVAILABLE_SCENARIOS) {
	test(scenario.name, async ({ page }, info) => {
		const consoleErrors: string[] = []
		page.on("console", (msg) => {
			if (msg.type() !== "error") return
			const text = msg.text()
			if (isIgnorableConsoleError(text)) return
			consoleErrors.push(text)
		})

		const screenshotPath = path.join(
			info.project.name,
			`${slug(scenario.id)}.png`,
		)
		const fullScreenshotPath = path.join(SCREENSHOT_DIR, screenshotPath)
		mkdirSync(path.dirname(fullScreenshotPath), { recursive: true })

		const record = (
			patch: Partial<ScaffoldResult> & Pick<ScaffoldResult, "issues">,
		) =>
			results.push({
				dataset: scenario.dataset,
				chartType: scenario.name,
				screenshotPath,
				skipped: false,
				consoleErrors,
				...patch,
			})

		await seedTheme(page)
		await page.goto("/editor/new", { waitUntil: "domcontentloaded" })
		await page.waitForSelector('input[type="file"][accept*="csv"]', {
			state: "attached",
			timeout: 10_000,
		})
		await page.setInputFiles(
			'input[type="file"][accept*="csv"]',
			path.join(TESTDATA_DIR, scenario.dataset),
		)
		// Wait for the field list to populate (the encoding shelves'
		// selects start showing options after upload).
		await page.waitForFunction(
			() => {
				const enc = document.querySelector(
					'[id="aside-section-Encodings"]',
				)
				if (!enc) return false
				const sel = enc.querySelector("select")
				return sel !== null && sel.options.length > 1
			},
			{ timeout: 10_000 },
		)

		await applyTheme(page, "custom-basic")
		// Apply field-type overrides BEFORE encodings so the chart-mode
		// picker sees the corrected types when fields get mapped. E.g.
		// for a tile heatmap we need Year to be categorical, not the
		// quantitative type the inferrer picks from 2021/2024.
		if (scenario.fieldTypeOverrides) {
			for (const [field, type] of Object.entries(scenario.fieldTypeOverrides)) {
				await setFieldType(page, field, type)
			}
		}
		// Set titles BEFORE encodings. LabelsPanel runs a useEffect that
		// auto-populates xAxisTitle / yAxisTitle from the mapped field
		// name when the title is empty. Playwright's `fill()` clears the
		// textarea before typing — during that brief empty state, the
		// auto-populate effect would overwrite the user's title with
		// the field name. Setting titles first means the auto-pop's
		// `!labels.xAxisTitle` guard is false when the encoding gets
		// assigned later, so our titles survive.
		await setTitle(page, "Title", scenario.titles.title)
		await setTitle(page, "Subtitle", scenario.titles.subtitle)
		await setTitle(page, "X-axis title", scenario.titles.xAxisTitle)
		await setTitle(page, "Y-axis title", scenario.titles.yAxisTitle)
		for (const { channel, field } of scenario.encodings) {
			await setEncoding(page, channel, field)
		}

		// Apply facet options AFTER encodings — the disclosure button
		// only renders once the Facet channel has a mapped field. Order
		// matters: expand first, then write to inputs / checkboxes.
		if (
			scenario.facetCols != null ||
			scenario.proportionalByCategoryCount != null ||
			scenario.facetGapX != null ||
			scenario.facetGapY != null ||
			scenario.shareX != null ||
			scenario.shareY != null
		) {
			await expandFacetOptions(page)
			if (scenario.facetCols != null) {
				await setFacetCols(page, scenario.facetCols)
			}
			if (scenario.facetGapX != null) {
				await setFacetGapX(page, scenario.facetGapX)
			}
			if (scenario.facetGapY != null) {
				await setFacetGapY(page, scenario.facetGapY)
			}
			if (scenario.shareX != null) {
				await setShareX(page, scenario.shareX)
			}
			if (scenario.shareY != null) {
				await setShareY(page, scenario.shareY)
			}
			if (scenario.proportionalByCategoryCount != null) {
				await setProportionalByCategoryCount(
					page,
					scenario.proportionalByCategoryCount,
				)
			}
		}

		// Let the chart re-render after the title typing + encoding
		// changes settle.
		await page.waitForTimeout(900)

		try {
			await page.screenshot({
				path: fullScreenshotPath,
				fullPage: false,
			})
		} catch (e) {
			record({
				issues: [
					{
						kind: "screenshot-failure",
						detail: e instanceof Error ? e.message : String(e),
					},
				],
			})
			return
		}

		const issues = await collectIssues(page, {
			checkPanelAlignment: scenario.checkPanelAlignment === true,
		})
		record({ issues })

		if (issues.length > 0) {
			console.warn(
				`[themed-encoded] ${scenario.name}: ${issues.length} issue(s)`,
				issues,
			)
		}
		expect(consoleErrors, "no console errors during render").toEqual([])
	})
}
