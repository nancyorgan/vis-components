import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import { TestProvider } from "../../../../testSupport/TestProvider"
import { LIGHT_THEME_BASE } from "../../lib/systemThemes"
import type { SavedTheme } from "../../lib/types"
import { currentThemeIdAtom, themesAtom } from "../../store/atoms"
import { FontEditor } from "./LabelsPanel"

/** Every swatch that colors TEXT — the FontEditor's Color row (chart title,
 *  subtitle, axis titles, tick labels), captions, annotation text, data
 *  labels — carries the circular-arrow palette picker, and the picker leads
 *  with the theme's designated TEXT palette rather than the mark palette. */

const MARK_COLORS = ["#111111", "#222222"]
const TEXT_COLORS = ["#aa0000", "#00aa00"]

const buildTheme = (overrides: Partial<SavedTheme> = {}): SavedTheme => ({
	...LIGHT_THEME_BASE,
	id: "t-text",
	name: "Text",
	isSystem: false,
	categoricalPalettes: [
		{ id: "marks", name: "Marks", colors: [...MARK_COLORS] },
		{ id: "text", name: "Text", colors: [...TEXT_COLORS] },
	],
	ordinalPalettes: [],
	defaultCategoricalPaletteId: "marks",
	defaultTextPaletteId: "text",
	...overrides,
})

const themed = (children: ReactNode, overrides: Partial<SavedTheme> = {}) => {
	const theme = buildTheme(overrides)
	return render(
		<TestProvider
			initializeState={(snap) => {
				snap.set(themesAtom, [theme])
				snap.set(currentThemeIdAtom, theme.id)
			}}
		>
			{children}
		</TestProvider>,
	)
}

describe("FontEditor text-color palette picker", () => {
	afterEach(cleanup)

	it("offers the theme's TEXT palette, not the mark palette", () => {
		const { getByRole, getByLabelText, queryByLabelText } = themed(
			<FontEditor
				value={{}}
				onChange={() => {}}
				showResetFields
				baseColor="#333333"
			/>,
		)
		fireEvent.click(getByRole("button", { name: "Pick palette color for text" }))
		for (const c of TEXT_COLORS) expect(getByLabelText(`Use ${c}`)).toBeTruthy()
		// Mark colors are only behind the "other palettes" chevron.
		expect(queryByLabelText(`Use ${MARK_COLORS[0]}`)).toBeNull()
	})

	it("commits the picked color onto the font override", () => {
		const onChange = vi.fn()
		const { getByRole, getByLabelText } = themed(
			<FontEditor
				value={{ size: 12 }}
				onChange={onChange}
				showResetFields
				baseColor="#333333"
			/>,
		)
		fireEvent.click(getByRole("button", { name: "Pick palette color for text" }))
		fireEvent.click(getByLabelText("Use #00aa00"))
		expect(onChange).toHaveBeenCalledWith({ size: 12, color: "#00aa00" })
	})

	it("falls back to the default categorical palette with no text palette set", () => {
		const { getByRole, getByLabelText } = themed(
			<FontEditor value={{}} onChange={() => {}} showResetFields />,
			{ defaultTextPaletteId: null },
		)
		fireEvent.click(getByRole("button", { name: "Pick palette color for text" }))
		for (const c of MARK_COLORS) expect(getByLabelText(`Use ${c}`)).toBeTruthy()
	})
})
