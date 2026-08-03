import { describe, expect, it } from "vitest"

import { getChartMode } from "../chartMode"
import { emptyEncodings } from "../types"
import { HexbinMode } from "./hexbin"
import type { FieldTypeLookup } from "./types"

const getType: FieldTypeLookup = (n) =>
	n === "cat" ? "categorical" : "quantitative"

const hexEncodings = () => ({
	...emptyEncodings(),
	x: { field: "a" },
	y: { field: "b" },
	hue: { field: null, measureSource: "hexCount" as const },
})

describe("HexbinMode.detect", () => {
	it("true for quantitative x + y with hue varying by Point count", () => {
		expect(HexbinMode.detect(hexEncodings(), getType)).toBe(true)
	})

	it("false without the hexCount measure source (plain scatter)", () => {
		const e = { ...hexEncodings(), hue: { field: null } }
		expect(HexbinMode.detect(e, getType)).toBe(false)
	})

	it("false when hue carries a field instead", () => {
		const e = { ...hexEncodings(), hue: { field: "z" } }
		expect(HexbinMode.detect(e, getType)).toBe(false)
	})

	it.each(["x", "y"] as const)("false when %s is unmapped", (ch) => {
		const e = { ...hexEncodings(), [ch]: { field: null } }
		expect(HexbinMode.detect(e, getType)).toBe(false)
	})

	it("false when an axis field is categorical", () => {
		const e = { ...hexEncodings(), x: { field: "cat" } }
		expect(HexbinMode.detect(e, getType)).toBe(false)
	})

	it("false without a type lookup (safe default)", () => {
		expect(HexbinMode.detect(hexEncodings())).toBe(false)
	})

	it("ROUTING: resolves to hexbin through the registry; falls back to scatter when gating is lost", () => {
		expect(getChartMode(hexEncodings(), getType)).toBe("hexbin")
		const lost = { ...hexEncodings(), y: { field: null } }
		expect(getChartMode(lost, getType)).toBe("scatter")
	})
})
