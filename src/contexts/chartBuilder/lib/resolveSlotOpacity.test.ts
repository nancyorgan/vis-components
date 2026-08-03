import { describe, expect, it } from "vitest"

import { resolveSlotOpacity } from "./resolveLayerColor"

const row = { g: "a", q: 10 }

describe("resolveSlotOpacity", () => {
	it("returns the slot level when no field is mapped", () => {
		expect(resolveSlotOpacity(null, { field: null, level: 0.4 }, row, 1)).toBe(0.4)
	})

	it("returns the fallback when slot config is absent", () => {
		expect(resolveSlotOpacity(null, undefined, row, 0.6)).toBe(0.6)
	})

	it("resolves through the scale when a field is mapped", () => {
		const slot = {
			scale: ((v: unknown) => (v === "a" ? 0.3 : 0.9)) as never,
			field: { name: "g", type: "categorical" as const },
		}
		expect(resolveSlotOpacity(slot, { field: "g", level: 1 }, row, 1)).toBe(0.3)
	})

	it("falls back to level when the scale returns null", () => {
		const slot = {
			scale: (() => null) as never,
			field: { name: "g", type: "categorical" as const },
		}
		expect(resolveSlotOpacity(slot, { field: "g", level: 0.5 }, row, 1)).toBe(0.5)
	})
})
