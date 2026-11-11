// @vitest-environment node
// TST-29: the served surface, as a client sees it over MCP, against the real
// self-host server. The snapshot (__snapshots__/surface.json) changes only on
// purpose: regenerate it with `pnpm vitest run mcp/src/surface.test.ts -u`.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { ALL_ENCODING_CHANNELS } from "../../src/contexts/chartBuilder/lib/channels"
import { createApi } from "./api"
import { CARD_MIME, CARD_URI } from "./pictures"
import { createZafiroServer } from "./server"
import { fakeRenderer, startTestServer, type TestServer } from "./testServer"

const TOOLS = [
	"create_dataset",
	"create_chart",
	"edit_chart",
	"undo_chart_edit",
	"get_chart",
	"list_charts",
	"list_datasets",
	"list_settings",
	"export_chart",
]
const REMOVED = ["agent_guide", "chart_vocabulary", "validate_chart"]
const CHANNELS = ALL_ENCODING_CHANNELS.filter((c) => c !== "text")

let server: TestServer
let client: Client
let tools: Tool[]
let instructions: string

beforeAll(async () => {
	server = await startTestServer()
	const [a, b] = InMemoryTransport.createLinkedPair()
	await createZafiroServer(createApi(server.base), { renderer: fakeRenderer() }).connect(a)
	client = new Client({ name: "surface-test", version: "0" })
	await client.connect(b)
	tools = (await client.listTools()).tools
	instructions = client.getInstructions() ?? ""
})
afterAll(async () => {
	await client.close()
	server.close()
})

/** Every `description` in a JSON schema, nested ones too. */
const descriptionsIn = (schema: unknown): string[] => {
	if (Array.isArray(schema)) return schema.flatMap(descriptionsIn)
	if (typeof schema !== "object" || schema === null) return []
	return Object.entries(schema).flatMap(([k, v]) =>
		k === "description" && typeof v === "string" ? [v] : descriptionsIn(v)
	)
}

/** The instructions, every tool description and every parameter description. */
const servedTexts = () => [
	instructions,
	...tools.flatMap((t) => [t.description ?? "", ...descriptionsIn(t.inputSchema)]),
]

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text

const call = async (name: string, args: Record<string, unknown>) =>
	(await client.callTool({ name, arguments: args })) as CallToolResult

/** 32 pasted rows. */
const ROWS = Array.from({ length: 32 }, (_, i) => ({
	Month: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`,
	Drink: ["Coffee", "Tea", "Juice", "Water"][i % 4],
	Sales: 100 + i * 7,
}))

describe("served surface", () => {
	it("matches the checked-in snapshot", async () => {
		const surface = {
			instructions,
			tools: tools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema,
				...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
				annotations: t.annotations,
				...(t._meta ? { _meta: t._meta } : {}),
			})),
		}
		await expect(JSON.stringify(surface, null, "\t") + "\n").toMatchFileSnapshot("./__snapshots__/surface.json")
	})

	it("serves exactly the nine model tools to a client without cards, and names no removed one", () => {
		expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort())
		const all = servedTexts().join("\n")
		for (const name of REMOVED) expect(all).not.toContain(name)
	})

	it("keeps instructions plus every description under 8,000 characters", () => {
		const total = servedTexts().reduce((n, s) => n + s.length, 0)
		expect(total).toBeLessThan(8000)
	})

	it("keeps every rule in the instructions", () => {
		for (const rule of [
			/A first chart takes two calls/,
			/create_dataset \(every row\), then create_chart/,
			/a library data set the person names goes straight to create_chart/,
			/primary comparison, normally x and y/,
			/Each further comparison \(across, among, within, by\) adds one encoding/,
			/"What is the primary comparison you're trying to facilitate\?"/,
			/build a first version, then change that chart\. One chart per request\./,
			/Never override an encoding the person named/,
			/Refuse a bar axis that doesn't start at zero \(offer points, a dumbbell, a lollipop or a line\), dropped or nudged data, and a dual axis \(offer two charts or a scatter\)/,
			/Chart exactly the rows the person gave, every one/,
			/neither filters nor aggregates; never store a summed or averaged table/,
			/Before leaving rows or levels out, say so and offer a data set without them or gray for them/,
			/A mean per level is a box plot with each level's mean marked \(the mean mark shows with points hidden\), never bars, which sum/,
			/Levels draw in the order they first appear/,
			/Reshaping wide data to a long copy keeping every value is not aggregating; say so in one line/,
			/For a chart type Zafiro lacks \(a 3D pie\), say so, offer the closest, and make nothing until they choose/,
			/Search list_settings before saying there is no setting/,
			/When a request could mean more than one thing, ask which/,
			/"Flip the axes" swaps the x and y fields with their axis settings and titles/,
			/refused as changed elsewhere \(in the editor, a tab, or by someone\), tell the person and ask what they want before trying again/,
			/Every chart gets a title and axis titles, in the person's words or from the field names, in sentence case, with a unit only when the person or data states one/,
			/Set nothing else they didn't ask for; offer it/,
			/A setting asked for is set even when it won't show yet; say when it will/,
			/"Undo" after an undo is another undo/,
			/Reply in one line naming the titles as drafts, with at most three short offers/,
			/Every write returns a picture of the chart: look at it before replying and describe only what it shows/,
			/After an export, say where the file is/,
			/Asked for another folder, say files go to their Export folder setting \(VIS_EXPORT_DIR in the MCP's config; change it there and restart\), and write nothing elsewhere/,
		])
			expect(instructions).toMatch(rule)
	})

	it("describes the picture on the writes and get_chart, and where exports go", () => {
		const by = Object.fromEntries(tools.map((t) => [t.name, t]))
		for (const name of ["create_chart", "undo_chart_edit", "get_chart"]) expect(by[name].description).toMatch(/picture/)
		expect(by.export_chart.description).toMatch(/Export folder setting \(default Downloads\/Zafiro\)/)
		expect(by.export_chart.description).toMatch(/can't choose another folder/)
		const props = by.export_chart.inputSchema.properties as Record<string, unknown>
		expect(Object.keys(props).sort()).toEqual(["fileName", "format", "height", "id", "pixelRatio", "width"])
		expect(by.export_chart.inputSchema.required).toEqual(["id", "format"])
		const getProps = by.get_chart.inputSchema.properties as Record<string, unknown>
		expect(Object.keys(getProps).sort()).toEqual(["id", "picture", "slice"])
		for (const name of ["create_chart", "edit_chart", "undo_chart_edit"])
			expect(Object.keys(by[name].inputSchema.properties ?? {})).not.toContain("picture")
	})

	it("has no em dash and never says to call or read a tool before the first chart", () => {
		const all = servedTexts().join("\n")
		expect(all).not.toContain("—")
		for (const bad of [
			/\bcall (it|this|\w+_\w+) first\b/i,
			/\bfirst,? (call|read|consult)\b/i,
			/\bbefore (the|your|a) first (chart|call)\b/i,
			/\b(read|consult) (all of )?(it|this|the guide)\b/i,
			/\bcall this first\b/i,
		])
			expect(all).not.toMatch(bad)
	})

	it("uses only real channel names, and no slope", () => {
		const all = servedTexts().join("\n")
		expect(all.toLowerCase()).not.toContain("slope")
		const listed = /Channels: ([^.]+)\./.exec(instructions)?.[1] ?? ""
		expect(
			listed
				.split(", ")
				.map((c) => c.split(" ")[0])
				.sort()
		).toEqual([...CHANNELS].sort())
		const used = [
			...[...all.matchAll(/\b([a-zA-Z]+) \+ ([a-zA-Z]+)(?: \+ ([a-zA-Z]+))?/g)].flatMap((m) => m.slice(1)),
			...[...all.matchAll(/takes ([a-z]+), then ([a-z]+), then ([a-z]+)/g)].flatMap((m) => m.slice(1)),
			...[...all.matchAll(/\b(?:goes|go|field) on (\w+)/g)].map((m) => m[1]),
		].filter((w): w is string => w !== undefined)
		expect(used.length).toBeGreaterThan(10)
		for (const w of used) expect(CHANNELS, w).toContain(w)
	})

	it("requires only encodings on create_chart and says what the four field types mean", () => {
		const create = tools.find((t) => t.name === "create_chart") as Tool
		expect(create.inputSchema.required).toEqual(["encodings"])
		const fieldTypes = (create.inputSchema.properties as Record<string, { description?: string }>).fieldTypes
		for (const type of ["categorical", "ordinal", "quantitative", "temporal"])
			expect(fieldTypes.description).toContain(type)
	})

	it("annotates every tool", () => {
		const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]))
		for (const name of ["list_datasets", "get_chart", "list_charts", "list_settings"])
			expect(by[name]?.readOnlyHint).toBe(true)
		expect(by.create_dataset).toMatchObject({ destructiveHint: false, idempotentHint: true, openWorldHint: false })
		for (const name of ["create_chart", "edit_chart", "undo_chart_edit", "export_chart"])
			expect(by[name]).toMatchObject({ destructiveHint: false, idempotentHint: false, openWorldHint: false })
	})

	it("draws the four chart tools in the card", () => {
		const withCard = tools.filter(
			(t) => (t._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === CARD_URI
		)
		expect(withCard.map((t) => t.name).sort()).toEqual(["create_chart", "edit_chart", "get_chart", "undo_chart_edit"])
	})

	it("declares an output schema on the three chart writes only", () => {
		expect(
			tools
				.filter((t) => t.outputSchema)
				.map((t) => t.name)
				.sort()
		).toEqual(["create_chart", "edit_chart", "undo_chart_edit"])
	})

	it("keeps the agent guide as documentation only (in mcp/guide, served by nothing); the one resource is the card", async () => {
		const guide = join(__dirname, "../guide/agent-guide.md")
		expect(existsSync(guide)).toBe(true)
		for (const name of REMOVED) expect(readFileSync(guide, "utf8")).not.toContain(name)
		for (const file of readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.includes(".test.")))
			expect(readFileSync(join(__dirname, file), "utf8"), file).not.toMatch(/from "[^"]*agent-guide|\?raw/)
		const { resources } = await client.listResources()
		expect(resources).toEqual([expect.objectContaining({ uri: CARD_URI, mimeType: CARD_MIME })])
	})
})

describe("results", () => {
	it("a first chart from 32 pasted rows: two compact results under 1,000 characters, structuredContent equal to the text", async () => {
		const ds = await call("create_dataset", { name: "Drink sales", rows: ROWS })
		expect(ds.isError).toBeFalsy()
		expect(ds.structuredContent).toBeUndefined()
		const dataset = JSON.parse(text(ds))
		expect(dataset).toEqual({
			id: expect.any(String),
			name: "Drink sales",
			rowCount: 32,
			fields: { Month: "temporal", Drink: "categorical", Sales: "quantitative" },
			reused: false,
		})
		const chart = await call("create_chart", {
			dataset: "Drink sales",
			encodings: { x: "Month", y: "Sales", connection: "Drink", hue: "Drink" },
			title: "Sales by month",
		})
		expect(chart.isError).toBeFalsy()
		const withKey = (r: CallToolResult) => ({ ...JSON.parse(text(r)), pictureKey: expect.any(String) })
		expect(chart.structuredContent).toEqual(withKey(chart))
		expect(Object.keys(chart.structuredContent ?? {}).sort()).toEqual(
			["editorUrl", "embedUrl", "id", "name", "pictureKey", "revision", "warnings"].sort()
		)
		expect(chart.content.map((b) => b.type)).toEqual(["text", "image"])
		expect((chart.structuredContent as { revision: string }).revision).toMatch(/^"/)
		for (const r of [ds, chart]) expect(text(r)).not.toMatch(/\n/)
		const total = text(ds).length + text(chart).length
		expect(total).toBeLessThan(1000)

		const id = (chart.structuredContent as { id: string }).id
		const edit = await call("edit_chart", { id, patch: { subtitle: "Every month" } })
		expect(edit.structuredContent).toEqual(withKey(edit))
		const undo = await call("undo_chart_edit", { id })
		expect(undo.structuredContent).toEqual(withKey(undo))
		const read = JSON.parse(text(await call("get_chart", { id })))
		expect(read.revision).toBe((undo.structuredContent as { revision: string }).revision)
		expect(read).not.toHaveProperty("pictureUrl")
	})

	it("results and refusals carry no em dash and say what to do next", async () => {
		const samples = await Promise.all([
			call("create_chart", { dataset: "No such data", encodings: { x: "a" } }),
			call("create_chart", { encodings: { x: "a" } }),
			call("create_chart", { dataset: "Drink sales", encodings: { x: "Month" }, folder: "Nope" }),
			call("create_chart", { dataset: "Drink sales", encodings: { x: "Month" }, themeId: "Neon" }),
			call("create_chart", {
				dataset: "Drink sales",
				encodings: { x: "Month", y: "Sales" },
				settings: { channelConfigs: { connection: { axisStemm: "custom-y" } } },
			}),
			call("get_chart", { id: "nope" }),
			call("undo_chart_edit", { id: "nope" }),
			call("list_charts", { folder: "Nope" }),
			call("list_settings", { query: "legend position", descriptions: true }),
			call("list_settings", { query: "axis stem" }),
			call("list_settings", {}),
			call("list_datasets", { fields: true }),
			call("list_charts", {}),
			call("export_chart", { id: "nope", format: "png" }),
			call("get_chart", { id: "nope", slice: "legendConfig" }),
		])
		for (const r of samples) {
			for (const block of r.content) if (block.type === "text") expect(block.text).not.toContain("—")
			expect(text(r)).not.toMatch(/\n/)
			if (r.isError) expect(text(r), text(r)).toMatch(/give|ask|store|fix|tell|try|search|leave|update|open|change|list_charts/i)
		}
		const nearest = JSON.parse(text(samples[4]))
		expect(nearest.problems[0].message).toContain('did you mean "axisStem"')
		expect(nearest.problems[0].message).toMatch(/nearest settings: "channelConfigs\.connection\.axisStem/)
	})
})
