import { cleanup, createEvent, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { buildDataset } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import type { Field } from "../../lib/types"
import {
	currentDatasetIdAtom,
	currentFieldOrderAtom,
	currentReshapeConfigAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { FieldList } from "./FieldList"

/** Dragging a field row by its handle reorders the VISUAL's columns
 *  (`currentFieldOrderAtom`); every row has a handle, a reshape's minted
 *  columns included. */

afterEach(cleanup)

const ID = "ds-field-reorder"

const FIELDS: Field[] = [
	{ name: "region", inferredType: "categorical" },
	{ name: "year", inferredType: "quantitative" },
	{ name: "sales", inferredType: "quantitative" },
]
const ROWS = [
	{ region: "A", year: "2023", sales: "1" },
	{ region: "B", year: "2024", sales: "2" },
]

const dataset = () => buildDataset({ id: ID, name: "fields", fields: FIELDS, rows: ROWS })

let store: TestStore
const mount = (init?: (s: TestStore) => void) => {
	const storage = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	storage.set("vis-components:datasets", JSON.stringify({ [ID]: dataset() }))
	storage.set("vis-components:currentDatasetId", JSON.stringify(ID))
	storage.set("vis-components:previewVersionId", JSON.stringify(null))
	/* eslint-enable @vc/use-wrapped-json-functions */
	return render(
		<TestProvider
			initializeState={(s) => {
				store = s
				s.set(loadedDatasetsAtom, { [ID]: dataset() })
				s.set(currentDatasetIdAtom, ID)
				s.set(previewVersionIdAtom, null)
				init?.(s)
			}}
		>
			<FieldList />
		</TestProvider>
	)
}

/** The field rows (the top-level <li>s), in display order. */
const rows = (): HTMLElement[] => [...document.querySelectorAll("ul > li")] as HTMLElement[]
const names = (): string[] =>
	rows().map((li) => li.querySelector("label")?.textContent?.replace("Type for ", "") ?? "")
const handleOf = (name: string): HTMLElement => {
	const li = rows()[names().indexOf(name)]
	const handle = li?.querySelector("[data-drag-handle]")
	if (!handle) throw new Error(`no drag handle on ${name}`)
	return handle as HTMLElement
}

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

/** Drop `source` onto the top or bottom half of `target` (a field row). */
const dragTo = (source: HTMLElement, target: HTMLElement, half: "top" | "bottom") => {
	const dataTransfer = makeFakeDataTransfer()
	const top = 100
	const height = 20
	target.getBoundingClientRect = () =>
		({ top, height, bottom: top + height, left: 0, right: 0, width: 100, x: 0, y: top }) as DOMRect
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

describe("FieldList — drag a field row to reorder", () => {
	it("moves the field in the visual's order, leaving the data set alone", async () => {
		mount()
		expect(names()).toEqual(["region", "year", "sales"])
		dragTo(handleOf("sales"), rows()[0]!, "top")
		await waitFor(() => expect(names()).toEqual(["sales", "region", "year"]))
		expect(store.get(currentFieldOrderAtom)).toEqual(["sales", "region", "year"])
		expect(store.get(loadedDatasetsAtom)[ID]!.fields.map((f) => f.name)).toEqual([
			"region",
			"year",
			"sales",
		])
		// Bottom half of the last row: to the end.
		dragTo(handleOf("sales"), rows()[2]!, "bottom")
		await waitFor(() => expect(names()).toEqual(["region", "year", "sales"]))
	})

	it("drags every row while a reshape is applied, minted ones included", async () => {
		mount((s) =>
			s.set(currentReshapeConfigAtom, {
				idFields: ["region"],
				meltFields: ["year", "sales"],
				variableName: "measure",
				valueName: "value",
			})
		)
		expect(names()).toEqual(["region", "measure", "value"])
		dragTo(handleOf("value"), rows()[0]!, "top")
		await waitFor(() => expect(names()).toEqual(["value", "region", "measure"]))
	})
})
