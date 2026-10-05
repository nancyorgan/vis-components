import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { stringifyJsonDangerous } from "../lib/json"
import { buildDataset } from "../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../testSupport/TestProvider"
import type { Visual } from "../contexts/chartBuilder/lib/types"
import {
	currentDatasetIdAtom,
	foldersAtom,
	loadedDatasetsAtom,
	visualsAtom,
} from "../contexts/chartBuilder/store/atoms"
import { Header } from "./Header"

// The header's only router touches are the brand/settings links, the route
// lookup, and navigate; stubbing beats standing up a RouterProvider.
let pathname = "/"
const navigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...rest
	}: {
		children: React.ReactNode
		to: string
	} & React.HTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
	useNavigate: () => navigate,
	useRouterState: ({
		select,
	}: {
		select: (s: { location: { pathname: string } }) => unknown
	}) => select({ location: { pathname } }),
}))

/** The "New visualization" header button is a dropdown everywhere: start
 *  entries first (keep / fresh data set in the editor, a single "start" entry
 *  elsewhere), then "Import from JSON…" — the Settings → Sharing bundle
 *  import, reachable without leaving the page. */

afterEach(() => {
	cleanup()
	navigate.mockReset()
	pathname = "/"
})

const vis = (id: string): Visual =>
	({
		id,
		name: `Visual ${id}`,
		folderId: null,
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
			<Header />
		</TestProvider>
	)
	return { ...view, store: store as unknown as TestStore }
}

const openMenu = () => {
	fireEvent.click(screen.getByRole("button", { name: /New/ }))
	return screen.getByRole("menu")
}

const pickFile = (container: HTMLElement, file: File) => {
	const input = container.querySelector<HTMLInputElement>('input[type="file"]')
	expect(input).not.toBeNull()
	fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })
}

describe("Header → New visualization dropdown", () => {
	it("on the library page offers a start entry and the import entry", () => {
		mount()
		openMenu()
		const items = screen.getAllByRole("menuitem").map((el) => el.textContent)
		expect(items[0]).toContain("Start from scratch")
		expect(items[1]).toContain("Import from JSON…")
		expect(items).toHaveLength(2)

		fireEvent.click(screen.getByText("Start from scratch"))
		expect(navigate).toHaveBeenCalledWith({ to: "/editor/new" })
	})

	it("in the editor with a data set bound keeps the keep/fresh choice ahead of import", () => {
		pathname = "/editor/dv-1"
		mount((s) => {
			s.set(loadedDatasetsAtom, {
				"ds-1": buildDataset({
					id: "ds-1",
					name: "Q3 Sales",
					fields: [{ name: "region", inferredType: "categorical" }],
					rows: [{ region: "East" }],
				}),
			})
			s.set(currentDatasetIdAtom, "ds-1")
		})
		openMenu()
		const items = screen.getAllByRole("menuitem").map((el) => el.textContent)
		expect(items[0]).toContain("With this data set")
		expect(items[0]).toContain("Q3 Sales")
		expect(items[1]).toContain("With a new data set")
		expect(items[2]).toContain("Import from JSON…")
		expect(items).toHaveLength(3)
	})

	it("imports a picked bundle into the live library and reports it", async () => {
		pathname = "/editor/dv-1"
		const { container, store } = mount((s) => {
			s.set(visualsAtom, [vis("v-mine")])
		})
		openMenu()
		fireEvent.click(screen.getByText("Import from JSON…"))
		// The menu closes; the (hidden) file input is what the click opened.
		expect(screen.queryByRole("menu")).toBeNull()

		pickFile(
			container,
			bundleFile({
				exportedAt: "2026-10-05T00:00:00.000Z",
				visuals: [vis("v-theirs")],
				folders: [],
				datasets: {},
				themes: [],
				userDefaultThemeId: null,
			})
		)

		expect(await screen.findByText("Import complete")).toBeTruthy()
		expect(screen.getByText(/Imported 1 visualization/)).toBeTruthy()
		await waitFor(() => {
			expect(store.get(visualsAtom).map((v) => v.id)).toEqual([
				"v-mine",
				"v-theirs",
			])
		})

		// Away from the library the dialog offers to go look at the result.
		fireEvent.click(screen.getByText("Open library"))
		expect(navigate).toHaveBeenCalledWith({ to: "/" })
		expect(screen.queryByText("Import complete")).toBeNull()
	})

	it("refuses a malformed file, changes nothing, and has no library link on the library page", async () => {
		const { container, store } = mount((s) => {
			s.set(visualsAtom, [vis("v-mine")])
		})
		pickFile(
			container,
			new File(["this is not json"], "nope.json", { type: "application/json" })
		)

		expect(await screen.findByText("Import failed")).toBeTruthy()
		expect(screen.getByText(/Nothing was changed/)).toBeTruthy()
		expect(screen.queryByText("Open library")).toBeNull()
		expect(store.get(visualsAtom).map((v) => v.id)).toEqual(["v-mine"])

		fireEvent.click(screen.getByText("Got it"))
		expect(screen.queryByText("Import failed")).toBeNull()
	})
})
