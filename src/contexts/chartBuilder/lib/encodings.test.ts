import { describe, expect, it } from "vitest"
import { emptyEncodings } from "./types"

describe("emptyEncodings", () => {
	it("includes facetRow and facetCol channels as null-mapped", () => {
		const e = emptyEncodings()
		expect(e.facetRow).toEqual({ field: null })
		expect(e.facetCol).toEqual({ field: null })
	})
})
