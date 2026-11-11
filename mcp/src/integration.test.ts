// @vitest-environment node
// The MCP tools against the real self-host server (server/src), in-process
// on an ephemeral port with temp dirs, the way server/src/routes.test.ts
// starts one.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { Dataset, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { contentVersionHeader } from "../../src/contexts/chartBuilder/lib/storage/contentVersionHeader"
import { createApi } from "./api"
import type { SpecProblem } from "../../src/contexts/chartBuilder/lib/chartSpec"
import { startTestServer, type TestServer } from "./testServer"
import { createHandlers } from "./tools"

let server: TestServer
let base: string

beforeAll(async () => {
	server = await startTestServer()
	base = server.base
})

afterAll(() => {
	server.close()
})

type ToolOutput = { id: string; message: string; problems: SpecProblem[]; [key: string]: unknown }

const parsed = (result: CallToolResult) => {
	expect(result.isError, (result.content[0] as { text: string }).text).toBeFalsy()
	return JSON.parse((result.content[0] as { text: string }).text) as ToolOutput
}

const storedVisual = async (id: string): Promise<Visual | undefined> =>
	((await (await fetch(`${base}/api/visuals?thumbnails=0`)).json()) as Visual[]).find(
		(v) => v.id === id
	)

describe("MCP tools over the real HTTP API", () => {
	it("create_dataset → create_chart → get_chart → edit_chart → undo round-trips", async () => {
		const tools = createHandlers(createApi(base))
		const ds = parsed(
			await tools.create_dataset({
				name: "Fruit",
				rows: [
					{ fruit: "Apple", count: 3, month: "2024-01-01" },
					{ fruit: "Pear", count: 5, month: "2024-02-01" },
				],
			})
		)
		const listed = parsed(await tools.list_datasets({})) as unknown as { datasets: Array<{ id: string; rows: number }> }
		expect(listed.datasets).toContainEqual(expect.objectContaining({ id: ds.id, rows: 2 }))
		const body = (await (await fetch(`${base}/api/datasets/${ds.id}`)).json()) as Dataset
		const version = await fetch(`${base}/api/datasets/${ds.id}/versions/${body.latestVersionId}`)
		expect(version.status).toBe(200)

		const chart = parsed(
			await tools.create_chart({
				dataset: "fruit",
				encodings: { x: "fruit", length: "count" },
				title: "Fruit",
			})
		)
		expect(chart.editorUrl).toBe(`https://charts.example.com/editor/${chart.id}`)
		const created = await storedVisual(chart.id)
		expect(created).toMatchObject({ id: chart.id, datasetId: ds.id, name: "Fruit" })
		expect(created?.createdAtVersionId).toBe(body.latestVersionId)

		expect(parsed(await tools.get_chart({ id: chart.id }))).toMatchObject({
			encodings: { x: "fruit", length: "count" },
			title: "Fruit",
		})

		parsed(await tools.edit_chart({ id: chart.id, patch: { subtitle: "By count" } }))
		expect((await storedVisual(chart.id))?.labelsConfig.subtitle).toBe("By count")

		parsed(await tools.undo_chart_edit({ id: chart.id }))
		const restored = await storedVisual(chart.id)
		expect({ ...restored, updatedAt: 0 }).toEqual({ ...created, updatedAt: 0 })
	})

	/** A data set and a bar chart over it, made through the tools. */
	const barChart = async (tools: ReturnType<typeof createHandlers>) => {
		const ds = parsed(
			await tools.create_dataset({
				name: `Bars ${Math.random()}`,
				rows: [
					{ fruit: "Apple", count: 3 },
					{ fruit: "Pear", count: 5 },
				],
			})
		)
		return parsed(
			await tools.create_chart({ datasetId: ds.id, folderId: null, encodings: { x: "fruit", length: "count" } })
		).id
	}

	/** A save from outside the MCP (the editor): untagged, last-write-wins. */
	const outsideSave = (visual: Visual) =>
		fetch(`${base}/api/visuals/${visual.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json", ...contentVersionHeader("visuals") },
			body: JSON.stringify(visual),
		})

	it("edit, edit, undo, undo restores both earlier states", async () => {
		const tools = createHandlers(createApi(base))
		const id = await barChart(tools)
		const original = await storedVisual(id)
		parsed(await tools.edit_chart({ id, patch: { title: "One" } }))
		const afterOne = await storedVisual(id)
		parsed(await tools.edit_chart({ id, patch: { title: "Two" } }))
		expect((await storedVisual(id))?.labelsConfig.title).toBe("Two")

		parsed(await tools.undo_chart_edit({ id }))
		expect({ ...(await storedVisual(id)), updatedAt: 0 }).toEqual({ ...afterOne, updatedAt: 0 })
		parsed(await tools.undo_chart_edit({ id }))
		expect({ ...(await storedVisual(id)), updatedAt: 0 }).toEqual({ ...original, updatedAt: 0 })
	})

	it("an outside save between edit_chart's read and its write refuses the edit, writing nothing", async () => {
		let interpose: (() => Promise<unknown>) | null = null
		const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
			if (init?.method === "PUT" && String(input).includes("/api/visuals/") && interpose) {
				const run = interpose
				interpose = null
				await run()
			}
			return fetch(input, init)
		}) as typeof fetch
		const tools = createHandlers(createApi(base, fetchImpl))
		const id = await barChart(tools)
		const before = (await storedVisual(id)) as Visual
		const editorCopy = { ...before, name: "Editor", updatedAt: before.updatedAt + 1 }
		interpose = () => outsideSave(editorCopy)

		const result = await tools.edit_chart({ id, patch: { title: "Mine" } })
		expect(result.isError).toBe(true)
		expect((JSON.parse((result.content[0] as { text: string }).text) as ToolOutput).message).toMatch(
			/changed elsewhere .* since it was read; nothing was saved/
		)
		expect(await storedVisual(id)).toEqual(editorCopy)
		expect((await tools.undo_chart_edit({ id })).isError).toBe(true)
	})

	it("a chart stored with a null themeId reads, edits and lists settings", async () => {
		const tools = createHandlers(createApi(base))
		const id = await barChart(tools)
		const stored = (await storedVisual(id)) as Visual
		expect((await outsideSave({ ...stored, themeId: null } as unknown as Visual)).status).toBe(204)
		expect(parsed(await tools.get_chart({ id })).themeId).toBeNull()

		parsed(await tools.edit_chart({ id, patch: { subtitle: "Edited" } }))
		expect((await storedVisual(id))?.labelsConfig.subtitle).toBe("Edited")

		const settings = parsed(await tools.list_settings({ chartId: id, query: "title" }))
		expect(settings.palettes).toBeDefined()
	})

	it("get_chart marks a chart trashed only when deletedAt is a time (null reads live)", async () => {
		const tools = createHandlers(createApi(base))
		const id = await barChart(tools)
		const stored = (await storedVisual(id)) as Visual
		await outsideSave({ ...stored, deletedAt: null } as unknown as Visual)
		expect(parsed(await tools.get_chart({ id })).trashed).toBeUndefined()
		await outsideSave({ ...stored, deletedAt: 1700000000000 })
		expect(parsed(await tools.get_chart({ id })).trashed).toBe(true)
	})
})
