import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider } from "../../../testSupport/TestProvider"
import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { labelsFromTheme } from "../lib/themeConfig"
import { emptyEncodings, type Visual } from "../lib/types"
import {
	currentDatasetIdAtom,
	currentTemplateIdAtom,
	currentVisualIdAtom,
	visualsAtom,
} from "../store/atoms"
import { EditorActions } from "./EditorActions"

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }))

/** A template-pending draft (template id, no visual, no data set) can't be
 *  saved: Save is disabled and says why. */

const TEMPLATE: Visual = {
	id: "tpl-1",
	name: "Quarterly",
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: labelsFromTheme(SYSTEM_LIGHT_THEME),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	template: { sourceFields: [], formatMemory: {} },
}

const renderActions = (datasetId: string | null) =>
	render(
		<TestProvider
			initializeState={(store) => {
				store.set(visualsAtom, [TEMPLATE])
				store.set(currentVisualIdAtom, null)
				store.set(currentTemplateIdAtom, "tpl-1")
				store.set(currentDatasetIdAtom, datasetId)
			}}
		>
			<EditorActions />
		</TestProvider>
	)

beforeEach(installInMemoryLocalStorage)
afterEach(cleanup)

describe("EditorActions Save while a template is pending", () => {
	it("disables Save until a data set is attached", () => {
		renderActions(null)
		const save = screen.getByRole("button", { name: "Save visualization" })
		expect((save as HTMLButtonElement).disabled).toBe(true)
		expect(save.getAttribute("title")).toBe("Attach a data set first")
	})

	it("enables Save once a data set is bound", () => {
		renderActions("ds-1")
		const save = screen.getByRole("button", { name: "Save visualization" })
		expect((save as HTMLButtonElement).disabled).toBe(false)
		expect(save.getAttribute("title")).toBeNull()
	})
})

/** Save is a split button for a SAVED visual: the arrow opens a menu whose
 *  one item today is "Save as template…" (the dialog is
 *  SaveTemplateButton's test). A draft has no arrow — nothing saved to
 *  build a template from. */
describe("EditorActions Save menu", () => {
	const SAVED: Visual = { ...TEMPLATE, id: "dv-1", name: "Sales", template: undefined }

	const renderSaved = (visualId: string | null) =>
		render(
			<TestProvider
				initializeState={(store) => {
					store.set(visualsAtom, [SAVED])
					store.set(currentVisualIdAtom, visualId)
					store.set(currentTemplateIdAtom, null)
					store.set(currentDatasetIdAtom, "ds-1")
				}}
			>
				<EditorActions />
			</TestProvider>
		)

	it("opens Save as template… from the arrow beside Save", () => {
		renderSaved("dv-1")
		expect(screen.queryByRole("menu")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "More ways to save" }))
		expect(screen.getByRole("menuitem", { name: /Save as template…/ })).toBeTruthy()
		expect(screen.getByRole("menuitem", { name: /Download as Zafiro file/ })).toBeTruthy()
		fireEvent.click(screen.getByRole("menuitem", { name: /Save as template…/ }))
		expect(screen.queryByRole("menu")).toBeNull()
		expect(screen.getByLabelText("Template name")).toBeTruthy()
	})

	it("has no arrow while the visual is unsaved", () => {
		renderSaved(null)
		expect(screen.queryByRole("button", { name: "More ways to save" })).toBeNull()
	})
})
