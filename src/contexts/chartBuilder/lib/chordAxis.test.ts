import { describe, expect, it } from "vitest"

import {
	chordAxisStep,
	chordAxisTicks,
	chordTickFormatter,
	type ChordGroupAngles,
} from "./chordAxis"

const group = (
	startAngle: number,
	endAngle: number,
	value: number
): ChordGroupAngles => ({ startAngle, endAngle, value })

const plain = (v: number) => String(v)

describe("chordAxisStep", () => {
	it("derives a nice step targeting the tick count over the total", () => {
		// tickStep(0, 10_000, 100) = 100 — a round graduation.
		expect(chordAxisStep(10_000, 100)).toBe(100)
		// Fewer ticks → coarser round step.
		expect(chordAxisStep(10_000, 10)).toBe(1000)
	})

	it("returns null when there is nothing to tick", () => {
		expect(chordAxisStep(0, 100)).toBeNull()
		expect(chordAxisStep(-5, 100)).toBeNull()
		expect(chordAxisStep(Number.NaN, 100)).toBeNull()
		expect(chordAxisStep(10_000, 0)).toBeNull()
	})
})

describe("chordAxisTicks", () => {
	it("places graduations every step from the group's start angle", () => {
		const g = group(0, Math.PI, 100)
		const ticks = chordAxisTicks(g, 25, 1, plain)
		expect(ticks.map((t) => t.value)).toEqual([0, 25, 50, 75])
		// Angle is proportional: value * (sweep / total).
		expect(ticks[1].angle).toBeCloseTo((25 / 100) * Math.PI)
		expect(ticks[3].angle).toBeCloseTo((75 / 100) * Math.PI)
		// labelEvery = 1 labels every tick.
		expect(ticks.every((t) => t.label !== null)).toBe(true)
	})

	it("labels every Nth tick by index (fractional steps included)", () => {
		const g = group(0, 1, 1)
		const ticks = chordAxisTicks(g, 0.1, 5, plain)
		const labeled = ticks.filter((t) => t.label !== null).map((t) => t.value)
		// Index-based selection: 0th and 5th ticks. (Value-modulo would drop
		// 0.5 to float error — that's why selection is by index.)
		expect(labeled).toHaveLength(2)
		expect(labeled[0]).toBe(0)
		expect(labeled[1]).toBeCloseTo(0.5)
	})

	it("returns no ticks for empty or degenerate groups", () => {
		expect(chordAxisTicks(group(0, 1, 0), 10, 5, plain)).toEqual([])
		expect(chordAxisTicks(group(0, 1, 100), 0, 5, plain)).toEqual([])
		expect(chordAxisTicks(group(0, 1, 100), -1, 5, plain)).toEqual([])
	})

	it("caps runaway tick counts from a hand-typed tiny step", () => {
		const ticks = chordAxisTicks(group(0, 2, 1_000_000), 0.001, 5, plain)
		// Would be a billion ticks at the requested step; the cap re-derives
		// the step so the group stays renderable.
		expect(ticks.length).toBeLessThanOrEqual(201)
		expect(ticks.length).toBeGreaterThan(0)
	})
})

describe("chordTickFormatter", () => {
	it("uses an SI-prefixed auto format calibrated to the step", () => {
		const fmt = chordTickFormatter("", 1000)
		expect(fmt(5000)).toBe("5k")
		expect(fmt(0)).toBe("0k")
	})

	it("uses fixed decimals for fractional steps (no milli-prefix)", () => {
		const fmt = chordTickFormatter("", 0.2)
		expect(fmt(0.4)).toBe("0.4")
		expect(fmt(1)).toBe("1.0")
	})

	it("honors a custom d3-format spec", () => {
		const fmt = chordTickFormatter(",.1f", 1000)
		expect(fmt(5000)).toBe("5,000.0")
	})
})
