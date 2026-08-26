// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openDb } from "./db.js"
import { createHandler } from "./routes.js"

let server: Server
let base: string

beforeAll(async () => {
	const dbDir = mkdtempSync(join(tmpdir(), "vis-routes-db-"))
	const dataDir = mkdtempSync(join(tmpdir(), "vis-routes-data-"))
	const distDir = mkdtempSync(join(tmpdir(), "vis-routes-dist-"))
	writeFileSync(join(distDir, "index.html"), "<title>spa</title>")

	const handler = createHandler({
		config: {
			baseUrl: "https://charts.example.com",
			dbDir,
			dataDir,
			port: 0,
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

	it("stores a stamp per collection and reads them all back", async () => {
		for (const [collection, v] of [
			["visuals", 4],
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
			visuals: 4,
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
	it("stores a client-gzipped body and streams the record back", async () => {
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

	it("tolerates an uncompressed body by compressing it server-side", async () => {
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
