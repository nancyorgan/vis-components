import { describe, expect, it } from "vitest"
import {
	describeAddedColumns,
	describeDiff,
	diffFields,
	isCompatible,
} from "./datasetCompat"
import type { Field } from "./types"

const q = (name: string): Field => ({ name, inferredType: "quantitative" })
const c = (name: string): Field => ({ name, inferredType: "categorical" })

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
