import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TestProvider } from "../../../../../testSupport/TestProvider"
import { DEFAULT_DATA_LABELS_CONFIG } from "../../../lib/channelConfig"
import { LIGHT_THEME_BASE } from "../../../lib/systemThemes"
import type { SavedTheme } from "../../../lib/types"
import { currentThemeIdAtom, themesAtom } from "../../../store/atoms"
import { LabelColorPanel } from "./LabelColorPanel"

/** Every text-color swatch in Data Labels carries the circular-arrow palette
 *  picker, the conditional "Text color rules" rows included — those rows set
 *  label TEXT color just like the fallback swatch above them, so they get the
 *  same on-palette shortcut. */

const PALETTE = ["#111111", "#222222", "#333333"]

const THEME: SavedTheme = {
	...LIGHT_THEME_BASE,
	id: "t-rules",
	name: "Rules",
	isSystem: false,
	categoricalPalettes: [{ id: "main", name: "Main", colors: [...PALETTE] }],
	defaultCategoricalPaletteId: "main",
}

const mount = (onChange: (patch: unknown) => void) =>
	render(
		<TestProvider
			initializeState={(snap) => {
				snap.set(themesAtom, [THEME])
				snap.set(currentThemeIdAtom, THEME.id)
			}}
		>
			<LabelColorPanel
				cfg={{
					...DEFAULT_DATA_LABELS_CONFIG,
					color: "#000000",
					textColorRules: [{ condition: "> 0", color: "#ff0000" }],
				}}
				onChange={onChange}
				hueField={null}
				hueFieldType={null}
				dataset={undefined}
				chartConfigs={{}}
			/>
		</TestProvider>,
	)

describe("Data Labels text color rules — palette picker", () => {
	afterEach(cleanup)

	it("offers the theme palette beside each rule swatch and commits a pick", () => {
		const onChange = vi.fn()
		const { getByRole, getByLabelText } = mount(onChange)
		// Subsections collapse by default — open it to reach the rule rows.
		fireEvent.click(getByRole("button", { name: /Text color rules/i }))
		fireEvent.click(
			getByRole("button", { name: "Pick palette color for rule 1" }),
		)
		for (const c of PALETTE) {
			expect(getByLabelText(`Use ${c}`)).toBeTruthy()
		}
		fireEvent.click(getByLabelText("Use #222222"))
		expect(onChange).toHaveBeenCalledWith({
			textColorRules: [{ condition: "> 0", color: "#222222" }],
		})
	})
})
