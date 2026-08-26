// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	datasetStamp,
	deleteBody,
	listContentVersions,
	listDatasetMeta,
	listRows,
	openDb,
	setContentVersion,
	upsertBody,
	upsertDatasetMeta,
	upsertDatasetRow,
} from "./db.js"
import { DatabaseSync } from "node:sqlite"

let open: DatabaseSync[] = []
const freshDir = () => mkdtempSync(join(tmpdir(), "vis-db-"))
const openTracked = (dir: string) => {
	const db = openDb(dir)
	open.push(db)
	return db
}

afterEach(() => {
	for (const db of open) {
		try {
			db.close()
		} catch {
			// already closed by the test
		}
	}
	open = []
})

describe("openDb", () => {
	it("initializes an empty directory and is idempotent on reopen", () => {
		const dir = freshDir()
		const first = openTracked(dir)
		upsertBody(first, "folders", "f1", `{"id":"f1","name":"A"}`)
		first.close()
		const second = openTracked(dir)
		expect(listRows(second, "folders")).toEqual([
			{ id: "f1", body: `{"id":"f1","name":"A"}` },
		])
	})

	it("fails fast on a malformed database file", () => {
		const dir = freshDir()
		writeFileSync(join(dir, "vis.sqlite"), "this is not a sqlite database at all")
		expect(() => openDb(dir)).toThrow(/refusing to start/i)
	})

	it("fails fast when the schema is newer than this server", () => {
		const dir = freshDir()
		const db = openTracked(dir)
		db.prepare(
			"INSERT INTO schema_migrations (version, applied_at) VALUES (999, 'x')"
		).run()
		db.close()
		expect(() => openDb(dir)).toThrow(/newer/i)
	})
})

describe("content versions", () => {
	it("upserts one row per collection", () => {
		const db = openTracked(freshDir())
		expect(listContentVersions(db)).toEqual({})
		setContentVersion(db, "visuals", 4)
		setContentVersion(db, "themes", 2)
		setContentVersion(db, "visuals", 5)
		expect(listContentVersions(db)).toEqual({ visuals: 5, themes: 2 })
	})

	// The whole point of the feature: a database created by an earlier server
	// build gains the table on reopen, with the existing rows intact and no
	// stamps — which the client reads as "already at the current shape".
	it("is added to a database created before it existed, without stamps", () => {
		// Built at the v1+v2 shape directly rather than by opening at the
		// current version and undoing migration 3. That shortcut only worked
		// while 3 was the newest migration: with anything appended after it,
		// MAX(version) stays above 3 and the runner never revisits it.
		const dir = freshDir()
		const first = new DatabaseSync(join(dir, "vis.sqlite"))
		first.exec(`CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
		)`)
		first.exec(`CREATE TABLE visuals (
			id TEXT PRIMARY KEY, body TEXT NOT NULL, thumbnail TEXT,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE folders (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE embed_instances (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE themes (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE datasets (id TEXT PRIMARY KEY, byte_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE fonts (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);`)
		for (const v of [1, 2]) {
			first.prepare(
				"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
			).run(v, "2026-01-01T00:00:00.000Z")
		}
		first.prepare(
			"INSERT INTO folders (id, body, updated_at) VALUES (?, ?, ?)"
		).run("f1", `{"id":"f1"}`, "2026-01-01T00:00:00.000Z")
		first.close()

		const second = openTracked(dir)
		expect(listContentVersions(second)).toEqual({})
		expect(listRows(second, "folders")).toEqual([
			{ id: "f1", body: `{"id":"f1"}` },
		])
	})
})

describe("JSON collections", () => {
	it("upserts, replaces, and deletes idempotently", () => {
		const db = openTracked(freshDir())
		upsertBody(db, "themes", "t1", `{"id":"t1","name":"Old"}`)
		upsertBody(db, "themes", "t1", `{"id":"t1","name":"New"}`)
		expect(listRows(db, "themes")).toEqual([
			{ id: "t1", body: `{"id":"t1","name":"New"}` },
		])
		deleteBody(db, "themes", "t1")
		deleteBody(db, "themes", "t1")
		expect(listRows(db, "themes")).toEqual([])
	})

	it("splits visual thumbnails into their own column and merges them back", () => {
		const db = openTracked(freshDir())
		upsertBody(
			db,
			"visuals",
			"v1",
			`{"id":"v1","name":"Chart","thumbnail":"data:image/png;base64,AAA"}`
		)
		const stored = db
			.prepare("SELECT body, thumbnail FROM visuals WHERE id='v1'")
			.get() as { body: string; thumbnail: string | null }
		expect(stored.thumbnail).toBe("data:image/png;base64,AAA")
		expect(stored.body).not.toContain("thumbnail")

		const [row] = listRows(db, "visuals")
		expect(JSON.parse(row.body)).toMatchObject({
			id: "v1",
			thumbnail: "data:image/png;base64,AAA",
		})
	})

	it("round-trips a null thumbnail", () => {
		const db = openTracked(freshDir())
		upsertBody(db, "visuals", "v2", `{"id":"v2","thumbnail":null}`)
		const [row] = listRows(db, "visuals")
		expect(JSON.parse(row.body).thumbnail).toBeNull()
	})
})

describe("schema v4 — dataset metadata column", () => {
	// The deploy-safety test. A production database is at v3 with real rows in
	// it; opening it with this build must migrate in place and leave every
	// existing row readable. Written against a DB built by the v1–v3
	// statements verbatim rather than by openDb, so it keeps testing the
	// upgrade path even after more migrations are appended.
	it("upgrades a populated v3 database without disturbing its rows", () => {
		const dir = freshDir()
		const db = new DatabaseSync(join(dir, "vis.sqlite"))
		db.exec(`CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
		)`)
		db.exec(`CREATE TABLE visuals (
			id TEXT PRIMARY KEY, body TEXT NOT NULL, thumbnail TEXT,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE folders (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE embed_instances (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE themes (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE datasets (id TEXT PRIMARY KEY, byte_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE fonts (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE content_versions (
			collection TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL
		);`)
		for (const v of [1, 2, 3]) {
			db.prepare(
				"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
			).run(v, "2026-01-01T00:00:00.000Z")
		}
		db.prepare(
			"INSERT INTO visuals (id, body, thumbnail, updated_at) VALUES (?, ?, ?, ?)"
		).run("v1", `{"id":"v1","name":"Before"}`, "data:image/png;base64,AA", "2026-01-01T00:00:00.000Z")
		db.prepare(
			"INSERT INTO datasets (id, byte_size, updated_at) VALUES (?, ?, ?)"
		).run("ds-old", 4096, "2026-01-01T00:00:00.000Z")
		db.close()

		const upgraded = openTracked(dir)

		// Pre-existing content survives the migration untouched.
		expect(listRows(upgraded, "visuals")).toEqual([
			{ id: "v1", body: `{"id":"v1","name":"Before","thumbnail":"data:image/png;base64,AA"}` },
		])
		// …and the dataset that predates the column reads as un-hydrated rather
		// than as missing. This is the case that would empty a production
		// library if the index treated a null as "no such dataset".
		expect(listDatasetMeta(upgraded)).toEqual([{ id: "ds-old", meta: null }])
		expect(datasetStamp(upgraded, "ds-old")).toEqual({
			updated_at: "2026-01-01T00:00:00.000Z",
			byte_size: 4096,
		})
	})

	it("stores client-derived meta and hands it back on the index", () => {
		const dir = freshDir()
		const db = openTracked(dir)
		upsertDatasetRow(db, "ds1", 128)
		expect(listDatasetMeta(db)).toEqual([{ id: "ds1", meta: null }])

		upsertDatasetMeta(db, "ds1", `{"id":"ds1","name":"Sales"}`)
		expect(listDatasetMeta(db)).toEqual([
			{ id: "ds1", meta: `{"id":"ds1","name":"Sales"}` },
		])
	})

	it("clears meta when the body is rewritten, so a stale index is never served", () => {
		const dir = freshDir()
		const db = openTracked(dir)
		upsertDatasetRow(db, "ds1", 128)
		upsertDatasetMeta(db, "ds1", `{"id":"ds1","name":"Sales"}`)

		// A new upload lands: the stored meta now describes the previous body.
		upsertDatasetRow(db, "ds1", 256)
		expect(listDatasetMeta(db)).toEqual([{ id: "ds1", meta: null }])
	})

	it("ignores a meta write for a dataset that no longer exists", () => {
		const dir = freshDir()
		const db = openTracked(dir)
		upsertDatasetMeta(db, "ds-gone", `{"id":"ds-gone"}`)
		expect(listDatasetMeta(db)).toEqual([])
	})
})
