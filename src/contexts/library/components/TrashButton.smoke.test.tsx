import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { TestProvider, type TestStore } from "../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"
import { EMPTY_CHANNEL_CONFIGS } from "../../chartBuilder/lib/channelConfig"
import { SYSTEM_LIGHT_THEME } from "../../chartBuilder/lib/systemThemes"
import { labelsFromTheme } from "../../chartBuilder/lib/themeConfig"
import { emptyEncodings, type Visual } from "../../chartBuilder/lib/types"
import { visualsAtom } from "../../chartBuilder/store/atoms"
import { TrashButton } from "./TrashButton"

beforeEach(() => {
	installInMemoryLocalStorage()
})
afterEach(cleanup)

const visual = (id: string, over: Partial<Visual> = {}): Visual => ({
	id,
	name: id,
	folderId: null,
	datasetId: null,
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: emptyEncodings(),
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: labelsFromTheme(SYSTEM_LIGHT_THEME),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...over,
})

const mount = (visuals: Visual[]) => {
	const captured: { store?: TestStore } = {}
	render(
		<TestProvider
			initializeState={(s) => {
				captured.store = s
				s.set(visualsAtom, visuals)
			}}
		>
			<TrashButton />
		</TestProvider>
	)
	return captured.store!
}

describe("TrashButton", () => {
	it("shows no badge and an empty panel when nothing is trashed", () => {
		mount([visual("live")])
		const button = screen.getByRole("button", { name: /open trash/i })
		expect(button.textContent).toBe("")
		fireEvent.click(button)
		expect(screen.getByText(/nothing in the trash/i)).toBeTruthy()
		expect(screen.queryByText("live")).toBeNull()
	})

	it("counts trashed visuals and lists only them", () => {
		mount([visual("live"), visual("gone", { deletedAt: 5 })])
		const button = screen.getByRole("button", { name: /open trash, 1 item/i })
		expect(button.textContent).toBe("1")
		fireEvent.click(button)
		expect(screen.getByText("gone")).toBeTruthy()
		expect(screen.queryByText("live")).toBeNull()
	})

	it("Restore brings the visual back to the library", () => {
		const store = mount([visual("gone", { deletedAt: 5 })])
		fireEvent.click(screen.getByRole("button", { name: /open trash/i }))
		fireEvent.click(screen.getByRole("button", { name: "Restore" }))
		const [restored] = store.get(visualsAtom)
		expect(restored.id).toBe("gone")
		expect(restored.deletedAt).toBeUndefined()
		expect(screen.getByText(/nothing in the trash/i)).toBeTruthy()
	})

	it("Delete forever removes the row outright", () => {
		const store = mount([visual("gone", { deletedAt: 5 }), visual("live")])
		fireEvent.click(screen.getByRole("button", { name: /open trash/i }))
		fireEvent.click(screen.getByRole("button", { name: "Delete forever" }))
		expect(store.get(visualsAtom).map((v) => v.id)).toEqual(["live"])
	})

	it("Empty trash asks once, then purges everything trashed", () => {
		const store = mount([
			visual("a", { deletedAt: 5 }),
			visual("b", { deletedAt: 6 }),
			visual("live"),
		])
		fireEvent.click(screen.getByRole("button", { name: /open trash/i }))
		fireEvent.click(screen.getByRole("button", { name: /empty trash/i }))
		// Nothing purged yet — the inline confirm is showing.
		expect(store.get(visualsAtom)).toHaveLength(3)
		fireEvent.click(screen.getByRole("button", { name: /yes, empty the trash/i }))
		expect(store.get(visualsAtom).map((v) => v.id)).toEqual(["live"])
	})
})
