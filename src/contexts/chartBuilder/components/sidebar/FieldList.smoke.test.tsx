import { cleanup, createEvent, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import type { Dataset, Field } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { FieldList } from "./FieldList"

/** Smoke coverage for the level-reorder panel's "Order by" picker: it lists
 *  Alphabetical + quantitative/temporal fields, pins the computed order
 *  (sum asc / Decreasing reversed / earliest date), the "in <level> of
 *  <variable>" scope restricts which rows feed the aggregate (the dumbbell
 *  case), and a manual ↑/↓ move afterwards still works while dropping the
 *  picker back to "—". */

// Explicit cleanup: this file imports vitest APIs directly (no globals), so
// testing-library's automatic afterEach unmount never registers.
afterEach(cleanup)

const ID = "ds-field-list"

const FIELDS: Field[] = [
	{ name: "region", inferredType: "categorical" },
	// Deliberately quantitative: a numeric year column must still qualify as
	// a scope variable ("in the 2023 level of year").
	{ name: "year", inferredType: "quantitative" },
	{ name: "sales", inferredType: "quantitative" },
	{ name: "start", inferredType: "temporal" },
	{ name: "notes", inferredType: "categorical" },
]

// Discovery order B, A, C. Sums: B=9, A=6, C=8 → asc A,C,B / desc B,C,A.
// 2023-only sales: B=1, C=3, A=5 → asc B,C,A (≠ unscoped asc).
// Earliest starts: C=2021, B=2022, A=2023 → C,B,A.
const ROWS = [
	{ region: "B", year: "2023", sales: "1", start: "2024-01-01", notes: "n1" },
	{ region: "B", year: "2024", sales: "8", start: "2022-01-01", notes: "n2" },
	{ region: "A", year: "2023", sales: "5", start: "2023-01-01", notes: "n3" },
	{ region: "A", year: "2024", sales: "1", start: "2023-06-01", notes: "n4" },
	{ region: "C", year: "2023", sales: "3", start: "2021-01-01", notes: "n5" },
	{ region: "C", year: "2024", sales: "5", start: "2025-01-01", notes: "n6" },
]

const buildDataset = (fields: Field[] = FIELDS): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "fieldlist",
		filename: "fieldlist.csv",
		fields,
		rows: ROWS,
	})

const mount = (fields: Field[] = FIELDS) => {
	// Atom storage effects re-load from localStorage on init and would reset a
	// snapshot-only seed to defaults, so the fixture goes into BOTH.
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset(fields) })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset(fields) })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(
		<TestProvider initializeState={init}>
			<FieldList />
		</TestProvider>
	)
}

/** The level rows are the nested <li>s inside a field's reorder panel. */
const levelValues = (container: HTMLElement): Array<string | null> =>
	[...container.querySelectorAll("li li span[title]")].map((el) =>
		el.getAttribute("title")
	)

const openRegionPanel = (utils: ReturnType<typeof render>) => {
	fireEvent.click(utils.getByRole("button", { name: "Reorder levels of region" }))
}

const pickOrderBy = (utils: ReturnType<typeof render>, value: string) => {
	fireEvent.change(utils.getByLabelText("Order by"), { target: { value } })
}

/** The draggable level rows, in display order. */
const levelRows = (container: HTMLElement): HTMLElement[] =>
	[...container.querySelectorAll("li li")] as HTMLElement[]

/** happy-dom's DataTransfer has no usable setData and its DragEvent drops
 *  clientY, so both are supplied by hand — same shape as the FolderTree
 *  drag tests. */
const makeFakeDataTransfer = () => {
	const data = new Map<string, string>()
	return {
		setData: (type: string, value: string) => {
			data.set(type, value)
		},
		getData: (type: string) => data.get(type) ?? "",
		setDragImage: () => {},
	}
}

/** Drag `source` onto `target`, landing in its top or bottom half — the
 *  half is what picks the insertion gap, so happy-dom's all-zero rect has
 *  to be replaced with a real one. */
const dragTo = (
	source: HTMLElement,
	target: HTMLElement,
	half: "top" | "bottom"
) => {
	const dataTransfer = makeFakeDataTransfer()
	const top = 100
	const height = 20
	target.getBoundingClientRect = () =>
		({
			top,
			height,
			bottom: top + height,
			left: 0,
			right: 0,
			width: 100,
			x: 0,
			y: top,
		}) as DOMRect
	const clientY = half === "top" ? top + 1 : top + height - 1
	const dragEvent = (kind: "dragOver" | "drop", node: HTMLElement) => {
		const event = createEvent[kind](node, { dataTransfer })
		Object.defineProperty(event, "clientY", { value: clientY })
		fireEvent(node, event)
	}
	fireEvent.dragStart(source, { dataTransfer })
	dragEvent("dragOver", target)
	dragEvent("drop", target)
	fireEvent.dragEnd(source, { dataTransfer })
}

describe("FieldList — Order by picker", () => {
	it("offers Alphabetical plus the quantitative/temporal fields", () => {
		const utils = mount()
		openRegionPanel(utils)
		const select = utils.getByLabelText("Order by") as HTMLSelectElement
		expect([...select.options].map((o) => o.value)).toEqual([
			"",
			"alpha",
			"f:year",
			"f:sales",
			"f:start",
		])
	})

	it("pins the sum-ascending order when a quantitative field is picked", () => {
		const utils = mount()
		openRegionPanel(utils)
		// Unpinned categorical levels display in discovery order.
		expect(levelValues(utils.container)).toEqual(["B", "A", "C"])
		pickOrderBy(utils, "f:sales")
		expect(levelValues(utils.container)).toEqual(["A", "C", "B"])
	})

	it("shows Decreasing only after a key is picked, and reverses on toggle", () => {
		const utils = mount()
		openRegionPanel(utils)
		expect(utils.queryByLabelText("Decreasing")).toBeNull()
		pickOrderBy(utils, "f:sales")
		fireEvent.click(utils.getByLabelText("Decreasing"))
		expect(levelValues(utils.container)).toEqual(["B", "C", "A"])
	})

	it("orders by earliest date for a temporal field", () => {
		const utils = mount()
		openRegionPanel(utils)
		pickOrderBy(utils, "f:start")
		expect(levelValues(utils.container)).toEqual(["C", "B", "A"])
	})

	it("Alphabetical orders the level names and offers no scope", () => {
		const utils = mount()
		openRegionPanel(utils)
		pickOrderBy(utils, "alpha")
		expect(levelValues(utils.container)).toEqual(["A", "B", "C"])
		expect(utils.queryByLabelText("in")).toBeNull()
	})

	it("scopes the aggregate to one level of another variable (dumbbell)", () => {
		const utils = mount()
		openRegionPanel(utils)
		pickOrderBy(utils, "f:sales")
		expect(levelValues(utils.container)).toEqual(["A", "C", "B"])
		// Scope variables: every field except region (reordered) and sales
		// (the order-by field) — the numeric year column must qualify.
		const scopeVar = utils.getByLabelText("in") as HTMLSelectElement
		expect([...scopeVar.options].map((o) => o.value)).toEqual([
			"",
			"year",
			"start",
			"notes",
		])
		fireEvent.change(scopeVar, { target: { value: "year" } })
		const scopeLevel = utils.getByLabelText("Level of year") as HTMLSelectElement
		expect([...scopeLevel.options].map((o) => o.value)).toEqual([
			"",
			"2023",
			"2024",
		])
		fireEvent.change(scopeLevel, { target: { value: "2023" } })
		// 2023 sales only: B=1, C=3, A=5.
		expect(levelValues(utils.container)).toEqual(["B", "C", "A"])
	})

	it("manual arrows still work after an order-by and reset the picker to —", () => {
		const utils = mount()
		openRegionPanel(utils)
		const select = utils.getByLabelText("Order by") as HTMLSelectElement
		pickOrderBy(utils, "f:sales")
		expect(levelValues(utils.container)).toEqual(["A", "C", "B"])
		// Move the last row ("B") up one slot.
		const upButtons = utils.getAllByTitle("Move up")
		fireEvent.click(upButtons[2]!)
		expect(levelValues(utils.container)).toEqual(["A", "B", "C"])
		expect(select.value).toBe("")
	})

	it("hides the picker entirely when no quantitative/temporal fields exist", () => {
		const utils = mount([
			{ name: "region", inferredType: "categorical" },
			{ name: "notes", inferredType: "categorical" },
		])
		openRegionPanel(utils)
		expect(utils.queryByLabelText("Order by")).toBeNull()
	})
})

describe("FieldList — drag to reorder levels", () => {
	it("drops a row into the gap above the target", () => {
		const utils = mount()
		openRegionPanel(utils)
		expect(levelValues(utils.container)).toEqual(["B", "A", "C"])
		const rows = levelRows(utils.container)
		// Drag "C" onto the top half of "B" → C, B, A.
		dragTo(rows[2]!, rows[0]!, "top")
		expect(levelValues(utils.container)).toEqual(["C", "B", "A"])
	})

	it("drops a row into the gap below the target", () => {
		const utils = mount()
		openRegionPanel(utils)
		const rows = levelRows(utils.container)
		// Drag "B" onto the bottom half of "C" → A, C, B.
		dragTo(rows[0]!, rows[2]!, "bottom")
		expect(levelValues(utils.container)).toEqual(["A", "C", "B"])
	})

	it("resets the Order by picker like a manual arrow move does", () => {
		const utils = mount()
		openRegionPanel(utils)
		const select = utils.getByLabelText("Order by") as HTMLSelectElement
		pickOrderBy(utils, "f:sales")
		expect(levelValues(utils.container)).toEqual(["A", "C", "B"])
		const rows = levelRows(utils.container)
		dragTo(rows[2]!, rows[0]!, "top")
		expect(levelValues(utils.container)).toEqual(["B", "A", "C"])
		expect(select.value).toBe("")
	})

	it("leaves the order alone when a row is dropped on itself", () => {
		const utils = mount()
		openRegionPanel(utils)
		const rows = levelRows(utils.container)
		dragTo(rows[1]!, rows[1]!, "top")
		expect(levelValues(utils.container)).toEqual(["B", "A", "C"])
	})
})

describe("FieldList — reverse link", () => {
	it("flips the smart-sort default order in one click", () => {
		const utils = mount()
		openRegionPanel(utils)
		expect(levelValues(utils.container)).toEqual(["B", "A", "C"])
		fireEvent.click(utils.getByText("reverse"))
		expect(levelValues(utils.container)).toEqual(["C", "A", "B"])
	})

	it("flips a computed order and drops the picker back to —", () => {
		const utils = mount()
		openRegionPanel(utils)
		const select = utils.getByLabelText("Order by") as HTMLSelectElement
		pickOrderBy(utils, "f:sales")
		expect(levelValues(utils.container)).toEqual(["A", "C", "B"])
		fireEvent.click(utils.getByText("reverse"))
		expect(levelValues(utils.container)).toEqual(["B", "C", "A"])
		expect(select.value).toBe("")
	})
})
