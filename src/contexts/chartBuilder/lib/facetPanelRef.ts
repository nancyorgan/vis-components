/** A SAVED reference to one facet panel — what a facet scope (`facetKeys`
 *  on annotations and data labels) lists.
 *
 *  Wrap mode's panel is one facet value, and the value itself is the
 *  reference. A grid panel is a row value AND a column value, carried as a
 *  pair so neither is ever joined to the other: a saved key built by
 *  joining user values (`row|col`) is ambiguous when a value contains the
 *  joiner, and reads as something it isn't to anything that inspects
 *  stored content (the hosting firewall flagged `__all__|Type of System`
 *  as a shell pipe). The unmapped side of a row-only / col-only grid holds
 *  the `FACET_PANEL_ALL` placeholder, the same one the in-memory panel key
 *  carries there.
 *
 *  The RENDERER keys panels by a string (`FacetPanels.values`: the facet
 *  value, or `row|col`); that key never leaves memory. `facetPanelKeyOf`
 *  maps a reference onto it, which is how scope checks match.
 *
 *  A plain string that looks like a grid key (`"a|x"`) is also what every
 *  grid scope saved before pairs existed holds. The string form still
 *  matches by key, so such a visual keeps rendering as it did; the load
 *  and save paths rewrite it to a pair (`lib/savedKeyStructure.ts`). */
export type FacetPanelRef = string | { row: string; col: string }

/** The placeholder on the unmapped side of a row-only / col-only grid, and
 *  the unfaceted chart's single panel key. */
export const FACET_PANEL_ALL = "__all__"

/** The in-memory panel key a reference stands for — the key
 *  `resolveFacetPanels` hands PlotCanvas for that panel. */
export const facetPanelKeyOf = (ref: FacetPanelRef): string =>
	typeof ref === "string" ? ref : `${ref.row}|${ref.col}`

/** Whether a reference names the panel with this key. */
export const facetPanelRefMatches = (
	ref: FacetPanelRef,
	panelKey: string
): boolean => facetPanelKeyOf(ref) === panelKey

/** Whether a scope list names the panel with this key. */
export const facetScopeIncludes = (
	refs: readonly FacetPanelRef[],
	panelKey: string
): boolean => refs.some((ref) => facetPanelRefMatches(ref, panelKey))

/** Two references to the same panel. */
export const sameFacetPanelRef = (a: FacetPanelRef, b: FacetPanelRef): boolean =>
	facetPanelKeyOf(a) === facetPanelKeyOf(b)

/** The chart's rendered grid panels, by in-memory key — what
 *  `structureFacetPanelRef` resolves a pre-pair string against when the
 *  data is at hand (the editor's save; never a storage migration, which
 *  has no data). */
export type KnownFacetPanels = ReadonlyMap<string, { row: string; col: string }>

/** A grid key saved before pairs existed (`row|col`), read back as a
 *  pair — only where the reading is certain:
 *
 *   - the string is the key of a KNOWN panel (`panels`, from the data):
 *     that panel's pair, whatever the values contain;
 *   - one side is the `FACET_PANEL_ALL` placeholder, which only a
 *     row-only / col-only grid key ever carries: the other side is the
 *     value, pipes and all;
 *   - `grid` (a facet row or column is mapped) and the string holds
 *     exactly one `|`: the only split there is.
 *
 *  Anything else stays as it is: a string with no pipe (a wrap value), a
 *  wrap value with a pipe in it, and a full-grid key with two or more
 *  pipes, which has several readings and gets none guessed — it still
 *  names its panel by key, and the next save from an editor that can see
 *  the panels resolves it. A pair passes through. */
export const structureFacetPanelRef = (
	ref: FacetPanelRef,
	grid: boolean,
	panels?: KnownFacetPanels
): FacetPanelRef => {
	if (typeof ref !== "string") return ref
	const known = panels?.get(ref)
	if (known) return { row: known.row, col: known.col }
	const first = ref.indexOf("|")
	if (first === -1) return ref
	const all = `${FACET_PANEL_ALL}|`
	if (ref.startsWith(all) && ref.length > all.length)
		return { row: FACET_PANEL_ALL, col: ref.slice(all.length) }
	const allSuffix = `|${FACET_PANEL_ALL}`
	if (ref.endsWith(allSuffix) && ref.length > allSuffix.length)
		return { row: ref.slice(0, -allSuffix.length), col: FACET_PANEL_ALL }
	if (grid && ref.indexOf("|", first + 1) === -1)
		return { row: ref.slice(0, first), col: ref.slice(first + 1) }
	return ref
}

/** `structureFacetPanelRef` over a scope list. Same reference when nothing
 *  changes, so a current list never re-saves. */
export const structureFacetPanelRefs = <
	L extends readonly FacetPanelRef[] | null | undefined,
>(
	refs: L,
	grid: boolean,
	panels?: KnownFacetPanels
): L => {
	if (!refs) return refs
	let changed = false
	const next = refs.map((ref) => {
		const out = structureFacetPanelRef(ref, grid, panels)
		if (out !== ref) changed = true
		return out
	})
	return (changed ? next : refs) as L
}
