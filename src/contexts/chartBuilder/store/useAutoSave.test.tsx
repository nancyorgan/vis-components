import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import type { EmbedInstance } from "../lib/types"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import {
	currentDatasetIdAtom,
	currentVisualIdAtom,
	currentVisualNameAtom,
	embedInstancesAtom,
	republishOnSaveVisualsAtom,
} from "./atoms"
import { useAutoSave } from "./useAutoSave"

/** "Republish on every save": a save of a visual this user flagged on this
 *  browser (`republishOnSaveVisualsAtom`) that has a published pin goes
 *  through the shared republish once the save lands; a plain save (no
 *  flag, or a flag on a visual with nothing published) republishes
 *  nothing. */

const navigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }))
const saveVisual = vi.fn(async () => "dv-1")
vi.mock("./saveVisual", async (importOriginal) => ({
	...(await importOriginal<typeof import("./saveVisual")>()),
	useSaveVisual: () => saveVisual,
}))
const republish = vi.fn(async () => 1)
vi.mock("./republishVisual", () => ({ useRepublishVisual: () => republish }))
vi.mock("./useEffectiveGeographyLevel", () => ({
	useEffectiveGeographyLevel: () => "states",
}))

const instance = (extra: Partial<EmbedInstance>): EmbedInstance => ({
	id: "ei-1",
	visualId: "dv-1",
	versionId: null,
	createdAt: 1,
	lastExportedAt: 1,
	...extra,
})
const PUBLISHED = instance({
	publishId: "pub-1",
	publishedAt: 2,
	publishedParts: ["full"],
	publishedUrls: { full: "https://example.test/embeds/pub-1/index.html" },
	publishedVersionId: null,
})

beforeEach(() => {
	installInMemoryLocalStorage()
	vi.useFakeTimers()
	saveVisual.mockClear()
	republish.mockClear()
	navigate.mockClear()
})
afterEach(() => {
	vi.useRealTimers()
})

/** Mount the hook on an open, saved visual and make one edit (a rename) so
 *  the debounce fires one save. */
const editAndSave = async (instances: EmbedInstance[], flagged: string[] = []) => {
	let store!: TestStore
	const wrapper = ({ children }: { children: ReactNode }) => (
		<TestProvider
			initializeState={(s) => {
				store = s
				s.set(currentVisualIdAtom, "dv-1")
				s.set(currentDatasetIdAtom, "ds-1")
				s.set(embedInstancesAtom, Object.fromEntries(instances.map((i) => [i.id, i])))
				s.set(
					republishOnSaveVisualsAtom,
					Object.fromEntries(flagged.map((id) => [id, true as const]))
				)
			}}
		>
			{children}
		</TestProvider>
	)
	renderHook(() => useAutoSave(), { wrapper })
	act(() => store.set(currentVisualNameAtom, "Renamed"))
	await act(async () => {
		await vi.advanceTimersByTimeAsync(800)
	})
	expect(saveVisual).toHaveBeenCalledTimes(1)
}

describe("useAutoSave republish-on-save", () => {
	it("republishes once after a save when the visual is flagged and published", async () => {
		await editAndSave([PUBLISHED], ["dv-1"])
		expect(republish).toHaveBeenCalledTimes(1)
		expect(republish).toHaveBeenCalledWith("dv-1", { includeZctaTopology: false })
		expect(navigate).not.toHaveBeenCalled()
	})

	it("a plain save republishes nothing", async () => {
		await editAndSave([PUBLISHED])
		expect(republish).not.toHaveBeenCalled()
	})

	it("ignores the flag when nothing of the visual is published", async () => {
		await editAndSave([instance({})], ["dv-1"])
		expect(republish).not.toHaveBeenCalled()
	})
})
