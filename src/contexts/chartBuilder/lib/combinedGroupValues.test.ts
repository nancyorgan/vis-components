import { describe, expect, it } from "vitest"

import { combinedGroupValues, combinedValue, modeValue } from "./combinedGroupValues"

const rows = [
	{ score: "10", tier: "gold", note: "" },
	{ score: "20", tier: "silver", note: "" },
	{ score: "", tier: "gold", note: "" },
]

describe("combinedValue", () => {
	it("averages a quantitative field, skipping blank cells", () => {
		expect(combinedValue(rows, "score", "quantitative")).toBe(15)
	})

	it("takes the most common value of a discrete field", () => {
		expect(combinedValue(rows, "tier", "categorical")).toBe("gold")
		expect(combinedValue(rows, "tier", "ordinal")).toBe("gold")
	})

	it("is null when no row carries a value", () => {
		expect(combinedValue(rows, "note", "categorical")).toBeNull()
		expect(combinedValue(rows, "note", "quantitative")).toBeNull()
		expect(combinedValue([], "score", "quantitative")).toBeNull()
		expect(combinedValue(rows, "missing", "categorical")).toBeNull()
	})
})

describe("modeValue", () => {
	it("on a tie, keeps the value that reaches the top count first", () => {
		expect(modeValue(["b", "a", "a", "b"])).toBe("a")
		expect(modeValue(["b", "a"])).toBe("b")
		expect(modeValue([])).toBeNull()
	})
})

describe("combinedGroupValues", () => {
	const scales = {
		opacity: { field: { name: "score", type: "quantitative" as const } },
		pattern: { field: { name: "tier", type: "categorical" as const } },
		saturation: { field: { name: "note", type: "categorical" as const } },
	}

	it("gives each mapped channel the mark's combined value", () => {
		expect(combinedGroupValues(rows, scales)).toEqual({ opacity: 15, pattern: "gold" })
	})

	it("leaves out a channel whose field has no value, so it takes its default", () => {
		expect(combinedGroupValues(rows, scales)).not.toHaveProperty("saturation")
	})

	it("keeps the values the caller already worked out", () => {
		// A heatmap cell brings its own Color aggregate; a hex cell its count.
		const out = combinedGroupValues(
			rows,
			{ ...scales, hue: { field: { name: "score", type: "quantitative" as const } } },
			{ hue: 99, opacity: null }
		)
		expect(out).toEqual({ hue: 99, opacity: null, pattern: "gold" })
	})

	it("reads nothing for unmapped channels", () => {
		expect(combinedGroupValues(rows, {})).toEqual({})
	})
})
