import { describe, expect, it } from "vitest"

import { effectiveType } from "./fieldType"
import type { DatasetView, FieldType } from "./types"

const makeDataset = (
	fields: Array<{ name: string; inferredType: FieldType }>
): DatasetView => ({
	id: "ds-1",
	name: "test",
	filename: "test.csv",
	fields,
	rows: [],
	createdAt: 0,
	versionId: "v-1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

describe("effectiveType", () => {
	it("returns the override when present", () => {
		const ds = makeDataset([{ name: "x", inferredType: "quantitative" }])
		expect(effectiveType(ds, "x", { x: "categorical" })).toBe("categorical")
	})

	it("returns the inferred type when no override is present", () => {
		const ds = makeDataset([{ name: "x", inferredType: "temporal" }])
		expect(effectiveType(ds, "x", {})).toBe("temporal")
	})

	it("returns 'categorical' when the field is missing and no override is set", () => {
		const ds = makeDataset([{ name: "x", inferredType: "quantitative" }])
		expect(effectiveType(ds, "nope", {})).toBe("categorical")
	})

	it("returns the override for a field missing from the dataset", () => {
		const ds = makeDataset([])
		expect(effectiveType(ds, "nope", { nope: "ordinal" })).toBe("ordinal")
	})

	it("handles an empty overrides object without throwing", () => {
		const ds = makeDataset([{ name: "x", inferredType: "categorical" }])
		expect(effectiveType(ds, "x", {})).toBe("categorical")
	})
})
