import { describe, expect, it } from "vitest"

import {
	buildHierarchyFromEdges,
	inferHierarchyIdField,
	type HierarchyNode,
} from "./buildHierarchy"

/** Rows in the canonical edge-list shape (Parent,Child,Value). */
const row = (parent: string, child: string, value: string) => ({
	Parent: parent,
	Child: child,
	Value: value,
})

const FRUIT = [
	row("Pome", "Apple", "7"),
	row("Pome", "Pear", "7"),
	row("Citrus", "Lemon", "8"),
	row("Melon", "Watermelon", ""), // internal: value blank, has children
	row("Melon", "Canteloupe", "7"),
	row("Watermelon", "Mini", "1"),
	row("Watermelon", "Seedless", "1"),
	row("Watermelon", "Square", "6"),
]

const RECURSIVE = {
	parentField: "Parent",
	idField: "Child",
	valueField: "Value",
}

const byKey = (nodes: HierarchyNode[], key: string): HierarchyNode | null =>
	nodes.find((n) => n.key === key) ?? null

describe("buildHierarchyFromEdges — recursive mode (idField set)", () => {
	it("builds implicit roots from parents that never appear as an id", () => {
		const { root, diagnostics } = buildHierarchyFromEdges(FRUIT, RECURSIVE)
		const topKeys = root.children.map((n) => n.key).sort()
		expect(topKeys).toEqual(["Citrus", "Melon", "Pome"])
		// Implicit nodes have no source row.
		expect(byKey(root.children, "Pome")?.row).toBeNull()
		expect(diagnostics.cycleBreaks).toEqual([])
	})

	it("nests deeper than two levels by matching parent values to ids", () => {
		const { root } = buildHierarchyFromEdges(FRUIT, RECURSIVE)
		const melon = byKey(root.children, "Melon")
		const watermelon = byKey(melon?.children ?? [], "Watermelon")
		expect(watermelon).not.toBeNull()
		// Watermelon is row-backed (it appears in the Child column) …
		expect(watermelon?.row).not.toBeNull()
		// … and holds its own children.
		expect(watermelon?.children.map((n) => n.key).sort()).toEqual([
			"Mini",
			"Seedless",
			"Square",
		])
	})

	it("keeps leaf values and leaves internal nodes valueless", () => {
		const { root } = buildHierarchyFromEdges(FRUIT, RECURSIVE)
		const melon = byKey(root.children, "Melon")
		const watermelon = byKey(melon?.children ?? [], "Watermelon")
		expect(byKey(watermelon?.children ?? [], "Square")?.value).toBe(6)
		expect(watermelon?.value).toBeNull()
	})

	it("ignores (and reports) a value on an internal node", () => {
		const rows = [...FRUIT]
		// Watermelon with its own value=4 conflicts with children summing to 8.
		rows[3] = row("Melon", "Watermelon", "4")
		const { root, diagnostics } = buildHierarchyFromEdges(rows, RECURSIVE)
		const melon = byKey(root.children, "Melon")
		const watermelon = byKey(melon?.children ?? [], "Watermelon")
		expect(watermelon?.value).toBeNull()
		expect(diagnostics.ignoredInternalValues).toEqual(["Watermelon"])
	})

	it("sums duplicate ids and reports them", () => {
		const rows = [
			row("Citrus", "Lemon", "8"),
			row("Citrus", "Lemon", "2"),
		]
		const { root, diagnostics } = buildHierarchyFromEdges(rows, RECURSIVE)
		const citrus = byKey(root.children, "Citrus")
		expect(byKey(citrus?.children ?? [], "Lemon")?.value).toBe(10)
		expect(diagnostics.duplicateIds).toEqual(["Lemon"])
	})

	it("drops valueless leaves and prunes internal nodes left childless", () => {
		const rows = [
			row("Citrus", "Lemon", "8"),
			row("Citrus", "Lime", ""), // valueless leaf → dropped
			row("Melon", "Watermelon", ""), // internal whose only child drops …
			row("Watermelon", "Mini", "nope"), // unparseable → dropped
		]
		const { root, diagnostics } = buildHierarchyFromEdges(rows, RECURSIVE)
		const citrus = byKey(root.children, "Citrus")
		expect(citrus?.children.map((n) => n.key)).toEqual(["Lemon"])
		// Melon → Watermelon → Mini all cascade away.
		expect(byKey(root.children, "Melon")).toBeNull()
		// Mini + Lime + Watermelon + Melon = 4 dropped nodes.
		expect(diagnostics.droppedValuelessLeaves).toBe(4)
	})

	it("breaks parent cycles by re-rooting a member of the loop", () => {
		const rows = [
			row("B", "A", "1"),
			row("A", "B", "2"),
			row("A", "C", "3"), // hangs off the cycle
		]
		const { root, diagnostics } = buildHierarchyFromEdges(rows, RECURSIVE)
		expect(diagnostics.cycleBreaks.length).toBeGreaterThan(0)
		// Everything still renders — all three nodes reachable from root.
		const count = (n: HierarchyNode): number =>
			1 + n.children.reduce((acc, c) => acc + count(c), 0)
		expect(count(root)).toBe(4) // root + A + B + C
	})

	it("skips rows with a blank id", () => {
		const rows = [row("Citrus", "", "8"), row("Citrus", "Lemon", "8")]
		const { root } = buildHierarchyFromEdges(rows, RECURSIVE)
		const citrus = byKey(root.children, "Citrus")
		expect(citrus?.children.map((n) => n.key)).toEqual(["Lemon"])
	})

	it("keeps all leaves and skips pruning when valueField is null", () => {
		const { root, diagnostics } = buildHierarchyFromEdges(FRUIT, {
			...RECURSIVE,
			valueField: null,
		})
		const melon = byKey(root.children, "Melon")
		const watermelon = byKey(melon?.children ?? [], "Watermelon")
		expect(watermelon?.children.length).toBe(3)
		expect(byKey(watermelon?.children ?? [], "Mini")?.value).toBeNull()
		expect(diagnostics.droppedValuelessLeaves).toBe(0)
	})
})

describe("buildHierarchyFromEdges — grouped mode (no idField)", () => {
	const GROUPED = { parentField: "Parent", idField: null, valueField: "Value" }

	it("groups anonymous leaves one level under their parent value", () => {
		const { root } = buildHierarchyFromEdges(FRUIT, GROUPED)
		// Watermelon has no id match here — its rows form a SIBLING group,
		// not a nested one (the documented grouped-mode limitation).
		expect(root.children.map((n) => n.key).sort()).toEqual([
			"Citrus",
			"Melon",
			"Pome",
			"Watermelon",
		])
		const pome = byKey(root.children, "Pome")
		expect(pome?.children.length).toBe(2)
		expect(pome?.children.every((n) => n.row !== null)).toBe(true)
	})

	it("drops valueless rows (the blank Watermelon internal row)", () => {
		const { root, diagnostics } = buildHierarchyFromEdges(FRUIT, GROUPED)
		const melon = byKey(root.children, "Melon")
		expect(melon?.children.length).toBe(1) // Canteloupe only
		expect(diagnostics.droppedValuelessLeaves).toBe(1)
	})

	it("attaches blank-parent rows directly to the root", () => {
		const rows = [row("", "Apple", "7"), row("Pome", "Pear", "7")]
		const { root } = buildHierarchyFromEdges(rows, GROUPED)
		expect(root.children.length).toBe(2) // the loose leaf + the Pome group
		expect(root.children.filter((n) => n.row !== null).length).toBe(1)
	})

	it("treats idField === parentField as grouped mode (degenerate guard)", () => {
		const { root } = buildHierarchyFromEdges(FRUIT, {
			parentField: "Parent",
			idField: "Parent",
			valueField: "Value",
		})
		// Same shape as GROUPED: top-level groups, anonymous leaves.
		expect(byKey(root.children, "Pome")?.children.length).toBe(2)
	})
})

describe("inferHierarchyIdField", () => {
	it("picks the column whose values overlap the parent column's (Child)", () => {
		// Watermelon appears in both Parent and Child; Value never does.
		expect(inferHierarchyIdField(FRUIT, ["Child", "Value"], "Parent")).toBe(
			"Child"
		)
	})

	it("returns null when no candidate overlaps (pure two-level data)", () => {
		const rows = [
			{ Region: "West", Sales: "10" },
			{ Region: "East", Sales: "20" },
		]
		expect(inferHierarchyIdField(rows, ["Sales"], "Region")).toBeNull()
	})

	it("prefers the candidate with the larger overlap", () => {
		const rows = [
			{ Parent: "A", Alias: "A", Name: "A" },
			{ Parent: "B", Alias: "x", Name: "B" },
		]
		// Name matches both A and B; Alias matches only A.
		expect(inferHierarchyIdField(rows, ["Alias", "Name"], "Parent")).toBe(
			"Name"
		)
	})

	it("breaks ties toward the earlier candidate (dataset field order)", () => {
		const rows = [{ Parent: "A", First: "A", Second: "A" }]
		expect(inferHierarchyIdField(rows, ["First", "Second"], "Parent")).toBe(
			"First"
		)
	})
})
