import { describe, expect, it } from "vitest"

import { nextAnnotationName } from "../../../lib/annotationsConfig"
import { nameSuggestion } from "./axisInfo"

describe("annotation default names", () => {
	it("fallback names are 1-based", () => {
		expect(nameSuggestion("Circle", 0)).toBe("Circle 1")
		expect(nameSuggestion("Circle", 2)).toBe("Circle 3")
	})

	it("new annotations iterate from the kind's count", () => {
		expect(nextAnnotationName("Line", [])).toBe("Line 1")
		expect(
			nextAnnotationName("Line", [{ name: "Line 1" }, { name: "Line 2" }])
		).toBe("Line 3")
	})

	it("skips a number a user-renamed sibling already holds", () => {
		// "Line 1" was removed; the survivor was renamed to "Line 2" by hand.
		expect(nextAnnotationName("Line", [{ name: "line 2" }])).toBe("Line 3")
	})
})
