import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildDataset } from "../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import type { Visual } from "../lib/types"
import {
	currentDatasetIdAtom,
	currentTemplateIdAtom,
	currentVisualNameAtom,
	loadedDatasetsAtom,
	newVisualFolderIdAtom,
	visualsAtom,
} from "../store/atoms"
import { bindDatasetToDraft } from "../store/bindDatasetToDraft"
import { VisualLoaderForExisting, VisualLoaderForNew } from "./VisualLoader"

/** The editor routes' template entry points: `/editor/new?templateId=`
 *  starts a pending draft from the template (snapping a `?datasetId=` onto
 *  it through `bindDatasetToDraft`), and a template's own id on
 *  `/editor/$visualId` redirects there instead of opening it as a chart. */

let params: Record<string, string> = {}
let search: Record<string, string | undefined> = {}
const navigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
	useParams: () => params,
	useSearch: () => search,
	useNavigate: () => navigate,
}))
vi.mock("./EditorLayout", () => ({ EditorLayout: () => null }))
vi.mock("../store/bindDatasetToDraft", async (importActual) => {
	const actual =
		await importActual<typeof import("../store/bindDatasetToDraft")>()
	return { bindDatasetToDraft: vi.fn(actual.bindDatasetToDraft) }
})

afterEach(() => {
	cleanup()
	navigate.mockReset()
	vi.mocked(bindDatasetToDraft).mockClear()
	params = {}
	search = {}
})

const TEMPLATE = {
	id: "t-1",
	name: "Quarterly layout",
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	fieldTypeOverrides: {},
	template: { sourceFields: [], formatMemory: {} },
} as unknown as Visual

const FRESH = buildDataset({
	id: "ds-fresh",
	fields: [{ name: "Area", inferredType: "categorical" }],
	rows: [{ Area: "North" }],
})

const mount = (ui: React.ReactNode) => {
	installInMemoryLocalStorage()
	const captured: { store?: TestStore } = {}
	render(
		<TestProvider
			initializeState={(s) => {
				s.set(visualsAtom, [TEMPLATE])
				s.set(loadedDatasetsAtom, { [FRESH.id]: FRESH })
				captured.store = s
			}}
		>
			{ui}
		</TestProvider>
	)
	return captured.store!
}

describe("VisualLoader template entry points", () => {
	it("redirects a template's own id to a new draft from it", async () => {
		params = { visualId: "t-1" }
		mount(<VisualLoaderForExisting />)
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				to: "/editor/new",
				search: { templateId: "t-1" },
				replace: true,
			})
		)
	})

	it("applies the template, the picked folder + name, and snaps ?datasetId", async () => {
		search = {
			templateId: "t-1",
			datasetId: "ds-fresh",
			folderId: "fl-work",
			name: " Q4 sales ",
		}
		const store = mount(<VisualLoaderForNew />)
		await waitFor(() =>
			expect(bindDatasetToDraft).toHaveBeenCalledWith(
				expect.any(Function),
				expect.any(Function),
				"ds-fresh",
				FRESH
			)
		)
		expect(navigate).not.toHaveBeenCalled()
		expect(store.get(currentTemplateIdAtom)).toBe("t-1")
		expect(store.get(currentDatasetIdAtom)).toBe("ds-fresh")
		expect(store.get(newVisualFolderIdAtom)).toBe("fl-work")
		expect(store.get(currentVisualNameAtom)).toBe("Q4 sales")
	})

	it("a template without ?datasetId stays pending, named after the template", async () => {
		search = { templateId: "t-1" }
		const store = mount(<VisualLoaderForNew />)
		await waitFor(() => expect(store.get(currentTemplateIdAtom)).toBe("t-1"))
		expect(store.get(currentVisualNameAtom)).toBe("Quarterly layout")
		expect(store.get(currentDatasetIdAtom)).toBeNull()
		expect(bindDatasetToDraft).not.toHaveBeenCalled()
	})

	it("sends an unknown template id back to the library", async () => {
		search = { templateId: "t-missing", datasetId: "ds-fresh" }
		const store = mount(<VisualLoaderForNew />)
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true })
		)
		expect(bindDatasetToDraft).not.toHaveBeenCalled()
		expect(store.get(currentTemplateIdAtom)).toBeNull()
	})

	it("without a template, ?datasetId binds directly as before", async () => {
		search = { datasetId: "ds-fresh" }
		const store = mount(<VisualLoaderForNew />)
		await waitFor(() => expect(store.get(currentDatasetIdAtom)).toBe("ds-fresh"))
		expect(bindDatasetToDraft).not.toHaveBeenCalled()
	})
})
