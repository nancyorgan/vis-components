// @vitest-environment node
// The renderer against the stub browser (stubBrowser.mjs): process
// handling, the read-only page, the queue, the deadline, the picture size
// and encode loops, and the export file rules. POSIX only (the stub is
// started through a shell launcher).
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createRenderer, type Renderer } from "./index"
import { MAX_PICTURE_CHARS } from "./sizing"
import { makeStub, pidAlive, startVisualServer, tempDir, type Stub, type VisualServer } from "./testStub"

let server: VisualServer

beforeAll(async () => {
	server = await startVisualServer({
		plain: { id: "plain", channelConfigs: {} },
		fixed: { id: "fixed", channelConfigs: { canvasSize: { enabled: true, width: 800, height: 500 } } },
	})
})
afterAll(async () => {
	await server.close()
})

type Setup = { stub: Stub; renderer: Renderer; tmp: string; home: string; exportDir: string }

const setup = (
	knobs: Record<string, string> = {},
	opts: { deadlineMs?: number; exportDeadlineMs?: number; exportDir?: string } = {}
): Setup => {
	const dir = tempDir("stub")
	const tmp = join(dir, "tmp")
	const home = join(dir, "home")
	mkdirSync(tmp)
	mkdirSync(home)
	const stub = makeStub(dir, knobs)
	const exportDir = opts.exportDir ?? join(dir, "exports")
	const renderer = createRenderer({
		pageBase: server.base,
		env: { VIS_BROWSER_PATH: stub.path, VIS_EXPORT_DIR: exportDir },
		deadlineMs: opts.deadlineMs,
		exportDeadlineMs: opts.exportDeadlineMs,
		tmpDir: tmp,
		homeDir: home,
	})
	return { stub, renderer, tmp, home, exportDir }
}

const startedPids = (stub: Stub): number[] =>
	stub.events().flatMap((e) => (e.event === "start" ? [e.pid] : e.event === "helper" ? [e.helperPid as number] : []))

const navigations = (stub: Stub): URL[] =>
	stub.events().flatMap((e) => (e.event === "navigate" ? [new URL(e.url as string)] : []))

describe.skipIf(process.platform === "win32")("renderer (stub browser)", () => {
	it("starts headless on a fresh profile over the pipe, and deletes the profile after", async () => {
		const { stub, renderer, tmp } = setup()
		const outcome = await renderer.picture("plain")
		expect(outcome.ok).toBe(true)
		if (!outcome.ok) return
		expect(outcome.picture.mimeType).toBe("image/webp")
		expect(outcome.picture.shownShare).toBeUndefined()
		const start = stub.events().find((e) => e.event === "start")
		const argv = start?.argv as string[]
		expect(argv).toContain("--headless=new")
		expect(argv).toContain("--remote-debugging-pipe")
		expect(argv).toContain("--no-first-run")
		expect(argv).toContain("--disable-extensions")
		expect(argv.some((a) => a.startsWith("--remote-debugging-port"))).toBe(false)
		const profile = argv.find((a) => a.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length) ?? ""
		expect(profile.startsWith(tmp)).toBe(true)
		expect(start?.profileExists).toBe(true)
		expect(existsSync(profile)).toBe(false)
		expect(readdirSync(tmp)).toEqual([])
		expect(startedPids(stub).filter(pidAlive)).toEqual([])
		// Export mode, as PNG, at the default size.
		const [url] = navigations(stub)
		expect(url.pathname).toBe("/embed/plain")
		expect(url.searchParams.get("export")).toBe("png")
		expect(url.searchParams.has("width")).toBe(false)
	})

	it("a deadline kills the browser and a helper that ignore being stopped", async () => {
		const { stub, renderer, tmp } = setup(
			{ STUB_EXPORT: "never", STUB_HELPER: "1", STUB_IGNORE_CLOSE: "1" },
			{ deadlineMs: 1500 }
		)
		const started = Date.now()
		const outcome = await renderer.picture("plain")
		const took = Date.now() - started
		expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("took longer than 1.5 s") })
		expect(took).toBeLessThan(1500 + 4000)
		const pids = startedPids(stub)
		expect(pids.length).toBe(2)
		expect(pids.filter(pidAlive)).toEqual([])
		expect(readdirSync(tmp)).toEqual([])
	})

	it("repeated deadline runs leave nothing behind", async () => {
		const { stub, renderer } = setup({ STUB_EXPORT: "never", STUB_HELPER: "1" }, { deadlineMs: 800 })
		for (let i = 0; i < 3; i++) expect((await renderer.picture("plain")).ok).toBe(false)
		expect(startedPids(stub).length).toBe(6)
		expect(startedPids(stub).filter(pidAlive)).toEqual([])
	})

	it("one render at a time: six pictures at once never overlap", async () => {
		const { stub, renderer } = setup({ STUB_HELPER: "1" })
		const outcomes = await Promise.all(Array.from({ length: 6 }, () => renderer.picture("plain")))
		expect(outcomes.every((o) => o.ok)).toBe(true)
		const starts = stub.events().filter((e) => e.event === "start")
		expect(starts.length).toBe(6)
		expect(starts.map((e) => e.concurrent)).toEqual([0, 0, 0, 0, 0, 0])
		expect(startedPids(stub).filter(pidAlive)).toEqual([])
	})

	it("the page can only read: a POST is failed, a GET continues", async () => {
		const { stub, renderer } = setup({ STUB_PAGE_REQUESTS: "1" })
		expect((await renderer.picture("plain")).ok).toBe(true)
		const fetches = stub.events().filter((e) => e.event === "fetch")
		expect(fetches).toContainEqual(expect.objectContaining({ verb: "POST", action: "fail", errorReason: "BlockedByClient" }))
		expect(fetches).toContainEqual(expect.objectContaining({ verb: "GET", action: "continue" }))
		// Interception is on before the page opens.
		const methods = stub.events().flatMap((e) => (e.event === "command" ? [e.method] : []))
		expect(methods.indexOf("Fetch.enable")).toBeLessThan(methods.indexOf("Page.navigate"))
	})

	it("steps the encoding down until the picture fits, never returning more", async () => {
		const { stub, renderer } = setup({ STUB_WEBP_CHARS: "400000" })
		const outcome = await renderer.picture("plain")
		expect(outcome.ok).toBe(true)
		if (!outcome.ok) return
		expect(outcome.picture.data.length).toBeLessThanOrEqual(MAX_PICTURE_CHARS)
		const tries = stub.events().filter((e) => e.event === "encoded")
		expect(tries.length).toBeGreaterThan(1)
		for (const t of tries.slice(0, -1)) expect(t.chars as number).toBeGreaterThan(MAX_PICTURE_CHARS)
		expect(outcome.picture.width).toBe(tries.at(-1)?.width)
	})

	it("too large at every step → tooLarge, no picture", async () => {
		const { renderer } = setup({ STUB_WEBP_FIXED_CHARS: String(MAX_PICTURE_CHARS + 1) })
		const outcome = await renderer.picture("plain")
		expect(outcome.ok).toBe(false)
		if (outcome.ok) return
		expect(outcome.tooLarge).toBe(true)
		expect("picture" in outcome).toBe(false)
	})

	it("a fixed canvas is drawn at its own size, once", async () => {
		const { stub, renderer } = setup({ STUB_CANVAS: "800x500" })
		const outcome = await renderer.picture("fixed")
		expect(outcome.ok).toBe(true)
		const urls = navigations(stub)
		expect(urls.length).toBe(1)
		expect(urls[0].searchParams.has("width")).toBe(false)
		if (outcome.ok) expect([outcome.picture.width, outcome.picture.height]).toEqual([1600, 1000])
	})

	it("gives crowded category labels room, then redraws once larger when still cut off", async () => {
		const measure = {
			rootWidth: 650,
			rootHeight: 400,
			panels: [
				{
					left: 0,
					top: 0,
					width: 900,
					height: 400,
					visible: 650 * 400,
					x: { n: 50, span: 490, textW: 30, textH: 12 },
					y: null,
				},
			],
		}
		const { stub, renderer } = setup({ STUB_MEASURE: JSON.stringify(measure) })
		const outcome = await renderer.picture("plain")
		const urls = navigations(stub)
		expect(urls.length).toBe(3)
		const width1 = Number(urls[1].searchParams.get("width"))
		expect(width1).toBeGreaterThan(650)
		expect(Number(urls[2].searchParams.get("width"))).toBeGreaterThan(width1)
		// The stub's plot never fits: the share shown is reported.
		expect(outcome.ok && outcome.picture.shownShare).toBeCloseTo(650 / 900, 2)
	})

	it("a missing chart is refused without starting a browser", async () => {
		const { stub, renderer } = setup()
		expect(await renderer.picture("nope")).toEqual({ ok: false, reason: 'No chart with id "nope".' })
		expect(stub.events()).toEqual([])
	})

	it("a browser that exits at start, an export error: short reasons, no throw", async () => {
		const crashed = await setup({ STUB_EXIT: "1" }).renderer.picture("plain")
		expect(crashed).toEqual({ ok: false, reason: expect.stringContaining("exit code 3") })
		const failed = await setup({ STUB_EXPORT: "error" }).renderer.picture("plain")
		expect(failed).toEqual({ ok: false, reason: "Visualization not found." })
	})

	it("no browser → a plain reason", async () => {
		const renderer = createRenderer({ pageBase: server.base, env: { PATH: "" }, platform: "linux" })
		expect(await renderer.picture("plain")).toEqual({ ok: false, reason: expect.stringContaining("No Chrome or Edge") })
	})

	it("close() stops a render in flight and refuses later ones", async () => {
		const { stub, renderer } = setup({ STUB_EXPORT: "never" }, { deadlineMs: 30_000 })
		const pending = renderer.picture("plain")
		await new Promise((resolve) => setTimeout(resolve, 600))
		await renderer.close()
		expect(await pending).toEqual({ ok: false, reason: expect.stringContaining("shut down") })
		expect(startedPids(stub).filter(pidAlive)).toEqual([])
		expect((await renderer.picture("plain")).ok).toBe(false)
	})

	// -------------------------------------------------------------------------
	// Export
	// -------------------------------------------------------------------------

	it("exports through export mode, passing the size through and reporting what was used", async () => {
		const { stub, renderer, exportDir } = setup()
		const outcome = await renderer.exportChart("plain", {
			format: "png",
			width: 20,
			height: 300,
			pixelRatio: 2,
			fileName: "Chart",
		})
		expect(outcome).toMatchObject({ ok: true, format: "png", width: 50, height: 300, pixelRatio: 2 })
		if (!outcome.ok) return
		expect(outcome.path).toBe(join(exportDir, "Chart.png"))
		expect(readFileSync(outcome.path).subarray(1, 4).toString()).toBe("PNG")
		expect(outcome.bytes).toBe(readFileSync(outcome.path).length)
		const [url] = navigations(stub)
		expect(Object.fromEntries(url.searchParams)).toEqual({ export: "png", width: "20", height: "300", ratio: "2" })
	})

	it("jpeg → .jpg; a taken name gets (2) and the first stays byte for byte", async () => {
		const { renderer, exportDir } = setup()
		const jpg = await renderer.exportChart("plain", { format: "jpeg", fileName: "Photo" })
		expect(jpg.ok && jpg.path).toBe(join(exportDir, "Photo.jpg"))
		const first = await renderer.exportChart("plain", { format: "pdf", fileName: "Board deck" })
		expect(first.ok && first.path).toBe(join(exportDir, "Board deck.pdf"))
		writeFileSync(join(exportDir, "Board deck.pdf"), "the person's own edit")
		const second = await renderer.exportChart("plain", { format: "pdf", fileName: "Board deck" })
		expect(second.ok && second.path).toBe(join(exportDir, "Board deck (2).pdf"))
		expect(readFileSync(join(exportDir, "Board deck.pdf"), "utf8")).toBe("the person's own edit")
	})

	it("never writes through a link at the target name", async () => {
		const outside = tempDir("outside")
		const { renderer, exportDir } = setup()
		mkdirSync(exportDir)
		symlinkSync(join(outside, "victim.png"), join(exportDir, "Board.png"))
		const outcome = await renderer.exportChart("plain", { format: "png", fileName: "Board" })
		expect(outcome.ok && outcome.path).toBe(join(exportDir, "Board (2).png"))
		expect(readdirSync(outside)).toEqual([])
		expect(lstatSync(join(exportDir, "Board.png")).isSymbolicLink()).toBe(true)
	})

	it("refuses an Export folder that is a link to another folder", async () => {
		const outside = tempDir("outside")
		const dir = tempDir("linked")
		const linked = join(dir, "Charts")
		symlinkSync(outside, linked)
		const { stub, renderer } = setup({}, { exportDir: linked })
		const outcome = await renderer.exportChart("plain", { format: "png", fileName: "Board" })
		expect(outcome).toEqual({ ok: false, reason: expect.stringContaining("is a link") })
		expect(readdirSync(outside)).toEqual([])
		expect(stub.events()).toEqual([])
	})

	it("a page error or a page that never finishes writes nothing", async () => {
		const failing = setup({ STUB_EXPORT: "error" })
		const failed = await failing.renderer.exportChart("plain", { format: "png", fileName: "x" })
		expect(failed).toEqual({ ok: false, reason: "Visualization not found; nothing was saved." })
		expect(existsSync(failing.exportDir)).toBe(false)

		const stuck = setup({ STUB_EXPORT: "never", STUB_HELPER: "1" }, { exportDeadlineMs: 1200 })
		const started = Date.now()
		const timedOut = await stuck.renderer.exportChart("plain", { format: "svg", fileName: "x" })
		expect(Date.now() - started).toBeLessThan(1200 + 5000)
		expect(timedOut).toEqual({ ok: false, reason: expect.stringContaining("didn't finish within 1.2 s") })
		expect(existsSync(stuck.exportDir)).toBe(false)
		expect(startedPids(stuck.stub).filter(pidAlive)).toEqual([])
	})

	it("a missing chart or a refused name writes nothing and starts no browser", async () => {
		const { stub, renderer, exportDir } = setup()
		expect(await renderer.exportChart("nope", { format: "png", fileName: "x" })).toEqual({
			ok: false,
			reason: 'No chart with id "nope"; nothing was saved.',
		})
		expect(await renderer.exportChart("plain", { format: "png", fileName: "../Board" })).toMatchObject({ ok: false })
		expect(existsSync(exportDir)).toBe(false)
		expect(stub.events()).toEqual([])
	})
})
