// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	deleteBody,
	listRows,
	openDb,
	upsertBody,
} from "./db.js"
import type { DatabaseSync } from "node:sqlite"

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
