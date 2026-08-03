import type { FieldType } from "./types"

/** Sort a list of category values "smartly" given the field's effective type.
 *
 * - Quantitative / temporal: not used here (these aren't drawn as discrete
 *   categories) — passthrough.
 * - Ordinal: when every value parses as a finite number, sort numerically;
 *   otherwise sort alphabetically with locale-aware comparison + numeric
 *   substring awareness (so "Region 2" precedes "Region 10").
 * - Categorical: passthrough — discovery order is the convention. The user
 *   reorders categorical levels explicitly via the per-field reorder UI.
 *
 * Always returns a NEW array (does not mutate the input). */
export const smartSortCategories = (
	values: readonly string[],
	type: FieldType
): string[] => {
	if (type !== "ordinal") return [...values]
	const allNumeric = values.every((v) => Number.isFinite(Number(v)))
	if (allNumeric) {
		return [...values].sort((a, b) => Number(a) - Number(b))
	}
	return [...values].sort((a, b) =>
		a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
	)
}

/** Apply a user-pinned level ordering to the discovered values, falling
 * back to smart-sort for any value not present in the override list.
 *
 * Pinned values come first in the declared order; everything else
 * (a value the user added to data after pinning, say) comes after in
 * smart-sorted order. Returns a NEW array. */
export const applyLevelOrder = (
	values: readonly string[],
	type: FieldType,
	pinnedOrder: readonly string[] | undefined
): string[] => {
	if (!pinnedOrder || pinnedOrder.length === 0) {
		return smartSortCategories(values, type)
	}
	const valueSet = new Set(values)
	const pinned = pinnedOrder.filter((v) => valueSet.has(v))
	const pinnedSet = new Set(pinned)
	const rest = smartSortCategories(
		values.filter((v) => !pinnedSet.has(v)),
		type
	)
	return [...pinned, ...rest]
}

/** Display-order the discovered category values by the user's pinned field
 * ordering while carrying each value's ORIGINAL discovery index.
 *
 * The sidebar's per-level editors (Color / Shape / Pattern / Area / Opacity)
 * assign each value's default visual slot — `scheme[i]`, `SHAPE_PALETTE[i]`,
 * the ordinal area spread, the opacity resolver, any parallel `labels[i]` —
 * by DISCOVERY-order index, exactly as the renderer's scales do. So only the
 * row ORDER may change to follow the pinned order; each value's slot + label
 * must stay pinned to its discovery index, or the sidebar swatch would drift
 * from the mark drawn on canvas.
 *
 * No pinned order → discovery order, UNCHANGED (not smart-sorted), matching
 * `Legend`'s `orderCategories` and the discovery-order scales. Returns NEW
 * pairs; does not mutate the input. */
export const orderedLevels = (
	values: readonly string[],
	type: FieldType,
	pinnedOrder: readonly string[] | undefined
): Array<{ value: string; index: number }> => {
	const display =
		pinnedOrder && pinnedOrder.length > 0
			? applyLevelOrder(values, type, pinnedOrder)
			: [...values]
	const discoveryIndex = new Map(values.map((v, i) => [v, i]))
	return display.map((value) => ({
		value,
		index: discoveryIndex.get(value) ?? 0,
	}))
}
