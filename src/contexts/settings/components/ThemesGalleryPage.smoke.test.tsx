import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import {
	SYSTEM_DARK_THEME,
	SYSTEM_LIGHT_THEME,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import {
	themesAtom,
	unlockedThemeIdAtom,
	userDefaultThemeIdAtom,
} from "../../chartBuilder/store/atoms"

import { ThemesGalleryPage } from "./ThemesGalleryPage"

// Custom-theme cards are real links (middle-click, prefetch); managed cards
// are buttons that put up the administrator dialog and then navigate.
const navigate = vi.fn()
let search: { folder?: string } = {}
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	useSearch: () => search,
	Link: ({
		children,
		to,
		params,
		...rest
	}: React.PropsWithChildren<
		{ to: string; params?: Record<string, string> } & React.AnchorHTMLAttributes<HTMLAnchorElement>
	>) => (
		<a
			href={Object.entries(params ?? {}).reduce(
				(href, [k, v]) => href.replace(`$${k}`, v),
				to
			)}
			{...rest}
		>
			{children}
		</a>
	),
}))

afterEach(cleanup)
beforeEach(() => {
	navigate.mockClear()
	search = {}
})

const MINE: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-mine",
	name: "My theme",
	isSystem: false,
	managed: false,
	titleFontFamily: "Fraunces, serif",
	categoricalPalettes: [
		{
			id: "p",
			name: "P",
			colors: [
				"#110001",
				"#110002",
				"#110003",
				"#110004",
				"#110005",
				"#110006",
				"#110007",
				"#110008",
			],
		},
	],
	defaultCategoricalPaletteId: "p",
}

const SHARED: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-shared",
	name: "Team theme",
	isSystem: false,
	managed: true,
}

const mount = (
	themes: SavedTheme[] = [SYSTEM_LIGHT_THEME, SYSTEM_DARK_THEME, SHARED, MINE]
) => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const view = render(
		<TestProvider
			initializeState={(s) => {
				s.set(themesAtom, themes)
				s.set(userDefaultThemeIdAtom, SYSTEM_LIGHT_THEME.id)
				store = s
			}}
		>
			<ThemesGalleryPage />
		</TestProvider>
	)
	return { ...view, store: store as unknown as TestStore }
}

describe("ThemesGalleryPage", () => {
	it("shows every theme as a card under one of the three folders", () => {
		mount()
		const folderOf = (name: string) =>
			screen.getByLabelText(`Open ${name}`).closest("section")?.querySelector("h2")
				?.textContent
		expect(folderOf("System (Light)")).toBe("System Themes")
		expect(folderOf("System (Dark)")).toBe("System Themes")
		expect(folderOf("Team theme")).toBe("Managed Themes")
		expect(folderOf("My theme")).toBe("Custom Themes")
	})

	it("links a custom theme's card straight to its editor", () => {
		mount()
		const card = screen.getByLabelText("Open My theme") as HTMLAnchorElement
		expect(card.tagName).toBe("A")
		expect(card.getAttribute("href")).toBe("/settings/themes/th-mine")
	})

	it("links a system theme's card straight to its (read-only) editor — no dialog", () => {
		mount()
		const card = screen.getByLabelText("Open System (Dark)") as HTMLAnchorElement
		expect(card.tagName).toBe("A")
		expect(card.getAttribute("href")).toBe("/settings/themes/system-dark")
	})

	it("fills the preview template from the theme itself", () => {
		mount()
		const card = screen.getByLabelText("Open My theme")
		const svg = card.querySelector("svg")!
		// The theme's name is set in its own title font — the card doubles as
		// a type specimen.
		const title = Array.from(svg.querySelectorAll("text")).find(
			(t) => t.textContent === "My theme"
		)!
		expect(title.getAttribute("font-family")).toBe("Fraunces, serif")
		// One bar per color of the DEFAULT categorical palette, the first
		// six only (each also keys a legend row).
		const fills = new Set(
			Array.from(svg.querySelectorAll("rect")).map((r) => r.getAttribute("fill"))
		)
		for (const c of ["#110001", "#110002", "#110003", "#110004", "#110005", "#110006"])
			expect(fills.has(c)).toBe(true)
		expect(fills.has("#110007")).toBe(false)
		expect(fills.has("#110008")).toBe(false)
	})

	it("draws fewer bars for a shorter palette", () => {
		mount([
			SYSTEM_LIGHT_THEME,
			{
				...MINE,
				categoricalPalettes: [
					{ id: "p", name: "P", colors: ["#aa0001", "#aa0002", "#aa0003"] },
				],
			},
		])
		const svg = screen.getByLabelText("Open My theme").querySelector("svg")!
		const bars = Array.from(svg.querySelectorAll("rect")).filter((r) =>
			/^#aa000[123]$/.test(r.getAttribute("fill") ?? "")
		)
		// Three bars + their three legend swatches, nothing cycled.
		expect(bars).toHaveLength(6)
	})

	it("gates a managed theme's card behind the administrator dialog", () => {
		const { store } = mount()
		fireEvent.click(screen.getByLabelText("Open Team theme"))
		expect(navigate).not.toHaveBeenCalled()
		expect(screen.getByText(/managed by the administrator/i)).toBeTruthy()

		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(store.get(unlockedThemeIdAtom)).toBe("th-shared")
		expect(navigate).toHaveBeenCalledWith({
			to: "/settings/themes/$themeId",
			params: { themeId: "th-shared" },
		})
	})

	it("stays on the gallery on \"No, exit\"", () => {
		const { store } = mount()
		fireEvent.click(screen.getByLabelText("Open Team theme"))
		fireEvent.click(screen.getByText("No, exit"))
		expect(navigate).not.toHaveBeenCalled()
		expect(store.get(unlockedThemeIdAtom)).toBeNull()
	})

	it("marks the default theme, the read-only bundled themes and the managed tier", () => {
		mount()
		expect(screen.getAllByText("Default")).toHaveLength(1)
		expect(
			screen.getByLabelText("Open System (Light)").textContent
		).toContain("Default")
		expect(screen.getAllByText("Read-only")).toHaveLength(2)
		expect(screen.getAllByText("Managed")).toHaveLength(1)
		expect(screen.getByLabelText("Open Team theme").textContent).toContain("Managed")
		expect(screen.getByLabelText("Open My theme").textContent).not.toMatch(
			/Read-only|Managed/
		)
	})

	it("narrows to one folder from ?folder= and offers the way back to all", () => {
		search = { folder: "custom" }
		mount()
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Custom Themes"
		)
		expect(screen.getByLabelText("Open My theme")).toBeTruthy()
		expect(screen.queryByLabelText("Open System (Light)")).toBeNull()
		expect(screen.queryByLabelText("Open Team theme")).toBeNull()
		expect(
			(screen.getByText("Show all themes") as HTMLAnchorElement).getAttribute("href")
		).toBe("/settings/themes")
	})

	it("says so when a folder is empty", () => {
		mount([SYSTEM_LIGHT_THEME, SYSTEM_DARK_THEME])
		expect(screen.getByText(/No custom themes yet/i)).toBeTruthy()
		expect(screen.getByText(/No managed themes/i)).toBeTruthy()
	})
})
