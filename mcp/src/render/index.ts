/** The picture + export engine: the stored chart drawn by the app's own
 *  renderer in the Chrome or Edge already on this machine, headless.
 *
 *  Both paths load the embed page's EXPORT MODE
 *  (`/embed/<id>?export=png|jpeg|svg|pdf`, see APPLICATION.md), which runs
 *  the Export dialog's pipeline on the page and hands the file back in
 *  `#export-result`. A picture is that PNG, sized so the whole plot shows,
 *  re-encoded as WebP inside the page until it fits the reply; an export is
 *  the file itself, written into the Export folder.
 *
 *  Rules every render keeps: one at a time (one queue for pictures and
 *  exports), a fresh throwaway profile, a page that can only read (every
 *  request but GET / HEAD fails), and a deadline that ends the browser and
 *  everything it started even when it won't stop. Nothing here throws to
 *  the caller; every failure is an outcome with a short plain reason. */

import { homedir, tmpdir } from "node:os"

import { browserExists, findBrowser, launchBrowser, LaunchError, type Browser } from "./browser"
import { CdpError, type CdpEvent } from "./cdp"
import {
	checkFileName,
	EXTENSIONS,
	ExportFolderError,
	resolveExportFolder,
	snapshotFolder,
	writeExportFile,
	type FolderSnapshot,
} from "./files"
import {
	chunkScript,
	DEFAULT_SIZE,
	encodeScript,
	encodeSteps,
	isCutOff,
	LOAD_SCRIPT,
	MARK_SCRIPT,
	MAX_PICTURE_CHARS,
	MEASURE_SCRIPT,
	pictureRatio,
	shownShare,
	sizeForLabels,
	sizeForOverflow,
	STATE_SCRIPT,
	type Encoded,
	type Measure,
	type PageState,
	type Size,
} from "./sizing"

export { checkFileName, findBrowser, resolveExportFolder }

export type Picture = {
	data: string /* base64, no data: prefix */
	mimeType: "image/webp" | "image/png"
	width: number
	height: number
	shownShare?: number /* 0..1 when part of the plot is cut off */
}
export type PictureOutcome = { ok: true; picture: Picture } | { ok: false; reason: string; tooLarge?: boolean }
export type ExportFormat = "png" | "jpeg" | "svg" | "pdf"
export type ExportOutcome =
	| { ok: true; path: string; format: ExportFormat; bytes: number; width: number; height: number; pixelRatio: number }
	| { ok: false; reason: string }
export type Renderer = {
	picture(visualId: string): Promise<PictureOutcome>
	exportChart(
		visualId: string,
		req: { format: ExportFormat; width?: number; height?: number; pixelRatio?: number; fileName: string }
	): Promise<ExportOutcome>
	close(): Promise<void>
}

export type RendererOptions = {
	pageBase: string
	env?: NodeJS.ProcessEnv
	deadlineMs?: number
	exportDeadlineMs?: number
	platform?: NodeJS.Platform
	homeDir?: string
	tmpDir?: string
}

const DEFAULT_PICTURE_DEADLINE_MS = 20_000
const DEFAULT_EXPORT_DEADLINE_MS = 60_000
/** Starting the browser, before an export's page opens. */
const EXPORT_STARTUP_MS = 30_000
const POLL_MS = 150
/** Base64 characters per read of a large export result. */
const CHUNK_CHARS = 4_000_000

// ---------------------------------------------------------------------------
// The shared render queue: one render at a time across every renderer in
// this process, so many requests at once never start many browsers.
// ---------------------------------------------------------------------------

let queueTail: Promise<unknown> = Promise.resolve()

const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
	const run = queueTail.then(job, job)
	queueTail = run.catch(() => undefined)
	return run
}

// ---------------------------------------------------------------------------
// Deadline
// ---------------------------------------------------------------------------

class Stop extends Error {
	constructor(message: string) {
		super(message)
		this.name = "Stop"
	}
}

/** A timer that, when it fires (or is triggered), rejects `promise`;
 *  racing the work against it bounds the work. `reset` restarts it. */
class Deadline {
	readonly promise: Promise<never>
	private reject!: (error: Error) => void
	private timer: NodeJS.Timeout | null = null
	private fired = false
	constructor(
		ms: number,
		private message: string
	) {
		this.promise = new Promise<never>((_, reject) => {
			this.reject = reject
		})
		this.promise.catch(() => undefined)
		this.reset(ms)
	}
	reset(ms: number, message?: string): void {
		if (this.fired) return
		if (message) this.message = message
		if (this.timer) clearTimeout(this.timer)
		this.timer = setTimeout(() => this.trigger(this.message), ms)
	}
	trigger(message: string): void {
		if (this.fired) return
		this.fired = true
		if (this.timer) clearTimeout(this.timer)
		this.reject(new Stop(message))
	}
	cancel(): void {
		this.fired = true
		if (this.timer) clearTimeout(this.timer)
	}
	race<T>(work: Promise<T>): Promise<T> {
		return Promise.race([work, this.promise])
	}
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`

const reasonOf = (error: unknown): string => {
	const message = error instanceof Error ? error.message : String(error)
	return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// The page: one tab whose every write fails
// ---------------------------------------------------------------------------

type Page = {
	open(url: string, viewport: Size): Promise<void>
	evaluate<T>(expression: string): Promise<T>
}

/** Open a tab, make it read-only (the Fetch domain fails every request but
 *  GET / HEAD, in the tab and in any worker it starts) and hand back the
 *  calls the renderer needs. `failed` rejects if the tab crashes. */
const openPage = async (browser: Browser, deadline: Deadline): Promise<Page> => {
	const { cdp } = browser
	const onEvent = (event: CdpEvent): void => {
		const { method, params, sessionId } = event
		if (method === "Fetch.requestPaused") {
			const request = params.request as { method?: string } | undefined
			const verb = (request?.method ?? "").toUpperCase()
			const requestId = params.requestId
			if (verb === "GET" || verb === "HEAD") {
				void cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => undefined)
			} else {
				void cdp
					.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId)
					.catch(() => undefined)
			}
			return
		}
		if (method === "Target.attachedToTarget") {
			// A worker or frame the page starts: read-only too, before it runs.
			const child = params.sessionId as string | undefined
			if (!child) return
			void (async () => {
				try {
					await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, child)
				} catch {
					// A target that can't intercept (e.g. a service worker gone) —
					// it is still held at its start; let it go.
				}
				await cdp.send("Runtime.runIfWaitingForDebugger", {}, child).catch(() => undefined)
			})()
			return
		}
		if (method === "Inspector.targetCrashed" || method === "Target.targetCrashed") {
			deadline.trigger("The browser's page crashed while drawing the chart.")
		}
	}
	cdp.onEvent(onEvent)

	const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })
	const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })
	await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId)
	await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId)
	await cdp.send("Page.enable", {}, sessionId)

	return {
		async open(url, viewport) {
			await cdp.send(
				"Emulation.setDeviceMetricsOverride",
				{
					width: Math.max(800, Math.ceil(viewport.width) + 40),
					height: Math.max(600, Math.ceil(viewport.height) + 40),
					deviceScaleFactor: 1,
					mobile: false,
				},
				sessionId
			)
			// Mark the document being left, so a poll that lands before the
			// new one commits can't read the previous drawing's result.
			await cdp
				.send("Runtime.evaluate", { expression: MARK_SCRIPT, returnByValue: true }, sessionId)
				.catch(() => undefined)
			const nav = await cdp.send<{ errorText?: string }>("Page.navigate", { url }, sessionId)
			if (nav.errorText) throw new Stop(`Couldn't open the chart page (${nav.errorText}).`)
		},
		async evaluate<T>(expression: string): Promise<T> {
			const reply = await cdp.send<{
				result?: { value?: unknown }
				exceptionDetails?: { text?: string; exception?: { description?: string } }
			}>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)
			if (reply.exceptionDetails) {
				const d = reply.exceptionDetails
				throw new Stop(`The chart page failed: ${d.exception?.description?.split("\n")[0] ?? d.text ?? "error"}`)
			}
			return reply.result?.value as T
		},
	}
}

type ExportResult = Extract<PageState, { kind: "result" }>

/** Wait for the export mode to finish: the result's facts, or a Stop with
 *  the page's own message. */
const waitForExport = async (page: Page): Promise<ExportResult> => {
	for (;;) {
		const state = await page.evaluate<PageState | null>(STATE_SCRIPT)
		if (state?.kind === "result") return state
		if (state?.kind === "error") throw new Stop(state.message)
		if (state?.kind === "notApp") throw new Stop("The server's page isn't the Zafiro app (is the app built and served?).")
		await delay(POLL_MS)
	}
}

const readResultBase64 = async (page: Page, length: number): Promise<string> => {
	const parts: string[] = []
	for (let start = 0; start < length; start += CHUNK_CHARS) {
		parts.push(await page.evaluate<string>(chunkScript(start, Math.min(length, start + CHUNK_CHARS))))
	}
	return parts.join("")
}

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

type VisualRead = { kind: "found"; fixed: Size | null } | { kind: "missing" } | { kind: "unknown" }

export const createRenderer = (opts: RendererOptions): Renderer => {
	const base = opts.pageBase.replace(/\/+$/, "")
	const env = opts.env ?? process.env
	const platform = opts.platform ?? process.platform
	const home = opts.homeDir ?? homedir()
	const tmp = opts.tmpDir ?? tmpdir()
	const pictureDeadline = opts.deadlineMs ?? DEFAULT_PICTURE_DEADLINE_MS
	const exportDeadline = opts.exportDeadlineMs ?? DEFAULT_EXPORT_DEADLINE_MS

	let closed = false
	const active = new Set<{ deadline: Deadline; done: Promise<unknown> }>()
	const CLOSED = "The picture engine was shut down."

	/** The stored chart, read the way the editor reads one: whether it is
	 *  there, and its own fixed canvas size when it sets one. */
	const readVisual = async (id: string, deadline: Deadline): Promise<VisualRead> => {
		let response: Response
		try {
			response = await deadline.race(fetch(`${base}/api/visuals/${encodeURIComponent(id)}`))
		} catch (error) {
			if (error instanceof Stop) throw error
			throw new Stop(`Could not reach the Zafiro server at ${base}.`)
		}
		if (response.status === 404) return { kind: "missing" }
		if (!response.ok) return { kind: "unknown" }
		try {
			const visual = (await deadline.race(response.json())) as {
				channelConfigs?: { canvasSize?: { enabled?: boolean; width?: number; height?: number } }
			}
			const c = visual.channelConfigs?.canvasSize
			const fixed =
				c?.enabled && typeof c.width === "number" && typeof c.height === "number"
					? { width: c.width, height: c.height }
					: null
			return { kind: "found", fixed }
		} catch (error) {
			if (error instanceof Stop) throw error
			return { kind: "unknown" }
		}
	}

	/** Run `work` with a fresh browser, bounded by `deadline`; the browser
	 *  and everything it started are gone when this resolves. */
	const withBrowser = async <T>(deadline: Deadline, work: (page: Page) => Promise<T>): Promise<T> => {
		const executable = findBrowser(env, platform, browserExists)
		if (!executable) {
			throw new Stop("No Chrome or Edge found on this computer; install one, or set VIS_BROWSER_PATH to its program.")
		}
		const launching = launchBrowser({ executable, tmpDir: tmp, platform })
		launching.catch(() => undefined)
		try {
			const browser = await deadline.race(launching)
			const exited = browser.exited.then((reason) => {
				throw new Stop(reason)
			})
			exited.catch(() => undefined)
			const run = (async () => {
				await browser.cdp.send("Browser.getVersion")
				const page = await openPage(browser, deadline)
				return work(page)
			})()
			run.catch(() => undefined)
			return await deadline.race(Promise.race([run, exited]))
		} catch (error) {
			if (error instanceof LaunchError) throw new Stop(error.message)
			if (error instanceof CdpError) {
				// The connection dropped: say why the browser went, when it did.
				const browser = await launching.catch(() => null)
				const exitReason = browser ? await Promise.race([browser.exited, delay(500).then(() => null)]) : null
				throw new Stop(exitReason ?? error.message)
			}
			throw error
		} finally {
			deadline.cancel()
			// Even a launch the deadline cut short is stopped once it lands
			// (starting is a spawn, never a wait on the browser).
			const browser = await launching.catch(() => null)
			if (browser) await browser.stop()
		}
	}

	/** One queued render for this renderer, honoring close(). */
	const job = <T>(deadlineMs: number, timeoutMessage: string, work: (d: Deadline) => Promise<T>): Promise<T> =>
		enqueue(async () => {
			if (closed) throw new Stop(CLOSED)
			const deadline = new Deadline(deadlineMs, timeoutMessage)
			const done = work(deadline)
			const entry = { deadline, done }
			active.add(entry)
			try {
				return await done
			} finally {
				deadline.cancel()
				active.delete(entry)
			}
		})

	const picture = async (visualId: string): Promise<PictureOutcome> => {
		if (closed) return { ok: false, reason: CLOSED }
		try {
			return await job(
				pictureDeadline,
				`The chart took longer than ${seconds(pictureDeadline)} to draw, so there is no picture.`,
				async (deadline) => {
					const visual = await readVisual(visualId, deadline)
					if (visual.kind === "missing") return { ok: false, reason: `No chart with id "${visualId}".` }
					const fixed = visual.kind === "found" ? visual.fixed : null
					return withBrowser(deadline, (page) => drawPicture(page, visualId, fixed))
				}
			)
		} catch (error) {
			return { ok: false, reason: reasonOf(error) }
		}
	}

	const embedUrl = (visualId: string, params: Record<string, string | number | undefined>): string => {
		const search = new URLSearchParams()
		for (const [k, v] of Object.entries(params)) if (v !== undefined) search.set(k, String(v))
		return `${base}/embed/${encodeURIComponent(visualId)}?${search.toString()}`
	}

	/** Draw at `size` (null: the chart's own fixed canvas, or the default)
	 *  and measure the drawing. */
	const drawAt = async (page: Page, visualId: string, size: Size | null, fixed: Size | null) => {
		const css = size ?? fixed ?? DEFAULT_SIZE
		const ratio = pictureRatio(css)
		await page.open(embedUrl(visualId, { export: "png", width: size?.width, height: size?.height, ratio }), css)
		const result = await waitForExport(page)
		const measure = await page.evaluate<Measure | null>(MEASURE_SCRIPT)
		return { result, measure, size: { width: result.width, height: result.height } }
	}

	const drawPicture = async (page: Page, visualId: string, fixed: Size | null): Promise<PictureOutcome> => {
		let drawn = await drawAt(page, visualId, null, fixed)
		if (!fixed && drawn.measure) {
			// Room for every level's label, then — if a plot still spills past
			// its box — one redraw larger.
			const forLabels = sizeForLabels(drawn.measure, drawn.size)
			if (forLabels.width > drawn.size.width || forLabels.height > drawn.size.height) {
				drawn = await drawAt(page, visualId, forLabels, fixed)
			}
			if (drawn.measure && isCutOff(drawn.measure)) {
				const larger = sizeForOverflow(drawn.measure, drawn.size)
				if (larger.width > drawn.size.width || larger.height > drawn.size.height) {
					drawn = await drawAt(page, visualId, larger, fixed)
				}
			}
		}
		const share = drawn.measure ? shownShare(drawn.measure) : undefined

		await page.evaluate(LOAD_SCRIPT)
		let smallest = Number.POSITIVE_INFINITY
		for (const step of encodeSteps(drawn.size)) {
			const encoded = await page.evaluate<Encoded | null>(encodeScript(step))
			if (!encoded || typeof encoded.data !== "string") throw new Stop("The browser couldn't encode the picture.")
			smallest = Math.min(smallest, encoded.data.length)
			if (encoded.data.length <= MAX_PICTURE_CHARS) {
				const mimeType = encoded.mime === "image/webp" ? "image/webp" : "image/png"
				const picture: Picture = { data: encoded.data, mimeType, width: encoded.width, height: encoded.height }
				if (share !== undefined) picture.shownShare = share
				return { ok: true, picture }
			}
		}
		return {
			ok: false,
			tooLarge: true,
			reason: `The picture is too detailed to send (smallest try was ${smallest.toLocaleString("en-US")} characters; the limit is ${MAX_PICTURE_CHARS.toLocaleString("en-US")}). Export the chart to a file instead.`,
		}
	}

	const exportChart: Renderer["exportChart"] = async (visualId, req) => {
		if (closed) return { ok: false, reason: CLOSED }
		const format = req.format
		if (!Object.hasOwn(EXTENSIONS, format)) return { ok: false, reason: `Unknown export format "${String(format)}".` }
		const named = checkFileName(req.fileName)
		if (!named.ok) return named
		const folder = resolveExportFolder(env, home)
		let before: FolderSnapshot
		try {
			before = await snapshotFolder(folder)
		} catch (error) {
			return { ok: false, reason: reasonOf(error) }
		}
		const dim = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined)

		let rendered: { bytes: Buffer; width: number; height: number; pixelRatio: number }
		try {
			rendered = await job(
				Math.min(EXPORT_STARTUP_MS, exportDeadline),
				`The browser didn't start in time; nothing was saved.`,
				async (deadline) => {
					const visual = await readVisual(visualId, deadline)
					if (visual.kind === "missing") throw new Stop(`No chart with id "${visualId}"; nothing was saved.`)
					return withBrowser(deadline, async (page) => {
						const url = embedUrl(visualId, {
							export: format,
							width: dim(req.width),
							height: dim(req.height),
							ratio: dim(req.pixelRatio),
						})
						// The page's own deadline runs from here.
						deadline.reset(
							exportDeadline,
							`The export didn't finish within ${seconds(exportDeadline)} of the page opening; nothing was saved.`
						)
						const viewport = { width: dim(req.width) ?? 1200, height: dim(req.height) ?? 900 }
						await page.open(url, viewport)
						const result = await waitForExport(page)
						const base64 = await readResultBase64(page, result.length)
						const bytes = Buffer.from(base64, "base64")
						if (bytes.length === 0 || (Number.isFinite(result.bytes) && bytes.length !== result.bytes)) {
							throw new Stop("The export came back incomplete; nothing was saved.")
						}
						return { bytes, width: result.width, height: result.height, pixelRatio: result.pixelRatio }
					})
				}
			)
		} catch (error) {
			const reason = reasonOf(error)
			return { ok: false, reason: /nothing was saved/.test(reason) ? reason : `${reason.replace(/\.$/, "")}; nothing was saved.` }
		}

		try {
			const path = await writeExportFile({ folder, before, name: named.name, ext: EXTENSIONS[format], bytes: rendered.bytes })
			return {
				ok: true,
				path,
				format,
				bytes: rendered.bytes.length,
				width: rendered.width,
				height: rendered.height,
				pixelRatio: rendered.pixelRatio,
			}
		} catch (error) {
			if (error instanceof ExportFolderError) return { ok: false, reason: error.message }
			return { ok: false, reason: `Couldn't save the file (${reasonOf(error)}).` }
		}
	}

	const close = async (): Promise<void> => {
		closed = true
		const running = [...active]
		for (const entry of running) entry.deadline.trigger(CLOSED)
		await Promise.all(running.map((entry) => entry.done.catch(() => undefined)))
	}

	return { picture, exportChart, close }
}
