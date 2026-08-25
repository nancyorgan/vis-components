import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import {
	SYSTEM_DARK_THEME,
	SYSTEM_LIGHT_THEME,
} from "../../lib/systemThemes"
import type { SavedTheme } from "../../lib/types"
import {
	currentThemeIdAtom,
	themesAtom,
	userDefaultThemeIdAtom,
} from "../../store/atoms"

import { ThemePanel } from "./ThemePanel"

/** The editor sidebar is the OTHER way to assign the default theme, so it
 *  has to enforce the same rule as Settings → Themes: managed themes only,
 *  behind the administrator gate. */

afterEach(cleanup)

const MINE: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-mine",
	name: "My theme",
	isSystem: false,
	managed: false,
}

const mount = (activeThemeId: string) => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const view = render(
		<TestProvider
			initializeState={(s) => {
				s.set(themesAtom, [SYSTEM_LIGHT_THEME, SYSTEM_DARK_THEME, MINE])
				s.set(currentThemeIdAtom, activeThemeId)
				s.set(userDefaultThemeIdAtom, SYSTEM_LIGHT_THEME.id)
				store = s
			}}
		>
			<ThemePanel />
		</TestProvider>
	)
	// The subsection is collapsed by default — open it so the body renders.
	fireEvent.click(screen.getByRole("button", { name: /^Theme/ }))
	return { ...view, store: store as unknown as TestStore }
}

const defaultLink = () => screen.queryByText("Make this the default theme")

describe("ThemePanel default theme link", () => {
	it("is absent for a custom theme", () => {
		mount("th-mine")
		expect(defaultLink()).toBeNull()
	})

	it("gates a managed theme behind the administrator dialog", () => {
		const { store } = mount("system-dark")
		fireEvent.click(defaultLink() as HTMLElement)
		expect(store.get(userDefaultThemeIdAtom)).toBe("system-light")

		fireEvent.click(screen.getByText("Yes, proceed"))
		expect(store.get(userDefaultThemeIdAtom)).toBe("system-dark")
	})

	it('"No, exit" leaves the default alone', () => {
		const { store } = mount("system-dark")
		fireEvent.click(defaultLink() as HTMLElement)
		fireEvent.click(screen.getByText("No, exit"))
		expect(store.get(userDefaultThemeIdAtom)).toBe("system-light")
	})

	it("is absent for the theme that already holds the slot", () => {
		mount("system-light")
		expect(defaultLink()).toBeNull()
	})
})
