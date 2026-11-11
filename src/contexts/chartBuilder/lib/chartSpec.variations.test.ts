import { describe, expect, it } from "vitest"

import {
	composeVisual,
	editVisual,
	specReadsRows,
	specVariationNames,
	type ChartSpec,
	type ComposeDeps,
} from "./chartSpec"
import { QUICK_START_CHART_TYPES, QUICK_START_VARIATIONS } from "./quickStartVariations"
import { LIGHT_THEME_BASE } from "./systemThemes"
import type { Visual } from "./types"

const STATES = ["California", "Texas", "New York", "Florida", "Ohio", "Georgia"]

/** A data set with every kind of column the map and flow variations read. */
const rows = STATES.map((state, i) => ({
	State: state,
	fips: ["06037", "48201", "36061", "12086", "39035", "13121"][i] ?? "",
	Fruit: ["apple", "pear", "plum", "fig", "kiwi", "lime"][i] ?? "",
	lat: String(34 + i),
	lon: String(-118 + i * 5),
	source: ["Coal", "Gas", "Coal", "Solar", "Gas", "Wind"][i] ?? "",
	target: ["Homes", "Industry", "Industry", "Homes", "Homes", "Industry"][i] ?? "",
	value: String(10 + i),
	segment: i % 2 === 0 ? "A" : "B",
	sales: String(100 + i * 7),
	profit: String(5 + i),
}))

const deps: ComposeDeps = {
	theme: LIGHT_THEME_BASE,
	fields: [
		{ name: "State", type: "categorical" },
		{ name: "fips", type: "categorical" },
		{ name: "Fruit", type: "categorical" },
		{ name: "lat", type: "quantitative" },
		{ name: "lon", type: "quantitative" },
		{ name: "source", type: "categorical" },
		{ name: "target", type: "categorical" },
		{ name: "value", type: "quantitative" },
		{ name: "segment", type: "categorical" },
		{ name: "sales", type: "quantitative" },
		{ name: "profit", type: "quantitative" },
	],
	rows,
	now: 1000,
}

const spec = (over: Partial<ChartSpec>): ChartSpec => ({
	datasetId: "ds-1",
	folderId: null,
	encodings: {},
	...over,
})

const ok = (s: Partial<ChartSpec>, d: ComposeDeps = deps): Visual => {
	const { visual, problems } = composeVisual(spec(s), d)
	expect(problems).toEqual([])
	return visual
}

describe("map variations", () => {
	it("makes a state choropleth: the region column found from its values, the value on hue", () => {
		const { visual: v, problems, warnings } = composeVisual(
			spec({ variation: "Choropleth", encodings: { hue: "value" } }),
			deps
		)
		expect(problems).toEqual([])
		expect(v.encodings.connection).toEqual({ field: "State" })
		expect(v.encodings.hue).toEqual({ field: "value" })
		expect(v.channelConfigs.hue?.kind).toBe("quantitative")
		expect(v.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "states" })
		expect(warnings.join(" ")).toMatch(/"State", the region column/)
	})

	it("makes a county choropleth from a named county-FIPS column", () => {
		const v = ok({ family: "map", variation: "Choropleth", encodings: { connection: "fips", hue: "value" } })
		expect(v.encodings.connection).toEqual({ field: "fips" })
		expect(v.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "counties" })
	})

	it("makes a bubble map and a dot map", () => {
		const bubble = ok({ variation: "Bubble map", encodings: { connection: "State", area: "value" } })
		expect(bubble.encodings.area).toEqual({ field: "value" })
		expect(bubble.mapConfig?.coordSystem).toBe("geographic")
		const dots = ok({ variation: "Dot map", encodings: {} })
		expect(dots.encodings.x).toEqual({ field: "lon" })
		expect(dots.encodings.y).toEqual({ field: "lat" })
		expect(dots.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "states" })
	})

	it("picks the map variation the encodings make when only the family is named", () => {
		expect(ok({ family: "map", encodings: { connection: "State", area: "value" } }).encodings.area).toEqual({
			field: "value",
		})
		expect(ok({ family: "map", encodings: { x: "lon", y: "lat" } }).mapConfig?.coordSystem).toBe("geographic")
	})

	it("refuses a region column whose values name no geography, saying what it expected", () => {
		const { problems } = composeVisual(
			spec({ variation: "Choropleth", encodings: { connection: "Fruit", hue: "value" } }),
			deps
		)
		expect(problems).toHaveLength(1)
		expect(problems[0]?.path).toBe("encodings.connection")
		expect(problems[0]?.message).toMatch(/state names.*county FIPS.*ZCTA/s)
		const noRegion = composeVisual(spec({ variation: "Choropleth", encodings: { hue: "value" } }), {
			...deps,
			fields: deps.fields.filter((f) => f.name !== "State" && f.name !== "fips"),
		})
		expect(noRegion.problems[0]).toMatchObject({ path: "variation" })
		expect(noRegion.problems[0]?.message).toMatch(/needs a region column/)
	})

	describe("a region column stored as numbers (county FIPS read as quantitative)", () => {
		const numeric: ComposeDeps = {
			...deps,
			fields: [
				...deps.fields.filter((f) => f.name !== "State" && f.name !== "fips"),
				{ name: "county_fips", type: "quantitative" },
			],
			rows: rows.map((r) => ({ ...r, county_fips: String(Number(r.fips)) })),
		}

		it("is taken auto-placed and named on connection alike", () => {
			const auto = ok({ variation: "Choropleth", encodings: { hue: "value" } }, numeric)
			expect(auto.encodings.connection).toEqual({ field: "county_fips" })
			const named = ok({ variation: "Choropleth", encodings: { connection: "county_fips", hue: "value" } }, numeric)
			expect(named.encodings.connection).toEqual({ field: "county_fips" })
			expect(named.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "counties" })
			const bubble = ok({ variation: "Bubble map", encodings: { connection: "county_fips", area: "value" } }, numeric)
			expect(bubble.encodings.connection).toEqual({ field: "county_fips" })
		})

		it("is taken named on connection in an edit to a map variation", () => {
			const bars = ok({ encodings: { x: "segment", length: "sales" } }, numeric)
			const { problems, visual } = editVisual(
				bars,
				{ variation: "Choropleth", encodings: { x: null, length: null, connection: "county_fips", hue: "value" } },
				numeric
			)
			expect(problems).toEqual([])
			expect(visual.encodings.connection).toEqual({ field: "county_fips" })
		})

		it("is taken named on connection in an edit of a stored map that names no variation", () => {
			const map = ok({ variation: "Choropleth", encodings: { hue: "value" } }, numeric)
			const swapped = { ...map, encodings: { ...map.encodings, connection: { field: null } } }
			const { problems, visual } = editVisual(swapped, { encodings: { connection: "county_fips" } }, numeric)
			expect(problems).toEqual([])
			expect(visual.encodings.connection).toEqual({ field: "county_fips" })
			expect(specReadsRows({ encodings: { connection: "county_fips" } }, map)).toBe(true)
			expect(specReadsRows({ encodings: { connection: "county_fips" } }, { mapConfig: undefined })).toBe(false)
		})

		it("another quantitative field on connection is still refused", () => {
			const { problems } = composeVisual(
				spec({ variation: "Choropleth", encodings: { connection: "sales", hue: "value" } }),
				numeric
			)
			expect(problems.some((p) => p.path === "encodings.connection" && /"connection" takes/.test(p.message))).toBe(
				true
			)
		})
	})

	it("takes a ZIP column when the settings pin the geography level", () => {
		const v = ok({
			variation: "Choropleth",
			encodings: { connection: "Fruit", hue: "value" },
			settings: { mapConfig: { geographyLevel: "zcta" } },
		})
		expect(v.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "zcta" })
	})

	it("refuses channels that would turn the map into another chart, and a map without rows", () => {
		const { problems } = composeVisual(
			spec({ variation: "Choropleth", encodings: { connection: "State", hue: "value", x: "sales" } }),
			deps
		)
		expect(problems[0]?.message).toMatch(/leaves "x" unmapped/)
		const noRows = composeVisual(spec({ variation: "Choropleth", encodings: { hue: "value" } }), {
			...deps,
			rows: undefined,
		})
		expect(noRows.problems[0]?.message).toMatch(/rows/)
	})
})

describe("flow variations", () => {
	it.each(["Sankey diagram", "Chord diagram"])("makes a %s from a source / target / value table", (name) => {
		const { visual: v, problems, warnings } = composeVisual(
			spec({ variation: name, encodings: { connection: "source", area: "value" } }),
			deps
		)
		expect(problems).toEqual([])
		expect(v.channelConfigs.connection?.hierarchyLayout).toBe(name === "Sankey diagram" ? "sankey" : "chord")
		expect(v.encodings.hue).toEqual({ field: "source" })
		expect(v.mapConfig?.coordSystem).not.toBe("geographic")
		expect(warnings.join(" ")).toMatch(/from "source" to "[^"]+"/)
	})

	it("refuses a flow with no target column", () => {
		const { problems } = composeVisual(
			spec({ variation: "Sankey diagram", encodings: { connection: "source", area: "value" } }),
			{
				...deps,
				fields: [
					{ name: "source", type: "categorical" },
					{ name: "value", type: "quantitative" },
				],
			}
		)
		expect(problems[0]?.message).toMatch(/needs a target column/)
	})
})

describe("variation names", () => {
	it("lists every quick-start variation, each naming its family", () => {
		const all = QUICK_START_CHART_TYPES.flatMap((f) => QUICK_START_VARIATIONS[f].map((v) => v.name))
		expect(specVariationNames()).toEqual(all)
		expect(new Set(all).size).toBe(all.length)
		expect(specReadsRows({ variation: "choropleth" })).toBe(true)
		expect(specReadsRows({ family: "chord" })).toBe(true)
		expect(specReadsRows({ variation: "Line chart" })).toBe(false)
	})

	it("makes the same chart from a variation alone as from its family", () => {
		const encodings = { x: "sales", y: "profit", connection: "segment" }
		const byFamily = ok({ family: "line", encodings })
		const byVariation = ok({ variation: "Line chart", encodings })
		expect({ ...byVariation, id: "" }).toEqual({ ...byFamily, id: "" })
	})

	it("refuses an unknown variation with a did-you-mean", () => {
		const { problems } = composeVisual(spec({ variation: "Choropleht", encodings: {} }), deps)
		expect(problems[0]).toMatchObject({ path: "variation" })
		expect(problems[0]?.message).toMatch(/did you mean "Choropleth"/)
	})
})

describe("editVisual with a variation", () => {
	it("re-shapes stacked bars as grouped, keeping the title and the hue colors", () => {
		const stacked = ok({
			family: "bar",
			encodings: { x: "segment", length: "sales", hue: "source" },
			stack: "stack",
			title: "Energy",
			settings: { channelConfigs: { hue: { colors: { Coal: "#ff0000" } } } },
		})
		expect(stacked.channelConfigs.hue?.stackMode).toBe("stack")
		const { visual, problems } = editVisual(
			stacked,
			{ variation: "Vertical grouped bars" },
			deps
		)
		expect(problems).toEqual([])
		expect(visual.channelConfigs.hue).toMatchObject({ stackMode: "group", colors: { Coal: "#ff0000" } })
		expect(visual.labelsConfig.title).toBe("Energy")
	})

	it("refuses a variation the encodings can't make, naming what it needs", () => {
		const scatter = ok({ encodings: { x: "sales", y: "profit" } })
		const { problems } = editVisual(scatter, { variation: "Line chart" }, deps)
		expect(problems).toHaveLength(1)
		expect(problems[0]?.path).toBe("variation")
		expect(problems[0]?.message).toMatch(/"Line chart" needs "connection" \(.*the series field/)
	})

	it("turns a flow into the other flow, keeping its target pick, and a chart into a map", () => {
		const sankey = ok({
			variation: "Sankey diagram",
			encodings: { connection: "source", area: "value" },
			settings: { channelConfigs: { connection: { flowTargetField: "target" } } },
		})
		const chord = editVisual(sankey, { variation: "Chord diagram" }, deps)
		expect(chord.problems).toEqual([])
		expect(chord.visual.channelConfigs.connection).toMatchObject({
			hierarchyLayout: "chord",
			flowTargetField: "target",
		})
		const bars = ok({ family: "bar", encodings: { x: "State", length: "value" }, title: "Kept" })
		const refused = editVisual(bars, { variation: "Bubble map" }, deps)
		expect(refused.problems[0]?.message).toMatch(/needs "area".*leaves "x" unmapped/)
		const map = editVisual(
			bars,
			{ variation: "Choropleth", encodings: { x: null, length: null, connection: "State", hue: "value" } },
			deps
		)
		expect(map.problems).toEqual([])
		expect(map.visual.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "states" })
		expect(map.visual.labelsConfig.title).toBe("Kept")
		const back = editVisual(map.visual, { variation: "Vertical bars", encodings: { x: "State", length: "value", connection: null, hue: null } }, deps)
		expect(back.problems).toEqual([])
		expect(back.visual.mapConfig?.coordSystem).toBe("noMap")
	})
})
