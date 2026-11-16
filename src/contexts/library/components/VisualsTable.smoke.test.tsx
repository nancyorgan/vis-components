import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TestProvider } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import { type EmbedInstance, emptyEncodings, type Visual } from "../../chartBuilder/lib/types"
import { republishOnSaveVisualsAtom } from "../../chartBuilder/store/atoms"
import type { DecoratedRow } from "../hooks/useFilteredSortedVisuals"
import { VisualsTable } from "./VisualsTable"

/** Pin State column: a published pin of a visual THIS user set to
 *  "Republish on every save" on this browser reads "… · auto" (never
 *  "live" — that word is the latest-version pin here); the device-local
 *  flag alone, with nothing published, changes nothing. */

// The row's name is a router Link; an anchor stands in.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		...rest
	}: React.PropsWithChildren<Record<string, unknown>>) => (
		<a {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>{children}</a>
	),
}))

const VISUAL: Visual = {
	id: "dv-1",
	name: "Sales",
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
}

const INSTANCE: EmbedInstance = {
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

const row = (published: boolean): DecoratedRow => ({
	kind: "instance",
	visual: VISUAL,
	instance: INSTANCE,
	dataset: null,
	versionLabel: "latest",
	pinState: "live",
	publish: published
		? { publishedAt: 2, resolvedVersionLabel: null, behind: false }
		: null,
	folderName: "",
	folderPath: "",
	rowCreatedAt: 1,
	visualUpdatedAt: 1,
	datasetName: "",
})

const renderTable = (r: DecoratedRow, flagged: string[]) =>
	render(
		<TestProvider
			initializeState={(store) =>
				store.set(
					republishOnSaveVisualsAtom,
					Object.fromEntries(flagged.map((id) => [id, true as const]))
				)
			}
		>
			<VisualsTable
				rows={[r]}
				sortField="name"
				sortDir="asc"
				onSort={vi.fn()}
				selectedVisualIds={new Set()}
				onToggleVisual={vi.fn()}
				onSetVisualsSelected={vi.fn()}
				onToggleAllVisible={vi.fn()}
			/>
		</TestProvider>
	)

beforeEach(installInMemoryLocalStorage)
afterEach(cleanup)

describe("VisualsTable Pin State · auto", () => {
	it("appends · auto to a published pin of a visual flagged on this device", () => {
		renderTable(row(true), ["dv-1"])
		expect(screen.getByText("Published · latest · auto")).not.toBeNull()
	})

	it("leaves an unflagged visual, and an unpublished pin, alone", () => {
		renderTable(row(true), [])
		expect(screen.getByText("Published · latest")).toBeTruthy()
		cleanup()
		renderTable(row(false), ["dv-1"])
		expect(screen.getByText("Not published")).toBeTruthy()
		expect(screen.queryByText(/· auto/)).toBeNull()
	})
})
