import { describe, expect, it } from "vitest"

import { buildLinePath } from "./linePath"

const PTS = [
	{ x: 0, y: 0 },
	{ x: 10, y: 20 },
	{ x: 20, y: 5 },
	{ x: 30, y: 25 },
]

describe("buildLinePath", () => {
	it("returns an empty string for fewer than two points", () => {
		expect(buildLinePath([], 0.5)).toBe("")
		expect(buildLinePath([{ x: 1, y: 2 }], 0.5)).toBe("")
	})

	it("starts at the first point and ends at the last point", () => {
		const d = buildLinePath(PTS, 0.8)
		expect(d.startsWith("M0,0")).toBe(true)
		expect(d.trimEnd().endsWith("30,25")).toBe(true)
	})

	it("uses a cardinal spline whose corners round with the amount", () => {
		// The cardinal generator always emits cubic (C) commands; at smoothing 0
		// the control points collapse to the endpoints so it renders straight,
		// and at higher amounts the control points pull away — a different path.
		const straight = buildLinePath(PTS, 0)
		const smooth = buildLinePath(PTS, 0.6)
		expect(straight).toMatch(/C/)
		expect(smooth).toMatch(/C/)
		expect(smooth).not.toEqual(straight)
	})

	it("clamps the amount into [0, 1] without throwing", () => {
		// Above 1 clamps to the smoothest curve (tension 0).
		expect(buildLinePath(PTS, 5)).toEqual(buildLinePath(PTS, 1))
		// Below 0 clamps to straight (tension 1).
		expect(buildLinePath(PTS, -3)).toEqual(buildLinePath(PTS, 0))
	})
})
