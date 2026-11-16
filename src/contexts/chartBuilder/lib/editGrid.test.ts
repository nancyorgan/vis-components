import { describe, expect, it } from "vitest"
import {
	addColumn,
	addRow,
	applySort,
	clearRect,
	columnWidths,
	deleteColumns,
	deleteRows,
	freshColumnName,
	gridFromView,
	gridIssue,
	gridToCsv,
	makeChangedLookup,
	nextSort,
	normalizeRange,
	parseClipboardBlock,
	pasteBlock,
	rectToTsv,
	renameColumn,
	setCell,
	type Grid,
} from "./editGrid"
import type { DatasetView } from "./types"

const view = (): DatasetView => ({
	id: "ds",
	name: "sales",
	filename: "sales.csv",
	fields: [
		{ name: "city", inferredType: "categorical" },
		{ name: "sales", inferredType: "quantitative" },
	],
	rows: [
		{ city: "Lima", sales: "10" },
		{ city: "Quito", sales: "20" },
		{ city: "Bogotá", sales: "5" },
	],
	createdAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

const shown = (grid: Grid) =>
	grid.order.map((i) => grid.rows[i]!.cells.join(","))

describe("editGrid", () => {
	it("seeds from the view and round-trips to the same CSV the text box held", () => {
		const grid = gridFromView(view())
		expect(grid.columns.map((c) => c.name)).toEqual(["city", "sales"])
		expect(shown(grid)).toEqual(["Lima,10", "Quito,20", "Bogotá,5"])
		expect(gridToCsv(grid)).toBe("city,sales\nLima,10\nQuito,20\nBogotá,5")
		expect(gridIssue(grid)).toBeNull()
	})

	it("drops all-blank rows from the CSV and quotes what needs quoting", () => {
		let grid = addRow(gridFromView(view()))
		grid = setCell(grid, 0, 0, 'Lima, "la gris"')
		expect(gridToCsv(grid)).toBe(
			'city,sales\n"Lima, ""la gris""",10\nQuito,20\nBogotá,5'
		)
	})

	it("names the header problems and an empty table", () => {
		const grid = gridFromView(view())
		expect(gridIssue(renameColumn(grid, 1, " "))).toBe("Every column needs a name.")
		expect(gridIssue(renameColumn(grid, 1, "city"))).toContain("must be unique")
		expect(gridIssue(deleteColumns(grid, 0, 1))).toBe("Add at least one column.")
		expect(gridIssue(clearRect(grid, normalizeRange({ anchor: { pos: 0, col: 0 }, focus: { pos: 2, col: 1 } })))).toBe(
			"Enter at least one data row."
		)
	})

	it("setCell edits by SHOWN position and returns the same grid for a no-op", () => {
		const grid = applySort(gridFromView(view()), { col: 1, dir: "asc" })
		expect(shown(grid)).toEqual(["Bogotá,5", "Lima,10", "Quito,20"])
		const next = setCell(grid, 0, 1, "6")
		// Position 0 is Bogotá, which is rows[2].
		expect(next.rows[2]!.cells).toEqual(["Bogotá", "6"])
		expect(next.rows[0]).toBe(grid.rows[0])
		expect(setCell(next, 0, 1, "6")).toBe(next)
	})

	it("sorts the shown order only — row order (and the CSV) is unchanged", () => {
		const grid = gridFromView(view())
		const desc = applySort(grid, { col: 1, dir: "desc" })
		expect(shown(desc)).toEqual(["Quito,20", "Lima,10", "Bogotá,5"])
		expect(gridToCsv(desc)).toBe(gridToCsv(grid))
		// A column's control goes ascending first, then flips between the two
		// — never back to unsorted; another column starts ascending again.
		expect(nextSort(null, 1)).toEqual({ col: 1, dir: "asc" })
		expect(nextSort({ col: 1, dir: "asc" }, 1)).toEqual({ col: 1, dir: "desc" })
		expect(nextSort({ col: 1, dir: "desc" }, 1)).toEqual({ col: 1, dir: "asc" })
		expect(nextSort({ col: 1, dir: "desc" }, 0)).toEqual({ col: 0, dir: "asc" })
	})

	it("adds rows at the end of the shown order and columns with fresh names", () => {
		let grid = applySort(gridFromView(view()), { col: 0, dir: "asc" })
		grid = addRow(grid)
		expect(shown(grid)).toEqual(["Bogotá,5", "Lima,10", "Quito,20", ","])
		expect(grid.rows[3]!.key).toBe(3)
		expect(freshColumnName(grid)).toBe("Column 3")
		grid = addColumn(grid)
		expect(grid.columns.map((c) => c.name)).toEqual(["city", "sales", "Column 3"])
		expect(grid.rows.every((r) => r.cells.length === 3)).toBe(true)
		// The fresh name skips one that's taken.
		expect(freshColumnName(renameColumn(grid, 2, "Column 4"))).toBe("Column 5")
	})

	it("deletes rows by shown position and keeps the order pointing at survivors", () => {
		const grid = applySort(gridFromView(view()), { col: 1, dir: "desc" })
		// Shown: Quito, Lima, Bogotá. Delete the middle one (Lima = rows[0]).
		const next = deleteRows(grid, 1, 1)
		expect(next.rows.map((r) => r.cells[0])).toEqual(["Quito", "Bogotá"])
		expect(shown(next)).toEqual(["Quito,20", "Bogotá,5"])
		expect(deleteRows(next, 5, 9)).toBe(next)
	})

	it("deletes a column span from every row", () => {
		const grid = addColumn(gridFromView(view()))
		const next = deleteColumns(grid, 1, 1)
		expect(next.columns.map((c) => c.name)).toEqual(["city", "Column 3"])
		expect(next.rows[0]!.cells).toEqual(["Lima", ""])
	})

	it("copies a rectangle as TSV and parses spreadsheet clipboard text", () => {
		const grid = setCell(gridFromView(view()), 0, 0, "Lima\t(capital)")
		const rect = normalizeRange({ anchor: { pos: 1, col: 1 }, focus: { pos: 0, col: 0 } })
		expect(rect).toEqual({ top: 0, bottom: 1, left: 0, right: 1 })
		expect(rectToTsv(grid, rect)).toBe('"Lima\t(capital)"\t10\nQuito\t20')
		expect(parseClipboardBlock("a\tb\r\nc\td\n")).toEqual([
			["a", "b"],
			["c", "d"],
		])
		expect(parseClipboardBlock('"x\ty"\t1')).toEqual([["x\ty", "1"]])
		expect(parseClipboardBlock("")).toEqual([[""]])
		expect(parseClipboardBlock("solo")).toEqual([["solo"]])
	})

	it("pastes a block from the top-left, growing rows and clipping columns", () => {
		const grid = gridFromView(view())
		const { grid: next, rect } = pasteBlock(
			grid,
			{ top: 2, bottom: 2, left: 1, right: 1 },
			[
				["7", "ignored"],
				["8"],
			]
		)
		expect(shown(next)).toEqual(["Lima,10", "Quito,20", "Bogotá,7", ",8"])
		expect(rect).toEqual({ top: 2, bottom: 3, left: 1, right: 1 })
	})

	it("fills the whole selection with a single pasted value", () => {
		const grid = gridFromView(view())
		const { grid: next, rect } = pasteBlock(
			grid,
			{ top: 0, bottom: 2, left: 1, right: 1 },
			[["0"]]
		)
		expect(shown(next)).toEqual(["Lima,0", "Quito,0", "Bogotá,0"])
		expect(rect).toEqual({ top: 0, bottom: 2, left: 1, right: 1 })
	})

	it("knows which cells differ from the seed through sorts, renames and deletions", () => {
		const seed = gridFromView(view())
		const changed = makeChangedLookup(seed)
		let grid = applySort(seed, { col: 1, dir: "desc" }) // Quito, Lima, Bogotá
		grid = setCell(grid, 1, 1, "11") // Lima's sales
		grid = renameColumn(grid, 1, "revenue")
		grid = deleteRows(grid, 0, 0) // drop Quito → Lima, Bogotá
		expect(changed(grid, 0, 1)).toBe(true)
		expect(changed(grid, 0, 0)).toBe(false)
		expect(changed(grid, 1, 1)).toBe(false)
		// A new column counts as changed only where it holds something.
		grid = addColumn(grid)
		expect(changed(grid, 0, 2)).toBe(false)
		grid = setCell(grid, 0, 2, "x")
		expect(changed(grid, 0, 2)).toBe(true)
		// A new row likewise.
		grid = addRow(grid)
		expect(changed(grid, 2, 0)).toBe(false)
		expect(changed(setCell(grid, 2, 0, "Cusco"), 2, 0)).toBe(true)
	})

	it("sizes columns from the longest text, clamped", () => {
		const grid = gridFromView(view())
		const [city, sales] = columnWidths(grid, { min: 50, max: 100 })
		// "city" + the sort glyph's allowance beats "Bogotá"; "sales" likewise.
		expect(city).toBe(("city".length + 3) * 7.5 + 28)
		expect(sales).toBe(("sales".length + 3) * 7.5 + 28)
		expect(columnWidths(renameColumn(grid, 0, "x".repeat(200)), { max: 100 })[0]).toBe(100)
	})
})

describe("pasteBlock — large blocks", () => {
	it("sizes a block with more lines than a call takes arguments", () => {
		// Seeded tall enough that the paste fills rows rather than adding them.
		const rows = Array.from({ length: 200_000 }, () => ({ city: "x", sales: "1" }))
		const block = rows.map((_, i) => (i === 7 ? ["a", "b"] : ["a"]))
		const at = { top: 0, bottom: 0, left: 0, right: 0 }
		const { rect } = pasteBlock(gridFromView({ ...view(), rows }), at, block)
		expect(rect).toEqual({ top: 0, bottom: 199_999, left: 0, right: 1 })
	})
})
