import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SYSTEM_LIGHT_THEME, themeOf } from "../../../chartBuilder/lib/systemThemes"
import type { Theme } from "../../../chartBuilder/lib/types"

import { LegendSection } from "./LegendSection"
import type { ThemeSetter } from "./types"

afterEach(cleanup)

const THEME: Theme = themeOf(SYSTEM_LIGHT_THEME)

const mount = (theme: Theme = THEME) => {
	const set = vi.fn() as unknown as ThemeSetter
	render(<LegendSection theme={theme} set={set} isReadOnly={false} />)
	// The section group starts collapsed; open it like the user would.
	fireEvent.click(screen.getByRole("button", { name: /Legend/, expanded: false }))
	return set as unknown as ReturnType<typeof vi.fn>
}

describe("LegendSection — legend swatch defaults", () => {
	it("picks a swatch shape, size, and outline width", () => {
		const set = mount()
		fireEvent.click(screen.getByRole("button", { name: "Line segment" }))
		expect(set).toHaveBeenCalledWith("legendSwatchShape", "line")
		fireEvent.click(screen.getByRole("button", { name: "Shape 1" }))
		expect(set).toHaveBeenCalledWith("legendSwatchShape", 0)

		const size = screen.getByLabelText("Swatch size") as HTMLInputElement
		fireEvent.change(size, { target: { value: "8" } })
		expect(set).toHaveBeenCalledWith("legendSwatchSize", 8)

		const width = screen.getByLabelText("Outline thickness") as HTMLInputElement
		fireEvent.change(width, { target: { value: "1.5" } })
		expect(set).toHaveBeenCalledWith("legendSwatchOutlineWidth", 1.5)
	})

	it("the rectangle is the pressed glyph on a fresh theme", () => {
		mount()
		expect(
			screen.getByRole("button", { name: "Rectangle" }).getAttribute("aria-pressed")
		).toBe("true")
	})

	it("outline color: Automatic hides the picker, Custom seeds one", () => {
		const set = mount()
		expect(screen.queryByLabelText("Color")).toBeNull()
		// The first "Custom color" radio is the legend background's.
		fireEvent.click(screen.getAllByLabelText("Custom color")[1]!)
		expect(set).toHaveBeenCalledWith("legendSwatchOutlineColor", "#cccccc")

		cleanup()
		const custom = mount({ ...THEME, legendSwatchOutlineColor: "#123456" })
		expect(screen.getByLabelText("Color")).toBeTruthy()
		fireEvent.click(
			screen.getByLabelText("Automatic (follows the marks' outline)")
		)
		expect(custom).toHaveBeenCalledWith("legendSwatchOutlineColor", null)
	})
})
