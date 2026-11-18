/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions -- storage probes run inside page.evaluate (browser context); the JSON body is a test fixture, not app data */
/** The 0016 public-embed contract, tested literally: publish through the
 *  self-host server, STOP that server, serve the publish directory with a
 *  dumb static file server, and assert the embed renders and stays
 *  interactive — writing nothing durable and requesting nothing beyond its
 *  own origin (Google Fonts excepted).
 *
 *  Needs build artifacts (`dist/embed-runtime.html`, `server/dist/main.js`),
 *  so it skip-guards on their absence — run `pnpm build` first. It manages
 *  its own servers on ephemeral ports; the harness's Vite dev server (the
 *  browser-local app) plays no part, which is the point. */

import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const serverMain = join(repoRoot, "server", "dist", "main.js")
const runtimeTemplate = join(repoRoot, "dist", "embed-runtime.html")
const buildMissing = !existsSync(serverMain) || !existsSync(runtimeTemplate)

const PUBLISH_ID = "e2e00000-1111-4222-8333-444455556666"

/** The PNG signature plus a few bytes — the picture route checks only the
 *  signature, so this stands in for a rasterized chart. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_BYTES = Buffer.concat([PNG_SIGNATURE, Buffer.from([0x00, 0x01, 0x02])])

const payload = {
	v: 1,
	parts: ["full"],
	payload: {
		// Inside the public boundary (server/src/publicEmbed.ts): placeholder
		// ids, and only what the chart draws from.
		visual: {
			id: "embed",
			name: "Published embed e2e",
			datasetId: "embed-data",
			themeId: null,
			fieldTypeOverrides: {},
			encodings: { x: { field: "category" }, length: { field: "value" } },
			channelConfigs: {},
			labelsConfig: {},
		},
		dataset: {
			id: "embed-data",
			fields: [
				{ name: "category", inferredType: "categorical" },
				{ name: "value", inferredType: "quantitative" },
			],
			versions: [
				{
					id: "embed-version",
					rows: [
						{ category: "A", value: "10" },
						{ category: "B", value: "20" },
						{ category: "C", value: "15" },
					],
				},
			],
			latestVersionId: "embed-version",
		},
		theme: null,
		fonts: [],
	},
}

/** Minimal static file server over the publish dir — the stand-in for
 *  `python3 -m http.server` in Chris's contract. */
const serveStatic = (dir: string): Promise<{ server: Server; port: number }> =>
	new Promise((resolve) => {
		const types: Record<string, string> = {
			".html": "text/html",
			".png": "image/png",
			// The shared embed app under runtime/: a browser refuses a
			// module script without a JavaScript type.
			".js": "text/javascript",
			".css": "text/css",
		}
		const server = createServer((req, res) => {
			const path = normalize(join(dir, (req.url ?? "/").split("?")[0]))
			if (!path.startsWith(dir) || !existsSync(path)) {
				res.writeHead(404)
				res.end()
				return
			}
			res.writeHead(200, {
				"content-type": types[extname(path)] ?? "application/octet-stream",
			})
			res.end(readFileSync(path))
		})
		server.listen(0, () => {
			resolve({ server, port: (server.address() as AddressInfo).port })
		})
	})

/** An OS-assigned free port (the vis server's config requires a concrete
 *  port number, so pick one the same way listen(0) would). */
const freePort = (): Promise<number> =>
	new Promise((resolve) => {
		const probe = createServer()
		probe.listen(0, () => {
			const port = (probe.address() as AddressInfo).port
			probe.close(() => resolve(port))
		})
	})

const startVisServer = async (publishDir: string, staticPort: number) => {
	const port = await freePort()
	return new Promise<{ child: ChildProcess; port: number }>((resolve, reject) => {
		const child = spawn("node", [serverMain], {
			env: {
				...process.env,
				VIS_BASE_URL: `http://localhost:${port}`,
				VIS_DB_DIR: mkdtempSync(join(tmpdir(), "vis-e2e-db-")),
				VIS_DATA_DIR: mkdtempSync(join(tmpdir(), "vis-e2e-data-")),
				VIS_PORT: String(port),
				VIS_PUBLISH_DIR: publishDir,
				VIS_PUBLISH_BASE_URL: `http://localhost:${staticPort}`,
			},
			stdio: ["ignore", "pipe", "pipe"],
		})
		let out = ""
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString()
			if (out.includes("listening on port")) resolve({ child, port })
		})
		let err = ""
		child.stderr?.on("data", (chunk: Buffer) => {
			err += chunk.toString()
		})
		child.on("error", reject)
		child.on("exit", (code) =>
			reject(new Error(`server exited early (${code}): ${err}`))
		)
	})
}

test.describe("published embed (0016 contract)", () => {
	test("renders, hovers, and stays clean with the app server off", async ({
		page,
	}) => {
		test.skip(
			buildMissing,
			"needs build artifacts — run `pnpm build` first (dist/embed-runtime.html + server/dist/main.js)"
		)
		test.setTimeout(60_000)

		const publishDir = mkdtempSync(join(tmpdir(), "vis-e2e-publish-"))
		const { server: staticServer, port: staticPort } = await serveStatic(publishDir)
		const { child, port: visPort } = await startVisServer(publishDir, staticPort)

		let publishedUrl: string
		try {
			const response = await fetch(
				`http://localhost:${visPort}/api/embeds/${PUBLISH_ID}`,
				{
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
				}
			)
			expect(response.status).toBe(200)
			const body = (await response.json()) as { urls: { full: string } }
			publishedUrl = body.urls.full
			expect(publishedUrl).toBe(
				`http://localhost:${staticPort}/embeds/${PUBLISH_ID}/index.html`
			)

			// The picture upload that trails the HTML publish lands beside it.
			const form = new FormData()
			form.append(
				"image",
				new Blob([new Uint8Array(PNG_BYTES)], { type: "image/png" }),
				"image.png"
			)
			const imageResponse = await fetch(
				`http://localhost:${visPort}/api/embeds/${PUBLISH_ID}/image`,
				{ method: "PUT", body: form }
			)
			expect(imageResponse.status).toBe(200)
			const imageBody = (await imageResponse.json()) as { v: number; url: string }
			expect(imageBody).toEqual({
				v: 1,
				url: `http://localhost:${staticPort}/embeds/${PUBLISH_ID}/image.png`,
			})
			const picture = await fetch(imageBody.url)
			expect(picture.status).toBe(200)
			expect(picture.headers.get("content-type")).toBe("image/png")
			const pictureBytes = Buffer.from(await picture.arrayBuffer())
			expect(pictureBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(
				true
			)
		} finally {
			// The headline guarantee: everything after this point happens with
			// the app server completely off.
			child.removeAllListeners("exit")
			child.kill()
		}

		const requests: string[] = []
		page.on("request", (r) => requests.push(r.url()))
		await page.goto(publishedUrl)

		// The real chart pipeline renders the payload's three bars.
		const bars = page.locator("rect[stroke]")
		await expect(bars).toHaveCount(3, { timeout: 15_000 })

		// Interactivity ships inside the file: hovering a bar raises a tooltip
		// carrying that bar's value.
		await bars.nth(1).hover()
		await expect(page.getByText("20").first()).toBeVisible()

		// Rule 6: nothing durable lands in the viewer's browser.
		const localStorageKeys = await page.evaluate(() => localStorage.length)
		expect(localStorageKeys).toBe(0)
		const idbNames = await page.evaluate(async () =>
			(await indexedDB.databases()).map((d) => d.name)
		)
		expect(idbNames).toEqual([])

		// Rule 1: no request beyond the embed's own origin (Google Fonts is the
		// one sanctioned exception, mirroring the app's own font loading).
		const foreign = requests.filter(
			(u) =>
				!u.startsWith(`http://localhost:${staticPort}/`) &&
				!u.startsWith("https://fonts.")
		)
		expect(foreign).toEqual([])

		// The app is not in the page: it loads from the shared runtime/
		// folder, under names the publish host caches for a year.
		const app = requests.filter((u) =>
			/\/runtime\/[a-z0-9-]+-[0-9a-f]{16,64}\.(js|css)$/.test(u)
		)
		expect(app).toHaveLength(2)
		expect((await (await fetch(publishedUrl)).text()).length).toBeLessThan(200_000)

		staticServer.close()
	})
})
