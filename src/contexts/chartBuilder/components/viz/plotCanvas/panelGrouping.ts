import type { PlotInner } from "../../../lib/plotLayout"
import {
	panelFacetValues,
	type FacetPanels,
} from "../../../lib/resolveFacetPanels"
import type { StackModeEntry } from "../../../lib/stackMode"

export const rectToInner = (rect: {
	x: number
	y: number
	width: number
	height: number
}): PlotInner => ({
	x0: rect.x,
	y0: rect.y,
	x1: rect.x + rect.width,
	y1: rect.y + rect.height,
})

/** Share-group keys for a panel. Grid mode keys by ORIGINAL facet value
 *  (compaction moves panels, so layout position lies); wrap/single fall
 *  back to layout position, matching prior behavior. */
export const panelGroupKeys = (
	panelData: FacetPanels,
	key: string,
	idx: number,
): { rowKey: string; colKey: string } => {
	const layoutRow = Math.floor(idx / panelData.grid.cols)
	const layoutCol = idx % panelData.grid.cols
	if (panelData.mode !== "grid")
		return { rowKey: String(layoutRow), colKey: String(layoutCol) }
	const fv = panelFacetValues(panelData, key, idx)
	return {
		rowKey: fv.rowValue ?? String(layoutRow),
		colKey: fv.colValue ?? String(layoutCol),
	}
}

/** Group panel rows by their share group. Returns two maps keyed by
 *  column group key (rows in that column, unioned across all its panels)
 *  and row group key (rows in that row, unioned across all its panels) —
 *  facet VALUES in grid mode, layout indices as strings otherwise (see
 *  `panelGroupKeys`). Both shareX="perGroup" and the panelInputs weight
 *  calculation consult these to find the wider row source under
 *  per-group sharing. */
export const groupRowsByShareGroup = (
	panelData: FacetPanels,
): {
	colRowsByColKey: Map<string, Array<Record<string, unknown>>>
	rowRowsByRowKey: Map<string, Array<Record<string, unknown>>>
} => {
	const colRowsByColKey = new Map<string, Array<Record<string, unknown>>>()
	const rowRowsByRowKey = new Map<string, Array<Record<string, unknown>>>()
	panelData.values.forEach((k, i) => {
		const { rowKey, colKey } = panelGroupKeys(panelData, k, i)
		const rs = panelData.rowsByValue.get(k) ?? []
		const colRows = colRowsByColKey.get(colKey)
		if (colRows) colRows.push(...rs)
		else colRowsByColKey.set(colKey, [...rs])
		const rowRows = rowRowsByRowKey.get(rowKey)
		if (rowRows) rowRows.push(...rs)
		else rowRowsByRowKey.set(rowKey, [...rs])
	})
	return { colRowsByColKey, rowRowsByRowKey }
}

/** Per-panel measure-axis max for bar / area charts. Used to compute a
 *  shared measure-axis bound that's the MAX OF PANEL-LOCAL MAXES across
 *  the share group — NOT the max of the pooled aggregation. Pooling
 *  rows first then aggregating sums same-category values across panels
 *  (e.g. a "2024" stack in panel A + a "2024" stack in panel B become
 *  one bigger stack), which user-reported as the shared y-axis going
 *  ~10× higher than any individual panel's max. The fix is to aggregate
 *  each panel individually then max the maxes.
 *
 *  Aesthetic groups (hue / saturation / etc.) aren't consulted here: under
 *  the default stack mode, the per-category sum is unaffected by how
 *  values split across groups, so the shared axis bound is correct. Under
 *  group / overlay, computing without groups gives an UPPER bound (the
 *  category sum is ≥ any single group's value), which is safe — axis
 *  has extra headroom but never clips.
 *
 *  Leaf-aware: bars are grouped side-by-side on the category axis by the
 *  `group`-mode channels and stacked on the measure axis by the `stack`-mode
 *  channels, so the bound is the max over (category × group-mode-leaf) of the
 *  stacked total within that leaf (or the max single row when no channel
 *  stacks). Mirrors BarPlot's `computeBarMeasureMax` on raw rows. */
export const computePanelMeasureMax = (
	rows: ReadonlyArray<Record<string, unknown>>,
	categoryField: string | null,
	measureField: string | null,
	modes: StackModeEntry[],
	groupModeFields: string[]
): number => {
	if (!rows.length || !categoryField || !measureField) return 1
	const hasStack = modes.some((m) => m.mode === "stack")
	// Unit separator (U+001F) prevents leaf-key collisions across value
	// boundaries — consistent with BarPlot's leafKey and the aggregator.
	const SEP = "\u001F"
	const perLeaf = new Map<string, number>()
	for (const r of rows) {
		const cv = r[categoryField]
		if (cv == null) continue
		const raw = r[measureField]
		const n = typeof raw === "number" ? raw : Number(raw)
		if (!Number.isFinite(n)) continue
		const leaf =
			String(cv) + SEP + groupModeFields.map((f) => String(r[f] ?? "")).join(SEP)
		const prev = perLeaf.get(leaf)
		perLeaf.set(leaf, hasStack ? (prev ?? 0) + n : Math.max(prev ?? 0, n))
	}
	if (perLeaf.size === 0) return 1
	return Math.max(1, ...perLeaf.values())
}
