// @vitest-environment node
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openDb } from "./db.js"
import { PAYLOAD_MARKER } from "./embedFiles.js"
import { THUMBNAIL_BODY_CAP_BYTES } from "./limits.js"
import { createHandler } from "./routes.js"

let server: Server
let base: string
let dataDir: string
let publishDir: string

beforeAll(async () => {
	const dbDir = mkdtempSync(join(tmpdir(), "vis-routes-db-"))
	dataDir = mkdtempSync(join(tmpdir(), "vis-routes-data-"))
	publishDir = mkdtempSync(join(tmpdir(), "vis-routes-publish-"))
	const distDir = mkdtempSync(join(tmpdir(), "vis-routes-dist-"))
	writeFileSync(join(distDir, "index.html"), "<title>spa</title>")
	writeFileSync(
		join(distDir, "embed-runtime.html"),
		`<html><script type="application/json" id="embed-payload">${PAYLOAD_MARKER}</script></html>`
	)

	const handler = createHandler({
		config: {
			baseUrl: "https://charts.example.com",
			dbDir,
			dataDir,
			port: 0,
			publishDir,
			publishBaseUrl: "https://embeds.example.com",
		},
		db: openDb(dbDir),
		distDir,
	})
	server = createServer((req, res) => void handler(req, res))
	await new Promise<void>((resolve) => server.listen(0, resolve))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
	server.close()
})

describe("liveness and config", () => {
	it("GET /alive answers 200 without touching storage", async () => {
		const res = await fetch(`${base}/alive`)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe("ok")
	})

	it("GET /api/config serves the runtime config the boot probe validates", async () => {
		const res = await fetch(`${base}/api/config`)
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toContain("application/json")
		expect(await res.json()).toEqual({
			v: 1,
			baseUrl: "https://charts.example.com",
			exportPage: true,
		})
	})
})

describe("JSON collections over HTTP", () => {
	it("round-trips visuals as an array, thumbnails intact", async () => {
		const visual = { id: "v1", name: "Chart", thumbnail: "data:image/png;base64,AA" }
		const put = await fetch(`${base}/api/visuals/v1`, {
			method: "PUT",
			body: JSON.stringify(visual),
		})
		expect(put.status).toBe(204)
		const list = await (await fetch(`${base}/api/visuals`)).json()
		expect(list).toEqual([visual])
	})

	it("round-trips the fonts collection (user font library) as an array", async () => {
		const font = { id: "gf-lora", family: "Lora", weights: [400, 700] }
		const put = await fetch(`${base}/api/fonts/gf-lora`, {
			method: "PUT",
			body: JSON.stringify(font),
		})
		expect(put.status).toBe(204)
		expect(await (await fetch(`${base}/api/fonts`)).json()).toEqual([font])
	})

	it("round-trips the shared settings collection as an array", async () => {
		const setting = { id: "default-theme", themeId: "theme-abc" }
		const put = await fetch(`${base}/api/settings/default-theme`, {
			method: "PUT",
			body: JSON.stringify(setting),
		})
		expect(put.status).toBe(204)
		expect(await (await fetch(`${base}/api/settings`)).json()).toEqual([setting])
	})

	it("serves embed-instances as an id-keyed record", async () => {
		const instance = { id: "ei-1", visualId: "v1" }
		await fetch(`${base}/api/embed-instances/ei-1`, {
			method: "PUT",
			body: JSON.stringify(instance),
		})
		const record = await (await fetch(`${base}/api/embed-instances`)).json()
		expect(record).toEqual({ "ei-1": instance })
	})

	it("DELETE removes an item and is a no-op on a missing id", async () => {
		await fetch(`${base}/api/folders/f1`, {
			method: "PUT",
			body: JSON.stringify({ id: "f1" }),
		})
		expect(
			(await fetch(`${base}/api/folders/f1`, { method: "DELETE" })).status
		).toBe(204)
		expect(
			(await fetch(`${base}/api/folders/f1`, { method: "DELETE" })).status
		).toBe(204)
		expect(await (await fetch(`${base}/api/folders`)).json()).toEqual([])
	})

	it("rejects malformed bodies and id mismatches with 400", async () => {
		const notJson = await fetch(`${base}/api/themes/t1`, {
			method: "PUT",
			body: "not json",
		})
		expect(notJson.status).toBe(400)
		const mismatch = await fetch(`${base}/api/themes/t1`, {
			method: "PUT",
			body: JSON.stringify({ id: "t2" }),
		})
		expect(mismatch.status).toBe(400)
	})

	it("rejects unknown collections and unsafe ids", async () => {
		expect((await fetch(`${base}/api/nope`)).status).toBe(404)
		expect(
			(await fetch(`${base}/api/themes/..%2Fescape`, { method: "PUT", body: "{}" }))
				.status
		).toBe(400)
	})
})

describe("content versions over HTTP", () => {
	it("starts empty, so a client reads an unstamped server", async () => {
		const res = await fetch(`${base}/api/content-versions`)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({})
	})

	// Stamped collections refuse header-less writes from then on (see the
	// "behind the content schema" block), so this stamps only collections no
	// later block writes to through the shared server.
	it("stores a stamp per collection and reads them all back", async () => {
		for (const [collection, v] of [
			["embed-instances", 4],
			["themes", 2],
		] as const) {
			const put = await fetch(`${base}/api/content-versions/${collection}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: `{"v":${v}}`,
			})
			expect(put.status).toBe(204)
		}
		expect(await (await fetch(`${base}/api/content-versions`)).json()).toEqual({
			"embed-instances": 4,
			themes: 2,
		})
	})

	it("overwrites a collection's stamp rather than accumulating rows", async () => {
		await fetch(`${base}/api/content-versions/fonts`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: '{"v":1}',
		})
		await fetch(`${base}/api/content-versions/fonts`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: '{"v":2}',
		})
		const all = (await (await fetch(`${base}/api/content-versions`)).json()) as
			Record<string, number>
		expect(all.fonts).toBe(2)
	})

	// The id segment is a collection NAME, so it comes from a whitelist —
	// a typo must not quietly create a stamp nothing will ever read.
	it("404s an unknown collection", async () => {
		const res = await fetch(`${base}/api/content-versions/nope`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: '{"v":1}',
		})
		expect(res.status).toBe(404)
	})

	it("rejects bodies that aren't a non-negative integer version", async () => {
		for (const body of ['{"v":"4"}', '{"v":-1}', '{"v":1.5}', "{}", "nope"]) {
			const res = await fetch(`${base}/api/content-versions/visuals`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body,
			})
			expect(res.status).toBe(400)
		}
	})

	it("rejects DELETE and a collection-level write", async () => {
		expect(
			(
				await fetch(`${base}/api/content-versions/visuals`, {
					method: "DELETE",
				})
			).status
		).toBe(405)
		expect(
			(await fetch(`${base}/api/content-versions`, { method: "PUT" })).status
		).toBe(405)
	})
})

describe("datasets over HTTP", () => {
	it("still accepts a gzipped body from a pre-release tab", async () => {
		const dataset = { id: "ds-1", name: "Numbers", rows: [{ a: 1 }, { a: 2 }] }
		const put = await fetch(`${base}/api/datasets/ds-1`, {
			method: "PUT",
			headers: { "content-encoding": "gzip" },
			body: gzipSync(JSON.stringify(dataset)),
		})
		expect(put.status).toBe(204)
		const record = await (await fetch(`${base}/api/datasets`)).json()
		expect(record).toEqual({ "ds-1": dataset })
	})

	it("stores an uncompressed body by compressing it server-side", async () => {
		const dataset = { id: "ds-2", name: "Plain" }
		await fetch(`${base}/api/datasets/ds-2`, {
			method: "PUT",
			body: JSON.stringify(dataset),
		})
		const record = (await (
			await fetch(`${base}/api/datasets`)
		).json()) as Record<string, unknown>
		expect(record["ds-2"]).toEqual(dataset)
	})

	it("rejects a body that claims gzip but is not", async () => {
		const res = await fetch(`${base}/api/datasets/ds-bad`, {
			method: "PUT",
			headers: { "content-encoding": "gzip" },
			body: "definitely not gzip",
		})
		expect(res.status).toBe(400)
		const record = (await (
			await fetch(`${base}/api/datasets`)
		).json()) as Record<string, unknown>
		expect(record["ds-bad"]).toBeUndefined()
	})

	it("deletes datasets idempotently", async () => {
		await fetch(`${base}/api/datasets/ds-1`, { method: "DELETE" })
		await fetch(`${base}/api/datasets/ds-1`, { method: "DELETE" })
		const record = (await (
			await fetch(`${base}/api/datasets`)
		).json()) as Record<string, unknown>
		expect(record["ds-1"]).toBeUndefined()
	})
})

describe("static serving", () => {
	it("serves files and falls back to index.html for SPA routes", async () => {
		const index = await fetch(`${base}/`)
		expect(await index.text()).toContain("spa")
		const spaRoute = await fetch(`${base}/editor/new`)
		expect(await spaRoute.text()).toContain("spa")
	})

	it("keeps traversal attempts inside the dist root", async () => {
		const res = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)
		expect(res.status).toBe(200)
		expect(await res.text()).toContain("spa")
	})
})

describe("dataset metadata index and per-dataset reads", () => {
	const put = (id: string, body: unknown) =>
		fetch(`${base}/api/datasets/${id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})

	const putMeta = (id: string, body: unknown) =>
		fetch(`${base}/api/datasets/${id}/meta`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})

	const dataset = (id: string) => ({
		id,
		name: `Set ${id}`,
		fields: [{ name: "a", inferredType: "quantitative" }],
		versions: [{ id: `${id}-v1`, filename: "a.csv", rows: [{ a: "1" }] }],
	})

	const meta = (id: string) => ({
		id,
		name: `Set ${id}`,
		fields: [{ name: "a", inferredType: "quantitative" }],
		versions: [{ id: `${id}-v1`, filename: "a.csv", rowCount: 1 }],
	})

	it("keeps the bare collection GET returning full bodies for older clients", async () => {
		await put("ds-compat", dataset("ds-compat"))
		const res = await fetch(`${base}/api/datasets`)
		expect(res.status).toBe(200)
		const all = (await res.json()) as Record<string, { versions: unknown[] }>
		// A browser still running the previous bundle depends on this shape.
		expect(all["ds-compat"]).toEqual(dataset("ds-compat"))
	})

	it("serves un-hydrated datasets as null rather than omitting them", async () => {
		await put("ds-nometa", dataset("ds-nometa"))
		const res = await fetch(`${base}/api/datasets?view=index`)
		expect(res.status).toBe(200)
		const index = (await res.json()) as Record<string, unknown>
		// Present-but-null is what tells the client to hydrate. Omitting the id
		// would read as "this dataset was deleted".
		expect(Object.keys(index)).toContain("ds-nometa")
		expect(index["ds-nometa"]).toBeNull()
	})

	it("returns stored meta on the index and carries no row data", async () => {
		await put("ds-meta", dataset("ds-meta"))
		expect((await putMeta("ds-meta", meta("ds-meta"))).status).toBe(204)

		const res = await fetch(`${base}/api/datasets?view=index`)
		const index = (await res.json()) as Record<string, unknown>
		expect(index["ds-meta"]).toEqual(meta("ds-meta"))
		const versions = (index["ds-meta"] as { versions: object[] }).versions
		expect(versions.every((v) => !("rows" in v))).toBe(true)
	})

	it("invalidates meta when a new body lands", async () => {
		await put("ds-churn", dataset("ds-churn"))
		await putMeta("ds-churn", meta("ds-churn"))
		await put("ds-churn", dataset("ds-churn"))

		const index = (await (await fetch(`${base}/api/datasets?view=index`)).json()) as Record<string, unknown>
		expect(index["ds-churn"]).toBeNull()
	})

	it("rejects a meta body carrying version rows", async () => {
		await put("ds-fat", dataset("ds-fat"))
		const res = await putMeta("ds-fat", dataset("ds-fat"))
		expect(res.status).toBe(400)
	})

	it("rejects a meta body whose id contradicts the URL", async () => {
		await put("ds-mismatch", dataset("ds-mismatch"))
		const res = await putMeta("ds-mismatch", meta("ds-other"))
		expect(res.status).toBe(400)
	})

	it("serves one dataset body by id", async () => {
		await put("ds-one", dataset("ds-one"))
		const res = await fetch(`${base}/api/datasets/ds-one`)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual(dataset("ds-one"))
	})

	it("answers 304 when the client already has the current body", async () => {
		await put("ds-etag", dataset("ds-etag"))
		const first = await fetch(`${base}/api/datasets/ds-etag`)
		const etag = first.headers.get("etag")
		expect(etag).toBeTruthy()
		await first.arrayBuffer()

		const second = await fetch(`${base}/api/datasets/ds-etag`, {
			headers: { "if-none-match": etag as string },
		})
		expect(second.status).toBe(304)
	})

	it("404s an unknown dataset id and an unknown sub-resource", async () => {
		expect((await fetch(`${base}/api/datasets/ds-missing`)).status).toBe(404)
		await put("ds-sub", dataset("ds-sub"))
		expect((await fetch(`${base}/api/datasets/ds-sub/nonsense`)).status).toBe(404)
	})

	it("rejects an unsafe id on the meta route", async () => {
		const res = await fetch(`${base}/api/datasets/..%2Fescape/meta`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: "{}",
		})
		expect(res.status).toBe(400)
	})
})

describe("thumbnail-free visuals reads", () => {
	const putVisual = (id: string, body: unknown) =>
		fetch(`${base}/api/visuals/${id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})

	const getVisuals = async (query = "") =>
		(await (await fetch(`${base}/api/visuals${query}`)).json()) as {
			id: string
			thumbnail?: string | null
		}[]

	type StoredVisual = { id: string; name?: string; thumbnail?: string | null }
	const find = (list: StoredVisual[], id: string): StoredVisual | undefined =>
		list.find((v) => v.id === id)

	it("omits thumbnails when asked, and includes them by default", async () => {
		await putVisual("v-thumb", {
			id: "v-thumb",
			name: "Chart",
			thumbnail: "data:image/png;base64,AA",
		})

		expect(find(await getVisuals(), "v-thumb")?.thumbnail).toBe(
			"data:image/png;base64,AA"
		)
		expect(find(await getVisuals("?thumbnails=0"), "v-thumb")).not.toHaveProperty(
			"thumbnail"
		)
	})

	// The rule that makes the flag safe to save back through: a session that
	// read visuals without thumbnails must not blank the stored preview of
	// whatever it saves.
	it("keeps the stored thumbnail when a save omits the key entirely", async () => {
		await putVisual("v-keep", {
			id: "v-keep",
			name: "Chart",
			thumbnail: "data:image/png;base64,AA",
		})
		await putVisual("v-keep", { id: "v-keep", name: "Renamed" })

		const stored = find(await getVisuals(), "v-keep")
		expect(stored?.name).toBe("Renamed")
		expect(stored?.thumbnail).toBe("data:image/png;base64,AA")
	})

	it("clears the thumbnail when a save sets it to null explicitly", async () => {
		await putVisual("v-clear", {
			id: "v-clear",
			name: "Chart",
			thumbnail: "data:image/png;base64,AA",
		})
		await putVisual("v-clear", { id: "v-clear", name: "Chart", thumbnail: null })

		expect(find(await getVisuals(), "v-clear")?.thumbnail).toBeNull()
	})
})

describe("per-version dataset bodies", () => {
	const rows = (n: number) =>
		Array.from({ length: n }, (_, i) => ({ a: String(i) }))

	const putVersion = (dsId: string, vId: string, body: unknown) =>
		fetch(`${base}/api/datasets/${dsId}/versions/${vId}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})

	// The managed header is what the real client sends: it means "I issue the
	// per-version PUTs/DELETEs myself", so the server keeps the version rows.
	// Without it (an old-bundle client) a body PUT purges them — see the
	// dedicated tests below.
	const putDataset = (id: string, body: unknown, managed = true) =>
		fetch(`${base}/api/datasets/${id}`, {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				...(managed ? { "x-vis-versions-managed": "1" } : {}),
			},
			body: JSON.stringify(body),
		})

	it("round-trips one version's rows without touching the others", async () => {
		await putDataset("ds-pv", { id: "ds-pv", versions: [] })
		await putVersion("ds-pv", "dv-1", { id: "dv-1", rows: rows(2) })
		await putVersion("ds-pv", "dv-2", { id: "dv-2", rows: rows(5) })

		const one = await fetch(`${base}/api/datasets/ds-pv/versions/dv-1`)
		expect(one.status).toBe(200)
		expect(await one.json()).toEqual({ id: "dv-1", rows: rows(2) })
	})

	// Every version of every dataset written before the split lands here. It
	// is the signal to fall back to the whole-dataset body, not an error.
	it("404s a version with no stored body of its own", async () => {
		await putDataset("ds-legacy", {
			id: "ds-legacy",
			versions: [{ id: "dv-old", rows: rows(1) }],
		})
		const res = await fetch(`${base}/api/datasets/ds-legacy/versions/dv-old`)
		expect(res.status).toBe(404)
		// …while the whole-dataset body still answers, so nothing is stranded.
		expect((await fetch(`${base}/api/datasets/ds-legacy`)).status).toBe(200)
	})

	it("answers 304 for a version the client already holds", async () => {
		await putDataset("ds-etag2", { id: "ds-etag2", versions: [] })
		await putVersion("ds-etag2", "dv-1", { id: "dv-1", rows: rows(1) })
		const first = await fetch(`${base}/api/datasets/ds-etag2/versions/dv-1`)
		const etag = first.headers.get("etag")
		await first.arrayBuffer()
		const second = await fetch(`${base}/api/datasets/ds-etag2/versions/dv-1`, {
			headers: { "if-none-match": etag as string },
		})
		expect(second.status).toBe(304)
	})

	it("deletes one version without disturbing its siblings", async () => {
		await putDataset("ds-del", { id: "ds-del", versions: [] })
		await putVersion("ds-del", "dv-1", { id: "dv-1", rows: rows(1) })
		await putVersion("ds-del", "dv-2", { id: "dv-2", rows: rows(1) })

		const gone = await fetch(`${base}/api/datasets/ds-del/versions/dv-1`, {
			method: "DELETE",
		})
		expect(gone.status).toBe(204)
		expect(
			(await fetch(`${base}/api/datasets/ds-del/versions/dv-1`)).status
		).toBe(404)
		expect(
			(await fetch(`${base}/api/datasets/ds-del/versions/dv-2`)).status
		).toBe(200)
	})

	it("takes every version body with the dataset when it is deleted", async () => {
		await putDataset("ds-cascade", { id: "ds-cascade", versions: [] })
		await putVersion("ds-cascade", "dv-1", { id: "dv-1", rows: rows(1) })
		await putVersion("ds-cascade", "dv-2", { id: "dv-2", rows: rows(1) })

		await fetch(`${base}/api/datasets/ds-cascade`, { method: "DELETE" })

		for (const v of ["dv-1", "dv-2"]) {
			expect(
				(await fetch(`${base}/api/datasets/ds-cascade/versions/${v}`)).status
			).toBe(404)
		}
		// And the dataset is not listed any more.
		const index = (await (
			await fetch(`${base}/api/datasets?view=index`)
		).json()) as Record<string, unknown>
		expect(index).not.toHaveProperty("ds-cascade")
	})

	it("rejects an unsafe version id", async () => {
		const res = await fetch(
			`${base}/api/datasets/ds-pv/versions/..%2Fescape`,
			{ method: "GET" }
		)
		expect(res.status).toBe(400)
	})

	it("does not mistake a version file for a dataset in the index", async () => {
		await putDataset("ds-index", { id: "ds-index", versions: [] })
		await putVersion("ds-index", "dv-1", { id: "dv-1", rows: rows(1) })
		const index = (await (
			await fetch(`${base}/api/datasets?view=index`)
		).json()) as Record<string, unknown>
		expect(Object.keys(index)).not.toContain("ds-index.dv-1")
	})

	// A version PUT racing (or trailing) the dataset's DELETE must not
	// resurrect deleted rows: without an index row for the parent, the write
	// is refused and nothing is left servable — mirroring the meta route's
	// anti-resurrection no-op.
	it("no-ops a version PUT whose dataset does not exist", async () => {
		const res = await putVersion("ds-ghost", "dv-1", {
			id: "dv-1",
			rows: rows(1),
		})
		expect(res.status).toBe(204)
		expect(
			(await fetch(`${base}/api/datasets/ds-ghost/versions/dv-1`)).status
		).toBe(404)
	})

	// An old-bundle client (rolling deploy) writes the whole body with no
	// version follow-ups, so the stored per-version bodies describe the
	// PREVIOUS rows — possibly versions the write removed. The server purges
	// them; readers fall back to the whole body until the next re-split.
	it("purges stored versions on a body PUT without the managed header", async () => {
		await putDataset("ds-old", { id: "ds-old", versions: [] })
		await putVersion("ds-old", "dv-1", { id: "dv-1", rows: rows(1) })
		await putDataset(
			"ds-old",
			{ id: "ds-old", versions: [] },
			/* managed */ false
		)
		expect(
			(await fetch(`${base}/api/datasets/ds-old/versions/dv-1`)).status
		).toBe(404)
		// The whole body still answers — nothing is stranded.
		expect((await fetch(`${base}/api/datasets/ds-old`)).status).toBe(200)
	})

	it("keeps stored versions on a body PUT with the managed header", async () => {
		await putDataset("ds-new", { id: "ds-new", versions: [] })
		await putVersion("ds-new", "dv-1", { id: "dv-1", rows: rows(1) })
		await putDataset("ds-new", { id: "ds-new", versions: [] })
		expect(
			(await fetch(`${base}/api/datasets/ds-new/versions/dv-1`)).status
		).toBe(200)
	})

	const putMeta = (dsId: string, versionIds: string[]) =>
		fetch(`${base}/api/datasets/${dsId}/meta`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: dsId,
				name: `Set ${dsId}`,
				versions: versionIds.map((id) => ({ id, filename: "a.csv", rowCount: 1 })),
			}),
		})

	// The meta PUT is the last write of a sync, so its version list is the
	// authority: a stored version it does not list was deleted by some session
	// (possibly one whose DELETE request never landed) and a fresh session
	// hydrating from the whole body can never know to remove it. The server
	// must purge it here — row AND file — or it is served forever.
	it("purges stored versions the meta PUT does not list", async () => {
		await putDataset("ds-reconcile", { id: "ds-reconcile", versions: [] })
		await putVersion("ds-reconcile", "dv-keep", { id: "dv-keep", rows: rows(1) })
		await putVersion("ds-reconcile", "dv-orphan", {
			id: "dv-orphan",
			rows: rows(1),
		})

		expect((await putMeta("ds-reconcile", ["dv-keep"])).status).toBe(204)

		expect(
			(await fetch(`${base}/api/datasets/ds-reconcile/versions/dv-orphan`)).status
		).toBe(404)
		expect(readdirSync(dataDir)).not.toContain("ds-reconcile.dv-orphan.json.gz")
	})

	it("keeps every version the meta PUT lists", async () => {
		await putDataset("ds-listed", { id: "ds-listed", versions: [] })
		await putVersion("ds-listed", "dv-1", { id: "dv-1", rows: rows(1) })
		await putVersion("ds-listed", "dv-2", { id: "dv-2", rows: rows(2) })

		expect((await putMeta("ds-listed", ["dv-1", "dv-2"])).status).toBe(204)

		for (const v of ["dv-1", "dv-2"]) {
			expect(
				(await fetch(`${base}/api/datasets/ds-listed/versions/${v}`)).status
			).toBe(200)
		}
		expect(readdirSync(dataDir)).toContain("ds-listed.dv-1.json.gz")
		expect(readdirSync(dataDir)).toContain("ds-listed.dv-2.json.gz")
	})

	// The purge trusts each listed version's id, so an entry without a string
	// id is malformed meta — rejected before anything is stored or purged.
	it("rejects meta whose versions lack a string id, purging nothing", async () => {
		await putDataset("ds-badmeta", { id: "ds-badmeta", versions: [] })
		await putVersion("ds-badmeta", "dv-1", { id: "dv-1", rows: rows(1) })

		const res = await fetch(`${base}/api/datasets/ds-badmeta/meta`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "ds-badmeta", versions: [{ filename: "a.csv" }] }),
		})
		expect(res.status).toBe(400)
		expect(
			(await fetch(`${base}/api/datasets/ds-badmeta/versions/dv-1`)).status
		).toBe(200)
	})
})

describe("published embeds over HTTP", () => {
	const uuid = (suffix: string): string =>
		`01234567-89ab-4cde-8f01-2345678${suffix}`

	it("PUT publishes the requested parts and answers with public file URLs", async () => {
		const id = uuid("0aaaa")
		const res = await fetch(`${base}/api/embeds/${id}`, {
			method: "PUT",
			body: JSON.stringify({
				v: 1,
				parts: ["full", "chart"],
				payload: { visual: { id: "v1" } },
			}),
		})
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			v: 1,
			urls: {
				full: `https://embeds.example.com/embeds/${id}/index.html`,
				chart: `https://embeds.example.com/embeds/${id}/chart.html`,
			},
		})
		const html = readFileSync(
			join(publishDir, "embeds", id, "index.html"),
			"utf-8"
		)
		expect(html).toContain('"part":"full"')
		expect(html).toContain('"visual":{"id":"v1"}')
	})

	it("still accepts a gzipped publish body from a pre-release tab", async () => {
		const id = uuid("0bbbb")
		const body = gzipSync(
			JSON.stringify({ v: 1, parts: ["full"], payload: { a: 1 } })
		)
		const res = await fetch(`${base}/api/embeds/${id}`, {
			method: "PUT",
			headers: { "content-encoding": "gzip" },
			body,
		})
		expect(res.status).toBe(200)
	})

	it("republish drops parts the request omits", async () => {
		const id = uuid("0cccc")
		const put = (parts: string[]) =>
			fetch(`${base}/api/embeds/${id}`, {
				method: "PUT",
				body: JSON.stringify({ v: 1, parts, payload: {} }),
			})
		await put(["full", "legend"])
		await put(["full"])
		const dir = join(publishDir, "embeds", id)
		expect(existsSync(join(dir, "index.html"))).toBe(true)
		expect(existsSync(join(dir, "legend.html"))).toBe(false)
	})

	it("DELETE unpublishes, idempotently", async () => {
		const id = uuid("0dddd")
		await fetch(`${base}/api/embeds/${id}`, {
			method: "PUT",
			body: JSON.stringify({ v: 1, parts: ["full"], payload: {} }),
		})
		expect(
			(await fetch(`${base}/api/embeds/${id}`, { method: "DELETE" })).status
		).toBe(204)
		expect(existsSync(join(publishDir, "embeds", id))).toBe(false)
		expect(
			(await fetch(`${base}/api/embeds/${id}`, { method: "DELETE" })).status
		).toBe(204)
	})

	it("rejects non-UUID publish ids and malformed bodies with 400", async () => {
		expect(
			(
				await fetch(`${base}/api/embeds/ei-123-abc`, {
					method: "PUT",
					body: JSON.stringify({ v: 1, parts: ["full"], payload: {} }),
				})
			).status
		).toBe(400)
		const bad = async (body: string) =>
			(
				await fetch(`${base}/api/embeds/${uuid("0eeee")}`, {
					method: "PUT",
					body,
				})
			).status
		expect(await bad("not json")).toBe(400)
		expect(await bad(JSON.stringify({ v: 1, parts: [], payload: {} }))).toBe(400)
		expect(
			await bad(JSON.stringify({ v: 1, parts: ["nope"], payload: {} }))
		).toBe(400)
		expect(await bad(JSON.stringify({ v: 2, parts: ["full"], payload: {} }))).toBe(
			400
		)
		expect(await bad(JSON.stringify({ v: 1, parts: ["full"] }))).toBe(400)
	})

	it("answers 405 for methods other than PUT/DELETE and 404 without an id", async () => {
		expect(
			(await fetch(`${base}/api/embeds/${uuid("0ffff")}`)).status
		).toBe(405)
		expect((await fetch(`${base}/api/embeds`)).status).toBe(404)
	})
})

describe("multipart thumbnail uploads", () => {
	const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])

	const putVisual = (id: string, body: unknown) =>
		fetch(`${base}/api/visuals/${id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})

	const upload = (id: string, bytes: Buffer, name = "thumbnail") => {
		const form = new FormData()
		form.append(name, new Blob([new Uint8Array(bytes)], { type: "image/png" }), "thumbnail.png")
		return fetch(`${base}/api/visuals/${id}/thumbnail`, { method: "PUT", body: form })
	}

	const stored = async (id: string) =>
		(
			(await (await fetch(`${base}/api/visuals`)).json()) as {
				id: string
				name?: string
				thumbnail?: string | null
			}[]
		).find((v) => v.id === id)

	it("stores the PNG as the same data URL the inline path kept", async () => {
		await putVisual("v-mp", { id: "v-mp", name: "Chart" })
		const res = await upload("v-mp", PNG)
		expect(res.status).toBe(204)

		const row = await stored("v-mp")
		expect(row?.name).toBe("Chart")
		expect(row?.thumbnail).toBe(`data:image/png;base64,${PNG.toString("base64")}`)
	})

	it("a later thumbnail-free JSON save keeps it; an explicit null clears it", async () => {
		await putVisual("v-mp-keep", { id: "v-mp-keep", name: "Chart" })
		await upload("v-mp-keep", PNG)
		await putVisual("v-mp-keep", { id: "v-mp-keep", name: "Renamed" })
		expect((await stored("v-mp-keep"))?.thumbnail).toBe(
			`data:image/png;base64,${PNG.toString("base64")}`
		)
		await putVisual("v-mp-keep", { id: "v-mp-keep", name: "Renamed", thumbnail: null })
		expect((await stored("v-mp-keep"))?.thumbnail).toBeNull()
	})

	it("404s for a visual that is not stored rather than inventing a row", async () => {
		const res = await upload("v-mp-missing", PNG)
		expect(res.status).toBe(404)
		expect(await stored("v-mp-missing")).toBeUndefined()
	})

	it("rejects a part that is not a PNG", async () => {
		await putVisual("v-mp-bad", { id: "v-mp-bad", name: "Chart" })
		const res = await upload("v-mp-bad", Buffer.from("GIF89a....."))
		expect(res.status).toBe(400)
		expect((await stored("v-mp-bad"))?.thumbnail).toBeNull()
	})

	it("rejects a body without a thumbnail file part", async () => {
		await putVisual("v-mp-nopart", { id: "v-mp-nopart", name: "Chart" })
		expect((await upload("v-mp-nopart", PNG, "other")).status).toBe(400)
		const form = new FormData()
		form.append("thumbnail", "a plain field, not a file")
		const res = await fetch(`${base}/api/visuals/v-mp-nopart/thumbnail`, {
			method: "PUT",
			body: form,
		})
		expect(res.status).toBe(400)
	})

	it("rejects extra parts and a malformed ending", async () => {
		await putVisual("v-mp-extra", { id: "v-mp-extra", name: "Chart" })
		const form = new FormData()
		form.append("thumbnail", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "thumbnail.png")
		form.append("note", "an extra part")
		const extra = await fetch(`${base}/api/visuals/v-mp-extra/thumbnail`, {
			method: "PUT",
			body: form,
		})
		expect(extra.status).toBe(400)

		const head = Buffer.from(
			'--b\r\nContent-Disposition: form-data; name="thumbnail"; filename="thumbnail.png"\r\n\r\n',
			"latin1"
		)
		for (const tail of ["\r\n--b--\r\ntrailing junk", "\r\n--b", ""]) {
			const res = await fetch(`${base}/api/visuals/v-mp-extra/thumbnail`, {
				method: "PUT",
				headers: { "content-type": "multipart/form-data; boundary=b" },
				body: Buffer.concat([head, PNG, Buffer.from(tail, "latin1")]),
			})
			expect(res.status).toBe(400)
		}
		expect((await stored("v-mp-extra"))?.thumbnail).toBeNull()
	})

	it("rejects a non-multipart body and a non-PUT method", async () => {
		await putVisual("v-mp-json", { id: "v-mp-json", name: "Chart" })
		const json = await fetch(`${base}/api/visuals/v-mp-json/thumbnail`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ thumbnail: "data:image/png;base64,AA" }),
		})
		expect(json.status).toBe(400)
		const get = await fetch(`${base}/api/visuals/v-mp-json/thumbnail`)
		expect(get.status).toBe(405)
		expect((await stored("v-mp-json"))?.thumbnail).toBeNull()
	})

	it("413s past the thumbnail cap", async () => {
		await putVisual("v-mp-big", { id: "v-mp-big", name: "Chart" })
		const big = Buffer.concat([PNG, Buffer.alloc(THUMBNAIL_BODY_CAP_BYTES)])
		const res = await upload("v-mp-big", big).catch(() => null)
		// The server destroys the socket on overflow; depending on timing the
		// client sees the 413 or a reset connection. Either way nothing lands.
		if (res) expect(res.status).toBe(413)
		expect((await stored("v-mp-big"))?.thumbnail).toBeNull()
	})

	it("other visual sub-resources stay 404", async () => {
		const res = await fetch(`${base}/api/visuals/v-mp/other`, { method: "PUT" })
		expect(res.status).toBe(404)
	})
})

describe("writes from a build behind the content schema", () => {
	// Chart saves carry no version of their own, so a tab still running the
	// previous bundle after a deploy would write the previous shape back over
	// migrated content. Every write names the version its build writes; the
	// server refuses one behind the stored stamp — and one naming none.
	//
	// Its own server: the stamps this block sets can only move forward, and
	// would refuse every header-less write the other blocks make.
	let own: Server
	let base: string
	beforeAll(async () => {
		const dbDir = mkdtempSync(join(tmpdir(), "vis-routes-stale-db-"))
		const distDir = mkdtempSync(join(tmpdir(), "vis-routes-stale-dist-"))
		writeFileSync(join(distDir, "index.html"), "<title>spa</title>")
		const handler = createHandler({
			config: {
				baseUrl: "https://charts.example.com",
				dbDir,
				dataDir: mkdtempSync(join(tmpdir(), "vis-routes-stale-data-")),
				port: 0,
				publishDir: mkdtempSync(join(tmpdir(), "vis-routes-stale-publish-")),
				publishBaseUrl: "https://embeds.example.com",
			},
			db: openDb(dbDir),
			distDir,
		})
		own = createServer((req, res) => void handler(req, res))
		await new Promise<void>((resolve) => own.listen(0, resolve))
		base = `http://127.0.0.1:${(own.address() as AddressInfo).port}`
	})
	afterAll(() => {
		own.close()
	})

	const put = (path: string, headers: Record<string, string> = {}) =>
		fetch(`${base}${path}`, {
			method: "PUT",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify({ id: path.split("/").pop(), name: "x" }),
		})
	const stamp = (collection: string, v: number) =>
		fetch(`${base}/api/content-versions/${collection}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: `{"v":${v}}`,
		})

	it("an unstamped collection takes a write from any build", async () => {
		expect((await put("/api/embed-instances/ei-open")).status).toBe(204)
		expect(
			(await put("/api/embed-instances/ei-open2", { "x-vis-content-version": "1" })).status
		).toBe(204)
	})

	it("once stamped, a write naming no version or an older one is refused with 409", async () => {
		await stamp("embed-instances", 3)
		const unversioned = await put("/api/embed-instances/ei-old")
		expect(unversioned.status).toBe(409)
		expect(await unversioned.text()).toMatch(/content version 3/)
		expect(
			(await put("/api/embed-instances/ei-old", { "x-vis-content-version": "2" })).status
		).toBe(409)
		expect(
			(await put("/api/embed-instances/ei-old", { "x-vis-content-version": "junk" })).status
		).toBe(409)
		// Nothing landed.
		const all = (await (await fetch(`${base}/api/embed-instances`)).json()) as Record<
			string,
			unknown
		>
		expect(all["ei-old"]).toBeUndefined()
	})

	it("a build at or ahead of the stamp writes (ahead = migrating before it moves the stamp)", async () => {
		await stamp("embed-instances", 3)
		expect(
			(await put("/api/embed-instances/ei-cur", { "x-vis-content-version": "3" })).status
		).toBe(204)
		expect(
			(await put("/api/embed-instances/ei-next", { "x-vis-content-version": "4" })).status
		).toBe(204)
		const del = await fetch(`${base}/api/embed-instances/ei-next`, {
			method: "DELETE",
			headers: { "x-vis-content-version": "3" },
		})
		expect(del.status).toBe(204)
		const stale = await fetch(`${base}/api/embed-instances/ei-cur`, { method: "DELETE" })
		expect(stale.status).toBe(409)
	})

	it("guards every versioned route: datasets and their sub-resources, thumbnails, published embeds", async () => {
		await stamp("datasets", 1)
		await stamp("visuals", 7)
		const gz = gzipSync(Buffer.from(JSON.stringify({ id: "ds-s", rows: [] })))
		const dataset = await fetch(`${base}/api/datasets/ds-s`, {
			method: "PUT",
			headers: { "content-type": "application/json", "content-encoding": "gzip" },
			body: gz,
		})
		expect(dataset.status).toBe(409)
		expect(
			(
				await fetch(`${base}/api/datasets/ds-s/meta`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ id: "ds-s" }),
				})
			).status
		).toBe(409)
		expect(
			(
				await fetch(`${base}/api/visuals/v-s/thumbnail`, {
					method: "PUT",
					headers: { "content-type": "multipart/form-data; boundary=x" },
					body: "--x--",
				})
			).status
		).toBe(409)
		expect(
			(
				await fetch(`${base}/api/embeds/0b7f3c2e-4d1a-4e8b-9c6d-2f1e3a4b5c6d`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ v: 1, parts: ["html"], payload: {} }),
				})
			).status
		).toBe(409)
		// Unversioned collections are untouched: folders have no schema.
		expect((await put("/api/folders/f-any")).status).toBe(204)
	})

	it("a stamp cannot be wound back by a build behind it", async () => {
		await stamp("themes", 5)
		const back = await stamp("themes", 4)
		expect(back.status).toBe(409)
		expect((await stamp("themes", 5)).status).toBe(204)
		expect((await stamp("themes", 6)).status).toBe(204)
	})
})

describe("identity from the host: config user, presence, saver stamps", () => {
	// Its own server, with the host's `identify` hook. The test host names
	// the user in a header; a real host reads its own session.
	let own: Server
	let base: string
	beforeAll(async () => {
		const dbDir = mkdtempSync(join(tmpdir(), "vis-routes-identity-db-"))
		const distDir = mkdtempSync(join(tmpdir(), "vis-routes-identity-dist-"))
		writeFileSync(join(distDir, "index.html"), "<title>spa</title>")
		const handler = createHandler({
			config: {
				baseUrl: "https://charts.example.com",
				dbDir,
				dataDir: mkdtempSync(join(tmpdir(), "vis-routes-identity-data-")),
				port: 0,
				publishDir: mkdtempSync(join(tmpdir(), "vis-routes-identity-publish-")),
				publishBaseUrl: "https://embeds.example.com",
			},
			db: openDb(dbDir),
			distDir,
			identify: (req) => {
				const raw = req.headers["x-test-user"]
				if (raw === "throw") throw new Error("session store down")
				return typeof raw === "string" ? (JSON.parse(raw) as never) : null
			},
		})
		own = createServer((req, res) => void handler(req, res))
		await new Promise<void>((resolve) => own.listen(0, resolve))
		base = `http://127.0.0.1:${(own.address() as AddressInfo).port}`
	})
	afterAll(() => {
		own.close()
	})

	const JANE = { id: "jane@example.com", name: "Jane Doe" }
	const NANCY = { id: "nancy@example.com", name: "Nancy Organ" }
	const as = (user: { id: string; name: string } | null): Record<string, string> =>
		user ? { "x-test-user": JSON.stringify(user) } : {}

	it("names the signed-in user in /api/config, and nobody when anonymous", async () => {
		const signedIn = await fetch(`${base}/api/config`, { headers: as(JANE) })
		expect(await signedIn.json()).toEqual({
			v: 1,
			baseUrl: "https://charts.example.com",
			exportPage: true,
			user: JANE,
		})
		const anonymous = await fetch(`${base}/api/config`)
		expect(await anonymous.json()).toEqual({ v: 1, baseUrl: "https://charts.example.com", exportPage: true })
		// A hook that throws is anonymous, not a failed boot probe.
		const broken = await fetch(`${base}/api/config`, { headers: { "x-test-user": "throw" } })
		expect(broken.status).toBe(200)
		expect(await broken.json()).toEqual({ v: 1, baseUrl: "https://charts.example.com", exportPage: true })
	})

	const beat = (tabId: string, visualId: string, user: typeof JANE | null) =>
		fetch(`${base}/api/presence/${tabId}`, {
			method: "PUT",
			headers: { "content-type": "application/json", ...as(user) },
			body: JSON.stringify({ visualId }),
		})

	it("presence: a heartbeat answers with everyone in that visual's editor", async () => {
		expect(await (await beat("tab-n1", "v-shared", NANCY)).json()).toEqual({
			editors: [NANCY],
		})
		// Jane, in two tabs on the same chart, appears once; a third person
		// on another chart doesn't appear at all.
		await beat("tab-j1", "v-shared", JANE)
		await beat("tab-o1", "v-other", { id: "o", name: "Otto" })
		const res = await beat("tab-j2", "v-shared", JANE)
		expect(await res.json()).toEqual({ editors: [JANE, NANCY] })

		// Leaving removes the tab — only its owner's DELETE counts.
		await fetch(`${base}/api/presence/tab-n1`, { method: "DELETE", headers: as(JANE) })
		expect(await (await beat("tab-j1", "v-shared", JANE)).json()).toEqual({
			editors: [JANE, NANCY],
		})
		await fetch(`${base}/api/presence/tab-n1`, { method: "DELETE", headers: as(NANCY) })
		expect(await (await beat("tab-j1", "v-shared", JANE)).json()).toEqual({
			editors: [JANE],
		})
	})

	it("presence: refuses anonymous and malformed heartbeats", async () => {
		expect((await beat("tab-a", "v-shared", null)).status).toBe(401)
		expect((await beat("tab-a", "../etc", JANE)).status).toBe(400)
		expect((await beat("bad.id", "v-shared", JANE)).status).toBe(400)
	})

	const putVisual = (body: Record<string, unknown>, user: typeof JANE | null) =>
		fetch(`${base}/api/visuals/${String(body.id)}`, {
			method: "PUT",
			headers: { "content-type": "application/json", ...as(user) },
			body: JSON.stringify(body),
		})
	const storedVisual = async (id: string) =>
		((await (await fetch(`${base}/api/visuals?thumbnails=0`)).json()) as {
			id: string
			updatedBy?: unknown
		}[]).find((v) => v.id === id)

	it("a save is credited to the requester, whatever the client claims", async () => {
		await putVisual({ id: "v-stamp", name: "x", updatedAt: 1, updatedBy: JANE }, NANCY)
		expect((await storedVisual("v-stamp"))?.updatedBy).toEqual(NANCY)
	})

	it("a write that leaves updatedBy alone (move, trash) keeps the saver", async () => {
		await putVisual({ id: "v-move", name: "x", updatedAt: 1, updatedBy: JANE }, JANE)
		// Nancy moves Jane's chart into a folder: same updatedBy as stored.
		await putVisual(
			{ id: "v-move", name: "x", folderId: "f1", updatedAt: 1, updatedBy: JANE },
			NANCY
		)
		expect((await storedVisual("v-move"))?.updatedBy).toEqual(JANE)
	})

	it("an anonymous write can't change or invent the saver", async () => {
		await putVisual({ id: "v-anon", name: "x", updatedBy: JANE }, JANE)
		await putVisual({ id: "v-anon", name: "x", updatedBy: { id: "evil", name: "Evil" } }, null)
		expect((await storedVisual("v-anon"))?.updatedBy).toEqual(JANE)
		await putVisual({ id: "v-anon-new", name: "x", updatedBy: JANE }, null)
		expect(await storedVisual("v-anon-new")).not.toHaveProperty("updatedBy")
	})
})

describe("identity off (no identify hook)", () => {
	it("has no presence endpoint", async () => {
		const res = await fetch(`${base}/api/presence/tab-1`, {
			method: "PUT",
			body: JSON.stringify({ visualId: "v1" }),
		})
		expect(res.status).toBe(404)
	})
})
