import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { buildDataset } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import type { Dataset, Field } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentReshapeConfigAtom,
	loadedDatasetsAtom,
} from "../../store/atoms"

import { DataTable } from "./DataTable"

/** The hand-edit outlines in the tray: they stay on the right cells when
 *  the table is sorted, and they switch off while a reshape is applied
 *  (melted rows are new rows, with no raw row to compare). */

afterEach(cleanup)

const ID = "ds-edited-table"

const FIELDS: Field[] = [
	{ name: "city", inferredType: "categorical" },
	{ name: "sales", inferredType: "quantitative" },
	{ name: "units", inferredType: "quantitative" },
]

const BASE = [
	{ city: "Lima", sales: "10", units: "1" },
	{ city: "Quito", sales: "20", units: "2" },
	{ city: "Bogotá", sales: "30", units: "3" },
]

const handEdited = (): Dataset =>
	buildDataset({
		id: ID,
		name: "sales (edited)",
		fields: FIELDS,
		versions: [
			{ id: "v1", filename: "sales.csv", rows: BASE, createdAt: 0 },
			{
				id: "v2",
				filename: "Edited data",
				rows: [BASE[0]!, { city: "Quito", sales: "25", units: "2" }, BASE[2]!],
				createdAt: 1,
				editedFrom: "v1",
			},
		],
	})

const mount = (init?: (s: TestStore) => void) => {
	const storage = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	storage.set("vis-components:datasets", JSON.stringify({ [ID]: handEdited() }))
	storage.set("vis-components:currentDatasetId", JSON.stringify(ID))
	/* eslint-enable @vc/use-wrapped-json-functions */
	return render(
		<TestProvider
			initializeState={(s) => {
				s.set(loadedDatasetsAtom, { [ID]: handEdited() })
				s.set(currentDatasetIdAtom, ID)
				init?.(s)
			}}
		>
			<DataTable />
		</TestProvider>
	)
}

const bodyRows = () =>
	[...document.querySelectorAll("tbody tr")].map((tr) => ({
		cells: [...tr.querySelectorAll("td")]
			.slice(0, 3)
			.map((td) => td.textContent),
		edited: [...tr.querySelectorAll("td[data-edited]")].map(
			(td) => td.textContent
		),
	}))

describe("DataTable hand-edit outlines", () => {
	it("outlines the edited cell and keeps it there when the table is sorted", () => {
		const utils = mount()
		expect(bodyRows().map((r) => r.edited)).toEqual([[], ["25"], []])

		// sales ascending, then descending: the outlined cell follows its row.
		fireEvent.click(utils.getByRole("button", { name: /^sales/ }))
		fireEvent.click(utils.getByRole("button", { name: /^sales/ }))
		const rows = bodyRows()
		expect(rows.map((r) => r.cells[0])).toEqual(["Bogotá", "Quito", "Lima"])
		expect(rows.map((r) => r.edited)).toEqual([[], ["25"], []])
	})

	it("outlines nothing while a reshape is applied", () => {
		mount((s) =>
			s.set(currentReshapeConfigAtom, {
				idFields: ["city"],
				meltFields: ["sales", "units"],
				variableName: "measure",
				valueName: "value",
			})
		)
		// The melt doubled the rows; none is outlined.
		expect(document.querySelectorAll("tbody tr")).toHaveLength(6)
		expect(document.querySelectorAll("td[data-edited]")).toHaveLength(0)
	})
})
