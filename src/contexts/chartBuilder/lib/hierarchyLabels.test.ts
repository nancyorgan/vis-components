import { describe, expect, it } from "vitest"

import { DEFAULT_DATA_LABELS_CONFIG } from "./channelConfig"
import {
	hierarchyLabelLines,
	hierarchyLabelRow,
	hierarchyNameField,
} from "./hierarchyLabels"

const cfg = DEFAULT_DATA_LABELS_CONFIG

describe("hierarchyNameField", () => {
	it("is the id column when nesting by id, else the connection column", () => {
		expect(hierarchyNameField("Parent", "Id")).toBe("Id")
		expect(hierarchyNameField("Group", null)).toBe("Group")
		expect(hierarchyNameField(null, null)).toBeNull()
	})
})

describe("hierarchyLabelRow", () => {
	it("puts the node's own name in the name column", () => {
		expect(hierarchyLabelRow({ Group: "Rosie", Size: 4 }, "", "Group")).toEqual({
			Group: "",
			Size: 4,
		})
		expect(hierarchyLabelRow(null, "Rosie", "Group")).toEqual({ Group: "Rosie" })
	})
})

describe("hierarchyLabelLines", () => {
	const leaf = { Name: "Rosie", Size: 12 }
	// What the panel stores once the checklist changes: one label per
	// checked variable.
	const composedLabels = [
		{ id: "Name", template: "{Name}" },
		{ id: "Size", template: "{Size}" },
	]

	it("labels with the name when Value is unset", () => {
		expect(hierarchyLabelLines(leaf, { field: null }, cfg, "Name")).toEqual([
			{ key: null, text: "Rosie" },
		])
	})

	it("draws nothing for an explicit none", () => {
		expect(
			hierarchyLabelLines(leaf, { field: null, none: true }, cfg, "Name")
		).toEqual([])
	})

	it("a picked field replaces the name", () => {
		expect(hierarchyLabelLines(leaf, { field: "Size" }, cfg, "Name")).toEqual([
			{ key: null, text: "12" },
		])
	})

	it("multi-variable: one line per composed label, each formatted on its own", () => {
		const lines = hierarchyLabelLines(
			leaf,
			{ field: null, multiField: true, fields: ["Name", "Size"] },
			{ ...cfg, composedLabels, fieldFormats: { Size: "$,.0f" } },
			"Name"
		)
		expect(lines).toEqual([
			{ key: "Name", text: "Rosie" },
			{ key: "Size", text: "$12" },
		])
	})

	it("multi-variable: skips labels whose variables are absent on the row", () => {
		const lines = hierarchyLabelLines(
			{ Name: "Fruit" },
			{ field: null, multiField: true, fields: ["Name", "Size"] },
			{ ...cfg, composedLabels },
			"Name"
		)
		expect(lines).toEqual([{ key: "Name", text: "Fruit" }])
	})
})
