import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PalettePickerButton } from "./HueOptionsPanel"

/** The circular-arrow button next to each category swatch opens a popover of
 *  the palette's colors (wrapping at 6 per row) instead of blindly stepping
 *  to the next color — picking a swatch commits it and closes the popover. */

const PALETTE = [
	"#111111",
	"#222222",
	"#333333",
	"#444444",
	"#555555",
	"#666666",
	"#777777",
	"#888888",
]

describe("PalettePickerButton", () => {
	afterEach(cleanup)

	it("opens a popover listing every palette color on click", () => {
		const { getByRole, queryByLabelText, getByLabelText } = render(
			<PalettePickerButton
				palette={PALETTE}
				current="#333333"
				onPick={() => {}}
				label="Pick palette color for A"
			/>,
		)
		// Closed by default — no swatches rendered.
		expect(queryByLabelText("Use #111111")).toBeNull()

		const toggle = getByRole("button", { name: "Pick palette color for A" })
		expect(toggle.getAttribute("aria-expanded")).toBe("false")
		fireEvent.click(toggle)
		expect(toggle.getAttribute("aria-expanded")).toBe("true")

		for (const c of PALETTE) {
			expect(getByLabelText(`Use ${c}`)).toBeTruthy()
		}
	})

	it("commits the picked color and closes the popover", () => {
		const onPick = vi.fn()
		const { getByRole, getByLabelText, queryByLabelText } = render(
			<PalettePickerButton
				palette={PALETTE}
				current="#111111"
				onPick={onPick}
				label="Pick palette color for A"
			/>,
		)
		fireEvent.click(getByRole("button", { name: "Pick palette color for A" }))
		fireEvent.click(getByLabelText("Use #555555"))
		expect(onPick).toHaveBeenCalledWith("#555555")
		expect(queryByLabelText("Use #555555")).toBeNull()
	})

	it("toggles closed on a second click and on Escape", () => {
		const { getByRole, queryByLabelText } = render(
			<PalettePickerButton
				palette={PALETTE}
				current="#111111"
				onPick={() => {}}
				label="Pick palette color for A"
			/>,
		)
		const toggle = getByRole("button", { name: "Pick palette color for A" })
		fireEvent.click(toggle)
		expect(queryByLabelText("Use #111111")).toBeTruthy()
		fireEvent.click(toggle)
		expect(queryByLabelText("Use #111111")).toBeNull()

		fireEvent.click(toggle)
		expect(queryByLabelText("Use #111111")).toBeTruthy()
		fireEvent.keyDown(toggle, { key: "Escape" })
		expect(queryByLabelText("Use #111111")).toBeNull()
	})

	it("renders nothing for an empty palette", () => {
		const { container } = render(
			<PalettePickerButton
				palette={[]}
				current="#111111"
				onPick={() => {}}
				label="Pick palette color for A"
			/>,
		)
		expect(container.firstChild).toBeNull()
	})
})
