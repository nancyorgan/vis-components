import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import {
	currentDatasetIdAtom,
	currentVisualIdAtom,
	drawerOpenAtom,
	loadedDatasetsAtom,
	pendingUploadAtom,
} from "../../store/atoms"
import { DataDrawer } from "./DataDrawer"

/** The data tray takes pasted text as an alternative to a CSV file. With no
 *  Visual open the dialog asks for a name and creates the data set itself;
 *  with one open it hands the parsed rows to the Add-data prompt exactly as
 *  a dropped file would. */

afterEach(cleanup)

const TSV = "city\tsales\nLima\t10\nQuito\t20\nBogotá\t30"

const mount = (init?: (store: TestStore) => void) => {
	let store: TestStore | null = null
	const utils = render(
		<TestProvider
			initializeState={(s) => {
				store = s
				s.set(drawerOpenAtom, true)
				init?.(s)
			}}
		>
			<DataDrawer />
		</TestProvider>
	)
	return { ...utils, store: store! }
}

const openDialog = () => {
	fireEvent.click(screen.getByText("Paste data"))
	return screen.getByRole("dialog")
}

describe("Paste data into the tray", () => {
	it("previews the paste, requires a name, and creates the data set", async () => {
		const { store } = mount()
		expect(screen.getByText(/No data set loaded/).textContent).toContain(
			"paste data"
		)
		const dialog = openDialog()
		const addButton = screen.getByText("Add data").closest("button")!
		expect(addButton.disabled).toBe(true)

		fireEvent.change(screen.getByLabelText("Pasted data"), {
			target: { value: TSV },
		})
		expect(dialog.textContent).toContain("3 rows · 2 columns")
		// The preview is a real table: a header row, then the data rows.
		const headers = dialog.querySelectorAll("th")
		expect([...headers].map((h) => h.textContent)).toEqual(["city", "sales"])
		expect(dialog.querySelectorAll("tbody tr")).toHaveLength(3)
		expect(dialog.querySelector("tbody")?.textContent).toContain("Quito20")
		// Parsed fine, but a new data set needs a name first.
		expect(addButton.disabled).toBe(true)

		fireEvent.change(screen.getByLabelText("Data set name"), {
			target: { value: "Andes sales" },
		})
		expect(addButton.disabled).toBe(false)
		fireEvent.click(addButton)

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
		const id = store.get(currentDatasetIdAtom)
		expect(id).not.toBeNull()
		const dataset = store.get(loadedDatasetsAtom)[id!]
		expect(dataset.name).toBe("Andes sales")
		expect(dataset.fields).toEqual([
			{ name: "city", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
		])
		expect(dataset.versions[0].filename).toBe("Pasted data")
		expect(dataset.versions[0].rows).toHaveLength(3)
		// The tray now shows the pasted rows.
		await waitFor(() => expect(screen.getByText("Bogotá")).toBeTruthy())
	})

	it("explains a paste it cannot use", () => {
		mount()
		const dialog = openDialog()
		fireEvent.change(screen.getByLabelText("Pasted data"), {
			target: { value: "just a header" },
		})
		expect(dialog.textContent).toContain(
			"Paste a header row and at least one data row."
		)
		expect(screen.getByText("Add data").closest("button")!.disabled).toBe(true)
	})

	it("refuses a name another data set already has", () => {
		mount((s) => {
			s.set(loadedDatasetsAtom, {
				"ds-1": {
					id: "ds-1",
					name: "Andes sales",
					fields: [],
					versions: [],
					latestVersionId: "",
					createdAt: 0,
				},
			})
		})
		const dialog = openDialog()
		fireEvent.change(screen.getByLabelText("Pasted data"), {
			target: { value: TSV },
		})
		fireEvent.change(screen.getByLabelText("Data set name"), {
			target: { value: "andes sales" },
		})
		expect(dialog.textContent).toContain("already exists")
		expect(screen.getByText("Add data").closest("button")!.disabled).toBe(true)
	})

	it("hands off to the Add-data prompt when a Visual is open, with no name field", async () => {
		const { store } = mount((s) => {
			s.set(currentVisualIdAtom, "vis-1")
			// Persisted atoms bootstrap from localStorage, which an earlier test
			// in this file wrote to; pin the starting point.
			s.set(currentDatasetIdAtom, null)
			s.set(loadedDatasetsAtom, {})
		})
		openDialog()
		expect(screen.queryByLabelText("Data set name")).toBeNull()
		fireEvent.change(screen.getByLabelText("Pasted data"), {
			target: { value: TSV },
		})
		fireEvent.click(screen.getByText("Add data"))
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
		const pending = store.get(pendingUploadAtom)
		expect(pending?.filename).toBe("Pasted data")
		expect(pending?.rows).toHaveLength(3)
		// Nothing was created directly — that's the prompt's decision.
		expect(store.get(currentDatasetIdAtom)).toBeNull()
		expect(store.get(loadedDatasetsAtom)).toEqual({})
	})

	it("opens pre-filled when tabular text is pasted onto the page", () => {
		mount()
		expect(screen.queryByRole("dialog")).toBeNull()
		const clipboardData = { getData: () => TSV }
		fireEvent.paste(document.body, { clipboardData })
		const dialog = screen.getByRole("dialog")
		expect((screen.getByLabelText("Pasted data") as HTMLTextAreaElement).value).toBe(TSV)
		expect(dialog.textContent).toContain("3 rows · 2 columns")
	})

	it("previews only the first rows of a long paste, and says so", () => {
		mount()
		const dialog = openDialog()
		const long = ["n", ...Array.from({ length: 40 }, (_, i) => String(i))].join("\n")
		fireEvent.change(screen.getByLabelText("Pasted data"), { target: { value: long } })
		expect(dialog.textContent).toContain("40 rows · 1 column · first 6 shown")
		expect(dialog.querySelectorAll("tbody tr")).toHaveLength(6)
	})

	it("leaves a one-word paste alone", () => {
		mount()
		fireEvent.paste(document.body, { clipboardData: { getData: () => "hello" } })
		expect(screen.queryByRole("dialog")).toBeNull()
	})
})
