// @vitest-environment node
// TST-31: folders, data sets and themes by the names people use, against the
// real self-host server. Nothing is saved on a refusal.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { Folder, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { createApi } from "./api"
import { closestNames } from "./resolve"
import { fakeRenderer, startTestServer, type TestServer } from "./testServer"
import { createHandlers, type Handlers } from "./tools"

let server: TestServer
let tools: Handlers
let salesId: string

const out = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text)
const okOut = (r: CallToolResult) => {
	expect(r.isError, (r.content[0] as { text: string }).text).toBeFalsy()
	return out(r)
}

const putFolder = (f: Folder) =>
	fetch(`${server.base}/api/folders/${f.id}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(f),
	})

const visuals = async () => (await (await fetch(`${server.base}/api/visuals?thumbnails=0`)).json()) as Visual[]

const ROWS = [
	{ drink: "Tea", sales: 3 },
	{ drink: "Coffee", sales: 5 },
]

beforeAll(async () => {
	server = await startTestServer()
	tools = createHandlers(createApi(server.base), { renderer: fakeRenderer() })
	for (const f of [
		{ id: "fl-mcp", name: "MCP Tests", parentId: null, createdAt: 1 },
		{ id: "fl-research", name: "Research", parentId: null, createdAt: 1 },
		{ id: "fl-drafts", name: "Drafts", parentId: "fl-research", createdAt: 1 },
		{ id: "fl-a", name: "Shared", parentId: null, createdAt: 1 },
		{ id: "fl-b", name: "Shared", parentId: "fl-research", createdAt: 1 },
	])
		await putFolder(f)
	salesId = okOut(await tools.create_dataset({ name: "Drink sales", rows: ROWS })).id
	okOut(await tools.create_dataset({ name: "Sales", rows: ROWS }))
	okOut(await tools.create_dataset({ name: "Sales", rows: [...ROWS, { drink: "Juice", sales: 1 }] }))
})
afterAll(() => server.close())

const make = (args: Record<string, unknown>) =>
	tools.create_chart({ dataset: "Drink sales", encodings: { x: "drink", length: "sales" }, ...args } as never)

describe("folder by name", () => {
	it.each([
		["mcp tests", "fl-mcp"],
		["fl-mcp", "fl-mcp"],
		["DRAFTS", "fl-drafts"],
		["Research / Drafts", "fl-drafts"],
	])("folder %s lands in %s", async (folder, id) => {
		const made = okOut(await make({ folder }))
		expect((await visuals()).find((v) => v.id === made.id)?.folderId).toBe(id)
	})

	it("folderId still works, and none or null is the root", async () => {
		for (const [args, want] of [
			[{ folderId: "fl-mcp" }, "fl-mcp"],
			[{}, null],
			[{ folder: null }, null],
			[{ folderId: null }, null],
		] as const) {
			const made = okOut(await make(args))
			expect((await visuals()).find((v) => v.id === made.id)?.folderId).toBe(want)
		}
	})

	it.each(["MCP Test", "Nope", "Shared"])("refuses %s, listing every folder by path and id, saving nothing", async (folder) => {
		const before = (await visuals()).length
		const r = await make({ folder })
		expect(r.isError).toBe(true)
		const message = out(r).problems[0].message as string
		expect(message).toContain('"Research / Drafts" (fl-drafts)')
		expect(message).toContain('"MCP Tests" (fl-mcp)')
		if (folder === "Shared") expect(message).toMatch(/2 folders are named "Shared"; give the id/)
		expect((await visuals()).length).toBe(before)
	})

	it("keeps the stock Examples folder read-only", async () => {
		await putFolder({ id: "fl-ms6awf8l-cx47b8", name: "Stock Examples", parentId: null, createdAt: 1 })
		const r = await make({ folder: "stock examples" })
		expect(r.isError).toBe(true)
		expect(out(r).problems[0].message).toMatch(/read-only/)
	})
})

describe("data set by name", () => {
	it("matches any case with outer spaces ignored, or the id; datasetId still works", async () => {
		for (const args of [{ dataset: "  drink SALES " }, { dataset: salesId }, { dataset: undefined, datasetId: salesId }]) {
			const made = okOut(await make(args))
			expect((await visuals()).find((v) => v.id === made.id)?.datasetId).toBe(salesId)
		}
	})

	it("an unknown name lists the closest names", async () => {
		const r = await make({ dataset: "Drinks sale" })
		expect(r.isError).toBe(true)
		expect(out(r).problems[0].message).toMatch(/Closest: "Drink sales"/)
		expect(closestNames("Drinks sale", ["Sales", "Weather", "Drink sales"])[0]).toBe("Drink sales")
		expect(closestNames("sale", ["Weather", "Drink sales", "Sales"]).slice(0, 2).sort()).toEqual(["Drink sales", "Sales"])
	})

	it("two data sets named Sales: refused with each id and row count", async () => {
		const r = await make({ dataset: "Sales" })
		expect(r.isError).toBe(true)
		const message = out(r).problems[0].message as string
		expect(message).toMatch(/2 data sets are named "Sales": ds-\S+ \(2 rows\), ds-\S+ \(3 rows\)\. Ask the person which one, then give its id\./)
	})

	it("neither key: give the data set's name or id", async () => {
		const r = await tools.create_chart({ encodings: { x: "drink" } } as never)
		expect(out(r).problems[0].message).toMatch(/Give the data set's name or id/)
	})
})

describe("theme by name", () => {
	it("matches a name in any case or an id; an unknown one lists every theme", async () => {
		const made = okOut(await make({ themeId: "system dark" }))
		expect((await visuals()).find((v) => v.id === made.id)?.themeId).toBe("system-dark")
		okOut(await make({ themeId: "system-dark" }))
		const r = await make({ themeId: "Neon" })
		expect(r.isError).toBe(true)
		expect(out(r).problems[0].message).toMatch(/No theme is named "Neon"\. Themes: .*\(system-dark\)/)
	})
})
