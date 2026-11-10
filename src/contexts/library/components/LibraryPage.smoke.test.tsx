import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TestProvider } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../chartBuilder/lib/labelsConfig"
import { emptyEncodings, type Visual } from "../../chartBuilder/lib/types"
import { visualsAtom } from "../../chartBuilder/store/atoms"
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

	it("All lists both; an ordinary card still opens in the editor", () => {
		mount(rows, { kind: "all" })
		const grid = gallery()
		expect(
			within(grid).getByText("Chart").closest("a")!.getAttribute("href")
		).toBe("/editor/Chart")
		expect(
			within(grid).getByText("Tpl").closest("a")!.getAttribute("href")
		).toBe("/editor/new?templateId=Tpl")
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
		mount(rows, { kind: "all" })
		const group = screen.getByRole("radiogroup", {
			name: /visualizations, templates/i,
		})
		fireEvent.click(within(group).getByRole("radio", { name: "Templates" }))
		fireEvent.click(within(group).getByRole("radio", { name: "Visuals" }))
		const applied = router.navigate.mock.calls.map(([arg]) =>
			(arg as { search: (p: LibrarySearch) => LibrarySearch }).search({
				kind: "all",
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
