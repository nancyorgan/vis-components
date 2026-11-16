import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { emptyEncodings, type Dataset, type Field } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentEncodingsAtom,
	drawerOpenAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { DataDrawer } from "./DataDrawer"

/** The tray's Edit dialog: the first edit of imported data forks a new data
 *  set (a copy of the shown version as v1, the edit as v2) that the editor
 *  moves onto, the table outlines the changed cells, and editing the copy
 *  again appends a version instead of forking once more. Column names are
 *  not editable here (that is the Fields panel's job). The data is edited in a grid of
 *  cells: see the "grid" block below for its selection, clipboard, sort and
 *  row / column manners. */

afterEach(cleanup)

const ID = "ds-edit-tray"

const FIELDS: Field[] = [
	{ name: "city", inferredType: "categorical" },
	{ name: "sales", inferredType: "quantitative" },
]

const ROWS = [
	{ city: "Lima", sales: "10" },
	{ city: "Quito", sales: "20" },
	{ city: "Bogotá", sales: "30" },
]

const imported = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "sales",
		filename: "sales.csv",
		fields: FIELDS,
		rows: ROWS,
	})

const handEdited = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "sales (edited)",
		fields: FIELDS,
		versions: [
			{ id: "v1", filename: "sales.csv", rows: ROWS, createdAt: 0 },
			{
				id: "v2",
				filename: "Edited data",
				rows: [ROWS[0]!, { city: "Quito", sales: "25" }, ROWS[2]!],
				createdAt: 1,
				editedFrom: "v1",
			},
		],
	})

const mount = (dataset: Dataset) => {
	const storage = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	storage.set("vis-components:datasets", JSON.stringify({ [ID]: dataset }))
	storage.set("vis-components:currentDatasetId", JSON.stringify(ID))
	/* eslint-enable @vc/use-wrapped-json-functions */
	let store: TestStore | null = null
	render(
		<TestProvider
			initializeState={(s) => {
				store = s
				s.set(drawerOpenAtom, true)
				s.set(loadedDatasetsAtom, { [ID]: dataset })
				s.set(currentDatasetIdAtom, ID)
				s.set(previewVersionIdAtom, null)
				s.set(currentEncodingsAtom, {
					...emptyEncodings(),
					x: { field: "city" },
					y: { field: "sales" },
				})
			}}
		>
			<DataDrawer />
		</TestProvider>
	)
	return store!
}

const openDialog = () => {
	fireEvent.click(screen.getByText("Edit"))
	return screen.getByRole("dialog")
}

/** The grid's data rows (not the blank "add a row" line under them). */
const dataRows = (): HTMLElement[] =>
	[...screen.getByRole("grid").querySelectorAll("tbody tr[role=row]")].filter(
		(tr) => tr.querySelector("td[role=gridcell]") !== null
	) as HTMLElement[]

/** The grid's cells in shown order, as rows of text. */
const gridRows = (): string[][] =>
	dataRows().map((tr) =>
		[...tr.querySelectorAll("td[role=gridcell]")].map((td) => td.textContent ?? "")
	)

const cell = (pos: number, col: number): HTMLElement => {
	const td = dataRows()[pos]?.querySelectorAll("td[role=gridcell]")[col]
	if (!td) throw new Error(`no cell at ${pos},${col}`)
	return td as HTMLElement
}

const proxy = () => screen.getByLabelText("Selected cells") as HTMLTextAreaElement

/** The grid's header cell for a column. */
const header = (name: string): HTMLElement =>
	within(screen.getByRole("grid"))
		.getAllByRole("columnheader")
		.find((h) => h.querySelector("span")?.textContent === name) ??
	(() => {
		throw new Error(`no column header "${name}"`)
	})()

const menuItems = () =>
	within(screen.getByRole("menu"))
		.getAllByRole("menuitem")
		.map((b) => b.textContent)

/** Double-click a cell, type a value, press Enter. */
const typeInto = (pos: number, col: number, value: string) => {
	fireEvent.doubleClick(cell(pos, col))
	const input = screen.getByLabelText("Cell value") as HTMLInputElement
	fireEvent.change(input, { target: { value } })
	fireEvent.keyDown(input, { key: "Enter" })
}

/** Paste tab-separated text with the given cell as the top-left corner. */
const pasteAt = (pos: number, col: number, tsv: string) => {
	fireEvent.mouseDown(cell(pos, col))
	fireEvent.paste(proxy(), {
		clipboardData: { getData: () => tsv },
	})
}

const selectedCells = (): string[] =>
	[...document.querySelectorAll('td[role=gridcell][aria-selected="true"]')].map(
		(td) => td.textContent ?? ""
	)

/** The data TABLE's hand-edit outlines (the tray behind the dialog). */
const editedCells = () =>
	[...document.querySelectorAll("table:not([role=grid]) td[data-edited]")].map(
		(td) => td.textContent
	)

describe("Edit data in the tray", () => {
	it("forks a new data set from a cell edit and outlines the changed cell", async () => {
		const store = mount(imported())
		const dialog = openDialog()
		expect(dialog.textContent).toContain("creates a new data set version")
		expect(gridRows()).toEqual([
			["Lima", "10"],
			["Quito", "20"],
			["Bogotá", "30"],
		])
		const save = screen.getByText("Save as new data set").closest("button")!
		expect(save.disabled).toBe(true)
		expect(dialog.textContent).toContain("No changes yet.")
		expect(
			(screen.getByLabelText("Data set name") as HTMLInputElement).value
		).toBe("sales (edited)")

		typeInto(1, 1, "25")
		// The dialog outlines the changed cell too.
		expect(cell(1, 1).getAttribute("data-edited")).toBe("true")
		expect(cell(0, 1).getAttribute("data-edited")).toBeNull()
		await waitFor(() =>
			expect(dialog.textContent).toContain(
				"3 rows · 2 columns · 1 cell changed"
			)
		)
		await waitFor(() => expect(save.disabled).toBe(false))
		fireEvent.click(save)

		await waitFor(() => expect(store.get(currentDatasetIdAtom)).not.toBe(ID))
		const newId = store.get(currentDatasetIdAtom)!
		const forked = store.get(loadedDatasetsAtom)[newId]!
		expect(forked.name).toBe("sales (edited)")
		expect(forked.versions.map((v) => v.filename)).toEqual([
			"sales.csv",
			"Edited data",
		])
		expect(forked.versions[1]!.editedFrom).toBe(forked.versions[0]!.id)
		expect(forked.latestVersionId).toBe(forked.versions[1]!.id)
		expect(forked.versions[1]!.rows[1]).toEqual({ city: "Quito", sales: "25" })
		// The imported data set is untouched.
		expect(store.get(loadedDatasetsAtom)[ID]).toEqual(imported())
		expect(screen.queryByRole("dialog")).toBeNull()

		await waitFor(() => expect(editedCells()).toEqual(["25"]))
		expect(document.querySelector("td[data-edited]")!.className).toContain(
			"vc-edited-cell"
		)
	})

	it("refuses unparseable text and an empty name, warns on a colliding name, and cancels cleanly", async () => {
		const store = mount(imported())
		const dialog = openDialog()
		const save = screen.getByText("Save as new data set").closest("button")!

		// Every cell blanked: no data row to save.
		fireEvent.keyDown(proxy(), { key: "a", metaKey: true })
		fireEvent.keyDown(proxy(), { key: "Delete" })
		expect(gridRows()).toEqual([
			["", ""],
			["", ""],
			["", ""],
		])
		expect(dialog.textContent).toContain("at least one data row")
		expect(save.disabled).toBe(true)
		fireEvent.keyDown(proxy(), { key: "z", metaKey: true })
		expect(gridRows()[1]).toEqual(["Quito", "20"])

		// A real change, but no name.
		typeInto(1, 1, "25")
		await waitFor(() => expect(save.disabled).toBe(false))
		const nameBox = screen.getByLabelText("Data set name")
		fireEvent.change(nameBox, { target: { value: "  " } })
		expect(save.disabled).toBe(true)

		// The imported data set's own name: allowed, with the warning.
		fireEvent.change(nameBox, { target: { value: "sales" } })
		expect(dialog.textContent).toContain(
			"A data set named “sales” already exists"
		)
		expect(save.disabled).toBe(false)

		fireEvent.click(screen.getByText("Cancel"))
		expect(screen.queryByRole("dialog")).toBeNull()
		expect(store.get(currentDatasetIdAtom)).toBe(ID)
		expect(Object.keys(store.get(loadedDatasetsAtom))).toEqual([ID])
		expect(editedCells()).toEqual([])
	})

	it("appends a version when the data set is already a hand-edited copy", async () => {
		const store = mount(handEdited())
		await waitFor(() => expect(editedCells()).toEqual(["25"]))
		const dialog = openDialog()
		expect(dialog.textContent).toContain("creates a new data set version")
		typeInto(0, 1, "11")
		fireEvent.click(screen.getByLabelText("Add row"))
		expect(gridRows()).toHaveLength(4)
		pasteAt(3, 0, "Cusco\t5")
		expect(gridRows()[3]).toEqual(["Cusco", "5"])
		await waitFor(() =>
			expect(dialog.textContent).toContain("1 cell changed · 1 row added")
		)
		const save = screen.getByText("Save new version").closest("button")!
		await waitFor(() => expect(save.disabled).toBe(false))
		fireEvent.click(save)

		await waitFor(() =>
			expect(store.get(loadedDatasetsAtom)[ID]!.versions).toHaveLength(3)
		)
		expect(store.get(currentDatasetIdAtom)).toBe(ID)
		const v3 = store.get(loadedDatasetsAtom)[ID]!.versions[2]!
		expect(v3.editedFrom).toBe("v2")
		expect(v3.rows).toHaveLength(4)
		// Outlines accumulate against the import: both hand edits plus the
		// added row's two cells.
		await waitFor(() =>
			expect(editedCells()).toEqual(["11", "25", "Cusco", "5"])
		)
	})

	describe("grid", () => {
		it("sorts the shown rows by a column without reordering the saved rows", async () => {
			const store = mount(imported())
			const dialog = openDialog()
			const sort = screen.getByLabelText("Sort by sales")
			fireEvent.click(sort)
			expect(gridRows().map((r) => r[0])).toEqual(["Lima", "Quito", "Bogotá"])
			fireEvent.click(sort)
			expect(gridRows().map((r) => r[0])).toEqual(["Bogotá", "Quito", "Lima"])
			expect(
				header("sales").getAttribute("aria-sort")
			).toBe("descending")
			// Edit through the sorted view: the top row is Bogotá now.
			typeInto(0, 1, "31")
			await waitFor(() =>
				expect(dialog.textContent).toContain("1 cell changed")
			)
			fireEvent.click(screen.getByText("Save as new data set"))
			await waitFor(() => expect(store.get(currentDatasetIdAtom)).not.toBe(ID))
			const forked =
				store.get(loadedDatasetsAtom)[store.get(currentDatasetIdAtom)!]!
			expect(forked.versions[1]!.rows).toEqual([
				{ city: "Lima", sales: "10" },
				{ city: "Quito", sales: "20" },
				{ city: "Bogotá", sales: "31" },
			])
			// A third click goes back to ascending, not to unsorted; Undo is
			// the way back to the order as opened.
			openDialog()
			const sort2 = screen.getByLabelText("Sort by sales")
			fireEvent.click(sort2)
			fireEvent.click(sort2)
			fireEvent.click(sort2)
			expect(gridRows().map((r) => r[0])).toEqual(["Lima", "Quito", "Bogotá"])
			expect(header("sales").getAttribute("aria-sort")).toBe("ascending")
			fireEvent.click(sort2)
			expect(header("sales").getAttribute("aria-sort")).toBe("descending")
			fireEvent.click(screen.getByText("Undo"))
			fireEvent.click(screen.getByText("Undo"))
			fireEvent.click(screen.getByText("Undo"))
			fireEvent.click(screen.getByText("Undo"))
			expect(header("sales").getAttribute("aria-sort")).toBe("none")
		})

		it("selects by drag, row number and column name; Delete clears, ⌘Z undoes", () => {
			mount(imported())
			openDialog()
			// Drag from (0,0) to (1,1).
			fireEvent.mouseDown(cell(0, 0))
			fireEvent.mouseEnter(cell(1, 1))
			fireEvent.mouseUp(window)
			expect(selectedCells()).toEqual(["Lima", "10", "Quito", "20"])
			fireEvent.keyDown(proxy(), { key: "Delete" })
			expect(gridRows()).toEqual([
				["", ""],
				["", ""],
				["Bogotá", "30"],
			])
			fireEvent.keyDown(proxy(), { key: "z", metaKey: true })
			expect(gridRows()[0]).toEqual(["Lima", "10"])
			fireEvent.keyDown(proxy(), { key: "z", metaKey: true, shiftKey: true })
			expect(gridRows()[0]).toEqual(["", ""])
			fireEvent.click(screen.getByText("Undo"))
			expect(gridRows()[0]).toEqual(["Lima", "10"])

			// A row number selects the row; Shift+click on another extends.
			fireEvent.mouseDown(screen.getByText("3"))
			expect(selectedCells()).toEqual(["Bogotá", "30"])
			fireEvent.mouseDown(screen.getByText("2"), { shiftKey: true })
			expect(selectedCells()).toEqual(["Quito", "20", "Bogotá", "30"])
			// Right-click inside the selection: the menu names what it covers —
			// rows from a row number, columns from a column name.
			fireEvent.contextMenu(screen.getByText("2"))
			expect(menuItems()).toEqual(["Delete 2 rows"])
			fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
			expect(screen.queryByRole("menu")).toBeNull()
			expect(screen.getByRole("dialog")).toBeTruthy()

			// A column name selects the column.
			fireEvent.mouseDown(header("city"))
			expect(selectedCells()).toEqual(["Lima", "Quito", "Bogotá"])
			fireEvent.contextMenu(header("city"))
			expect(menuItems()).toEqual(["Delete column"])
			fireEvent.mouseDown(document.body)
			expect(screen.queryByRole("menu")).toBeNull()

			// Arrows move the focus; Shift+arrow extends.
			fireEvent.mouseDown(cell(0, 0))
			fireEvent.keyDown(proxy(), { key: "ArrowRight" })
			fireEvent.keyDown(proxy(), { key: "ArrowDown", shiftKey: true })
			expect(selectedCells()).toEqual(["10", "20"])
		})

		it("keeps the focus on the first cell of a whole column, row or table", () => {
			mount(imported())
			openDialog()
			/** Where the next keystroke lands: [row, column] of the cell box. */
			const typedInto = () => {
				fireEvent.keyDown(proxy(), { key: "x" })
				const td = screen.getByLabelText("Cell value").closest("td")!
				const tr = td.closest("tr")!
				const at = [
					dataRows().indexOf(tr as HTMLElement),
					[...tr.querySelectorAll("td[role=gridcell]")].indexOf(td),
				]
				fireEvent.keyDown(screen.getByLabelText("Cell value"), { key: "Escape" })
				return at
			}
			// A column name: the top cell, not the last row's.
			fireEvent.mouseDown(header("sales"))
			expect(selectedCells()).toEqual(["10", "20", "30"])
			expect(typedInto()).toEqual([0, 1])
			// A row number: the row's first cell.
			fireEvent.mouseDown(screen.getByText("3"))
			expect(typedInto()).toEqual([2, 0])
			// Select all: the table's first cell.
			fireEvent.keyDown(proxy(), { key: "a", metaKey: true })
			expect(selectedCells()).toHaveLength(6)
			expect(typedInto()).toEqual([0, 0])
			// Shift+click on a column name from a cell takes the columns whole.
			fireEvent.mouseDown(cell(1, 0))
			fireEvent.mouseDown(header("sales"), { shiftKey: true })
			expect(selectedCells()).toEqual(["Lima", "10", "Quito", "20", "Bogotá", "30"])
			// A sort leaves the selection and its focus where they were.
			fireEvent.mouseDown(header("sales"))
			fireEvent.click(screen.getByLabelText("Sort by sales"))
			fireEvent.click(screen.getByLabelText("Sort by sales"))
			expect(selectedCells()).toEqual(["30", "20", "10"])
			expect(typedInto()).toEqual([0, 1])
		})

		it("copies the selection as TSV, pastes a block (growing rows) and fills a range from one value", () => {
			mount(imported())
			openDialog()
			fireEvent.mouseDown(cell(0, 0))
			fireEvent.mouseEnter(cell(1, 1))
			const setData = vi.fn()
			fireEvent.keyDown(proxy(), { key: "c", metaKey: true })
			fireEvent.copy(proxy(), { clipboardData: { setData } })
			expect(setData).toHaveBeenCalledWith("text/plain", "Lima\t10\nQuito\t20")

			// A block pasted at the last row grows the table.
			pasteAt(2, 0, "Cusco\t5\nArequipa\t7\n")
			expect(gridRows()).toEqual([
				["Lima", "10"],
				["Quito", "20"],
				["Cusco", "5"],
				["Arequipa", "7"],
			])
			expect(selectedCells()).toEqual(["Cusco", "5", "Arequipa", "7"])

			// One value over a range fills it.
			fireEvent.mouseDown(cell(0, 1))
			fireEvent.mouseEnter(cell(3, 1))
			fireEvent.paste(proxy(), { clipboardData: { getData: () => "0" } })
			expect(gridRows().map((r) => r[1])).toEqual(["0", "0", "0", "0"])

			// Cut copies then clears.
			fireEvent.mouseDown(cell(0, 0))
			const cutData = vi.fn()
			fireEvent.cut(proxy(), { clipboardData: { setData: cutData } })
			expect(cutData).toHaveBeenCalledWith("text/plain", "Lima")
			expect(gridRows()[0]).toEqual(["", "0"])
		})

		it("writes a typed number the column's way (commas, dollars, percent)", async () => {
			const store = mount(
				buildDatasetFixture({
					id: ID,
					name: "sales",
					fields: [
						{ name: "city", inferredType: "categorical" },
						{ name: "revenue", inferredType: "quantitative" },
						{ name: "cost", inferredType: "quantitative" },
						{ name: "share", inferredType: "quantitative" },
					],
					rows: [
						{ city: "Lima", revenue: "2,123,123", cost: "$1,234.56", share: "14%" },
						{ city: "Quito", revenue: "45", cost: "$0.50", share: "25%" },
					],
				})
			)
			openDialog()
			typeInto(1, 1, "2222")
			typeInto(1, 2, "7")
			typeInto(1, 3, "5")
			// A pasted block is written the same way; text is left alone.
			pasteAt(0, 1, "1234567\tn/a")
			expect(gridRows()).toEqual([
				["Lima", "1,234,567", "n/a", "14%"],
				["Quito", "2,222", "$7.00", "5%"],
			])
			fireEvent.click(screen.getByText("Save as new data set"))
			await waitFor(() => expect(store.get(currentDatasetIdAtom)).not.toBe(ID))
			const forked =
				store.get(loadedDatasetsAtom)[store.get(currentDatasetIdAtom)!]!
			expect(forked.versions[1]!.rows[1]).toEqual({
				city: "Quito",
				revenue: "2,222",
				cost: "$7.00",
				share: "5%",
			})
		})

		it("adds rows and columns from the + cells, deletes them from the right-click menu; typing edits the focus cell", () => {
			mount(imported())
			openDialog()
			fireEvent.click(screen.getByLabelText("Add column"))
			// The new column gets a fresh name (renamed in the Fields panel, not
			// here: there is no name box) and comes in selected.
			expect(screen.queryByLabelText("Column name")).toBeNull()
			expect(header("Column 3")).toBeTruthy()
			expect(selectedCells()).toEqual(["", "", ""])
			expect(gridRows()[0]).toEqual(["Lima", "10", ""])

			// Typing over a selected cell starts an edit with that character.
			fireEvent.mouseDown(cell(0, 2))
			fireEvent.keyDown(proxy(), { key: "S" })
			const input = screen.getByLabelText("Cell value") as HTMLInputElement
			expect(input.value).toBe("S")
			fireEvent.change(input, { target: { value: "South" } })
			fireEvent.keyDown(input, { key: "Tab" })
			expect(gridRows()[0]).toEqual(["Lima", "10", "South"])
			// Escape inside the editor cancels the edit, not the dialog.
			fireEvent.doubleClick(cell(1, 2))
			fireEvent.change(screen.getByLabelText("Cell value"), {
				target: { value: "North" },
			})
			fireEvent.keyDown(screen.getByLabelText("Cell value"), { key: "Escape" })
			expect(gridRows()[1]).toEqual(["Quito", "20", ""])
			expect(screen.getByRole("dialog")).toBeTruthy()

			// Right-clicking a column outside the selection selects it first.
			fireEvent.mouseDown(cell(0, 0))
			fireEvent.contextMenu(header("sales"))
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete column" }))
			expect(screen.queryByRole("menu")).toBeNull()
			expect(gridRows()[0]).toEqual(["Lima", "South"])

			fireEvent.contextMenu(screen.getByText("2"))
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete row" }))
			expect(gridRows()).toEqual([
				["Lima", "South"],
				["Bogotá", ""],
			])
			// The blank line under the data: its + adds a row at the first
			// column, a click in one of its cells adds a row at that column.
			fireEvent.click(screen.getByLabelText("Add row"))
			expect(gridRows()).toHaveLength(3)
			expect(selectedCells()).toEqual([""])
			const blankLine = screen.getByLabelText("Add row").closest("tr")!
			fireEvent.mouseDown(blankLine.querySelectorAll("td")[1]!)
			expect(gridRows()).toHaveLength(4)
			expect(proxy()).toBe(document.activeElement)
			fireEvent.keyDown(proxy(), { key: "E" })
			fireEvent.change(screen.getByLabelText("Cell value"), { target: { value: "East" } })
			fireEvent.keyDown(screen.getByLabelText("Cell value"), { key: "Enter" })
			expect(gridRows()[3]).toEqual(["", "East"])

			// Shift+F10 opens the menu for the keyboard, below the focus cell:
			// a cell is neither a row nor a column, so only its value.
			fireEvent.keyDown(proxy(), { key: "F10", shiftKey: true })
			expect(menuItems()).toEqual(["Delete value"])
			expect(document.activeElement?.getAttribute("role")).toBe("menuitem")
			fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
			// Shift+Space takes the row whole (the keyboard's row number), and
			// then the menu offers the row too.
			fireEvent.keyDown(proxy(), { key: " ", shiftKey: true })
			expect(selectedCells()).toHaveLength(2)
			fireEvent.keyDown(proxy(), { key: "F10", shiftKey: true })
			expect(menuItems()).toEqual(["Delete 2 values", "Delete row"])
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete row" }))
			expect(gridRows()).toHaveLength(3)
			// Ctrl+Space takes the column whole.
			fireEvent.mouseDown(cell(1, 1))
			fireEvent.keyDown(proxy(), { key: " ", ctrlKey: true })
			expect(selectedCells()).toHaveLength(3)
			fireEvent.keyDown(proxy(), { key: "F10", shiftKey: true })
			expect(menuItems()).toEqual(["Delete 3 values", "Delete column"])
		})

		it("right-click: a cell deletes values; only a row number or column name deletes rows or columns", () => {
			mount(imported())
			openDialog()
			// One cell: its value, nothing about its row or column.
			fireEvent.contextMenu(cell(1, 1))
			expect(selectedCells()).toEqual(["20"])
			expect(menuItems()).toEqual(["Delete value"])
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete value" }))
			expect(screen.queryByRole("menu")).toBeNull()
			expect(gridRows()).toEqual([
				["Lima", "10"],
				["Quito", ""],
				["Bogotá", "30"],
			])
			fireEvent.click(screen.getByText("Undo"))

			// Several cells: the menu counts them, and blanks them all.
			fireEvent.mouseDown(cell(0, 0))
			fireEvent.mouseEnter(cell(1, 1))
			fireEvent.mouseUp(window)
			fireEvent.contextMenu(cell(1, 0))
			expect(menuItems()).toEqual(["Delete 4 values"])
			fireEvent.click(screen.getByRole("menuitem", { name: "Delete 4 values" }))
			expect(gridRows()).toEqual([
				["", ""],
				["", ""],
				["Bogotá", "30"],
			])
			fireEvent.click(screen.getByText("Undo"))

			// A row number inside a selection of CELLS takes its row whole
			// first: what "Delete row" removes is what is highlighted.
			fireEvent.mouseDown(cell(0, 0))
			fireEvent.mouseEnter(cell(2, 0))
			fireEvent.mouseUp(window)
			expect(selectedCells()).toEqual(["Lima", "Quito", "Bogotá"])
			fireEvent.contextMenu(screen.getByText("2"))
			expect(selectedCells()).toEqual(["Quito", "20"])
			expect(menuItems()).toEqual(["Delete row"])
			fireEvent.mouseDown(document.body)
			// …and a column name likewise.
			fireEvent.mouseDown(cell(0, 0))
			fireEvent.mouseEnter(cell(0, 1))
			fireEvent.mouseUp(window)
			fireEvent.contextMenu(header("sales"))
			expect(selectedCells()).toEqual(["10", "20", "30"])
			expect(menuItems()).toEqual(["Delete column"])
			fireEvent.mouseDown(document.body)

			// A cell of a whole selected row still offers only the values.
			fireEvent.mouseDown(screen.getByText("3"))
			fireEvent.contextMenu(cell(2, 1))
			expect(selectedCells()).toEqual(["Bogotá", "30"])
			expect(menuItems()).toEqual(["Delete 2 values"])
		})
	})
})
