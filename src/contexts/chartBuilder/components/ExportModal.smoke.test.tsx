import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { localStorageAdapter } from "../lib/storage/adapter"
import { setStorageAdapter } from "../lib/storage/registry"
import { EMPTY_CHANNEL_CONFIGS } from "../lib/channelConfig"
import { SYSTEM_LIGHT_THEME } from "../lib/systemThemes"
import { labelsFromTheme } from "../lib/themeConfig"
import { type EmbedInstance, emptyEncodings, type Visual } from "../lib/types"
import {
	currentVisualIdAtom,
	embedInstancesAtom,
	republishOnSaveVisualsAtom,
	visualsAtom,
} from "../store/atoms"
import { ExportModal } from "./ExportModal"

/** The Export modal's two tabs — Download image and Publish — and which
 *  tab an open lands on. Save as template and the Zafiro bundle download
 *  live in the editor's Save menu (EditorActions' test). */

const VISUAL: Visual = {
	id: "dv-1",
	name: "Sales",
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
}

beforeEach(() => {
	installInMemoryLocalStorage()
	// The Export image tab's preview iframe would fetch the embed route.
	;(
		window as unknown as {
			happyDOM: { settings: { disableIframePageLoading: boolean } }
		}
	).happyDOM.settings.disableIframePageLoading = true
})
afterEach(cleanup)

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

const renderModal = (open: boolean, instances: EmbedInstance[] = []) =>
	render(
		<TestProvider
			initializeState={(store) => {
				store.set(visualsAtom, [VISUAL])
				store.set(currentVisualIdAtom, "dv-1")
				store.set(
					embedInstancesAtom,
					Object.fromEntries(instances.map((i) => [i.id, i]))
				)
			}}
		>
			<ExportModal open={open} onClose={vi.fn()} visualId="dv-1" />
		</TestProvider>
	)

describe("Export modal tabs", () => {
	it("offers Download image and Publish, with the figure size controls on the open tab", () => {
		renderModal(true)
		expect(screen.getByRole("tab", { name: "Download image" })).toBeTruthy()
		expect(screen.getByRole("tab", { name: "Publish" })).toBeTruthy()
		expect(screen.getByLabelText("Width (px)")).toBeTruthy()
		expect(screen.getByRole("button", { name: "Download PNG" })).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Save as template" })).toBeNull()
		expect(screen.queryByRole("button", { name: /Download bundle|Download JSON/ })).toBeNull()
	})
})

/** Browser-local sessions (this test env) render the Publish pane as a
 *  "requires the self-host server" notice, so that text is the Publish
 *  pane's fingerprint here. */
const EMBED_PANE_TEXT = /Publishing embeds requires the self-host server/

describe("Export modal opening tab", () => {
	it("opens on Download for an unpublished visual", () => {
		renderModal(true)
		expect(screen.queryByText(EMBED_PANE_TEXT)).toBeNull()
	})

	it("opens on Publish when the visual is already published", () => {
		renderModal(true, [PUBLISHED])
		expect(screen.getByText(EMBED_PANE_TEXT)).toBeTruthy()
	})
})

/** Publish tab, server mode: "Republish automatically whenever I save" is
 *  this user's per-visual, per-browser flag (`republishOnSaveVisualsAtom`,
 *  never the shared instances), offered under Settings once the visual has
 *  a published pin. */
describe("Export modal Publish tab: Republish on every save", () => {
	const LABEL = "Republish automatically whenever I save (this browser only)"
	const openSettings = () => fireEvent.click(screen.getByRole("button", { name: /^Data version settings/ }))

	const renderServerMode = (instances: EmbedInstance[]) => {
		setStorageAdapter({ ...localStorageAdapter, capabilities: { remoteLoad: true } })
		let store!: TestStore
		render(
			<TestProvider
				initializeState={(s) => {
					store = s
					s.set(visualsAtom, [VISUAL])
					s.set(currentVisualIdAtom, "dv-1")
					s.set(
						embedInstancesAtom,
						Object.fromEntries(instances.map((i) => [i.id, i]))
					)
				}}
			>
				<ExportModal open onClose={vi.fn()} visualId="dv-1" />
			</TestProvider>
		)
		return store
	}

	afterEach(() => setStorageAdapter(localStorageAdapter))

	it("offers the checkbox once a pin is published and toggles this visual's device-local flag", () => {
		const store = renderServerMode([PUBLISHED])
		openSettings()
		const box = screen.getByRole("checkbox", { name: LABEL }) as HTMLInputElement
		expect(box.checked).toBe(false)
		fireEvent.click(box)
		expect(store.get(republishOnSaveVisualsAtom)).toEqual({ "dv-1": true })
		// Never written onto the shared instance.
		expect("republishOnSave" in store.get(embedInstancesAtom)["ei-1"]).toBe(false)
		expect((screen.getByRole("checkbox", { name: LABEL }) as HTMLInputElement).checked).toBe(true)
		fireEvent.click(screen.getByRole("checkbox", { name: LABEL }))
		expect(store.get(republishOnSaveVisualsAtom)).toEqual({})
	})

	it("shows the checkbox for a published pin other than the one the tab is on", () => {
		// The tab opens on the "latest" pin; the published one is pinned to v1.
		renderServerMode([{ ...PUBLISHED, versionId: "v1", publishedVersionId: "v1" }])
		openSettings()
		expect(screen.getByRole("checkbox", { name: LABEL })).toBeTruthy()
	})

	it("does not exist before the pin is published", () => {
		// Open on the Publish tab by hand: an unpublished visual lands on
		// Download.
		renderServerMode([{ ...PUBLISHED, publishId: undefined, publishedUrls: undefined }])
		fireEvent.click(screen.getByRole("tab", { name: "Publish" }))
		expect(screen.getByRole("status").textContent).toBe("Not published yet")
		expect(screen.getByRole("button", { name: /^Publish$/ })).toBeTruthy()
		openSettings()
		expect(screen.queryByRole("checkbox", { name: LABEL })).toBeNull()
	})
})
