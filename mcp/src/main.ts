/** Entry point: the Zafiro MCP server over stdio.
 *
 *  Start:  VIS_API_URL=http://localhost:8080 node mcp/dist/main.js
 *
 *  VIS_API_URL is the self-host server (server/), whose existing HTTP API
 *  this talks to, and whose pages the renderer opens for pictures and
 *  exports. Required, fail-fast. stdout is the MCP channel, so
 *  diagnostics go to stderr only. */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { createApi } from "./api"
import { createRenderer, type Renderer } from "./render"
import { createZafiroServer } from "./server"

const fail = (message: string): never => {
	process.stderr.write(`Refusing to start: ${message}\n`)
	process.exit(1)
}

const apiUrl = (): string => {
	const raw = process.env.VIS_API_URL?.trim()
	if (!raw) return fail("VIS_API_URL is required (the self-host server's URL, e.g. http://localhost:8080)")
	try {
		const url = new URL(raw)
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
	} catch {
		return fail(`VIS_API_URL must be an http(s) URL; got "${raw}"`)
	}
	return raw
}

/** Close the renderer (its browser) once, then leave. */
const closeOnExit = (renderer: Renderer): void => {
	let closing: Promise<void> | null = null
	const close = () => (closing ??= renderer.close().catch(() => undefined))
	const leave = (code: number) => () => void close().finally(() => process.exit(code))
	process.once("SIGTERM", leave(0))
	process.once("SIGINT", leave(0))
	process.once("SIGHUP", leave(0))
	// The client closed stdin: the session is over.
	process.stdin.once("end", leave(0))
	process.once("exit", () => void close())
}

const main = async (): Promise<void> => {
	const base = apiUrl()
	const renderer = createRenderer({ pageBase: base, env: process.env })
	closeOnExit(renderer)
	await createZafiroServer(createApi(base), { renderer }).connect(new StdioServerTransport())
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
