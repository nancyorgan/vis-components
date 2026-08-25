import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import {
	isManagedTheme,
	SYSTEM_DARK_THEME,
	SYSTEM_LIGHT_THEME,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import {
	editingThemeIdAtom,
	themesAtom,
	unlockedThemeIdAtom,
} from "../../chartBuilder/store/atoms"
import { encodeThemeDrag, THEME_DRAG_TYPE } from "../lib/themeFolders"

import { ThemesSubNav } from "./ThemesSubNav"

/** Smoke coverage for the Managed / Custom theme folders: the
 *  administrator dialog gates selecting and re-filing a managed theme, and
 *  a drag across the boundary is what promotes one. */

afterEach(cleanup)

const MINE: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-mine",
	name: "My theme",
	isSystem: false,
	managed: false,
}

const mount = () => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const view = render(
		<TestProvider
			initializeState={(s) => {
				s.set(themesAtom, [SYSTEM_LIGHT_THEME, SYSTEM_DARK_THEME, MINE])
				s.set(editingThemeIdAtom, "th-mine")
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
	it("files the bundled themes under Managed and the rest under Custom", () => {
		mount()
		expect(screen.getByText("Managed Themes")).toBeTruthy()
		expect(screen.getByText("Custom Themes")).toBeTruthy()
		expect(screen.getByText("System (Light)")).toBeTruthy()
		expect(screen.getByText("My theme")).toBeTruthy()
	})

	it("gates selecting a managed theme behind the administrator dialog", () => {
		const { store } = mount()
		fireEvent.click(screen.getByText("System (Dark)"))
		// Nothing selected yet — the dialog is the gate, not a notice.
		expect(store.get(editingThemeIdAtom)).toBe("th-mine")
		expect(
			screen.getByText(/managed by the administrator/i)
		).toBeTruthy()

		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(store.get(editingThemeIdAtom)).toBe("system-dark")
		// Edit access is granted to THAT theme, not to managed themes at large.
		expect(store.get(unlockedThemeIdAtom)).toBe("system-dark")
	})

	it('"No, exit" leaves the selection alone and closes the folder', () => {
		const { store } = mount()
		fireEvent.click(screen.getByText("System (Dark)"))
		fireEvent.click(screen.getByText("No, exit"))
		expect(store.get(editingThemeIdAtom)).toBe("th-mine")
		expect(store.get(unlockedThemeIdAtom)).toBeNull()
		// Backed out of the managed folder entirely.
		expect(screen.queryByText("System (Dark)")).toBeNull()
		expect(screen.getByText("My theme")).toBeTruthy()
	})

	it("asks EVERY time, not once per session", () => {
		const { store } = mount()
		fireEvent.click(screen.getByText("System (Dark)"))
		fireEvent.click(screen.getByText("Yes, proceed"))

		// Second managed theme, same session — the warning comes back.
		fireEvent.click(screen.getByText("System (Light)"))
		expect(store.get(editingThemeIdAtom)).toBe("system-dark")
		expect(screen.getByText(/managed by the administrator/i)).toBeTruthy()
		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(store.get(editingThemeIdAtom)).toBe("system-light")
	})

	it("asks before opening or closing the Managed Themes folder", () => {
		mount()
		fireEvent.click(screen.getByText("Managed Themes"))
		expect(screen.getByText(/managed by the administrator/i)).toBeTruthy()
		fireEvent.click(screen.getByText("Yes, proceed"))
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

	it("pins the read-only system themes to Managed Themes", () => {
		const { store } = mount()
		// The row isn't draggable, and the move is refused even if a drop
		// reaches the folder anyway.
		fireEvent.drop(screen.getByText("Custom Themes"), {
			dataTransfer: dataTransfer("system-light"),
		})
		expect(screen.queryByText("Yes, proceed")).toBeNull()
		expect(
			isManagedTheme(store.get(themesAtom).find((t) => t.id === "system-light")!)
		).toBe(true)
	})
})
