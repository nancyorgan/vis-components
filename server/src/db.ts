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
	// v3 — content-schema version per collection. NOT this table's own schema
	// version (that's schema_migrations above): these track which version of
	// the FRONTEND's persisted shapes the stored bodies are at, so a client
	// running a newer build knows which of its content migrations to apply.
	// See lib/storage/httpAdapter.ts.
	`CREATE TABLE content_versions (
		collection TEXT PRIMARY KEY,
		version INTEGER NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	// v4 — dataset metadata (name, fields, per-version ids/filenames/counts)
	// stored apart from the rows, so a session can list the library without
	// transferring any row data. Purely additive: an ADD COLUMN with no
	// default, so every pre-existing row reads NULL and the old server would
	// still understand this table if it were ever pointed at the new DB.
	//
	// NULL is the ONE signal for "no usable metadata here" and it is never
	// backfilled by the server — deriving it would mean parsing dataset
	// bodies, which this server deliberately never does (see the module
	// header). Clients hydrate it instead: read the body, derive the meta,
	// PUT it back. That covers both cases uniformly — rows written before
	// this migration, and a body PUT whose follow-up meta PUT never landed.
	`ALTER TABLE datasets ADD COLUMN meta TEXT;`,
	// v5 — one stored body per dataset VERSION, so opening a visualization
	// transfers the version it draws rather than the whole upload history.
	// Additive: an index only. Datasets written before this have no rows here
	// and keep being served from their whole-dataset file until a client
	// splits them, exactly like a null `meta` is repaired on read.
	`CREATE TABLE dataset_versions (
		dataset_id TEXT NOT NULL,
		version_id TEXT NOT NULL,
		byte_size INTEGER NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (dataset_id, version_id)
	);`,
	// v6 — shared app-wide settings, one JSON body per key. First occupant:
	// the default-theme pick (`settings/default-theme`), which seeds every
	// new visualization ANYONE creates on this server. It used to live in
	// each browser's localStorage, which quietly made it per-person.
	`CREATE TABLE settings (
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
	settings: "settings",
} as const

export type JsonCollection = keyof typeof JSON_TABLES

export const isJsonCollection = (value: string): value is JsonCollection =>
	value in JSON_TABLES

/** Collections whose stored bodies carry a frontend content-schema version.
 *  `datasets` is here despite living in files rather than a JSON table;
 *  `folders` and `settings` are absent because the frontend never versioned
 *  them (they're read unversioned; if that changes, add them here AND to the
 *  client registry in lib/storage/migrations.ts). The server never interprets
 *  these numbers — it only stores what the client stamps. */
const CONTENT_VERSION_COLLECTIONS = new Set([
	"visuals",
	"datasets",
	"embed-instances",
	"themes",
	"fonts",
])

export const isContentVersionCollection = (value: string): boolean =>
	CONTENT_VERSION_COLLECTIONS.has(value)

/** Every stamped content version, keyed by collection. A collection with no
 *  row is simply absent — the client decides what an absent stamp means. */
export const listContentVersions = (db: DatabaseSync): Record<string, number> => {
	const rows = db
		.prepare("SELECT collection, version FROM content_versions")
		.all() as { collection: string; version: number }[]
	const out: Record<string, number> = {}
	for (const { collection, version } of rows) out[collection] = version
	return out
}

export const setContentVersion = (
	db: DatabaseSync,
	collection: string,
	version: number
): void => {
	db.prepare(
		`INSERT INTO content_versions (collection, version, updated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(collection) DO UPDATE SET version=excluded.version,
		   updated_at=excluded.updated_at`
	).run(collection, version, new Date().toISOString())
}

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
	collection: JsonCollection,
	{ thumbnails = true }: { thumbnails?: boolean } = {}
): ItemRow[] => {
	const table = JSON_TABLES[collection]
	if (collection === "visuals") {
		// Thumbnails are base64 PNGs and by far the largest thing a visual
		// carries. The editor and the embed page render none of them, so they
		// ask for the rows without. The column has always been stored apart
		// from the body precisely so this query could skip it.
		if (!thumbnails) {
			return db
				.prepare(`SELECT id, body FROM ${table}`)
				.all() as ItemRow[]
		}
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
		const { stripped, thumbnail, hadKey } = splitThumbnail(body)
		// An ABSENT `thumbnail` key means "leave the stored one alone"; an
		// explicit null means "clear it". The distinction is what makes a
		// thumbnail-free read (`?thumbnails=0`) safe to save back: without it,
		// a session that never received thumbnails would blank the stored
		// preview of whatever it saved. It mirrors the rule the browser-local
		// thumbnail side-table already follows.
		if (!hadKey) {
			db.prepare(
				`INSERT INTO ${table} (id, body, thumbnail, updated_at) VALUES (?, ?, NULL, ?)
				 ON CONFLICT(id) DO UPDATE SET body=excluded.body,
				   updated_at=excluded.updated_at`
			).run(id, stripped, now)
			return
		}
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

/** Index a dataset body write. Deliberately clears `meta`: the rows just
 *  changed, so any stored metadata now describes the previous body. The
 *  client PUTs the fresh meta immediately after; if that never lands, the
 *  NULL means the next reader hydrates it rather than trusting a stale
 *  version list. */
export const upsertDatasetRow = (
	db: DatabaseSync,
	id: string,
	byteSize: number
): void => {
	db.prepare(
		`INSERT INTO datasets (id, byte_size, updated_at, meta) VALUES (?, ?, ?, NULL)
		 ON CONFLICT(id) DO UPDATE SET byte_size=excluded.byte_size,
		   updated_at=excluded.updated_at, meta=NULL`
	).run(id, byteSize, new Date().toISOString())
}

/** Store one dataset's metadata. Only ever called with client-derived JSON —
 *  the server treats it as an opaque string, exactly as it does item bodies
 *  and content-version numbers. No-ops when the dataset has no index row, so
 *  a meta PUT racing a delete can't resurrect it. */
export const upsertDatasetMeta = (
	db: DatabaseSync,
	id: string,
	meta: string
): void => {
	db.prepare("UPDATE datasets SET meta = ? WHERE id = ?").run(meta, id)
}

/** The index row's cache validators, or null when the dataset isn't indexed. */
export const datasetStamp = (
	db: DatabaseSync,
	id: string
): { updated_at: string; byte_size: number } | null =>
	(db
		.prepare("SELECT updated_at, byte_size FROM datasets WHERE id = ?")
		.get(id) as { updated_at: string; byte_size: number } | undefined) ?? null

export type DatasetMetaRow = { id: string; meta: string | null }

/** Every dataset's id with its stored metadata JSON, `null` where none has
 *  been hydrated yet. Never touches the data dir. */
export const listDatasetMeta = (db: DatabaseSync): DatasetMetaRow[] =>
	db.prepare("SELECT id, meta FROM datasets").all() as DatasetMetaRow[]

/** Remove a dataset's index row AND every one of its version rows. Callers
 *  must delete the corresponding files; this only clears the index. */
export const deleteDatasetRow = (db: DatabaseSync, id: string): void => {
	db.prepare("DELETE FROM datasets WHERE id = ?").run(id)
	db.prepare("DELETE FROM dataset_versions WHERE dataset_id = ?").run(id)
}

/** Index one version body — but ONLY when the parent dataset exists, the
 *  same anti-resurrection rule `upsertDatasetMeta` follows: a version PUT
 *  racing the dataset's DELETE must not re-create index rows for data the
 *  user deleted. Returns false when the insert was refused so the caller can
 *  remove the file it wrote. */
export const upsertDatasetVersionRow = (
	db: DatabaseSync,
	datasetId: string,
	versionId: string,
	byteSize: number
): boolean => {
	const result = db
		.prepare(
			`INSERT INTO dataset_versions (dataset_id, version_id, byte_size, updated_at)
			 SELECT ?, ?, ?, ?
			 WHERE EXISTS (SELECT 1 FROM datasets WHERE id = ?)
			 ON CONFLICT(dataset_id, version_id) DO UPDATE SET
			   byte_size=excluded.byte_size, updated_at=excluded.updated_at`
		)
		.run(datasetId, versionId, byteSize, new Date().toISOString(), datasetId)
	return result.changes > 0
}

/** Drop EVERY version row of one dataset. Used when a body write arrives
 *  from a client that doesn't manage per-version bodies (no follow-up
 *  PUTs/DELETEs): the stored versions describe the previous body, and
 *  keeping them would serve rows — possibly deleted ones — that no longer
 *  match the dataset. Callers delete the corresponding files. */
export const clearDatasetVersionRows = (
	db: DatabaseSync,
	datasetId: string
): void => {
	db.prepare("DELETE FROM dataset_versions WHERE dataset_id = ?").run(datasetId)
}

export const deleteDatasetVersionRow = (
	db: DatabaseSync,
	datasetId: string,
	versionId: string
): void => {
	db.prepare(
		"DELETE FROM dataset_versions WHERE dataset_id = ? AND version_id = ?"
	).run(datasetId, versionId)
}

/** Every (dataset, version) pair with a stored body, in one query — the boot
 *  sweep's input, so it never does per-dataset lookups over the whole index. */
export const listAllDatasetVersionRows = (
	db: DatabaseSync
): Array<{ dataset_id: string; version_id: string }> =>
	db
		.prepare("SELECT dataset_id, version_id FROM dataset_versions")
		.all() as Array<{ dataset_id: string; version_id: string }>

/** Version ids that have a stored body of their own, for one dataset. */
export const listDatasetVersionIds = (
	db: DatabaseSync,
	datasetId: string
): string[] =>
	(
		db
			.prepare(
				"SELECT version_id FROM dataset_versions WHERE dataset_id = ?"
			)
			.all(datasetId) as { version_id: string }[]
	).map((r) => r.version_id)

/** Cache validators for one version body, or null when it has none stored. */
export const datasetVersionStamp = (
	db: DatabaseSync,
	datasetId: string,
	versionId: string
): { updated_at: string; byte_size: number } | null =>
	(db
		.prepare(
			`SELECT updated_at, byte_size FROM dataset_versions
			 WHERE dataset_id = ? AND version_id = ?`
		)
		.get(datasetId, versionId) as
		| { updated_at: string; byte_size: number }
		| undefined) ?? null

export const listDatasetIds = (db: DatabaseSync): string[] => {
	const rows = db.prepare("SELECT id FROM datasets").all() as { id: string }[]
	return rows.map((r) => r.id)
}

/** Pull the `thumbnail` property out of a Visual's JSON body. The body is
 *  otherwise treated as opaque; this is the one field the server understands,
 *  purely as a storage-layout concern. */
const splitThumbnail = (
	body: string
): { stripped: string; thumbnail: string | null; hadKey: boolean } => {
	const parsed = JSON.parse(body) as Record<string, unknown>
	const hadKey = "thumbnail" in parsed
	const thumbnail =
		typeof parsed.thumbnail === "string" ? parsed.thumbnail : null
	delete parsed.thumbnail
	return { stripped: JSON.stringify(parsed), thumbnail, hadKey }
}

const mergeThumbnail = (body: string, thumbnail: string | null): string => {
	const parsed = JSON.parse(body) as Record<string, unknown>
	parsed.thumbnail = thumbnail
	return JSON.stringify(parsed)
}
