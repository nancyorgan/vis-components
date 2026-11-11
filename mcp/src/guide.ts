/** Everything the server says to a model up front: the instructions and
 *  every tool and parameter description, in one place so their size is
 *  counted together (surface.test.ts keeps the total under 8,000
 *  characters). The long-form guide in mcp/guide is documentation behind
 *  these rules; no tool or resource serves it. */

import { specVariationNames } from "../../src/contexts/chartBuilder/lib/chartSpec"

export const SERVER_INSTRUCTIONS = [
	"Zafiro charts map each field to a channel. Channels: x, y, r, length, angle, area, saturation, hue (the editor's Color), outlineHue, brightness, opacity, shape, pattern, connection, facet, facetRow, facetCol.",
	"A first chart takes two calls, nothing read beforehand: create_dataset, then create_chart; a library data set the person names goes straight to create_chart. Data the person attached or pasted goes to create_dataset in full as csv with expectedRows (its data rows), never a sample; never refuse to send it. For a file on this computer not in the chat, ask its full path (or offer the editor's upload) and send path. Never chart fewer rows than the file has. Data saved for later: one data set, no chart.",
	"Start from the person's primary comparison, normally x and y. Each further comparison (across, among, within, by) adds one encoding. When none can be read, ask: \"What is the primary comparison you're trying to facilitate?\" Otherwise build a first version, then change that chart. One chart per request.",
	"Encodings draw: x + length = vertical bars; y + length = horizontal bars (hue groups or stacks them); x + y = points (area for bubbles); x + y + connection = one line per level, and hue on the same field colors each line and its points; angle + hue = pie. Time goes on x; many categories go on y. A quantitative field takes length, then angle, then area; a categorical one takes hue, then pattern, then connection. Never override an encoding the person named.",
	"Refuse a bar axis that doesn't start at zero (offer points, a dumbbell, a lollipop or a line), dropped or nudged data, and a dual axis (offer two charts or a scatter).",
	"Chart exactly the rows the person gave, every one. Zafiro neither filters nor aggregates; never store a summed or averaged table. Before leaving rows or levels out, say so and offer a data set without them or gray for them. A mean per level is a box plot with each level's mean marked (the mean mark shows with points hidden), never bars, which sum. Levels draw in the order they first appear. Reshaping wide data to a long copy keeping every value is not aggregating; say so in one line.",
	"For a chart type Zafiro lacks (a 3D pie), say so, offer the closest, and make nothing until they choose. Search list_settings before saying there is no setting. When a request could mean more than one thing, ask which. \"Flip the axes\" swaps the x and y fields with their axis settings and titles.",
	"When an edit or undo pauses because someone changed the same setting, tell the person each change and its choices (keep theirs, go ahead, leave it, or a combined value) and do what they pick.",
	"Every chart gets a title and axis titles, in the person's words or from the field names, in sentence case, with a unit only when the person or data states one. Set nothing else they didn't ask for; offer it. A setting asked for is set even when it won't show yet; say when it will. \"Undo\" after an undo is another undo. Reply in one line naming the titles as drafts, with at most three short offers.",
	"Every write returns a picture of the chart: look at it before replying and describe only what it shows. After an export, say where the file is. Asked for another folder, say files go to their Export folder setting (VIS_EXPORT_DIR in the MCP's config; change it there and restart), and write nothing elsewhere.",
].join("\n\n")

const CHART_ID = "The chart's id."
const PIXELS = "Pixels; left out: the chart's size."
const KEEP_THEIRS = "After a pause: keep their changes."

export const TOOL_TEXT = {
	create_dataset: {
		description:
			"Store data; returns its id, row count and field types. Give exactly one of rows, csv or path.",
		params: {
			name: "In the person's words; with path, left out: the file's name.",
			rows: "Flat objects: column to text, number, boolean or null.",
			csv: "The whole data as CSV text, header first.",
			path: "Full path to a .csv, .tsv or .txt file here, up to 100 MB.",
			expectedRows: "Data rows, header not counted; a mismatch stores nothing.",
			types: "Column to type, only to override inference.",
		},
	},
	create_chart: {
		description:
			"Make a chart; returns its links, revision and picture. Give the data set, folder and theme by name or id. A problem saves nothing and says what to change.",
		params: {
			dataset: "The data set's name or id.",
			folder: "A folder's name or id; null: the library root.",
			name: "The chart's name; left out: the title.",
			variation: `Only for a chart type the person names, one of: ${specVariationNames().join(", ")}.`,
			encodings: 'Required. Channel to field name, e.g. {"x":"Year","length":"Sales"}.',
			fieldTypes:
				"Only to override inference: categorical (unordered names), ordinal (ordered, no measured distance), quantitative (measured numbers), temporal (dates, times).",
			title: "The chart title.",
			subtitle: "A subtitle.",
			axes: 'x and y, each {title, min, max, format}; min and max are dates on a time axis; format "d" for years.',
			stack: "How the hue levels draw.",
			themeId: "A theme's name or id.",
			settings: "Settings by list_settings path, only what was asked.",
		},
	},
	edit_chart: {
		description:
			'Change a chart; only keys in the patch change. A null encoding removes that channel, a null axis bound clears it; themeId re-themes, keeping the person\'s own picks; variation re-shapes as that chart type, keeping titles, legend, labels and theme. Settings act as the editor\'s panels do (a palette id brings its colors). Common: legendConfig.position "bottom"; dataLabelsEncodings.value.field = the length field puts values on bars; legendConfig.hidden.hue true drops a legend repeating an axis. A claim to prove becomes a comparison to show. A change someone else made to the same setting pauses the edit and lists the choices.',
		params: {
			id: CHART_ID,
			revision: "Judged against this revision; left out: as you last saw it.",
			keepTheirs: KEEP_THEIRS,
			patch: "Any create_chart key but dataset and folder.",
		},
	},
	undo_chart_edit: {
		description:
			"Steps back edits made through this MCP on this computer, kept across restarts; returns a picture. Restores only the edit's own settings; one changed since pauses.",
		params: {
			id: CHART_ID,
			revision: "From a pause: undo over their change.",
			keepTheirs: KEEP_THEIRS,
		},
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
			"The library's charts. Nothing given: counts and each folder by path. folder: its charts, newest first. dataset or query search every folder.",
		params: {
			folder: "A folder's name or id; null for charts in no folder.",
			dataset: "A data set's name or id.",
			query: "Words the name must all hold, any order or case.",
		},
	},
	list_datasets: {
		description: "Data sets on this server: id, name, row count.",
		params: {
			fields: "true adds fields with types and the latest version id.",
			query: "Keeps names containing this text, any case.",
		},
	},
	list_settings: {
		description:
			'Search the settings a patch can set, by path. * in a path is a key from the chart (field, level or panel); [] a list entry. Objects merge; lists replace whole. Colors come from theme palettes, labels from a text palette; a hex only when the person gives one. Recipes: a lollipop is a scatter with channelConfigs.connection.axisStem "custom-y" (or "custom-x") and axisStemCustomY (or X) 0, so stems start at 0 though the axis need not; a histogram is x alone with channelConfigs.x.histogram.enabled true; a donut is a pie with channelConfigs.angle.donutHoleRadius; maps and flows are variations; small multiples put a field on facet.',
		params: {
			query: 'Everyday words, e.g. "legend position".',
			offset: "Where a page starts: a result's next.",
			chartId: "A chart; rows show its current values.",
			descriptions: 'true gives full descriptions and an "enum(N)" type\'s values.',
		},
	},
	export_chart: {
		description:
			"Save a chart as a file; returns its path. Files go to the person's Export folder setting (default Downloads/Zafiro); this chat can't choose another folder.",
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
