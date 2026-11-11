/** Everything the server says to a model up front: the instructions and
 *  every tool and parameter description, in one place so their size is
 *  counted together (surface.test.ts keeps the total under 8,000
 *  characters). The long-form guide in mcp/guide is documentation behind
 *  these rules; no tool or resource serves it. */

import { specVariationNames } from "../../src/contexts/chartBuilder/lib/chartSpec"

export const SERVER_INSTRUCTIONS = [
	"Zafiro makes charts from encodings: map each field to a channel and the chart follows. Channels: x, y, r, length, angle, area, saturation, hue (the editor's Color), outlineHue, brightness, opacity, shape, pattern, connection, facet, facetRow, facetCol.",
	"A first chart takes two calls with nothing read beforehand. Rows the person attached or pasted go to create_dataset (every row), then create_chart. A library data set the person names goes straight to create_chart by its name: one call.",
	"Start from the person's primary comparison, normally x and y. Each further comparison (across, among, within, by) adds one encoding. When none can be read, ask: \"What is the primary comparison you're trying to facilitate?\" Otherwise build a first version, then change that same chart. One chart per request.",
	"What encodings draw: x + length = vertical bars; y + length = horizontal bars (hue groups or stacks them); x + y = points (area for bubbles); x + y + connection = one line per level, and hue on the same field colors each line and its points; angle + hue = pie. Time goes on x; many categories go on y. A quantitative field takes length, then angle, then area; a categorical one takes hue, then pattern, then connection. Never override an encoding the person named.",
	"Refuse a bar axis that doesn't start at zero (offer points, a dumbbell, a lollipop or a line), dropped or nudged data, and a dual axis (offer two charts or a scatter).",
	"Chart exactly the rows the person gave, every one. Zafiro has no filter and does not aggregate; never store a summed or averaged table in their place. Before leaving rows or levels out, say so and offer a second data set without them or a gray color for them. A mean per level is a box plot with each level's mean marked (the mean mark shows with points hidden), never bars, which sum. Levels draw in the order they first appear. Reshaping wide data to a long copy that keeps every value is not aggregating; say so in one line.",
	"For a chart type Zafiro lacks (a 3D pie), say Zafiro has no chart by that name, offer the closest, and make nothing until they choose. Search list_settings before saying there is no setting. When a request could mean more than one thing, ask which. \"Flip the axes\" swaps the x and y fields with their axis settings and titles.",
	"When an edit or undo is refused because the chart changed elsewhere since it was read, tell the person it was changed (in the editor, a tab, or by someone) and ask what they want before trying again.",
	"Every chart gets a title and axis titles, in the person's words or from the field names, in sentence case, with a unit only when the person or the data states one. Set nothing else they didn't ask for; offer it instead. A setting asked for is set even when it won't show yet, and the reply says when it will. \"Undo\" after an undo is another undo. Reply in one line naming the titles as drafts, with at most three short offers.",
].join("\n\n")

const CHART_ID = "The chart's id."

export const TOOL_TEXT = {
	create_dataset: {
		description:
			"Store rows as a new data set; returns its id, row count and field types. Send every row the person gave, never a summary of them. Identical rows already stored under the same name are reused.",
		params: {
			name: "The data set's name, in the person's words.",
			rows: "Every row, as flat objects: column to text, number, boolean or null.",
			types: "Column to type, only to override what was inferred.",
		},
	},
	create_chart: {
		description:
			"Make a chart and return its links and revision. Only encodings is required. Name the data set, folder and theme by name or id. Nothing is saved when a problem comes back; each problem says what to change.",
		params: {
			dataset: "The data set's name or id.",
			folder: "A folder's name or id. Left out or null: the library root.",
			name: "The chart's name; the title when left out.",
			variation: `Only when the person names a chart type, one of: ${specVariationNames().join(", ")}.`,
			encodings: 'Required. Channel to field name, e.g. {"x":"Year","length":"Sales"}.',
			fieldTypes:
				"Field to type, only to override inference: categorical (names with no order), ordinal (ordered levels with no measurable distance), quantitative (measured numbers), temporal (dates and times).",
			title: "The chart title.",
			subtitle: "A subtitle.",
			axes: 'x and y, each {title, min, max, format}; min and max are dates on a time axis. A year axis takes format "d".',
			stack: '"stack", "group" or "overlay" for the hue levels.',
			themeId: "A theme's name or id. Left out: the default theme.",
			settings: "Stored settings by list_settings path, only for what was asked.",
		},
	},
	edit_chart: {
		description:
			'Change a chart: only the keys the patch names change. A null encoding removes that channel; a null axis bound clears it; themeId re-themes it, keeping the person\'s own picks; variation re-shapes it as that chart type, keeping titles, legend, labels and theme. Settings behave like the editor\'s panels (a palette id brings its colors, a new annotation gets the theme\'s style). Common ones: legendConfig.position "bottom"; dataLabelsEncodings.value.field set to the length field puts values on bars; legendConfig.hidden.hue true drops a legend that repeats an axis. A claim to prove becomes a comparison to show. If the chart changed elsewhere since it was read, the edit pauses and nothing is saved.',
		params: {
			id: CHART_ID,
			revision: "The revision this edit builds on, from the last result for this chart.",
			patch: "Any create_chart key except dataset and folder; an encoding set to null removes it.",
		},
	},
	undo_chart_edit: {
		description:
			"Undo the last edit_chart on this chart made in this session (up to 20 deep). Refused, with nothing saved, if the chart changed elsewhere since that edit.",
		params: { id: CHART_ID },
	},
	get_chart: {
		description:
			"A chart's encodings, titles, folder, data set, links, stored settings (with list entries' ids) and revision.",
		params: { id: CHART_ID },
	},
	list_charts: {
		description:
			"The library's charts. Nothing given: folder and chart counts and each folder by path. folder: its charts, newest first. dataset or query narrows across every folder, and each chart names its folder.",
		params: {
			folder: "A folder's name or id; null for charts in no folder.",
			dataset: "A data set's name or id.",
			query: "Words a chart's name must all hold, in any order and case.",
		},
	},
	list_datasets: {
		description: "The data sets on this server: id, name and row count.",
		params: {
			fields: "true adds each data set's fields with types and its latest version id.",
			query: "Keeps names containing this text, any case.",
		},
	},
	list_settings: {
		description:
			'Search the stored settings a settings patch can set, by path. * in a path is a key from the chart (a field, level or panel); [] is a list entry. A query that is a group path (channelConfigs.x) lists what is under it. A type "enum(N)" lists its values with descriptions true. With chartId each row shows the chart\'s current value. Objects merge; lists replace whole. Colors come from the theme\'s palettes; labels take a text palette; send a hex only when the person gives one. Recipes no variation names: a lollipop is a scatter with stems, channelConfigs.connection.axisStem "custom-y" (or "custom-x" when the value is on x) with axisStemCustomY (or axisStemCustomX) 0, so stems start at 0 though the axis need not; a histogram is x alone with channelConfigs.x.histogram.enabled true; a donut is a pie with channelConfigs.angle.donutHoleRadius; a choropleth or points on a map are the Choropleth, Bubble map and Dot map variations; chord and sankey flows are the Chord diagram and Sankey diagram variations; small multiples put a field on facet.',
		params: {
			query: 'Everyday words, e.g. "legend position".',
			offset: "Where a page starts: the last result's next.",
			chartId: "A chart whose current values each row shows.",
			descriptions: "true gives each setting's full description.",
		},
	},
} as const

export type ToolName = keyof typeof TOOL_TEXT
