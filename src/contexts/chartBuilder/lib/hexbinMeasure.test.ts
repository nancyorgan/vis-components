import { describe, expect, it } from "vitest"

import {
	HEXBIN_MEASURE_OPTION_VALUE,
	hexbinDerivedOptions,
	hexbinEligible,
	hexbinSourceForOptionValue,
	hexbinSourceOf,
} from "./hexbinMeasure"
import { emptyEncodings } from "./types"

const quantXY = () => ({
	...emptyEncodings(),
	x: { field: "a" },
	y: { field: "b" },
})
const getType = (n: string) =>
	n === "cat" ? ("categorical" as const) : ("quantitative" as const)

describe("hexbinEligible", () => {
	it("true when x and y are mapped and quantitative", () => {
		expect(hexbinEligible(quantXY(), getType)).toBe(true)
	})
	it("false when y is categorical", () => {
		const e = { ...quantXY(), y: { field: "cat" } }
		expect(hexbinEligible(e, getType)).toBe(false)
	})
	it("false when x is unmapped", () => {
		const e = { ...quantXY(), x: { field: null } }
		expect(hexbinEligible(e, getType)).toBe(false)
	})
	it("false without a type lookup (safe default)", () => {
		expect(hexbinEligible(quantXY(), undefined)).toBe(false)
	})
})

describe("options + reverse lookup", () => {
	it("hue gets the Point count option when eligible", () => {
		expect(hexbinDerivedOptions("hue", quantXY(), getType)).toEqual([
			{ value: HEXBIN_MEASURE_OPTION_VALUE, label: "Point count" },
		])
	})
	it("other channels get nothing", () => {
		expect(hexbinDerivedOptions("opacity", quantXY(), getType)).toEqual([])
	})
	it("reverse lookup only matches the reserved value", () => {
		expect(hexbinSourceForOptionValue(HEXBIN_MEASURE_OPTION_VALUE)).toBe(
			"hexCount"
		)
		expect(hexbinSourceForOptionValue("count")).toBeNull()
	})
	it("hexbinSourceOf reads only the hexbin slot", () => {
		expect(hexbinSourceOf({ field: null, measureSource: "hexCount" })).toBe(
			"hexCount"
		)
		expect(hexbinSourceOf({ field: null, measureSource: "count" })).toBeNull()
		expect(hexbinSourceOf(undefined)).toBeNull()
	})
})
