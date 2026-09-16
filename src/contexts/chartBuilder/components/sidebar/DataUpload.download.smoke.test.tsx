import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { buildDataset } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import type { DerivedVariablesConfig } from "../../lib/derivedVariables"
import {
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"
import { DataUpload } from "./DataUpload"

// The upload-prompt modal inside DataUpload calls `useNavigate`; stubbing it
// beats standing up a RouterProvider for a link assertion.
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => () => {},
}))

afterEach(cleanup)

/** The "download data" link hands the bound dataset back as a CSV. It sits
 *  after the version in the summary line and exports the RAW rows — cells as
 *  imported, and none of the per-visual derived columns. */

const ID = "ds-download"

const dataset = () =>
	buildDataset({
		id: ID,
		name: "Q3 Sales",
		fields: [
			{ name: "region", inferredType: "categorical" },
			{ name: "revenue", inferredType: "quantitative" },
		],
		rows: [
			{ region: "East", revenue: "$1,200" },
			{ region: "West", revenue: "$800" },
		],
	})

const mount = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: dataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	/* eslint-enable @th/use-wrapped-json-functions */
	// A derived variable keeps the RENDERED view different from the raw one,
	// so the test can tell which of the two the download serialized.
	const derived: DerivedVariablesConfig = {
		variables: [
			{ id: "dv-1", name: "doubled", kind: "math", math: { formula: "{revenue} * 2" } },
		],
	}
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: dataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentDerivedVariablesAtom, derived)
	}
	return render(
		<TestProvider initializeState={init}>
			<DataUpload />
		</TestProvider>
	)
}

describe("DataUpload download link", () => {
	it("follows the version in the summary line", () => {
		mount()
		const link = screen.getByRole("button", { name: "download data" })
		expect(link.className).toContain("underline")
		expect(link.parentElement?.textContent).toMatch(
			/2 rows · 3 fields · v1 · download data$/
		)
	})

	it("downloads the raw rows as a CSV named after the dataset", async () => {
		const blobs: Blob[] = []
		const createObjectURL = vi.fn((b: Blob) => {
			blobs.push(b)
			return "blob:test"
		})
		const revokeObjectURL = vi.fn()
		vi.stubGlobal("URL", {
			...URL,
			createObjectURL,
			revokeObjectURL,
		})
		const clicks: HTMLAnchorElement[] = []
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(function (this: HTMLAnchorElement) {
				clicks.push(this)
			})
		try {
			mount()
			fireEvent.click(screen.getByRole("button", { name: "download data" }))
			expect(clicks).toHaveLength(1)
			expect(clicks[0]?.download).toBe("q3-sales.csv")
			expect(revokeObjectURL).toHaveBeenCalledWith("blob:test")
			expect(blobs).toHaveLength(1)
			const text = await blobs[0]!.text()
			// Raw cells, raw header — no "doubled" column, dollars untouched.
			expect(text).toBe('region,revenue\nEast,"$1,200"\nWest,$800')
		} finally {
			click.mockRestore()
			vi.unstubAllGlobals()
		}
	})
})
