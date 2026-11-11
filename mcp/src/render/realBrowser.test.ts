// @vitest-environment node
// OPTIONAL: the renderer with the real Chrome / Edge on this machine against
// the real self-host server serving the BUILT app. Skipped unless
// VIS_TEST_REAL_BROWSER=1. Needs `pnpm build` first (or at least
// `vite build`, so dist/index.html carries the embed export mode):
//
//   pnpm build && VIS_TEST_REAL_BROWSER=1 pnpm vitest run mcp/src/render/realBrowser
//
// VIS_BROWSER_PATH picks a browser other than the installed Chrome / Edge;
// VIS_TEST_PICTURE_OUT=<folder> saves the picture there to look at.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { openDb } from "../../../server/src/db.js"
import { createHandler } from "../../../server/src/routes.js"
import { createApi } from "../api"
import { createHandlers } from "../tools"
import { createRenderer, type Renderer } from "./index"
import { tempDir } from "./testStub"

const DIST = fileURLToPath(new URL("../../../dist", import.meta.url))
const enabled = process.env.VIS_TEST_REAL_BROWSER === "1"

let server: Server
let base: string
let chartId: string

const idOf = (result: CallToolResult): string => {
	const text = (result.content[0] as { text: string }).text
	expect(result.isError, text).toBeFalsy()
	return (JSON.parse(text) as { id: string }).id
}

const noPictures: Renderer = {
	picture: async () => ({ ok: false, reason: "not in this test" }),
	exportChart: async () => ({ ok: false, reason: "not in this test" }),
	close: async () => undefined,
}

describe.skipIf(!enabled)("renderer (real browser, built app)", () => {
	beforeAll(async () => {
		if (!existsSync(join(DIST, "index.html"))) throw new Error("Build the app first (pnpm build).")
		const dir = (name: string) => tempDir(`real-${name}`)
		const dbDir = dir("db")
		const handler = createHandler({
			config: {
				baseUrl: "http://127.0.0.1",
				dbDir,
				dataDir: dir("data"),
				port: 0,
				publishDir: dir("publish"),
				publishBaseUrl: "http://127.0.0.1/embeds",
				authMode: "none",
			},
			db: openDb(dbDir),
			distDir: DIST,
		})
		server = createServer((req, res) => void handler(req, res))
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		const tools = createHandlers(createApi(base), { renderer: noPictures })
		const rows = Array.from({ length: 60 }, (_, i) => ({ state: `Region number ${i + 1}`, count: (i * 37) % 100 }))
		await tools.create_dataset({ name: "Regions", rows })
		chartId = idOf(await tools.create_chart({ dataset: "Regions", encodings: { x: "state", length: "count" } }))
	}, 60_000)

	afterAll(() => {
		server?.close()
	})

	it("takes a picture that fits, and leaves no profile behind", async () => {
		const tmp = tempDir("real-tmp")
		const renderer = createRenderer({ pageBase: base, tmpDir: tmp })
		const outcome = await renderer.picture(chartId)
		expect(outcome.ok, outcome.ok ? "" : outcome.reason).toBe(true)
		if (!outcome.ok) return
		expect(outcome.picture.mimeType).toBe("image/webp")
		expect(outcome.picture.data.length).toBeLessThanOrEqual(120_000)
		const out = process.env.VIS_TEST_PICTURE_OUT
		if (out) writeFileSync(join(out, "picture.webp"), Buffer.from(outcome.picture.data, "base64"))
		// 60 long category labels: drawn wider than the 650 px default.
		expect(outcome.picture.width).toBeGreaterThan(650)
		expect(readdirSync(tmp)).toEqual([])
		await renderer.close()
	}, 60_000)

	it("exports a PNG and a PDF through the app's export mode", async () => {
		const exportDir = join(tempDir("real-out"), "Charts")
		mkdirSync(exportDir)
		const renderer = createRenderer({ pageBase: base, env: { ...process.env, VIS_EXPORT_DIR: exportDir } })
		const png = await renderer.exportChart(chartId, { format: "png", width: 700, height: 450, pixelRatio: 2, fileName: "Regions" })
		expect(png).toMatchObject({ ok: true, width: 700, height: 450, pixelRatio: 2 })
		if (png.ok) expect(readFileSync(png.path).readUInt32BE(16)).toBe(1400)
		const pdf = await renderer.exportChart(chartId, { format: "pdf", fileName: "Regions" })
		expect(pdf.ok && readFileSync(pdf.path).subarray(0, 5).toString()).toBe("%PDF-")
		expect((await renderer.picture("no-such-chart")).ok).toBe(false)
		await renderer.close()
	}, 120_000)
})
