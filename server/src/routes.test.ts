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
