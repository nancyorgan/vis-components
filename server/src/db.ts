/** SQLite storage for the small structured collections (visuals, folders,
 *  embed instances, themes) plus the dataset index. Dataset *bodies* live as
 *  whole files in the data dir (see datasetFiles.ts) — only their metadata
 *  rows are here.
 *
 *  Uses the Node built-in `node:sqlite` (embedded, synchronous — a natural
 *  fit for a single-replica server) so the server adds zero runtime
 *  dependencies. */

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

/** Numbered migrations, applied in order inside a transaction at boot.
 *  NEVER edit a shipped entry — append a new one. */
const MIGRATIONS: readonly string[] = [
	// v1 — initial schema
	`CREATE TABLE visuals (
		id TEXT PRIMARY KEY,
		body TEXT NOT NULL,
		thumbnail TEXT,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE folders (
		id TEXT PRIMARY KEY,
		body TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE embed_instances (
		id TEXT PRIMARY KEY,
		body TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE themes (
		id TEXT PRIMARY KEY,
		body TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE TABLE datasets (
		id TEXT PRIMARY KEY,
		byte_size INTEGER NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	// v2 — user font library (Google Fonts metadata; binaries stay client-side)
	`CREATE TABLE fonts (
		id TEXT PRIMARY KEY,
		body TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
]

/** The JSON-body tables, keyed by the API's collection segment. Table names
 *  are only ever taken from this map — never from request input. */
export const JSON_TABLES = {
	visuals: "visuals",
	folders: "folders",
	"embed-instances": "embed_instances",
	themes: "themes",
	fonts: "fonts",
} as const

export type JsonCollection = keyof typeof JSON_TABLES

export const isJsonCollection = (value: string): value is JsonCollection =>
	value in JSON_TABLES

/** Open (or initialize) the database and bring the schema up to date.
 *  Fail-fast contract: an unreadable/corrupt DB file, or a schema version
 *  newer than this server understands, throws — no recovery attempts. */
export const openDb = (dbDir: string): DatabaseSync => {
	mkdirSync(dbDir, { recursive: true })
	const path = join(dbDir, "vis.sqlite")
	let db: DatabaseSync
	try {
		db = new DatabaseSync(path)
		db.exec("PRAGMA journal_mode = WAL")
		db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`)
	} catch (error) {
		throw new Error(
			`Database at ${path} could not be opened — refusing to start ` +
				`(malformed DB state is fail-fast by design): ${String(error)}`,
			{ cause: error }
		)
	}

	const row = db
		.prepare("SELECT MAX(version) AS version FROM schema_migrations")
		.get() as { version: number | null }
	const current = row.version ?? 0
	if (current > MIGRATIONS.length) {
		throw new Error(
			`Database schema is version ${current}, but this server only knows ` +
				`versions up to ${MIGRATIONS.length}. It was likely written by a ` +
				`newer build — refusing to start.`
		)
	}
	for (let v = current + 1; v <= MIGRATIONS.length; v++) {
		db.exec("BEGIN")
		try {
			db.exec(MIGRATIONS[v - 1])
			db.prepare(
				"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
			).run(v, new Date().toISOString())
			db.exec("COMMIT")
		} catch (error) {
			db.exec("ROLLBACK")
			throw new Error(`Migration to schema version ${v} failed: ${String(error)}`, {
				cause: error,
			})
		}
	}
	return db
}

export type ItemRow = { id: string; body: string }

/** List every item in a JSON collection. For visuals the stored `thumbnail`
 *  column is merged back into the JSON so clients receive complete items. */
export const listRows = (
	db: DatabaseSync,
	collection: JsonCollection
): ItemRow[] => {
	const table = JSON_TABLES[collection]
	if (collection === "visuals") {
		const rows = db
			.prepare(`SELECT id, body, thumbnail FROM ${table}`)
			.all() as { id: string; body: string; thumbnail: string | null }[]
		return rows.map(({ id, body, thumbnail }) => ({
			id,
			body: mergeThumbnail(body, thumbnail),
		}))
	}
	return db.prepare(`SELECT id, body FROM ${table}`).all() as ItemRow[]
}

/** Upsert one item. `body` must already be validated JSON text. For visuals,
 *  the (potentially large) thumbnail data URL is split into its own column so
 *  future list queries can skip it. */
export const upsertBody = (
	db: DatabaseSync,
	collection: JsonCollection,
	id: string,
	body: string
): void => {
	const table = JSON_TABLES[collection]
	const now = new Date().toISOString()
	if (collection === "visuals") {
		const { stripped, thumbnail } = splitThumbnail(body)
		db.prepare(
			`INSERT INTO ${table} (id, body, thumbnail, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET body=excluded.body,
			   thumbnail=excluded.thumbnail, updated_at=excluded.updated_at`
		).run(id, stripped, thumbnail, now)
		return
	}
	db.prepare(
		`INSERT INTO ${table} (id, body, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`
	).run(id, body, now)
}

/** Delete one item. Idempotent — deleting a missing id is a no-op. */
export const deleteBody = (
	db: DatabaseSync,
	collection: JsonCollection,
	id: string
): void => {
	db.prepare(`DELETE FROM ${JSON_TABLES[collection]} WHERE id = ?`).run(id)
}

export const upsertDatasetRow = (
	db: DatabaseSync,
	id: string,
	byteSize: number
): void => {
	db.prepare(
		`INSERT INTO datasets (id, byte_size, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET byte_size=excluded.byte_size,
		   updated_at=excluded.updated_at`
	).run(id, byteSize, new Date().toISOString())
}

export const deleteDatasetRow = (db: DatabaseSync, id: string): void => {
	db.prepare("DELETE FROM datasets WHERE id = ?").run(id)
}

export const listDatasetIds = (db: DatabaseSync): string[] => {
	const rows = db.prepare("SELECT id FROM datasets").all() as { id: string }[]
	return rows.map((r) => r.id)
}

/** Pull the `thumbnail` property out of a Visual's JSON body. The body is
 *  otherwise treated as opaque; this is the one field the server understands,
 *  purely as a storage-layout concern. */
const splitThumbnail = (
	body: string
): { stripped: string; thumbnail: string | null } => {
	const parsed = JSON.parse(body) as Record<string, unknown>
	const thumbnail =
		typeof parsed.thumbnail === "string" ? parsed.thumbnail : null
	delete parsed.thumbnail
	return { stripped: JSON.stringify(parsed), thumbnail }
}

const mergeThumbnail = (body: string, thumbnail: string | null): string => {
	const parsed = JSON.parse(body) as Record<string, unknown>
	parsed.thumbnail = thumbnail
	return JSON.stringify(parsed)
}
