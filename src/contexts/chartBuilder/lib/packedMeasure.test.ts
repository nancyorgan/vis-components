import { describe, expect, it } from "vitest"

import {
	HIERARCHY_ID_NONE,
	resolveHierarchyIdField,
} from "./buildHierarchy"
import {
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
	topLevelGroupNames,
} from "./packedMeasure"

const row = (parent: string, child: string, value: string) => ({
	Parent: parent,
	Child: child,
	Value: value,
})

const FRUIT = [
	row("Pome", "Apple", "7"),
	row("Citrus", "Lemon", "8"),
	row("Melon", "Watermelon", ""),
	row("Watermelon", "Mini", "1"),
]

const FIELDS = ["Parent", "Child", "Value"]

describe("resolveHierarchyIdField", () => {
	it("auto-detects when unset (null / undefined)", () => {
		expect(resolveHierarchyIdField(null, FRUIT, FIELDS, "Parent", "Value")).toBe(
			"Child"
		)
		expect(
			resolveHierarchyIdField(undefined, FRUIT, FIELDS, "Parent", "Value")
		).toBe("Child")
	})

	it("the None sentinel forces grouped mode", () => {
		expect(
			resolveHierarchyIdField(HIERARCHY_ID_NONE, FRUIT, FIELDS, "Parent", "Value")
		).toBeNull()
	})

	it("an explicit column wins over auto-detection", () => {
		expect(
			resolveHierarchyIdField("Value", FRUIT, FIELDS, "Parent", "Value")
		).toBe("Value")
	})
})

describe("topLevelGroupNames", () => {
	it("returns the recursive tree's roots (Watermelon nests, so it's absent)", () => {
		expect(topLevelGroupNames(FRUIT, "Parent", "Child", "Value").sort()).toEqual(
			["Citrus", "Melon", "Pome"]
		)
	})

	it("grouped mode (no id) surfaces Watermelon as its own top-level group", () => {
		expect(topLevelGroupNames(FRUIT, "Parent", null, "Value").sort()).toEqual([
			"Citrus",
			"Pome",
			"Watermelon",
			// No "Melon": its only row is valueless → dropped, so the group
			// never forms in grouped mode.
		])
	})

	it("excludes anonymous root-level leaves (blank parent)", () => {
		const rows = [row("", "Loose", "3"), row("Pome", "Apple", "7")]
		expect(topLevelGroupNames(rows, "Parent", null, "Value")).toEqual(["Pome"])
	})
})

describe("hierarchyDepthLevels", () => {
	it("returns the ordered level strings for the recursive tree", () => {
		// Pome/Citrus/Melon (1) → their children (2) → Mini (3).
		expect(hierarchyDepthLevels(FRUIT, "Parent", "Child", "Value")).toEqual([
			"1",
			"2",
			"3",
		])
	})

	it("grouped mode tops out at two levels", () => {
		expect(hierarchyDepthLevels(FRUIT, "Parent", null, "Value")).toEqual([
			"1",
			"2",
		])
	})
})

describe("packedDerivedOptions", () => {
	it("offers Top-level group + Nesting depth on the five styling channels in packed mode", () => {
		for (const ch of [
			"hue",
			"opacity",
			"saturation",
			"brightness",
			"pattern",
		] as const) {
			expect(packedDerivedOptions(ch, true, true).map((o) => o.label)).toEqual([
				"Top-level group",
				"Nesting depth",
			])
		}
	})

	it("empty outside packed mode, without a connection, or on other channels", () => {
		expect(packedDerivedOptions("hue", false, true)).toEqual([])
		expect(packedDerivedOptions("hue", true, false)).toEqual([])
		expect(packedDerivedOptions("x", true, true)).toEqual([])
		expect(packedDerivedOptions("area", true, true)).toEqual([])
	})
})

describe("packed source lookups", () => {
	it("packedSourceOf reads only the packed values (histogram sources pass as null)", () => {
		expect(packedSourceOf({ field: null, measureSource: "rootGroup" })).toBe(
			"rootGroup"
		)
		expect(packedSourceOf({ field: null, measureSource: "depth" })).toBe("depth")
		expect(packedSourceOf({ field: null, measureSource: "count" })).toBeNull()
		expect(packedSourceOf({ field: "x" })).toBeNull()
		expect(packedSourceOf(undefined)).toBeNull()
	})

	it("packedSourceForOptionValue maps reserved option values back to sources", () => {
		expect(
			packedSourceForOptionValue(PACKED_MEASURE_OPTION_VALUE.rootGroup)
		).toBe("rootGroup")
		expect(packedSourceForOptionValue(PACKED_MEASURE_OPTION_VALUE.depth)).toBe(
			"depth"
		)
		expect(packedSourceForOptionValue("Parent")).toBeNull()
		expect(packedSourceForOptionValue("")).toBeNull()
	})
})
