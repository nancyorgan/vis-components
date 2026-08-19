// @vitest-environment node
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	deleteDatasetFile,
	isSafeId,
	listDatasetFiles,
	readDatasetFile,
	writeDatasetFile,
} from "./datasetFiles.js"

const freshDir = () => mkdtempSync(join(tmpdir(), "vis-data-"))

describe("dataset files", () => {
	it("writes, lists, reads back, and deletes idempotently", async () => {
		const dir = freshDir()
		await writeDatasetFile(dir, "ds-abc123", Buffer.from("payload"))
		expect(await listDatasetFiles(dir)).toEqual(["ds-abc123"])
		expect((await readDatasetFile(dir, "ds-abc123"))?.toString()).toBe("payload")
		await deleteDatasetFile(dir, "ds-abc123")
		await deleteDatasetFile(dir, "ds-abc123")
		expect(await readDatasetFile(dir, "ds-abc123")).toBeNull()
		expect(await listDatasetFiles(dir)).toEqual([])
	})

	it("overwrites atomically via a temp name that listing ignores", async () => {
		const dir = freshDir()
		await writeDatasetFile(dir, "ds-1", Buffer.from("one"))
		await writeDatasetFile(dir, "ds-1", Buffer.from("two"))
		expect((await readDatasetFile(dir, "ds-1"))?.toString()).toBe("two")
		expect(await listDatasetFiles(dir)).toEqual(["ds-1"])
	})

	it("rejects path-like ids outright", async () => {
		const dir = freshDir()
		for (const bad of ["../etc/passwd", "a/b", "a.b", "", ".hidden", "a b"]) {
			expect(isSafeId(bad)).toBe(false)
			await expect(readDatasetFile(dir, bad)).rejects.toThrow(/unsafe/i)
		}
		expect(isSafeId("ds-m3k9-a1b2c3")).toBe(true)
	})
})
