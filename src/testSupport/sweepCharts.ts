/** The charts the browser sweeps and the panel matrix test build: one of
 *  every chart type, each with several encodings mapped at once. They are
 *  composed through `composeVisual` (lib/chartSpec.ts) — the same path the
 *  MCP server uses — so each is exactly the Visual the editor would save
 *  for those picks.
 *
 *  They are not meant to be good charts. They are meant to put as many
 *  parts on the canvas as the chart type can draw, so the options sweep has
 *  something for every control to act on. */

import type { SweepDatasetKey } from "./sweepDatasets"

export type SweepChart = {
	/** Slug used for file names and the report. */
	id: string
	/** Human label shown in the report. */
	label: string
	dataset: SweepDatasetKey
	/** Quick-start variation name (lib/quickStartVariations.ts). Absent = no
	 *  variation; the chart type follows from the encodings alone. */
	variation?: string
	/** Channel → field name. */
	encodings: Record<string, string>
	/** Stored settings applied last, nested by the paths of
	 *  `settingCatalog.json`. */
	settings?: Record<string, unknown>
}

export const SWEEP_CHARTS: readonly SweepChart[] = [
	// ---- bars -----------------------------------------------------------
	{
		id: "bars-grouped",
		label: "Vertical grouped bars",
		dataset: "sales",
		variation: "Vertical grouped bars",
		encodings: { x: "Product", length: "Sales", hue: "Region" },
	},
	{
		id: "bars-patterned",
		label: "Patterned stacked bars",
		dataset: "sales",
		variation: "Patterned stacked bars",
		encodings: { x: "Quarter", length: "Sales", hue: "Region", pattern: "Tier" },
	},
	{
		id: "bars-horizontal",
		label: "Horizontal stacked bars",
		dataset: "sales",
		variation: "Horizontal stacked bars",
		encodings: { y: "Product", length: "Units", hue: "Region", outlineHue: "Tier" },
	},
	{
		id: "histogram",
		label: "Histogram with rug and density",
		dataset: "people",
		encodings: { x: "Height" },
		settings: {
			channelConfigs: {
				x: { histogram: { enabled: true, showRug: true, showDensity: true, densityFill: true } },
			},
		},
	},
	// ---- combos ---------------------------------------------------------
	{
		id: "combo-line",
		label: "Bars and line",
		dataset: "sales",
		variation: "Bars and line",
		encodings: { x: "Quarter", length: "Sales", y: "Profit", connection: "Region", hue: "Region" },
	},
	{
		id: "combo-points",
		label: "Bars and points",
		dataset: "sales",
		variation: "Bars and points",
		encodings: { x: "Product", length: "Sales", y: "Units", hue: "Region" },
	},
	{
		id: "combo-horizontal",
		label: "Horizontal bars and line",
		dataset: "sales",
		variation: "Horizontal bars and line",
		encodings: { y: "Quarter", length: "Sales", x: "Profit", connection: "Region" },
	},
	// ---- scatter family -------------------------------------------------
	{
		id: "scatter-plain",
		label: "Scatter, nothing else mapped",
		dataset: "people",
		variation: "Scatter",
		encodings: { x: "Height", y: "Weight" },
	},
	{
		id: "scatter-multi",
		label: "Scatter with color, size, shape, opacity, outline",
		dataset: "people",
		variation: "Multi-encoded scatter",
		encodings: {
			x: "Height",
			y: "Weight",
			area: "Age",
			shape: "Sex",
			hue: "Group",
			opacity: "Score",
			outlineHue: "City",
		},
	},
	{
		id: "scatter-regression",
		label: "Scatter with regression line and band",
		dataset: "people",
		variation: "Scatter",
		encodings: { x: "Height", y: "Weight", hue: "Group" },
		settings: { channelConfigs: { x: { regression: { enabled: true, showCi: true } } } },
	},
	{
		id: "bubble",
		label: "Bubble",
		dataset: "people",
		variation: "Bubble",
		encodings: { x: "Height", y: "Weight", area: "Age", saturation: "Score" },
	},
	{
		id: "vector-field",
		label: "Vector field",
		dataset: "people",
		variation: "Vector field",
		encodings: { x: "Height", y: "Weight", length: "Age", angle: "Score" },
	},
	{
		id: "dumbbell",
		label: "Dumbbell",
		dataset: "sales",
		variation: "Dumbbell",
		encodings: { y: "Product", x: "Sales", hue: "Region", shape: "Tier", area: "Units" },
	},
	{
		id: "stems",
		label: "Points with stems to the axis",
		dataset: "trend",
		variation: "Scatter",
		encodings: { x: "Month", y: "Sales", hue: "Region" },
		settings: { channelConfigs: { connection: { axisStem: "x-axis" } } },
	},
	// ---- lines ----------------------------------------------------------
	{
		id: "line",
		label: "Line chart",
		dataset: "trend",
		variation: "Line chart",
		encodings: { x: "Month", y: "Sales", connection: "Region", hue: "Region" },
	},
	{
		id: "line-rich",
		label: "Line chart with dash, shape and size",
		dataset: "trend",
		variation: "Line chart",
		encodings: {
			x: "Month",
			y: "Sales",
			connection: "Region",
			hue: "Region",
			pattern: "Region",
			shape: "Half",
			area: "Units",
		},
	},
	{
		id: "line-temporal",
		label: "Line chart on a date axis",
		dataset: "trend",
		variation: "Line chart",
		encodings: { x: "Date", y: "Profit", connection: "Region" },
		// One line color for every series, and not black: saturation and
		// brightness cannot change a black line.
		settings: { channelConfigs: { colorSlots: { line: { field: null, singleColor: "#b45309" } } } },
	},
	{
		id: "line-horizontal",
		label: "Horizontal line chart",
		dataset: "trend",
		variation: "Horizontal line chart",
		encodings: { y: "Month", x: "Sales", connection: "Region", hue: "Region" },
	},
	// ---- areas ----------------------------------------------------------
	{
		id: "area-stacked",
		label: "Stacked area",
		dataset: "trend",
		variation: "Stacked area",
		encodings: { x: "Month", length: "Sales", connection: "Region" },
	},
	{
		id: "area-overlay",
		label: "Overlay area with pattern and sized points",
		dataset: "trend",
		variation: "Overlay area",
		encodings: {
			x: "Month",
			length: "Sales",
			connection: "Region",
			hue: "Region",
			pattern: "Region",
			area: "Units",
		},
	},
	{
		id: "area-unfilled",
		label: "Area chart drawn as lines",
		dataset: "trend",
		variation: "Stacked area",
		encodings: { x: "Month", length: "Sales", connection: "Region" },
		settings: { channelConfigs: { connection: { fill: "line" } } },
	},
	// ---- pies -----------------------------------------------------------
	{
		id: "pie-single",
		label: "Single pie",
		dataset: "sales",
		variation: "Single pie",
		encodings: { angle: "Sales", hue: "Region", pattern: "Tier" },
	},
	{
		id: "pie-x",
		label: "Pies across categories",
		dataset: "sales",
		variation: "Pie (categorical x)",
		encodings: { x: "Quarter", angle: "Sales", hue: "Region" },
	},
	{
		id: "pie-y",
		label: "Pies down categories",
		dataset: "sales",
		variation: "Pie (categorical y)",
		encodings: { y: "Region", angle: "Sales", hue: "Tier" },
	},
	// ---- radar ----------------------------------------------------------
	{
		id: "radar-polygon",
		label: "Radar polygon",
		dataset: "sales",
		variation: "Radar polygon",
		encodings: { angle: "Quarter", r: "Sales", connection: "Region", hue: "Region" },
	},
	{
		id: "radar-filled",
		label: "Filled radar with shape and size",
		dataset: "sales",
		variation: "Filled radar",
		encodings: {
			angle: "Quarter",
			r: "Sales",
			connection: "Region",
			hue: "Region",
			shape: "Tier",
			area: "Units",
		},
	},
	{
		id: "radar-dots",
		label: "Radar dots",
		dataset: "sales",
		variation: "Radar (dots)",
		encodings: { angle: "Quarter", r: "Sales", hue: "Region" },
	},
	// ---- distributions --------------------------------------------------
	{
		id: "violin",
		label: "Violin (vertical)",
		dataset: "people",
		variation: "Violin (vertical)",
		encodings: { x: "Group", y: "Height", hue: "Group" },
	},
	{
		id: "box",
		label: "Box plot (vertical)",
		dataset: "people",
		variation: "Box plot (vertical)",
		encodings: { x: "City", y: "Weight" },
	},
	{
		id: "violin-horizontal",
		label: "Violin (horizontal)",
		dataset: "people",
		variation: "Violin (horizontal)",
		encodings: { y: "Group", x: "Score", hue: "Sex" },
	},
	{
		id: "hexbin",
		label: "Hexbin",
		dataset: "people",
		variation: "Hexbin",
		encodings: { x: "Height", y: "Weight" },
	},
	{
		id: "density",
		label: "Density curve",
		dataset: "people",
		variation: "Density curve",
		encodings: { x: "Height" },
	},
	{
		id: "density-filled",
		label: "Filled density curve",
		dataset: "people",
		variation: "Filled density curve",
		encodings: { x: "Weight" },
	},
	// ---- heatmaps -------------------------------------------------------
	{
		id: "tile",
		label: "Tile heatmap",
		dataset: "matrix",
		variation: "Tile heatmap",
		encodings: { x: "Day", y: "Slot", hue: "Visits" },
	},
	{
		id: "tile-labels",
		label: "Tile heatmap with cell labels",
		dataset: "matrix",
		variation: "Tile heatmap with cell labels",
		encodings: { x: "Day", y: "Slot", hue: "Share" },
	},
	{
		id: "tile-categorical",
		label: "Categorical tile heatmap",
		dataset: "matrix",
		variation: "Categorical tile heatmap",
		encodings: { x: "Day", y: "Slot", hue: "Level" },
	},
	// ---- maps -----------------------------------------------------------
	{
		id: "choropleth",
		label: "Choropleth",
		dataset: "states",
		variation: "Choropleth",
		encodings: { hue: "rate" },
	},
	{
		id: "bubble-map",
		label: "Bubble map",
		dataset: "states",
		variation: "Bubble map",
		encodings: { area: "rate" },
	},
	{
		id: "dot-map",
		label: "Dot map",
		dataset: "cities",
		variation: "Dot map",
		encodings: { area: "pop" },
	},
	// ---- hierarchies ----------------------------------------------------
	{
		id: "packed-circles",
		label: "Packed circles",
		dataset: "tree",
		variation: "Packed circles",
		encodings: { area: "Size", connection: "Group" },
	},
	{
		id: "treemap",
		label: "Treemap",
		dataset: "tree",
		variation: "Treemap",
		encodings: { area: "Size", connection: "Group" },
	},
	{
		id: "sunburst",
		label: "Sunburst",
		dataset: "tree",
		variation: "Sunburst",
		encodings: { area: "Size", connection: "Group" },
	},
	// ---- flows ----------------------------------------------------------
	{
		id: "sankey",
		label: "Sankey diagram",
		dataset: "flows",
		variation: "Sankey diagram",
		encodings: { area: "Amount", connection: "Source" },
	},
	{
		id: "chord",
		label: "Chord diagram",
		dataset: "trade",
		variation: "Chord diagram",
		encodings: { area: "Volume", connection: "From" },
	},
]

/** Settings every sweep chart gets under its own: a colored, visibly thick
 *  outline. The theme's outline is white, and a white outline cannot show a
 *  saturation or brightness change (nor can a 1 px one show a dash), which
 *  would make working controls look inert. */
const SWEEP_DEFAULT_SETTINGS = {
	channelConfigs: { shape: { outlineColor: "#1d4ed8", outlineWidth: 2 } },
} as const

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const deepMerge = (
	base: Record<string, unknown>,
	over: Record<string, unknown>
): Record<string, unknown> => {
	const out: Record<string, unknown> = { ...base }
	for (const [key, value] of Object.entries(over)) {
		const prior = out[key]
		out[key] = isPlainObject(prior) && isPlainObject(value) ? deepMerge(prior, value) : value
	}
	return out
}

/** `chart` with the sweep-wide settings merged under its own. */
export const withSweepDefaults = (chart: SweepChart): SweepChart => ({
	...chart,
	settings: deepMerge(SWEEP_DEFAULT_SETTINGS, chart.settings ?? {}),
})
