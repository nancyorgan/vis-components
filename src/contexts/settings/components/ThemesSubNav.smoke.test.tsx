import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import {
	isManagedTheme,
	SYSTEM_DARK_THEME,
	SYSTEM_LIGHT_THEME,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import { themesAtom, unlockedThemeIdAtom } from "../../chartBuilder/store/atoms"
import { encodeThemeDrag, THEME_DRAG_TYPE } from "../lib/themeFolders"

import { ThemesSubNav } from "./ThemesSubNav"

// Picking a theme routes to that theme's editor; stubbing beats standing
// up a RouterProvider for a sidebar assertion. The route says which theme
// is open — here, none (the gallery is showing).
const navigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	useParams: () => ({}),
	useSearch: () => ({}),
}))

const opened = (themeId: string) => ({
	to: "/settings/themes/$themeId",
	params: { themeId },
})

/** Smoke coverage for the Managed / Custom theme folders: the
 *  administrator dialog gates selecting and re-filing a managed theme, and
 *  a drag across the boundary is what promotes one. */

afterEach(cleanup)
beforeEach(() => navigate.mockClear())

const MINE: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-mine",
	name: "My theme",
	isSystem: false,
	managed: false,
}

/** User themes PROMOTED into Managed Themes — the gated tier. */
const SHARED: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-shared",
	name: "Team theme",
	isSystem: false,
	managed: true,
}
const SHARED_2: SavedTheme = { ...SHARED, id: "th-shared-2", name: "Other team theme" }

const mount = () => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const view = render(
		<TestProvider
			initializeState={(s) => {
				s.set(themesAtom, [
					SYSTEM_LIGHT_THEME,
					SYSTEM_DARK_THEME,
					SHARED,
					SHARED_2,
					MINE,
				])
				store = s
			}}
		>
			<ThemesSubNav />
		</TestProvider>
	)
	return { ...view, store: store as unknown as TestStore }
}

/** happy-dom doesn't build a real DataTransfer for synthetic drag events. */
const dataTransfer = (themeId?: string) => ({
	getData: (type: string) =>
		type === THEME_DRAG_TYPE && themeId ? encodeThemeDrag(themeId) : "",
	setData: () => {},
	dropEffect: "",
	effectAllowed: "",
})

describe("ThemesSubNav folders", () => {
	it("selecting a custom theme routes to that theme's editor", () => {
		// The sub-nav is mounted on every settings page (Fonts, Sharing), so
		// a click from those pages must leave them.
		mount()
		fireEvent.click(screen.getByText("My theme"))
		expect(navigate).toHaveBeenCalledWith(opened("th-mine"))
	})

	it("selecting a managed theme routes only after the dialog is confirmed", () => {
		mount()
		fireEvent.click(screen.getByText("Team theme"))
		expect(navigate).not.toHaveBeenCalled()
		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(navigate).toHaveBeenCalledWith(opened("th-shared"))
	})

	it("files bundled, promoted and plain themes under System, Managed and Custom", () => {
		mount()
		const folderOf = (name: string) =>
			screen
				.getByText(name)
				.closest("div.rounded")
				?.querySelector("button span.truncate")?.textContent
		expect(folderOf("System (Light)")).toBe("System Themes")
		expect(folderOf("Team theme")).toBe("Managed Themes")
		expect(folderOf("My theme")).toBe("Custom Themes")
	})

	it("opens a system theme with no dialog — the editor shows it read-only", () => {
		const { store } = mount()
		fireEvent.click(screen.getByText("System (Dark)"))
		expect(screen.queryByText(/managed by the administrator/i)).toBeNull()
		expect(navigate).toHaveBeenCalledWith(opened("system-dark"))
		expect(store.get(unlockedThemeIdAtom)).toBeNull()
	})

	it("gates selecting a managed theme behind the administrator dialog", () => {
		const { store } = mount()
		fireEvent.click(screen.getByText("Team theme"))
		// Nothing opened yet — the dialog is the gate, not a notice.
		expect(navigate).not.toHaveBeenCalled()
		expect(
			screen.getByText(/managed by the administrator/i)
		).toBeTruthy()

		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(navigate).toHaveBeenCalledWith(opened("th-shared"))
		// Edit access is granted to THAT theme, not to managed themes at large.
		expect(store.get(unlockedThemeIdAtom)).toBe("th-shared")
	})

	it('"No, exit" leaves the selection alone and closes the folder', () => {
		const { store } = mount()
		fireEvent.click(screen.getByText("Team theme"))
		fireEvent.click(screen.getByText("No, exit"))
		expect(navigate).not.toHaveBeenCalled()
		expect(store.get(unlockedThemeIdAtom)).toBeNull()
		// Backed out of the managed folder entirely; the other folders stay.
		expect(screen.queryByText("Team theme")).toBeNull()
		expect(screen.getByText("System (Dark)")).toBeTruthy()
		expect(screen.getByText("My theme")).toBeTruthy()
	})

	it("asks EVERY time, not once per session", () => {
		mount()
		fireEvent.click(screen.getByText("Team theme"))
		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(navigate).toHaveBeenCalledTimes(1)

		// Second managed theme, same session — the warning comes back.
		fireEvent.click(screen.getByText("Other team theme"))
		expect(navigate).toHaveBeenCalledTimes(1)
		expect(screen.getByText(/managed by the administrator/i)).toBeTruthy()
		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(navigate).toHaveBeenLastCalledWith(opened("th-shared-2"))
	})

	it("folds Managed Themes from its chevron with no dialog — looking is not editing", () => {
		mount()
		fireEvent.click(screen.getByLabelText("Collapse Managed Themes"))
		expect(screen.queryByText(/managed by the administrator/i)).toBeNull()
		expect(navigate).not.toHaveBeenCalled()
		expect(screen.queryByText("Team theme")).toBeNull()
		fireEvent.click(screen.getByLabelText("Expand Managed Themes"))
		expect(screen.getByText("Team theme")).toBeTruthy()
	})

	it("narrows the gallery to a folder from its header, like the library's tree", () => {
		mount()
		fireEvent.click(screen.getByText("Custom Themes"))
		expect(navigate).toHaveBeenCalledWith({
			to: "/settings/themes",
			search: { folder: "custom" },
		})
		// The header is a filter, not a fold: the rows stay put.
		expect(screen.getByText("My theme")).toBeTruthy()
		fireEvent.click(screen.getByText("Managed Themes"))
		expect(screen.queryByText(/managed by the administrator/i)).toBeNull()
		expect(navigate).toHaveBeenLastCalledWith({
			to: "/settings/themes",
			search: { folder: "managed" },
		})
	})

	it("folds System Themes from its chevron with no dialog", () => {
		mount()
		fireEvent.click(screen.getByLabelText("Collapse System Themes"))
		expect(screen.queryByText(/managed by the administrator/i)).toBeNull()
		expect(screen.queryByText("System (Dark)")).toBeNull()
	})

	it("promotes a theme dragged into Managed Themes — after the dialog", () => {
		const { store } = mount()
		fireEvent.dragStart(screen.getByText("My theme"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		fireEvent.drop(screen.getByText("Managed Themes"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		// Still custom until the administrator dialog is answered.
		const before = store.get(themesAtom).find((t) => t.id === "th-mine")!
		expect(isManagedTheme(before)).toBe(false)

		fireEvent.click(screen.getByText("Yes, proceed"))
		const after = store.get(themesAtom).find((t) => t.id === "th-mine")!
		expect(isManagedTheme(after)).toBe(true)
	})

	it("demotes a promoted theme dragged back into Custom Themes", () => {
		const { store } = mount()
		// Promote first, then drag it back.
		fireEvent.dragStart(screen.getByText("My theme"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		fireEvent.drop(screen.getByText("Managed Themes"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		fireEvent.click(screen.getByText("Yes, proceed"))

		fireEvent.dragStart(screen.getByText("My theme"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		fireEvent.drop(screen.getByText("Custom Themes"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(
			isManagedTheme(store.get(themesAtom).find((t) => t.id === "th-mine")!)
		).toBe(false)
	})

	it("pins the read-only system themes to System Themes", () => {
		const { store } = mount()
		// The row isn't draggable, and the move is refused even if a drop
		// reaches the folder anyway.
		fireEvent.drop(screen.getByText("Custom Themes"), {
			dataTransfer: dataTransfer("system-light"),
		})
		expect(screen.queryByText("Yes, proceed")).toBeNull()
		const sys = store.get(themesAtom).find((t) => t.id === "system-light")!
		expect(sys.isSystem).toBe(true)
		expect(isManagedTheme(sys)).toBe(true)
	})

	it("refuses drops INTO System Themes", () => {
		const { store } = mount()
		fireEvent.dragStart(screen.getByText("My theme"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		fireEvent.drop(screen.getByText("System Themes"), {
			dataTransfer: dataTransfer("th-mine"),
		})
		expect(screen.queryByText("Yes, proceed")).toBeNull()
		const mine = store.get(themesAtom).find((t) => t.id === "th-mine")!
		expect(mine.isSystem).toBe(false)
		expect(isManagedTheme(mine)).toBe(false)
	})
})
