import { applyLevelOrder } from "../smartSort"
import type { FieldType } from "../types"

type Row = Record<string, unknown>

/** Encoding channels that, when mapped, contribute an extra dimension to bar
 * stacking. Mapping any one of them splits each bar into slices; mapping
 * multiple yields one slice per unique combination. */
export type GroupChannel =
	| "hue"
	| "outlineHue"
	| "saturation"
	| "brightness"
	| "pattern"
	| "opacity"

export type GroupEncoding = {
	channel: GroupChannel
	field: string
	type: FieldType
}

export type StackSlice = {
	/** Value for each mapped group channel. Only mapped channels appear. */
	groupValues: Partial<Record<GroupChannel, string>>
	/** Count of rows (categorical length) or sum of length values (quantitative length). */
	value: number
	/** Stable string key for the slice, derived from the group-value tuple. Unique within a stack. */
	key: string
	/** Optional aggregated value of the text-encoding field (when set and
	 * different from the length field). Numeric text fields → sum across the
	 * slice's rows; non-numeric → first non-empty value encountered. */
	textValue?: number | string
}

export type Stack = {
	category: string
	slices: StackSlice[]
}

/** Backwards-compatible alias. New code should prefer `StackSlice`. */
export type BarSlice = StackSlice
/** Backwards-compatible alias. New code should prefer `Stack`. */
export type BarStack = Stack

export type StacksAggregation =
	| { categories: string[]; stacks: Stack[] }
	| { error: string }

/** Backwards-compatible alias. New code should prefer `StacksAggregation`. */
export type BarAggregation = StacksAggregation

export type AggregateStacksInput = {
	rows: Row[]
	categoryField: string
	lengthField: string
	categoryType: FieldType
	lengthType: FieldType
	groups: GroupEncoding[]
	/** Optional text-encoding field. When set and different from `lengthField`,
	 * each slice will carry a `textValue` aggregated from the slice's rows
	 * (numeric → sum; otherwise → first non-empty). */
	textField?: string
	textType?: FieldType
	/** Optional user-pinned category ordering. Pinned values appear first in
	 * the declared order; unpinned values follow in smart-sort order.
	 * Wins over the default smart-sort. */
	categoryOrder?: readonly string[]
	/** Optional user-pinned ordering for each group channel's field (the
	 * Fields reorder UI). When present, stack slices are ordered by these
	 * instead of staying in data-encounter order — keeping the stacking order
	 * in sync with the legend, which orders its entries the same way. Keyed by
	 * channel so it lines up with `groups`. */
	groupOrders?: Partial<Record<GroupChannel, readonly string[]>>
	/** Count rows instead of reading a length field. Each row contributes 1
	 * to its (category, group-tuple) bucket regardless of `lengthField` /
	 * `lengthType`. Used by histograms, where bar height is the frequency of
	 * rows per bin and there is no measure field. Skips the
	 * categorical-length validation (there's no length field to reconcile). */
	countRows?: boolean
}

/** Backwards-compatible alias. New code should prefer `AggregateStacksInput`. */
export type AggregateBarsInput = AggregateStacksInput

const DISALLOWED_ERROR =
	"When length is categorical, its field must match one of the grouping encodings (hue, saturation, brightness, pattern), or length must be quantitative."

const coerceCategory = (raw: unknown): string | null => {
	if (raw === undefined || raw === null) return null
	const str = String(raw).trim()
	return str === "" ? null : str
}

const coerceGroup = (raw: unknown): string | null => {
	if (raw === undefined || raw === null) return null
	return String(raw)
}

// Unit separator (ASCII 31) — unlikely to appear in user data, so joining
// group values with it yields a collision-free tuple key.
const GROUP_KEY_SEP = "\u001F"

const makeGroupKey = (
	groupValues: Partial<Record<GroupChannel, string>>
): string => {
	// Canonical ordering for the key: alphabetical by channel name. The display
	// order is determined elsewhere (by encounter), but the map key must be stable.
	return (Object.keys(groupValues) as GroupChannel[])
		.sort()
		.map((ch) => `${ch}=${groupValues[ch]}`)
		.join(GROUP_KEY_SEP)
}

/** Sort `categoryOrder` in place when the category type implies a canonical
 * ordering (numeric or chronological). Returns the same array for chaining.
 *
 * Why: faceted charts compute scales from each panel's filtered rows, so
 * encounter order can differ between panels — producing axes with mismatched
 * tick orders for the same field. Canonical sort here makes per-panel axes
 * deterministic. String categoricals stay in encounter order. */
const sortCategoriesByType = (
	categoryOrder: string[],
	categoryType: FieldType
): string[] => {
	switch (categoryType) {
		case "quantitative": {
			categoryOrder.sort((a, b) => Number(a) - Number(b))
			break
		}
		case "temporal": {
			categoryOrder.sort(
				(a, b) => new Date(a).getTime() - new Date(b).getTime()
			)
			break
		}
		case "ordinal": {
			const allNumeric = categoryOrder.every((c) => Number.isFinite(Number(c)))
			if (allNumeric) categoryOrder.sort((a, b) => Number(a) - Number(b))
			break
		}
		// No default
	}
	return categoryOrder
}

/**
 * Aggregates dataset rows into stacked bars.
 *
 * Each bar corresponds to one category value. Each slice within a bar
 * corresponds to a unique combination of the currently-mapped group
 * encodings (hue, saturation, brightness, pattern) — so mapping e.g. hue
 * AND pattern yields one slice per (hue, pattern) pair.
 *
 * Counting vs summing:
 * - If length is quantitative, each slice's value is the sum of length-field
 *   values for rows falling into that (category, group-tuple) bucket.
 * - Otherwise (categorical length), each slice's value is a count of rows.
 *   Categorical length is only meaningful when the length field matches one
 *   of the group encodings' fields (otherwise the user has picked a
 *   categorical length that no visual channel reflects — an ambiguous chart).
 *   That combination returns `{ error }`.
 */
export const aggregateStacks = (
	input: AggregateStacksInput
): StacksAggregation => {
	const {
		rows,
		categoryField,
		lengthField,
		categoryType,
		lengthType,
		groups,
		textField,
		textType,
		categoryOrder: pinnedOrder,
		groupOrders,
		countRows,
	} = input

	// Histograms count rows (contribution = 1 each); there's no length field
	// to sum or validate against the grouping channels.
	const lengthIsQuant = !countRows && lengthType === "quantitative"
	const lengthInGroups = groups.some((g) => g.field === lengthField)
	if (!countRows && !lengthIsQuant && groups.length > 0 && !lengthInGroups) {
		return { error: DISALLOWED_ERROR }
	}

	// Track encounter order for categories and for the unique group-tuples
	// (so slices stack in the order the user's data encounters them).
	const categoryOrder: string[] = []
	const sliceKeyOrder: string[] = []
	// Encounter order of each group channel's values — the fallback ordering
	// when the user hasn't pinned that field, and the input to applyLevelOrder
	// when they have.
	const groupValueOrder: Map<GroupChannel, string[]> = new Map()
	const sliceMeta: Map<
		string,
		Partial<Record<GroupChannel, string>>
	> = new Map()
	const totals: Map<string, Map<string, number>> = new Map()
	// Independent text-encoding aggregation. Only populated when textField is
	// set and distinct from lengthField — otherwise the label uses `value`.
	const textAggregateNumeric =
		textField && textField !== lengthField && textType === "quantitative"
	const collectText = textField && textField !== lengthField
	const textAggregates: Map<string, Map<string, number | string>> = new Map()

	for (const row of rows) {
		const cat = coerceCategory(row[categoryField])
		if (cat === null) continue

		const contribution = lengthIsQuant ? Number(row[lengthField]) : 1
		if (!Number.isFinite(contribution)) continue

		const groupValues: Partial<Record<GroupChannel, string>> = {}
		let skipRow = false
		for (const g of groups) {
			const v = coerceGroup(row[g.field])
			if (v === null) {
				skipRow = true
				break
			}
			groupValues[g.channel] = v
		}
		if (skipRow) continue

		for (const g of groups) {
			const v = groupValues[g.channel]
			if (v === undefined) continue
			let seen = groupValueOrder.get(g.channel)
			if (!seen) {
				seen = []
				groupValueOrder.set(g.channel, seen)
			}
			if (!seen.includes(v)) seen.push(v)
		}

		const sliceKey = makeGroupKey(groupValues)
		if (!categoryOrder.includes(cat)) categoryOrder.push(cat)
		if (!sliceKeyOrder.includes(sliceKey)) {
			sliceKeyOrder.push(sliceKey)
			sliceMeta.set(sliceKey, groupValues)
		}

		let catMap = totals.get(cat)
		if (!catMap) {
			catMap = new Map()
			totals.set(cat, catMap)
		}
		catMap.set(sliceKey, (catMap.get(sliceKey) ?? 0) + contribution)

		if (collectText) {
			let catTextMap = textAggregates.get(cat)
			if (!catTextMap) {
				catTextMap = new Map()
				textAggregates.set(cat, catTextMap)
			}
			const raw = row[textField]
			if (textAggregateNumeric) {
				const n = Number(raw)
				if (Number.isFinite(n)) {
					catTextMap.set(
						sliceKey,
						((catTextMap.get(sliceKey) as number) ?? 0) + n
					)
				}
			} else if (!catTextMap.has(sliceKey)) {
				const str = raw === undefined || raw === null ? "" : String(raw)
				if (str !== "") catTextMap.set(sliceKey, str)
			}
		}
	}

	// Order the stack slices to honor each group field's user-pinned level
	// order (Fields reorder UI), mirroring how the legend orders its entries
	// (orderCategories → applyLevelOrder). Without this the slices stay in
	// data-encounter order and drift out of sync with the legend whenever the
	// user reorders a grouping variable. Sort is stable, so ties (e.g. an
	// unpinned categorical) keep their encounter order.
	const orderedSliceKeys = (() => {
		if (groups.length === 0) return sliceKeyOrder
		const rankByChannel = new Map<GroupChannel, Map<string, number>>()
		for (const g of groups) {
			const ordered = applyLevelOrder(
				groupValueOrder.get(g.channel) ?? [],
				g.type,
				groupOrders?.[g.channel]
			)
			rankByChannel.set(g.channel, new Map(ordered.map((v, i) => [v, i])))
		}
		return [...sliceKeyOrder].sort((a, b) => {
			const ga = sliceMeta.get(a) ?? {}
			const gb = sliceMeta.get(b) ?? {}
			for (const g of groups) {
				const ranks = rankByChannel.get(g.channel)
				const ra = ranks?.get(ga[g.channel] ?? "") ?? 0
				const rb = ranks?.get(gb[g.channel] ?? "") ?? 0
				if (ra !== rb) return ra - rb
			}
			return 0
		})
	})()

	// When no groups are mapped, every row lands in a single slice with an
	// empty key. Render it as one solid bar per category.
	const keysInOrder = groups.length === 0 ? [""] : orderedSliceKeys
	if (groups.length === 0 && !sliceMeta.has("")) {
		sliceMeta.set("", {})
	}

	sortCategoriesByType(categoryOrder, categoryType)

	const stacks: Stack[] = categoryOrder.map((category) => {
		const catMap = totals.get(category) ?? new Map<string, number>()
		const catTextMap = textAggregates.get(category)
		const slices: StackSlice[] = keysInOrder
			.map((key) => {
				const slice: StackSlice = {
					key,
					groupValues: sliceMeta.get(key) ?? {},
					value: catMap.get(key) ?? 0,
				}
				if (catTextMap?.has(key)) slice.textValue = catTextMap.get(key)
				return slice
			})
			.filter((s) => s.value !== 0)
		return { category, slices }
	})

	// Apply the user's pinned ordering when present; otherwise smart-sort
	// (ordinal-aware) and leave categoricals in encounter order. The
	// `applyLevelOrder` helper takes care of "pinned first, smart-sort rest".
	const sortedCategories = applyLevelOrder(
		categoryOrder,
		categoryType,
		pinnedOrder
	)
	const stackByCategory = new Map(stacks.map((s) => [s.category, s]))
	const sortedStacks = sortedCategories
		.map((c) => stackByCategory.get(c))
		.filter((s): s is Stack => s !== undefined)

	return { categories: sortedCategories, stacks: sortedStacks }
}

/** Backwards-compatible alias. New code should prefer `aggregateStacks`. */
export const aggregateBars = aggregateStacks
