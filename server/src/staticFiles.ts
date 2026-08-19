/** Static serving of the built frontend (dist/). Anything that isn't a file
 *  falls back to index.html — the frontend is a single-page app that owns its
 *  own routes (/editor/…, /embed/…). */

import { createReadStream, promises as fs } from "node:fs"
import type { ServerResponse } from "node:http"
import { extname, join, normalize, resolve, sep } from "node:path"

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json",
	".woff2": "font/woff2",
	".webmanifest": "application/manifest+json",
}

/** Serve `urlPath` from `distDir`, falling back to index.html. Traversal is
 *  blocked by resolving the candidate and requiring it to stay inside
 *  `distDir`. */
export const serveStatic = async (
	distDir: string,
	urlPath: string,
	res: ServerResponse
): Promise<void> => {
	const root = resolve(distDir)
	let decoded: string
	try {
		decoded = decodeURIComponent(urlPath)
	} catch {
		decoded = "/"
	}
	if (decoded.includes("\0")) decoded = "/"
	const candidate = resolve(normalize(join(root, decoded)))
	const inRoot = candidate === root || candidate.startsWith(root + sep)

	const target =
		inRoot && (await isFile(candidate)) ? candidate : join(root, "index.html")

	const ext = extname(target)
	res.writeHead(200, {
		"content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
		// Vite emits content-hashed filenames under /assets — those are safe to
		// cache forever. Everything else (index.html above all) must revalidate
		// so deploys take effect immediately.
		"cache-control": target.includes(`${sep}assets${sep}`)
			? "public, max-age=31536000, immutable"
			: "no-cache",
	})
	await new Promise<void>((resolvePromise, reject) => {
		const stream = createReadStream(target)
		stream.on("error", reject)
		res.on("close", resolvePromise)
		stream.pipe(res)
	})
}

const isFile = async (path: string): Promise<boolean> => {
	try {
		return (await fs.stat(path)).isFile()
	} catch {
		return false
	}
}
