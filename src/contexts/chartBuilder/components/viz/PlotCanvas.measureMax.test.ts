import { describe, expect, it } from "vitest"
import { computePanelMeasureMax } from "./PlotCanvas"

const rows = [
	{ cat: "A", hue: "r1", val: 3 },
	{ cat: "A", hue: "r1", val: 4 },
	{ cat: "A", hue: "r2", val: 5 },
]

describe("computePanelMeasureMax (leaf-aware)", () => {
	it("all-stack (no group fields): sums measure per category", () => {
		expect(
			computePanelMeasureMax(rows, "cat", "val", [{ channel: "hue", mode: "stack" }], []),
		).toBe(12)
	})

	it("group by hue, stack by pattern: max stacked total per (category,hue) leaf", () => {
		expect(
			computePanelMeasureMax(
				rows,
				"cat",
				"val",
				[{ channel: "hue", mode: "group" }, { channel: "pattern", mode: "stack" }],
				["hue"],
			),
		).toBe(7)
	})

	it("group by hue only (no stack channel): max single row per leaf", () => {
		expect(
			computePanelMeasureMax(rows, "cat", "val", [{ channel: "hue", mode: "group" }], ["hue"]),
		).toBe(5)
	})

	it("with the slice fields, rows of one slice add up before the leaf walk (as the bar does)", () => {
		// (A, r1) is one bar of 3 + 4 = 7; the row-as-slice walk above says 5.
		expect(
			computePanelMeasureMax(rows, "cat", "val", [{ channel: "hue", mode: "group" }], ["hue"], ["hue"]),
		).toBe(7)
		// No channel at all: one bar per category, every row added up.
		expect(computePanelMeasureMax(rows, "cat", "val", [], [], [])).toBe(12)
		// One row per slice: the same answer either way.
		const single = [
			{ cat: "A", hue: "r1", val: 3 },
			{ cat: "A", hue: "r2", val: 5 },
		]
		const modes = [{ channel: "hue" as const, mode: "group" as const }]
		expect(computePanelMeasureMax(single, "cat", "val", modes, ["hue"], ["hue"])).toBe(
			computePanelMeasureMax(single, "cat", "val", modes, ["hue"])
		)
		// Stacked: a slice's rows add up, and so do the slices of a leaf.
		expect(
			computePanelMeasureMax(rows, "cat", "val", [{ channel: "hue", mode: "stack" }], [], ["hue"]),
		).toBe(12)
	})

	it("empty rows / missing fields return the floor of 1", () => {
		expect(computePanelMeasureMax([], "cat", "val", [], [])).toBe(1)
		expect(computePanelMeasureMax(rows, null, "val", [], [])).toBe(1)
		expect(computePanelMeasureMax(rows, "cat", null, [], [])).toBe(1)
	})
})
