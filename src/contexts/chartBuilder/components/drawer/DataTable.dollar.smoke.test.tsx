import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import type { Dataset, Field } from "../../lib/types"
import { currentDatasetIdAtom, loadedDatasetsAtom } from "../../store/atoms"

import { DataTable } from "./DataTable"

/** The data tray keeps imported currency/comma formatting on screen even
 *  though the view stores those columns as plain numbers. */

afterEach(cleanup)

const ID = "ds-dollar-tray"

const FIELDS: Field[] = [
	{ name: "store", inferredType: "categorical" },
	{ name: "Revenue", inferredType: "quantitative" },
	{ name: "Units", inferredType: "quantitative" },
]

const ROWS = [
	{ store: "A", Revenue: "$1,234.56", Units: "1,200" },
	{ store: "B", Revenue: "($900)", Units: "42" },
]

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "dollars",
		filename: "dollars.csv",
		fields: FIELDS,
		rows: ROWS,
	})

const mount = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(ID))
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
	}
	return render(
		<TestProvider initializeState={init}>
			<DataTable />
		</TestProvider>
	)
}

describe("DataTable currency display", () => {
	it("shows dollar and comma-grouped cells the way they were imported", () => {
		const utils = mount()
		expect(utils.getByText("$1,234.56")).toBeTruthy()
		expect(utils.getByText("($900)")).toBeTruthy()
		expect(utils.getByText("1,200")).toBeTruthy()
		// The plain cell in a converted column is untouched.
		expect(utils.getByText("42")).toBeTruthy()
		// Nothing leaks the converted numeric form.
		expect(utils.queryByText("1234.56")).toBeNull()
		expect(utils.queryByText("-900")).toBeNull()
	})
})
