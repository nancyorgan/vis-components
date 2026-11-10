// HTTPS dev server for the PowerPoint add-in spike: `pnpm addin:dev`.
//
// Office only loads add-in pages over HTTPS, and the add-in's pictures come
// from the embed static server, which is plain HTTP on :8098. This fronts
// both behind one TLS origin so the task pane and the pictures it fetches
// are same-origin (no CORS in the spike):
//
//   https://localhost:8443/addin/*   → static files from <repo>/addin/
//   https://localhost:8443/embeds/*  → reverse-proxied to http://localhost:8098
//                                      (the `pnpm embed:dev` static server),
//                                      with Cache-Control: no-cache added so
//                                      a Refresh never sees a stale picture
//
// It needs a cert pair at .addin-dev/localhost.crt + .addin-dev/localhost.key
// (PEM, SAN localhost + 127.0.0.1; e.g. from mkcert). Office refuses an
// untrusted cert silently, so trust it in the System keychain first. Run
// `pnpm embed:dev` in another terminal so :8098 is answering.
//
// Ports: VIS_ADDIN_DEV_PORT (default 8443) and VIS_EMBED_DEV_STATIC_PORT
// (default 8098, the same variable embed-dev.mjs reads).
//
// Testing against a real deployment: set VIS_ADDIN_EMBEDS_URL to that
// server's VIS_PUBLISH_BASE_URL (e.g. https://publish.example.com) and
// /embeds/* is proxied there instead of :8098 — `pnpm embed:dev` is then
// not needed. The add-in still loads from localhost, so only a machine that
// has sideloaded the manifest and runs this script can use it.
//
// Sideloading the manifest (addin/manifest-taskpane.xml):
//   - PowerPoint for Mac: copy the .xml into
//       ~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/
//     (create the folder if missing), restart PowerPoint, then
//     Insert → Add-ins → My Add-ins → Developer Add-ins → Zafiro.
//   - PowerPoint for the web: open a deck, Insert → Add-ins → More Add-ins →
//     My Add-ins → Upload My Add-in, pick the .xml.
// Either way the Home tab gains a "Zafiro" button that opens the task pane.
import { existsSync, readFileSync, statSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { createServer } from "node:https"
import { dirname, extname, join, normalize, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const port = Number(process.env.VIS_ADDIN_DEV_PORT ?? 8443)
const staticPort = Number(process.env.VIS_EMBED_DEV_STATIC_PORT ?? 8098)

// Where /embeds/* goes: a deployment's publish base URL, or the local
// embed:dev static server. Any path on the base URL is kept as a prefix.
const parseUpstream = (raw) => {
	let url
	try {
		url = new URL(raw)
	} catch {
		url = null
	}
	if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
		console.error(`[addin-dev] VIS_ADDIN_EMBEDS_URL must be an http(s) URL, got: ${raw}`)
		process.exit(1)
	}
	return url
}
const rawUpstream = process.env.VIS_ADDIN_EMBEDS_URL?.trim()
const upstreamUrl = rawUpstream ? parseUpstream(rawUpstream) : new URL(`http://localhost:${staticPort}`)
const upstreamPrefix = upstreamUrl.pathname.replace(/\/+$/, "")
const upstreamLabel = `${upstreamUrl.origin}${upstreamPrefix}`

const addinDir = join(root, "addin")
const certPath = join(root, ".addin-dev", "localhost.crt")
const keyPath = join(root, ".addin-dev", "localhost.key")

const missing = [certPath, keyPath].filter((p) => !existsSync(p))
if (missing.length > 0) {
	console.error(
		`[addin-dev] TLS cert pair missing. Expected both:\n` +
			`  ${certPath}\n  ${keyPath}\n` +
			`Generate a localhost cert (SAN localhost + 127.0.0.1) there, e.g.\n` +
			`  mkcert -cert-file .addin-dev/localhost.crt -key-file .addin-dev/localhost.key localhost 127.0.0.1`,
	)
	process.exit(1)
}

const types = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".json": "application/json; charset=utf-8",
}

const log = (req, status) => console.log(`[addin-dev] ${req.method} ${req.url} ${status}`)

const notFound = (req, res) => {
	res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
	res.end("not found")
	log(req, 404)
}

const serveAddin = (req, res, rest) => {
	// Decode, normalize, then require the result to stay inside addin/ —
	// `..` segments collapse away in normalize, so a traversal lands outside.
	let decoded
	try {
		decoded = decodeURIComponent(rest)
	} catch {
		return notFound(req, res)
	}
	const path = normalize(join(addinDir, decoded))
	if (!path.startsWith(addinDir + sep) || !existsSync(path) || !statSync(path).isFile()) {
		return notFound(req, res)
	}
	res.writeHead(200, {
		"content-type": types[extname(path).toLowerCase()] ?? "application/octet-stream",
		"cache-control": "no-cache",
	})
	res.end(readFileSync(path))
	log(req, 200)
}

const proxyEmbeds = (req, res) => {
	const send = upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest
	const upstream = send(
		{
			protocol: upstreamUrl.protocol,
			hostname: upstreamUrl.hostname,
			port: upstreamUrl.port || undefined,
			method: req.method,
			path: `${upstreamPrefix}${req.url}`,
			headers: { accept: req.headers.accept ?? "*/*" },
		},
		(up) => {
			const headers = { "cache-control": "no-cache" }
			if (up.headers["content-type"]) headers["content-type"] = up.headers["content-type"]
			if (up.headers["content-length"]) headers["content-length"] = up.headers["content-length"]
			res.writeHead(up.statusCode ?? 502, headers)
			up.pipe(res)
			log(req, up.statusCode ?? 502)
		},
	)
	upstream.on("error", (error) => {
		res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
		const hint = rawUpstream ? "Check VIS_ADDIN_EMBEDS_URL." : "Is `pnpm embed:dev` running?"
		res.end(`embed server (${upstreamLabel}) unreachable: ${error.message}\n${hint}`)
		log(req, 502)
	})
	upstream.end()
}

const server = createServer(
	{ cert: readFileSync(certPath), key: readFileSync(keyPath) },
	(req, res) => {
		const path = (req.url ?? "/").split("?")[0]
		if (path.startsWith("/addin/")) return serveAddin(req, res, path.slice("/addin/".length))
		if (path.startsWith("/embeds/")) return proxyEmbeds(req, res)
		return notFound(req, res)
	},
)

server.on("error", (error) => {
	console.error(`[addin-dev] can't listen on :${port}: ${error.message}`)
	process.exit(1)
})

server.listen(port, () => {
	console.log(`
[addin-dev] Add-in pages:     https://localhost:${port}/addin/taskpane.html
[addin-dev] Manifest:         ${join(addinDir, "manifest-taskpane.xml")}
[addin-dev] Embed proxy:      https://localhost:${port}/embeds/* → ${upstreamLabel}/embeds/*
[addin-dev] Sideload the manifest (see the header of this file), then Home → Zafiro.
[addin-dev] Ctrl-C stops.
`)
})

const stop = () => {
	server.close()
	process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
