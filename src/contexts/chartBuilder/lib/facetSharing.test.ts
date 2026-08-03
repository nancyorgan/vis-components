import { describe, expect, it } from "vitest"

import { shouldShareCategoryRowsForBarMode } from "./facetSharing"

/** This rule is a 3-input boolean that's easy to silently regress —
 *  the previous bug was `shareX || shareY`, which fired even when the
 *  user only wanted the measure axis shared. The fix maps each chart
 *  mode to the "is the category axis shared?" question. These tests
 *  pin the per-mode mapping. */
describe("shouldShareCategoryRowsForBarMode", () => {
	describe("vertical orientations (category on X)", () => {
		it("bars-x: shares categories when shareX is on, NOT when only shareY is on", () => {
			expect(shouldShareCategoryRowsForBarMode("bars-x", true, false)).toBe(
				true
			)
			expect(shouldShareCategoryRowsForBarMode("bars-x", false, true)).toBe(
				false
			) // <-- the bug we caught
			expect(shouldShareCategoryRowsForBarMode("bars-x", true, true)).toBe(true)
			expect(shouldShareCategoryRowsForBarMode("bars-x", false, false)).toBe(
				false
			)
		})

		it("areas-x: same precedence as bars-x", () => {
			expect(shouldShareCategoryRowsForBarMode("areas-x", true, false)).toBe(
				true
			)
			expect(shouldShareCategoryRowsForBarMode("areas-x", false, true)).toBe(
				false
			)
		})
	})

	describe("horizontal orientations (category on Y)", () => {
		it("bars-y: shares categories when shareY is on, NOT when only shareX is on", () => {
			expect(shouldShareCategoryRowsForBarMode("bars-y", false, true)).toBe(
				true
			)
			expect(shouldShareCategoryRowsForBarMode("bars-y", true, false)).toBe(
				false
			)
			expect(shouldShareCategoryRowsForBarMode("bars-y", true, true)).toBe(true)
		})

		it("areas-y: same precedence as bars-y", () => {
			expect(shouldShareCategoryRowsForBarMode("areas-y", false, true)).toBe(
				true
			)
			expect(shouldShareCategoryRowsForBarMode("areas-y", true, false)).toBe(
				false
			)
		})
	})

	describe("non-bar / non-area modes", () => {
		it("scatter / pies / tile fall back to false (per-axis rows handle them)", () => {
			expect(shouldShareCategoryRowsForBarMode("scatter", true, true)).toBe(
				false
			)
			expect(shouldShareCategoryRowsForBarMode("pies", true, true)).toBe(false)
			expect(shouldShareCategoryRowsForBarMode("tile", true, true)).toBe(false)
		})
	})
})
