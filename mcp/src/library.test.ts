// @vitest-environment node
// TST-32: list_charts and list_datasets against the real self-host server,
// with a library seeded straight through its HTTP API.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { contentVersionHeader } from "../../src/contexts/chartBuilder/lib/storage/contentVersionHeader"
import type { Folder, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { createApi } from "./api"
import { startTestServer, type TestServer } from "./testServer"
import { createHandlers, type Handlers } from "./tools"

let server: TestServer
let tools: Handlers
let drinks: string
let weather: string

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text
const okOut = (r: CallToolResult) => {
	expect(r.isError, text(r)).toBeFalsy()
	return JSON.parse(text(r))
}

const put = (collection: string, item: { id: string }) =>
	fetch(`${server.base}/api/${collection}/${item.id}`, {
		method: "PUT",
		headers: { "content-type": "application/json", ...contentVersionHeader(collection) },
		body: JSON.stringify(item),
	})

let clock = Date.UTC(2026, 0, 1)
const chart = (id: string, name: string, folderId: string | null, more: Partial<Visual> & Record<string, unknown> = {}) =>
	put("visuals", { id, name, folderId, datasetId: drinks, updatedAt: (clock += 60_000), ...more })

const FOLDERS: Folder[] = [
	{ id: "fl-research", name: "Research", parentId: null, createdAt: 1 },
	{ id: "fl-drafts", name: "Drafts", parentId: "fl-research", createdAt: 1 },
	{ id: "fl-big", name: "Big", parentId: null, createdAt: 1 },
	{ id: "fl-ten", name: "Ten", parentId: null, createdAt: 1 },
	{ id: "fl-empty", name: "Empty", parentId: null, createdAt: 1 },
]

beforeAll(async () => {
	server = await startTestServer()
	tools = createHandlers(createApi(server.base))
	for (const f of FOLDERS) await put("folders", f)
	drinks = okOut(await tools.create_dataset({ name: "Drink sales", rows: [{ drink: "Tea", sales: 3 }] })).id
	weather = okOut(await tools.create_dataset({ name: "Weather", rows: [{ day: "Mon", temp: 3 }] })).id
	await chart("vs-r1", "Sales by drink", "fl-research")
	await chart("vs-d1", "Drink sales draft", "fl-drafts")
	await chart("vs-d2", "Weather draft", "fl-drafts", { datasetId: weather })
	await chart("vs-trash", "Sales drink trashed", "fl-research", { deletedAt: 1700000000000 })
	await chart("vs-live", "Live with null deletedAt", "fl-research", { deletedAt: null })
	await chart("vs-tpl", "Sales template", "fl-research", { template: { sourceFields: [], formatMemory: {} } as unknown as Visual["template"] })
	await chart("vs-root1", "Unfiled sales of drinks", null)
	await chart("vs-root2", "Unfiled weather", null, { datasetId: weather })
	await chart("vs-gone", "Folder gone", "fl-deleted")
	for (let i = 0; i < 60; i++) await chart(`vs-big-${i}`, `Big chart ${i}`, "fl-big")
	for (let i = 0; i < 10; i++) await chart(`vs-ten-${i}`, `Quarterly sales chart ${i + 1}`, "fl-ten")
})
afterAll(() => server.close())

describe("list_charts", () => {
	it("with nothing given: exact totals, each folder by path, Trash and templates left out", async () => {
		const out = okOut(await tools.list_charts({}))
		const stored = (await (await fetch(`${server.base}/api/visuals?thumbnails=0`)).json()) as Visual[]
		const live = stored.filter((v) => typeof v.deletedAt !== "number" && v.template === undefined)
		expect(out.totalCharts).toBe(live.length)
		expect(out.totalCharts).toBe(1 + 2 + 1 + 2 + 1 + 60 + 10)
		expect(out.totalFolders).toBe(FOLDERS.length)
		expect(out.chartsInNoFolder).toBe(3)
		expect(out.folders).toEqual([
			{ path: "Big", id: "fl-big", charts: 60 },
			{ path: "Empty", id: "fl-empty", charts: 0 },
			{ path: "Research", id: "fl-research", charts: 2 },
			{ path: "Research / Drafts", id: "fl-drafts", charts: 2 },
			{ path: "Ten", id: "fl-ten", charts: 10 },
		])
	})

	it("a folder lists its subtree newest first, a subfolder's charts naming their path", async () => {
		const out = okOut(await tools.list_charts({ folder: "research" }))
		expect(out.path).toBe("Research")
		expect(out.total).toBe(4)
		expect(out.charts.map((c: { id: string }) => c.id)).toEqual(["vs-live", "vs-d2", "vs-d1", "vs-r1"])
		expect(out.charts[1]).toEqual({
			id: "vs-d2",
			name: "Weather draft",
			updated: expect.stringMatching(/^2026-01-01T\d\d:\d\d:\d\dZ$/),
			folder: "Research / Drafts",
		})
		expect(out.charts[0]).not.toHaveProperty("folder")
	})

	it("folder null: charts in no folder (one whose folder is gone included)", async () => {
		const out = okOut(await tools.list_charts({ folder: null }))
		expect(out.path).toBeNull()
		expect(out.charts.map((c: { id: string }) => c.id).sort()).toEqual(["vs-gone", "vs-root1", "vs-root2"])
	})

	it("60 charts in one folder: the newest 50 and a note", async () => {
		const out = okOut(await tools.list_charts({ folder: "fl-big" }))
		expect(out.total).toBe(60)
		expect(out.charts).toHaveLength(50)
		expect(out.charts[0].id).toBe("vs-big-59")
		expect(out.note).toMatch(/newest 50 of 60; narrow with query or dataset/)
	})

	it("a folder of 10 charts lists in under 1,000 characters", async () => {
		const r = await tools.list_charts({ folder: "Ten" })
		expect(okOut(r).total).toBe(10)
		expect(text(r).length).toBeLessThan(1000)
	})

	it("a data set used in two folders: every chart, each naming its folder", async () => {
		const out = okOut(await tools.list_charts({ dataset: "weather" }))
		expect(out.charts).toEqual([
			expect.objectContaining({ id: "vs-root2", folder: null }),
			expect.objectContaining({ id: "vs-d2", folder: "Research / Drafts" }),
		])
	})

	it('query "sales drink": every word, any order and case, across folders', async () => {
		const out = okOut(await tools.list_charts({ query: "sales DRINK" }))
		expect(out.charts.map((c: { id: string; folder: string | null }) => [c.id, c.folder])).toEqual([
			["vs-root1", null],
			["vs-d1", "Research / Drafts"],
			["vs-r1", "Research"],
		])
	})

	it("refuses an unknown folder or data set with the choices", async () => {
		const folder = await tools.list_charts({ folder: "Reserch" })
		expect(folder.isError).toBe(true)
		expect(JSON.parse(text(folder)).message).toContain('"Research / Drafts" (fl-drafts)')
		const dataset = await tools.list_charts({ dataset: "Drinks sale" })
		expect(dataset.isError).toBe(true)
		expect(JSON.parse(text(dataset)).message).toContain('Closest: "Drink sales"')
	})
})

describe("list_datasets", () => {
	it("lean by default, fields on request, query by name, total", async () => {
		const lean = okOut(await tools.list_datasets({}))
		expect(lean.total).toBe(2)
		expect(lean.datasets).toContainEqual({ id: drinks, name: "Drink sales", rows: 1 })
		const full = okOut(await tools.list_datasets({ fields: true, query: "DRINK" }))
		expect(full).toEqual({
			total: 1,
			datasets: [
				{
					id: drinks,
					name: "Drink sales",
					rows: 1,
					fields: { drink: "categorical", sales: "quantitative" },
					latestVersionId: expect.stringMatching(/^dv-/),
				},
			],
		})
	})
})
