/** The real self-host server (server/src) in-process on an ephemeral port
 *  with temp dirs, the way server/src/routes.test.ts starts one, for the
 *  MCP's end-to-end tests; and a Renderer stand-in with no browser. */
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openDb } from "../../server/src/db.js"
import { createHandler } from "../../server/src/routes.js"
import type { PictureOutcome, Renderer } from "./render"

// Every test file's handlers keep their history in a temp folder of their
// own, never the person's state folder; a test sharing one across
// instances passes `stateDir`.
process.env.VIS_STATE_DIR = mkdtempSync(join(tmpdir(), "vis-mcp-state-"))

export type TestServer = { base: string; close: () => void }

export const startTestServer = async (): Promise<TestServer> => {
	const dir = (name: string) => mkdtempSync(join(tmpdir(), `vis-mcp-${name}-`))
	const distDir = dir("dist")
	const dbDir = dir("db")
	writeFileSync(join(distDir, "index.html"), "<title>spa</title>")
	const handler = createHandler({
		config: {
			baseUrl: "https://charts.example.com",
			dbDir,
			dataDir: dir("data"),
			port: 0,
			publishDir: dir("publish"),
			publishBaseUrl: "https://embeds.example.com",
			authMode: "none",
		},
		db: openDb(dbDir),
		distDir,
	})
	const server: Server = createServer((req, res) => void handler(req, res))
	await new Promise<void>((resolve) => server.listen(0, resolve))
	return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }
}

/** A 1x1 PNG, base64. */
export const PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

export type FakeRenderer = Renderer & {
	/** Every visual id a picture was asked for, in order. */
	pictured: string[]
	/** Every export asked for. */
	exported: Array<{ id: string; req: Parameters<Renderer["exportChart"]>[1] }>
}

/** A Renderer stand-in: no browser. Pictures are a 1x1 PNG (or what
 *  `picture` answers); exports answer a path under /exports. */
export const fakeRenderer = (
	options: {
		picture?: (id: string) => PictureOutcome | Promise<PictureOutcome>
		exportChart?: Renderer["exportChart"]
	} = {}
): FakeRenderer => {
	const pictured: string[] = []
	const exported: FakeRenderer["exported"] = []
	return {
		pictured,
		exported,
		picture: async (id) => {
			pictured.push(id)
			return options.picture
				? options.picture(id)
				: { ok: true, picture: { data: PIXEL_PNG, mimeType: "image/png", width: 1, height: 1 } }
		},
		exportChart: async (id, req) => {
			exported.push({ id, req })
			if (options.exportChart) return options.exportChart(id, req)
			return {
				ok: true,
				path: `/exports/${req.fileName}.${req.format}`,
				format: req.format,
				bytes: 1234,
				width: req.width ?? 800,
				height: req.height ?? 500,
				pixelRatio: req.pixelRatio ?? 1,
			}
		},
		close: async () => {},
	}
}
