import { describe, expect, it } from "vitest"

import { nameCollides, normalizeName } from "./nameUniqueness"

describe("normalizeName", () => {
	it("trims surrounding whitespace", () => {
		expect(normalizeName("  foo  ")).toBe("foo")
	})

	it("lowercases", () => {
		expect(normalizeName("Kinds Of Cats")).toBe("kinds of cats")
	})

	it("combines trim and lowercase", () => {
		expect(normalizeName("  Kinds Of Cats ")).toBe("kinds of cats")
	})

	it("is identity on the empty string", () => {
		expect(normalizeName("")).toBe("")
		expect(normalizeName("   ")).toBe("")
	})
})

describe("nameCollides", () => {
	const records = [
		{ id: "a", name: "Kinds of Cats" },
		{ id: "b", name: "Kinds of Dogs" },
		{ id: "c", name: "Kinds of Birds" },
	]

	it("returns true on an exact match (different id)", () => {
		expect(nameCollides("Kinds of Dogs", records)).toBe(true)
	})

	it("is case-insensitive", () => {
		expect(nameCollides("kinds of dogs", records)).toBe(true)
		expect(nameCollides("KINDS OF DOGS", records)).toBe(true)
	})

	it("ignores surrounding whitespace", () => {
		expect(nameCollides("  Kinds of Dogs  ", records)).toBe(true)
	})

	it("returns false for a unique name", () => {
		expect(nameCollides("Kinds of Fish", records)).toBe(false)
	})

	it("ignores the record identified by excludeId (rename-yourself case)", () => {
		// Renaming record 'b' from "Kinds of Dogs" to ... "Kinds of Dogs" (no
		// change) shouldn't collide with itself.
		expect(nameCollides("Kinds of Dogs", records, "b")).toBe(false)
	})

	it("still catches collisions with OTHER records even when excludeId is passed", () => {
		// Renaming record 'b' to "Kinds of Cats" should collide with record 'a'.
		expect(nameCollides("Kinds of Cats", records, "b")).toBe(true)
	})

	it("treats empty / whitespace-only names as never-colliding", () => {
		expect(nameCollides("", records)).toBe(false)
		expect(nameCollides("   ", records)).toBe(false)
	})

	it("returns false against an empty record list", () => {
		expect(nameCollides("anything", [])).toBe(false)
	})
})
