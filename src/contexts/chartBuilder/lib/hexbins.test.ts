import { describe, expect, it } from "vitest"

import {
	DEFAULT_HEXBIN_BIN_COUNT,
	hexCornerOffsets,
	resolveHexbinCells,
} from "./hexbins"

describe("resolveHexbinCells", () => {
	it("identical points land in one cell; count and maxCount match", () => {
		const xs = [5, 5, 5, 5]
		const ys = [3, 3, 3, 3]
		const r = resolveHexbinCells(xs, ys, 20)
		expect(r).not.toBeNull()
		expect(r!.cells).toHaveLength(1)
		expect(r!.cells[0].count).toBe(4)
		expect(r!.maxCount).toBe(4)
	})

	it("counts sum to the number of parseable in-domain points", () => {
		const xs = [1, 2, 3, 4, 5, "oops", ""]
		const ys = [1, 2, 3, 4, 5, 6, 7]
		const r = resolveHexbinCells(xs, ys, 10)
		const total = r!.cells.reduce((s, c) => s + c.count, 0)
		expect(total).toBe(5) // the two unparseable-x rows are skipped
	})

	it("two far-apart clusters produce two cells", () => {
		const xs = [1, 1, 1, 9, 9]
		const ys = [1, 1, 1, 9, 9]
		const r = resolveHexbinCells(xs, ys, 20)
		expect(r!.cells).toHaveLength(2)
		expect(r!.maxCount).toBe(3)
	})

	it("hex radius fits binCount columns across the x span", () => {
		const r = resolveHexbinCells([0, 10], [0, 10], 20)
		// pointy-top hexes: horizontal center spacing = sqrt(3) * radius,
		// so binCount columns across [0,1] means radius = 1/(binCount*sqrt(3)).
		expect(r!.radius).toBeCloseTo(1 / (20 * Math.sqrt(3)))
	})

	it("user bounds crop: points outside the pinned domain are excluded", () => {
		const xs = [1, 2, 3, 100]
		const ys = [1, 2, 3, 1]
		const r = resolveHexbinCells(xs, ys, 10, { min: 0, max: 10 })
		const total = r!.cells.reduce((s, c) => s + c.count, 0)
		expect(total).toBe(3)
	})

	it("separate domain rows (shared facet axes) widen the grid without adding points", () => {
		const r = resolveHexbinCells([1, 1], [1, 1], 10, undefined, undefined, {
			domainXRaw: [0, 100],
			domainYRaw: [0, 100],
		})
		const total = r!.cells.reduce((s, c) => s + c.count, 0)
		expect(total).toBe(2)
		expect(r!.xDomain[1]).toBeGreaterThanOrEqual(100)
	})

	it("returns null when nothing is parseable", () => {
		expect(resolveHexbinCells(["a", ""], ["b", null], 10)).toBeNull()
	})

	it("degenerate domain (all points identical) does not crash", () => {
		const r = resolveHexbinCells([5, 5], [5, 5], 10)
		expect(r!.cells).toHaveLength(1)
		expect(r!.cells[0].count).toBe(2)
	})

	it("default bin count is 20", () => {
		expect(DEFAULT_HEXBIN_BIN_COUNT).toBe(20)
	})
})

describe("hexCornerOffsets", () => {
	it("returns 6 corners on the circumradius", () => {
		const corners = hexCornerOffsets(0.1)
		expect(corners).toHaveLength(6)
		for (const [dx, dy] of corners) {
			expect(Math.hypot(dx, dy)).toBeCloseTo(0.1)
		}
	})
})
