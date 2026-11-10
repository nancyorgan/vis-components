/** The real self-host server (server/src) in-process on an ephemeral port
 *  with temp dirs, the way server/src/routes.test.ts starts one, for the
 *  MCP's end-to-end tests. */
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openDb } from "../../server/src/db.js"
import { createHandler } from "../../server/src/routes.js"

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
