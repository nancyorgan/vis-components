import { describe, expect, it } from "vitest"

import { resolveAxisTitleText } from "./resolveAxisTitleText"

describe("resolveAxisTitleText", () => {
	it("returns empty string when suppressed, regardless of other inputs", () => {
		expect(
			resolveAxisTitleText({
				suppressed: true,
				explicitTitle: "Explicit title",
				fallback: "fallback",
			})
		).toBe("")
	})

	it("returns the explicit title when one is provided (and not suppressed)", () => {
		expect(
			resolveAxisTitleText({
				suppressed: false,
				explicitTitle: "User title",
				fallback: "field_name",
			})
		).toBe("User title")
	})

	it("falls back to `fallback` when explicit title is empty string", () => {
		expect(
			resolveAxisTitleText({
				suppressed: false,
				explicitTitle: "",
				fallback: "field_name",
			})
		).toBe("field_name")
	})

	it("falls back to `fallback` when explicit title is null", () => {
		expect(
			resolveAxisTitleText({
				suppressed: false,
				explicitTitle: null,
				fallback: "field_name",
			})
		).toBe("field_name")
	})

	it("falls back to `fallback` when explicit title is undefined", () => {
		expect(
			resolveAxisTitleText({
				suppressed: false,
				explicitTitle: undefined,
				fallback: "field_name",
			})
		).toBe("field_name")
	})

	it("returns empty string when both explicit and fallback are empty (no field mapped)", () => {
		expect(
			resolveAxisTitleText({
				suppressed: false,
				explicitTitle: "",
				fallback: "",
			})
		).toBe("")
	})

	it("explicit title with only whitespace is treated as falsy via JS truthiness", () => {
		// JS truthiness: " " is truthy. Document the behavior so future
		// adjustments (e.g., trim before falling through) are deliberate.
		expect(
			resolveAxisTitleText({
				suppressed: false,
				explicitTitle: " ",
				fallback: "field_name",
			})
		).toBe(" ")
	})
})
