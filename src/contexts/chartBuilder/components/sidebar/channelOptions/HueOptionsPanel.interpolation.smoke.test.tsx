import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_QUANTITATIVE_HUE_CONFIG } from "../../../lib/channelConfig"
import type { HueConfig } from "../../../lib/channelConfig"
import type { Theme } from "../../../lib/types"
import { QuantitativePanel } from "./HueOptionsPanel"

/** Gradient blend-space picker: custom gradients (saved linear/diverging +
 *  manual stops) grow an "Interpolation" dropdown (RGB / HSB / OKLCH) that
 *  writes `interpolation` into the quantitative hue config; presets are
 *  fully-baked ramps, so the row stays hidden for them. */

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
	linearGradients: [
		{ id: "brand-lin", name: "Brand Lin", low: "#0000ff", high: "#ff0000" },
	],
	divergingGradients: [],
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

const customLinearCfg: Extract<HueConfig, { kind: "quantitative" }> = {
	...DEFAULT_QUANTITATIVE_HUE_CONFIG,
	palette: "customLinear",
	lowColor: "#0000ff",
	highColor: "#ff0000",
	sourcePaletteId: "brand-lin",
}

describe("QuantitativePanel — gradient interpolation picker", () => {
	afterEach(cleanup)

	it("renders for custom gradients, defaulting to RGB", () => {
		const { getByLabelText } = render(
			<QuantitativePanel
				hueConfig={customLinearCfg}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[0, 10]}
			/>,
		)
		const select = getByLabelText("Interpolation") as HTMLSelectElement
		expect(select.value).toBe("rgb")
		const labels = [...select.options].map((o) => o.textContent)
		expect(labels).toEqual(["RGB", "HSB", "OKLCH"])
	})

	it("writes the chosen space into the config", () => {
		const update = vi.fn()
		const { getByLabelText } = render(
			<QuantitativePanel
				hueConfig={customLinearCfg}
				theme={baseTheme}
				update={update}
				dataExtent={[0, 10]}
			/>,
		)
		fireEvent.change(getByLabelText("Interpolation"), {
			target: { value: "oklch" },
		})
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({ interpolation: "oklch" }),
		)
	})

	it("reflects a stored non-default space", () => {
		const { getByLabelText } = render(
			<QuantitativePanel
				hueConfig={{ ...customLinearCfg, interpolation: "hsb" }}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[0, 10]}
			/>,
		)
		expect((getByLabelText("Interpolation") as HTMLSelectElement).value).toBe(
			"hsb",
		)
	})

	it("also renders in manual-stops mode", () => {
		const { getByLabelText } = render(
			<QuantitativePanel
				hueConfig={{
					...DEFAULT_QUANTITATIVE_HUE_CONFIG,
					palette: "custom",
					customStops: [
						{ color: "#ffffff", value: null },
						{ color: "#000000", value: null },
					],
				}}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[0, 10]}
			/>,
		)
		expect(getByLabelText("Interpolation")).not.toBeNull()
	})

	it("stays hidden for presets — nothing to blend on a baked ramp", () => {
		const { queryByLabelText } = render(
			<QuantitativePanel
				hueConfig={{ ...DEFAULT_QUANTITATIVE_HUE_CONFIG, palette: "viridis" }}
				theme={baseTheme}
				update={() => {}}
				dataExtent={[0, 10]}
			/>,
		)
		expect(queryByLabelText("Interpolation")).toBeNull()
	})
})
