import { describe, expect, it, vi } from "vitest"

import { kindPredicate, parseLibraryKind } from "./libraryKind"

// routes.tsx builds a real route off the app's root; only its search
// validator is under test here, so stand the router and page in.
vi.mock("../../../routes/router", () => ({
	rootRoute: {},
	createRoute: (opts: unknown) => opts,
}))
vi.mock("../components/LibraryPage", () => ({ LibraryPage: () => null }))

const TEMPLATE = { template: { sourceFields: [], formatMemory: {} } }
const VISUAL = {}

describe("parseLibraryKind", () => {
	it("accepts templates and data, nothing else", () => {
		expect(parseLibraryKind("templates")).toBe("templates")
		expect(parseLibraryKind("data")).toBe("data")
		// The old third option (visuals and templates together) is gone.
		expect(parseLibraryKind("all")).toBeUndefined()
		expect(parseLibraryKind("visuals")).toBeUndefined()
		expect(parseLibraryKind("")).toBeUndefined()
		expect(parseLibraryKind(undefined)).toBeUndefined()
		expect(parseLibraryKind(3)).toBeUndefined()
	})
})

describe("kindPredicate", () => {
	it("absent shows ordinary visuals only", () => {
		const p = kindPredicate(undefined)
		expect(p(VISUAL)).toBe(true)
		expect(p(TEMPLATE)).toBe(false)
	})
	it("templates shows templates only", () => {
		const p = kindPredicate("templates")
		expect(p(VISUAL)).toBe(false)
		expect(p(TEMPLATE)).toBe(true)
	})
})

describe("library route ?kind=", () => {
	it("keeps a valid kind and drops anything else", async () => {
		const { validateSearch } = await import("../routes")
		expect(validateSearch({ kind: "templates" })).toEqual({ kind: "templates" })
		expect(validateSearch({ kind: "data", sort: "size:desc" })).toEqual({
			kind: "data",
			sort: "size:desc",
		})
		expect(validateSearch({ kind: "all", view: "table" })).toEqual({
			view: "table",
		})
		expect(validateSearch({ kind: "visuals" })).toEqual({})
		expect(validateSearch({ kind: "bogus" })).toEqual({})
		expect(validateSearch({})).toEqual({})
	})
})
