import { describe, expect, it } from "vitest"
import { DEFAULT_DISTRIBUTION_OVERLAY_CONFIG } from "../../../lib/channelConfig"
import { applyJitter, type StripAxes } from "./strip"
import type { Mark } from "./types"

const mark = (i: number, cx: number, cy: number): Mark => ({
	i,
	cx,
	cy,
	r: 3,
	fill: "#000",
	shapeFill: "#000",
	shapeStroke: "#000",
	glyph: null,
	line: null,
	patternId: null,
	segmentPattern: null,
	markOpacity: 1,
	rotation: null,
	row: {},
})

const strip = (overrides: Partial<StripAxes>): StripAxes => {
	const categoryScale = Object.assign((cat: unknown) => Number(cat), {
		step: () => 40,
	})
	return {
		categoryAxis: "x",
		categoryField: "cat",
		valueField: "val",
		valueType: "quantitative",
		categoryScale,
		valueScale: ((v: number) => v) as unknown as StripAxes["valueScale"],
		jitterAmount: 0.5,
		jitterOverlappingOnly: false,
		overlay: DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
		...overrides,
	}
}

describe("applyJitter", () => {
	// Two points stacked at (100, 10), one alone at (100, 20), one alone in
	// the next band at (140, 10).
	const marks = [
		mark(0, 100, 10),
		mark(1, 100, 10),
		mark(2, 100, 20),
		mark(3, 140, 10),
	]

	it("jitters every point by default", () => {
		const out = applyJitter(marks, strip({}))
		expect(out.every((m, k) => m.cx !== marks[k]!.cx)).toBe(true)
		// Only the categorical axis moves.
		expect(out.map((m) => m.cy)).toEqual([10, 10, 20, 10])
	})

	it("with 'only overlapping', moves stacked points and leaves lone points", () => {
		const out = applyJitter(marks, strip({ jitterOverlappingOnly: true }))
		expect(out[0]!.cx).not.toBe(100)
		expect(out[1]!.cx).not.toBe(100)
		// The two stacked points go to OPPOSITE sides of the center.
		expect(Math.sign(out[0]!.cx - 100)).toBe(-Math.sign(out[1]!.cx - 100))
		expect(out[2]).toBe(marks[2])
		expect(out[3]).toBe(marks[3])
	})

	it("splits a stack evenly between the two sides, at distinct distances", () => {
		const stack = [0, 1, 2, 3, 4].map((i) => mark(i, 100, 10))
		const max = 40 * 0.5 * 0.5 // step · ½ · jitterAmount
		const deltas = applyJitter(stack, strip({ jitterOverlappingOnly: true })).map(
			(m) => m.cx - 100
		)
		const up = deltas.filter((d) => d > 0).length
		const down = deltas.filter((d) => d < 0).length
		expect([up, down].sort()).toEqual([2, 3])
		// Every point moves, none past the max offset, no two alike.
		expect(deltas.every((d) => d !== 0 && Math.abs(d) <= max)).toBe(true)
		expect(new Set(deltas).size).toBe(5)
		// A pair of stacked points also lands one each way.
		const pair = applyJitter(stack.slice(0, 2), strip({ jitterOverlappingOnly: true }))
		expect(Math.sign(pair[0]!.cx - 100)).toBe(-Math.sign(pair[1]!.cx - 100))
	})

	it("'only overlapping' spreads each stack independently", () => {
		const two = [mark(0, 100, 10), mark(1, 100, 10), mark(2, 140, 10), mark(3, 140, 10)]
		const out = applyJitter(two, strip({ jitterOverlappingOnly: true }))
		expect(Math.sign(out[0]!.cx - 100)).toBe(-Math.sign(out[1]!.cx - 100))
		expect(Math.sign(out[2]!.cx - 140)).toBe(-Math.sign(out[3]!.cx - 140))
	})

	it("'only overlapping' needs the SAME position on both axes", () => {
		// Same band, different values: not overlapping.
		const out = applyJitter(
			[mark(0, 100, 10), mark(1, 100, 10.0001)],
			strip({ jitterOverlappingOnly: true })
		)
		expect(out[0]!.cx).toBe(100)
		expect(out[1]!.cx).toBe(100)
	})

	it("stays off at jitter 0 regardless of the checkbox", () => {
		const out = applyJitter(
			marks,
			strip({ jitterAmount: 0, jitterOverlappingOnly: true })
		)
		expect(out).toBe(marks)
	})
})
