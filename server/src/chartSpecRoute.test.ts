// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { datasetMetaFrom } from "../../src/contexts/chartBuilder/lib/datasetMeta"
import { VISUALS_VERSION } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { Dataset, Visual } from "../../src/contexts/chartBuilder/lib/types"
import { hydrateVisual } from "../../src/contexts/chartBuilder/lib/visualDefaults"
import { CAFE } from "../../src/testSupport/chartSpecFixtures"
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
		}
		expect(Object.keys(body.spec)).toEqual(expect.arrayContaining(["datasetId", "encodings", "axes"]))
		expect(body.spec.encodings).toMatch(/Channel → field name/)
		expect(body.features).toEqual(["create"])
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
