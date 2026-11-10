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
	currentChannelConfigsAtom,
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

/** Light with its own fill and point size, so a switch to it has a
 *  visible "follows" case for each. */
const OTHER: SavedTheme = {
	...SYSTEM_LIGHT_THEME,
	id: "th-other",
	name: "Other theme",
	isSystem: false,
	managed: false,
	defaultFill: "#123456",
	defaultRadius: SYSTEM_LIGHT_THEME.defaultRadius + 20,
}

const mount = (activeThemeId: string) => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const view = render(
		<TestProvider
			initializeState={(s) => {
				s.set(themesAtom, [SYSTEM_LIGHT_THEME, SYSTEM_DARK_THEME, MINE, OTHER])
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

describe("ThemePanel applyTheme chart background", () => {
	it("carries the new theme's chart background into the live configs", () => {
		const { store } = mount(SYSTEM_LIGHT_THEME.id)
		// Light theme is transparent; switching to the dark theme (which
		// declares a background) must not leave the chart transparent.
		store.set(currentChannelConfigsAtom, {
			...store.get(currentChannelConfigsAtom),
			backgroundColor: null,
		})
		fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
			target: { value: SYSTEM_DARK_THEME.id },
		})
		expect(store.get(currentChannelConfigsAtom).backgroundColor).toBe(
			SYSTEM_DARK_THEME.chartBackgroundColor
		)
		expect(SYSTEM_DARK_THEME.chartBackgroundColor).not.toBeNull()
	})

	it("switching to a transparent theme clears the background", () => {
		const { store } = mount(SYSTEM_DARK_THEME.id)
		store.set(currentChannelConfigsAtom, {
			...store.get(currentChannelConfigsAtom),
			backgroundColor: SYSTEM_DARK_THEME.chartBackgroundColor,
		})
		fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
			target: { value: SYSTEM_LIGHT_THEME.id },
		})
		expect(store.get(currentChannelConfigsAtom).backgroundColor).toBeNull()
	})
})

/** The theme changes the defaults, never a setting the user made: a
 * slot moved off the current theme's value is a pick and survives the
 * switch (lib/themeSwitch.ts), while its untouched siblings follow. */
describe("ThemePanel applyTheme keeps user picks", () => {
	it("keeps a hand-set point size and custom background; follows the fill", () => {
		const { store } = mount(SYSTEM_LIGHT_THEME.id)
		store.set(currentChannelConfigsAtom, {
			...store.get(currentChannelConfigsAtom),
			defaultRadius: SYSTEM_LIGHT_THEME.defaultRadius + 5,
			backgroundColor: "#fffbe6",
			defaultFill: SYSTEM_LIGHT_THEME.defaultFill,
		})
		fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
			target: { value: OTHER.id },
		})
		const next = store.get(currentChannelConfigsAtom)
		expect(next.defaultRadius).toBe(SYSTEM_LIGHT_THEME.defaultRadius + 5)
		expect(next.backgroundColor).toBe("#fffbe6")
		expect(next.defaultFill).toBe("#123456")
	})

	it("follows the new point size when the old one was untouched", () => {
		const { store } = mount(SYSTEM_LIGHT_THEME.id)
		store.set(currentChannelConfigsAtom, {
			...store.get(currentChannelConfigsAtom),
			defaultRadius: SYSTEM_LIGHT_THEME.defaultRadius,
		})
		fireEvent.change(screen.getByRole("combobox", { name: "Theme" }), {
			target: { value: OTHER.id },
		})
		expect(store.get(currentChannelConfigsAtom).defaultRadius).toBe(OTHER.defaultRadius)
	})
})
