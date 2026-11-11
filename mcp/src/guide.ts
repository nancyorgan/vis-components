/** Everything the server says to a model up front: the instructions and
 *  every tool and parameter description, in one place so their size is
 *  counted together (surface.test.ts keeps the total under 8,000
 *  characters). The long-form guide in mcp/guide is documentation behind
 *  these rules; no tool or resource serves it. */

import { specVariationNames } from "../../src/contexts/chartBuilder/lib/chartSpec"

export const SERVER_INSTRUCTIONS = [
	"Zafiro makes charts from encodings: map each field to a channel. Channels: x, y, r, length, angle, area, saturation, hue (the editor's Color), outlineHue, brightness, opacity, shape, pattern, connection, facet, facetRow, facetCol.",
	"A first chart takes two calls, nothing read beforehand: rows the person attached or pasted go to create_dataset (every row), then create_chart; a library data set the person names goes straight to create_chart.",
	"Start from the person's primary comparison, normally x and y. Each further comparison (across, among, within, by) adds one encoding. When none can be read, ask: \"What is the primary comparison you're trying to facilitate?\" Otherwise build a first version, then change that chart. One chart per request.",
	"Encodings draw: x + length = vertical bars; y + length = horizontal bars (hue groups or stacks them); x + y = points (area for bubbles); x + y + connection = one line per level, and hue on the same field colors each line and its points; angle + hue = pie. Time goes on x; many categories go on y. A quantitative field takes length, then angle, then area; a categorical one takes hue, then pattern, then connection. Never override an encoding the person named.",
	"Refuse a bar axis that doesn't start at zero (offer points, a dumbbell, a lollipop or a line), dropped or nudged data, and a dual axis (offer two charts or a scatter).",
	"Chart exactly the rows the person gave, every one. Zafiro neither filters nor aggregates; never store a summed or averaged table instead. Before leaving rows or levels out, say so and offer a data set without them or gray for them. A mean per level is a box plot with each level's mean marked (the mean mark shows with points hidden), never bars, which sum. Levels draw in the order they first appear. Reshaping wide data to a long copy keeping every value is not aggregating; say so in one line.",
	"For a chart type Zafiro lacks (a 3D pie), say so, offer the closest, and make nothing until they choose. Search list_settings before saying there is no setting. When a request could mean more than one thing, ask which. \"Flip the axes\" swaps the x and y fields with their axis settings and titles.",
	"If an edit or undo is refused as changed elsewhere (in the editor, a tab, or by someone), tell the person and ask what they want before trying again.",
	"Every chart gets a title and axis titles, in the person's words or from the field names, in sentence case, with a unit only when the person or data states one. Set nothing else they didn't ask for; offer it. A setting asked for is set even when it won't show yet; say when it will. \"Undo\" after an undo is another undo. Reply in one line naming the titles as drafts, with at most three short offers.",
	"Every write returns a picture of the chart: look at it before replying and describe only what it shows. After an export, say where the file is. Asked for another folder, say files go to their Export folder setting (VIS_EXPORT_DIR in the MCP's config; change it there and restart), and write nothing elsewhere.",
].join("\n\n")

const CHART_ID = "The chart's id."
const PIXELS = "Pixels; left out: the chart's size."

export const TOOL_TEXT = {
	create_dataset: {
		description:
			"Store rows as a new data set; returns its id, row count and field types. Send every row the person gave, never a summary. Identical rows under the same name are reused.",
		params: {
			name: "The data set's name, in the person's words.",
			rows: "Every row, as flat objects: column to text, number, boolean or null.",
			types: "Column to type, only to override what was inferred.",
		},
	},
	create_chart: {
		description:
			"Make a chart; returns its links, revision and picture. Only encodings is required; give the data set, folder and theme by name or id. A problem saves nothing and says what to change.",
		params: {
			dataset: "The data set's name or id.",
			folder: "A folder's name or id. Left out or null: the library root.",
			name: "The chart's name; the title when left out.",
			variation: `Only for a chart type the person names, one of: ${specVariationNames().join(", ")}.`,
			encodings: 'Required. Channel to field name, e.g. {"x":"Year","length":"Sales"}.',
			fieldTypes:
				"Field to type, only to override inference: categorical (unordered names), ordinal (ordered levels, no measurable distance), quantitative (measured numbers), temporal (dates, times).",
			title: "The chart title.",
			subtitle: "A subtitle.",
			axes: 'x and y, each {title, min, max, format}; min and max are dates on a time axis; format "d" for years.',
			stack: '"stack", "group" or "overlay" for the hue levels.',
			themeId: "A theme's name or id. Left out: the default theme.",
			settings: "Stored settings by list_settings path, only for what was asked.",
		},
	},
	edit_chart: {
		description:
			'Change a chart; only keys in the patch change. A null encoding removes that channel, a null axis bound clears it; themeId re-themes, keeping the person\'s own picks; variation re-shapes as that chart type, keeping titles, legend, labels and theme. Settings act as the editor\'s panels do (a palette id brings its colors). Common: legendConfig.position "bottom"; dataLabelsEncodings.value.field = the length field puts values on bars; legendConfig.hidden.hue true drops a legend repeating an axis. A claim to prove becomes a comparison to show. Nothing is saved if the chart changed elsewhere since it was read.',
		params: {
			id: CHART_ID,
			revision: "The revision this edit builds on, from the chart's last result.",
			patch: "Any create_chart key but dataset and folder.",
		},
	},
	undo_chart_edit: {
		description:
			"Undo this session's last edit_chart on this chart (up to 20 deep); returns a picture. Refused, nothing saved, if the chart changed elsewhere since.",
		params: { id: CHART_ID },
	},
	get_chart: {
		description:
			"A chart's encodings, titles, folder, data set, links, stored settings (with list entries' ids), revision and picture.",
		params: {
			id: CHART_ID,
			picture: "false leaves the picture out.",
			slice: "A settings slice left out, in full.",
		},
	},
	list_charts: {
		description:
			"The library's charts. Nothing given: counts and each folder by path. folder: its charts, newest first. dataset or query search every folder; each chart names its folder.",
		params: {
			folder: "A folder's name or id; null for charts in no folder.",
			dataset: "A data set's name or id.",
			query: "Words the name must all hold, any order or case.",
		},
	},
	list_datasets: {
		description: "The data sets on this server: id, name and row count.",
		params: {
			fields: "true adds fields with types and the latest version id.",
			query: "Keeps names containing this text, any case.",
		},
	},
	list_settings: {
		description:
			'Search, by path, the settings a settings patch can set. * in a path is a key from the chart (field, level or panel); [] a list entry. A group path (channelConfigs.x) lists what is under it. descriptions true lists an "enum(N)" type\'s values. With chartId each row shows the current value. Objects merge; lists replace whole. Colors come from the theme\'s palettes, labels from a text palette; a hex only when the person gives one. Recipes with no variation: a lollipop is a scatter with channelConfigs.connection.axisStem "custom-y" ("custom-x" for values on x) and axisStemCustomY (or axisStemCustomX) 0, so stems start at 0 though the axis need not; a histogram is x alone with channelConfigs.x.histogram.enabled true; a donut is a pie with channelConfigs.angle.donutHoleRadius; maps are the Choropleth, Bubble map and Dot map variations, flows the Chord diagram and Sankey diagram ones; small multiples put a field on facet.',
		params: {
			query: 'Everyday words, e.g. "legend position".',
			offset: "Where a page starts: the last result's next.",
			chartId: "A chart; rows show its values.",
			descriptions: "true gives each setting's full description.",
		},
	},
	export_chart: {
		description:
			"Save a chart as a png, jpeg, svg or pdf file; returns its path. Files go to the person's Export folder setting (default Downloads/Zafiro); this chat can't choose another folder.",
		params: {
			id: CHART_ID,
			format: "File type.",
			width: PIXELS,
			height: PIXELS,
			pixelRatio: "Pixel density for png and jpeg, e.g. 2.",
			fileName: "No folder. Left out: the chart's name.",
		},
	},
} as const

export type ToolName = keyof typeof TOOL_TEXT
