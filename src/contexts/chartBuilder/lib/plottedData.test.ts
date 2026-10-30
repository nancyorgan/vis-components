import { hierarchy } from "d3-hierarchy"
import { describe, expect, it } from "vitest"

import { aggregateStacks } from "./aggregators/stacks"
import {
	buildHierarchyFromEdges,
	hierarchyLeafValue,
	hierarchyNodeRows,
} from "./buildHierarchy"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "./channelConfig"
import { getChartMode } from "./chartMode"
import { buildDataTable, dataTableToCsv } from "./dataTable"
import { resolveHexbinCells } from "./hexbins"
import { histogramBinningForAxis } from "./histogramBins"
import { plotsAggregates, plottedRows, type PlottedData } from "./plottedData"
import { emptyEncodings, type DatasetView, type Encodings, type FieldType } from "./types"

type Rows = Array<Record<string, string>>

const viewOf = (rows: Rows, types: Record<string, FieldType>): DatasetView => ({
	id: "ds",
	name: "t",
	filename: "t.csv",
	fields: Object.entries(types).map(([name, inferredType]) => ({ name, inferredType })),
	rows,
	createdAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

const enc = (map: Partial<Record<keyof Encodings, string>>): Encodings => {
	const out = emptyEncodings()
	for (const [ch, field] of Object.entries(map))
		out[ch as keyof Encodings] = { field: field ?? null }
	return out
}

/** Detect the mode exactly as `useChartModeDef` does (types + configs),
 *  then compute the plotted rows. */
const plotted = (
	rows: Rows,
	types: Record<string, FieldType>,
	encodings: Encodings,
	channelConfigs: ChannelConfigs = EMPTY_CHANNEL_CONFIGS,
	levelOrders: Record<string, string[]> = {}
) => {
	const getType = (f: string) => types[f] ?? "categorical"
	const mode = getChartMode(encodings, getType, channelConfigs)
	const view = viewOf(rows, types)
	return {
		mode,
		view,
		data: plottedRows({ view, encodings, mode, channelConfigs, getType, levelOrders }),
	}
}

const agg = (d: PlottedData) => {
	if (!d.aggregated) throw new Error("expected aggregated data")
	return { header: d.columns.map((c) => c.name), rows: d.rows, note: d.note }
}

const SALES: Rows = [
	{ region: "West", product: "A", sales: "10" },
	{ region: "West", product: "B", sales: "5" },
	{ region: "East", product: "A", sales: "3" },
	{ region: "West", product: "A", sales: "2.1" },
	{ region: "East", product: "B", sales: "0.2" },
	{ region: "East", product: "B", sales: "0.1" },
]
const SALES_TYPES: Record<string, FieldType> = {
	region: "categorical",
	product: "categorical",
	sales: "quantitative",
}

describe("plottedRows — bars", () => {
	it("sums the measure per bar, named with its aggregate", () => {
		const { mode, data } = plotted(SALES, SALES_TYPES, enc({ x: "region", length: "sales" }))
		expect(mode).toBe("bars-x")
		const t = agg(data)
		expect(t.header).toEqual(["region", "sales (sum)"])
		// Float noise cleaned (0.2 + 0.1 + 3).
		expect(t.rows).toEqual([
			["West", 17.1],
			["East", 3.3],
		])
		expect(t.note).toBe("Values are sums per bar; the underlying data has 6 rows.")
	})

	it("one row per stacked / grouped segment, color field as a column", () => {
		const t = agg(
			plotted(SALES, SALES_TYPES, enc({ y: "region", length: "sales", hue: "product" })).data
		)
		expect(t.header).toEqual(["region", "product", "sales (sum)"])
		expect(t.rows).toEqual([
			["West", "A", 12.1],
			["West", "B", 5],
			["East", "A", 3],
			["East", "B", 0.3],
		])
		expect(t.note).toContain("per bar segment")
	})

	it("a categorical length counts rows (Count column)", () => {
		const t = agg(
			plotted(SALES, SALES_TYPES, enc({ x: "region", length: "product", hue: "product" })).data
		)
		expect(t.header).toEqual(["region", "product", "Count"])
		expect(t.rows).toEqual([
			["West", "A", 2],
			["West", "B", 1],
			["East", "A", 1],
			["East", "B", 2],
		])
	})

	it("facets split the aggregation per panel; the facet column comes last", () => {
		const t = agg(
			plotted(SALES, SALES_TYPES, enc({ x: "product", length: "sales", facet: "region" })).data
		)
		expect(t.header).toEqual(["product", "sales (sum)", "region"])
		expect(t.rows).toEqual([
			["A", 12.1, "West"],
			["B", 5, "West"],
			["A", 3, "East"],
			["B", 0.3, "East"],
		])
	})

	it("negative lengths sum signed", () => {
		const rows: Rows = [
			{ k: "a", v: "-4" },
			{ k: "a", v: "1" },
			{ k: "b", v: "2" },
		]
		const t = agg(plotted(rows, { k: "categorical", v: "quantitative" }, enc({ x: "k", length: "v" })).data)
		expect(t.rows).toEqual([
			["a", -3],
			["b", 2],
		])
	})

	it("equals the renderer's aggregator on the same rows", () => {
		const { data } = plotted(SALES, SALES_TYPES, enc({ x: "region", length: "sales", hue: "product" }))
		const r = aggregateStacks({
			rows: SALES,
			categoryField: "region",
			lengthField: "sales",
			categoryType: "categorical",
			lengthType: "quantitative",
			groups: [{ channel: "hue", field: "product", type: "categorical" }],
		})
		if ("error" in r) throw new Error(r.error)
		const fromRenderer = r.stacks.flatMap((s) =>
			s.slices.map((sl) => [s.category, sl.groupValues.hue, sl.value])
		)
		const t = agg(data)
		expect(t.rows.map((row) => [row[0], row[1], row[2]])).toEqual(
			fromRenderer.map(([c, g, v]) => [c, g, Number((v as number).toPrecision(12))])
		)
	})
})

describe("plottedRows — histograms", () => {
	const scores: Rows = Array.from({ length: 20 }, (_, i) => ({ score: String(i + 1) }))
	const histCfg = (extra: Record<string, unknown> = {}): ChannelConfigs => ({
		...EMPTY_CHANNEL_CONFIGS,
		x: {
			...DEFAULT_AXIS_CONFIG,
			histogram: { enabled: true, binCount: 4, mode: "count", ...extra },
		} as ChannelConfigs["x"],
	})

	it("one row per bin (range text), Count per bin", () => {
		const { mode, data } = plotted(scores, { score: "quantitative" }, enc({ x: "score" }), histCfg())
		expect(mode).toBe("bars-x")
		const t = agg(data)
		expect(t.header).toEqual(["score (bin)", "Count"])
		const binning = histogramBinningForAxis(scores.map((r) => r.score), histCfg().x)
		expect(t.rows.map((r) => r[0])).toEqual(binning?.order)
		expect(t.rows.reduce((a, r) => a + (r[1] as number), 0)).toBe(20)
		expect(t.note).toBe("Row counts per bin; the underlying data has 20 rows.")
	})

	it("bin labels use the axis's tick format", () => {
		const cfg = histCfg()
		;(cfg.x as { customFormat?: string }).customFormat = ".1f"
		const t = agg(plotted(scores, { score: "quantitative" }, enc({ x: "score" }), cfg).data)
		expect(String(t.rows[0]?.[0])).toMatch(/^\d+\.0 – \d+\.0$/)
	})

	it("density mode reports shares, and colored histograms split per color", () => {
		const t = agg(
			plotted(scores, { score: "quantitative" }, enc({ x: "score" }), histCfg({ mode: "density" })).data
		)
		expect(t.header).toEqual(["score (bin)", "Share"])
		expect(t.rows.reduce((a, r) => a + (r[1] as number), 0)).toBeCloseTo(1)

		const colored = scores.map((r, i) => ({ ...r, g: i % 2 ? "odd" : "even" }))
		const c = agg(
			plotted(colored, { score: "quantitative", g: "categorical" }, enc({ x: "score", hue: "g" }), histCfg())
				.data
		)
		expect(c.header).toEqual(["score (bin)", "g", "Count"])
		expect(c.rows.reduce((a, r) => a + (r[2] as number), 0)).toBe(20)
	})
})

describe("plottedRows — pies", () => {
	it("one wedge per category with its sum and share", () => {
		const { mode, data } = plotted(SALES, SALES_TYPES, enc({ angle: "sales", hue: "region" }))
		expect(mode).toBe("pies")
		const t = agg(data)
		expect(t.header).toEqual(["region", "sales (sum)", "Share"])
		expect(t.rows).toEqual([
			["West", 17.1, 0.838235294118],
			["East", 3.3, 0.161764705882],
		])
	})

	it("pies-x keep the pie's category and share within each pie", () => {
		const t = agg(plotted(SALES, SALES_TYPES, enc({ x: "region", angle: "sales", hue: "product" })).data)
		expect(t.header).toEqual(["region", "product", "sales (sum)", "Share"])
		expect(t.rows[2]).toEqual(["East", "A", 3, 0.909090909091])
	})
})

describe("plottedRows — areas", () => {
	it("sums per point of each layer", () => {
		const rows: Rows = [
			{ t: "1", g: "a", v: "1" },
			{ t: "1", g: "a", v: "2" },
			{ t: "2", g: "a", v: "4" },
			{ t: "1", g: "b", v: "5" },
		]
		const { mode, data } = plotted(
			rows,
			{ t: "quantitative", g: "categorical", v: "quantitative" },
			enc({ x: "t", length: "v", hue: "g", connection: "g" })
		)
		expect(mode).toBe("areas-x")
		const t = agg(data)
		expect(t.header).toEqual(["t", "g", "v (sum)"])
		expect(t.rows).toEqual([
			["1", "a", 3],
			["1", "b", 5],
			["2", "a", 4],
		])
	})
})

describe("plottedRows — heatmap tiles", () => {
	it("one row per tile: x, y, count and the mean of a quantitative color", () => {
		const rows: Rows = [
			{ day: "Mon", hour: "9", temp: "10" },
			{ day: "Mon", hour: "9", temp: "20" },
			{ day: "Tue", hour: "9", temp: "5" },
			{ day: "Mon", hour: "10", temp: "" },
		]
		const { mode, data } = plotted(
			rows,
			{ day: "categorical", hour: "ordinal", temp: "quantitative" },
			enc({ x: "day", y: "hour", hue: "temp" })
		)
		expect(mode).toBe("tile")
		const t = agg(data)
		expect(t.header).toEqual(["day", "hour", "Count", "temp (mean)"])
		expect(t.rows).toEqual([
			["Mon", "9", 2, 15],
			["Mon", "10", 1, null],
			["Tue", "9", 1, 5],
		])
	})
})

describe("plottedRows — hexbins", () => {
	it("counts per hexagon at the hexagon's data-space center", () => {
		const rows: Rows = Array.from({ length: 30 }, (_, i) => ({
			a: String(i % 5),
			b: String(Math.floor(i / 5)),
		}))
		const encodings = enc({ x: "a", y: "b" })
		encodings.hue = { field: null, measureSource: "hexCount" } as Encodings["hue"]
		const cfg: ChannelConfigs = { ...EMPTY_CHANNEL_CONFIGS, hexbin: { binCount: 4 } } as ChannelConfigs
		const { mode, data } = plotted(rows, { a: "quantitative", b: "quantitative" }, encodings, cfg)
		expect(mode).toBe("hexbin")
		const t = agg(data)
		expect(t.header).toEqual(["a (hexagon center)", "b (hexagon center)", "Count"])
		const hex = resolveHexbinCells(
			rows.map((r) => r.a),
			rows.map((r) => r.b),
			4
		)
		expect(t.rows).toHaveLength(hex?.cells.length ?? -1)
		expect(t.rows.reduce((s, r) => s + (r[2] as number), 0)).toBe(30)
		// Centers are the renderer's lattice centers mapped back to data
		// units (edge hexagons may center just past the domain).
		const [x0, x1] = hex?.xDomain ?? [0, 1]
		const expected = (hex?.cells ?? []).map((c) => x0 + c.cx * (x1 - x0)).sort((a, b) => a - b)
		// Rounded to the lattice's resolution (2 decimals at this step).
		t.rows.forEach((r, i) => expect(r[0]).toBeCloseTo(expected[i] ?? NaN, 2))
		expect(t.rows.every((r) => String(r[0]).replace(/^-?\d*\.?/, "").length <= 2)).toBe(true)
	})
})

describe("plottedRows — box / violin", () => {
	const rows: Rows = [
		...["1", "2", "3", "4", "100"].map((v) => ({ g: "a", v })),
		...["10", "20"].map((v) => ({ g: "b", v })),
	]
	const boxCfg = (on: Partial<typeof DEFAULT_DISTRIBUTION_OVERLAY_CONFIG>): ChannelConfigs => ({
		...EMPTY_CHANNEL_CONFIGS,
		y: {
			...DEFAULT_AXIS_CONFIG,
			distributionOverlay: { ...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG, ...on },
		},
	})

	it("five-number summary + Tukey whiskers + N per group", () => {
		const { mode, data } = plotted(
			rows,
			{ g: "categorical", v: "quantitative" },
			enc({ x: "g", y: "v" }),
			boxCfg({ showBoxPlot: true })
		)
		expect(mode).toBe("scatter")
		const t = agg(data)
		expect(t.header).toEqual([
			"g",
			"Min",
			"Lower whisker",
			"Q1",
			"Median",
			"Q3",
			"Upper whisker",
			"Max",
			"N",
		])
		// 100 is an outlier: the drawn upper whisker stops at 4.
		expect(t.rows[0]).toEqual(["a", 1, 1, 2, 3, 4, 4, 100, 5])
		expect(t.rows[1]).toEqual(["b", 10, 10, 12.5, 15, 17.5, 20, 20, 2])
		expect(t.note).toContain("1.5 × the interquartile range")
	})

	it("violins report the same statistics; a lone density curve keeps rows with a note", () => {
		expect(
			agg(
				plotted(rows, { g: "categorical", v: "quantitative" }, enc({ x: "g", y: "v" }), boxCfg({ showDensityViolin: true }))
					.data
			).rows
		).toHaveLength(2)
		const curve = plotted(rows, { v: "quantitative" }, enc({ y: "v" }), boxCfg({ showDensityCurve: true })).data
		expect(curve).toEqual({ aggregated: false, note: "The density curve is computed from these rows." })
	})
})

describe("plottedRows — trees", () => {
	const rows: Rows = [
		{ parent: "Fruit", child: "Citrus", value: "" },
		{ parent: "Citrus", child: "Lemon", value: "8" },
		{ parent: "Citrus", child: "Lime", value: "2" },
		{ parent: "Fruit", child: "Apple", value: "5" },
	]
	const types: Record<string, FieldType> = {
		parent: "categorical",
		child: "categorical",
		value: "quantitative",
	}

	it("one row per node, levels as columns, a container summing its leaves", () => {
		const cfg = {
			...EMPTY_CHANNEL_CONFIGS,
			connection: { hierarchyLayout: "treemap" },
		} as ChannelConfigs
		const { mode, data } = plotted(rows, types, enc({ connection: "parent", area: "value" }), cfg)
		expect(mode).toBe("treemap")
		const t = agg(data)
		expect(t.header).toEqual(["Level 1", "Level 2", "Level 3", "value (sum)"])
		expect(t.rows).toEqual([
			["Fruit", "", "", 15],
			["Fruit", "Citrus", "", 10],
			["Fruit", "Citrus", "Lemon", 8],
			["Fruit", "Citrus", "Lime", 2],
			["Fruit", "Apple", "", 5],
		])
	})

	it("tabulates more nodes than a call takes arguments", () => {
		const cfg = {
			...EMPTY_CHANNEL_CONFIGS,
			connection: { hierarchyLayout: "treemap" },
		} as ChannelConfigs
		const many = Array.from({ length: 150_000 }, (_, i) => ({
			parent: "Root",
			child: `c${i}`,
			value: "1",
		}))
		const t = agg(plotted(many, types, enc({ connection: "parent", area: "value" }), cfg).data)
		expect(t.header).toEqual(["Level 1", "Level 2", "value (sum)"])
	})

	it("node totals equal d3's hierarchy sums (what the layouts draw)", () => {
		const { root } = buildHierarchyFromEdges(rows, {
			parentField: "parent",
			idField: "child",
			valueField: "value",
		})
		const d3Totals = hierarchy(root)
			.sum(hierarchyLeafValue)
			.descendants()
			.filter((n) => n.depth > 0)
			.map((n) => [n.data.key, n.value])
		const ours = hierarchyNodeRows(root).map((n) => [n.node.key, n.total])
		const byKey = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]))
		expect(ours.sort(byKey)).toEqual(d3Totals.sort(byKey))
	})
})

describe("plottedRows — flows", () => {
	const rows: Rows = [
		{ from: "A", to: "B", n: "3" },
		{ from: "A", to: "B", n: "2" },
		{ from: "B", to: "C", n: "1" },
		{ from: "C", to: "A", n: "0.5" },
	]
	const types: Record<string, FieldType> = { from: "categorical", to: "categorical", n: "quantitative" }
	const cfg = (layout: string) =>
		({
			...EMPTY_CHANNEL_CONFIGS,
			connection: { hierarchyLayout: layout, flowTargetField: "to" },
		}) as ChannelConfigs

	it("chord: one row per link with its summed value", () => {
		const { mode, data } = plotted(rows, types, enc({ connection: "from", area: "n" }), cfg("chord"))
		expect(mode).toBe("chord")
		const t = agg(data)
		expect(t.header).toEqual(["from", "to", "n (sum)"])
		expect(t.rows).toEqual([
			["A", "B", 5],
			["B", "C", 1],
			["C", "A", 0.5],
		])
	})

	it("sankey: only the links it can draw (the smallest cycle-closing link drops)", () => {
		const { mode, data } = plotted(rows, types, enc({ connection: "from", area: "n" }), cfg("sankey"))
		expect(mode).toBe("sankey")
		expect(agg(data).rows).toEqual([
			["A", "B", 5],
			["B", "C", 1],
		])
	})
})

describe("plottedRows — raw-row modes", () => {
	it("scatter, lines and dumbbells list the rows", () => {
		expect(plotted(SALES, SALES_TYPES, enc({ x: "region", y: "sales" })).data).toEqual({
			aggregated: false,
			note: null,
		})
	})

	it("a regression line keeps the rows and says the line is computed from them", () => {
		const cfg = {
			...EMPTY_CHANNEL_CONFIGS,
			x: { ...DEFAULT_AXIS_CONFIG, regression: { enabled: true } },
		} as ChannelConfigs
		const rows: Rows = [{ a: "1", b: "2" }]
		expect(
			plotted(rows, { a: "quantitative", b: "quantitative" }, enc({ x: "a", y: "b" }), cfg).data
		).toEqual({ aggregated: false, note: "The regression line is computed from these rows." })
	})
})

describe("plotsAggregates", () => {
	it("is true for the aggregating modes only", () => {
		const getType = (f: string) => SALES_TYPES[f] ?? "categorical"
		const base = { channelConfigs: EMPTY_CHANNEL_CONFIGS, getType }
		expect(plotsAggregates({ ...base, mode: "bars-x", encodings: enc({}) })).toBe(true)
		expect(plotsAggregates({ ...base, mode: "sankey", encodings: enc({}) })).toBe(true)
		expect(plotsAggregates({ ...base, mode: "scatter", encodings: enc({ x: "region", y: "sales" }) })).toBe(
			false
		)
		expect(plotsAggregates({ ...base, mode: "radar", encodings: enc({}) })).toBe(false)
	})
})

describe("buildDataTable with plotted rows", () => {
	it("formats aggregate columns with the measure's format, Count as an integer, Share as a percent; CSV follows", () => {
		const { view, data } = plotted(SALES, SALES_TYPES, enc({ angle: "sales", hue: "region" }))
		const model = buildDataTable({
			view,
			encodings: enc({ angle: "sales", hue: "region" }),
			columns: "all",
			overrides: {},
			fieldLevelOrders: {},
			formats: new Map([["sales", "$,.2f"]]),
			plotted: data,
		})
		expect(model.columns.map((c) => c.name)).toEqual(["region", "sales (sum)", "Share"])
		expect(model.rows[0]?.cells.map((c) => c.text)).toEqual(["West", "$17.10", "83.8%"])
		expect(model.note).toContain("per wedge")
		expect(dataTableToCsv(model).split("\n")).toEqual([
			"region,sales (sum),Share",
			"West,17.1,0.838235294118",
			"East,3.3,0.161764705882",
		])

		const counts = plotted(SALES, SALES_TYPES, enc({ x: "region", length: "product", hue: "product" }))
		const countModel = buildDataTable({
			view: counts.view,
			encodings: enc({}),
			columns: "encoded",
			overrides: {},
			fieldLevelOrders: {},
			formats: new Map(),
			plotted: counts.data,
		})
		expect(countModel.columns[2]?.numeric).toBe(true)
		expect(countModel.rows[0]?.cells[2]?.text).toBe("2")
	})
})
