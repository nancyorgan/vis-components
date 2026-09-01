import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import {
	DEFAULT_DERIVED_VARIABLES_CONFIG,
	type DerivedVariablesConfig,
} from "../../lib/derivedVariables"
import type { Dataset, Field } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	derivedVariableEditorAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { DerivedVariableModal } from "./DerivedVariableModal"

/** Smoke coverage for the derived-variable popup: it renders only while the
 *  editor atom targets something, previews a valid formula against the
 *  current data, flips between the three function bodies, disables Save on a
 *  broken draft, and pre-fills when editing an existing variable. */

// Explicit cleanup: this file imports vitest APIs directly (no globals), so
// testing-library's automatic afterEach unmount never registers — and the
// modal portals into document.body, which must be reset between tests.
afterEach(cleanup)

const ID = "ds-derived-modal"

const FIELDS: Field[] = [
	{ name: "region", inferredType: "categorical" },
	{ name: "sales", inferredType: "quantitative" },
]

const ROWS = [
	{ region: "West", sales: "10" },
	{ region: "East", sales: "9" },
]

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "derived",
		filename: "derived.csv",
		fields: FIELDS,
		rows: ROWS,
	})

const mount = (
	editor: null | { mode: "new" } | { mode: "edit"; id: string },
	config: DerivedVariablesConfig = DEFAULT_DERIVED_VARIABLES_CONFIG
) => {
	// Atom storage effects re-load from localStorage on init and would reset a
	// snapshot-only seed to defaults, so the fixture goes into BOTH.
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentDerivedVariables", { _v: 1, data: config })
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentDerivedVariablesAtom, config)
		// Transient editor target — not persisted, so snapshot-only.
		snap.set(derivedVariableEditorAtom, editor)
	}
	return render(
		<TestProvider initializeState={init}>
			<DerivedVariableModal />
		</TestProvider>
	)
}

describe("DerivedVariableModal", () => {
	it("renders nothing while the editor atom is null", () => {
		const utils = mount(null)
		expect(utils.baseElement.textContent).toBe("")
	})

	it("previews a valid math formula against the current data", () => {
		const utils = mount({ mode: "new" })
		const formula = utils.getByPlaceholderText(
			"{Sales} / {Count}"
		) as HTMLInputElement
		fireEvent.change(formula, { target: { value: "{sales} * 2" } })
		// Preview table: the default-name result column with computed cells.
		expect(utils.getAllByText("Variable 1").length).toBeGreaterThan(0)
		expect(utils.getByText("20")).toBeTruthy()
		expect(utils.getByText("18")).toBeTruthy()
		expect(
			(utils.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled
		).toBe(false)
	})

	it("disables Save and shows the issue for a broken draft", () => {
		const utils = mount({ mode: "new" })
		const formula = utils.getByPlaceholderText(
			"{Sales} / {Count}"
		) as HTMLInputElement
		fireEvent.change(formula, { target: { value: "{profit} + 1" } })
		expect(
			utils.getByText("{profit} isn't a variable in the data.")
		).toBeTruthy()
		expect(
			(utils.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled
		).toBe(true)
	})

	it("disables Save when a math formula reaches a text column", () => {
		const utils = mount({ mode: "new" })
		const formula = utils.getByPlaceholderText(
			"{Sales} / {Count}"
		) as HTMLInputElement
		fireEvent.change(formula, { target: { value: "{sales} * {region}" } })
		expect(
			utils.getByText(
				'{region} isn\'t a number in every row — row 1 is "West". Math needs numeric variables.'
			)
		).toBeTruthy()
		expect(
			(utils.getByRole("button", { name: "Save" }) as HTMLButtonElement)
				.disabled
		).toBe(true)
	})

	it("flips between the three function bodies", () => {
		const utils = mount({ mode: "new" })
		fireEvent.click(utils.getByRole("radio", { name: "If / else" }))
		expect(utils.getByLabelText("Rule 1 condition")).toBeTruthy()
		expect(utils.getByLabelText("Otherwise output")).toBeTruthy()
		fireEvent.click(utils.getByRole("radio", { name: "Combine text" }))
		expect(utils.getByPlaceholderText("Some text: {Region}")).toBeTruthy()
	})

	it("pre-fills when editing an existing variable and offers Delete", () => {
		const utils = mount(
			{ mode: "edit", id: "dvr-1" },
			{
				variables: [
					{
						id: "dvr-1",
						name: "doubled",
						kind: "math",
						math: { formula: "{sales} * 2" },
					},
				],
			}
		)
		expect(
			(utils.getByPlaceholderText("doubled") as HTMLInputElement).value
		).toBe("doubled")
		expect(
			(utils.getByPlaceholderText("{Sales} / {Count}") as HTMLInputElement)
				.value
		).toBe("{sales} * 2")
		expect(utils.getByRole("button", { name: "Delete" })).toBeTruthy()
	})
})
