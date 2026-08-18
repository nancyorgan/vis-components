import { parseNumericCell, parseValue } from "./scales"
import { smartSortCategories } from "./smartSort"
import type { FieldType } from "./types"

/** Compute a level ordering for a categorical/ordinal `field` by aggregating
 * a quantitative/temporal `byField` per level: quantitative → SUM of the
 * level's parseable cells (matching how bars/stacks aggregate), temporal →
 * EARLIEST date. One-shot: the caller pins the returned order via
 * `currentFieldLevelOrdersAtom`; nothing re-sorts when data changes.
 *
 * `scope` restricts which rows feed the aggregate — "sort by dollars in the
 * 2023 level of year" — via raw string cell equality; scoped-out rows still
 * count for level DISCOVERY, so the returned list stays complete.
 *
 * Levels with no parseable `byField` cell (or no rows in the scope) always
 * go LAST (even when `decreasing`), in smart-sort order; ties also break by
 * smart-sort order. Lives outside smartSort.ts because scales.ts imports
 * smartSort — pulling parseValue/parseNumericCell into smartSort would be
 * circular. */
export const orderLevelsByField = (
	rows: ReadonlyArray<Record<string, string>>,
	field: string,
	type: FieldType,
	byField: string,
	byType: "quantitative" | "temporal",
	decreasing: boolean,
	scope?: { field: string; value: string }
): string[] => {
	// Mirror LevelReorderPanel's discovery: skip missing/blank level cells.
	// null = level seen but no parseable byField cell yet ("missing").
	const totals = new Map<string, number | null>()
	for (const row of rows) {
		const raw = row[field]
		if (raw === undefined || raw === null || String(raw) === "") continue
		const level = String(raw)
		const prev = totals.get(level)
		if (prev === undefined) totals.set(level, null)
		if (scope && String(row[scope.field]) !== scope.value) continue
		if (byType === "quantitative") {
			const n = parseNumericCell(row[byField])
			if (n === null) continue
			totals.set(level, (prev ?? 0) + n)
		} else {
			const d = parseValue(row[byField], "temporal")
			if (!(d instanceof Date)) continue
			const t = d.getTime()
			totals.set(level, prev === null || prev === undefined ? t : Math.min(prev, t))
		}
	}
	const smartIndex = new Map(
		smartSortCategories([...totals.keys()], type).map((v, i) => [v, i])
	)
	const bySmart = (a: string, b: string) =>
		(smartIndex.get(a) ?? 0) - (smartIndex.get(b) ?? 0)
	const valued: Array<[string, number]> = []
	const missing: string[] = []
	for (const [level, total] of totals) {
		if (total === null) missing.push(level)
		else valued.push([level, total])
	}
	valued.sort((a, b) => {
		const diff = decreasing ? b[1] - a[1] : a[1] - b[1]
		return diff !== 0 ? diff : bySmart(a[0], b[0])
	})
	missing.sort(bySmart)
	return [...valued.map(([level]) => level), ...missing]
}

/** The "Alphabetical" standard option: locale-aware, numeric-substring-aware
 * compare of the level names themselves (2 before 10, "Region 2" before
 * "Region 10") — the same collation smart-sort uses for non-numeric
 * ordinals, but available on demand for ANY level list. Returns a NEW
 * array. */
export const alphabeticalLevelOrder = (
	values: readonly string[],
	decreasing: boolean
): string[] => {
	const sorted = [...values].sort((a, b) =>
		a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
	)
	return decreasing ? sorted.reverse() : sorted
}
