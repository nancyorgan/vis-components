import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import { emptyEncodings, type Visual } from "../../chartBuilder/lib/types"
import {
	dataFoldersAtom,
	foldersAtom,
	loadedDatasetsAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"
import { buildDataset } from "../../../testSupport/fixtures"
import {
	clearStockFolders,
	setStockFolders,
} from "../../chartBuilder/lib/stockFolders"
import type { LibrarySearch } from "../routes"
import { LibraryPage } from "./LibraryPage"

// The page reads its filters from the URL and writes them back through
// navigate; stand both in, and render Link as an anchor whose href spells
// out the target (path params filled, search appended) so a test can read
// where a click would go.
const router = vi.hoisted(() => ({
	search: {} as Record<string, unknown>,
	navigate: vi.fn(),
}))
vi.mock("@tanstack/react-router", () => ({
	useSearch: () => router.search,
	useNavigate: () => router.navigate,
	Link: ({
		children,
		to,
		params,
		search,
		...rest
	}: React.PropsWithChildren<
		{
			to: string
			params?: Record<string, string>
			search?: Record<string, string>
		} & React.AnchorHTMLAttributes<HTMLAnchorElement>
	>) => {
		let href = to
		for (const [k, v] of Object.entries(params ?? {})) {
			href = href.replace(`$${k}`, v)
		}
		const qs = new URLSearchParams(search ?? {}).toString()
		return (
			<a {...rest} href={qs ? `${href}?${qs}` : href}>
				{children}
			</a>
		)
	},
}))

const mkVisual = (id: string, over: Partial<Visual> = {}): Visual => ({
	id,
	name: id,
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
	...over,
})

const TEMPLATE_META = {
	sourceFields: [
		{ name: "a", type: "quantitative" as const, kind: "number" as const },
		{ name: "b", type: "categorical" as const, kind: "category" as const },
	],
	formatMemory: {},
}

const mount = (visuals: Visual[], search: LibrarySearch = {}) => {
	router.search = search
	render(
		<TestProvider initializeState={(s) => s.set(visualsAtom, visuals)}>
			<LibraryPage />
		</TestProvider>
	)
}

/** The gallery: the grid of cards (the tree also lists every row). */
const gallery = () => screen.getAllByRole("list").at(-1)!

beforeEach(() => {
	installInMemoryLocalStorage()
	router.navigate.mockReset()
})
afterEach(cleanup)

describe("LibraryPage templates", () => {
	const rows = [mkVisual("Chart"), mkVisual("Tpl", { template: TEMPLATE_META })]

	it("lists only ordinary visuals by default", () => {
		mount(rows)
		const grid = gallery()
		expect(within(grid).getByText("Chart")).toBeTruthy()
		expect(within(grid).queryByText("Tpl")).toBeNull()
	})

	it("under Templates, a card carries the chip, its field count, and starts a new visual", () => {
		mount(rows, { kind: "templates" })
		const grid = gallery()
		expect(within(grid).queryByText("Chart")).toBeNull()
		const link = within(grid).getByText("Tpl").closest("a")!
		expect(link.getAttribute("href")).toBe("/editor/new?templateId=Tpl")
		expect(within(link).getByText("Template")).toBeTruthy()
		expect(within(link).getByText("Template · 2 fields")).toBeTruthy()
		// No data set → no "Regenerate preview" button on a template card.
		expect(
			within(grid).queryByRole("button", { name: /regenerate preview/i })
		).toBeNull()
	})

	it("the table row links a template to the new-from-template route", () => {
		mount(rows, { kind: "templates", view: "table" })
		const table = screen.getByRole("table")
		const link = within(table).getByText("Tpl").closest("a")!
		expect(link.getAttribute("href")).toBe("/editor/new?templateId=Tpl")
		expect(within(table).getByText("Template")).toBeTruthy()
		expect(within(table).getByText(/Template · 2/)).toBeTruthy()
	})

	it("the filter writes ?kind=, omitting it for Visuals", () => {
		mount(rows, { kind: "templates" })
		const group = screen.getByRole("radiogroup", {
			name: /visualizations, templates/i,
		})
		fireEvent.click(within(group).getByRole("radio", { name: "Templates" }))
		fireEvent.click(within(group).getByRole("radio", { name: "Visuals" }))
		const applied = router.navigate.mock.calls.map(([arg]) =>
			(arg as { search: (p: LibrarySearch) => LibrarySearch }).search({
				kind: "templates",
				q: "x",
			})
		)
		expect(applied).toEqual([
			{ kind: "templates", q: "x" },
			{ kind: undefined, q: "x" },
		])
	})

	it("says how to make one when the library has no templates", () => {
		mount([mkVisual("Chart")], { kind: "templates" })
		const empty = screen.getByText(
			"No templates yet. Save one from the editor's Save menu."
		)
		expect(empty.className).toContain("vc-faint")
	})

	it("the table says the same", () => {
		mount([mkVisual("Chart")], { kind: "templates", view: "table" })
		const empty = screen.getByText(
			"No templates yet. Save one from the editor's Save menu."
		)
		expect(empty.className).toContain("vc-faint")
	})
})

describe("LibraryPage data tab", () => {
	const imported = buildDataset({
		id: "ds-import",
		name: "sales",
		fields: [
			{ name: "city", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
		],
		versions: [
			{
				id: "v1",
				filename: "sales.csv",
				rows: [
					{ city: "Lima", sales: "10" },
					{ city: "Quito", sales: "20" },
				],
				createdAt: 100,
			},
		],
	})
	const copy = {
		...buildDataset({
			id: "ds-copy",
			name: "sales (edited)",
			fields: imported.fields,
			versions: [
				{
					id: "c1",
					filename: "Edited data",
					rows: [{ city: "Lima", sales: "11" }],
					createdAt: 200,
				},
			],
		}),
		derivedFrom: { datasetId: "ds-import", versionId: "v1" },
	}

	let store: TestStore | null = null
	const mountData = (
		search: LibrarySearch = { kind: "data" },
		filed: string[] = ["ds-import", "ds-copy"]
	) => {
		router.search = search
		render(
			<TestProvider
				initializeState={(s) => {
					store = s
					s.set(visualsAtom, [mkVisual("Chart", { datasetId: "ds-copy" })])
					s.set(loadedDatasetsAtom, {
						[imported.id]: imported,
						[copy.id]: copy,
					})
					s.set(foldersAtom, [
						{ id: "fl-vis", name: "Reports", parentId: null, createdAt: 1 },
					])
					s.set(dataFoldersAtom, [
						{
							id: "fl-data",
							name: "Sales data",
							parentId: null,
							createdAt: 1,
							kind: "data",
							datasetIds: filed,
						},
					])
				}}
			>
				<LibraryPage />
			</TestProvider>
		)
	}

	it("lists the data sets, not the visuals, with their folder and shape", () => {
		mountData()
		const table = screen.getByTestId("data-table")
		expect(within(table).queryByText("Chart")).toBeNull()
		const row = within(table).getByText("sales (edited)").closest("tr")!
		expect(row.textContent).toContain("Made from sales")
		expect(row.textContent).toContain("Sales data")
		expect(row.textContent).toContain("1 × 2")
		expect(
			within(table).getByText("sales").closest("tr")!.textContent
		).toContain("2 × 2")
	})

	it("the rail shows the data folders and nests a copy under its source", () => {
		mountData()
		const tree = screen.getByTestId("data-folder-tree")
		// The visuals' folders stay on the visuals' side.
		expect(within(tree).queryByText("Reports")).toBeNull()
		expect(within(tree).getByText("Sales data")).toBeTruthy()
		const names = [...tree.querySelectorAll("[data-dataset-row]")].map((el) =>
			el.textContent?.replace("↳", "")
		)
		expect(names).toEqual(["sales", "sales (edited)"])
	})

	it("a data set opens as a spreadsheet with a new-visualization link", () => {
		mountData()
		fireEvent.click(
			within(screen.getByTestId("data-table")).getByText("sales (edited)")
		)
		const dialog = screen.getByRole("dialog")
		expect(dialog.textContent).toContain("1 rows × 2 columns")
		expect(dialog.textContent).toContain("Used by 1 visualization")
		expect(
			within(dialog).getByText("New visualization").closest("a")!.getAttribute("href")
		).toBe("/editor/new?datasetId=ds-copy")
		// In use, so it can't go to the trash.
		expect(
			within(dialog).queryByRole("button", { name: "Move to trash" })
		).toBeNull()
		expect(within(dialog).getByRole("grid")).toBeTruthy()
	})

	it("the data sets of the stock examples get a shelf of their own", () => {
		setStockFolders([
			{ id: "fl-stock", name: "Stock Examples", parentId: null, createdAt: 1 },
		])
		router.search = { kind: "data" }
		render(
			<TestProvider
				initializeState={(s) => {
					s.set(foldersAtom, [
						{ id: "fl-stock", name: "Stock Examples", parentId: null, createdAt: 1 },
					])
					s.set(visualsAtom, [
						mkVisual("Example", { datasetId: "ds-import", folderId: "fl-stock" }),
						mkVisual("Mine", { datasetId: "ds-copy" }),
					])
					s.set(loadedDatasetsAtom, {
						[imported.id]: imported,
						[copy.id]: copy,
					})
				}}
			>
				<LibraryPage />
			</TestProvider>
		)
		const tree = screen.getByTestId("data-folder-tree")
		const shelf = tree.querySelector('[data-folder-row="stock-data"]')!
		expect(shelf.textContent).toBe("Stock Data Sets")
		// The app's folder: nothing to rename, add to or delete.
		expect(within(shelf as HTMLElement).getAllByRole("button")).toHaveLength(2)
		// Only the example's data set is on it; the user's copy is unfiled.
		const table = screen.getByTestId("data-table")
		expect(
			within(table).getByText("sales").closest("tr")!.textContent
		).toContain("Stock Data Sets")
		expect(
			within(table).getByText("sales (edited)").closest("tr")!.textContent
		).not.toContain("Stock Data Sets")
		clearStockFolders()
	})

	it("a data set with a history lists its versions, and one opens at that version", () => {
		const history = buildDataset({
			id: "ds-history",
			name: "trend",
			fields: imported.fields,
			versions: [
				{ id: "h1", filename: "trend.csv", rows: [{ city: "A", sales: "1" }], createdAt: 1 },
				{
					id: "h2",
					filename: "Edited data",
					rows: [
						{ city: "A", sales: "1" },
						{ city: "B", sales: "2" },
					],
					createdAt: 2,
					editedFrom: "h1",
				},
			],
		})
		router.search = { kind: "data" }
		render(
			<TestProvider
				initializeState={(s) => {
					s.set(visualsAtom, [])
					s.set(loadedDatasetsAtom, { [history.id]: history, [imported.id]: imported })
				}}
			>
				<LibraryPage />
			</TestProvider>
		)
		const tree = screen.getByTestId("data-folder-tree")
		expect(
			[...tree.querySelectorAll("[data-version-row]")].map((el) => el.textContent)
		).toEqual(["v1 · trend.csv", "v2 · edited by hand"])
		// The single-version data set lists none.
		fireEvent.click(within(tree).getByText("v1 · trend.csv"))
		const dialog = screen.getByRole("dialog")
		expect(dialog.textContent).toContain("1 rows × 2 columns")
		expect(
			(within(dialog).getByLabelText("Version shown") as HTMLSelectElement).value
		).toBe("h1")
	})

	it("a stock data set stays on its shelf when everything is moved", () => {
		setStockFolders([
			{ id: "fl-stock", name: "Stock Examples", parentId: null, createdAt: 1 },
		])
		let store: TestStore | null = null
		router.search = { kind: "data" }
		render(
			<TestProvider
				initializeState={(s) => {
					store = s
					s.set(foldersAtom, [
						{ id: "fl-stock", name: "Stock Examples", parentId: null, createdAt: 1 },
					])
					s.set(visualsAtom, [
						mkVisual("Example", { datasetId: "ds-import", folderId: "fl-stock" }),
					])
					s.set(loadedDatasetsAtom, { [imported.id]: imported, [copy.id]: copy })
					s.set(dataFoldersAtom, [
						{
							id: "fl-data",
							name: "Mine",
							parentId: null,
							createdAt: 1,
							kind: "data",
							datasetIds: [],
						},
					])
				}}
			>
				<LibraryPage />
			</TestProvider>
		)
		fireEvent.click(screen.getByLabelText("Select all listed data sets"))
		// The button counts what it will move; nothing else is said.
		fireEvent.click(screen.getByRole("button", { name: "Move 1…" }))
		const dialog = screen.getByRole("dialog")
		expect(dialog.textContent).toContain("Move 1 data set")
		fireEvent.click(within(dialog).getByRole("button", { name: "Mine" }))
		fireEvent.click(within(dialog).getByRole("button", { name: "Move" }))
		expect(store!.get(dataFoldersAtom)[0].datasetIds).toEqual(["ds-copy"])
		expect(
			screen
				.getByTestId("data-folder-tree")
				.querySelector('[data-folder-row="stock-data"]')
		).not.toBeNull()
		clearStockFolders()
	})

	it("only a data set no visualization uses goes to the trash, and comes back", () => {
		// "Chart" draws from the copy; the import is free.
		mountData({ kind: "data" }, [])
		const table = screen.getByTestId("data-table")
		fireEvent.click(within(table).getByLabelText("Select sales (edited)"))
		expect(
			(screen.getByRole("button", { name: "Move to trash" }) as HTMLButtonElement)
				.disabled
		).toBe(true)
		fireEvent.click(within(table).getByLabelText("Select sales"))
		fireEvent.click(screen.getByRole("button", { name: "Move 1 to trash" }))
		expect(within(table).queryByText("sales")).toBeNull()
		expect(within(table).getByText("sales (edited)")).toBeTruthy()
		// Still stored — the trash holds it.
		expect(store!.get(loadedDatasetsAtom)["ds-import"]).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: /Open trash, 1 data set/ }))
		const trash = screen.getByRole("dialog")
		fireEvent.click(within(trash).getByRole("button", { name: "Restore" }))
		expect(trash.textContent).toContain("Restored “sales” to Not in a folder.")
		expect(within(screen.getByTestId("data-table")).getByText("sales")).toBeTruthy()
	})

	it("a duplicate is a data set of the user's own, filed where they pick", async () => {
		mountData({ kind: "data" }, [])
		const table = screen.getByTestId("data-table")
		fireEvent.click(within(table).getByLabelText("Select sales"))
		fireEvent.click(screen.getByRole("button", { name: "Duplicate…" }))
		const dialog = screen.getByRole("dialog")
		fireEvent.click(within(dialog).getByRole("button", { name: "Sales data" }))
		fireEvent.click(within(dialog).getByRole("button", { name: "Duplicate" }))
		const row = (
			await within(screen.getByTestId("data-table")).findByText("sales (copy)")
		).closest("tr")!
		expect(row.textContent).toContain("Sales data")
		expect(row.textContent).toContain("2 × 2")
		const copyId = store!.get(dataFoldersAtom)[0].datasetIds![0]
		const made = store!.get(loadedDatasetsAtom)[copyId]
		expect(made.id).not.toBe("ds-import")
		expect(made.versions[0].id).not.toBe("v1")
		expect(made.versions[0].rows).toEqual(imported.versions[0].rows)
	})

	it("uploads a CSV into the folder picked, and says where it went", async () => {
		mountData({ kind: "data" }, [])
		const file = new File(["region,units\nNorth,4\nSouth,6\n"], "units.csv", {
			type: "text/csv",
		})
		fireEvent.change(screen.getByLabelText("CSV files to upload"), {
			target: { files: [file] },
		})
		const dialog = await screen.findByRole("dialog")
		expect(dialog.textContent).toContain("Upload units.csv")
		fireEvent.click(within(dialog).getByRole("button", { name: "Sales data" }))
		fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }))
		expect(
			await screen.findByText("Uploaded “units” to Sales data.")
		).toBeTruthy()
		const row = within(screen.getByTestId("data-table"))
			.getByText("units")
			.closest("tr")!
		expect(row.textContent).toContain("Sales data")
		expect(row.textContent).toContain("2 × 2")
		// The same file again is not stored twice.
		fireEvent.change(screen.getByLabelText("CSV files to upload"), {
			target: { files: [file] },
		})
		fireEvent.click(
			within(await screen.findByRole("dialog")).getByRole("button", {
				name: "Upload",
			})
		)
		expect(await screen.findByText(/already in the library/)).toBeTruthy()
		expect(store!.get(dataFoldersAtom)[0].datasetIds).toHaveLength(1)
	})

	it("checked data sets move into a folder together", () => {
		// Nothing is in a folder of the user's yet.
		mountData({ kind: "data" }, [])
		const table = screen.getByTestId("data-table")
		fireEvent.click(within(table).getByLabelText("Select all listed data sets"))
		expect(screen.getByText("2 selected")).toBeTruthy()
		// Checking a row doesn't open it.
		expect(screen.queryByRole("dialog")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Move…" }))
		const dialog = screen.getByRole("dialog")
		expect(dialog.textContent).toContain("Move 2 data sets")
		fireEvent.click(within(dialog).getByRole("button", { name: "Sales data" }))
		fireEvent.click(within(dialog).getByRole("button", { name: "Move" }))
		expect(store!.get(dataFoldersAtom)[0].datasetIds).toEqual([
			"ds-copy",
			"ds-import",
		])
		expect(screen.queryByText("2 selected")).toBeNull()
	})

	it("leaving for the visuals drops the data tab's folder and sort", () => {
		mountData({ kind: "data", folder: "fl-data", sort: "size:asc", q: "s" })
		const group = screen.getByRole("radiogroup", {
			name: /visualizations, templates/i,
		})
		fireEvent.click(within(group).getByRole("radio", { name: "Visuals" }))
		const [arg] = router.navigate.mock.calls.at(-1)!
		expect(
			(arg as { search: (p: LibrarySearch) => LibrarySearch }).search({
				kind: "data",
				folder: "fl-data",
				sort: "size:asc",
				q: "s",
			})
		).toEqual({ kind: undefined, folder: undefined, sort: undefined, q: "s" })
	})
})
