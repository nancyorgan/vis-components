import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SYSTEM_LIGHT_THEME, themeOf } from "../../../chartBuilder/lib/systemThemes"
import type { Theme } from "../../../chartBuilder/lib/types"

import { TooltipsSection } from "./TooltipsSection"
import type { ThemeSetter } from "./types"

afterEach(cleanup)

const THEME: Theme = themeOf(SYSTEM_LIGHT_THEME)

const mount = (theme: Theme = THEME) => {
	const set = vi.fn() as unknown as ThemeSetter
	render(<TooltipsSection theme={theme} set={set} isReadOnly={false} />)
	// The section group starts collapsed; open it like the user would.
	fireEvent.click(screen.getByRole("button", { name: /Tooltips/, expanded: false }))
	return set as unknown as ReturnType<typeof vi.fn>
}

describe("TooltipsSection — tooltip box defaults", () => {
	it("writes max width, corner radius, opacity, and shadow size", () => {
		const set = mount()
		fireEvent.change(screen.getByLabelText("Max width"), { target: { value: "300" } })
		expect(set).toHaveBeenCalledWith("tooltipMaxWidth", 300)
		fireEvent.change(screen.getByLabelText("Corner radius"), { target: { value: "0" } })
		expect(set).toHaveBeenCalledWith("tooltipCornerRadius", 0)
		fireEvent.change(screen.getByLabelText("Background opacity"), {
			target: { value: "0.8" },
		})
		expect(set).toHaveBeenCalledWith("tooltipBackgroundOpacity", 0.8)
		fireEvent.change(screen.getByLabelText("Shadow size"), { target: { value: "20" } })
		expect(set).toHaveBeenCalledWith("tooltipShadowSize", 20)
	})

	it("outline and background colors: Automatic hides the picker, Custom seeds one", () => {
		const set = mount()
		expect(screen.queryByLabelText("Color")).toBeNull()
		const customs = screen.getAllByLabelText("Custom color")
		expect(customs).toHaveLength(2)
		fireEvent.click(customs[0]!)
		expect(set).toHaveBeenCalledWith("tooltipOutlineColor", "#e7e5e4")
		fireEvent.click(customs[1]!)
		expect(set).toHaveBeenCalledWith("tooltipBackgroundColor", "#ffffff")

		cleanup()
		const custom = mount({ ...THEME, tooltipBackgroundColor: "#123456" })
		expect(screen.getByLabelText("Color")).toBeTruthy()
		fireEvent.click(screen.getByLabelText(/Automatic \(white/))
		expect(custom).toHaveBeenCalledWith("tooltipBackgroundColor", null)
	})

	it("hides the shadow color and opacity while the shadow size is 0", () => {
		mount()
		expect(screen.getByLabelText("Shadow color")).toBeTruthy()
		expect(screen.getByLabelText("Shadow opacity")).toBeTruthy()
		cleanup()
		mount({ ...THEME, tooltipShadowSize: 0 })
		expect(screen.queryByLabelText("Shadow color")).toBeNull()
		expect(screen.queryByLabelText("Shadow opacity")).toBeNull()
	})
})

describe("TooltipsSection — hover defaults", () => {
	it("shows the built-in defaults while the theme sets none", () => {
		mount()
		const checked = (label: string) =>
			(screen.getByLabelText(label) as HTMLInputElement).checked
		expect(checked("Show tooltips")).toBe(true)
		expect(checked("Show tooltips only at points")).toBe(false)
		expect(checked("Show hover")).toBe(true)
		expect(checked("Hover over legend to highlight visual elements")).toBe(true)
		expect(checked("Recolor hovered elements")).toBe(false)
		expect(checked("Outline hovered elements")).toBe(false)
		expect(checked("Fade other elements")).toBe(true)
		expect((screen.getByLabelText("Fade amount") as HTMLInputElement).value).toBe("85")
		// Dependent controls hide while their toggle is off.
		expect(screen.queryByLabelText("Recolor color")).toBeNull()
		expect(screen.queryByLabelText("Outline thickness")).toBeNull()
	})

	it("each toggle writes its key", () => {
		const set = mount()
		const pairs: Array<[string, string, boolean]> = [
			["Show tooltips", "tooltipEnabled", false],
			["Show tooltips only at points", "tooltipPointsOnly", true],
			["Show hover", "hoverEnabled", false],
			["Hover over legend to highlight visual elements", "hoverLegendHighlight", false],
			["Recolor hovered elements", "hoverRecolor", true],
			["Outline hovered elements", "hoverOutline", true],
			["Fade other elements", "hoverFade", false],
		]
		for (const [label, key, value] of pairs) {
			fireEvent.click(screen.getByLabelText(label))
			expect(set, label).toHaveBeenCalledWith(key, value)
		}
	})

	it("the dependent controls show under their toggle and write their keys", () => {
		const set = mount({ ...THEME, hoverRecolor: true, hoverOutline: true })
		fireEvent.change(screen.getByLabelText("Recolor color hex"), {
			target: { value: "#ff0000" },
		})
		expect(set).toHaveBeenCalledWith("hoverHighlightColor", "#FF0000")
		fireEvent.change(screen.getByLabelText("Outline color hex"), {
			target: { value: "#00ff00" },
		})
		expect(set).toHaveBeenCalledWith("hoverOutlineColor", "#00FF00")
		fireEvent.change(screen.getByLabelText("Outline thickness"), { target: { value: "3" } })
		expect(set).toHaveBeenCalledWith("hoverOutlineWidth", 3)
		fireEvent.change(screen.getByLabelText("Fade amount"), { target: { value: "40" } })
		expect(set).toHaveBeenCalledWith("hoverFadeAmount", 0.4)
	})

	it("hides the hover styling while Show hover is off", () => {
		mount({ ...THEME, hoverEnabled: false })
		expect(screen.queryByLabelText("Fade other elements")).toBeNull()
		expect(screen.queryByLabelText("Recolor hovered elements")).toBeNull()
	})
})
