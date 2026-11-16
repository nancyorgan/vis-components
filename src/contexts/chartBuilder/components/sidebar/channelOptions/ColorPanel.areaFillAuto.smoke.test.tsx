import { act, cleanup, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { expandSubsections, scanControls } from "../../../../../testSupport/scanControls"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { EMPTY_CHANNEL_CONFIGS, type ChannelConfigs } from "../../../lib/channelConfig"
import { LIGHT_THEME_BASE } from "../../../lib/systemThemes"
import { emptyEncodings, type Dataset, type Theme } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	themeAtom,
} from "../../../store/atoms"

import { ColorPanel } from "./ColorPanel"

/** The Color options tell the truth about a lone area on the theme's color:
 *  the Area fill swatch shows the pale fill-palette color the body draws,
 *  and the Line swatch the series color the line draws. */

const ID = "ds-area-fill-auto"
const SERIES = "#1f77b4"
const TWIN = "#c6dbef"

const FILL_THEME: Theme = {
	...LIGHT_THEME_BASE,
	categoricalPalettes: [
		{ id: "marks", name: "Marks", colors: [SERIES, "#ff7f0e"] },
		{ id: "tints", name: "Tints", colors: [TWIN, "#ffd8b1"] },
	],
	defaultCategoricalPaletteId: "marks",
	defaultFillPaletteId: "tints",
	defaultFill: SERIES,
}

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "areas",
		filename: "areas.csv",
		fields: [
			{ name: "month", inferredType: "categorical" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: [
			{ month: "Jan", sales: "10", region: "north" },
			{ month: "Feb", sales: "20", region: "north" },
		],
	})

const ENCODINGS = {
	...emptyEncodings(),
	x: { field: "month" },
	length: { field: "sales" },
	connection: { field: "region" },
}

/** The color each section's swatch shows, by section title. */
const swatches = (theme: Theme, configs: Partial<ChannelConfigs>): Record<string, string> => {
	installInMemoryLocalStorage()
	const init = (snap: TestStore) => {
		snap.set(themeAtom, theme)
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, ENCODINGS)
		snap.set(currentChannelConfigsAtom, {
			...EMPTY_CHANNEL_CONFIGS,
			defaultFill: theme.defaultFill,
			connection: { ...EMPTY_CHANNEL_CONFIGS.connection, fill: "area" },
			...configs,
		} as ChannelConfigs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	render(
		<TestProvider initializeState={init}>
			<div data-color-root>
				<ColorPanel />
			</div>
		</TestProvider>
	)
	const root = "[data-color-root]"
	for (let pass = 0; pass < 8; pass++) {
		let opened = 0
		act(() => {
			opened = expandSubsections(root)
		})
		if (opened === 0) break
	}
	const out: Record<string, string> = {}
	for (const control of scanControls(root).controls)
		if (control.kind === "hex" && !(control.section in out))
			out[control.section] = control.value.toLowerCase()
	// Each call mounts its own panel: take this one down before the next.
	cleanup()
	return out
}

describe("Color options — a lone area on the theme's color", () => {
	it("Area fill shows the pale color the body draws; Line the series color", () => {
		expect(swatches(FILL_THEME, {})).toMatchObject({ "Area fill": TWIN, Line: SERIES })
	})

	it("a picked fill shows as picked", () => {
		expect(swatches(FILL_THEME, { defaultFill: "#aa0000" })).toMatchObject({
			"Area fill": "#aa0000",
			Line: "#aa0000",
		})
	})

	it("a theme with no fill palette shows the one color for both", () => {
		expect(swatches({ ...FILL_THEME, defaultFillPaletteId: null }, {})).toMatchObject({
			"Area fill": SERIES,
			Line: SERIES,
		})
	})
})
