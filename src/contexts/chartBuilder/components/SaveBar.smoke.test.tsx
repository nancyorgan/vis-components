import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider } from "../../../testSupport/TestProvider"
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
import { republishStateAtom } from "../store/republishVisual"
import { SaveBar } from "./SaveBar"

/** The header's republish STATUS (the Republish action itself is in the
 *  Publish button's menu — EditorActions' test): the "Republishes on save"
 *  chip and the last result, only for a PUBLISHED visual in SERVER mode. */

// The action group and version chip have their own tests and their own
// router / dataset needs; the header's republish slot is what's under test.
vi.mock("./EditorActions", () => ({ EditorActions: () => null }))
vi.mock("./VersionBadge", () => ({ VersionBadge: () => null }))

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

const renderBar = (
	instances: EmbedInstance[],
	flagged: string[] = [],
	republishState?: { busy: boolean; pending: boolean; error: string | null; lastAt: number | null }
) =>
	render(
		<TestProvider
			initializeState={(store) => {
				store.set(visualsAtom, [VISUAL])
				store.set(currentVisualIdAtom, "dv-1")
				store.set(
					embedInstancesAtom,
					Object.fromEntries(instances.map((i) => [i.id, i]))
				)
				store.set(
					republishOnSaveVisualsAtom,
					Object.fromEntries(flagged.map((id) => [id, true as const]))
				)
				if (republishState) store.set(republishStateAtom, republishState)
			}}
		>
			<SaveBar />
		</TestProvider>
	)

const serverMode = () =>
	setStorageAdapter({ ...localStorageAdapter, capabilities: { remoteLoad: true } })

beforeEach(installInMemoryLocalStorage)
afterEach(() => {
	cleanup()
	setStorageAdapter(localStorageAdapter)
})

describe("SaveBar republish status", () => {
	it("has no Republish button of its own", () => {
		serverMode()
		renderBar([PUBLISHED])
		expect(screen.queryByRole("button", { name: "Republish" })).toBeNull()
	})

	it("wears the Republishes-on-save chip only when this user flagged the visual", () => {
		serverMode()
		renderBar([PUBLISHED])
		expect(screen.queryByText("Republishes on save")).toBeNull()
		cleanup()
		renderBar([PUBLISHED], ["dv-1"])
		expect(screen.getByText("Republishes on save")).toBeTruthy()
	})

	it("reports a running pass, then its result or error", () => {
		serverMode()
		renderBar([PUBLISHED], [], { busy: true, pending: false, error: null, lastAt: null })
		expect(screen.getByText("Publishing…")).toBeTruthy()
		cleanup()
		renderBar([PUBLISHED], [], { busy: false, pending: false, error: null, lastAt: Date.now() })
		expect(screen.getByText(/^Republished · /)).toBeTruthy()
		cleanup()
		renderBar([PUBLISHED], [], { busy: false, pending: false, error: "Server said no", lastAt: null })
		expect(screen.getByText("Server said no")).toBeTruthy()
	})

	it("stays hidden in a browser-local session, even for a published visual", () => {
		renderBar([PUBLISHED], ["dv-1"])
		expect(screen.queryByText("Republishes on save")).toBeNull()
	})

	it("stays hidden in server mode when nothing is published", () => {
		serverMode()
		renderBar([{ ...PUBLISHED, publishId: undefined, publishedUrls: undefined }], ["dv-1"])
		expect(screen.queryByText("Republishes on save")).toBeNull()
	})
})
