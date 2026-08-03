import { describe, expect, it } from "vitest"

import type { Stack } from "../../lib/aggregators/stacks"
import { toDensityStacks } from "./BarPlot"

const stack = (category: string, ...values: number[]): Stack => ({
	category,
	slices: values.map((value, i) => ({
		key: String(i),
		groupValues: {},
		value,
	})),
})

describe("toDensityStacks (histogram density mode)", () => {
	it("rescales counts to each slice's share of the grand total (sums to 1)", () => {
		const out = toDensityStacks([stack("a", 4), stack("b", 6)])
		expect(out[0]!.slices[0]!.value).toBeCloseTo(0.4)
		expect(out[1]!.slices[0]!.value).toBeCloseTo(0.6)
		const total = out.reduce(
			(s, st) => s + st.slices.reduce((a, sl) => a + sl.value, 0),
			0
		)
		expect(total).toBeCloseTo(1)
	})

	it("preserves relative proportions across multi-slice (hue-stacked) bins", () => {
		// grand total = 10 → each value divided by 10.
		const out = toDensityStacks([stack("a", 2, 3), stack("b", 1, 4)])
		expect(out[0]!.slices.map((s) => s.value)).toEqual([0.2, 0.3])
		expect(out[1]!.slices.map((s) => s.value)).toEqual([0.1, 0.4])
	})

	it("returns the input unchanged when the total is zero", () => {
		const input = [stack("a", 0)]
		expect(toDensityStacks(input)).toBe(input)
	})
})
