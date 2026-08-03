import { describe, expect, it } from "vitest"

import { buildExtraMargin } from "./buildExtraMargin"

const zeroDL = { top: 0, right: 0, bottom: 0, left: 0 }

describe("buildExtraMargin", () => {
	it("returns the chart's own estimate when nothing else contributes", () => {
		const result = buildExtraMargin({
			estimate: { left: 24, bottom: 12 },
			floor: {},
			dataLabel: zeroDL,
		})
		expect(result.left).toBe(24)
		expect(result.bottom).toBe(12)
		expect(result.top).toBe(0)
		expect(result.right).toBe(0)
	})

	it("takes the floor when it exceeds the chart's own estimate", () => {
		const result = buildExtraMargin({
			estimate: { left: 10, bottom: 5 },
			floor: { left: 30, bottom: 18 },
			dataLabel: zeroDL,
		})
		expect(result.left).toBe(30)
		expect(result.bottom).toBe(18)
	})

	it("keeps the chart's own estimate when it exceeds the floor", () => {
		const result = buildExtraMargin({
			estimate: { left: 40, bottom: 25 },
			floor: { left: 10, bottom: 5 },
			dataLabel: zeroDL,
		})
		expect(result.left).toBe(40)
		expect(result.bottom).toBe(25)
	})

	it("takes the data-label margin when it exceeds both estimate and floor", () => {
		const result = buildExtraMargin({
			estimate: { left: 5, bottom: 5 },
			floor: { left: 10, bottom: 10 },
			dataLabel: { top: 7, right: 8, bottom: 20, left: 35 },
		})
		expect(result.left).toBe(35)
		expect(result.bottom).toBe(20)
		// Top/right are exactly the data-label values (no other source).
		expect(result.top).toBe(7)
		expect(result.right).toBe(8)
	})

	it("treats missing floor entries as 0 (per-side optional)", () => {
		const result = buildExtraMargin({
			estimate: { left: 5, bottom: 5 },
			floor: {}, // both undefined
			dataLabel: zeroDL,
		})
		expect(result.left).toBe(5)
		expect(result.bottom).toBe(5)
	})

	it("propagates top/right from dataLabel unchanged (no estimate/floor input there)", () => {
		const result = buildExtraMargin({
			estimate: { left: 100, bottom: 100 },
			floor: { left: 100, bottom: 100 },
			dataLabel: { top: 4, right: 6, bottom: 0, left: 0 },
		})
		expect(result.top).toBe(4)
		expect(result.right).toBe(6)
	})
})
