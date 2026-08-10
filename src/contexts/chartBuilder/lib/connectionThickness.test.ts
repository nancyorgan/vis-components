import { describe, expect, it } from "vitest"

import {
	MIN_LINE_THICKNESS,
	resolveConnectionThickness,
} from "./connectionThickness"

describe("resolveConnectionThickness", () => {
	const base = { groupKey: "A", thickness: 2, byValue: undefined }

	it("returns the single thickness when there is no override map", () => {
		expect(resolveConnectionThickness(base)).toBe(2)
	})

	it("returns the single thickness for an empty override map", () => {
		expect(resolveConnectionThickness({ ...base, byValue: {} })).toBe(2)
	})

	it("uses the per-value override when present", () => {
		expect(
			resolveConnectionThickness({ ...base, byValue: { A: 6, B: 1 } })
		).toBe(6)
	})

	it("falls back to the single thickness for a group with no entry", () => {
		expect(
			resolveConnectionThickness({ ...base, groupKey: "C", byValue: { A: 6 } })
		).toBe(2)
	})

	it("ignores overrides when the group key is null", () => {
		expect(
			resolveConnectionThickness({ ...base, groupKey: null, byValue: { A: 6 } })
		).toBe(2)
	})

	it("clamps a stored override below the minimum to the floor", () => {
		expect(
			resolveConnectionThickness({ ...base, byValue: { A: -1 } })
		).toBe(MIN_LINE_THICKNESS)
	})

	it("lets a zero override hide the line", () => {
		expect(resolveConnectionThickness({ ...base, byValue: { A: 0 } })).toBe(0)
	})
})
