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
		fireEvent.click(screen.getByRole("button", { name: "Circle" }))
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

describe("LegendSection — layout, box, gradient defaults", () => {
	it("Layout: position + orientation write their theme keys, built-in shown when unset", () => {
		const set = mount()
		const position = screen.getByLabelText("Position") as HTMLSelectElement
		expect(position.value).toBe("right")
		fireEvent.change(position, { target: { value: "bottom" } })
		expect(set).toHaveBeenCalledWith("legendPosition", "bottom")

		const orientation = screen.getByLabelText("Orientation") as HTMLSelectElement
		expect(orientation.value).toBe("vertical")
		fireEvent.change(orientation, { target: { value: "horizontal" } })
		expect(set).toHaveBeenCalledWith("legendOrientation", "horizontal")
	})

	it("Box: Border toggles, and its color / radius show only while on", () => {
		const set = mount()
		expect(screen.queryByLabelText("Border color")).toBeNull()
		fireEvent.click(screen.getByLabelText("Border"))
		expect(set).toHaveBeenCalledWith("legendShowBorder", true)

		cleanup()
		const on = mount({ ...THEME, legendShowBorder: true })
		// Corner radius appears twice (box + gradient bar); the box's is first.
		const radius = screen.getAllByLabelText("Corner radius")[0] as HTMLInputElement
		expect(radius.value).toBe("6")
		fireEvent.change(radius, { target: { value: "3" } })
		expect(on).toHaveBeenCalledWith("legendBorderRadius", 3)
		expect(screen.getAllByLabelText("Border color").length).toBeGreaterThan(0)
	})

	it("Gradient legend: style + bar fields write their theme keys", () => {
		const set = mount()
		fireEvent.change(screen.getByLabelText("Gradient legend style"), {
			target: { value: "swatches" },
		})
		expect(set).toHaveBeenCalledWith("legendGradientStyle", "swatches")

		const length = screen.getByLabelText("Bar length") as HTMLInputElement
		expect(length.value).toBe("")
		fireEvent.change(length, { target: { value: "180" } })
		expect(set).toHaveBeenCalledWith("legendGradientBarLength", 180)

		const thickness = screen.getByLabelText("Bar thickness") as HTMLInputElement
		expect(thickness.value).toBe("12")
		fireEvent.change(thickness, { target: { value: "16" } })
		expect(set).toHaveBeenCalledWith("legendGradientBarThickness", 16)

		fireEvent.change(screen.getByLabelText("Border thickness"), {
			target: { value: "1" },
		})
		expect(set).toHaveBeenCalledWith("legendGradientBarBorderWidth", 1)

		fireEvent.change(screen.getByLabelText("Tick length"), {
			target: { value: "4" },
		})
		expect(set).toHaveBeenCalledWith("legendGradientBarTickLength", 4)

		fireEvent.click(screen.getByRole("button", { name: /right/i }))
		expect(set).toHaveBeenCalledWith("legendGradientBarLabelAlign", "right")
	})

	it("bar border color + tick rows show only once their thickness / length is on", () => {
		mount()
		expect(screen.queryByLabelText("Tick thickness")).toBeNull()
		expect(screen.queryByLabelText("Tick color")).toBeNull()
		expect(screen.queryByLabelText("Border color")).toBeNull()

		cleanup()
		const set = mount({
			...THEME,
			legendGradientBarTickLength: 4,
			legendGradientBarBorderWidth: 1,
		})
		const tick = screen.getByLabelText("Tick thickness") as HTMLInputElement
		fireEvent.change(tick, { target: { value: "2" } })
		expect(set).toHaveBeenCalledWith("legendGradientBarTickThickness", 2)
		expect(screen.getByLabelText("Tick color")).toBeTruthy()
		expect(screen.getByLabelText("Border color")).toBeTruthy()
	})
})
