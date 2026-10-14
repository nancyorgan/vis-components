// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { datasetMetaFrom } from "../../src/contexts/chartBuilder/lib/datasetMeta"
import { VISUALS_VERSION } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import { SYSTEM_DARK_THEME } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { Dataset, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { hydrateVisual } from "../../src/contexts/chartBuilder/lib/visualDefaults"
import { MAX_PROBLEMS } from "../../src/contexts/chartBuilder/lib/visualSpec/chartSpec"
import { CAFE, TRENDS } from "../../src/testSupport/chartSpecFixtures"
import { openDb } from "./db.js"
import { SPEC_BODY_CAP_BYTES } from "./limits.js"
import { createHandler } from "./routes.js"

/** A fresh server per test: these assert on whole collections. */
const servers: Server[] = []
const start = async (mintVisualId?: () => string): Promise<string> => {
	const dbDir = mkdtempSync(join(tmpdir(), "vis-spec-db-"))
	const distDir = mkdtempSync(join(tmpdir(), "vis-spec-dist-"))
	writeFileSync(join(distDir, "index.html"), "<title>spa</title>")
	const handler = createHandler({
		config: {
			baseUrl: "https://charts.example.com",
			dbDir,
			dataDir: mkdtempSync(join(tmpdir(), "vis-spec-data-")),
			port: 0,
			publishDir: mkdtempSync(join(tmpdir(), "vis-spec-publish-")),
			publishBaseUrl: "https://embeds.example.com",
		},
		db: openDb(dbDir),
		distDir,
		mintVisualId,
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
	await put(base, `/api/datasets/${dataset.id}`, dataset, {
		"x-vis-versions-managed": "1",
	})
	for (const version of dataset.versions) {
		await put(base, `/api/datasets/${dataset.id}/versions/${version.id}`, version)
	}
	await put(base, `/api/datasets/${dataset.id}/meta`, datasetMetaFrom(dataset))
}

const post = (base: string, spec: unknown, query = "") =>
	fetch(`${base}/api/visuals${query}`, {
		method: "POST",
		body: typeof spec === "string" ? spec : JSON.stringify(spec),
	})

const visuals = async (base: string): Promise<Visual[]> =>
	(await (await fetch(`${base}/api/visuals`)).json()) as Visual[]

const cafe = (extra: Record<string, unknown> = {}) => ({
	datasetId: CAFE.id,
	folderId: null,
	encodings: { x: "month", length: "muffins", hue: "flavor" },
	...extra,
})

describe("POST /api/visuals", () => {
	it("creates a visual under a minted id that GET then returns", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, cafe({ title: "Muffins" }))
		expect(res.status).toBe(201)
		const body = (await res.json()) as {
			id: string
			visual: Visual
			warnings: unknown[]
			editorUrl: string
		}
		expect(body.id).toMatch(/^vs-[0-9a-z]+-[0-9a-z]{1,6}$/)
		expect(body.visual.id).toBe(body.id)
		expect(body.editorUrl).toBe(`https://charts.example.com/editor/${body.id}`)
		expect(body.warnings).toEqual([])
		expect(await visuals(base)).toEqual([body.visual])
	})

	it("stores a Trends chart that a load leaves unchanged", async () => {
		const base = await start()
		const [t1] = TRENDS
		await seedDataset(base, t1.dataset)
		const res = await post(base, { ...t1.spec, folderId: null })
		expect(res.status).toBe(201)
		const [stored] = await visuals(base)
		expect(stored).toBeDefined()
		expect(hydrateVisual(stored as Visual)).toEqual(stored)
		expect(stored?.labelsConfig.title).toBe(t1.spec.title)
	})

	it("reads a dataset stored as a whole body only, with no meta", async () => {
		const base = await start()
		await put(base, `/api/datasets/${CAFE.id}`, CAFE)
		expect((await post(base, cafe({ colors: { Lemon: "#ff0" } }))).status).toBe(201)
	})

	it.each(["1", "true"])("writes nothing on ?dryRun=%s", async (flag) => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, cafe(), `?dryRun=${flag}`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { visual: Visual; warnings: unknown[] }
		expect(body.visual.encodings.x).toEqual({ field: "month" })
		expect(await visuals(base)).toEqual([])
	})

	it.each(["0", "false"])("saves on ?dryRun=%s", async (flag) => {
		const base = await start()
		await seedDataset(base, CAFE)
		expect((await post(base, cafe(), `?dryRun=${flag}`)).status).toBe(201)
		expect(await visuals(base)).toHaveLength(1)
	})

	it("rejects any other dryRun value and writes nothing", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, cafe(), "?dryRun=yes")
		expect(res.status).toBe(400)
		const { errors } = (await res.json()) as { errors: { path: string }[] }
		expect(errors.map((e) => e.path)).toEqual(["?dryRun"])
		expect(await visuals(base)).toEqual([])
	})

	it("cuts off a body past the spec cap the way every capped route does", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		// readBody rejects with 413 and destroys the connection, so a client
		// still sending sees the socket close rather than the response.
		const outcome = await post(base, { ...cafe(), title: "x".repeat(SPEC_BODY_CAP_BYTES) })
			.then((res) => res.status)
			.catch(() => "closed")
		expect([413, "closed"]).toContain(outcome)
		expect(await visuals(base)).toEqual([])
		expect((await post(base, cafe())).status).toBe(201)
	})

	it("answers a body of thousands of unknown keys quickly, with a capped list", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const junk = Object.fromEntries(
			Array.from({ length: 4000 }, (_, i) => [`k${i}`, 0])
		)
		const started = performance.now()
		const res = await post(base, { ...cafe(), ...junk })
		expect(performance.now() - started).toBeLessThan(1000)
		expect(res.status).toBe(400)
		const { errors } = (await res.json()) as { errors: { message: string }[] }
		expect(errors).toHaveLength(MAX_PROBLEMS + 1)
		expect(errors.at(-1)?.message).toBe(`…and ${4000 - MAX_PROBLEMS} more`)
	})

	it("never overwrites: a taken id gets one fresh retry", async () => {
		const ids = ["vs-taken", "vs-fresh"]
		const base = await start(() => ids.shift() ?? "vs-spare")
		await seedDataset(base, CAFE)
		await put(base, "/api/visuals/vs-taken", { id: "vs-taken", name: "Mine" })
		const res = await post(base, cafe())
		expect(res.status).toBe(201)
		const body = (await res.json()) as { id: string; visual: Visual; editorUrl: string }
		expect(body.id).toBe("vs-fresh")
		expect(body.visual.id).toBe("vs-fresh")
		expect(body.editorUrl).toMatch(/\/editor\/vs-fresh$/)
		const stored = await visuals(base)
		expect(stored.find((v) => v.id === "vs-taken")?.name).toBe("Mine")
		expect(stored.map((v) => v.id).sort()).toEqual(["vs-fresh", "vs-taken"])
	})

	it("answers 500 rather than overwrite when the retry collides too", async () => {
		const base = await start(() => "vs-taken")
		await seedDataset(base, CAFE)
		await put(base, "/api/visuals/vs-taken", { id: "vs-taken", name: "Mine" })
		const res = await post(base, cafe())
		expect(res.status).toBe(500)
		expect(await visuals(base)).toEqual([
			{ id: "vs-taken", name: "Mine", thumbnail: null },
		])
	})

	it("lists every problem of a faulty spec and writes nothing", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, {
			datasetId: CAFE.id,
			folderId: "fl-nope",
			encodings: { x: "Month", colour: "flavor", length: "muffins" },
			title: 3,
			family: "bars",
		})
		expect(res.status).toBe(400)
		const { errors } = (await res.json()) as { errors: { path: string }[] }
		expect(errors.map((e) => e.path).sort()).toEqual(
			["encodings.colour", "encodings.x", "family", "folderId", "title"].sort()
		)
		expect(await visuals(base)).toEqual([])
	})

	it("rejects an unknown dataset", async () => {
		const base = await start()
		const res = await post(base, cafe({ datasetId: "ds-nope" }))
		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({
			errors: [{ path: "datasetId", message: 'no dataset with id "ds-nope"' }],
		})
	})

	it("rejects a client-supplied id rather than overwriting", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		await put(base, "/api/visuals/vs-mine", { id: "vs-mine", name: "Mine" })
		const res = await post(base, cafe({ id: "vs-mine" }))
		expect(res.status).toBe(400)
		const { errors } = (await res.json()) as { errors: { path: string }[] }
		expect(errors.map((e) => e.path)).toEqual(["id"])
		expect(await visuals(base)).toEqual([
			{ id: "vs-mine", name: "Mine", thumbnail: null },
		])
	})

	it("answers 400 with a path-less error for a body that isn't JSON", async () => {
		const base = await start()
		const res = await post(base, "{nope")
		expect(res.status).toBe(400)
		expect(((await res.json()) as { errors: { path: string }[] }).errors[0]?.path).toBe("")
	})

	it("styles the visual with the server's default theme", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		await put(base, "/api/settings/default-theme", {
			id: "default-theme",
			themeId: SYSTEM_DARK_THEME.id,
		})
		const res = await post(base, cafe(), "?dryRun=1")
		const { visual } = (await res.json()) as { visual: Visual }
		expect(visual.themeId).toBe(SYSTEM_DARK_THEME.id)
	})

	it("refuses with 409 when stored visuals are at another content version", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		for (const v of [VISUALS_VERSION - 1, VISUALS_VERSION + 1]) {
			await put(base, "/api/content-versions/visuals", { v })
			const res = await post(base, cafe())
			expect(res.status).toBe(409)
		}
		await put(base, "/api/content-versions/visuals", { v: VISUALS_VERSION })
		expect((await post(base, cafe())).status).toBe(201)
	})

	it("keeps other collection-level writes at 405", async () => {
		const base = await start()
		expect((await fetch(`${base}/api/visuals`, { method: "DELETE" })).status).toBe(405)
		expect((await fetch(`${base}/api/visuals`, { method: "PUT" })).status).toBe(405)
		expect((await fetch(`${base}/api/folders`, { method: "POST" })).status).toBe(405)
	})
})

describe("PUT /api/visuals/:id is unchanged", () => {
	it("still stores today's permissive bodies verbatim", async () => {
		const base = await start()
		const bodies = [
			{ id: "vs-a", encodings: { x: "month", length: "muffins" } },
			{ id: "vs-b", encodings: { color: { field: "flavor" } } },
			{ id: "vs-c" },
		]
		for (const body of bodies) {
			expect((await put(base, `/api/visuals/${body.id}`, body)).status).toBe(204)
		}
		// The collection GET adds the stored thumbnail column back.
		expect(await visuals(base)).toEqual(
			bodies.map((b) => ({ ...b, thumbnail: null }))
		)
	})
})

const patch = (base: string, id: string, edit: unknown, headers: Record<string, string> = { "if-match": "*" }, query = "") =>
	fetch(`${base}/api/visuals/${id}${query}`, {
		method: "PATCH",
		headers,
		body: typeof edit === "string" ? edit : JSON.stringify(edit),
	})

/** A created chart, as GET returns it. */
const created = async (base: string): Promise<Visual> => {
	await seedDataset(base, CAFE)
	const res = await post(base, cafe({ title: "Muffins" }))
	expect(res.status).toBe(201)
	return ((await res.json()) as { visual: Visual }).visual
}

describe("PATCH /api/visuals/<id>", () => {
	it("applies an edit that GET then returns", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "More muffins" }, { "if-match": String(v0.updatedAt) })
		expect(res.status).toBe(200)
		const body = (await res.json()) as { id: string; visual: Visual; editorUrl: string }
		expect(body.visual.labelsConfig.title).toBe("More muffins")
		expect(body.visual.updatedAt).toBeGreaterThan(v0.updatedAt)
		expect(body.editorUrl).toBe(`https://charts.example.com/editor/${v0.id}`)
		const [stored] = await visuals(base)
		expect(stored).toEqual({ ...body.visual, thumbnail: null })
		expect(hydrateVisual(stored as Visual)).toEqual(stored)
	})

	it("refuses when the chart changed since it was read", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "x" }, { "if-match": String(v0.updatedAt - 1) })
		expect(res.status).toBe(409)
		expect(((await res.json()) as { error: string }).error).toMatch(/changed since it was read/)
		expect((await visuals(base))[0]?.labelsConfig.title).toBe("Muffins")
	})

	it("requires If-Match, and takes * as any version", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "x" }, {})
		expect(res.status).toBe(428)
		expect((await visuals(base))[0]).toEqual(v0)
		expect((await patch(base, v0.id, { title: "y" }, { "if-match": "*" })).status).toBe(200)
	})

	it("refuses an edit that names nothing", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, {})
		expect(res.status).toBe(400)
		expect((await visuals(base))[0]).toEqual(v0)
	})

	it("accepts a quoted If-Match", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "q" }, { "if-match": `"${v0.updatedAt}"` })
		expect(res.status).toBe(200)
	})

	it("checks without saving on ?dryRun=1", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "dry" }, undefined, "?dryRun=1")
		expect(res.status).toBe(200)
		expect(((await res.json()) as { visual: Visual }).visual.labelsConfig.title).toBe("dry")
		expect((await visuals(base))[0]).toEqual(v0)
	})

	it("reports every problem with its path and saves nothing", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { encodings: { x: "nope" }, colors: { Mint: "#000" }, wat: 1 })
		expect(res.status).toBe(400)
		const { errors } = (await res.json()) as { errors: Array<{ path: string }> }
		expect(errors.map((e) => e.path).sort()).toEqual(["colors.Mint", "encodings.x", "wat"])
		expect((await visuals(base))[0]).toEqual(v0)
	})

	it("answers 404 for an unknown visual and 400 for a bad id", async () => {
		const base = await start()
		await created(base)
		expect((await patch(base, "vs-missing", { title: "x" })).status).toBe(404)
		expect((await patch(base, "..%2Fx", { title: "x" })).status).toBe(400)
	})

	it("refuses a trashed visual", async () => {
		const base = await start()
		const v0 = await created(base)
		await put(base, `/api/visuals/${v0.id}`, { ...v0, deletedAt: 1 })
		const res = await patch(base, v0.id, { title: "x" })
		expect(res.status).toBe(409)
	})

	it("refuses invalid JSON and an over-cap body", async () => {
		const base = await start()
		const v0 = await created(base)
		expect((await patch(base, v0.id, "{")).status).toBe(400)
		const big = JSON.stringify({ title: "x".repeat(SPEC_BODY_CAP_BYTES) })
		const outcome = await patch(base, v0.id, big).then(
			(r) => r.status,
			() => "closed"
		)
		expect([413, "closed"]).toContain(outcome)
		expect((await visuals(base))[0]).toEqual(v0)
	})

	it("clears the stale thumbnail and keeps the chart otherwise", async () => {
		const base = await start()
		const v0 = await created(base)
		await put(base, `/api/visuals/${v0.id}`, { ...v0, thumbnail: "data:image/png;base64,AAAA" })
		const [withThumb] = await visuals(base)
		expect(withThumb?.thumbnail).toBe("data:image/png;base64,AAAA")
		const res = await patch(base, v0.id, { subtitle: "s" })
		expect(res.status).toBe(200)
		expect((await visuals(base))[0]?.thumbnail).toBeNull()
	})

	it("does not take POST-only or PATCH on other collections", async () => {
		const base = await start()
		expect((await fetch(`${base}/api/folders/fl-x`, { method: "PATCH", body: "{}" })).status).toBe(405)
	})
})

describe("GET /api/chart-spec", () => {
	it("lists channels and the families of the quick-start decision tree", async () => {
		const base = await start()
		const res = await fetch(`${base}/api/chart-spec`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as {
			channels: Array<{ channel: string; conflictsWith: string[] }>
			families: Array<{ family: string; variations: Array<{ name: string; sameFieldAs?: object }> }>
		}
		expect(body.channels.map((c) => c.channel)).toContain("hue")
		expect(body.channels.map((c) => c.channel)).not.toContain("text")
		expect(body.channels.find((c) => c.channel === "r")?.conflictsWith).toEqual(
			expect.arrayContaining(["x", "y", "length"])
		)
		const dumbbell = body.families.find((f) => f.family === "dumbbell")
		expect(dumbbell?.variations[0]).toMatchObject({ name: "Dumbbell", sameFieldAs: { connection: "y" } })
		expect(body.families.map((f) => f.family)).not.toContain("lollipop")
		expect((await fetch(`${base}/api/chart-spec`, { method: "POST" })).status).toBe(405)
	})
})

describe("GET /api/chart-spec/settings", () => {
	it("lists default settings, filters by words, and reads one visual's values", async () => {
		const base = await start()
		const all = (await (await fetch(`${base}/api/chart-spec/settings`)).json()) as { count: number; settings: Array<{ path: string; type: string }> }
		expect(all.count).toBeGreaterThan(100)
		expect(all.settings.every((s) => !s.path.startsWith("encodings"))).toBe(true)
		const lines = (await (await fetch(`${base}/api/chart-spec/settings?q=connection%20stroke`)).json()) as { settings: Array<{ path: string }> }
		expect(lines.settings.map((s) => s.path)).toContain("channelConfigs.connection.strokeColor")
		const v0 = await created(base)
		await patch(base, v0.id, { settings: { legendConfig: { position: "top" } } })
		const mine = (await (await fetch(`${base}/api/chart-spec/settings?visualId=${v0.id}&q=legendConfig.position`)).json()) as { settings: Array<{ path: string; value: unknown }> }
		expect(mine.settings.find((s) => s.path === "legendConfig.position")?.value).toBe("top")
		expect((await fetch(`${base}/api/chart-spec/settings?visualId=vs-none`)).status).toBe(404)
	})
})
