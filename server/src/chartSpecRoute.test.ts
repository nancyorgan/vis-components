// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { datasetMetaFrom } from "../../src/contexts/chartBuilder/lib/datasetMeta"
import { pieceKey } from "../../src/contexts/chartBuilder/lib/labelPieces"
import { DATASETS_VERSION, VISUALS_VERSION } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { Dataset, DatasetMeta, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { hydrateVisual } from "../../src/contexts/chartBuilder/lib/visualDefaults"
import { MAX_PROBLEMS } from "../../src/contexts/chartBuilder/lib/visualSpec/chartSpec"
import { CAFE, TRENDS } from "../../src/testSupport/chartSpecFixtures"
import { openDb } from "./db.js"
import * as dbModule from "./db.js"
import { SPEC_BODY_CAP_BYTES } from "./limits.js"
import type { IdentifyUser } from "./identity.js"
import { createHandler } from "./routes.js"

/** A fresh server per test: these assert on whole collections. */
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
	it("refuses a dataset whose rows can't be loaded, instead of checking against none", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		for (const entry of readdirSync(dataDir)) rmSync(join(dataDir, entry), { recursive: true, force: true })
		const res = await post(base, cafe())
		expect(res.status).toBe(400)
		const { errors } = (await res.json()) as { errors: { path: string; message: string }[] }
		expect(errors).toEqual([expect.objectContaining({ path: "datasetId", message: expect.stringMatching(/rows can't be loaded/) })])
		expect(await visuals(base)).toEqual([])
	})

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

	it("takes a theme by name, ignoring case, and lists the themes on a miss", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		await put(base, "/api/themes/th-basic", { ...SYSTEM_LIGHT_THEME, id: "th-basic", name: "Trilliant Health Basic", isSystem: false })
		const res = await post(base, cafe({ themeId: "trilliant health basic" }), "?dryRun=1")
		expect(res.status).toBe(200)
		expect(((await res.json()) as { visual: Visual }).visual.themeId).toBe("th-basic")
		const miss = await post(base, cafe({ themeId: "Trilliant Health" }), "?dryRun=1")
		expect(miss.status).toBe(400)
		const [error] = ((await miss.json()) as { errors: Array<{ path: string; message: string }> }).errors
		expect(error?.path).toBe("themeId")
		expect(error?.message).toMatch(/^no theme with id or name "Trilliant Health" \(themes: .*"System \(Dark\)" \(system-dark\).*"Trilliant Health Basic" \(th-basic\)\)$/)
	})

	it("matches a theme name ignoring spaces and punctuation, refusing ties", async () => {
		const base = await start()
		await seedDataset(base, CAFE)
		const res = await post(base, cafe({ themeId: "System Dark" }), "?dryRun=1")
		expect(res.status).toBe(200)
		expect(((await res.json()) as { visual: Visual }).visual.themeId).toBe(SYSTEM_DARK_THEME.id)
		await put(base, "/api/themes/th-a", { ...SYSTEM_LIGHT_THEME, id: "th-a", name: "Brand-A", isSystem: false })
		await put(base, "/api/themes/th-b", { ...SYSTEM_LIGHT_THEME, id: "th-b", name: "Brand A", isSystem: false })
		const tie = await post(base, cafe({ themeId: "brand a" }), "?dryRun=1")
		expect(tie.status).toBe(400)
		const [error] = ((await tie.json()) as { errors: Array<{ path: string }> }).errors
		expect(error?.path).toBe("themeId")
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

/** A PATCH; If-Match defaults to the visual's current updatedAt. */
const patch = async (base: string, id: string, edit: unknown, headers?: Record<string, string>, query = "") =>
	fetch(`${base}/api/visuals/${id}${query}`, {
		method: "PATCH",
		headers: headers ?? { "if-match": String((await visuals(base)).find((v) => v.id === id)?.updatedAt ?? 0) },
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

	it("saves a visual stored in the old joined-key shape structured, as the editor does", async () => {
		const base = await start()
		const v0 = await created(base)
		const joined = pieceKey("lbl-1", "flavor")
		const legacy = {
			...v0,
			dataLabelsConfig: { ...v0.dataLabelsConfig, fieldSizes: { [joined]: 9 } },
		}
		expect((await put(base, `/api/visuals/${v0.id}`, legacy)).status).toBe(204)
		const res = await patch(base, v0.id, { title: "x" }, { "if-match": String(v0.updatedAt) })
		expect(res.status).toBe(200)
		const [stored] = await visuals(base)
		expect(stored.dataLabelsConfig?.fieldSizes).toEqual({})
		expect(stored.dataLabelsConfig?.pieces?.["lbl-1"]?.flavor).toEqual({ size: 9 })
	})

	it("refuses when the chart changed since it was read", async () => {
		const base = await start()
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "x" }, { "if-match": String(v0.updatedAt - 1) })
		expect(res.status).toBe(412)
		expect(((await res.json()) as { error: string }).error).toMatch(/changed since it was read/)
		expect((await visuals(base))[0]?.labelsConfig.title).toBe("Muffins")
	})

	it("requires If-Match with a version, not *", async () => {
		const base = await start()
		const v0 = await created(base)
		expect((await patch(base, v0.id, { title: "x" }, {})).status).toBe(428)
		expect((await patch(base, v0.id, { title: "y" }, { "if-match": "*" })).status).toBe(400)
		expect((await visuals(base))[0]).toEqual(v0)
	})

	it("refuses when the chart changes while the edit runs", async () => {
		const base = await start()
		const v0 = await created(base)
		const spy = vi.spyOn(dbModule, "replaceVisualIfUnchanged").mockReturnValueOnce(false)
		try {
			const res = await patch(base, v0.id, { title: "x" })
			expect(res.status).toBe(412)
			expect(((await res.json()) as { error: string }).error).toMatch(/while the edit ran/)
		} finally {
			spy.mockRestore()
		}
		expect((await visuals(base))[0]).toEqual(v0)
	})

	it("refuses with 409 when stored visuals are at another content version", async () => {
		const base = await start()
		const v0 = await created(base)
		for (const v of [VISUALS_VERSION - 1, VISUALS_VERSION + 1]) {
			await put(base, "/api/content-versions/visuals", { v })
			expect((await patch(base, v0.id, { title: "x" })).status).toBe(409)
		}
		expect((await visuals(base))[0]).toEqual(v0)
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
		expect(dumbbell?.variations[0]).toMatchObject({ name: "Dumbbell", sameFieldAs: { connection: "y" }, optional: ["shape", "area"] })
		expect(body.families.map((f) => f.family)).not.toContain("lollipop")
		expect((await fetch(`${base}/api/chart-spec`, { method: "POST" })).status).toBe(405)
	})

	it("lists the themes and marks the default one", async () => {
		const base = await start()
		const themes = async () =>
			((await (await fetch(`${base}/api/chart-spec`)).json()) as { themes: Array<{ id: string; name: string; default: boolean }> }).themes
		expect((await themes()).filter((t) => t.default)).toEqual([{ id: SYSTEM_LIGHT_THEME.id, name: SYSTEM_LIGHT_THEME.name, default: true }])
		await put(base, "/api/themes/th-basic", { ...SYSTEM_LIGHT_THEME, id: "th-basic", name: "Trilliant Health Basic", isSystem: false })
		await put(base, "/api/settings/default-theme", { id: "default-theme", themeId: "th-basic" })
		const listed = await themes()
		expect(listed.map((t) => t.id)).toEqual(expect.arrayContaining([SYSTEM_LIGHT_THEME.id, SYSTEM_DARK_THEME.id, "th-basic"]))
		expect(listed.filter((t) => t.default).map((t) => t.name)).toEqual(["Trilliant Health Basic"])
	})

	it("lists where a map variation's geographic fields go", async () => {
		const base = await start()
		const body = (await (await fetch(`${base}/api/chart-spec`)).json()) as {
			families: Array<{ family: string; variations: Array<{ name: string; channels: Record<string, string[]>; note?: string }> }>
		}
		const map = body.families.find((f) => f.family === "map")?.variations ?? []
		expect(map.find((v) => v.name === "Choropleth")).toMatchObject({
			channels: { connection: ["categorical", "ordinal"], hue: expect.any(Array) },
			note: expect.stringMatching(/region field on "connection", the measure on "hue", nothing on "x", "y" or "area"/),
		})
		expect(map.find((v) => v.name === "Dot map")?.channels).toEqual({ x: ["quantitative"], y: ["quantitative"] })
		expect(body.families.find((f) => f.family === "bar")?.variations[0]?.note).toBeUndefined()
	})

	it("lists where a flow variation's source, weight and target go", async () => {
		const base = await start()
		const body = (await (await fetch(`${base}/api/chart-spec`)).json()) as {
			families: Array<{ family: string; variations: Array<{ note?: string }> }>
		}
		for (const family of ["sankey", "chord"]) {
			expect(body.families.find((f) => f.family === family)?.variations[0]?.note, family).toMatch(
				/sources on "connection", edge weights on "area"; the target field in settings\.channelConfigs\.connection\.flowTargetField/
			)
		}
	})
})

describe("GET /api/chart-spec/settings", () => {
	it("finds settings a new chart doesn't store yet, marked unset", async () => {
		const base = await start()
		const r = (await (await fetch(`${base}/api/chart-spec/settings?q=variable%20thickness`)).json()) as { settings: Array<{ path: string; unset?: boolean; value: unknown }> }
		expect(r.settings).toContainEqual(expect.objectContaining({ path: "channelConfigs.connection.thicknessField", unset: true, value: null }))
	})

	it("lists default settings, filters by words, and reads one visual's values", async () => {
		const base = await start()
		const all = (await (await fetch(`${base}/api/chart-spec/settings`)).json()) as { scope: string; count: number; settings: unknown[]; groups: Array<{ group: string; count: number }> }
		expect(all.scope).toBe("census")
		expect(all.count).toBeGreaterThan(100)
		expect(all.settings).toEqual([])
		expect(all.groups.every((g) => !g.group.startsWith("encodings"))).toBe(true)
		const spacing = (await (await fetch(`${base}/api/chart-spec/settings?q=spacing&include_descriptions=true&limit=2`)).json()) as { scope: string; count: number; returned: number; truncated: boolean; nextOffset: number; settings: Array<{ matchedVia?: string[] }> }
		expect(spacing.scope).toBe("rows")
		expect(spacing.returned).toBe(2)
		expect(spacing.truncated).toBe(true)
		expect(spacing.nextOffset).toBe(2)
		expect(spacing.settings[0]?.matchedVia?.[0]).toMatch(/^spacing → /)
		for (const bad of ["offset=-1", "offset=1.5", "offset=0x10", "offset=1e9", "offset=%20", "limit=0", "limit=", "include_descriptions=yes", "include_descriptions=TRUE"]) {
			expect((await fetch(`${base}/api/chart-spec/settings?q=x&${bad}`)).status, bad).toBe(400)
		}
		for (const q of ["constructor", "__proto__"]) {
			expect((await fetch(`${base}/api/chart-spec/settings?q=${q}`)).status, q).toBe(200)
		}
		const lines = (await (await fetch(`${base}/api/chart-spec/settings?q=connection%20stroke`)).json()) as { settings: Array<{ path: string }> }
		expect(lines.settings.map((s) => s.path)).toContain("channelConfigs.connection.strokeColor")
		const v0 = await created(base)
		await patch(base, v0.id, { settings: { legendConfig: { position: "top" } } })
		const mine = (await (await fetch(`${base}/api/chart-spec/settings?visualId=${v0.id}&q=legendConfig.position`)).json()) as { settings: Array<{ path: string; value: unknown }> }
		expect(mine.settings.find((s) => s.path === "legendConfig.position")?.value).toBe("top")
		expect((await fetch(`${base}/api/chart-spec/settings?visualId=vs-none`)).status).toBe(404)
	})
})

describe("POST /api/visuals/<id>/restore", () => {
	const edited = async (base: string) => {
		const v0 = await created(base)
		const res = await patch(base, v0.id, { title: "Changed" }, { "if-match": String(v0.updatedAt) })
		const body = (await res.json()) as { visual: Visual; undo: { visualsVersion: number; visual: Visual } }
		return { v0, edit: body.visual, undo: body.undo }
	}
	const restore = (base: string, id: string, undo: unknown, ifMatch?: unknown) =>
		fetch(`${base}/api/visuals/${id}/restore`, {
			method: "POST",
			headers: ifMatch === undefined ? {} : { "if-match": String(ifMatch) },
			body: JSON.stringify(undo),
		})

	it("puts back the visual the edit replaced, under a new updatedAt", async () => {
		const base = await start()
		const { v0, edit, undo } = await edited(base)
		expect(undo.visualsVersion).toBe(VISUALS_VERSION)
		const res = await restore(base, v0.id, undo, edit.updatedAt)
		expect(res.status).toBe(200)
		const { updatedAt } = (await res.json()) as { updatedAt: number }
		expect(updatedAt).toBeGreaterThan(edit.updatedAt)
		const [stored] = await visuals(base)
		expect(stored).toEqual({ ...v0, updatedAt, thumbnail: null })
	})

	it("refuses when the visual changed after the edit, and keeps the change", async () => {
		const base = await start()
		const { v0, edit, undo } = await edited(base)
		const newer = { ...edit, name: "Someone else's save", updatedAt: edit.updatedAt + 5 }
		expect((await put(base, `/api/visuals/${v0.id}`, newer)).status).toBe(204)
		expect((await restore(base, v0.id, undo, edit.updatedAt)).status).toBe(412)
		expect((await visuals(base))[0]?.name).toBe("Someone else's save")
	})

	it("refuses an undo from another content version, another visual, or without If-Match", async () => {
		const base = await start()
		const { v0, edit, undo } = await edited(base)
		expect((await restore(base, v0.id, { ...undo, visualsVersion: VISUALS_VERSION - 1 }, edit.updatedAt)).status).toBe(409)
		expect((await restore(base, v0.id, { ...undo, visual: { ...undo.visual, id: "vs-other" } }, edit.updatedAt)).status).toBe(400)
		expect((await restore(base, v0.id, { visual: undo.visual }, edit.updatedAt)).status).toBe(400)
		expect((await restore(base, v0.id, undo)).status).toBe(428)
		expect((await visuals(base))[0]?.labelsConfig.title).toBe("Changed")
	})

	it("refuses an undo whose visual isn't whole, and keeps the chart", async () => {
		const base = await start()
		const { v0, edit, undo } = await edited(base)
		const [kept] = await visuals(base)
		const res = await restore(base, v0.id, { ...undo, visual: { id: v0.id } }, edit.updatedAt)
		expect(res.status).toBe(400)
		expect(((await res.json()) as { error: string }).error).toContain('"name"')
		const { labelsConfig: _, ...noLabels } = undo.visual
		expect((await restore(base, v0.id, { ...undo, visual: noLabels }, edit.updatedAt)).status).toBe(400)
		expect((await visuals(base))[0]).toEqual(kept)
	})

	it("refuses a trashed or missing visual", async () => {
		const base = await start()
		const { v0, edit, undo } = await edited(base)
		expect((await restore(base, "vs-none", { ...undo, visual: { ...undo.visual, id: "vs-none" } }, edit.updatedAt)).status).toBe(404)
		expect((await put(base, `/api/visuals/${v0.id}`, { ...edit, deletedAt: Date.now() })).status).toBe(204)
		expect((await restore(base, v0.id, undo, edit.updatedAt)).status).toBe(409)
	})
})

describe("Saved by, from the host's identify", () => {
	const JANE = { id: "jane@example.com", name: "Jane Doe" }
	const NANCY = { id: "nancy@example.com", name: "Nancy Organ" }
	const as = (user: typeof JANE | null): Record<string, string> =>
		user ? { "x-test-user": JSON.stringify(user) } : {}
	const startIdentified = () =>
		start(undefined, (req) => {
			const raw = req.headers["x-test-user"]
			return typeof raw === "string" ? (JSON.parse(raw) as never) : null
		})
	const createAs = async (base: string, user: typeof JANE | null) => {
		await seedDataset(base, CAFE)
		const res = await fetch(`${base}/api/visuals`, {
			method: "POST",
			headers: as(user),
			body: JSON.stringify(cafe({ title: "Muffins" })),
		})
		expect(res.status).toBe(201)
		return ((await res.json()) as { visual: Visual }).visual
	}
	const editAs = async (base: string, v: Visual, user: typeof JANE | null) => {
		const res = await patch(base, v.id, { title: "Changed" }, { "if-match": String(v.updatedAt), ...as(user) })
		expect(res.status).toBe(200)
		return (await res.json()) as { visual: Visual; undo: unknown }
	}

	it("stamps the requesting user on a create, an edit and an undo", async () => {
		const base = await startIdentified()
		const v0 = await createAs(base, JANE)
		expect(v0.updatedBy).toEqual(JANE)
		expect((await visuals(base))[0]?.updatedBy).toEqual(JANE)
		const { visual: edit, undo } = await editAs(base, v0, NANCY)
		expect(edit.updatedBy).toEqual(NANCY)
		const res = await fetch(`${base}/api/visuals/${v0.id}/restore`, {
			method: "POST",
			headers: { "if-match": String(edit.updatedAt), ...as(JANE) },
			body: JSON.stringify(undo),
		})
		expect(res.status).toBe(200)
		expect((await visuals(base))[0]?.updatedBy).toEqual(JANE)
	})

	it("keeps the stored saver on an anonymous edit, and names nobody on an anonymous create", async () => {
		const base = await startIdentified()
		const v0 = await createAs(base, JANE)
		const { visual: edit } = await editAs(base, v0, null)
		expect(edit.updatedBy).toEqual(JANE)
		const other = await createAs(base, null)
		expect(other.updatedBy).toBeUndefined()
	})

	it("names nobody without an identify hook", async () => {
		const base = await start()
		const v0 = await createAs(base, JANE)
		expect(v0.updatedBy).toBeUndefined()
		expect((await editAs(base, v0, JANE)).visual.updatedBy).toBeUndefined()
	})
})

describe("POST /api/datasets", () => {
	const create = (base: string, body: unknown) =>
		fetch(`${base}/api/datasets`, { method: "POST", body: JSON.stringify(body) })
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
