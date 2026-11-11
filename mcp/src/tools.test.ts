// @vitest-environment node
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { describe, expect, it } from "vitest"

import { CONTENT_VERSION_HEADER } from "../../src/contexts/chartBuilder/lib/storage/contentVersionHeader"
import { VISUALS_VERSION } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import { SYSTEM_THEMES, themeOf } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { DatasetMeta, SavedTheme, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { createApi } from "./api"
import type { SpecProblem } from "../../src/contexts/chartBuilder/lib/chartSpec"
import { fakeRenderer } from "./testServer"
import { createHandlers } from "./tools"

type Call = { method: string; path: string; headers: Record<string, string>; body?: string }

/** An in-memory stand-in for the self-host API that records every call.
 *  Visuals carry an ETag that moves on every write, honor If-Match and
 *  answer the single-visual GET; `legacy` is a server older than all
 *  three (405 on the single GET, If-Match ignored, no ETag). */
const fakeServer = (stamps: Record<string, number> = {}, { legacy = false } = {}) => {
	const calls: Call[] = []
	/** `beforeVisualsRead` runs before each read of the visuals collection
	 *  (an editor save landing between the MCP's reads, on a legacy server);
	 *  `beforeVisualWrite` before each visual PUT is judged (an editor save
	 *  landing between the MCP's read and its write). */
	const hooks: {
		beforeVisualsRead?: (visuals: Map<string, Visual>, read: number) => void
		beforeVisualWrite?: () => void
	} = {}
	let visualReads = 0
	let writes = 0
	const tags = new Map<string, string>()
	const visuals = new Map<string, Visual>()
	/** A save from outside the MCP (the editor): the body and its tag move. */
	const outsideSave = (id: string, visual: Visual) => {
		visuals.set(id, visual)
		tags.set(id, `"t${++writes}"`)
	}
	const datasets = new Map<string, unknown>()
	const metas = new Map<string, DatasetMeta>()
	const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
	const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
		const url = new URL(String(input))
		const method = init?.method ?? "GET"
		const path = url.pathname + url.search
		calls.push({
			method,
			path,
			headers: (init?.headers ?? {}) as Record<string, string>,
			body: typeof init?.body === "string" ? init.body : undefined,
		})
		const parts = url.pathname.split("/").slice(2).map(decodeURIComponent)
		if (method === "GET") {
			if (path === "/api/config") return json({ v: 1, baseUrl: "https://charts.example.com/" })
			if (path === "/api/content-versions") return json(stamps)
			if (path === "/api/datasets?view=index") return json(Object.fromEntries(metas))
			if (parts[0] === "datasets" && parts[1]) return json(datasets.get(parts[1]))
			if (parts[0] === "visuals" && parts[1]) {
				if (legacy) return new Response("method not allowed", { status: 405 })
				const visual = visuals.get(parts[1])
				if (!visual) return new Response("not found", { status: 404 })
				return new Response(JSON.stringify(visual), {
					status: 200,
					headers: { etag: tags.get(parts[1]) ?? "" },
				})
			}
			if (path === "/api/visuals?thumbnails=0") {
				hooks.beforeVisualsRead?.(visuals, ++visualReads)
				return json([...visuals.values()])
			}
			if (["/api/folders", "/api/themes", "/api/settings"].includes(path)) return json([])
			return new Response("not found", { status: 404 })
		}
		const body = JSON.parse(String(init?.body))
		if (parts[0] === "visuals") {
			hooks.beforeVisualWrite?.()
			const ifMatch = ((init?.headers ?? {}) as Record<string, string>)["if-match"]
			if (!legacy && ifMatch !== undefined && (!visuals.has(parts[1]) || (ifMatch !== "*" && ifMatch !== tags.get(parts[1]))))
				return new Response("precondition failed", { status: 412 })
			outsideSave(parts[1], body)
			if (!legacy) return new Response(null, { status: 204, headers: { etag: tags.get(parts[1]) ?? "" } })
		}
		if (parts[0] === "datasets" && parts.length === 2) datasets.set(parts[1], body)
		if (parts[0] === "datasets" && parts[2] === "meta") metas.set(parts[1], body)
		return new Response(null, { status: 204 })
	}) as typeof fetch
	return {
		calls,
		visuals,
		hooks,
		fetchImpl,
		outsideSave,
		writes: () => calls.filter((c) => c.method !== "GET"),
	}
}

type ToolOutput = { id: string; message: string; problems: SpecProblem[]; [key: string]: unknown }

const parsed = (result: CallToolResult) =>
	JSON.parse((result.content[0] as { text: string }).text) as ToolOutput

const setup = (stamps?: Record<string, number>, options?: { legacy?: boolean }) => {
	const fake = fakeServer(stamps, options)
	return { ...fake, tools: createHandlers(createApi("http://api.test/", fake.fetchImpl), { renderer: fakeRenderer() }) }
}

const ROWS = [
	{ year: 2020, region: "North", sales: 10 },
	{ year: 2021, region: "South", sales: 12 },
	{ year: 2022, region: "North", sales: 9 },
]

const withDataset = async (options?: { legacy?: boolean }) => {
	const s = setup(undefined, options)
	const created = parsed(await s.tools.create_dataset({ name: "Sales", rows: ROWS }))
	s.calls.length = 0
	return { ...s, datasetId: created.id as string }
}

describe("create_dataset", () => {
	it("writes body, versions, then meta, with the managed and content-version headers", async () => {
		const s = setup()
		const result = await s.tools.create_dataset({ name: "Sales", rows: ROWS })
		expect(result.isError).toBeFalsy()
		const out = parsed(result)
		const writes = s.writes()
		expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
			`PUT /api/datasets/${out.id}`,
			expect.stringMatching(new RegExp(`^PUT /api/datasets/${out.id}/versions/dv-`)),
			`PUT /api/datasets/${out.id}/meta`,
		])
		expect(writes[0].headers["x-vis-versions-managed"]).toBe("1")
		for (const w of writes) expect(w.headers[CONTENT_VERSION_HEADER]).toBeDefined()
		expect(out.rowCount).toBe(3)
		expect(out.fields).toEqual({ year: "quantitative", region: "categorical", sales: "quantitative" })
		expect(out.reused).toBe(false)
	})

	it("reuses an identical data set instead of writing", async () => {
		const s = setup()
		const first = parsed(await s.tools.create_dataset({ name: "Sales", rows: ROWS }))
		s.calls.length = 0
		const second = parsed(await s.tools.create_dataset({ name: "Sales", rows: ROWS }))
		expect(second).toMatchObject({ id: first.id, reused: true })
		expect(s.writes()).toEqual([])
	})

	it("refuses bad rows with nothing written", async () => {
		const s = setup()
		const result = await s.tools.create_dataset({ name: "", rows: [] })
		expect(result.isError).toBe(true)
		expect(parsed(result).problems.map((p: { path: string }) => p.path)).toEqual(["name", "rows"])
		expect(s.writes()).toEqual([])
	})
})

describe("create_chart", () => {
	it("PUTs the composed visual with the content-version header and returns links", async () => {
		const s = await withDataset()
		const result = await s.tools.create_chart({
			datasetId: s.datasetId,
			folderId: null,
			encodings: { x: "year", y: "sales" },
			title: "Sales by year",
		})
		expect(result.isError).toBeFalsy()
		const out = parsed(result)
		const [put] = s.writes()
		expect(put.path).toBe(`/api/visuals/${out.id}`)
		expect(put.headers[CONTENT_VERSION_HEADER]).toBe(String(VISUALS_VERSION))
		expect(JSON.parse(put.body ?? "{}")).not.toHaveProperty("thumbnail")
		expect(out.editorUrl).toBe(`https://charts.example.com/editor/${out.id}`)
		expect(out.embedUrl).toBe(`https://charts.example.com/embed/${out.id}`)
		expect(out).not.toHaveProperty("pictureUrl")
		expect(out.revision).toMatch(/^"t\d+"$/)
		expect(result.structuredContent).toEqual({ ...out, pictureKey: expect.any(String) })
		expect(s.visuals.get(out.id)?.themeId).toBeDefined()
	})

	it("returns problems as an error and writes nothing", async () => {
		const s = await withDataset()
		const result = await s.tools.create_chart({
			datasetId: s.datasetId,
			folderId: null,
			encodings: { x: "yaer" },
		})
		expect(result.isError).toBe(true)
		expect(parsed(result).problems[0].message).toContain('did you mean "year"')
		expect(s.writes()).toEqual([])
	})

	it("refuses when the server's content stamp differs from this build", async () => {
		const s = setup({ visuals: VISUALS_VERSION + 1 })
		const result = await s.tools.create_chart({
			datasetId: "ds-x",
			folderId: null,
			encodings: { x: "year" },
		})
		expect(result.isError).toBe(true)
		expect(parsed(result).message).toMatch(/^Nothing was saved: .*newer data format.*Update the MCP/)
		expect(s.writes()).toEqual([])
	})
})

describe("edit_chart and undo", () => {
	it("edits, then undo puts the previous visual back; a second undo errors", async () => {
		const s = await withDataset()
		const { id } = parsed(
			await s.tools.create_chart({
				datasetId: s.datasetId,
				folderId: null,
				encodings: { x: "year", y: "sales" },
				title: "Before",
			})
		)
		const edited = await s.tools.edit_chart({ id, patch: { title: "After", encodings: { hue: "region" } } })
		expect(edited.isError).toBeFalsy()
		expect(s.visuals.get(id)?.labelsConfig.title).toBe("After")
		expect(s.visuals.get(id)?.encodings.hue?.field).toBe("region")
		const summary = parsed(await s.tools.get_chart({ id }))
		expect(summary).toMatchObject({ title: "After", encodings: { x: "year", y: "sales", hue: "region" } })

		const undone = await s.tools.undo_chart_edit({ id })
		expect(undone.isError).toBeFalsy()
		expect(s.visuals.get(id)?.labelsConfig.title).toBe("Before")
		expect(s.visuals.get(id)?.encodings.hue?.field ?? null).toBeNull()
		expect((await s.tools.undo_chart_edit({ id })).isError).toBe(true)
	})

	it("a refused edit writes nothing and leaves nothing to undo", async () => {
		const s = await withDataset()
		const { id } = parsed(
			await s.tools.create_chart({ datasetId: s.datasetId, folderId: null, encodings: { x: "year" } })
		)
		s.calls.length = 0
		const result = await s.tools.edit_chart({ id, patch: { encodings: { y: "nope" } } })
		expect(result.isError).toBe(true)
		expect(s.writes()).toEqual([])
		expect((await s.tools.undo_chart_edit({ id })).isError).toBe(true)
	})
})

const lineChart = async (options?: { legacy?: boolean }) => {
	const s = await withDataset(options)
	const { id } = parsed(
		await s.tools.create_chart({
			datasetId: s.datasetId,
			folderId: null,
			encodings: { x: "year", y: "sales" },
		})
	)
	s.calls.length = 0
	return { ...s, id: id as string }
}

describe("settings", () => {
	it("applies settings on create and on edit", async () => {
		const s = await withDataset()
		const created = await s.tools.create_chart({
			datasetId: s.datasetId,
			folderId: null,
			encodings: { x: "year", y: "sales" },
			settings: { channelConfigs: { y: { gridlines: { enabled: false } } } },
		})
		expect(created.isError).toBeFalsy()
		const { id } = parsed(created)
		expect(s.visuals.get(id)?.channelConfigs.y?.gridlines?.enabled).toBe(false)
		const edited = await s.tools.edit_chart({
			id,
			patch: { settings: { legendConfig: { position: "bottom" } } },
		})
		expect(edited.isError).toBeFalsy()
		expect(s.visuals.get(id)?.legendConfig?.position).toBe("bottom")
		expect(s.visuals.get(id)?.channelConfigs.y?.gridlines?.enabled).toBe(false)
	})

	it("refuses a bad setting with nothing written", async () => {
		const s = await lineChart()
		const result = await s.tools.edit_chart({
			id: s.id,
			patch: { settings: { channelConfigs: { x: { gridline: {} } } } },
		})
		expect(result.isError).toBe(true)
		expect(parsed(result).problems[0].path).toBe("settings.channelConfigs.x.gridline")
		expect(s.writes()).toEqual([])
	})

	it("get_chart returns the settings slices", async () => {
		const s = await lineChart()
		const out = parsed(await s.tools.get_chart({ id: s.id }))
		const settings = out.settings as Record<string, unknown>
		expect(Object.keys(settings)).toEqual(expect.arrayContaining(["channelConfigs", "labelsConfig"]))
		expect(settings).not.toHaveProperty("encodings")
		expect(settings).not.toHaveProperty("id")
	})

	it("refuses to create in, or edit inside, the stock Examples folder", async () => {
		const s = await withDataset()
		const create = await s.tools.create_chart({
			datasetId: s.datasetId,
			folderId: "fl-ms6awf8l-cx47b8",
			encodings: { x: "year", y: "sales" },
		})
		expect(create.isError).toBe(true)
		expect(parsed(create).problems[0]).toMatchObject({ path: "folderId" })
		const made = parsed(
			await s.tools.create_chart({ datasetId: s.datasetId, folderId: null, encodings: { x: "year", y: "sales" } })
		)
		const stored = s.visuals.get(made.id as string) as Visual
		s.visuals.set(made.id as string, { ...stored, folderId: "fl-ms6awf8l-cx47b8" })
		const edit = await s.tools.edit_chart({ id: made.id as string, patch: { title: "No" } })
		expect(edit.isError).toBe(true)
		expect(parsed(edit).problems[0].message).toMatch(/read-only/)
	})

	it("list_settings searches, pages, and with a chart shows its values and a small palettes hint", async () => {
		const s = await withDataset()
		const plain = parsed(await s.tools.list_settings({ query: "gridlines enabled" }))
		const rows = plain.rows as Array<{ path: string; type: string }>
		expect(rows.find((r) => r.path === "channelConfigs.x.gridlines.enabled")?.type).toBe("boolean")
		expect(plain).not.toHaveProperty("palettes")
		const census = parsed(await s.tools.list_settings({}))
		expect(census.rows).toEqual([])
		expect((census.census as unknown[]).length).toBeGreaterThan(5)
		const { id } = parsed(
			await s.tools.create_chart({
				dataset: "Sales",
				encodings: { x: "year", y: "sales", hue: "region", connection: "region" },
				settings: { legendConfig: { position: "bottom" } },
			})
		)
		for (const query of ["line", "legend position", "data labels"]) {
			const r = await s.tools.list_settings({ chartId: id as string, query })
			const text = (r.content[0] as { text: string }).text
			expect(text.length, query).toBeLessThan(3000)
			expect(text).not.toContain("\u2014")
		}
		const legend = parsed(await s.tools.list_settings({ chartId: id as string, query: "legend position" }))
		expect((legend.rows as Array<{ path: string; value?: unknown }>).find((r) => r.path === "legendConfig.position")?.value).toBe(
			"bottom"
		)
		const palettes = legend.palettes as Record<string, unknown> & { categorical: string[]; text: string | null }
		expect(palettes.categorical.length).toBeGreaterThan(0)
		expect((palettes[palettes.categorical[0]] as string[])[0]).toMatch(/^#/)
		const missing = await s.tools.list_settings({ chartId: "nope" })
		expect(missing.isError).toBe(true)
		expect(parsed(missing).message).toMatch(/list_charts finds/)
	})
})

describe("stale-edit guard", () => {
	/** An editor save of `id` (renamed "Editor", and titled `title` when
	 *  given), once. */
	const editorSaveOnce = (s: Awaited<ReturnType<typeof lineChart>>, title?: string) => () => {
		s.hooks.beforeVisualWrite = undefined
		const v = s.visuals.get(s.id) as Visual
		s.outsideSave(s.id, {
			...v,
			updatedAt: v.updatedAt + 1,
			name: "Editor",
			...(title === undefined ? {} : { labelsConfig: { ...v.labelsConfig, title } }),
		})
	}

	it("edit_chart's save is conditional on the tag it read: an outside save of the same setting in between pauses it", async () => {
		const s = await lineChart()
		s.hooks.beforeVisualWrite = editorSaveOnce(s, "Theirs")
		const result = await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })
		expect(result.isError).toBe(true)
		const out = parsed(result)
		expect(out.message).toMatch(/^Paused, nothing saved/)
		expect(out.changes).toEqual([expect.stringMatching(/^labelsConfig\.title: "" -> "Theirs"$/)])
		const [put, ...more] = s.writes()
		expect(more).toEqual([])
		expect(put.headers["if-match"]).toMatch(/^"t\d+"$/)
		expect(s.visuals.get(s.id)?.name).toBe("Editor")
		expect(s.visuals.get(s.id)?.labelsConfig.title).toBe("Theirs")
		expect((await s.tools.undo_chart_edit({ id: s.id })).isError).toBe(true)
	})

	it("an outside save of another setting in between is kept: the edit is applied again over it", async () => {
		const s = await lineChart()
		s.hooks.beforeVisualWrite = editorSaveOnce(s)
		const result = await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })
		expect(result.isError).toBeFalsy()
		expect(s.writes().map((w) => w.headers["if-match"])).toEqual([expect.any(String), expect.any(String)])
		expect(s.visuals.get(s.id)?.name).toBe("Editor")
		expect(s.visuals.get(s.id)?.labelsConfig.title).toBe("Mine")
	})

	it("undo_chart_edit pauses when the setting it restores changed after the edit, writing nothing", async () => {
		const s = await lineChart()
		expect((await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })).isError).toBeFalsy()
		editorSaveOnce(s, "Theirs")()
		const before = s.writes().length
		const result = await s.tools.undo_chart_edit({ id: s.id })
		expect(result.isError).toBe(true)
		expect(parsed(result).changes).toEqual(['labelsConfig.title: "Mine" -> "Theirs"'])
		expect(s.writes()).toHaveLength(before)
		expect(s.visuals.get(s.id)?.labelsConfig.title).toBe("Theirs")
	})

	it("undo_chart_edit keeps an outside change to another setting", async () => {
		const s = await lineChart()
		expect((await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })).isError).toBeFalsy()
		editorSaveOnce(s)()
		expect((await s.tools.undo_chart_edit({ id: s.id })).isError).toBeFalsy()
		expect(s.visuals.get(s.id)?.name).toBe("Editor")
		expect(s.visuals.get(s.id)?.labelsConfig.title).toBe("")
	})

	it("two edits undo one after the other: each undo is checked against the last write", async () => {
		const s = await lineChart()
		const original = s.visuals.get(s.id) as Visual
		parsed(await s.tools.edit_chart({ id: s.id, patch: { title: "One" } }))
		parsed(await s.tools.edit_chart({ id: s.id, patch: { title: "Two" } }))
		expect((await s.tools.undo_chart_edit({ id: s.id })).isError).toBeFalsy()
		expect(s.visuals.get(s.id)?.labelsConfig.title).toBe("One")
		expect((await s.tools.undo_chart_edit({ id: s.id })).isError).toBeFalsy()
		expect({ ...s.visuals.get(s.id), updatedAt: 0 }).toEqual({ ...original, updatedAt: 0 })
	})

	it("an outside save of the same setting after the last result pauses the next edit; get_chart then lets it through", async () => {
		const s = await lineChart()
		editorSaveOnce(s, "Theirs")()
		const paused = await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })
		expect(paused.isError).toBe(true)
		expect(parsed(paused).message).toMatch(/ask what they want/)
		expect(s.writes()).toEqual([])
		const { revision } = parsed(await s.tools.get_chart({ id: s.id }))
		expect(revision).toMatch(/^"t\d+"$/)
		expect((await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })).isError).toBeFalsy()
		expect(s.visuals.get(s.id)?.name).toBe("Editor")
	})

	it("a revision never returned for the chart refuses the edit and says to read the chart again", async () => {
		const s = await lineChart()
		const result = await s.tools.edit_chart({ id: s.id, revision: '"t999"', patch: { title: "Mine" } })
		expect(result.isError).toBe(true)
		expect(parsed(result).message).toMatch(/read it again with get_chart/)
		expect(s.writes()).toEqual([])
		const current = parsed(await s.tools.get_chart({ id: s.id })).revision as string
		expect((await s.tools.edit_chart({ id: s.id, revision: current, patch: { title: "Mine" } })).isError).toBeFalsy()
	})

	describe("against a server older than ETags", () => {
		const editorSave = (id: string, title?: string) => (visuals: Map<string, Visual>, read: number) => {
			const v = visuals.get(id)
			if (read === 2 && v)
				visuals.set(id, {
					...v,
					updatedAt: v.updatedAt + 1,
					name: "Editor",
					...(title === undefined ? {} : { labelsConfig: { ...v.labelsConfig, title } }),
				})
		}

		it("edit_chart falls back to the updatedAt check: the same setting changed pauses it, writing nothing", async () => {
			const s = await lineChart({ legacy: true })
			s.hooks.beforeVisualsRead = editorSave(s.id, "Theirs")
			const result = await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })
			expect(result.isError).toBe(true)
			expect(parsed(result).message).toMatch(/^Paused, nothing saved/)
			expect(s.writes()).toEqual([])
			expect(s.visuals.get(s.id)?.labelsConfig.title).toBe("Theirs")
		})

		it("edit_chart falls back to the updatedAt check: another setting changed is kept", async () => {
			const s = await lineChart({ legacy: true })
			s.hooks.beforeVisualsRead = editorSave(s.id)
			expect((await s.tools.edit_chart({ id: s.id, patch: { title: "Mine" } })).isError).toBeFalsy()
			expect(s.visuals.get(s.id)?.name).toBe("Editor")
			expect(s.visuals.get(s.id)?.labelsConfig.title).toBe("Mine")
		})

		it("edits and undoes twice with no tags", async () => {
			const s = await lineChart({ legacy: true })
			const original = s.visuals.get(s.id) as Visual
			parsed(await s.tools.edit_chart({ id: s.id, patch: { title: "One" } }))
			parsed(await s.tools.edit_chart({ id: s.id, patch: { title: "Two" } }))
			expect(s.writes().every((c) => c.headers["if-match"] === undefined)).toBe(true)
			expect((await s.tools.undo_chart_edit({ id: s.id })).isError).toBeFalsy()
			expect((await s.tools.undo_chart_edit({ id: s.id })).isError).toBeFalsy()
			expect({ ...s.visuals.get(s.id), updatedAt: 0 }).toEqual({ ...original, updatedAt: 0 })
		})
	})
})

describe("theme on edit", () => {
	it("re-themes by name and refuses an unknown theme", async () => {
		const s = await lineChart()
		const bad = await s.tools.edit_chart({ id: s.id, patch: { themeId: "no such theme" } })
		expect(bad.isError).toBe(true)
		expect(parsed(bad).problems[0].path).toBe("themeId")
		expect(s.writes()).toEqual([])
		const other = SYSTEM_THEMES.find((t) => t.id !== s.visuals.get(s.id)?.themeId) as SavedTheme
		const result = await s.tools.edit_chart({ id: s.id, patch: { themeId: other.name, title: "Kept" } })
		expect(result.isError).toBeFalsy()
		const v = s.visuals.get(s.id) as Visual
		expect(v.themeId).toBe(other.id)
		expect(v.labelsConfig.title).toBe("Kept")
		expect(v.channelConfigs.defaultFill).toBe(themeOf(other).defaultFill)
	})
})
