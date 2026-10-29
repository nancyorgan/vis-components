// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { datasetMetaFrom } from "../../src/contexts/chartBuilder/lib/datasetMeta"
import { DATASETS_VERSION, VISUALS_VERSION } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { Dataset, DatasetMeta, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { hydrateVisual } from "../../src/contexts/chartBuilder/lib/visualDefaults"
import { CAFE } from "../../src/testSupport/chartSpecFixtures"
import { visualEtag } from "./chartSpecRoute.js"
import * as dbModule from "./db.js"
import { openDb } from "./db.js"
import type { IdentifyUser } from "./identity.js"
import { SPEC_BODY_CAP_BYTES } from "./limits.js"
import { createHandler } from "./routes.js"

const servers: Server[] = []
/** The data dir of the server `start` made last. */
let dataDir = ""
const start = async (mintVisualId?: () => string, identify?: IdentifyUser): Promise<string> => {
	const dbDir = mkdtempSync(join(tmpdir(), "vis-spec-db-"))
	dataDir = mkdtempSync(join(tmpdir(), "vis-spec-data-"))
	const distDir = mkdtempSync(join(tmpdir(), "vis-spec-dist-"))
	writeFileSync(join(distDir, "index.html"), "<title>spa</title>")
	const handler = createHandler({
		config: {
			baseUrl: "https://charts.example.com",
			dbDir,
			dataDir,
			port: 0,
			publishDir: mkdtempSync(join(tmpdir(), "vis-spec-publish-")),
			publishBaseUrl: "https://embeds.example.com",
		},
		db: openDb(dbDir),
		distDir,
		mintVisualId,
		identify,
	})
	const server = createServer((req, res) => void handler(req, res))
	servers.push(server)
	await new Promise<void>((resolve) => server.listen(0, resolve))
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(() => {
	for (const s of servers.splice(0)) s.close()
})

const put = (base: string, path: string, body: unknown, headers = {}) =>
	fetch(`${base}${path}`, { method: "PUT", headers, body: JSON.stringify(body) })

/** Upload a dataset the way the client does: body, each version, meta last. */
const seedDataset = async (base: string, dataset: Dataset) => {
	await put(base, `/api/datasets/${dataset.id}`, dataset, { "x-vis-versions-managed": "1" })
	for (const version of dataset.versions) {
		await put(base, `/api/datasets/${dataset.id}/versions/${version.id}`, version)
	}
	await put(base, `/api/datasets/${dataset.id}/meta`, datasetMetaFrom(dataset))
}

const post = (base: string, spec: unknown, query = "", headers = {}) =>
	fetch(`${base}/api/visuals${query}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof spec === "string" ? spec : JSON.stringify(spec),
	})

const visuals = async (base: string): Promise<Visual[]> =>
	(await (await fetch(`${base}/api/visuals`)).json()) as Visual[]

const errorPaths = async (res: Response): Promise<string[]> =>
	((await res.json()) as { errors: Array<{ path: string }> }).errors.map((e) => e.path).sort()

const cafe = (extra: Record<string, unknown> = {}) => ({
	datasetId: CAFE.id,
	folderId: null,
	encodings: { x: "month", length: "muffins", hue: "flavor" },
	...extra,
})

describe("POST /api/visuals", () => {
	it("creates a visual under a minted id that GET then returns, unchanged by a load", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, cafe({ title: "Muffins" }))
		expect(res.status).toBe(201)
		const body = (await res.json()) as { id: string; visual: Visual; warnings: unknown[]; editorUrl: string }
		expect(body.id).toMatch(/^vs-[0-9a-z]+-[0-9a-z]{1,6}$/)
		expect(body.visual.id).toBe(body.id)
		expect(body.editorUrl).toBe(`https://charts.example.com/editor/${body.id}`)
		expect(body.warnings).toEqual([])
		const stored = await visuals(base)
		expect(stored).toEqual([body.visual])
		expect(hydrateVisual(body.visual)).toEqual(body.visual)
	})

	it("reads a dataset stored as a whole body only, with no meta", async () => {
		const base = await start()
		await put(base, `/api/datasets/${CAFE.id}`, CAFE)
		expect((await post(base, cafe())).status).toBe(201)
	})

	it("reads rows from the whole body when its meta is gone, not a version file it replaced", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const numbered = {
			...CAFE,
			versions: CAFE.versions.map((v) => ({
				...v,
				rows: v.rows.map((r, i) => ({ ...r, flavor: String(i + 1) })),
			})),
		}
		await put(base, `/api/datasets/${CAFE.id}`, numbered, { "x-vis-versions-managed": "1" })
		const res = await post(base, cafe({ fieldTypes: { flavor: "quantitative" } }), "?dryRun=1")
		expect(res.status).toBe(200)
	})

	it("refuses a dataset whose rows can't be loaded, instead of checking against none", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		for (const entry of readdirSync(dataDir)) rmSync(join(dataDir, entry), { recursive: true, force: true })
		const res = await post(base, cafe())
		expect(res.status).toBe(400)
		expect(await errorPaths(res)).toEqual(["datasetId"])
		expect(await visuals(base)).toEqual([])
	})

	it.each(["1", "true"])("writes nothing on ?dryRun=%s", async (flag) => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, cafe(), `?dryRun=${flag}`)
		expect(res.status).toBe(200)
		expect(((await res.json()) as { visual: Visual }).visual.encodings.x).toEqual({ field: "month" })
		expect(await visuals(base)).toEqual([])
	})

	it("saves on ?dryRun=0 and refuses any other value", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		expect((await post(base, cafe(), "?dryRun=0")).status).toBe(201)
		const res = await post(base, cafe(), "?dryRun=yes")
		expect(res.status).toBe(400)
		expect(await errorPaths(res)).toEqual(["?dryRun"])
		expect(await visuals(base)).toHaveLength(1)
	})

	it("cuts off a body past the spec cap", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		// readBody rejects with 413 and destroys the connection, so a client
		// still sending sees the socket close rather than the response.
		const outcome = await post(base, cafe({ title: "x".repeat(SPEC_BODY_CAP_BYTES) }))
			.then((res) => res.status)
			.catch(() => "closed")
		expect([413, "closed"]).toContain(outcome)
		expect(await visuals(base)).toEqual([])
	})

	it("never overwrites: a taken id gets one fresh retry, then a 500", async () => {
		const ids = ["vs-taken", "vs-fresh"]
		const base = await start(() => ids.shift() ?? "vs-taken")
		await seedDataset(base, CAFE)
		await put(base, "/api/visuals/vs-taken", { id: "vs-taken", name: "Mine" })
		const res = await post(base, cafe())
		expect(res.status).toBe(201)
		expect(((await res.json()) as { id: string }).id).toBe("vs-fresh")
		expect((await post(base, cafe())).status).toBe(500)
		const stored = await visuals(base)
		expect(stored.map((v) => v.id).sort()).toEqual(["vs-fresh", "vs-taken"])
		expect(stored.find((v) => v.id === "vs-taken")?.name).toBe("Mine")
	})

	it("lists every problem, refuses a client-supplied id, and writes nothing", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, {
			id: "vs-mine",
			datasetId: CAFE.id,
			folderId: "fl-nope",
			encodings: { x: "Month", colour: "flavor", length: "muffins" },
			title: 3,
		})
		expect(res.status).toBe(400)
		expect(await errorPaths(res)).toEqual(["encodings.colour", "encodings.x", "folderId", "id", "title"])
		const notJson = await post(base, "{nope")
		expect(await errorPaths(notJson)).toEqual([""])
		expect(await visuals(base)).toEqual([])
	})

	it("styles the visual with the server's default theme, or one named by id or name", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const themeOf = async (spec: unknown) =>
			((await (await post(base, spec, "?dryRun=1")).json()) as { visual: Visual }).visual.themeId
		expect(await themeOf(cafe())).toBe(SYSTEM_LIGHT_THEME.id)
		await put(base, "/api/settings/default-theme", { id: "default-theme", themeId: SYSTEM_DARK_THEME.id })
		expect(await themeOf(cafe())).toBe(SYSTEM_DARK_THEME.id)
		await put(base, "/api/themes/th-basic", { ...SYSTEM_LIGHT_THEME, id: "th-basic", name: "Trilliant Health Basic", isSystem: false })
		expect(await themeOf(cafe({ themeId: "trilliant health basic" }))).toBe("th-basic")
		expect(await themeOf(cafe({ themeId: "System Dark" }))).toBe(SYSTEM_DARK_THEME.id)
		const miss = await post(base, cafe({ themeId: "Trilliant Health" }), "?dryRun=1")
		expect(await errorPaths(miss)).toEqual(["themeId"])
	})

	it("refuses with 409 when stored visuals are at another content version", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		// A stamp only moves forward, so the versions are visited in order.
		await put(base, "/api/content-versions/visuals", { v: VISUALS_VERSION - 1 })
		expect((await post(base, cafe())).status).toBe(409)
		await put(base, "/api/content-versions/visuals", { v: VISUALS_VERSION })
		expect((await post(base, cafe())).status).toBe(201)
		await put(base, "/api/content-versions/visuals", { v: VISUALS_VERSION + 1 })
		expect((await post(base, cafe())).status).toBe(409)
	})

	it("stamps Saved by from the host's identify, and nobody without one", async () => {
		const jane = { id: "jane@example.com", name: "Jane Doe" }
		const base = await start(undefined, (req) => {
			const raw = req.headers["x-test-user"]
			return typeof raw === "string" ? (JSON.parse(raw) as never) : null
		})
		await seedDataset(base, CAFE)
		const res = await post(base, cafe(), "", { "x-test-user": JSON.stringify(jane) })
		expect(((await res.json()) as { visual: Visual }).visual.updatedBy).toEqual(jane)
		expect((await visuals(base))[0]?.updatedBy).toEqual(jane)
		const anonymous = await post(base, cafe())
		expect(((await anonymous.json()) as { visual: Visual }).visual.updatedBy).toBeUndefined()
	})

	it("takes only a JSON body, and from no other site's page", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		expect((await post(base, cafe(), "", { "content-type": "text/plain" })).status).toBe(415)
		expect((await post(base, cafe(), "", { origin: "https://evil.example.com" })).status).toBe(403)
		expect(await visuals(base)).toEqual([])
		expect((await post(base, cafe(), "", { origin: "https://charts.example.com" })).status).toBe(201)
		expect((await post(base, cafe(), "", { "content-type": "application/json; charset=utf-8" })).status).toBe(201)
		expect(await visuals(base)).toHaveLength(2)
	})

	it("leaves PUT and other collection-level writes as they were", async () => {
		const base = await start()
		expect((await put(base, "/api/visuals/vs-a", { id: "vs-a", encodings: { x: "month" } })).status).toBe(204)
		expect(await visuals(base)).toEqual([{ id: "vs-a", encodings: { x: "month" }, thumbnail: null }])
		expect((await fetch(`${base}/api/visuals`, { method: "DELETE" })).status).toBe(405)
		expect((await fetch(`${base}/api/folders`, { method: "POST" })).status).toBe(405)
	})
})

describe("GET /api/chart-spec", () => {
	it("lists channels, families and themes, the default marked", async () => {
		const base = await start()
		const res = await fetch(`${base}/api/chart-spec`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			channels: Array<{ channel: string; conflictsWith: string[] }>
			families: Array<{ family: string; variations: Array<{ name: string }> }>
			editorOnlyFamilies: string[]
			themes: Array<{ id: string; default: boolean }>
			spec: Record<string, string>
			features: string[]
			settingsSlices: string[]
		}
		expect(Object.keys(body.spec)).toEqual(expect.arrayContaining(["datasetId", "encodings", "axes"]))
		expect(body.spec.encodings).toMatch(/Channel → field name/)
		expect(body.features).toEqual(["create", "edit", "restore", "read", "datasets", "settings"])
		expect(body.settingsSlices).toEqual(expect.arrayContaining(["channelConfigs", "annotationsConfig", "accessibilityConfig"]))
		expect(body.settingsSlices).not.toContain("encodings")
		expect(body.channels.map((c) => c.channel)).toContain("hue")
		expect(body.channels.map((c) => c.channel)).not.toContain("text")
		expect(body.channels.find((c) => c.channel === "r")?.conflictsWith).toEqual(
			expect.arrayContaining(["x", "y", "length"])
		)
		const families = body.families.map((f) => f.family)
		expect(families).toContain("dumbbell")
		expect(families).not.toContain("map")
		expect(families).not.toContain("sankey")
		expect(body.editorOnlyFamilies).toEqual(["map", "sankey", "chord"])
		expect(body.families.find((f) => f.family === "dumbbell")?.variations[0]).toMatchObject({
			name: "Dumbbell",
			sameFieldAs: { connection: "y" },
			optional: ["shape", "area"],
		})
		expect(body.themes.filter((t) => t.default).map((t) => t.id)).toEqual([SYSTEM_LIGHT_THEME.id])
		expect((await fetch(`${base}/api/chart-spec`, { method: "POST" })).status).toBe(405)
	})
})

describe("GET /api/chart-spec/settings", () => {
	type Row = { path: string; setting?: string; type: string; doc?: string; value?: unknown }
	const rowsOf = async (res: Response) => ((await res.json()) as { settings: Row[] }).settings

	it("lists every setting with its type and doc, and a visual's values when asked", async () => {
		const base = await start()
		const all = await rowsOf(await fetch(`${base}/api/chart-spec/settings`))
		expect(all.find((r) => r.path === "channelConfigs.facet.panelAxisOverrides.*.yMax")?.type).toMatch(/number/)
		expect(all.find((r) => r.path === "accessibilityConfig.description")?.doc).toBeTruthy()

		await seedDataset(base, CAFE)
		const res = await post(base, cafe({ settings: { channelConfigs: { hue: { colors: { Bran: "#123456" } } } } }))
		expect(res.status).toBe(201)
		const { id } = (await res.json()) as { id: string }
		const own = await rowsOf(await fetch(`${base}/api/chart-spec/settings?visualId=${id}`))
		expect(own.find((r) => r.path === "channelConfigs.hue.colors.Bran")).toMatchObject({
			setting: "channelConfigs.hue.colors.*",
			value: "#123456",
		})
	})

	it("answers 404 for an unknown visual and 405 for anything but GET", async () => {
		const base = await start()
		expect((await fetch(`${base}/api/chart-spec/settings?visualId=vs-nope`)).status).toBe(404)
		expect((await fetch(`${base}/api/chart-spec/settings?visualId=../x`)).status).toBe(404)
		expect((await fetch(`${base}/api/chart-spec/settings`, { method: "POST" })).status).toBe(405)
	})
})

/** The ETag of visual `id` as GET returns it. */
const etagOf = async (base: string, id: string): Promise<string> => {
	const v = (await visuals(base)).find((x) => x.id === id)
	return v ? visualEtag(v) : '"none"'
}

/** A PATCH; If-Match defaults to the visual's current ETag. */
const patch = async (base: string, id: string, edit: unknown, headers?: Record<string, string>, query = "") =>
	fetch(`${base}/api/visuals/${id}${query}`, {
		method: "PATCH",
		headers: headers ?? { "if-match": await etagOf(base, id) },
		body: typeof edit === "string" ? edit : JSON.stringify(edit),
	})

const restore = (base: string, id: string, undo: unknown, etag?: string | null, headers = {}) =>
	fetch(`${base}/api/visuals/${id}/restore`, {
		method: "POST",
		headers: { "content-type": "application/json", ...(etag == null ? {} : { "if-match": etag }), ...headers },
		body: JSON.stringify(undo),
	})

/** A created chart, as GET returns it. */
const created = async (base: string): Promise<Visual> => {
	await seedDataset(base, CAFE)
	const res = await post(base, cafe({ title: "Muffins" }))
	expect(res.status).toBe(201)
	return ((await res.json()) as { visual: Visual }).visual
}

type Edited = { visual: Visual; undo: { visualsVersion: number; visual: Visual } }

describe("PATCH /api/visuals/<id>", () => {
	it("applies an edit that GET then returns, and answers its undo", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "Muffins sold", encodings: { hue: null } })
		expect(res.status).toBe(200)
		const body = (await res.json()) as Edited
		expect(body.visual.labelsConfig.title).toBe("Muffins sold")
		expect(body.visual.encodings.hue).toEqual({ field: null })
		expect(body.visual.updatedAt).toBeGreaterThan(v0.updatedAt ?? 0)
		expect(res.headers.get("etag")).toBe(visualEtag(body.visual))
		expect(res.headers.get("etag")).not.toBe(visualEtag(v0))
		// The stored body holds no thumbnail; GET adds it back as null.
		expect(body.undo.visualsVersion).toBe(VISUALS_VERSION)
		expect({ ...body.undo.visual, thumbnail: null }).toEqual(v0)
		expect(await visuals(base)).toEqual([body.visual])
	})

	it("refuses a stale, missing or * If-Match, changing nothing", async () => {
		const base = await start()
		const v0 = await created(base)
		const etag = visualEtag(v0)
		expect((await patch(base, v0.id, { title: "x" }, { "if-match": String(v0.updatedAt) })).status).toBe(412)
		expect((await patch(base, v0.id, { title: "x" }, {})).status).toBe(428)
		expect((await patch(base, v0.id, { title: "x" }, { "if-match": "*" })).status).toBe(400)
		expect((await patch(base, v0.id, { title: "x" }, { "if-match": `W/${etag}` })).status).toBe(200)
		const res = await patch(base, v0.id, { title: "y" }, { "if-match": etag })
		expect(res.status).toBe(412)
		expect((await visuals(base))[0]?.labelsConfig.title).toBe("x")
	})

	it("stamps what the chart draws, not when or by whom it was saved", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await post(base, cafe({ title: "Muffins" }))
		expect(res.headers.get("etag")).toBe(visualEtag(((await res.json()) as { visual: Visual }).visual))
		const etag = visualEtag(v0)
		// An editor opening the chart: a new preview and save stamps, keys in another order.
		const viewed = { ...v0, thumbnail: "data:image/png;base64,AAAA", thumbnailAt: 2, updatedAt: v0.updatedAt + 5 }
		await put(base, `/api/visuals/${v0.id}`, Object.fromEntries(Object.entries(viewed).reverse()))
		expect(await etagOf(base, v0.id)).toBe(etag)
		await put(base, `/api/visuals/${v0.id}`, { ...viewed, name: "Renamed" })
		expect(await etagOf(base, v0.id)).not.toBe(etag)
		expect((await patch(base, v0.id, { title: "x" }, { "if-match": etag })).status).toBe(412)
	})

	it("checks without saving on ?dryRun=1, and lists every problem", async () => {
		const base = await start()
		const v0 = await created(base)
		const dry = await patch(base, v0.id, { title: "x" }, undefined, "?dryRun=1")
		expect(dry.status).toBe(200)
		const bad = await patch(base, v0.id, { datasetId: "ds-x", encodings: { x: "Month" } })
		expect(bad.status).toBe(400)
		expect(await errorPaths(bad)).toEqual(["datasetId", "encodings.x"])
		expect(await errorPaths(await patch(base, v0.id, {}))).toEqual([""])
		expect(await errorPaths(await patch(base, v0.id, "{nope"))).toEqual([""])
		expect(await visuals(base)).toEqual([v0])
	})

	it("answers 404 for an unknown visual, 400 for a bad id and 409 for a trashed one", async () => {
		const base = await start()
		const v0 = await created(base)
		expect((await patch(base, "vs-nope", { title: "x" }, { "if-match": "0" })).status).toBe(404)
		expect((await patch(base, "bad%20id", { title: "x" }, { "if-match": "0" })).status).toBe(400)
		await put(base, `/api/visuals/${v0.id}`, { ...v0, deletedAt: 1 })
		expect((await patch(base, v0.id, { title: "x" })).status).toBe(409)
	})

	it("clears the stale thumbnail", async () => {
		const base = await start()
		const v0 = await created(base)
		await put(base, `/api/visuals/${v0.id}`, { ...v0, thumbnail: "data:image/png;base64,AAAA" })
		expect((await patch(base, v0.id, { title: "x" })).status).toBe(200)
		expect((await visuals(base))[0]?.thumbnail).toBeNull()
	})
})

describe("GET /api/visuals/<id>", () => {
	it("answers the stored visual without its preview, and the ETag an edit takes", async () => {
		const base = await start()
		const v0 = await created(base)
		await put(base, `/api/visuals/${v0.id}`, { ...v0, thumbnail: "data:image/png;base64,AAAA", thumbnailAt: 2 })
		const res = await fetch(`${base}/api/visuals/${v0.id}`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as Visual
		const listed = (await (await fetch(`${base}/api/visuals?thumbnails=0`)).json()) as Visual[]
		expect(body).toEqual(listed[0])
		expect(body).not.toHaveProperty("thumbnail")
		const etag = res.headers.get("etag")
		expect(etag).toBe(visualEtag(v0))
		expect((await patch(base, v0.id, { title: "x" }, { "if-match": etag ?? "" })).status).toBe(200)
		expect((await fetch(`${base}/api/visuals/${v0.id}`)).headers.get("etag")).not.toBe(etag)
	})

	it("answers 404 for an unknown, trashed or deleted visual and 400 for a bad id", async () => {
		const base = await start()
		const v0 = await created(base)
		expect((await fetch(`${base}/api/visuals/vs-nope`)).status).toBe(404)
		expect((await fetch(`${base}/api/visuals/bad%20id`)).status).toBe(400)
		await put(base, `/api/visuals/${v0.id}`, { ...v0, deletedAt: 1 })
		expect((await fetch(`${base}/api/visuals/${v0.id}`)).status).toBe(404)
		await fetch(`${base}/api/visuals/${v0.id}`, { method: "DELETE" })
		expect((await fetch(`${base}/api/visuals/${v0.id}`)).status).toBe(404)
	})
})

describe("POST /api/visuals/<id>/restore", () => {
	const edit = async (base: string) => {
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "Changed" })
		const body = (await res.json()) as Edited
		return { v0, ...body, etag: res.headers.get("etag") }
	}

	it("puts back the visual the edit replaced, under a new updatedAt", async () => {
		const base = await start()
		const { v0, visual, undo, etag } = await edit(base)
		const res = await restore(base, v0.id, undo, etag)
		expect(res.status).toBe(200)
		const { updatedAt } = (await res.json()) as { updatedAt: number }
		expect(updatedAt).toBeGreaterThan(visual.updatedAt ?? 0)
		expect(await visuals(base)).toEqual([{ ...v0, updatedAt }])
		expect(res.headers.get("etag")).toBe(visualEtag(v0))
	})

	it("still undoes after an editor saves a new preview of the edited chart", async () => {
		const base = await start()
		const { v0, visual, undo, etag } = await edit(base)
		const viewed = { ...visual, thumbnail: "data:image/png;base64,AAAA", thumbnailAt: 9, updatedAt: visual.updatedAt + 5 }
		await put(base, `/api/visuals/${v0.id}`, viewed)
		const res = await restore(base, v0.id, undo, etag)
		expect(res.status).toBe(200)
		expect((await visuals(base))[0]?.labelsConfig.title).toBe("Muffins")
	})

	it("refuses when the visual changed after the edit, and keeps the change", async () => {
		const base = await start()
		const { v0, visual, undo, etag } = await edit(base)
		await put(base, `/api/visuals/${v0.id}`, { ...visual, labelsConfig: { ...visual.labelsConfig, subtitle: "Later" } })
		expect((await restore(base, v0.id, undo, etag)).status).toBe(412)
		expect((await patch(base, v0.id, { title: "Later" })).status).toBe(200)
		expect((await restore(base, v0.id, undo, etag)).status).toBe(412)
		expect((await visuals(base))[0]?.labelsConfig.title).toBe("Later")
	})

	it("refuses an undo from another version, another visual, a partial one, or without If-Match", async () => {
		const base = await start()
		const { v0, undo, etag } = await edit(base)
		expect((await restore(base, v0.id, { ...undo, visualsVersion: 1 }, etag)).status).toBe(409)
		expect((await restore(base, v0.id, { ...undo, visual: { ...v0, id: "vs-other" } }, etag)).status).toBe(400)
		expect((await restore(base, v0.id, { ...undo, visual: { id: v0.id } }, etag)).status).toBe(400)
		expect((await restore(base, v0.id, undo)).status).toBe(428)
		expect((await restore(base, v0.id, undo, etag, { "content-type": "text/plain" })).status).toBe(415)
		expect((await restore(base, v0.id, undo, etag, { origin: "https://evil.example.com" })).status).toBe(403)
		expect((await visuals(base))[0]?.labelsConfig.title).toBe("Changed")
	})
})

describe("Saved by on edits and undos", () => {
	const jane = { id: "jane@example.com", name: "Jane Doe" }
	const nancy = { id: "nancy@example.com", name: "Nancy Organ" }
	const as = (user: typeof jane | null): Record<string, string> =>
		user ? { "x-test-user": JSON.stringify(user) } : {}

	it("stamps the requester, or keeps the stored saver when anonymous", async () => {
		const base = await start(undefined, (req) => {
			const raw = req.headers["x-test-user"]
			return typeof raw === "string" ? (JSON.parse(raw) as never) : null
		})
		await seedDataset(base, CAFE)
		const v0 = ((await (await post(base, cafe(), "", as(jane))).json()) as { visual: Visual }).visual
		const editAs = async (v: Visual, user: typeof jane | null) =>
			(await (await patch(base, v.id, { title: "x" }, { "if-match": visualEtag(v), ...as(user) })).json()) as Edited
		const byNancy = await editAs(v0, nancy)
		expect(byNancy.visual.updatedBy).toEqual(nancy)
		const anonymous = await editAs(byNancy.visual, null)
		expect(anonymous.visual.updatedBy).toEqual(nancy)
		expect((await restore(base, v0.id, anonymous.undo, visualEtag(anonymous.visual), as(jane))).status).toBe(200)
		expect((await visuals(base))[0]?.updatedBy).toEqual(jane)
	})
})

describe("POST /api/datasets", () => {
	const create = (base: string, body: unknown, headers = {}) =>
		fetch(`${base}/api/datasets`, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		})
	const index = async (base: string) =>
		(await (await fetch(`${base}/api/datasets?view=index`)).json()) as Record<string, DatasetMeta | null>

	it("stores rows as text, infers types as an upload does, and lists the dataset whole", async () => {
		const base = await start()
		const res = await create(base, {
			name: "Visits",
			rows: [
				{ when: "2026-01-05T10:00:00Z", count: "1e3", site: "North", open: true },
				{ when: "2026-02-01T00:00:00Z", count: 25, site: null, open: false },
			],
			types: { site: "categorical" },
		})
		expect(res.status).toBe(201)
		const made = (await res.json()) as { id: string; rowCount: number; fields: Array<{ name: string; type: string }> }
		expect(made.rowCount).toBe(2)
		expect(made.fields).toEqual([
			{ name: "when", type: "temporal" },
			{ name: "count", type: "quantitative" },
			{ name: "site", type: "categorical" },
			{ name: "open", type: "categorical" },
		])
		const meta = (await index(base))[made.id]
		expect(meta?.name).toBe("Visits")
		expect(meta?.contentHash).toEqual(expect.any(String))
		expect(meta?.versions).toEqual([expect.objectContaining({ id: meta?.latestVersionId, rowCount: 2 })])
		const body = (await (await fetch(`${base}/api/datasets/${made.id}`)).json()) as Dataset
		expect(body.versions[0]?.rows[1]).toEqual({ when: "2026-02-01T00:00:00Z", count: "25", site: "", open: "false" })
		const version = await fetch(`${base}/api/datasets/${made.id}/versions/${meta?.latestVersionId}`)
		expect(version.status).toBe(200)
	})

	it("makes a dataset a chart spec can use", async () => {
		const base = await start()
		const res = await create(base, { name: "Muffins", rows: [{ month: "Jan", muffins: 3 }, { month: "Feb", muffins: 5 }] })
		const { id } = (await res.json()) as { id: string }
		const chart = await post(base, { datasetId: id, folderId: null, encodings: { x: "month", length: "muffins" } })
		expect(chart.status).toBe(201)
	})

	it("reads only a column's own cells and types, even for a column named toString", async () => {
		const base = await start()
		const res = await create(base, {
			name: "Odd names",
			rows: [{ toString: "A", constructor: "B" }, { other: 2 }],
			types: { other: "categorical" },
		})
		expect(res.status).toBe(201)
		const made = (await res.json()) as { id: string; fields: Array<{ name: string; type: string }> }
		expect(made.fields).toEqual([
			{ name: "toString", type: "categorical" },
			{ name: "constructor", type: "categorical" },
			{ name: "other", type: "categorical" },
		])
		const body = (await (await fetch(`${base}/api/datasets/${made.id}`)).json()) as Dataset
		expect(body.versions[0]?.rows[1]).toEqual({ toString: "", constructor: "", other: "2" })
	})

	it("reports every problem with its path and stores nothing", async () => {
		const base = await start()
		const res = await create(base, { name: " ", rows: [{ a: 1 }, "x", { b: { deep: 1 } }], types: [] })
		expect(res.status).toBe(400)
		const { errors } = (await res.json()) as { errors: Array<{ path: string }> }
		expect(errors.map((e) => e.path)).toEqual(["name", "rows[1]", "rows[2].b", "types"])
		const typed = await create(base, { name: "T", rows: [{ a: 1 }], types: { b: "quantitative", a: "money" } })
		expect(((await typed.json()) as { errors: Array<{ path: string }> }).errors.map((e) => e.path)).toEqual(["types.b", "types.a"])
		expect(await index(base)).toEqual({})
	})

	it("refuses sparse rows whose filled-out size passes the limit, before filling them out", async () => {
		const base = await start()
		const rows = Array.from({ length: 4000 }, (_, i) => ({ [`c${i}`]: 1 }))
		const res = await create(base, { name: "Sparse", rows })
		expect(res.status).toBe(413)
		expect(((await res.json()) as { error: string }).error).toContain("limit")
		expect(await index(base)).toEqual({})
	})

	it("takes only a JSON body, and from no other site's page", async () => {
		const base = await start()
		const body = { name: "Visits", rows: [{ a: 1 }] }
		expect((await create(base, body, { "content-type": "text/plain" })).status).toBe(415)
		expect((await create(base, body, { origin: "https://evil.example.com" })).status).toBe(403)
		expect(await index(base)).toEqual({})
		expect((await create(base, body, { origin: "https://charts.example.com" })).status).toBe(201)
	})

	it("refuses a name already in the library", async () => {
		const base = await start()
		expect((await create(base, { name: "Visits", rows: [{ a: 1 }] })).status).toBe(201)
		expect((await create(base, { name: " visits ", rows: [{ a: 2 }] })).status).toBe(409)
		expect(Object.keys(await index(base))).toHaveLength(1)
	})

	it("lists nothing when publishing fails part way", async () => {
		const base = await start()
		const spy = vi.spyOn(dbModule, "upsertDatasetMeta").mockImplementationOnce(() => {
			throw new Error("disk full")
		})
		expect((await create(base, { name: "Visits", rows: [{ a: 1 }] })).status).toBe(500)
		spy.mockRestore()
		expect(await index(base)).toEqual({})
		expect(readdirSync(dataDir)).toEqual([])
	})

	it("takes rows while visuals await migration, and refuses before writing when datasets do", async () => {
		const base = await start()
		await put(base, "/api/content-versions/visuals", { v: VISUALS_VERSION - 1 })
		expect((await create(base, { name: "Visits", rows: [{ a: 1 }] })).status).toBe(201)
		await put(base, "/api/content-versions/datasets", { v: DATASETS_VERSION + 1 })
		const refused = await create(base, { name: "More", rows: [{ a: 1 }] })
		expect(refused.status).toBe(409)
		expect(Object.keys(await index(base))).toHaveLength(1)
		expect(readdirSync(dataDir)).toHaveLength(2)
	})
})
