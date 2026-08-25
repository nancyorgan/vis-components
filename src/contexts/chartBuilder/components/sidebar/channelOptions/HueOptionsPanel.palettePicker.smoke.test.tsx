import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import { TestProvider } from "../../../../../testSupport/TestProvider"
import { LIGHT_THEME_BASE } from "../../../lib/systemThemes"
import type { SavedTheme } from "../../../lib/types"
import { currentThemeIdAtom, themesAtom } from "../../../store/atoms"
import { PalettePickerButton } from "../../../../../components/ui/PalettePickerButton"
import { QuantitativePanel } from "./HueOptionsPanel"

/** The circular-arrow button next to each category swatch opens a popover of
 *  the palette's colors (wrapping at 6 per row) instead of blindly stepping
 *  to the next color — picking a swatch commits it and closes the popover.
 *  A chevron at the popover's bottom expands it with the theme's OTHER
 *  palettes so a color can be borrowed from a palette the swatch isn't on. */

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

const ALT_COLORS = ["#aa0000", "#00aa00", "#0000aa"]
const ORD_COLORS = ["#0a0a0a", "#1a1a1a"]

/** Theme whose default categorical palette matches PALETTE (so it dedupes
 *  out of the "other palettes" groups) plus one alternate categorical and
 *  one ordinal palette to borrow from. */
const buildTestTheme = (overrides: Partial<SavedTheme> = {}): SavedTheme => ({
	...LIGHT_THEME_BASE,
	id: "t-multi",
	name: "Multi",
	isSystem: false,
	categoricalPalettes: [
		{ id: "main", name: "Main", colors: [...PALETTE] },
		{ id: "alt", name: "Alt", colors: ALT_COLORS },
	],
	ordinalPalettes: [{ id: "ord", name: "Ordinal", colors: ORD_COLORS }],
	defaultCategoricalPaletteId: "main",
	defaultOrdinalPaletteId: "ord",
	...overrides,
})

const themedWith = (theme: SavedTheme, children: ReactNode) =>
	render(
		<TestProvider
			initializeState={(snap) => {
				snap.set(themesAtom, [theme])
				snap.set(currentThemeIdAtom, theme.id)
			}}
		>
			{children}
		</TestProvider>,
	)

const themed = (children: ReactNode, overrides: Partial<SavedTheme> = {}) =>
	themedWith(buildTestTheme(overrides), children)

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

	it("expands the theme's other palettes behind the bottom chevron", () => {
		const { getByRole, getByLabelText, queryByLabelText, queryAllByLabelText } =
			themed(
				<PalettePickerButton
					palette={PALETTE}
					current="#111111"
					onPick={() => {}}
					label="Pick palette color for A"
				/>,
			)
		fireEvent.click(getByRole("button", { name: "Pick palette color for A" }))
		// Collapsed: current palette only, chevron offered.
		expect(queryByLabelText(`Use ${ALT_COLORS[0]}`)).toBeNull()
		const chevron = getByLabelText("Show other theme palettes")
		expect(chevron.getAttribute("aria-expanded")).toBe("false")

		fireEvent.click(chevron)
		// Expanded: alt categorical + ordinal palettes appear, the current
		// palette stays, and the theme palette matching it is deduped out
		// (each current-palette color still renders exactly once).
		for (const c of [...ALT_COLORS, ...ORD_COLORS]) {
			expect(getByLabelText(`Use ${c}`)).toBeTruthy()
		}
		expect(queryAllByLabelText("Use #111111")).toHaveLength(1)
		expect(
			getByLabelText("Hide other theme palettes").getAttribute(
				"aria-expanded",
			),
		).toBe("true")
	})

	it("commits a borrowed color, closes, and reopens collapsed", () => {
		const onPick = vi.fn()
		const { getByRole, getByLabelText, queryByLabelText } = themed(
			<PalettePickerButton
				palette={PALETTE}
				current="#111111"
				onPick={onPick}
				label="Pick palette color for A"
			/>,
		)
		const toggle = getByRole("button", { name: "Pick palette color for A" })
		fireEvent.click(toggle)
		fireEvent.click(getByLabelText("Show other theme palettes"))
		fireEvent.click(getByLabelText(`Use ${ALT_COLORS[1]}`))
		expect(onPick).toHaveBeenCalledWith(ALT_COLORS[1])
		expect(queryByLabelText("Use #111111")).toBeNull()

		// Reopening starts collapsed again.
		fireEvent.click(toggle)
		expect(queryByLabelText(`Use ${ALT_COLORS[1]}`)).toBeNull()
		expect(getByLabelText("Show other theme palettes")).toBeTruthy()
	})

	it("offers no chevron when the theme has no other palettes", () => {
		const { getByRole, getByLabelText, queryByLabelText } = themed(
			<PalettePickerButton
				palette={PALETTE}
				current="#111111"
				onPick={() => {}}
				label="Pick palette color for A"
			/>,
			{
				categoricalPalettes: [
					{ id: "main", name: "Main", colors: [...PALETTE] },
				],
				ordinalPalettes: [],
			},
		)
		fireEvent.click(getByRole("button", { name: "Pick palette color for A" }))
		expect(getByLabelText("Use #111111")).toBeTruthy()
		expect(queryByLabelText("Show other theme palettes")).toBeNull()
	})

	it("gradient stop rows carry the picker offering the theme palette", () => {
		// QuantitativePanel with no stored config seeds the theme default
		// gradient (viridis preset → Step 1..5 rows). Every stop row gets the
		// circular-arrow popover offering the theme's default categorical
		// palette; picking commits through the row's onColor (here the
		// preset→custom transition, with the picked color on that stop).
		const theme = buildTestTheme()
		const update = vi.fn()
		const { getByLabelText } = themedWith(
			theme,
			<QuantitativePanel
				hueConfig={undefined}
				theme={theme}
				update={update}
			/>,
		)
		fireEvent.click(getByLabelText("Pick palette color for Step 1"))
		fireEvent.click(getByLabelText("Use #222222"))
		expect(update).toHaveBeenCalledTimes(1)
		const next = update.mock.calls[0][0]
		expect(next.palette).toBe("custom")
		expect(next.customStops[0].color).toBe("#222222")
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
