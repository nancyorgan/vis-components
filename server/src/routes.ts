/** The request handler: /alive, /api/*, and static fallback.
 *
 *  API semantics (mirrors the frontend's diffing HTTP storage adapter):
 *   - per-item PUT/DELETE, item-level last-write-wins, no ETags in v1
 *   - PUT is a full-item replace; DELETE of a missing id is a 204 no-op
 *   - collection GET returns everything (bodies included for datasets) */

import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { createGunzip, createGzip, gunzipSync, gzipSync } from "node:zlib"

import type { ServerConfig } from "./config.js"
import {
	clearDatasetVersionRows,
	datasetStamp,
	datasetVersionStamp,
	deleteBody,
	deleteDatasetRow,
	isContentVersionCollection,
	isJsonCollection,
	listContentVersions,
	listDatasetIds,
	listDatasetMeta,
	listDatasetVersionIds,
	listRows,
	setContentVersion,
	upsertBody,
	deleteDatasetVersionRow,
	upsertDatasetMeta,
	upsertDatasetRow,
	upsertDatasetVersionRow,
	type JsonCollection,
} from "./db.js"
import type { DatabaseSync } from "node:sqlite"
import {
	deleteDatasetFile,
	deleteDatasetVersionFile,
	isSafeId,
	readDatasetFile,
	readDatasetVersionFile,
	writeDatasetFile,
	writeDatasetVersionFile,
} from "./datasetFiles.js"
import {
	isEmbedPart,
	isPublishId,
	publishEmbedFiles,
	readEmbedTemplate,
	unpublishEmbedFiles,
	type EmbedPart,
} from "./embedFiles.js"
import { HttpError, readBody, sendEmpty, sendError, sendJson } from "./http.js"
import {
	DATASET_BODY_CAP_BYTES,
	EMBED_BODY_CAP_BYTES,
	JSON_BODY_CAP_BYTES,
} from "./limits.js"
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
	{ config, db, distDir }: HandlerDeps
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
			if (rest.length === 1 && rest[0] === "meta") {
				if (method !== "PUT") throw new HttpError(405, "Method not allowed")
				const raw = (await readBody(req, JSON_BODY_CAP_BYTES)).toString("utf-8")
				const listedVersionIds = assertDatasetMetaJson(raw, id)
				upsertDatasetMeta(db, id, raw)
				// The meta PUT is the LAST write of a client's sync, so its version
				// list is authoritative: any stored version it does not list was
				// removed — possibly by a session whose DELETE never landed, which
				// a later hydration (it re-splits the whole body without knowing
				// the prior version set) can never repair. Purge those here or the
				// server serves the deleted rows forever.
				if (listedVersionIds !== null) {
					const listed = new Set(listedVersionIds)
					const stale = listDatasetVersionIds(db, id).filter(
						(versionId) => !listed.has(versionId)
					)
					for (const versionId of stale) {
						deleteDatasetVersionRow(db, id, versionId)
					}
					await Promise.all(
						stale.map((versionId) =>
							deleteDatasetVersionFile(config.dataDir, id, versionId)
						)
					)
				}
				return sendEmpty(res, 204)
			}
			if (rest.length === 2 && rest[0] === "versions") {
				const versionId = rest[1]
				if (!versionId || !isSafeId(versionId)) {
					throw new HttpError(400, "Invalid version id")
				}
				return await handleDatasetVersion(
					req,
					res,
					db,
					config.dataDir,
					id,
					versionId
				)
			}
			throw new HttpError(404, "Not found")
		}

		if (method === "GET") return await getDataset(req, res, db, config.dataDir, id)
		if (method === "PUT") {
			const gzipped = await readGzippedDatasetBody(req)
			await writeDatasetFile(config.dataDir, id, gzipped)
			upsertDatasetRow(db, id, gzipped.length)
			// A body write from a client that does NOT manage the per-version
			// bodies (no x-vis-versions-managed header — the previous bundle
			// during a rolling deploy) leaves the stored per-version rows
			// describing the PREVIOUS body, including versions that write may
			// have removed. They are derived caches, so purge them: readers
			// fall back to the whole body and the next hydration re-splits.
			// A managed client issues its own version PUTs/DELETEs right after
			// this request instead.
			if (!req.headers["x-vis-versions-managed"]) {
				const stale = listDatasetVersionIds(db, id)
				clearDatasetVersionRows(db, id)
				await Promise.all(
					stale.map((versionId) =>
						deleteDatasetVersionFile(config.dataDir, id, versionId)
					)
				)
			}
			return sendEmpty(res, 204)
		}
		if (method === "DELETE") {
			// Every per-version body goes with the dataset. Collected BEFORE the
			// index rows are cleared, or the file names would be unknowable and
			// the bodies would linger in the data dir forever.
			const versionIds = listDatasetVersionIds(db, id)
			deleteDatasetRow(db, id)
			await deleteDatasetFile(config.dataDir, id)
			await Promise.all(
				versionIds.map((versionId) =>
					deleteDatasetVersionFile(config.dataDir, id, versionId)
				)
			)
			return sendEmpty(res, 204)
		}
		throw new HttpError(405, "Method not allowed")
	}

	// Published embeds (the 0016 public embed contract). RPC on the publish
	// dir's filesystem, deliberately NOT a JSON collection: nothing is stored
	// in SQLite here — the embed's metadata lives in the embed-instances
	// collection like always, and these routes only write/delete the public
	// files. The response carries the finished public URLs, so the frontend
	// never needs VIS_PUBLISH_BASE_URL (and /api/config stays untouched).
	if (collection === "embeds") {
		if (!id) throw new HttpError(404, "Not found")
		if (!isPublishId(id)) throw new HttpError(400, "Invalid publish id")
		if (method === "PUT") {
			return await publishEmbed(req, res, config, distDir, id)
		}
		if (method === "DELETE") {
			await unpublishEmbedFiles(config.publishDir, id)
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

/** PUT /api/embeds/<publishId> — write the embed's public files and answer
 *  with their final URLs. The body (plain or Content-Encoding: gzip) is:
 *
 *    { v: 1, parts: ["full" | "chart" | "legend", ...], payload: {...} }
 *
 *  `payload` is opaque to the server beyond being valid JSON; it is injected
 *  into the built runtime template once per requested part. The part list is
 *  authoritative — parts it omits are unpublished. Any failure (bad body,
 *  missing template, write or read-back error) answers before a URL exists
 *  in the response, so a URL in a 200 always names a fully-written, loadable
 *  public file — the client shows nothing but a retryable error otherwise. */
const publishEmbed = async (
	req: IncomingMessage,
	res: ServerResponse,
	config: ServerConfig,
	distDir: string,
	publishId: string
): Promise<void> => {
	const raw = await readBody(req, EMBED_BODY_CAP_BYTES)
	const encoding = String(req.headers["content-encoding"] ?? "")
	let text: string
	try {
		text = (/\bgzip\b/.test(encoding) ? gunzipSync(raw) : raw).toString("utf-8")
	} catch {
		throw new HttpError(400, "Body is not valid gzip")
	}
	let body: unknown
	try {
		body = JSON.parse(text)
	} catch {
		throw new HttpError(400, "Body is not valid JSON")
	}
	const record = body as { v?: unknown; parts?: unknown; payload?: unknown }
	if (
		typeof body !== "object" ||
		body === null ||
		record.v !== 1 ||
		!Array.isArray(record.parts) ||
		record.parts.length === 0 ||
		!record.parts.every(isEmbedPart) ||
		typeof record.payload !== "object" ||
		record.payload === null
	) {
		throw new HttpError(400, 'Expected { v: 1, parts: [...], payload: {...} }')
	}
	const parts = [...new Set(record.parts as EmbedPart[])]
	const template = await readEmbedTemplate(distDir)
	if (template === null) {
		// A deploy gap, not a client mistake: the frontend build didn't ship
		// the runtime. Loud 500 so it reads as retryable-after-a-fix.
		throw new HttpError(500, "The embed runtime is not built")
	}
	const paths = await publishEmbedFiles(
		config.publishDir,
		publishId,
		template,
		JSON.stringify(record.payload),
		parts
	)
	const urls: Record<string, string> = {}
	for (const [part, path] of Object.entries(paths)) {
		urls[part] = `${config.publishBaseUrl}/${path}`
	}
	return sendJson(res, 200, JSON.stringify({ v: 1, urls }))
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

/** One dataset VERSION's rows: read, write, or delete.
 *
 *  GET answers 404 when this version has no stored body of its own — which is
 *  every version of every dataset written before the split. That is not an
 *  error condition: the client falls back to the whole-dataset body, and
 *  splits it as it goes, the same way a null `meta` is repaired on read. */
const handleDatasetVersion = async (
	req: IncomingMessage,
	res: ServerResponse,
	db: DatabaseSync,
	dataDir: string,
	datasetId: string,
	versionId: string
): Promise<void> => {
	const method = req.method ?? "GET"

	if (method === "GET") {
		const stamp = datasetVersionStamp(db, datasetId, versionId)
		if (!stamp) throw new HttpError(404, "Not found")
		return sendStoredGzip(
			req,
			res,
			stamp,
			`dataset ${datasetId} version ${versionId}`,
			() => readDatasetVersionFile(dataDir, datasetId, versionId)
		)
	}

	if (method === "PUT") {
		const gzipped = await readGzippedDatasetBody(req)
		await writeDatasetVersionFile(dataDir, datasetId, versionId, gzipped)
		const indexed = upsertDatasetVersionRow(
			db,
			datasetId,
			versionId,
			gzipped.length
		)
		if (!indexed) {
			// The parent dataset doesn't exist — this PUT is racing (or
			// trailing) the dataset's DELETE, and indexing it would resurrect
			// rows the user deleted. Remove the file just written and no-op
			// with a 204, mirroring the meta route's anti-resurrection rule.
			await deleteDatasetVersionFile(dataDir, datasetId, versionId)
		}
		return sendEmpty(res, 204)
	}

	if (method === "DELETE") {
		deleteDatasetVersionRow(db, datasetId, versionId)
		await deleteDatasetVersionFile(dataDir, datasetId, versionId)
		return sendEmpty(res, 204)
	}

	throw new HttpError(405, "Method not allowed")
}

/** Read and normalize a dataset (or dataset-version) body: clients gzip the
 *  bodies themselves (Content-Encoding: gzip) and the server stores that
 *  stream untouched; an uncompressed body is tolerated and compressed here.
 *  Either way the stored file must be valid gzip — one corrupt file would
 *  poison the collection GET that every session boots from. One helper for
 *  both PUT arms so a hardening change can't apply to one and not the other. */
const readGzippedDatasetBody = async (req: IncomingMessage): Promise<Buffer> => {
	const body = await readBody(req, DATASET_BODY_CAP_BYTES)
	const encoding = req.headers["content-encoding"] ?? ""
	const gzipped = /\bgzip\b/.test(String(encoding)) ? body : gzipSync(body)
	await assertValidGzip(gzipped)
	return gzipped
}

/** The shared GET tail for a stored gzip file: ETag from the index stamp,
 *  304 on a match, 404 (loudly — an orphaned index row) when the file is
 *  gone, else the bytes via `sendGzipBody`. One helper for the dataset and
 *  dataset-version routes so the caching contract can't drift between them. */
const sendStoredGzip = async (
	req: IncomingMessage,
	res: ServerResponse,
	stamp: { updated_at: string; byte_size: number },
	what: string,
	read: () => Promise<Buffer | null>
): Promise<void> => {
	const etag = `"${stamp.updated_at}-${stamp.byte_size}"`
	if (req.headers["if-none-match"] === etag) {
		res.writeHead(304, { etag })
		res.end()
		return
	}
	const gzipped = await read()
	if (gzipped === null) {
		logError(`${what} is indexed but its file is missing`)
		throw new HttpError(404, "Not found")
	}
	return sendGzipBody(req, res, gzipped, etag)
}

/** Send an already-gzipped body, decompressing only for a client that cannot
 *  take gzip (curl, tests). The stored bytes go out untouched otherwise. */
const sendGzipBody = async (
	req: IncomingMessage,
	res: ServerResponse,
	gzipped: Buffer,
	etag: string
): Promise<void> => {
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
	return sendStoredGzip(req, res, stamp, `dataset ${id}`, () =>
		readDatasetFile(dataDir, id)
	)
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
 *  it would corrupt the collection's keying. Returns the parsed object for
 *  validators that layer further rules on top. */
const assertItemJson = (body: string, id: string): Record<string, unknown> => {
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
	return parsed as Record<string, unknown>
}

/** A dataset meta body must be a JSON object whose `id` matches the URL, and
 *  must NOT carry row data — the whole point of the index is that it holds
 *  none. Rejecting a `rows` key keeps a confused client from quietly turning
 *  the index back into a full-corpus payload. When the body carries a
 *  `versions` array, every entry must be an object with a string `id` —
 *  those ids are what the meta route reconciles the stored versions against —
 *  and they are returned; null means the body listed no such array. */
const assertDatasetMetaJson = (body: string, id: string): string[] | null => {
	const record = assertItemJson(body, id)
	const versions = record.versions
	if (!Array.isArray(versions)) return null
	const ids: string[] = []
	for (const v of versions) {
		if (
			typeof v !== "object" ||
			v === null ||
			typeof (v as Record<string, unknown>).id !== "string"
		) {
			throw new HttpError(400, "Dataset meta versions must carry a string id")
		}
		if ("rows" in v) {
			throw new HttpError(400, "Dataset meta must not carry version rows")
		}
		ids.push((v as { id: string }).id)
	}
	return ids
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
