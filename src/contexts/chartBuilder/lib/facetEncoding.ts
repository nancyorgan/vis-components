import type { Encodings } from "./types"

/** The Facet shelf row's two shapes over the three stored facet channels.
 *
 *  The sidebar shows ONE "Facet" encoding. Its dropdown lists the fields
 *  plus a "Two variables…" entry; picking a field maps the wrap channel
 *  (`facet`, titles above each panel, a user-set rows × columns layout),
 *  picking "Two variables…" opens a Rows picker and a Columns picker that
 *  map `facetRow` / `facetCol` (a data-determined grid with row and column
 *  strips). The stored shape is unchanged — every saved visual, template,
 *  example and chart spec keeps its `facet` / `facetRow` / `facetCol`
 *  keys — so these helpers are the only place the row's exclusivity rule
 *  lives: the wrap channel and the pair never coexist, and the renderer
 *  (`resolveFacetPanels`) never has to arbitrate. */

/** Sentinel option value for the Facet dropdown's "Two variables…" choice.
 *  Distinct from any field name and from "" (— none —). */
export const FACET_PAIR_OPTION_VALUE = "__facet_pair__"

/** Whether either side of the row / column pair is mapped — the row then
 *  shows the two pickers (a half-filled pair is a row-only or column-only
 *  grid, strip included, while the user picks the second variable). */
export const facetPairMapped = (
	encodings: Pick<Encodings, "facetRow" | "facetCol">
): boolean => !!encodings.facetRow?.field || !!encodings.facetCol?.field

/** One variable (or none) on the wrap channel; the pair is cleared. */
export const withSingleFacet = (
	encodings: Encodings,
	field: string | null
): Encodings => ({
	...encodings,
	facet: { field },
	facetRow: { field: null },
	facetCol: { field: null },
})

/** Enter the pair: a mapped wrap variable moves to Rows so the chart
 *  keeps its panels (stacked, now with a row strip) while Columns waits
 *  for a pick. Already in the pair → unchanged. */
export const withFacetPairEntered = (encodings: Encodings): Encodings => {
	if (facetPairMapped(encodings)) return encodings
	const field = encodings.facet?.field ?? null
	return {
		...encodings,
		facet: { field: null },
		facetRow: { field },
		facetCol: { field: null },
	}
}

/** Set one side of the pair. The wrap channel is cleared; picking the
 *  field the other side holds moves it (one variable can't be both). */
export const withFacetPairSide = (
	encodings: Encodings,
	side: "row" | "col",
	field: string | null
): Encodings => {
	const own = side === "row" ? "facetRow" : "facetCol"
	const other = side === "row" ? "facetCol" : "facetRow"
	const otherField = encodings[other]?.field ?? null
	return {
		...encodings,
		facet: { field: null },
		[own]: { field },
		[other]: { field: field !== null && otherField === field ? null : otherField },
	}
}
