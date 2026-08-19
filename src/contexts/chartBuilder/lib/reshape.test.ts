import { describe, expect, it } from "vitest"
import {
	applyReshapeToView,
	DEFAULT_RESHAPE_CONFIG,
	meltDataset,
	reshapeApplies,
	reshapeIssues,
	type ReshapeConfig,
} from "./reshape"
import type { DatasetView, Field } from "./types"

const FIELDS: Field[] = [
	{ name: "store", inferredType: "categorical" },
	{ name: "monday", inferredType: "quantitative" },
	{ name: "tuesday", inferredType: "quantitative" },
	{ name: "wednesday", inferredType: "quantitative" },
	{ name: "notes", inferredType: "categorical" },
]

const ROWS = [
	{ store: "A", monday: "1", tuesday: "2", wednesday: "3", notes: "n1" },
	{ store: "B", monday: "4", tuesday: "5", wednesday: "6", notes: "n2" },
]

const config = (overrides: Partial<ReshapeConfig> = {}): ReshapeConfig => ({
	...DEFAULT_RESHAPE_CONFIG,
	idFields: ["store"],
	meltFields: ["monday", "tuesday", "wednesday"],
	variableName: "day",
	valueName: "sales",
	...overrides,
})

describe("meltDataset", () => {
	it("melts each row into one row per combined column", () => {
		const { fields, rows } = meltDataset(FIELDS, ROWS, config())
		expect(fields).toEqual([
			{ name: "store", inferredType: "categorical" },
			{ name: "day", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
		])
		expect(rows).toEqual([
			{ store: "A", day: "monday", sales: "1" },
			{ store: "A", day: "tuesday", sales: "2" },
			{ store: "A", day: "wednesday", sales: "3" },
			{ store: "B", day: "monday", sales: "4" },
			{ store: "B", day: "tuesday", sales: "5" },
			{ store: "B", day: "wednesday", sales: "6" },
		])
	})

	it("drops columns checked in neither list (notes)", () => {
		const { fields, rows } = meltDataset(FIELDS, ROWS, config())
		expect(fields.some((f) => f.name === "notes")).toBe(false)
		expect(rows.every((r) => !("notes" in r))).toBe(true)
	})

	it("melts in dataset column order regardless of check order", () => {
		const { rows } = meltDataset(
			FIELDS,
			ROWS,
			config({ meltFields: ["wednesday", "monday", "tuesday"] })
		)
		expect(rows.slice(0, 3).map((r) => r.day)).toEqual([
			"monday",
			"tuesday",
			"wednesday",
		])
	})

	it("keeps sparse/missing cells as empty strings", () => {
		// The CSV parser omits trailing keys on short rows.
		const { rows } = meltDataset(
			FIELDS,
			[{ store: "A", monday: "1" }],
			config()
		)
		expect(rows).toEqual([
			{ store: "A", day: "monday", sales: "1" },
			{ store: "A", day: "tuesday", sales: "" },
			{ store: "A", day: "wednesday", sales: "" },
		])
	})

	it("re-infers the value column's type (mixed sources → categorical)", () => {
		const { fields } = meltDataset(
			FIELDS,
			ROWS,
			config({ meltFields: ["monday", "notes"] })
		)
		expect(fields.find((f) => f.name === "sales")?.inferredType).toBe(
			"categorical"
		)
	})

	it("ignores stale field names and lets ID win over melt", () => {
		const { fields, rows } = meltDataset(
			FIELDS,
			ROWS,
			config({
				idFields: ["store", "gone", "monday"],
				meltFields: ["monday", "tuesday", "alsoGone"],
			})
		)
		expect(fields.map((f) => f.name)).toEqual([
			"store",
			"monday",
			"day",
			"sales",
		])
		expect(rows).toHaveLength(2)
		expect(rows[0]).toEqual({
			store: "A",
			monday: "1",
			day: "tuesday",
			sales: "2",
		})
	})

	it("trims the new column names", () => {
		const { rows } = meltDataset(
			FIELDS,
			ROWS,
			config({ variableName: " day ", valueName: " sales " })
		)
		expect(Object.keys(rows[0])).toEqual(["store", "day", "sales"])
	})
})

describe("reshapeIssues / reshapeApplies", () => {
	it("applies for a complete config", () => {
		expect(reshapeApplies(FIELDS, config())).toBe(true)
	})

	it("does not apply without any present melt column", () => {
		expect(reshapeApplies(FIELDS, config({ meltFields: [] }))).toBe(false)
		expect(reshapeApplies(FIELDS, config({ meltFields: ["gone"] }))).toBe(
			false
		)
	})

	it("blank names fall back to the defaults instead of blocking", () => {
		const c = config({ variableName: "", valueName: "  " })
		expect(reshapeIssues(FIELDS, c)).toEqual([])
		expect(reshapeApplies(FIELDS, c)).toBe(true)
		const { rows } = meltDataset(FIELDS, ROWS, c)
		expect(Object.keys(rows[0])).toEqual(["store", "category", "value"])
	})

	it("flags a blank box whose fallback collides with the other name", () => {
		// valueName blank → effective "value"; variableName typed as "value".
		const c = config({ variableName: "value", valueName: "" })
		expect(reshapeIssues(FIELDS, c)).toEqual([
			"The combined and value variables need different names.",
		])
		expect(reshapeApplies(FIELDS, c)).toBe(false)
	})

	it("flags the pair sharing one name", () => {
		const c = config({ variableName: "sales" })
		expect(reshapeIssues(FIELDS, c)).toEqual([
			"The combined and value variables need different names.",
		])
		expect(reshapeApplies(FIELDS, c)).toBe(false)
	})

	it("flags collisions with kept ID columns only", () => {
		const c = config({ variableName: "store" })
		expect(reshapeIssues(FIELDS, c)).toEqual([
			'"store" is already the name of an ID column.',
		])
		expect(reshapeApplies(FIELDS, c)).toBe(false)
		// Colliding with a MELTED column is fine — it's gone from the output.
		expect(reshapeIssues(FIELDS, config({ valueName: "monday" }))).toEqual([])
	})
})

describe("applyReshapeToView", () => {
	const view: DatasetView = {
		id: "ds-1",
		name: "sales",
		filename: "sales.csv",
		fields: FIELDS,
		rows: ROWS,
		createdAt: 0,
		versionId: "dv-1",
		versionIndex: 1,
		totalVersions: 1,
		isLatest: true,
		versionCreatedAt: 0,
	}

	it("returns the SAME view object when the reshape doesn't apply", () => {
		expect(applyReshapeToView(view, DEFAULT_RESHAPE_CONFIG)).toBe(view)
		expect(applyReshapeToView(view, config({ meltFields: [] }))).toBe(view)
		expect(applyReshapeToView(undefined, config())).toBeUndefined()
	})

	it("swaps fields/rows but keeps the version metadata", () => {
		const reshaped = applyReshapeToView(view, config())
		expect(reshaped).not.toBe(view)
		expect(reshaped?.rows).toHaveLength(6)
		expect(reshaped?.fields.map((f) => f.name)).toEqual([
			"store",
			"day",
			"sales",
		])
		expect(reshaped?.versionId).toBe("dv-1")
		expect(reshaped?.name).toBe("sales")
	})
})
