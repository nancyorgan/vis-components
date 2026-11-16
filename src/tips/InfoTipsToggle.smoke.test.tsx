import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TestProvider, type TestStore } from "../testSupport/TestProvider"
import { infoTipsAtom } from "./infoTips"
import { InfoTipsToggle } from "./InfoTipsToggle"

/** The header's Info tips toggle: a pressed/unpressed icon button named
 *  "Info tips" that flips `infoTipsAtom` (TipHost then swaps the paced
 *  tips for the board of every tip in view). */

afterEach(cleanup)

describe("InfoTipsToggle", () => {
	it("flips the board on and off", () => {
		let store: TestStore | undefined
		render(
			<TestProvider initializeState={(s) => (store = s)}>
				<InfoTipsToggle />
			</TestProvider>
		)
		const button = screen.getByRole("button", { name: "Info tips" })
		expect(button.getAttribute("title")).toBe("Info tips")
		expect(button.getAttribute("aria-pressed")).toBe("false")
		expect(store?.get(infoTipsAtom)).toBe(false)

		fireEvent.click(button)
		expect(button.getAttribute("aria-pressed")).toBe("true")
		expect(store?.get(infoTipsAtom)).toBe(true)

		fireEvent.click(button)
		expect(store?.get(infoTipsAtom)).toBe(false)
	})
})
