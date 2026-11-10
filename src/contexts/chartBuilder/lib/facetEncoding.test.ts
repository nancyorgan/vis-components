import { describe, expect, it } from "vitest"
import {
	facetPairMapped,
	withFacetPairEntered,
	withFacetPairSide,
	withSingleFacet,
} from "./facetEncoding"
import { emptyEncodings, type Encodings } from "./types"

const enc = (over: Partial<Encodings>): Encodings => ({ ...emptyEncodings(), ...over })

describe("facetEncoding — the single Facet row over three stored channels", () => {
	it("a single variable maps the wrap channel and clears the pair", () => {
		const next = withSingleFacet(
			enc({ facetRow: { field: "a" }, facetCol: { field: "b" } }),
			"c"
		)
		expect(next.facet.field).toBe("c")
		expect(next.facetRow.field).toBeNull()
		expect(next.facetCol.field).toBeNull()
		expect(facetPairMapped(next)).toBe(false)
	})

	it("— none — clears all three", () => {
		const next = withSingleFacet(enc({ facet: { field: "a" } }), null)
		expect([next.facet.field, next.facetRow.field, next.facetCol.field]).toEqual([
			null,
			null,
			null,
		])
	})

	it("entering the pair moves the wrap variable to Rows", () => {
		const next = withFacetPairEntered(enc({ facet: { field: "a" } }))
		expect(next.facet.field).toBeNull()
		expect(next.facetRow.field).toBe("a")
		expect(next.facetCol.field).toBeNull()
		expect(facetPairMapped(next)).toBe(true)
	})

	it("entering the pair with nothing mapped leaves nothing mapped", () => {
		const next = withFacetPairEntered(emptyEncodings())
		expect(facetPairMapped(next)).toBe(false)
		expect(next.facet.field).toBeNull()
	})

	it("entering the pair when already in it changes nothing", () => {
		const before = enc({ facetRow: { field: "a" }, facetCol: { field: "b" } })
		expect(withFacetPairEntered(before)).toBe(before)
	})

	it("setting a side clears the wrap channel and keeps the other side", () => {
		const next = withFacetPairSide(enc({ facet: { field: "a" } }), "col", "b")
		expect(next.facet.field).toBeNull()
		expect(next.facetCol.field).toBe("b")
		expect(next.facetRow.field).toBeNull()
	})

	it("picking the other side's variable moves it rather than duplicating it", () => {
		const next = withFacetPairSide(
			enc({ facetRow: { field: "a" }, facetCol: { field: "b" } }),
			"col",
			"a"
		)
		expect(next.facetCol.field).toBe("a")
		expect(next.facetRow.field).toBeNull()
	})

	it("clearing a side leaves the other mapped", () => {
		const next = withFacetPairSide(
			enc({ facetRow: { field: "a" }, facetCol: { field: "b" } }),
			"row",
			null
		)
		expect(next.facetRow.field).toBeNull()
		expect(next.facetCol.field).toBe("b")
	})
})
