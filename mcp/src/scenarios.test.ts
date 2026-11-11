// @vitest-environment node
// Andrew's desktop-test scenarios (zafiro-mcp desktop-tests/), as the tool
// calls a model would make, against the real self-host server. These are
// the acceptance checks for the settings round; the model's wording is not
// under test here, only that the calls it should make succeed and store what
// the scenario asserts.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { SpecProblem } from "../../src/contexts/chartBuilder/lib/chartSpec"
import type { Visual } from "../../src/contexts/chartBuilder/lib/types"
import { createApi } from "./api"
import { fakeRenderer, startTestServer, type TestServer } from "./testServer"
import { createHandlers, type Handlers } from "./tools"

let server: TestServer
let tools: Handlers

beforeAll(async () => {
	server = await startTestServer()
	tools = createHandlers(createApi(server.base), { renderer: fakeRenderer() })
})
afterAll(() => server.close())

type ToolOutput = { id: string; message: string; problems: SpecProblem[]; warnings?: string[]; [key: string]: unknown }

const parsed = (result: CallToolResult) => {
	expect(result.isError, (result.content[0] as { text: string }).text).toBeFalsy()
	return JSON.parse((result.content[0] as { text: string }).text) as ToolOutput
}
const refusal = (result: CallToolResult) => {
	expect(result.isError).toBe(true)
	return JSON.parse((result.content[0] as { text: string }).text) as ToolOutput
}

const stored = async (id: string): Promise<Visual> => {
	const all = (await (await fetch(`${server.base}/api/visuals?thumbnails=0`)).json()) as Visual[]
	const v = all.find((x) => x.id === id)
	if (!v) throw new Error(`no stored visual ${id}`)
	return v
}

const dataset = async (name: string, rows: Record<string, unknown>[]) =>
	parsed(await tools.create_dataset({ name, rows })).id

describe("scenarios: what a model should be able to do", () => {
	it("01 grouped bars from a pasted table, then only the title changes", async () => {
		const ds = await dataset("ED visits", [
			{ Quarter: "Q1", Hospital: "Riverside", "ED visits": 4100 },
			{ Quarter: "Q1", Hospital: "Lakeview", "ED visits": 3800 },
			{ Quarter: "Q2", Hospital: "Riverside", "ED visits": 4300 },
			{ Quarter: "Q2", Hospital: "Lakeview", "ED visits": 3900 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "Quarter", length: "ED visits", hue: "Hospital" },
				stack: "group",
			})
		)
		const before = await stored(chart.id)
		expect(before.channelConfigs.hue?.stackMode).toBe("group")
		parsed(await tools.edit_chart({ id: chart.id, patch: { title: "ED visits by quarter, 2025" } }))
		const after = await stored(chart.id)
		expect(after.labelsConfig.title).toBe("ED visits by quarter, 2025")
		expect({ ...after, labelsConfig: null, name: null, updatedAt: 0 }).toEqual({
			...before,
			labelsConfig: null,
			name: null,
			updatedAt: 0,
		})
	})

	it("08 pie, then a donut, then undo", async () => {
		const ds = await dataset("icecream", [
			{ flavor: "Vanilla", scoops: 12 },
			{ flavor: "Chocolate", scoops: 9 },
		])
		const chart = parsed(
			await tools.create_chart({ dataset: ds, encodings: { angle: "scoops", hue: "flavor" } })
		)
		const pie = await stored(chart.id)
		parsed(
			await tools.edit_chart({
				id: chart.id,
				patch: { settings: { channelConfigs: { angle: { donutHoleRadius: 50 } } } },
			})
		)
		expect((await stored(chart.id)).channelConfigs.angle?.donutHoleRadius).toBe(50)
		parsed(await tools.undo_chart_edit({ id: chart.id }))
		expect({ ...(await stored(chart.id)), updatedAt: 0 }).toEqual({ ...pie, updatedAt: 0 })
	})

	it("09 a US map shaded by state, then the legend hidden", async () => {
		const ds = await dataset("state_choropleth_data", [
			{ state: "Alabama", abbr: "AL", value: 3 },
			{ state: "Alaska", abbr: "AK", value: 7 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { connection: "state", hue: "value" },
				settings: { mapConfig: { coordSystem: "geographic", geographyLevel: "states" } },
			})
		)
		const map = await stored(chart.id)
		expect(map.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "states" })
		expect(map.channelConfigs.hue?.kind).toBe("quantitative")
		parsed(await tools.edit_chart({ id: chart.id, patch: { settings: { legendConfig: { enabled: false } } } }))
		expect((await stored(chart.id)).legendConfig?.enabled).toBe(false)
	})

	it("11 a sankey from Parent, Child and Value", async () => {
		const ds = await dataset("sankey_data", [
			{ Parent: "Primary care", Child: "Cardiology", Value: 40 },
			{ Parent: "Primary care", Child: "Orthopedics", Value: 25 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { connection: "Parent", area: "Value" },
				settings: { channelConfigs: { connection: { hierarchyLayout: "sankey", flowTargetField: "Child" } } },
			})
		)
		const v = await stored(chart.id)
		expect(v.channelConfigs.connection).toMatchObject({ hierarchyLayout: "sankey", flowTargetField: "Child" })
	})

	it("14 a stacked area over dates, then the x axis starts in March", async () => {
		const ds = await dataset("visits", [
			{ date: "2025-01-01", setting: "inpatient", visits: 320 },
			{ date: "2025-02-01", setting: "inpatient", visits: 310 },
			{ date: "2025-03-01", setting: "inpatient", visits: 335 },
			{ date: "2025-01-01", setting: "outpatient", visits: 540 },
			{ date: "2025-02-01", setting: "outpatient", visits: 560 },
			{ date: "2025-03-01", setting: "outpatient", visits: 575 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "date", length: "visits", connection: "setting", hue: "setting" },
			})
		)
		parsed(await tools.edit_chart({ id: chart.id, patch: { axes: { x: { min: "2025-03-01" } } } }))
		const min = (await stored(chart.id)).channelConfigs.x?.min
		expect(typeof min).toBe("number")
		expect(new Date(min as number).toISOString().slice(0, 7)).toBe("2025-03")
	})

	it("16 one line thicker than another: thickness by field seeds every level, then one level changes", async () => {
		const ds = await dataset("rates", [
			{ month: "2025-01", payer: "Aetna", rate: 410 },
			{ month: "2025-02", payer: "Aetna", rate: 425 },
			{ month: "2025-01", payer: "Cigna", rate: 390 },
			{ month: "2025-02", payer: "Cigna", rate: 400 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "month", y: "rate", connection: "payer", hue: "payer" },
			})
		)
		parsed(
			await tools.edit_chart({
				id: chart.id,
				patch: { settings: { channelConfigs: { connection: { thicknessField: "payer" } } } },
			})
		)
		const seeded = (await stored(chart.id)).channelConfigs.connection
		expect(Object.keys(seeded?.thicknessByValue ?? {}).sort()).toEqual(["Aetna", "Cigna"])
		parsed(
			await tools.edit_chart({
				id: chart.id,
				patch: { settings: { channelConfigs: { connection: { thicknessByValue: { Aetna: 5 } } } } },
			})
		)
		const thick = (await stored(chart.id)).channelConfigs.connection?.thicknessByValue
		expect(thick?.Aetna).toBe(5)
		expect(thick?.Cigna).toBe(seeded?.thickness)
		const listed = parsed(await tools.list_settings({ chartId: chart.id, query: "thickness by value" }))
		const row = (listed.rows as Array<{ path: string; value?: Record<string, number> }>).find(
			(r) => r.path === "channelConfigs.connection.thicknessByValue.*"
		)
		expect(Object.keys(row?.value ?? {}).sort()).toEqual(["Aetna", "Cigna"])
	})

	it("25 a dumbbell from two periods needs nothing on shape or area", async () => {
		const ds = await dataset("waits", [
			{ Hospital: "Riverside", Period: "Before", "Median wait": 48 },
			{ Hospital: "Riverside", Period: "After", "Median wait": 31 },
			{ Hospital: "Lakeview", Period: "Before", "Median wait": 42 },
			{ Hospital: "Lakeview", Period: "After", "Median wait": 37 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				family: "dumbbell",
				encodings: { y: "Hospital", x: "Median wait", hue: "Period" },
			})
		)
		const v = await stored(chart.id)
		expect(v.encodings.shape.field).toBeNull()
		expect(v.encodings.area.field).toBeNull()
		expect(v.encodings.connection.field).toBe("Hospital")
	})

	it("26 a lollipop is a scatter with stems; the stems can start at a baseline", async () => {
		const ds = await dataset("readmissions", [
			{ Hospital: "Riverside", rate: 14.2 },
			{ Hospital: "Lakeview", rate: 11.8 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "Hospital", y: "rate" },
				settings: { channelConfigs: { connection: { axisStem: "x-axis" } } },
			})
		)
		expect((await stored(chart.id)).channelConfigs.connection?.axisStem).toBe("x-axis")
		parsed(
			await tools.edit_chart({
				id: chart.id,
				patch: { settings: { channelConfigs: { connection: { axisStem: "custom-y", axisStemCustomY: 13 } } } },
			})
		)
		expect((await stored(chart.id)).channelConfigs.connection).toMatchObject({ axisStem: "custom-y", axisStemCustomY: 13 })
	})

	it("32 a theme by name, and the themes listed for a name that doesn't exist", async () => {
		const ds = await dataset("ed", [{ Hospital: "Riverside", "ED visits": 17210 }])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "Hospital", length: "ED visits" },
				themeId: "System Dark",
			})
		)
		expect((await stored(chart.id)).themeId).toBe("system-dark")
		const missing = refusal(
			await tools.create_chart({ dataset: ds, encodings: { x: "Hospital", length: "ED visits" }, themeId: "Neon" })
		)
		expect(missing.problems[0].message).toMatch(/system-dark/)
	})

	it("34 threshold colors, with a palette color, and no redundant legend", async () => {
		const ds = await dataset("aba", [
			{ state: "Alabama", change: 81.7 },
			{ state: "Georgia", change: 267.4 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { y: "state", length: "change" },
			})
		)
		const palettes = parsed(await tools.list_settings({ chartId: chart.id, query: "fill color rules" })).palettes as Record<
			string,
			string[]
		> & { categorical: string[] }
		const [purple, orange] = palettes[palettes.categorical[0]]
		parsed(
			await tools.edit_chart({
				id: chart.id,
				patch: {
					settings: {
						channelConfigs: {
							fillColorRules: [
								{ condition: "> 135", color: purple },
								{ condition: "<= 135", color: orange },
							],
						},
						legendConfig: { hidden: { hue: true } },
					},
				},
			})
		)
		const v = await stored(chart.id)
		expect(v.channelConfigs.fillColorRules).toEqual([
			{ condition: "> 135", color: purple },
			{ condition: "<= 135", color: orange },
		])
		expect(v.legendConfig?.hidden).toEqual({ hue: true })
	})

	it("a settings refusal names the setting that unlocks it", async () => {
		const ds = await dataset("facets", [
			{ region: "West", year: 2020, sales: 5 },
			{ region: "East", year: 2021, sales: 9 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "year", y: "sales", facet: "region" },
			})
		)
		const out = refusal(
			await tools.edit_chart({
				id: chart.id,
				patch: { settings: { channelConfigs: { facet: { panelAxisOverrides: { West: { yMax: 10 } } } } } },
			})
		)
		expect(out.problems[0].message).toContain('"channelConfigs.facet.shareY"')
	})
})

describe("variations a model names: maps and flows, and re-shaping an edit", () => {
	it("a choropleth by variation finds its region column, then becomes a bubble map", async () => {
		const ds = await dataset("uninsured", [
			{ State: "California", Rate: 6.5 },
			{ State: "Texas", Rate: 16.6 },
			{ State: "New York", Rate: 4.9 },
			{ State: "Florida", Rate: 11.2 },
		])
		const chart = parsed(
			await tools.create_chart({
				dataset: ds,
				variation: "Choropleth",
				encodings: { hue: "Rate" },
				title: "Uninsured rate",
			})
		)
		const map = await stored(chart.id)
		expect(map.mapConfig).toMatchObject({ coordSystem: "geographic", geographyLevel: "states" })
		expect(map.encodings.connection).toEqual({ field: "State" })
		expect(map.encodings.hue).toEqual({ field: "Rate" })
		parsed(
			await tools.edit_chart({
				id: chart.id,
				patch: { variation: "Bubble map", encodings: { hue: null, area: "Rate" } },
			})
		)
		const bubbles = await stored(chart.id)
		expect(bubbles.encodings.area).toEqual({ field: "Rate" })
		expect(bubbles.mapConfig?.coordSystem).toBe("geographic")
		expect(bubbles.labelsConfig.title).toBe("Uninsured rate")
	})

	it("a region column that names no places is refused and nothing is saved", async () => {
		const ds = await dataset("fruit", [
			{ Fruit: "apple", n: 3 },
			{ Fruit: "pear", n: 5 },
		])
		const before = (await (await fetch(`${server.base}/api/visuals?thumbnails=0`)).json()) as Visual[]
		const out = refusal(
			await tools.create_chart({
				dataset: ds,
				variation: "Choropleth",
				encodings: { connection: "Fruit", hue: "n" },
			})
		)
		expect(out.problems[0].path).toBe("encodings.connection")
		const after = (await (await fetch(`${server.base}/api/visuals?thumbnails=0`)).json()) as Visual[]
		expect(after).toHaveLength(before.length)
	})

	it("a sankey by variation, then the same flows as a chord", async () => {
		const ds = await dataset("referrals", [
			{ From: "Primary care", To: "Cardiology", Patients: 40 },
			{ From: "Primary care", To: "Orthopedics", Patients: 25 },
			{ From: "Urgent care", To: "Cardiology", Patients: 12 },
		])
		const created = parsed(
			await tools.create_chart({
				dataset: ds,
				variation: "Sankey diagram",
				encodings: { connection: "From", area: "Patients" },
			})
		)
		expect(created.warnings?.join(" ")).toContain('"To"')
		expect((await stored(created.id)).channelConfigs.connection?.hierarchyLayout).toBe("sankey")
		parsed(await tools.edit_chart({ id: created.id, patch: { variation: "Chord diagram" } }))
		expect((await stored(created.id)).channelConfigs.connection?.hierarchyLayout).toBe("chord")
	})
})

describe("recipes list_settings names", () => {
	it("a histogram, a lollipop with stems from 0, a donut, and a box plot marking each level's mean", async () => {
		const ds = await dataset("recipes", [
			{ Hospital: "Riverside", stay: 3.5, beds: 120 },
			{ Hospital: "Lakeview", stay: 4.25, beds: 90 },
			{ Hospital: "Riverside", stay: 5, beds: 110 },
		])
		const hist = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "stay" },
				settings: { channelConfigs: { x: { histogram: { enabled: true } } } },
			})
		)
		expect((await stored(hist.id)).channelConfigs.x?.histogram?.enabled).toBe(true)
		const lolli = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { x: "Hospital", y: "beds" },
				settings: { channelConfigs: { connection: { axisStem: "custom-y", axisStemCustomY: 0 } } },
			})
		)
		expect((await stored(lolli.id)).channelConfigs.connection).toMatchObject({ axisStem: "custom-y" })
		const donut = parsed(
			await tools.create_chart({
				dataset: ds,
				encodings: { angle: "beds", hue: "Hospital" },
				settings: { channelConfigs: { angle: { donutHoleRadius: 50 } } },
			})
		)
		expect((await stored(donut.id)).channelConfigs.angle?.donutHoleRadius).toBe(50)
		const box = parsed(
			await tools.create_chart({
				dataset: ds,
				variation: "Box plot (vertical)",
				encodings: { x: "Hospital", y: "stay" },
				settings: { channelConfigs: { x: { distributionOverlay: { showPoints: false, markMean: true } } } },
			})
		)
		expect((await stored(box.id)).channelConfigs.x?.distributionOverlay).toMatchObject({ showPoints: false, markMean: true })
	})
})
