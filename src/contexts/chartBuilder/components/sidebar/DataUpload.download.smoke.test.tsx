import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { buildDataset } from "../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import type { DerivedVariablesConfig } from "../../lib/derivedVariables"
import type { Dataset } from "../../lib/types"
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

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

/** The "download data" link hands the bound dataset back as a CSV. It sits
 *  after the version in the summary line and exports the RAW rows of the
 *  version shown: cells exactly as imported ("$1,200" stays "$1,200"), the
 *  visual's per-visual derived columns left out, and hand edits (which are
 *  saved as dataset versions) in place. An imported version downloads under
 *  its own file name; an edited one under the dataset's slug. The save goes
 *  through saveFile.ts; jsdom
 *  has no Save-as dialog, so these tests see its anchor-download fallback
 *  (the dialog path is covered in lib/downloadDataset.test.ts). */

const ID = "ds-download"

const fields = [
	{ name: "region", inferredType: "categorical" as const },
	{ name: "revenue", inferredType: "quantitative" as const },
]

const dataset = () =>
	buildDataset({
		id: ID,
		name: "Q3 Sales",
		fields,
		rows: [
			{ region: "East", revenue: "$1,200" },
			{ region: "West", revenue: "$800" },
		],
	})

/** The same dataset after the East row was hand-edited in the data tray:
 *  the edit is a second version marked `editedFrom` the import. */
const editedDataset = () =>
	buildDataset({
		id: ID,
		name: "Q3 Sales",
		fields,
		versions: [
			{
				id: "v1",
				filename: "sales.csv",
				rows: [
					{ region: "East", revenue: "$1,200" },
					{ region: "West", revenue: "$800" },
				],
				createdAt: 0,
			},
			{
				id: "v2",
				filename: "Edited data",
				rows: [
					{ region: "East", revenue: "$1,250" },
					{ region: "West", revenue: "$800" },
				],
				createdAt: 1,
				editedFrom: "v1",
			},
		],
	})

const mount = (ds: Dataset = dataset()) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: ds })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	/* eslint-enable @vc/use-wrapped-json-functions */
	// A derived variable keeps the RENDERED view different from the raw one,
	// so the test can tell that the download serialized the raw one.
	const derived: DerivedVariablesConfig = {
		variables: [
			{ id: "dv-1", name: "doubled", kind: "math", math: { formula: "{revenue} * 2" } },
		],
	}
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: ds })
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

/** Catch the anchor-download fallback: the blobs handed to the browser and
 *  the filenames they were offered under. */
const captureDownload = () => {
	const blobs: Blob[] = []
	const revokeObjectURL = vi.fn()
	vi.stubGlobal("URL", {
		...URL,
		createObjectURL: vi.fn((b: Blob) => {
			blobs.push(b)
			return "blob:test"
		}),
		revokeObjectURL,
	})
	const downloads: string[] = []
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
		function (this: HTMLAnchorElement) {
			downloads.push(this.download)
		}
	)
	return { blobs, downloads, revokeObjectURL }
}

const clickDownload = async (capture: ReturnType<typeof captureDownload>) => {
	fireEvent.click(screen.getByRole("button", { name: "download data" }))
	// Asking for a save target is async even without a dialog.
	await waitFor(() => expect(capture.downloads).toHaveLength(1))
	expect(capture.blobs).toHaveLength(1)
	return capture.blobs[0]!.text()
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

	it("downloads the raw rows as imported, without per-visual derived columns", async () => {
		const capture = captureDownload()
		mount()
		const text = await clickDownload(capture)
		// The dollar cells go out as imported, and the visual's "doubled"
		// derived column stays behind.
		expect(text).toBe('\uFEFFregion,revenue\nEast,"$1,200"\nWest,$800')
		// The object URL is revoked after a short deferral (saveFile.ts).
		await waitFor(
			() => expect(capture.revokeObjectURL).toHaveBeenCalledWith("blob:test"),
			{ timeout: 2000 }
		)
	})

	it("downloads hand-edited values, not the import they were edited from", async () => {
		const capture = captureDownload()
		mount(editedDataset())
		expect(
			screen.getByRole("button", { name: "download data" }).parentElement
				?.textContent
		).toMatch(/v2 of 2/)
		const text = await clickDownload(capture)
		expect(text).toBe('\uFEFFregion,revenue\nEast,"$1,250"\nWest,$800')
	})

	it("names an imported version after its own file", async () => {
		const capture = captureDownload()
		mount(
			buildDataset({
				id: ID,
				name: "Q3 Sales",
				fields,
				versions: [
					{
						id: "v1",
						filename: "2024.csv",
						rows: [{ region: "East", revenue: "$1,200" }],
						createdAt: 0,
					},
				],
			})
		)
		await clickDownload(capture)
		expect(capture.downloads).toEqual(["2024.csv"])
	})

	it("names an edited version after the dataset", async () => {
		const capture = captureDownload()
		mount(editedDataset())
		await clickDownload(capture)
		expect(capture.downloads).toEqual(["q3-sales.csv"])
	})
})
