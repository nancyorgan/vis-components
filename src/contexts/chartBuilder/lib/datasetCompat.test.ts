import { describe, expect, it } from "vitest"
import {
	describeAddedColumns,
	describeDiff,
	diffFields,
	isCompatible,
	pruneOrphanFields,
} from "./datasetCompat"
import type { Dataset, DatasetVersion, Field } from "./types"

const q = (name: string): Field => ({ name, inferredType: "quantitative" })
const c = (name: string): Field => ({ name, inferredType: "categorical" })

const version = (
	id: string,
	rows: Array<Record<string, string>>
): DatasetVersion => ({ id, filename: `${id}.csv`, rows, createdAt: 0 })

const dataset = (fields: Field[], versions: DatasetVersion[]): Dataset => ({
	id: "ds-1",
	name: "test",
	fields,
	versions,
	// Length may be 0 in edge-case tests; a dangling pointer is fine here.
	latestVersionId: versions.at(-1)?.id ?? "none",
	createdAt: 0,
})

describe("diffFields", () => {
	it("reports no changes for identical schemas", () => {
		const fields = [q("x"), c("group")]
		expect(diffFields(fields, fields)).toEqual({
			missing: [],
			added: [],
			typeChanged: [],
		})
	})

	it("detects net-new columns as added", () => {
		const diff = diffFields([q("x")], [q("x"), q("y")])
		expect(diff.added).toEqual(["y"])
		expect(diff.missing).toEqual([])
		expect(diff.typeChanged).toEqual([])
	})

	it("detects dropped columns as missing", () => {
		const diff = diffFields([q("x"), q("y")], [q("x")])
		expect(diff.missing).toEqual(["y"])
		expect(diff.added).toEqual([])
	})

	it("detects a changed inferred type", () => {
		const diff = diffFields([q("x")], [c("x")])
		expect(diff.typeChanged).toEqual([
			{ name: "x", expected: "quantitative", got: "categorical" },
		])
	})

	it("allows categorical → quantitative (inference has widened over time)", () => {
		// A dollar column stored before "$1,234" counted as numeric infers
		// quantitative today; a byte-identical version upload must still be
		// compatible. The stored categorical type stays authoritative.
		const diff = diffFields([c("Revenue")], [q("Revenue")])
		expect(diff.typeChanged).toEqual([])
		expect(isCompatible(diff)).toBe(true)
	})
})

describe("isCompatible", () => {
	it("accepts an identical schema", () => {
		expect(isCompatible(diffFields([q("x")], [q("x")]))).toBe(true)
	})

	it("accepts an additive schema (net-new column)", () => {
		expect(isCompatible(diffFields([q("x")], [q("x"), q("y")]))).toBe(true)
	})

	it("rejects a missing column", () => {
		expect(isCompatible(diffFields([q("x"), q("y")], [q("x")]))).toBe(false)
	})

	it("rejects a type change even when otherwise additive", () => {
		const diff = diffFields([q("x")], [c("x"), q("y")])
		expect(diff.added).toEqual(["y"])
		expect(diff.typeChanged).toHaveLength(1)
		expect(isCompatible(diff)).toBe(false)
	})
})

describe("describeDiff", () => {
	it("omits added columns from the blocking explanation", () => {
		const diff = diffFields([q("x"), q("y")], [q("x"), q("z")])
		// `y` dropped (blocking), `z` added (not blocking)
		expect(describeDiff(diff)).toBe("missing column: `y`")
	})
})

describe("pruneOrphanFields", () => {
	it("drops a field no version's rows carry", () => {
		const d = dataset(
			[q("x"), q("y")],
			[version("v1", [{ x: "1" }, { x: "2" }])]
		)
		expect(pruneOrphanFields(d).fields).toEqual([q("x")])
	})

	it("keeps a field carried by any version, even a non-latest one", () => {
		const d = dataset(
			[q("x"), q("y")],
			[version("v1", [{ x: "1" }]), version("v2", [{ x: "1", y: "2" }])]
		)
		expect(pruneOrphanFields(d)).toBe(d)
	})

	it("keeps a field present only on some rows of a version", () => {
		// PapaParse omits trailing keys on short rows — presence anywhere counts.
		const d = dataset(
			[q("x"), q("y")],
			[version("v1", [{ x: "1" }, { x: "2", y: "3" }])]
		)
		expect(pruneOrphanFields(d)).toBe(d)
	})

	it("drops blank-named fields left by a deleted upload with empty headers", () => {
		const d = dataset(
			[q("x"), c(""), c("_1")],
			[version("v1", [{ x: "1" }])]
		)
		expect(pruneOrphanFields(d).fields).toEqual([q("x")])
	})

	it("returns the same reference when nothing is pruned", () => {
		const d = dataset([q("x")], [version("v1", [{ x: "1" }])])
		expect(pruneOrphanFields(d)).toBe(d)
	})

	it("skips pruning when any version has zero rows", () => {
		// A row-less version's columns are unknowable from rows; never risk
		// dropping a field it may legitimately carry.
		const d = dataset(
			[q("x"), q("y")],
			[version("v1", [{ x: "1" }]), version("v2", [])]
		)
		expect(pruneOrphanFields(d)).toBe(d)
	})

	it("skips pruning when there are no versions at all", () => {
		const d = dataset([q("x")], [])
		expect(pruneOrphanFields(d)).toBe(d)
	})
})

describe("describeAddedColumns", () => {
	it("is empty when nothing was added", () => {
		expect(describeAddedColumns(diffFields([q("x")], [q("x")]))).toBe("")
	})

	it("lists a single added column", () => {
		expect(
			describeAddedColumns(diffFields([q("x")], [q("x"), q("y")]))
		).toBe("Adds 1 new column: `y`.")
	})

	it("lists multiple added columns", () => {
		expect(
			describeAddedColumns(diffFields([q("x")], [q("x"), q("y"), q("z")]))
		).toBe("Adds 2 new columns: `y`, `z`.")
	})
})
