import { describe, expect, it } from "vitest"

import { splitLoopAtRange, type LoopPoint } from "./dashLoopRange"

/** A square whose corners sit at `at` = 0, 1, 2, 3 around the loop. */
const SQUARE: LoopPoint[] = [
	{ x: 0, y: 0, at: 0 },
	{ x: 10, y: 0, at: 1 },
	{ x: 10, y: 10, at: 2 },
	{ x: 0, y: 10, at: 3 },
]
const P = (i: number) => ({ x: SQUARE[i]?.x ?? NaN, y: SQUARE[i]?.y ?? NaN })

describe("splitLoopAtRange", () => {
	it("dashes the edges between the spokes inside the window and leaves the rest solid", () => {
		const runs = splitLoopAtRange(SQUARE, 1, 2)
		expect(runs.closed).toBe(false)
		expect(runs.inside).toEqual([[P(1), P(2)]])
		// The solid part runs on round the loop: 2 → 3 → 0 → 1.
		expect(runs.outside).toEqual([[P(2), P(3), P(0), P(1)]])
	})

	it("an open-ended window runs to the last spoke, and the wrap-around stays solid", () => {
		const runs = splitLoopAtRange(SQUARE, 2, null)
		expect(runs.inside).toEqual([[P(2), P(3)]])
		expect(runs.outside).toEqual([[P(3), P(0), P(1), P(2)]])
		const fromStart = splitLoopAtRange(SQUARE, null, 1)
		expect(fromStart.inside).toEqual([[P(0), P(1)]])
		expect(fromStart.outside).toEqual([[P(1), P(2), P(3), P(0)]])
	})

	it("a window holding every spoke dashes the whole outline, closed", () => {
		const runs = splitLoopAtRange(SQUARE, 0, 3)
		expect(runs).toEqual({
			inside: [[P(0), P(1), P(2), P(3), P(0)]],
			outside: [],
			closed: true,
		})
	})

	it("a window holding no edge leaves the whole outline solid, closed", () => {
		// One spoke alone has no edge inside it.
		expect(splitLoopAtRange(SQUARE, 1, 1)).toEqual({
			inside: [],
			outside: [[P(0), P(1), P(2), P(3), P(0)]],
			closed: true,
		})
		expect(splitLoopAtRange(SQUARE, 7, 9).inside).toEqual([])
	})

	it("swaps reversed bounds", () => {
		expect(splitLoopAtRange(SQUARE, 2, 1)).toEqual(splitLoopAtRange(SQUARE, 1, 2))
	})

	it("every edge lands in exactly one run", () => {
		for (const [lo, hi] of [
			[0, 1],
			[1, 3],
			[null, 2],
			[3, null],
			[0, 3],
			[5, 6],
		] as Array<[number | null, number | null]>) {
			const { inside, outside } = splitLoopAtRange(SQUARE, lo, hi)
			const edges = [...inside, ...outside].reduce((n, run) => n + run.length - 1, 0)
			expect(edges, `${lo}..${hi}`).toBe(SQUARE.length)
		}
	})

	it("needs at least two points", () => {
		expect(splitLoopAtRange([], 0, 1)).toEqual({ inside: [], outside: [], closed: false })
		expect(splitLoopAtRange(SQUARE.slice(0, 1), 0, 1).inside).toEqual([])
	})
})
