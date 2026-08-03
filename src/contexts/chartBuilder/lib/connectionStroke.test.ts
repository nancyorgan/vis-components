import { scaleOrdinal } from "d3-scale"
import { describe, expect, it } from "vitest"

import { resolveConnectionStroke } from "./connectionStroke"

/** Baseline args: nothing configured, so the chain lands on `fallback`.
 *  Each test overrides only the link(s) it exercises. */
const baseArgs = {
	groupKey: "A" as string | null,
	lineColors: {} as Record<string, string>,
	linePalette: null as readonly string[] | null,
	paletteIdx: 0,
	strokeColor: null as string | null,
	fallback: "#fa11ba",
	lineSlotCfg: undefined,
	lineSlot: null,
	slotRow: {},
}

describe("resolveConnectionStroke", () => {
	it("falls all the way through to the fallback when nothing is configured", () => {
		expect(resolveConnectionStroke(baseArgs)).toBe("#fa11ba")
	})

	it("per-value lineColors override beats palette, strokeColor, and fallback", () => {
		expect(
			resolveConnectionStroke({
				...baseArgs,
				lineColors: { A: "#111111" },
				linePalette: ["#222222"],
				strokeColor: "#333333",
			})
		).toBe("#111111")
	})

	it("line palette beats strokeColor and fallback, and wraps by paletteIdx", () => {
		const args = {
			...baseArgs,
			linePalette: ["#aa0000", "#00aa00"],
			strokeColor: "#333333",
		}
		expect(resolveConnectionStroke({ ...args, paletteIdx: 1 })).toBe("#00aa00")
		// Modulo wrap: idx 2 → palette[0].
		expect(resolveConnectionStroke({ ...args, paletteIdx: 2 })).toBe("#aa0000")
	})

	it("empty line palette is skipped (falls to strokeColor)", () => {
		expect(
			resolveConnectionStroke({
				...baseArgs,
				linePalette: [],
				strokeColor: "#333333",
			})
		).toBe("#333333")
	})

	it("global strokeColor beats the fallback", () => {
		expect(
			resolveConnectionStroke({ ...baseArgs, strokeColor: "#333333" })
		).toBe("#333333")
	})

	it("null groupKey skips the per-value override lookup", () => {
		expect(
			resolveConnectionStroke({
				...baseArgs,
				groupKey: null,
				lineColors: { A: "#111111" },
			})
		).toBe("#fa11ba")
	})

	it("a configured line slot owns the stroke: single-color mode wins over the legacy chain", () => {
		expect(
			resolveConnectionStroke({
				...baseArgs,
				lineColors: { A: "#111111" },
				lineSlotCfg: { field: null, singleColor: "#5510ca" },
			})
		).toBe("#5510ca")
	})

	it("a field-mapped line slot resolves per slotRow, falling back to the legacy chain on a miss", () => {
		const lineSlot = {
			field: { name: "grp", type: "categorical" as const },
			scale: {
				kind: "categorical" as const,
				scale: scaleOrdinal<string, string>()
					.domain(["A", "B"])
					.range(["#0000aa", "#0000bb"]),
			},
		}
		const cfg = { field: "grp", singleColor: "#5510ca" }
		expect(
			resolveConnectionStroke({
				...baseArgs,
				lineColors: { A: "#111111" },
				lineSlotCfg: cfg,
				lineSlot,
				slotRow: { grp: "B" },
			})
		).toBe("#0000bb")
		// Slot maps a field but the row value doesn't resolve → the slot's
		// single color, then (if unset) the legacy chain. resolveSlotColor
		// prefers singleColor over the legacy fallback.
		expect(
			resolveConnectionStroke({
				...baseArgs,
				lineColors: { A: "#111111" },
				lineSlotCfg: cfg,
				lineSlot,
				slotRow: {},
			})
		).toBe("#5510ca")
	})
})
