import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider } from "../../../testSupport/TestProvider"
import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { labelsFromTheme } from "../lib/themeConfig"
import { localStorageAdapter } from "../lib/storage/adapter"
import { setStorageAdapter } from "../lib/storage/registry"
import { type EmbedInstance, emptyEncodings, type Visual } from "../lib/types"
import {
	embedInstancesAtom,
	currentDatasetIdAtom,
	currentTemplateIdAtom,
	currentVisualIdAtom,
	visualsAtom,
} from "../store/atoms"
import { EditorActions } from "./EditorActions"

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }))
// The export modal has its own test; here it only reports the tab it was
// opened on.
vi.mock("./ExportModal", () => ({
	ExportModal: ({ open, initialTab }: { open: boolean; initialTab: string }) =>
		open ? <div data-testid="export-modal">{initialTab}</div> : null,
}))
const republish = vi.fn(async () => 1)
vi.mock("../store/republishVisual", async (importOriginal) => ({
	...(await importOriginal<typeof import("../store/republishVisual")>()),
	useRepublishVisual: () => republish,
}))

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

beforeEach(() => {
	installInMemoryLocalStorage()
	republish.mockClear()
})
afterEach(() => {
	cleanup()
	setStorageAdapter(localStorageAdapter)
})

describe("EditorActions Save while a template is pending", () => {
	it("disables Save until a data set is attached", () => {
		renderActions(null)
		const save = screen.getByRole("button", { name: "Save visualization" })
		expect((save as HTMLButtonElement).disabled).toBe(true)
	})

	it("enables Save once a data set is bound", () => {
		renderActions("ds-1")
		const save = screen.getByRole("button", { name: "Save visualization" })
		expect((save as HTMLButtonElement).disabled).toBe(false)
	})
})

/** Save is a split button for a SAVED visual: the arrow opens a menu of
 *  the other ways to save — as a template (the dialog is
 *  SaveTemplateButton's test), as a Zafiro file, as an image. A draft has
 *  no arrow — nothing saved to build a template from. */
describe("EditorActions Save menu", () => {
	const SAVED: Visual = { ...TEMPLATE, id: "dv-1", name: "Sales", template: undefined }

	const PUBLISHED: EmbedInstance = {
		id: "ei-1",
		visualId: "dv-1",
		versionId: null,
		createdAt: 1,
		lastExportedAt: 1,
		publishId: "pub-1",
		publishedAt: 2,
		publishedParts: ["full"],
		publishedUrls: { full: "https://example.test/embeds/pub-1/index.html" },
		publishedVersionId: null,
	}
	const serverMode = () =>
		setStorageAdapter({ ...localStorageAdapter, capabilities: { remoteLoad: true } })

	const renderSaved = (visualId: string | null, instances: EmbedInstance[] = []) =>
		render(
			<TestProvider
				initializeState={(store) => {
					store.set(visualsAtom, [SAVED])
					store.set(currentVisualIdAtom, visualId)
					store.set(
						embedInstancesAtom,
						Object.fromEntries(instances.map((i) => [i.id, i]))
					)
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

	it("opens the export modal on Save image from the Save menu's Save image…", () => {
		renderSaved("dv-1")
		fireEvent.click(screen.getByRole("button", { name: "More ways to save" }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Save image…/ }))
		expect(screen.queryByRole("menu")).toBeNull()
		expect(screen.getByTestId("export-modal").textContent).toBe("download")
	})

	it("opens the export modal on Publish from the Publish button", () => {
		renderSaved("dv-1")
		expect(screen.queryByRole("button", { name: "Export" })).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Publish" }))
		expect(screen.getByTestId("export-modal").textContent).toBe("publish")
	})

	it("keeps Republish in the Publish button's menu for a published visual in server mode", () => {
		serverMode()
		renderSaved("dv-1", [PUBLISHED])
		expect(screen.queryByRole("menuitem", { name: /Republish/ })).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "More ways to publish" }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Republish/ }))
		expect(screen.queryByRole("menu")).toBeNull()
		expect(republish).toHaveBeenCalledTimes(1)
		expect(republish).toHaveBeenCalledWith("dv-1", { includeZctaTopology: false })
	})

	it("has no Publish menu in a browser-local session or while nothing is published", () => {
		renderSaved("dv-1", [PUBLISHED])
		expect(screen.queryByRole("button", { name: "More ways to publish" })).toBeNull()
		cleanup()
		serverMode()
		renderSaved("dv-1")
		expect(screen.queryByRole("button", { name: "More ways to publish" })).toBeNull()
	})
})
