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
import { createZafiroServer } from "./server"
import { startTestServer, type TestServer } from "./testServer"

const TOOLS = [
	"create_dataset",
	"create_chart",
	"edit_chart",
	"undo_chart_edit",
	"get_chart",
	"list_charts",
	"list_datasets",
	"list_settings",
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
	await createZafiroServer(createApi(server.base)).connect(a)
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
			})),
		}
		await expect(JSON.stringify(surface, null, "\t") + "\n").toMatchFileSnapshot("./__snapshots__/surface.json")
	})

	it("serves exactly the eight tools, and names no removed one", () => {
		expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort())
		const all = servedTexts().join("\n")
		for (const name of REMOVED) expect(all).not.toContain(name)
	})

	it("keeps instructions plus every description under 8,000 characters", () => {
		const total = servedTexts().reduce((n, s) => n + s.length, 0)
		expect(total).toBeLessThan(8000)
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
		for (const name of ["create_chart", "edit_chart", "undo_chart_edit"])
			expect(by[name]).toMatchObject({ destructiveHint: false, idempotentHint: false, openWorldHint: false })
	})

	it("declares an output schema on the three chart writes only", () => {
		expect(
			tools
				.filter((t) => t.outputSchema)
				.map((t) => t.name)
				.sort()
		).toEqual(["create_chart", "edit_chart", "undo_chart_edit"])
	})

	it("keeps the agent guide as documentation only: in mcp/guide, served by nothing", async () => {
		const guide = join(__dirname, "../guide/agent-guide.md")
		expect(existsSync(guide)).toBe(true)
		for (const name of REMOVED) expect(readFileSync(guide, "utf8")).not.toContain(name)
		for (const file of readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.includes(".test.")))
			expect(readFileSync(join(__dirname, file), "utf8"), file).not.toMatch(/from "[^"]*agent-guide|\?raw/)
		await expect(client.listResources()).rejects.toThrow()
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
		expect(chart.structuredContent).toEqual(JSON.parse(text(chart)))
		expect(Object.keys(chart.structuredContent ?? {}).sort()).toEqual(
			["editorUrl", "embedUrl", "id", "name", "revision", "warnings"].sort()
		)
		expect((chart.structuredContent as { revision: string }).revision).toMatch(/^"/)
		for (const r of [ds, chart]) expect(text(r)).not.toMatch(/\n/)
		const total = text(ds).length + text(chart).length
		expect(total).toBeLessThan(1000)

		const id = (chart.structuredContent as { id: string }).id
		const edit = await call("edit_chart", { id, patch: { subtitle: "Every month" } })
		expect(edit.structuredContent).toEqual(JSON.parse(text(edit)))
		const undo = await call("undo_chart_edit", { id })
		expect(undo.structuredContent).toEqual(JSON.parse(text(undo)))
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
		])
		for (const r of samples) {
			expect(text(r)).not.toContain("—")
			expect(text(r)).not.toMatch(/\n/)
			if (r.isError) expect(text(r), text(r)).toMatch(/give|ask|store|fix|tell|try|search|leave|update|open|change|list_charts/i)
		}
		const nearest = JSON.parse(text(samples[4]))
		expect(nearest.problems[0].message).toContain('did you mean "axisStem"')
		expect(nearest.problems[0].message).toMatch(/nearest settings: "channelConfigs\.connection\.axisStem/)
	})
})
