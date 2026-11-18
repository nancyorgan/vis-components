import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LIGHT_THEME_BASE } from "../../../chartBuilder/lib/systemThemes"
import type { Theme } from "../../../chartBuilder/lib/types"
import { TestProvider } from "../../../../testSupport/TestProvider"

import { DataTablesSection } from "./DataTablesSection"
import type { ThemeSetter } from "./types"

afterEach(cleanup)

// The neutral base, not a bundled theme: these tests check that empty rows
// follow the table text, and the system themes pin several of the rows.
const THEME: Theme = LIGHT_THEME_BASE

const mount = (theme: Theme = THEME) => {
	const set = vi.fn() as unknown as ThemeSetter
	render(
		<TestProvider>
			<DataTablesSection theme={theme} set={set} isReadOnly={false} />
		</TestProvider>
	)
	// The section group starts collapsed; open it like the user would.
	fireEvent.click(screen.getByRole("button", { name: /Data tables/, expanded: false }))
	return set as unknown as ReturnType<typeof vi.fn>
}

describe("DataTablesSection — data table defaults", () => {
	it("follows the sidebar's order and wording", () => {
		mount()
		const headings = screen.getAllByRole("heading").map((h) => h.textContent)
		expect(headings).toEqual([
			"Defaults",
			"Title",
			"Header",
			"Table text",
			"Rows",
			"Caption",
		])
		// Family / Size / Weight for title, header, table text, first column, caption.
		for (const label of ["Family", "Size", "Weight"])
			expect(screen.getAllByLabelText(label)).toHaveLength(5)
		// Color: title, the header's bottom line, table text, first column, caption.
		expect(screen.getAllByLabelText("Color")).toHaveLength(5)
		expect(screen.getByText("First column")).toBeTruthy()
		for (const label of [
			"Text color",
			"Background",
			"Thickness",
			"Border color",
			"Striped rows",
			"Stripe color",
		])
			expect(screen.getByLabelText(label)).toBeTruthy()
		expect(screen.getByText("Bottom line")).toBeTruthy()
		expect(screen.getByText("Column alignment")).toBeTruthy()
		// Empty sizes all follow the base text size.
		const sizes = screen.getAllByLabelText("Size") as HTMLInputElement[]
		expect(sizes.map((el) => el.placeholder)).toEqual(
			Array(5).fill(String(THEME.textFontSize))
		)
	})

	it("writes sizes, weights, the toggles, and alignment", () => {
		const set = mount()
		const [titleSize, headerSize, tableSize] = screen.getAllByLabelText("Size")
		fireEvent.change(tableSize!, { target: { value: "9" } })
		expect(set).toHaveBeenCalledWith("dataTableFontSize", 9)
		fireEvent.change(titleSize!, { target: { value: "14" } })
		expect(set).toHaveBeenCalledWith("dataTableTitleFontSize", 14)
		fireEvent.change(headerSize!, { target: { value: "11" } })
		expect(set).toHaveBeenCalledWith("dataTableHeaderFontSize", 11)
		const [titleWeight, headerWeight, tableWeight] = screen.getAllByLabelText("Weight")
		fireEvent.change(titleWeight!, { target: { value: "700" } })
		expect(set).toHaveBeenCalledWith("dataTableTitleFontWeight", 700)
		fireEvent.change(headerWeight!, { target: { value: "400" } })
		expect(set).toHaveBeenCalledWith("dataTableHeaderFontWeight", 400)
		fireEvent.change(tableWeight!, { target: { value: "300" } })
		expect(set).toHaveBeenCalledWith("dataTableFontWeight", 300)
		fireEvent.change(screen.getByLabelText("Thickness"), { target: { value: "1" } })
		expect(set).toHaveBeenCalledWith("dataTableHeaderBorderWidth", 1)
		fireEvent.click(screen.getByLabelText("Striped rows"))
		expect(set).toHaveBeenCalledWith("dataTableStriped", false)
		// Alignment rows in order: title, numbers & dates, caption.
		fireEvent.click(screen.getAllByRole("button", { name: /right/i })[0]!)
		expect(set).toHaveBeenCalledWith("dataTableTitleAlign", "right")
		fireEvent.click(screen.getAllByRole("button", { name: /left/i })[1]!)
		expect(set).toHaveBeenCalledWith("dataTableNumberAlign", "left")
	})

	it("keeps the stripe and line colors settable while they're off", () => {
		mount({ ...THEME, dataTableStriped: false, dataTableHeaderBorderWidth: 0 })
		expect(screen.getByLabelText("Stripe color")).toBeTruthy()
		expect(screen.getAllByLabelText("Color")).toHaveLength(5)
	})

	it("writes the first-column toggle and its font", () => {
		const set = mount()
		fireEvent.click(screen.getByLabelText("Format first column like other columns"))
		expect(set).toHaveBeenCalledWith("dataTableFirstColumnLikeOthers", false)
		const firstWeight = screen.getAllByLabelText("Weight")[3]!
		fireEvent.change(firstWeight, { target: { value: "700" } })
		expect(set).toHaveBeenCalledWith("dataTableFirstColumnFontWeight", 700)
	})
})

describe("DataTablesSection — seeded defaults", () => {
	it("shows the built-in behavior while the theme sets none", () => {
		mount()
		expect((screen.getByLabelText("Show a data table") as HTMLInputElement).checked).toBe(false)
		expect((screen.getByLabelText("Placement") as HTMLSelectElement).value).toBe("below")
		expect((screen.getByLabelText("Max rows") as HTMLInputElement).value).toBe("10")
		expect((screen.getByLabelText("Download link") as HTMLInputElement).checked).toBe(true)
		const options = [...(screen.getByLabelText("Placement") as HTMLSelectElement).options]
		expect(options.map((o) => o.textContent)).toEqual([
			"Below the chart",
			"Behind a button",
			"In a tab",
			"For screen readers only",
		])
	})

	it("each control writes its key; emptying Max rows stores All (null)", () => {
		const set = mount()
		fireEvent.click(screen.getByLabelText("Show a data table"))
		expect(set).toHaveBeenCalledWith("dataTableEnabled", true)
		fireEvent.change(screen.getByLabelText("Placement"), { target: { value: "tabs" } })
		expect(set).toHaveBeenCalledWith("dataTablePlacement", "tabs")
		fireEvent.change(screen.getByLabelText("Max rows"), { target: { value: "25" } })
		expect(set).toHaveBeenCalledWith("dataTableMaxRows", 25)
		fireEvent.change(screen.getByLabelText("Max rows"), { target: { value: "" } })
		expect(set).toHaveBeenCalledWith("dataTableMaxRows", null)
		fireEvent.click(screen.getByLabelText("Download link"))
		expect(set).toHaveBeenCalledWith("dataTableShowDownload", false)
	})

	it("a theme's All (null) shows an empty box with the All placeholder", () => {
		mount({ ...THEME, dataTableMaxRows: null })
		const box = screen.getByLabelText("Max rows") as HTMLInputElement
		expect(box.value).toBe("")
		expect(box.placeholder).toBe("All")
	})
})
