import { describe, expect, it } from "vitest"

import { splitPolylineAtRange, type DashRangePoint } from "./dashRange"

const pts = (...coords: Array<[number, number]>): DashRangePoint[] =>
	coords.map(([x, y]) => ({ x, y }))

describe("splitPolylineAtRange", () => {
	it("splits an ascending line at both boundaries with interpolated cuts", () => {
		const line = pts([0, 0], [10, 10])
		const { before, inside, after } = splitPolylineAtRange(line, 3, 7, "x")
		expect(before).toEqual(pts([0, 0], [3, 3]))
		expect(inside).toEqual(pts([3, 3], [7, 7]))
		expect(after).toEqual(pts([7, 7], [10, 10]))
	})

	it("null min is unbounded low; null max unbounded high", () => {
		const line = pts([0, 0], [10, 0])
		const fromFive = splitPolylineAtRange(line, 5, null, "x")
		expect(fromFive.before).toEqual(pts([0, 0], [5, 0]))
		expect(fromFive.inside).toEqual(pts([5, 0], [10, 0]))
		expect(fromFive.after).toEqual([])
		const toFive = splitPolylineAtRange(line, null, 5, "x")
		expect(toFive.before).toEqual([])
		expect(toFive.inside).toEqual(pts([0, 0], [5, 0]))
		expect(toFive.after).toEqual(pts([5, 0], [10, 0]))
	})

	it("both boundaries null puts everything inside", () => {
		const line = pts([0, 0], [10, 5])
		const r = splitPolylineAtRange(line, null, null, "x")
		expect(r.inside).toEqual(line)
		expect(r.before).toEqual([])
		expect(r.after).toEqual([])
	})

	it("swaps reversed boundaries", () => {
		const line = pts([0, 0], [10, 0])
		const r = splitPolylineAtRange(line, 7, 3, "x")
		expect(r.inside).toEqual(pts([3, 0], [7, 0]))
	})

	it("line entirely inside / outside the window", () => {
		const line = pts([4, 0], [6, 0])
		const insideAll = splitPolylineAtRange(line, 0, 10, "x")
		expect(insideAll.inside).toEqual(line)
		expect(insideAll.before).toEqual([])
		const beforeAll = splitPolylineAtRange(line, 20, 30, "x")
		expect(beforeAll.before).toEqual(line)
		expect(beforeAll.inside).toEqual([])
	})

	it("a point exactly on a boundary is shared by both segments", () => {
		// The middle point lands exactly at min=5 — no interpolation needed;
		// it must still terminate `before` AND start `inside`.
		const line = pts([0, 0], [5, 2], [10, 4])
		const r = splitPolylineAtRange(line, 5, null, "x")
		expect(r.before).toEqual(pts([0, 0], [5, 2]))
		expect(r.inside).toEqual(pts([5, 2], [10, 4]))
	})

	it("handles a span that jumps across the whole window", () => {
		const line = pts([0, 0], [10, 10])
		const r = splitPolylineAtRange(line, 4, 6, "x")
		expect(r.before).toEqual(pts([0, 0], [4, 4]))
		expect(r.inside).toEqual(pts([4, 4], [6, 6]))
		expect(r.after).toEqual(pts([6, 6], [10, 10]))
	})

	it("handles descending order (areas-y walk down the pixel axis)", () => {
		const line = pts([0, 10], [0, 0])
		const r = splitPolylineAtRange(line, 3, 7, "y")
		expect(r.after).toEqual(pts([0, 10], [0, 7]))
		expect(r.inside).toEqual(pts([0, 7], [0, 3]))
		expect(r.before).toEqual(pts([0, 3], [0, 0]))
	})

	it("splits along y when axis is y", () => {
		const line = pts([0, 0], [10, 10])
		const r = splitPolylineAtRange(line, 5, null, "y")
		expect(r.before).toEqual(pts([0, 0], [5, 5]))
		expect(r.inside).toEqual(pts([5, 5], [10, 10]))
	})

	it("multi-point polylines interpolate within the straddling span only", () => {
		const line = pts([0, 0], [2, 4], [8, 4], [10, 0])
		const r = splitPolylineAtRange(line, 5, null, "x")
		expect(r.before).toEqual(pts([0, 0], [2, 4], [5, 4]))
		expect(r.inside).toEqual(pts([5, 4], [8, 4], [10, 0]))
	})

	it("degenerate inputs draw nothing", () => {
		expect(splitPolylineAtRange([], 3, 7, "x")).toEqual({
			before: [],
			inside: [],
			after: [],
		})
		expect(splitPolylineAtRange(pts([5, 5]), 3, 7, "x")).toEqual({
			before: [],
			inside: [],
			after: [],
		})
	})

	it("vertical spans (equal axis coordinate) stay in one segment", () => {
		// Two marks can share an x (sorted-by-cx ties); the zero-length-along-
		// axis span classifies by its midpoint and must not crash or duplicate.
		const line = pts([5, 0], [5, 10], [9, 10])
		const r = splitPolylineAtRange(line, 5, null, "x")
		expect(r.inside).toEqual(pts([5, 0], [5, 10], [9, 10]))
		expect(r.before).toEqual([])
	})
})
