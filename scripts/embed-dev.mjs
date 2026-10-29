// Local loop for testing published embeds: `pnpm embed:dev`.
//
// Publishing only works in server mode, and a published file is built from
// dist/embed-runtime.html rather than from what Vite serves — so a plain
// `pnpm dev` can't exercise it. This starts everything the loop needs, on
// scratch storage that never touches a real server, and stops it all on
// Ctrl-C:
//
//   - `vite build -c vite.server.config.ts` once, so server/dist is current
//   - `vite build -c vite.embed.config.ts --watch` — rebuilds the embed
//     runtime template as its sources change (the server reads it fresh
//     on every publish, so a Republish picks the rebuild up)
//   - the self-host server on :8099, storing under .embed-dev/ (gitignored)
//   - a dumb static server on :8098 over .embed-dev/publish — the public
//     side of the 0016 contract, what an embed viewer actually fetches
//   - the hot-reloading app on :3010 with /api proxied to :8099
//
// Ports can be moved with VIS_EMBED_DEV_PORT / VIS_EMBED_DEV_API_PORT /
// VIS_EMBED_DEV_STATIC_PORT. Pair it with the cross-origin iframe harness
// (engineering-frontend/packages/iframe-harness, :3003) to view snippets
// the way a customer page would.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const bin = (name) => join(root, "node_modules", ".bin", name)

const appPort = Number(process.env.VIS_EMBED_DEV_PORT ?? 3010)
const apiPort = Number(process.env.VIS_EMBED_DEV_API_PORT ?? 8099)
const staticPort = Number(process.env.VIS_EMBED_DEV_STATIC_PORT ?? 8098)

const scratch = join(root, ".embed-dev")
const dirs = {
	db: join(scratch, "db"),
	data: join(scratch, "data"),
	publish: join(scratch, "publish"),
}
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })

const children = []
let stopping = false

const stop = (code) => {
	if (stopping) return
	stopping = true
	for (const child of children) {
		if (child.exitCode === null) child.kill("SIGTERM")
	}
	// The self-host server drains for up to 10 s on SIGTERM; give it that.
	setTimeout(() => process.exit(code), 11_000).unref()
	let open = children.filter((c) => c.exitCode === null).length
	if (open === 0) process.exit(code)
	for (const child of children) {
		if (child.exitCode !== null) continue
		child.once("exit", () => {
			open -= 1
			if (open === 0) process.exit(code)
		})
	}
}

/** Spawn a child, prefix each output line with its tag, and bring the
 *  whole loop down if it exits — a dead server is not something to keep
 *  working on top of. */
const run = (tag, command, args, env = {}) => {
	const child = spawn(command, args, {
		cwd: root,
		// Output is line-prefixed below; ANSI colour would garble that.
		env: { ...process.env, ...env, NO_COLOR: "1", FORCE_COLOR: "0" },
		stdio: ["ignore", "pipe", "pipe"],
	})
	children.push(child)
	const forward = (stream, write) => {
		let rest = ""
		stream.on("data", (chunk) => {
			rest += chunk.toString()
			const lines = rest.split("\n")
			rest = lines.pop() ?? ""
			for (const line of lines) write(`[${tag}] ${line}\n`)
		})
		stream.on("end", () => {
			if (rest) write(`[${tag}] ${rest}\n`)
		})
	}
	forward(child.stdout, (s) => process.stdout.write(s))
	forward(child.stderr, (s) => process.stderr.write(s))
	child.on("exit", (code, signal) => {
		if (stopping) return
		console.error(`[embed-dev] ${tag} exited (${signal ?? code}) — stopping`)
		stop(1)
	})
	return child
}

const serveStatic = () =>
	new Promise((done, fail) => {
		const types = { ".html": "text/html; charset=utf-8" }
		const server = createServer((req, res) => {
			const path = normalize(join(dirs.publish, (req.url ?? "/").split("?")[0]))
			if (
				!path.startsWith(dirs.publish) ||
				!existsSync(path) ||
				!statSync(path).isFile()
			) {
				res.writeHead(404)
				res.end()
				return
			}
			res.writeHead(200, {
				"content-type": types[extname(path)] ?? "application/octet-stream",
			})
			res.end(readFileSync(path))
		})
		server.on("error", fail)
		server.listen(staticPort, () => done(server))
	})

console.log("[embed-dev] building the self-host server (vite build -c vite.server.config.ts)…")
const serverBuild = spawnSync(bin("vite"), ["build", "-c", "vite.server.config.ts"], {
	cwd: root,
	stdio: "inherit",
})
if (serverBuild.status !== 0) {
	console.error("[embed-dev] server build failed")
	process.exit(serverBuild.status ?? 1)
}

process.on("SIGINT", () => stop(0))
process.on("SIGTERM", () => stop(0))

let staticServer
try {
	staticServer = await serveStatic()
} catch (error) {
	console.error(`[embed-dev] static server can't listen on :${staticPort}: ${error.message}`)
	process.exit(1)
}
process.on("exit", () => staticServer.close())

run("embed-build", bin("vite"), ["build", "-c", "vite.embed.config.ts", "--watch"])
run("server", process.execPath, [join(root, "server", "dist", "main.js")], {
	VIS_BASE_URL: `http://localhost:${appPort}`,
	VIS_DB_DIR: dirs.db,
	VIS_DATA_DIR: dirs.data,
	VIS_PORT: String(apiPort),
	VIS_PUBLISH_DIR: dirs.publish,
	VIS_PUBLISH_BASE_URL: `http://localhost:${staticPort}`,
})
run("vite", bin("vite"), ["--port", String(appPort), "--strictPort"], {
	VIS_DEV_API: `http://localhost:${apiPort}`,
})

console.log(`
[embed-dev] Editor (server mode):   http://localhost:${appPort}
[embed-dev] Self-host API:          http://localhost:${apiPort}
[embed-dev] Published embeds:       http://localhost:${staticPort}  (files in .embed-dev/publish)
[embed-dev] Export → Embed → Publish, then paste the snippet into the iframe
[embed-dev] harness (engineering-frontend: pnpm --filter @th/iframe-harness start, :3003).
[embed-dev] Edits to a chart or the embed runtime show up after Republish.
[embed-dev] Ctrl-C stops everything.
`)
