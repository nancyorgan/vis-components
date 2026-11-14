import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { buildDataset } from "../../../../testSupport/fixtures"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { EMPTY_CHANNEL_CONFIGS } from "../../lib/channelConfig"
import { DEFAULT_TOOLTIP_CONFIG } from "../../lib/labelsConfig"
import { LIGHT_THEME_BASE } from "../../lib/systemThemes"
import { tooltipConfigFromTheme } from "../../lib/themeConfig"
import { emptyEncodings, type Encodings, type Theme } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentTooltipConfigAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	themeAtom,
} from "../../store/atoms"

import { TooltipPanel } from "./TooltipPanel"

/** "Show tooltips only at points" is a LINE-chart control — it exists
 *  because a line is hoverable between its points. Everywhere else it
 *  would be inert, so it isn't rendered. */

afterEach(cleanup)

const ID = "ds-tooltip-panel"

const dataset = () =>
	buildDataset({
		id: ID,
		name: "tips",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
			{ name: "g", inferredType: "categorical" },
		],
		rows: [
			{ x: "1", y: "10", g: "north" },
			{ x: "2", y: "20", g: "north" },
		],
	})

const mount = (
	encodings: Encodings,
	theme?: Partial<Theme>,
	/** Seed the visual's tooltip config from the theme, as a chart created
	 * (or re-themed) on it would be. */
	seeded = false
) => {
	installInMemoryLocalStorage()
	const init = (snap: TestStore) => {
		// `currentThemeIdAtom` defaults null, so `useCurrentTheme` falls back
		// to the legacy `themeAtom` — override it to test theme defaults.
		if (theme) snap.set(themeAtom, { ...LIGHT_THEME_BASE, ...theme })
		snap.set(loadedDatasetsAtom, { [ID]: dataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
		snap.set(
			currentTooltipConfigAtom,
			seeded
				? tooltipConfigFromTheme({ ...LIGHT_THEME_BASE, ...theme })
				: DEFAULT_TOOLTIP_CONFIG
		)
	}
	return render(
		<TestProvider initializeState={init}>
			<TooltipPanel />
		</TestProvider>
	)
}

const lineChart = (): Encodings => ({
	...emptyEncodings(),
	x: { field: "x" },
	y: { field: "y" },
	connection: { field: "g" },
})

describe("TooltipPanel — show tooltips only at points", () => {
	it("offers the checkbox on a line chart, naming the line's variable", () => {
		const utils = mount(lineChart())
		expect(utils.getByLabelText(/only at points/i)).toBeTruthy()
		// The help line tells the user what a bare stretch of line will say.
		expect(utils.getByText(/line's g/)).toBeTruthy()
	})

	it("is absent on a plain scatter, where there's no line to hover between points", () => {
		const utils = mount({
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
		})
		expect(utils.queryByLabelText(/only at points/i)).toBeNull()
	})

	it("is absent while tooltips are off", () => {
		const utils = mount(lineChart())
		fireEvent.click(utils.getByLabelText(/show tooltips$/i))
		expect(utils.queryByLabelText(/only at points/i)).toBeNull()
	})

	it("starts off and writes the choice through", () => {
		const utils = mount(lineChart())
		const box = utils.getByLabelText(/only at points/i) as HTMLInputElement
		expect(box.checked).toBe(false)
		fireEvent.click(box)
		expect(
			(utils.getByLabelText(/only at points/i) as HTMLInputElement).checked
		).toBe(true)
	})
})

describe("TooltipPanel — box", () => {
	const scatter = (): Encodings => ({
		...emptyEncodings(),
		x: { field: "x" },
		y: { field: "y" },
	})

	it("offers the box controls, in order, under the Tooltips subsection", () => {
		const utils = mount(scatter())
		const text = utils.container.textContent ?? ""
		const at = (label: string) => text.indexOf(label)
		for (const label of [
			"Box",
			"Max width",
			"Corner radius",
			"Outline color",
			"Background color",
			"Background opacity",
			"Shadow size",
			"Shadow color",
			"Shadow opacity",
		])
			expect(at(label), label).toBeGreaterThan(-1)
		expect(at("Fields shown")).toBeLessThan(at("Box"))
		expect(at("Max width")).toBeLessThan(at("Corner radius"))
		expect(at("Corner radius")).toBeLessThan(at("Outline color"))
		expect(at("Outline color")).toBeLessThan(at("Background color"))
		expect(at("Background color")).toBeLessThan(at("Background opacity"))
		expect(at("Background opacity")).toBeLessThan(at("Shadow size"))
		expect(at("Shadow opacity")).toBeLessThan(at("Use custom HTML template"))
	})

	it("starts at the built-in theme's box, with the colors on Auto and no reset links", () => {
		const utils = mount(scatter())
		expect((utils.getByLabelText("Max width") as HTMLInputElement).value).toBe("240")
		expect((utils.getByLabelText("Corner radius") as HTMLInputElement).value).toBe("6")
		expect((utils.getByLabelText("Background opacity") as HTMLInputElement).value).toBe("1")
		expect((utils.getByLabelText("Shadow size") as HTMLInputElement).value).toBe("12")
		expect(utils.getAllByPlaceholderText("Auto").length).toBe(2)
		expect(utils.queryByLabelText(/^Reset /)).toBeNull()
	})

	it("shows the theme's values live and pins a visual entry only when it deviates", () => {
		const utils = mount(scatter(), { tooltipMaxWidth: 400, tooltipShadowSize: 0 })
		const width = utils.getByLabelText("Max width") as HTMLInputElement
		expect(width.value).toBe("400")
		// The theme turned the shadow off: its color / opacity are hidden.
		expect(utils.queryByLabelText("Shadow color")).toBeNull()

		fireEvent.change(width, { target: { value: "300" } })
		expect((utils.getByLabelText("Max width") as HTMLInputElement).value).toBe("300")
		expect(utils.getByLabelText("Reset max width")).toBeTruthy()

		// Reset drops the entry: the theme's value shows again, no link.
		fireEvent.click(utils.getByLabelText("Reset max width"))
		expect((utils.getByLabelText("Max width") as HTMLInputElement).value).toBe("400")
		expect(utils.queryByLabelText("Reset max width")).toBeNull()

		// Typing the theme's own value is the same as reset.
		fireEvent.change(utils.getByLabelText("Max width"), { target: { value: "400" } })
		expect(utils.queryByLabelText("Reset max width")).toBeNull()
	})

	it("is absent while tooltips are off", () => {
		const utils = mount(scatter())
		fireEvent.click(utils.getByLabelText(/show tooltips$/i))
		expect(utils.queryByLabelText("Max width")).toBeNull()
	})
})

describe("TooltipPanel — Hover follows the theme's seed", () => {
	const scatter = (): Encodings => ({
		...emptyEncodings(),
		x: { field: "x" },
		y: { field: "y" },
	})
	const headerDot = (container: HTMLElement, title: string) =>
		[...container.querySelectorAll("button")]
			.find(
				(b) =>
					b.getAttribute("aria-expanded") !== null &&
					b.textContent?.trim() === title
			)
			?.querySelector("span.rounded-full") ?? null
	const THEMED: Partial<Theme> = {
		tooltipEnabled: false,
		hoverRecolor: true,
		hoverHighlightColor: "#ff0000",
		hoverOutline: true,
		hoverOutlineColor: "#00ff00",
		hoverOutlineWidth: 4,
		hoverFade: true,
		hoverFadeAmount: 0.5,
	}

	it("a fresh chart on a theme with hover defaults shows no changed dots", () => {
		const utils = mount(scatter(), THEMED, true)
		expect(headerDot(utils.container, "Tooltips")).toBeNull()
		expect(headerDot(utils.container, "Hover")).toBeNull()
		expect((utils.getByLabelText(/show tooltips$/i) as HTMLInputElement).checked).toBe(false)
		expect((utils.getByLabelText("Fade amount") as HTMLInputElement).value).toBe("50")
		expect(utils.queryByLabelText(/^Reset /)).toBeNull()
	})

	it("reset links return to the theme's value, not the built-in", () => {
		const utils = mount(scatter(), THEMED, true)
		fireEvent.change(utils.getByLabelText("Outline thickness"), { target: { value: "1" } })
		fireEvent.change(utils.getByLabelText("Fade amount"), { target: { value: "20" } })
		expect(headerDot(utils.container, "Hover")).not.toBeNull()

		fireEvent.click(utils.getByLabelText("Reset outline thickness"))
		expect((utils.getByLabelText("Outline thickness") as HTMLInputElement).value).toBe("4")
		fireEvent.click(utils.getByLabelText("Reset fade amount"))
		expect((utils.getByLabelText("Fade amount") as HTMLInputElement).value).toBe("50")
		expect(headerDot(utils.container, "Hover")).toBeNull()
	})

	it("turning tooltips back on under a tooltips-off theme lights the dot", () => {
		const utils = mount(scatter(), THEMED, true)
		fireEvent.click(utils.getByLabelText(/show tooltips$/i))
		expect(headerDot(utils.container, "Tooltips")).not.toBeNull()
	})
})
