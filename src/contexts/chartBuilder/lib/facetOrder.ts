/** Reorder facet panel values based on a user-supplied partial ordering.
 *
 * Values that appear as keys in `order` sort ascending by their numeric
 * rank and come first. Values NOT in `order` follow, preserving the input
 * order (stable partition). Ties within the ordered subset also preserve
 * input order via Array#sort's stability guarantee.
 *
 * This lets users pin a few panels to the front (e.g. "put 'Total' first")
 * without having to assign a rank to every facet value.
 */
export const sortPanelValues = (
	values: readonly string[],
	order: Record<string, number>
): string[] => {
	const keyed = values.map((value, originalIndex) => ({
		value,
		originalIndex,
		rank: order[value],
	}))
	keyed.sort((a, b) => {
		const aRank = a.rank
		const bRank = b.rank
		if (aRank !== undefined && bRank !== undefined) return aRank - bRank
		if (aRank !== undefined) return -1
		if (bRank !== undefined) return 1
		return a.originalIndex - b.originalIndex
	})
	return keyed.map((k) => k.value)
}
