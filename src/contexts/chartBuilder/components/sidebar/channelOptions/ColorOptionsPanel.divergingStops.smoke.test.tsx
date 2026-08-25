import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_QUANTITATIVE_HUE_CONFIG } from "../../../lib/channelConfig"
import type { HueConfig } from "../../../lib/channelConfig"
import type { Theme } from "../../../lib/types"
import { QuantitativePanel } from "./ColorOptionsPanel"

/** Diverging gradient editor: the Low/Mid/High value boxes show the
 *  computed auto values (data min / 0 / data max) as placeholders instead
 *  of the word "auto", and each row carries its own reset link (shown only
 *  when that row was edited) in place of the old whole-section reset. */

/** Minimal Theme fixture — the gradient editor only reads the palette /
 *  gradient lists, so everything else stays at inert defaults. */
const baseTheme: Theme = {
	defaultFill: "#000",
	defaultRadius: 4,
	defaultOpacity: 1,
	defaultShape: 0,
	outlineColor: "#fff",
	outlineWidth: 1,
	titleFontFamily: "",
	titleFontColor: "",
	titlePrimarySize: 1,
	titleSubtitleSize: 1,
	titleSecondarySize: 1,
	textFontFamily: "",
	textFontSize: 1,
	textFontColor: "",
	categoricalPalettes: [],
	ordinalPalettes: [],
	linearGradients: [],
	divergingGradients: [
		{ id: "brand-div", name: "Brand Div", low: "#0000ff", mid: "#ffffff", high: "#ff0000" },
	],
	defaultCategoricalPaletteId: "",
	defaultOrdinalPaletteId: "",
	defaultTextPaletteId: null,
	defaultGradientPalette: "viridis",
	patternInkColor: "",
	patternBackgroundColor: "",
	gridlineColor: "",
	gridlineThickness: 1,
	tickmarkColor: "",
	tickmarkThickness: 1,
	tickmarkLength: 1,
	spineColor: "",
	spineThickness: 1,
	textEncodingFontFamily: "",
	textEncodingFontSize: 1,
	textEncodingFontWeight: 500,
	textEncodingColor: "",
	distributionOverlayStroke: "",
	distributionOverlayFill: "",
	regressionStroke: "",
	regressionCiFill: "",
	connectionThickness: 2,
	connectionColor: "#888888",
	lengthMin: 0,
	lengthMax: 1,
	angleMin: 0,
	angleMax: 1,
	areaMin: 0,
	areaMax: 1,
	saturationMin: 0,
	saturationMax: 1,
	brightnessMin: 0,
	brightnessMax: 1,
	chartBackgroundColor: null,
	legendBackgroundColor: null,
	legendSwatchColor: "#4f8eda",
	legendSwatchStroke: "#ffffff",
}

const divergingCfg: Extract<HueConfig, { kind: "quantitative" }> = {
	...DEFAULT_QUANTITATIVE_HUE_CONFIG,
	palette: "customDiverging",
	lowColor: "#0000ff",
	midColor: "#ffffff",
	highColor: "#ff0000",
	sourcePaletteId: "brand-div",
}

describe("QuantitativePanel — diverging stop rows", () => {
	afterEach(cleanup)

	it("orders the rows High → Mid → Low, top to bottom", () => {
		const { container } = render(
			<QuantitativePanel
				hueConfig={divergingCfg}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[-10, 30]}
			/>,
		)
		const labels = [
			...container.querySelectorAll("input[aria-label$='stop value']"),
		].map((el) => el.getAttribute("aria-label"))
		expect(labels).toEqual([
			"High stop value",
			"Mid stop value",
			"Low stop value",
		])
	})

	it("fills the value boxes with data min / 0 / data max when the data spans 0", () => {
		const { getByLabelText } = render(
			<QuantitativePanel
				hueConfig={divergingCfg}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[-10, 30]}
			/>,
		)
		expect(
			(getByLabelText("Low stop value") as HTMLInputElement).placeholder,
		).toBe("-10")
		expect(
			(getByLabelText("Mid stop value") as HTMLInputElement).placeholder,
		).toBe("0")
		expect(
			(getByLabelText("High stop value") as HTMLInputElement).placeholder,
		).toBe("30")
	})

	it("mid placeholder falls back to the domain midpoint for one-signed data", () => {
		const { getByLabelText } = render(
			<QuantitativePanel
				hueConfig={divergingCfg}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[10, 30]}
			/>,
		)
		expect(
			(getByLabelText("Mid stop value") as HTMLInputElement).placeholder,
		).toBe("20")
	})

	it("keeps 'auto' when no extent is available (derived measures)", () => {
		const { getByLabelText } = render(
			<QuantitativePanel
				hueConfig={divergingCfg}
				theme={baseTheme}
				update={() => {}}
			/>,
		)
		expect(
			(getByLabelText("Low stop value") as HTMLInputElement).placeholder,
		).toBe("auto")
	})

	it("shows no reset links (and no section reset) while every row matches its palette default", () => {
		const { queryByRole } = render(
			<QuantitativePanel
				hueConfig={divergingCfg}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[-10, 30]}
			/>,
		)
		expect(queryByRole("button", { name: "reset" })).toBeNull()
	})

	it("an edited row gets its own reset link that restores color + auto value", () => {
		const update = vi.fn()
		const { getAllByRole } = render(
			<QuantitativePanel
				hueConfig={{ ...divergingCfg, lowColor: "#123456", lowValue: -99 }}
				theme={baseTheme}
				update={update}
				dataExtent={[-10, 30]}
			/>,
		)
		const resets = getAllByRole("button", { name: "reset" })
		expect(resets).toHaveLength(1)
		fireEvent.click(resets[0])
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				lowColor: "#0000ff",
				lowValue: null,
				// The other rows stay untouched.
				midColor: "#ffffff",
				highColor: "#ff0000",
			}),
		)
	})

	it("a pinned value alone (color unchanged) also surfaces the row reset", () => {
		const update = vi.fn()
		const { getAllByRole } = render(
			<QuantitativePanel
				hueConfig={{ ...divergingCfg, midValue: 5 }}
				theme={baseTheme}
				update={update}
				dataExtent={[-10, 30]}
			/>,
		)
		const resets = getAllByRole("button", { name: "reset" })
		expect(resets).toHaveLength(1)
		fireEvent.click(resets[0])
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({ midColor: "#ffffff", midValue: null }),
		)
	})

	it("diverging presets show placeholders too (pristine — no reset links)", () => {
		const { getByLabelText, queryByRole } = render(
			<QuantitativePanel
				hueConfig={{ ...DEFAULT_QUANTITATIVE_HUE_CONFIG, palette: "RdBu" }}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[-10, 30]}
			/>,
		)
		expect(
			(getByLabelText("Mid stop value") as HTMLInputElement).placeholder,
		).toBe("0")
		expect(queryByRole("button", { name: "reset" })).toBeNull()
	})

	it("manual-stops mode keeps the whole-section reset button", () => {
		const { getByRole } = render(
			<QuantitativePanel
				hueConfig={{
					...DEFAULT_QUANTITATIVE_HUE_CONFIG,
					palette: "custom",
					customStops: [
						{ color: "#ffffff", value: null },
						{ color: "#000000", value: null },
					],
					sourcePaletteId: "custom",
				}}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[-10, 30]}
			/>,
		)
		expect(getByRole("button", { name: "reset" })).toBeTruthy()
	})
})
