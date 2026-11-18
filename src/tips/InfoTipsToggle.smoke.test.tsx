import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { infoTipsModeAtom } from "../contexts/chartBuilder/store/atoms"
import { installInMemoryLocalStorage } from "../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../testSupport/TestProvider"
import { InfoTipsToggle } from "./InfoTipsToggle"

/** The header's Info tips toggle: one icon button that steps through the
 *  three settings — paced → all → paced → off → paced → … — named for the
 *  setting it's on, and kept in localStorage across sessions. */

/** The fresh localStorage's backing map, to seed and read saved keys. */
let saved = new Map<string, string>()
beforeEach(() => {
	saved = installInMemoryLocalStorage()
})
afterEach(cleanup)

const STORE_KEY = "vis-components:infoTipsMode"

const mount = () => {
	let store: TestStore | undefined
	render(
		<TestProvider initializeState={(s) => (store = s)}>
			<InfoTipsToggle />
		</TestProvider>
	)
	return () => store?.get(infoTipsModeAtom)
}

const button = () => screen.getByRole("button")
const crossedOut = () => button().querySelector("svg circle[r='10.6']") !== null

describe("InfoTipsToggle", () => {
	it("steps paced → all → paced → off → paced → all", () => {
		const mode = mount()
		expect(mode()).toBe("paced")
		expect(button().getAttribute("title")).toBe("Info tips")
		expect(button().getAttribute("aria-label")).toBe("Info tips")
		expect(button().className).not.toContain("vc-toggle-on")
		expect(crossedOut()).toBe(false)

		fireEvent.click(button())
		expect(mode()).toBe("all")
		expect(button().getAttribute("title")).toBe("All info tips")
		expect(button().className).toContain("vc-toggle-on")

		fireEvent.click(button())
		expect(mode()).toBe("paced")
		expect(button().className).not.toContain("vc-toggle-on")

		fireEvent.click(button())
		expect(mode()).toBe("off")
		expect(button().getAttribute("title")).toBe("Info tips off")
		expect(button().className).not.toContain("vc-toggle-on")
		expect(crossedOut()).toBe(true)

		fireEvent.click(button())
		expect(mode()).toBe("paced")
		expect(crossedOut()).toBe(false)

		fireEvent.click(button())
		expect(mode()).toBe("all")
	})

	it("saves the setting and starts from the saved one", () => {
		mount()
		fireEvent.click(button())
		expect(saved.get(STORE_KEY)).toBe('"all"')
		cleanup()

		saved.set(STORE_KEY, '"off"')
		const again = mount()
		expect(again()).toBe("off")
		expect(button().getAttribute("aria-label")).toBe("Info tips off")
		expect(crossedOut()).toBe(true)
		// Off goes back to the paced tips.
		fireEvent.click(button())
		expect(again()).toBe("paced")
		expect(saved.get(STORE_KEY)).toBe('"paced"')
	})

	it("reads an unknown saved value as the paced tips", () => {
		saved.set(STORE_KEY, '"loud"')
		const mode = mount()
		expect(mode()).toBe("paced")
	})
})
