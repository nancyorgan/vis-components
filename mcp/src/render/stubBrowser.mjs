// A stand-in for Chrome in the renderer's tests (CI has no browser). Started
// with the same flags the renderer gives Chrome, it speaks just enough of the
// DevTools protocol over --remote-debugging-pipe (commands in on fd 3, replies
// and events out on fd 4, NUL-delimited JSON) to answer every call the
// renderer makes, and logs what happened as JSON lines to $STUB_LOG.
//
// Knobs (env):
//   STUB_LOG            file to append JSON-line events to (required)
//   STUB_EXIT=1         exit with an error at once
//   STUB_HELPER=1       start a helper child that ignores SIGTERM, and
//                       ignore SIGTERM here too
//   STUB_IGNORE_CLOSE=1 answer Browser.close but keep running
//   STUB_EXPORT         ok (default) | never | error
//   STUB_EXPORT_ERROR   the #export-error text (default "Visualization not found.")
//   STUB_PAGE_REQUESTS=1  after navigating, have the "page" make a POST and a GET
//   STUB_WEBP_CHARS     base for the encoded size: chars = base * q * w*h / 1e6
//   STUB_WEBP_FIXED_CHARS  every encode answers this many characters
//   STUB_CANVAS         WxH the export mode draws at with no width/height
//                       (a chart's own fixed canvas; default 650x400)
//   STUB_MEASURE        JSON for the measure script's answer
//   STUB_SLOW_START_MS  wait this long before answering anything
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import net from "node:net"

const log = (event) => {
	if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, `${JSON.stringify({ pid: process.pid, ...event })}\n`)
}

const env = process.env
const profileArg = process.argv.find((a) => a.startsWith("--user-data-dir="))
const profileDir = profileArg ? profileArg.slice("--user-data-dir=".length) : null
// How many browsers (or their helpers) an earlier start left running now.
const alive = (pid) => {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}
const earlier = () => {
	try {
		return readFileSync(env.STUB_LOG, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
	} catch {
		return []
	}
}
const others = earlier().flatMap((e) => (e.event === "start" ? [e.pid] : e.event === "helper" ? [e.helperPid] : []))
log({
	event: "start",
	argv: process.argv.slice(2),
	profileExists: profileDir ? existsSync(profileDir) : false,
	concurrent: others.filter((pid) => pid !== process.pid && alive(pid)).length,
})

if (env.STUB_EXIT === "1") {
	process.stderr.write("stub browser: refusing to start\n")
	process.exit(3)
}

if (env.STUB_HELPER === "1") {
	process.on("SIGTERM", () => log({ event: "ignored-sigterm" }))
	const helper = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
		stdio: "ignore",
	})
	log({ event: "helper", helperPid: helper.pid })
}

const FILES = {
	png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	jpeg: "/9j/4AAQSkZJRgABAQEAYABgAAD/2Q==",
	svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="650" height="400"></svg>').toString("base64"),
	pdf: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64"),
}
const MIMES = { png: "image/png", jpeg: "image/jpeg", svg: "image/svg+xml", pdf: "application/pdf" }
const WEBP_1PX = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"

const input = new net.Socket({ fd: 3, readable: true, writable: false })
const output = new net.Socket({ fd: 4, readable: false, writable: true })

const send = (message) => output.write(`${JSON.stringify(message)}\0`)

let pageUrl = null
const clamp = (n) => Math.min(4096, Math.max(50, Math.round(n)))
const exportFacts = () => {
	const url = new URL(pageUrl)
	const format = url.searchParams.get("export")
	const num = (k) => {
		const n = Number(url.searchParams.get(k))
		return url.searchParams.has(k) && Number.isFinite(n) && n > 0 ? n : undefined
	}
	const [canvasW, canvasH] = (env.STUB_CANVAS ?? "650x400").split("x").map(Number)
	const width = clamp(num("width") ?? canvasW)
	const height = clamp(num("height") ?? canvasH)
	const pixelRatio = num("ratio") ?? 4
	const data = FILES[format] ?? FILES.png
	return { format, width, height, pixelRatio, data }
}

const evaluate = (expression) => {
	const tag = /^\/\*vc:(\w+)\*\//.exec(expression)?.[1]
	log({ event: "evaluate", tag })
	if (tag === "state") {
		const mode = env.STUB_EXPORT ?? "ok"
		if (mode === "never") return { kind: "pending" }
		if (mode === "error") return { kind: "error", message: env.STUB_EXPORT_ERROR ?? "Visualization not found." }
		const f = exportFacts()
		return {
			kind: "result",
			mime: MIMES[f.format] ?? "image/png",
			bytes: Buffer.from(f.data, "base64").length,
			width: f.width,
			height: f.height,
			pixelRatio: f.pixelRatio,
			length: f.data.length,
		}
	}
	if (tag === "chunk") {
		const [, a, b] = /slice\((\d+), (\d+)\)\s*$/.exec(expression) ?? []
		return exportFacts().data.slice(Number(a), Number(b))
	}
	if (tag === "measure") {
		if (env.STUB_MEASURE) return JSON.parse(env.STUB_MEASURE)
		const f = exportFacts()
		return {
			rootWidth: f.width,
			rootHeight: f.height,
			panels: [{ left: 0, top: 0, width: f.width, height: f.height, visible: f.width * f.height, x: null, y: null }],
		}
	}
	if (tag === "load") return { width: 1, height: 1 }
	if (tag === "encode") {
		const [, w, h, q] = /\)\((\d+), (\d+), ([\d.]+)\)\s*$/.exec(expression) ?? []
		const base = Number(env.STUB_WEBP_CHARS ?? 0)
		const width = Number(w)
		const height = Number(h)
		const fixed = Number(env.STUB_WEBP_FIXED_CHARS ?? 0)
		const data = fixed > 0 ? "A".repeat(fixed) : base > 0 ? "A".repeat(Math.round((base * Number(q) * width * height) / 1e6)) : WEBP_1PX
		log({ event: "encoded", width, height, quality: Number(q), chars: data.length })
		return { mime: "image/webp", data, width, height }
	}
	return undefined
}

let nextRequest = 1
const pendingFetch = new Map()

const handle = (message) => {
	const { id, method, params = {}, sessionId } = message
	const reply = (result) => send({ id, result, ...(sessionId ? { sessionId } : {}) })
	log({ event: "command", method, sessionId: sessionId ?? null })
	switch (method) {
		case "Browser.close":
			reply({})
			if (env.STUB_IGNORE_CLOSE !== "1") setTimeout(() => process.exit(0), 10)
			return
		case "Target.createTarget":
			return reply({ targetId: "T1" })
		case "Target.attachToTarget":
			return reply({ sessionId: "S1" })
		case "Page.navigate":
			pageUrl = params.url
			log({ event: "navigate", url: params.url })
			reply({ frameId: "F1" })
			if (env.STUB_PAGE_REQUESTS === "1") {
				for (const [verb, url] of [
					["POST", "/api/visuals/x"],
					["GET", "/api/config"],
				]) {
					const requestId = `R${nextRequest++}`
					pendingFetch.set(requestId, verb)
					send({
						method: "Fetch.requestPaused",
						sessionId,
						params: { requestId, request: { method: verb, url: new URL(url, pageUrl).href } },
					})
				}
			}
			return
		case "Fetch.continueRequest":
		case "Fetch.failRequest":
			log({
				event: "fetch",
				verb: pendingFetch.get(params.requestId),
				action: method === "Fetch.continueRequest" ? "continue" : "fail",
				errorReason: params.errorReason ?? null,
			})
			return reply({})
		case "Runtime.evaluate":
			return reply({ result: { type: "object", value: evaluate(params.expression) } })
		case "Browser.getVersion":
			return reply({ product: "StubBrowser/1.0" })
		default:
			return reply({})
	}
}

let buffered = ""
const start = () => {
	input.on("data", (chunk) => {
		buffered += chunk.toString("utf8")
		let end = buffered.indexOf("\0")
		while (end !== -1) {
			const text = buffered.slice(0, end)
			buffered = buffered.slice(end + 1)
			handle(JSON.parse(text))
			end = buffered.indexOf("\0")
		}
	})
}
input.on("end", () => {
	log({ event: "pipe-closed" })
	if (env.STUB_IGNORE_CLOSE !== "1" && env.STUB_HELPER !== "1") process.exit(0)
})
input.on("error", () => undefined)
output.on("error", () => undefined)

const slow = Number(env.STUB_SLOW_START_MS ?? 0)
if (slow > 0) setTimeout(start, slow)
else start()
// Stay up until told (or forced) to stop.
setInterval(() => undefined, 1000)
