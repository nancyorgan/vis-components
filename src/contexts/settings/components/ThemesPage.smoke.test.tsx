import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import {
	SYSTEM_DARK_THEME,
	SYSTEM_LIGHT_THEME,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import {
	editingThemeIdAtom,
	themesAtom,
	unlockedThemeIdAtom,
	userDefaultThemeIdAtom,
} from "../../chartBuilder/store/atoms"

import { ThemesPage } from "./ThemesPage"

/** Smoke coverage for the managed half of the theme editor: a managed
 *  theme is locked until the administrator dialog is answered, the two
 *  bundled themes can't be deleted even once unlocked, and a custom theme
 *  is unaffected by any of it. */

afterEach(cleanup)

const MINE: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-mine",
	name: "My theme",
	isSystem: false,
	managed: false,
}

/** A user theme that was PROMOTED into Managed Themes — managed, but not
 *  one of the two read-only bundled themes. */
const SHARED: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-shared",
	name: "Team theme",
	isSystem: false,
	managed: true,
}

const mount = (
	editingId: string,
	unlockedId: string | null = null,
	defaultThemeId = SYSTEM_LIGHT_THEME.id
) => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const view = render(
		<TestProvider
			initializeState={(s) => {
				s.set(themesAtom, [
					SYSTEM_LIGHT_THEME,
					SYSTEM_DARK_THEME,
					SHARED,
					MINE,
				])
				s.set(editingThemeIdAtom, editingId)
				s.set(unlockedThemeIdAtom, unlockedId)
				s.set(userDefaultThemeIdAtom, defaultThemeId)
				store = s
			}}
		>
			<ThemesPage />
		</TestProvider>
	)
	return { ...view, store: store as unknown as TestStore }
}

const nameInput = () =>
	screen.getByLabelText("Theme name") as HTMLInputElement

const defaultToggle = () =>
	screen.queryByText(/Make this the default theme/i)

describe("ThemesPage managed themes", () => {
	it("locks a promoted managed theme until the dialog is answered", () => {
		const { store } = mount("th-shared")
		expect(nameInput().disabled).toBe(true)

		fireEvent.click(screen.getByText("unlock it to edit"))
		fireEvent.click(screen.getByText("Yes, proceed"))

		// Access is granted to THIS theme, not to managed themes at large.
		expect(store.get(unlockedThemeIdAtom)).toBe("th-shared")
		expect(nameInput().disabled).toBe(false)
	})

	it("keeps the theme locked on \"No, exit\"", () => {
		const { store } = mount("th-shared")
		fireEvent.click(screen.getByText("unlock it to edit"))
		fireEvent.click(screen.getByText("No, exit"))
		expect(store.get(unlockedThemeIdAtom)).toBeNull()
		expect(nameInput().disabled).toBe(true)
	})

	it("re-locks when a DIFFERENT managed theme was the one unlocked", () => {
		mount("th-shared", "system-dark")
		expect(nameInput().disabled).toBe(true)
	})

	it("keeps system themes read-only — no unlock is on offer", () => {
		mount("system-light")
		expect(nameInput().disabled).toBe(true)
		expect(screen.queryByText("unlock it to edit")).toBeNull()
		expect(screen.getByText(/System themes are read-only/i)).toBeTruthy()
	})

	it("keeps a system theme read-only even if it holds the unlock", () => {
		// Clicking a system theme still puts up the warning (it's managed),
		// so it can end up as the unlocked id — that must not make it
		// editable.
		mount("system-light", "system-light")
		expect(nameInput().disabled).toBe(true)
	})

	it("never offers to delete a bundled theme", () => {
		mount("system-light", "system-light")
		expect(screen.queryByText("Delete this theme")).toBeNull()
	})

	it("leaves a custom theme editable with no dialog and no badge", () => {
		mount("th-mine")
		expect(nameInput().disabled).toBe(false)
		expect(screen.queryByText("Managed")).toBeNull()
		expect(screen.getByText("Delete this theme")).toBeTruthy()
	})
})

describe("ThemesPage default theme", () => {
	it("never offers the default toggle on a custom theme", () => {
		mount("th-mine")
		expect(defaultToggle()).toBeNull()
	})

	it("offers it on a promoted managed theme, disabled until unlocked", () => {
		mount("th-shared")
		expect(defaultToggle()).toBeTruthy()
		expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
			true
		)

		cleanup()
		mount("th-shared", "th-shared")
		expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
			false
		)
	})

	it("still lets a read-only system theme be made the default", () => {
		// Which theme new visualizations START from isn't an edit to the
		// theme, and system-light is the app's own fallback default.
		const { store } = mount("system-dark")
		expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
			false
		)
		fireEvent.click(screen.getByRole("checkbox"))
		fireEvent.click(screen.getByText("Make default"))
		expect(store.get(userDefaultThemeIdAtom)).toBe("system-dark")
	})

	it("claims the slot from a promoted managed theme once unlocked", () => {
		const { store } = mount("th-shared", "th-shared")
		fireEvent.click(screen.getByRole("checkbox"))
		// Another theme holds it, so the steal is confirmed first.
		fireEvent.click(screen.getByText("Make default"))
		expect(store.get(userDefaultThemeIdAtom)).toBe("th-shared")
	})

	it("flags a custom theme that already HOLDS the default slot", () => {
		// The pre-rule state: a custom theme was made the default before
		// managed themes existed. It keeps the slot, but says so.
		mount("th-mine", null, "th-mine")
		expect(defaultToggle()).toBeNull()
		expect(
			screen.getByText(/currently the default theme for new visualizations/i)
		).toBeTruthy()
	})
})
