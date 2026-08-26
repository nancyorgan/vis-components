/** The request handler: /alive, /api/*, and static fallback.
 *
 *  API semantics (mirrors the frontend's diffing HTTP storage adapter):
 *   - per-item PUT/DELETE, item-level last-write-wins, no ETags in v1
 *   - PUT is a full-item replace; DELETE of a missing id is a 204 no-op
 *   - collection GET returns everything (bodies included for datasets) */

import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { createGunzip, createGzip, gzipSync } from "node:zlib"

import type { ServerConfig } from "./config.js"
import {
	datasetStamp,
	deleteBody,
	deleteDatasetRow,
	isContentVersionCollection,
	isJsonCollection,
	listContentVersions,
	listDatasetIds,
	listDatasetMeta,
	listRows,
	setContentVersion,
	upsertBody,
	upsertDatasetMeta,
	upsertDatasetRow,
	type JsonCollection,
} from "./db.js"
import type { DatabaseSync } from "node:sqlite"
import {
	deleteDatasetFile,
	isSafeId,
	readDatasetFile,
	writeDatasetFile,
} from "./datasetFiles.js"
import { HttpError, readBody, sendEmpty, sendError, sendJson } from "./http.js"
import { DATASET_BODY_CAP_BYTES, JSON_BODY_CAP_BYTES } from "./limits.js"
import { logError } from "./log.js"
import { serveStatic } from "./staticFiles.js"

export type HandlerDeps = {
	config: ServerConfig
	db: DatabaseSync
	distDir: string
}

export const createHandler =
	({ config, db, distDir }: HandlerDeps) =>
	async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const method = req.method ?? "GET"
		const path = (req.url ?? "/").split("?")[0]
		try {
			if (path === "/alive") {
				if (method !== "GET") return sendError(res, 405, "Method not allowed")
				res.writeHead(200, { "content-type": "text/plain" })
				res.end("ok")
				return
			}
			if (path === "/api/config" || path === "/api/config/") {
				if (method !== "GET") return sendError(res, 405, "Method not allowed")
				return sendJson(res, 200, JSON.stringify({ v: 1, baseUrl: config.baseUrl }))
			}
			if (path.startsWith("/api/")) return await handleApi(req, res, { config, db, distDir })
			if (method !== "GET") return sendError(res, 405, "Method not allowed")
			return await serveStatic(distDir, path, res)
		} catch (error) {
			if (error instanceof HttpError) {
				if (!res.headersSent) sendError(res, error.status, error.message)
				return
			}
			logError(`${method} ${path} failed: ${String(error)}`)
			if (!res.headersSent) sendError(res, 500, "Internal error")
			else res.destroy()
		}
	}

const handleApi = async (
	req: IncomingMessage,
	res: ServerResponse,
	{ config, db }: HandlerDeps
): Promise<void> => {
	const method = req.method ?? "GET"
	const [rawPath, rawQuery] = (req.url ?? "/").split("?")
	const [, , collection, id, ...rest] = rawPath.split("/")
	if (!collection) throw new HttpError(404, "Not found")
	// Only the datasets collection has sub-resources; everything else keeps
	// the original flat shape.
	if (rest.length > 0 && collection !== "datasets") {
		throw new HttpError(404, "Not found")
	}

	if (collection === "datasets") {
		if (!id) {
			if (rest.length > 0) throw new HttpError(404, "Not found")
			if (method !== "GET") throw new HttpError(405, "Method not allowed")
			// `?view=index` is the metadata-only listing. The bare route keeps
			// returning full bodies, unchanged, so a browser still running the
			// previous bundle is unaffected by this deploy. Retire it only once
			// no such client can remain.
			if (new URLSearchParams(rawQuery ?? "").get("view") === "index") {
				return sendJson(res, 200, composeDatasetIndex(db))
			}
			return listDatasets(req, res, db, config.dataDir)
		}
		if (!isSafeId(id)) throw new HttpError(400, "Invalid id")

		if (rest.length > 0) {
			if (rest.length !== 1 || rest[0] !== "meta") {
				throw new HttpError(404, "Not found")
			}
			if (method !== "PUT") throw new HttpError(405, "Method not allowed")
			const raw = (await readBody(req, JSON_BODY_CAP_BYTES)).toString("utf-8")
			assertDatasetMetaJson(raw, id)
			upsertDatasetMeta(db, id, raw)
			return sendEmpty(res, 204)
		}

		if (method === "GET") return await getDataset(req, res, db, config.dataDir, id)
		if (method === "PUT") {
			const body = await readBody(req, DATASET_BODY_CAP_BYTES)
			const encoding = req.headers["content-encoding"] ?? ""
			// Clients gzip dataset bodies themselves (Content-Encoding: gzip) and
			// the server stores that stream untouched; an uncompressed body is
			// tolerated and compressed here. Either way the stored file must be
			// valid gzip — one corrupt file would poison the collection GET that
			// every session boots from.
			const gzipped = /\bgzip\b/.test(String(encoding)) ? body : gzipSync(body)
			await assertValidGzip(gzipped)
			await writeDatasetFile(config.dataDir, id, gzipped)
			upsertDatasetRow(db, id, gzipped.length)
			return sendEmpty(res, 204)
		}
		if (method === "DELETE") {
			deleteDatasetRow(db, id)
			await deleteDatasetFile(config.dataDir, id)
			return sendEmpty(res, 204)
		}
		throw new HttpError(405, "Method not allowed")
	}

	// Content-schema versions. Deliberately its own branch rather than a
	// JSON collection: the ids are collection NAMES from a fixed whitelist,
	// not user-generated item ids, and the bodies are a single number.
	if (collection === "content-versions") {
		if (!id) {
			if (method !== "GET") throw new HttpError(405, "Method not allowed")
			return sendJson(res, 200, JSON.stringify(listContentVersions(db)))
		}
		if (method !== "PUT") throw new HttpError(405, "Method not allowed")
		if (!isContentVersionCollection(id)) throw new HttpError(404, "Not found")
		const raw = (await readBody(req, JSON_BODY_CAP_BYTES)).toString("utf-8")
		setContentVersion(db, id, parseVersionBody(raw))
		return sendEmpty(res, 204)
	}

	if (!isJsonCollection(collection)) throw new HttpError(404, "Not found")

	if (!id) {
		if (method !== "GET") throw new HttpError(405, "Method not allowed")
		const thumbnails =
			new URLSearchParams(rawQuery ?? "").get("thumbnails") !== "0"
		return sendJson(res, 200, composeCollection(collection, db, thumbnails))
	}
	if (!isSafeId(id)) throw new HttpError(400, "Invalid id")
	if (method === "PUT") {
		const body = (await readBody(req, JSON_BODY_CAP_BYTES)).toString("utf-8")
		assertItemJson(body, id)
		upsertBody(db, collection, id, body)
		return sendEmpty(res, 204)
	}
	if (method === "DELETE") {
		deleteBody(db, collection, id)
		return sendEmpty(res, 204)
	}
	throw new HttpError(405, "Method not allowed")
}

/** Arrays for the list-shaped collections, id-keyed records for the rest —
 *  matching the shapes the StorageContentAdapter trades in. */
const composeCollection = (
	collection: JsonCollection,
	db: DatabaseSync,
	thumbnails = true
): string => {
	const rows = listRows(db, collection, { thumbnails })
	if (collection === "embed-instances") {
		return `{${rows
			.map(({ id, body }) => `${JSON.stringify(id)}:${body}`)
			.join(",")}}`
	}
	return `[${rows.map((r) => r.body).join(",")}]`
}

/** The metadata index: `{ "<id>": <meta> | null }` for every indexed dataset.
 *  Pure SQLite read — the data dir is never touched, so this stays fast no
 *  matter how much row data the library holds.
 *
 *  A `null` means no client has hydrated that dataset's metadata yet (rows
 *  written before schema v4, or a body PUT whose meta follow-up was lost).
 *  It is NOT an error and must never be read as "this dataset is gone": the
 *  client falls back to fetching the body and PUTs the derived meta back. */
const composeDatasetIndex = (db: DatabaseSync): string => {
	const rows = listDatasetMeta(db)
	return `{${rows
		.map(({ id, meta }) => `${JSON.stringify(id)}:${meta ?? "null"}`)
		.join(",")}}`
}

/** One dataset's body. The stored file is already gzip and every browser
 *  accepts gzip, so the common path pipes the bytes out untouched — no
 *  gunzip, no re-gzip, nothing inflated in memory. Only an identity client
 *  (curl, tests) pays for decompression.
 *
 *  Carries an ETag so a revisit costs a 304 instead of the body; the index
 *  route stays uncached because it is small and must always be current. */
const getDataset = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	dataDir: string,
	id: string
): Promise<void> => {
	const stamp = datasetStamp(db, id)
	if (!stamp) throw new HttpError(404, "Not found")
	const etag = `"${stamp.updated_at}-${stamp.byte_size}"`
	if (req.headers["if-none-match"] === etag) {
		res.writeHead(304, { etag })
		res.end()
		return
	}
	const gzipped = await readDatasetFile(dataDir, id)
	if (gzipped === null) {
		// Indexed but the file is missing — the same orphan the boot sweep
		// reports. A 404 is the honest answer; nothing self-heals.
		logError(`dataset ${id} is indexed but its file is missing`)
		throw new HttpError(404, "Not found")
	}
	const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))
	const headers: Record<string, string> = {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache",
		etag,
	}
	if (acceptsGzip) headers["content-encoding"] = "gzip"
	res.writeHead(200, headers)
	if (acceptsGzip) {
		res.end(gzipped)
		return
	}
	await new Promise<void>((resolve, reject) => {
		const gunzip = createGunzip()
		gunzip.on("error", reject)
		gunzip.on("end", resolve)
		gunzip.pipe(res)
		Readable.from(gzipped).pipe(gunzip)
	})
}

/** Stream the full dataset record without ever holding an inflated dataset in
 *  memory: each stored gzip file is decompressed straight into the response
 *  (re-compressed as one stream when the client accepts gzip — every browser
 *  does; the identity path exists for curl and tests). */
const listDatasets = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	dataDir: string
): Promise<void> => {
	const ids = listDatasetIds(db)
	const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))
	const headers: Record<string, string> = {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	}
	if (acceptsGzip) headers["content-encoding"] = "gzip"
	res.writeHead(200, headers)
	// Level 1: this response can be hundreds of MB of JSON; favor throughput
	// over ratio (the bulk of the bytes were only just decompressed anyway).
	const out = acceptsGzip ? createGzip({ level: 1 }) : res
	if (out !== res) (out as NodeJS.ReadWriteStream).pipe(res)

	const write = (text: string) =>
		new Promise<void>((resolve, reject) => {
			out.write(text, (error) => (error ? reject(error) : resolve()))
		})

	await write("{")
	let first = true
	for (const id of ids) {
		const gzipped = await readDatasetFile(dataDir, id)
		if (gzipped === null) {
			// Orphaned index row (file missing). Logged, skipped — the boot sweep
			// reports these too; per spec nothing tries to self-heal.
			logError(`dataset ${id} is indexed but its file is missing; skipped`)
			continue
		}
		await write(`${first ? "" : ","}${JSON.stringify(id)}:`)
		first = false
		await new Promise<void>((resolve, reject) => {
			const gunzip = createGunzip()
			gunzip.on("error", reject)
			gunzip.on("end", resolve)
			gunzip.pipe(out, { end: false })
			Readable.from(gzipped).pipe(gunzip)
		})
	}
	await write("}")
	out.end()
}

/** A content-version PUT body is `{ "v": <non-negative integer> }`. Anything
 *  else is a confused client; storing it would make the stamp meaningless. */
const parseVersionBody = (raw: string): number => {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new HttpError(400, "Body must be valid JSON")
	}
	const v = (parsed as { v?: unknown } | null)?.v
	if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
		throw new HttpError(400, "Body must be { v: non-negative integer }")
	}
	return v
}

/** A JSON-collection PUT body must be a JSON object whose `id` (when present)
 *  matches the URL — a mismatch means a confused client, and silently storing
 *  it would corrupt the collection's keying. */
const assertItemJson = (body: string, id: string): void => {
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		throw new HttpError(400, "Body must be valid JSON")
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new HttpError(400, "Body must be a JSON object")
	}
	const bodyId = (parsed as Record<string, unknown>).id
	if (bodyId !== undefined && bodyId !== id) {
		throw new HttpError(400, `Body id ${JSON.stringify(bodyId)} does not match URL id "${id}"`)
	}
}

/** A dataset meta body must be a JSON object whose `id` matches the URL, and
 *  must NOT carry row data — the whole point of the index is that it holds
 *  none. Rejecting a `rows` key keeps a confused client from quietly turning
 *  the index back into a full-corpus payload. */
const assertDatasetMetaJson = (body: string, id: string): void => {
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		throw new HttpError(400, "Body must be valid JSON")
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new HttpError(400, "Body must be a JSON object")
	}
	const record = parsed as Record<string, unknown>
	if (record.id !== undefined && record.id !== id) {
		throw new HttpError(
			400,
			`Body id ${JSON.stringify(record.id)} does not match URL id "${id}"`
		)
	}
	const versions = record.versions
	if (
		Array.isArray(versions) &&
		versions.some((v) => typeof v === "object" && v !== null && "rows" in v)
	) {
		throw new HttpError(400, "Dataset meta must not carry version rows")
	}
}

const assertValidGzip = (gzipped: Buffer): Promise<void> =>
	new Promise((resolve, reject) => {
		const gunzip = createGunzip()
		gunzip.on("data", () => {})
		gunzip.on("end", () => resolve())
		gunzip.on("error", () =>
			reject(new HttpError(400, "Body is not valid gzip data"))
		)
		gunzip.end(gzipped)
	})
