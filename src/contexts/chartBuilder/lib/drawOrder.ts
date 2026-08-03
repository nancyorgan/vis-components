// Draw (paint) order for overlapping point marks. SVG paints in document
// order, so "later in the array" = "on top". By default marks paint in
// dataset row order; the Aesthetics panel's "Draw order" setting sorts them
// by a field instead so the user controls which points win overlaps.
//
// Sorting happens at PAINT time only — scales and aggregations still see
// dataset order, so turning the setting on never changes what the chart
// shows, only which overlapping mark is visible. It applies both to point
// marks and, on line charts, to the SERIES paint order (each line ranked by
// its representative row) so the user controls which line wins a crossing.

import type { DatasetView, FieldType } from "./types"

/** Compare two cell values per the column's inferred type. Unparseable values
 * sort to the end regardless of direction so a single bad cell doesn't
 * capsize the column. Shared by the data tray's column sort and the
 * Aesthetics "Draw order" mark sort so both rank values identically. */
export const compareByType = (
	a: string,
	b: string,
	type: FieldType
): number => {
	if (type === "quantitative" || type === "ordinal") {
		const na = Number(a)
		const nb = Number(b)
		const aNaN = !Number.isFinite(na)
		const bNaN = !Number.isFinite(nb)
		if (aNaN && bNaN) return 0
		if (aNaN) return 1
		if (bNaN) return -1
		return na - nb
	}
	if (type === "temporal") {
		const ta = Date.parse(a)
		const tb = Date.parse(b)
		const aNaN = Number.isNaN(ta)
		const bNaN = Number.isNaN(tb)
		if (aNaN && bNaN) return 0
		if (aNaN) return 1
		if (bNaN) return -1
		return ta - tb
	}
	return a.localeCompare(b)
}

/** Persisted "Draw order" setting (Aesthetics panel). Absent/`null` means
 * dataset row order — later rows draw on top. */
export type DrawOrderConfig = {
	field: string
	dir: "asc" | "desc"
}

/** Stable-sort a COPY of `items` into paint order per the draw-order config:
 * ascending puts the highest values on top (drawn last), descending the
 * lowest. Ties keep dataset order. Values the field can't rank (unparseable
 * numbers/dates) paint FIRST in either direction — an unrankable row should
 * never win an overlap. Returns `items` untouched when no draw order is set
 * or the field isn't in the dataset (e.g. the visual was saved against a
 * different dataset).
 *
 * `order` is the field's user-defined category order (from the legend /
 * category-reorder UI, `levelOrders[field]`). When present, categorical
 * values rank by their POSITION in that list instead of alphabetically —
 * so "descending draw order by the field I dragged to the top" actually
 * paints that category on top, matching what the user sees in the legend.
 * Values not in the list paint first (bottom), like unparseable ones.
 *
 * `tieBreak` resolves items the FIELD can't separate — equal ranked values,
 * or two rows that are both unrankable. Without it those keep dataset order
 * (a stable no-op), which is why a coarse/ordinal draw-order field lets a
 * big and a small mark in the same level overlap arbitrarily. Scatter passes
 * radius-descending here so the bigger mark always paints first (behind) and
 * the smaller one stays visible, without disturbing the field ordering
 * itself. Not applied between a rankable and an unrankable row — the
 * unrankable one still sinks to the bottom regardless of the tie-break. */
export const sortByDrawOrder = <T>(
	items: T[],
	rowOf: (item: T) => Record<string, unknown>,
	drawOrder: DrawOrderConfig | null | undefined,
	dataset: DatasetView | undefined,
	order?: readonly string[] | null,
	tieBreak?: (a: T, b: T) => number
): T[] => {
	if (!drawOrder || !dataset) return items
	const field = dataset.fields.find((f) => f.name === drawOrder.field)
	if (!field) return items
	const type = field.inferredType
	const cell = (item: T): string => {
		const v = rowOf(item)[drawOrder.field]
		return v == null ? "" : String(v)
	}
	// A non-empty custom order takes over ranking: map each category to its
	// index. Anything not listed is treated as unrankable (paints first).
	const orderIndex =
		order && order.length > 0
			? new Map(order.map((v, i) => [v, i]))
			: null
	// Same parse rules as compareByType — kept in sync so the tray sort and
	// the draw-order sort agree on what "unparseable" means.
	const unrankable = (v: string): boolean =>
		orderIndex
			? !orderIndex.has(v)
			: type === "quantitative" || type === "ordinal"
				? !Number.isFinite(Number(v))
				: type === "temporal"
					? Number.isNaN(Date.parse(v))
					: false
	return [...items].sort((a, b) => {
		const va = cell(a)
		const vb = cell(b)
		const ua = unrankable(va)
		const ub = unrankable(vb)
		// Unrankable rows go first (bottom of the paint stack) regardless of
		// direction; only rankable pairs flip with the sort direction. When
		// exactly one row is unrankable it always sinks below. When BOTH are
		// unrankable — or the ranked values tie — the field can't separate
		// them, so fall through to the caller's tie-break.
		if (ua || ub) {
			if (ua !== ub) return ua ? -1 : 1
		} else {
			const c = orderIndex
				? (orderIndex.get(va) ?? 0) - (orderIndex.get(vb) ?? 0)
				: compareByType(va, vb, type)
			if (c !== 0) return drawOrder.dir === "desc" ? -c : c
		}
		return tieBreak ? tieBreak(a, b) : 0
	})
}
