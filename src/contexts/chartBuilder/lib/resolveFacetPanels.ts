import type { FacetConfig } from "./channelConfig"
import { effectiveType } from "./fieldType"
import { sortPanelValues } from "./facetOrder"
import { resolveCrossProduct, resolveFacetGrid } from "./resolveFacetGrid"
import { parseValue } from "./scales"
import type { DatasetView, Encodings, FieldType } from "./types"

/** Reorder a set of facet values using the user's field-level ordering
 *  (from the Fields sidebar) as the canonical source, with a fallback to
 *  the legacy per-facet `panelOrder` sparse-rank map for saved visuals.
 *
 *  Why both: `levelOrders` is set via drag-and-drop on a field's values
 *  and applies everywhere that field appears (axis ticks, legends,
 *  facet panels). It's the right canonical ordering. The legacy
 *  `panelOrder` predates the unified ordering and only stored per-
 *  facet ranks — we still honor it as a fallback so old visuals load
 *  identically, but new UI doesn't expose it.
 *
 *  Values present in the user's ordering come first in that order;
 *  remaining values follow in dataset-encounter order. */
export const applyOrderingForField = (
	natural: readonly string[],
	levelOrder: readonly string[] | undefined,
	legacyPanelOrder: Record<string, number> | undefined,
): string[] => {
	if (levelOrder && levelOrder.length > 0) {
		const naturalSet = new Set(natural)
		const inOrder = levelOrder.filter((v) => naturalSet.has(v))
		const orderSet = new Set(inOrder)
		const remaining = natural.filter((v) => !orderSet.has(v))
		return [...inOrder, ...remaining]
	}
	return sortPanelValues([...natural], legacyPanelOrder ?? {})
}

/** Resolved facet partition for the current chart. `values` is the ordered
 *  list of panel KEYS — these double as the facet labels shown above each
 *  panel and are what annotations target via `facetKeys`. `mode` is
 *  `"single"` when the chart isn't faceted (a lone `"__all__"` panel).
 *
 *  Discriminated on `mode`: grid mode carries the per-axis `rowValues` /
 *  `colValues` (the row & column strips), so callers that narrow to
 *  `mode === "grid"` get them as non-optional. */
type BaseFacetPanels = {
	values: string[]
	rowsByValue: Map<string, Array<Record<string, unknown>>>
	grid: { rows: number; cols: number }
}
export type FacetPanels =
	| (BaseFacetPanels & { mode: "single" | "wrap" })
	| (BaseFacetPanels & {
			mode: "grid"
			rowValues: string[]
			colValues: string[]
			compact?: FacetCompactLayout
	  })

/** Layout descriptor present only when `hideEmptyPanels` dropped panels.
 *  `strip` names which header strip SURVIVES the compaction:
 *    "cols" — every column had the same non-empty count; columns stay
 *             aligned under the top strip and each panel is titled with
 *             its ROW value.
 *    "rows" — mirror image (left strip survives, panels titled with
 *             their COLUMN value).
 *    "none" — neither direction is even; panels wrap into a near-square
 *             grid and titles carry both values ("a · x").
 *  `panels` is keyed by panel key and carries the original facet values
 *  (layout position no longer encodes them) plus the display title. */
export type FacetCompactLayout = {
	strip: "cols" | "rows" | "none"
	panels: Record<
		string,
		{ rowValue: string; colValue: string; label: string }
	>
}

/** Hide-empty-panels compaction (design doc 2026-07-20). Returns null when
 *  no cell is empty — the caller falls through to the normal dense grid so
 *  the toggle is a no-op on fully-populated data. */
export const compactNonEmptyGrid = (
	rowValues: readonly string[],
	colValues: readonly string[],
	cellRows: Map<string, Array<Record<string, unknown>>>,
): {
	values: string[]
	grid: { rows: number; cols: number }
	compact: FacetCompactLayout
} | null => {
	const nonEmpty = (r: string, c: string) =>
		(cellRows.get(`${r}|${c}`)?.length ?? 0) > 0
	const colPanels = colValues.map((c) =>
		rowValues.filter((r) => nonEmpty(r, c)),
	)
	const rowPanels = rowValues.map((r) =>
		colValues.filter((c) => nonEmpty(r, c)),
	)
	const total = colPanels.reduce((s, p) => s + p.length, 0)
	if (total === rowValues.length * colValues.length) return null // dense
	// All-empty degenerate (possible when a row/col value's partner field is
	// null everywhere): fall back to today's grid rendering rather than emit
	// an inconsistent compact descriptor.
	if (total === 0) return null

	const allEqual = (ns: number[]) => ns.every((n) => n === ns[0])
	const panels: FacetCompactLayout["panels"] = {}

	if (allEqual(colPanels.map((p) => p.length))) {
		// Compact columns: dense k×C grid, top strip survives.
		const k = colPanels[0]?.length ?? 0
		const values: string[] = []
		for (let lr = 0; lr < k; lr++) {
			for (let ci = 0; ci < colValues.length; ci++) {
				const rowValue = colPanels[ci][lr]
				const colValue = colValues[ci]
				const key = `${rowValue}|${colValue}`
				values.push(key)
				panels[key] = { rowValue, colValue, label: rowValue }
			}
		}
		return {
			values,
			grid: { rows: Math.max(1, k), cols: Math.max(1, colValues.length) },
			compact: { strip: "cols", panels },
		}
	}
	if (allEqual(rowPanels.map((p) => p.length))) {
		// Compact rows: dense R×k grid, left strip survives.
		const k = rowPanels[0]?.length ?? 0
		const values: string[] = []
		for (let ri = 0; ri < rowValues.length; ri++) {
			for (let lc = 0; lc < k; lc++) {
				const rowValue = rowValues[ri]
				const colValue = rowPanels[ri][lc]
				const key = `${rowValue}|${colValue}`
				values.push(key)
				panels[key] = { rowValue, colValue, label: colValue }
			}
		}
		return {
			values,
			grid: { rows: Math.max(1, rowValues.length), cols: Math.max(1, k) },
			compact: { strip: "rows", panels },
		}
	}
	// Wrap fallback: survivors flow row-major (original grid traversal
	// order) into a near-square wrap grid; only the last row is ragged —
	// the exact shape existing wrap-mode consumers already handle.
	const values: string[] = []
	for (const r of rowValues) {
		for (const c of colValues) {
			if (!nonEmpty(r, c)) continue
			const key = `${r}|${c}`
			values.push(key)
			panels[key] = { rowValue: r, colValue: c, label: `${r} · ${c}` }
		}
	}
	return {
		values,
		grid: resolveFacetGrid(values.length, null, null),
		compact: { strip: "none", panels },
	}
}

/** Original facet values for a grid-mode panel. When hide-empty compaction
 *  is active, layout position no longer encodes the facet values — read
 *  them from the compact descriptor; otherwise fall back to the positional
 *  rowValues/colValues lookup. Null outside grid mode. Callers use this for
 *  share-group keys and per-row/col axis-override lookups, which must key
 *  on facet VALUES, never layout position. */
export const panelFacetValues = (
	panelData: FacetPanels,
	key: string,
	idx: number,
): { rowValue: string | null; colValue: string | null } => {
	if (panelData.mode !== "grid") return { rowValue: null, colValue: null }
	const compactPanel = panelData.compact?.panels[key]
	if (compactPanel)
		return {
			rowValue: compactPanel.rowValue,
			colValue: compactPanel.colValue,
		}
	const row = Math.floor(idx / panelData.grid.cols)
	const col = idx % panelData.grid.cols
	return {
		rowValue: panelData.rowValues[row] ?? null,
		colValue: panelData.colValues[col] ?? null,
	}
}

/** Partition the dataset into facet panels for the current encodings.
 *
 *  Shared by PlotCanvas (which renders each panel) and the annotations
 *  sidebar (which lists the panel keys so the user can scope an annotation
 *  to specific facets). Keeping ONE source of truth guarantees the keys the
 *  sidebar offers match the keys PlotCanvas renders against. */
export const resolveFacetPanels = (
	dataset: DatasetView | undefined,
	encodings: Encodings,
	levelOrders: Record<string, readonly string[]>,
	overrides: Record<string, FieldType>,
	facetCfg: FacetConfig,
): FacetPanels => {
	if (!dataset) {
		return {
			values: [],
			rowsByValue: new Map(),
			grid: { rows: 1, cols: 1 },
			mode: "single",
		}
	}
	// GRID-style modes: at least one of facetRow / facetCol is mapped.
	// Three sub-cases:
	//   - both set:      N×M cross-product with top + left strips
	//   - row only:      N×1 vertical stack with left strip only
	//   - col only:      1×N horizontal strip with top strip only
	// facetCfg.rows / facetCfg.cols are wrap-only and ignored here.
	// Takes precedence over wrap mode if (somehow) both `facet` and
	// the row/col channels are set, so the renderer is robust to
	// corrupted-state JSON; the UI conflict system normally prevents
	// this combination.
	const rowField = encodings.facetRow?.field ?? null
	const colField = encodings.facetCol?.field ?? null
	if (rowField || colField) {
		let rowValues: string[]
		let colValues: string[]
		let cellRows: Map<string, Array<Record<string, unknown>>>

		if (rowField && colField) {
			const xp = resolveCrossProduct(dataset.rows, rowField, colField)
			rowValues = applyOrderingForField(
				xp.rowValues,
				levelOrders[rowField],
				undefined,
			)
			colValues = applyOrderingForField(
				xp.colValues,
				levelOrders[colField],
				undefined,
			)
			cellRows = xp.cellRows
		} else if (rowField) {
			// Row-only: each unique row-value gets its own panel; one
			// implicit column. The `__all__` placeholder is internal
			// (it gates the column-header strip out via the
			// encodings.facetCol check downstream).
			const uniq: string[] = []
			const seen = new Set<string>()
			for (const r of dataset.rows) {
				const v = r[rowField]
				if (v == null) continue
				const s = String(v)
				if (!seen.has(s)) {
					seen.add(s)
					uniq.push(s)
				}
			}
			rowValues = applyOrderingForField(uniq, levelOrders[rowField], undefined)
			colValues = ["__all__"]
			cellRows = new Map()
			for (const r of rowValues) cellRows.set(`${r}|__all__`, [])
			for (const row of dataset.rows) {
				const v = row[rowField]
				if (v == null) continue
				cellRows.get(`${String(v)}|__all__`)?.push(row)
			}
		} else if (colField) {
			// Col-only: each unique col-value gets its own panel; one
			// implicit row. Mirror image of the row-only case.
			const uniq: string[] = []
			const seen = new Set<string>()
			for (const r of dataset.rows) {
				const v = r[colField]
				if (v == null) continue
				const s = String(v)
				if (!seen.has(s)) {
					seen.add(s)
					uniq.push(s)
				}
			}
			rowValues = ["__all__"]
			colValues = applyOrderingForField(
				uniq,
				levelOrders[colField],
				undefined,
			)
			cellRows = new Map()
			for (const c of colValues) cellRows.set(`__all__|${c}`, [])
			for (const row of dataset.rows) {
				const v = row[colField]
				if (v == null) continue
				cellRows.get(`__all__|${String(v)}`)?.push(row)
			}
		} else {
			// Unreachable: the enclosing `if (rowField || colField)` guard
			// guarantees colField is set when rowField is not.
			throw new Error("resolveFacetPanels: expected facetRow or facetCol field")
		}

		if (rowField && colField && facetCfg.hideEmptyPanels === true) {
			const compacted = compactNonEmptyGrid(rowValues, colValues, cellRows)
			if (compacted) {
				const rowsByValue = new Map<string, Array<Record<string, unknown>>>()
				for (const key of compacted.values)
					rowsByValue.set(key, cellRows.get(key) ?? [])
				return {
					values: compacted.values,
					rowsByValue,
					grid: compacted.grid,
					mode: "grid",
					rowValues,
					colValues,
					compact: compacted.compact,
				}
			}
		}

		const keys: string[] = []
		const rowsByValue = new Map<string, Array<Record<string, unknown>>>()
		for (const r of rowValues) {
			for (const c of colValues) {
				const key = `${r}|${c}`
				keys.push(key)
				rowsByValue.set(key, cellRows.get(key) ?? [])
			}
		}
		return {
			values: keys,
			rowsByValue,
			grid: {
				rows: Math.max(1, rowValues.length),
				cols: Math.max(1, colValues.length),
			},
			mode: "grid",
			rowValues,
			colValues,
		}
	}
	const facetField = encodings.facet?.field ?? null
	if (!facetField) {
		return {
			values: ["__all__"],
			rowsByValue: new Map([["__all__", dataset.rows]]),
			grid: { rows: 1, cols: 1 },
			mode: "single",
		}
	}
	const facetType = effectiveType(dataset, facetField, overrides)
	const natural = [
		...new Set(
			dataset.rows
				.map((r) => parseValue(r[facetField], facetType))
				.filter((v) => v !== null)
				.map(String),
		),
	]
	const sorted = applyOrderingForField(
		natural,
		levelOrders[facetField],
		facetCfg.panelOrder,
	)
	const rowsByValue = new Map<string, Array<Record<string, unknown>>>(
		sorted.map((v) => [v, []]),
	)
	for (const row of dataset.rows) {
		const v = parseValue(row[facetField], facetType)
		if (v === null) continue
		rowsByValue.get(String(v))?.push(row)
	}
	const grid = resolveFacetGrid(sorted.length, facetCfg.rows, facetCfg.cols)
	const visible = sorted.slice(0, grid.rows * grid.cols)
	return { values: visible, rowsByValue, grid, mode: "wrap" }
}
