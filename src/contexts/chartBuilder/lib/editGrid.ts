/** The Edit dialog's grid model: the version shown as a table of cells the
 *  user changes in place, with every operation the grid offers — set a
 *  cell, add / delete rows and columns, rename a column, sort, paste a
 *  block, copy a block out — as a pure function over an immutable value,
 *  so the dialog can keep a plain undo stack of grids.
 *
 *  Rows and columns carry a stable `key` (the seed's index, or a fresh
 *  number for ones the user added), so a cell can be compared with its
 *  original value after rows and columns have been deleted, added or
 *  sorted around it. Sorting is DISPLAY order only — `order` maps each
 *  shown position to a row in `rows` — so the saved rows keep the order
 *  they were imported in, and the data table's hand-edit outlines don't
 *  light up every cell because the user sorted to find one. */

import { parse as papaParse, unparse as papaUnparse } from "papaparse"
import {
	conformToFormat,
	detectColumnFormat,
	type ColumnFormat,
} from "./cellFormat"
import { compareByType } from "./drawOrder"
import type { DatasetView, FieldType } from "./types"

export type GridColumn = {
	key: number
	name: string
	/** The field's type, for sorting; a column the user added sorts as text. */
	type: FieldType
	/** How the column writes numbers ("2,123,123", "$1,234.56", "14%"), read
	 *  from its cells as the grid opened; typed and pasted values are
	 *  rewritten to match (`lib/cellFormat.ts`). Null = nothing to enforce. */
	format: ColumnFormat | null
}

export type GridRow = {
	key: number
	/** One cell per column, in column order. */
	cells: string[]
}

export type Grid = {
	columns: GridColumn[]
	rows: GridRow[]
	/** Display order: shown position → index into `rows`. */
	order: number[]
	/** The sort `order` reflects, for the header arrows; null = row order. */
	sort: SortState
	nextKey: number
}

/** A cell in DISPLAY coordinates: `pos` is the shown row position (through
 *  `order`), `col` the column index. */
export type CellRef = { pos: number; col: number }

/** A rectangular selection, anchor to focus, both inclusive. */
export type CellRange = { anchor: CellRef; focus: CellRef }

export type Rect = { top: number; bottom: number; left: number; right: number }

export type SortState = { col: number; dir: "asc" | "desc" } | null

export const gridFromView = (view: DatasetView): Grid => {
	const columns = view.fields.map((f, i) => ({
		key: i,
		name: f.name,
		type: f.inferredType,
		format: detectColumnFormat(view.rows.map((row) => row[f.name] ?? "")),
	}))
	const rows = view.rows.map((row, i) => ({
		key: i,
		cells: view.fields.map((f) => row[f.name] ?? ""),
	}))
	return {
		columns,
		rows,
		order: rows.map((_, i) => i),
		sort: null,
		nextKey: Math.max(columns.length, rows.length),
	}
}

/** Serialize for the save path (the same CSV text the text box held), in
 *  ROW order, dropping rows every cell of which is blank — an empty row is
 *  not data, and the parser would otherwise keep it. */
export const gridToCsv = (grid: Grid): string =>
	papaUnparse(
		{
			fields: grid.columns.map((c) => c.name),
			data: grid.rows
				.filter((r) => !r.cells.every((c) => c === ""))
				.map((r) => r.cells),
		},
		{ newline: "\n" }
	)

/** Why the grid can't be saved as it stands, or null. */
export const gridIssue = (grid: Grid): string | null => {
	if (grid.columns.length === 0) return "Add at least one column."
	const names = grid.columns.map((c) => c.name.trim())
	if (names.some((n) => n === "")) return "Every column needs a name."
	const seen = new Set<string>()
	for (const n of names) {
		if (seen.has(n)) return `Two columns are named “${n}”. Column names must be unique.`
		seen.add(n)
	}
	if (grid.rows.every((r) => r.cells.every((c) => c === "")))
		return "Enter at least one data row."
	return null
}

export const normalizeRange = (range: CellRange): Rect => ({
	top: Math.min(range.anchor.pos, range.focus.pos),
	bottom: Math.max(range.anchor.pos, range.focus.pos),
	left: Math.min(range.anchor.col, range.focus.col),
	right: Math.max(range.anchor.col, range.focus.col),
})

export const inRect = (rect: Rect, pos: number, col: number): boolean =>
	pos >= rect.top && pos <= rect.bottom && col >= rect.left && col <= rect.right

/** The row at a shown position. */
export const rowAt = (grid: Grid, pos: number): GridRow | undefined =>
	grid.rows[grid.order[pos] ?? -1]

export const cellValue = (grid: Grid, pos: number, col: number): string =>
	rowAt(grid, pos)?.cells[col] ?? ""

const withRow = (
	grid: Grid,
	rowIndex: number,
	update: (row: GridRow) => GridRow
): Grid => ({
	...grid,
	rows: grid.rows.map((r, i) => (i === rowIndex ? update(r) : r)),
})

/** Store a typed value, written the column's way (see `GridColumn.format`). */
export const setCell = (grid: Grid, pos: number, col: number, typed: string): Grid => {
	const rowIndex = grid.order[pos]
	const column = grid.columns[col]
	if (rowIndex === undefined || !column) return grid
	const value = conformToFormat(typed, column.format)
	if (grid.rows[rowIndex]?.cells[col] === value) return grid
	return withRow(grid, rowIndex, (r) => ({
		...r,
		cells: r.cells.map((c, i) => (i === col ? value : c)),
	}))
}

/** Blank every cell in the rectangle. */
export const clearRect = (grid: Grid, rect: Rect): Grid => {
	const touched = new Set<number>()
	for (let pos = rect.top; pos <= rect.bottom; pos++) {
		const rowIndex = grid.order[pos]
		if (rowIndex !== undefined) touched.add(rowIndex)
	}
	let changed = false
	const rows = grid.rows.map((r, i) => {
		if (!touched.has(i)) return r
		const cells = r.cells.map((c, col) =>
			col >= rect.left && col <= rect.right ? "" : c
		)
		if (cells.every((c, col) => c === r.cells[col])) return r
		changed = true
		return { ...r, cells }
	})
	return changed ? { ...grid, rows } : grid
}

export const renameColumn = (grid: Grid, col: number, name: string): Grid => {
	const column = grid.columns[col]
	if (!column || column.name === name) return grid
	return {
		...grid,
		columns: grid.columns.map((c, i) => (i === col ? { ...c, name } : c)),
	}
}

/** Append a blank row; it shows last whatever the sort. */
export const addRow = (grid: Grid): Grid => ({
	...grid,
	rows: [
		...grid.rows,
		{ key: grid.nextKey, cells: grid.columns.map(() => "") },
	],
	order: [...grid.order, grid.rows.length],
	nextKey: grid.nextKey + 1,
})

/** A column name no existing column has: "Column 3", "Column 4", … */
export const freshColumnName = (grid: Grid): string => {
	const taken = new Set(grid.columns.map((c) => c.name))
	for (let n = grid.columns.length + 1; ; n++) {
		const name = `Column ${n}`
		if (!taken.has(name)) return name
	}
}

export const addColumn = (grid: Grid, name = freshColumnName(grid)): Grid => ({
	...grid,
	columns: [
		...grid.columns,
		{ key: grid.nextKey, name, type: "categorical", format: null },
	],
	rows: grid.rows.map((r) => ({ ...r, cells: [...r.cells, ""] })),
	nextKey: grid.nextKey + 1,
})

/** Delete the rows shown at positions top..bottom. */
export const deleteRows = (grid: Grid, top: number, bottom: number): Grid => {
	const doomed = new Set<number>()
	for (let pos = top; pos <= bottom; pos++) {
		const rowIndex = grid.order[pos]
		if (rowIndex !== undefined) doomed.add(rowIndex)
	}
	if (doomed.size === 0) return grid
	// Surviving rows keep their relative order; `order` is re-indexed to
	// point at them where they land.
	const newIndex = new Map<number, number>()
	const rows: GridRow[] = []
	grid.rows.forEach((r, i) => {
		if (doomed.has(i)) return
		newIndex.set(i, rows.length)
		rows.push(r)
	})
	return {
		...grid,
		rows,
		order: grid.order.flatMap((i) => {
			const next = newIndex.get(i)
			return next === undefined ? [] : [next]
		}),
	}
}

export const deleteColumns = (grid: Grid, left: number, right: number): Grid => {
	// Deleting every column leaves the rows with no cells; the issue line
	// then says to add a column.
	const keep = (i: number) => i < left || i > right
	const removed = right - left + 1
	const sort =
		grid.sort === null || !keep(grid.sort.col)
			? null
			: grid.sort.col > right
				? { ...grid.sort, col: grid.sort.col - removed }
				: grid.sort
	return {
		...grid,
		columns: grid.columns.filter((_, i) => keep(i)),
		rows: grid.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => keep(i)) })),
		sort,
	}
}

/** Sort the shown order by a column (a stable sort, so ties keep their
 *  current order), or restore row order when `sort` is null. */
export const applySort = (grid: Grid, sort: SortState): Grid => {
	if (!sort) return { ...grid, order: grid.rows.map((_, i) => i), sort: null }
	const column = grid.columns[sort.col]
	if (!column) return grid
	const indices = grid.rows.map((_, i) => i)
	indices.sort(
		(a, b) =>
			compareByType(
				grid.rows[a]?.cells[sort.col] ?? "",
				grid.rows[b]?.cells[sort.col] ?? "",
				column.type
			) || a - b
	)
	return { ...grid, order: sort.dir === "desc" ? indices.reverse() : indices, sort }
}

/** The next sort state a click on this column's sort control produces:
 *  unsorted → ascending → descending → unsorted. */
export const nextSort = (sort: SortState, col: number): SortState => {
	if (!sort || sort.col !== col) return { col, dir: "asc" }
	if (sort.dir === "asc") return { col, dir: "desc" }
	return null
}

/** The rectangle's cells as tab-separated lines, for the clipboard. A cell
 *  holding a tab, newline or quote is quoted the way spreadsheets do it. */
export const rectToTsv = (grid: Grid, rect: Rect): string => {
	const lines: string[] = []
	for (let pos = rect.top; pos <= rect.bottom; pos++) {
		const cells: string[] = []
		for (let col = rect.left; col <= rect.right; col++)
			cells.push(cellValue(grid, pos, col))
		lines.push(cells.map(quoteForTsv).join("\t"))
	}
	return lines.join("\n")
}

const quoteForTsv = (cell: string): string =>
	/[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell

/** Clipboard text as a block of cells. Tab-separated (what every
 *  spreadsheet puts on the clipboard), with quoted cells honored; one
 *  trailing newline is ignored. */
export const parseClipboardBlock = (text: string): string[][] => {
	const trimmed = text.replace(/\r\n?/g, "\n").replace(/\n$/, "")
	if (trimmed === "") return [[""]]
	const parsed = papaParse<string[]>(trimmed, {
		delimiter: "\t",
		header: false,
		dynamicTyping: false,
		skipEmptyLines: false,
	})
	return parsed.data.map((line) => line.map((c) => c ?? ""))
}

/** Paste a block at the top-left of the selection. A single pasted value
 *  fills the whole selection (the spreadsheet idiom); a block pastes from
 *  the selection's top-left corner, growing the table with new rows as
 *  needed and ignoring cells past the last column. Returns the grid and
 *  the rectangle the paste covered, for the selection to move onto. */
export const pasteBlock = (
	grid: Grid,
	rect: Rect,
	block: string[][]
): { grid: Grid; rect: Rect } => {
	if (grid.columns.length === 0) return { grid, rect }
	const single = block.length === 1 && block[0]?.length === 1
	const value = block[0]?.[0] ?? ""
	const height = single ? rect.bottom - rect.top + 1 : block.length
	const width = single
		? rect.right - rect.left + 1
		: block.reduce((m, line) => Math.max(m, line.length), 0)
	const bottom = rect.top + height - 1
	const right = Math.min(grid.columns.length - 1, rect.left + width - 1)

	let next = grid
	while (next.order.length <= bottom) next = addRow(next)
	// Edit rows in one pass rather than cell by cell.
	const edits = new Map<number, Map<number, string>>()
	for (let pos = rect.top; pos <= bottom; pos++) {
		const rowIndex = next.order[pos]
		if (rowIndex === undefined) continue
		const line = block[pos - rect.top]
		for (let col = rect.left; col <= right; col++) {
			const v = conformToFormat(
				single ? value : (line?.[col - rect.left] ?? ""),
				next.columns[col]?.format ?? null
			)
			let byCol = edits.get(rowIndex)
			if (!byCol) {
				byCol = new Map()
				edits.set(rowIndex, byCol)
			}
			byCol.set(col, v)
		}
	}
	const rows = next.rows.map((r, i) => {
		const byCol = edits.get(i)
		if (!byCol) return r
		return { ...r, cells: r.cells.map((c, col) => byCol.get(col) ?? c) }
	})
	return {
		grid: { ...next, rows },
		rect: { top: rect.top, bottom, left: rect.left, right },
	}
}

/** Whether a cell differs from the value the seed grid held for the same
 *  row key and column key (the dialog outlines those). */
export const makeChangedLookup = (seed: Grid) => {
	const rowByKey = new Map(seed.rows.map((r) => [r.key, r]))
	const colIndexByKey = new Map(seed.columns.map((c, i) => [c.key, i]))
	return (grid: Grid, pos: number, col: number): boolean => {
		const row = rowAt(grid, pos)
		const column = grid.columns[col]
		if (!row || !column) return false
		const seedRow = rowByKey.get(row.key)
		const seedCol = colIndexByKey.get(column.key)
		if (!seedRow || seedCol === undefined) {
			// A new row or column: a non-empty cell is a change.
			return (row.cells[col] ?? "") !== ""
		}
		return (row.cells[col] ?? "") !== (seedRow.cells[seedCol] ?? "")
	}
}

/** Pixel widths per column, from the longest text in the header and the
 *  first rows, clamped so a column is never a sliver nor a wall. */
export const columnWidths = (
	grid: Grid,
	{ min = 88, max = 320, sample = 300 } = {}
): number[] =>
	grid.columns.map((c, col) => {
		// The header holds the name plus its sort glyph, so it needs more
		// room than a cell of the same length.
		let longest = c.name.length + 3
		for (let i = 0; i < Math.min(sample, grid.rows.length); i++) {
			const len = grid.rows[i]?.cells[col]?.length ?? 0
			if (len > longest) longest = len
		}
		return Math.max(min, Math.min(max, longest * 7.5 + 28))
	})
