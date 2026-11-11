/** Test helpers: the stub browser (stubBrowser.mjs) behind a launcher
 *  script carrying its knobs, a minimal server answering
 *  GET /api/visuals/<id>, and the stub's event log. */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const STUB = fileURLToPath(new URL("./stubBrowser.mjs", import.meta.url))

export type StubEvent = { pid: number; event: string; [key: string]: unknown }

export type Stub = { path: string; log: string; events: () => StubEvent[] }

const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`

/** A launcher for the stub with `knobs` as its environment. */
export const makeStub = (dir: string, knobs: Record<string, string> = {}): Stub => {
	const log = join(dir, "stub.log")
	const path = join(dir, "browser.sh")
	const exports = Object.entries({ STUB_LOG: log, ...knobs })
		.map(([k, v]) => `export ${k}=${shellQuote(v)}`)
		.join("\n")
	writeFileSync(path, `#!/bin/sh\n${exports}\nexec ${shellQuote(process.execPath)} ${shellQuote(STUB)} "$@"\n`)
	chmodSync(path, 0o755)
	return {
		path,
		log,
		events: () =>
			existsSync(log)
				? readFileSync(log, "utf8")
						.split("\n")
						.filter(Boolean)
						.map((line) => JSON.parse(line) as StubEvent)
				: [],
	}
}

export const tempDir = (name: string) => mkdtempSync(join(tmpdir(), `vis-render-${name}-`))

export const pidAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

export type VisualServer = { base: string; requests: string[]; close: () => Promise<void> }

/** Answers GET /api/visuals/<id> from `visuals` (404 when absent), and
 *  logs every request. */
export const startVisualServer = async (visuals: Record<string, unknown>): Promise<VisualServer> => {
	const requests: string[] = []
	const server: Server = createServer((req, res) => {
		requests.push(`${req.method} ${req.url}`)
		const match = /^\/api\/visuals\/([^/?]+)$/.exec(req.url ?? "")
		const visual = match ? visuals[decodeURIComponent(match[1])] : undefined
		if (req.method === "GET" && visual) {
			res.writeHead(200, { "content-type": "application/json" })
			res.end(JSON.stringify(visual))
			return
		}
		res.writeHead(404, { "content-type": "application/json" })
		res.end('{"error":"Not found"}')
	})
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	return {
		base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		requests,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	}
}
