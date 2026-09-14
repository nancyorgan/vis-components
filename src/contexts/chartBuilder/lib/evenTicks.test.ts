import { describe, expect, it } from "vitest"

import { evenlySpacedTicks } from "./evenTicks"

describe("evenlySpacedTicks", () => {
	it("returns exactly `count` ticks from min to max inclusive", () => {
		// The user-reported case: pinned 0.04–0.24, Count 6 → 0.04 steps.
		expect(evenlySpacedTicks(0.04, 0.24, 6)).toEqual([
			0.04, 0.08, 0.12, 0.16, 0.2, 0.24,
		])
	})

	it("strips float accumulation noise from interior ticks", () => {
		for (const v of evenlySpacedTicks(0.04, 0.24, 6)) {
			expect(String(v).length).toBeLessThanOrEqual(4)
		}
		expect(evenlySpacedTicks(0, 1, 4)).toEqual([0, 0.333333333333, 0.666666666667, 1])
	})

	it("handles descending bounds without reordering (caller owns direction)", () => {
		expect(evenlySpacedTicks(10, 0, 3)).toEqual([10, 5, 0])
	})

	it("degenerate counts: 0 → none, 1 → just min", () => {
		expect(evenlySpacedTicks(0, 100, 0)).toEqual([])
		expect(evenlySpacedTicks(0, 100, 1)).toEqual([0])
		expect(evenlySpacedTicks(5, 5, 4)).toEqual([5])
	})

	it("rejects non-finite bounds", () => {
		expect(evenlySpacedTicks(Number.NaN, 1, 3)).toEqual([])
	})
})
