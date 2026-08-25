import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { stringifyJsonDangerous } from "../../../lib/json"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import {
	foldersAtom,
	themesAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"

import { SharingPage } from "./SharingPage"

/** Smoke coverage for Settings → Sharing: the renamed export affordance and
 *  the import flow — a picked bundle file lands in the LIVE atoms (so the
 *  library updates without a reload) and a malformed file is refused
 *  without touching anything. */

afterEach(cleanup)

const vis = (id: string, folderId: string | null = null): Visual =>
	({
		id,
		name: `Visual ${id}`,
		folderId,
		datasetId: null,
		createdAtVersionId: null,
		thumbnail: null,
		createdAt: 1,
		updatedAt: 1,
	}) as unknown as Visual

const bundleFile = (body: unknown): File =>
	new File([stringifyJsonDangerous(body as never)], "library-bundle.json", {
		type: "application/json",
	})

const mount = (initializeState?: (store: TestStore) => void) => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const view = render(
		<TestProvider
			initializeState={(s) => {
				s.set(visualsAtom, [])
				s.set(foldersAtom, [])
				initializeState?.(s)
				store = s
			}}
		>
			<SharingPage />
		</TestProvider>
	)
	return { ...view, store: store as unknown as TestStore }
}

const pickFile = (container: HTMLElement, file: File) => {
	const input = container.querySelector<HTMLInputElement>('input[type="file"]')
	expect(input).not.toBeNull()
	fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })
}

describe("SharingPage", () => {
	it("offers the renamed export and the import affordance", () => {
		const { getByText } = mount()
		expect(getByText("Bundle your library as JSON")).toBeTruthy()
		expect(getByText("Download bundle")).toBeTruthy()
		expect(getByText("Import a bundle")).toBeTruthy()
		expect(getByText("Import bundle…")).toBeTruthy()
	})

	it("imports a bundle into the live atoms, creating folders", async () => {
		const existingFolder: Folder = {
			id: "fl-mine",
			name: "Work",
			parentId: null,
			createdAt: 1,
		}
		const { container, store, findByText } = mount((s) => {
			s.set(visualsAtom, [vis("v-mine")])
			s.set(foldersAtom, [existingFolder])
		})

		pickFile(
			container,
			bundleFile({
				exportedAt: "2026-08-24T00:00:00.000Z",
				visuals: [vis("v-theirs", "in-2")],
				folders: [
					{ id: "in-1", name: "Work", parentId: null, createdAt: 1 },
					{ id: "in-2", name: "Q3", parentId: "in-1", createdAt: 1 },
				],
				datasets: {},
				themes: [],
				userDefaultThemeId: null,
			})
		)

		expect(await findByText(/Imported 1 visualization/)).toBeTruthy()
		await waitFor(() => {
			expect(store.get(visualsAtom)).toHaveLength(2)
		})
		const folders = store.get(foldersAtom)
		// "Work" matched the local folder; only "Q3" was created, under it.
		expect(folders).toHaveLength(2)
		const q3 = folders.find((f) => f.name === "Q3")
		expect(q3?.parentId).toBe("fl-mine")
		const imported = store.get(visualsAtom).find((v) => v.id === "v-theirs")
		expect(imported?.folderId).toBe(q3?.id)
	})

	it("refuses a malformed file and changes nothing", async () => {
		const { container, store, findByText } = mount((s) => {
			s.set(visualsAtom, [vis("v-mine")])
		})
		const themesBefore = store.get(themesAtom)

		pickFile(
			container,
			new File(["this is not json"], "nope.json", { type: "application/json" })
		)

		expect(await findByText(/Import failed/)).toBeTruthy()
		expect(store.get(visualsAtom).map((v) => v.id)).toEqual(["v-mine"])
		expect(store.get(foldersAtom)).toEqual([])
		expect(store.get(themesAtom)).toBe(themesBefore)
	})
})
