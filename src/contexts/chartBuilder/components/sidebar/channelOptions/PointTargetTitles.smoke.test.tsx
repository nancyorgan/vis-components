import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { ColorPanel } from "./ColorPanel"
import { OpacityOptionsPanel } from "./OpacityOptionsPanel"
import { BrightnessOptionsPanel, SaturationOptionsPanel } from "./RangePanel"

/** The Color, Opacity, Saturation and Brightness menus always name the
 *  mark: a scatter's subheaders read "Point fill" / "Point outline", with
 *  or without the "Violin / box …" ones beside them (as the Pattern menu
 *  names its point target). A bare "Fill" / "Outline" never appears. */

const ID = "ds-point-target-titles"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "group", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
		],
		rows: ["A", "B"].flatMap((group) =>
			Array.from({ length: 4 }, (_, i) => ({ group, score: String(i + 1) }))
		),
	})

const enc = { ...emptyEncodings(), x: { field: "group" }, y: { field: "score" } }
const BOX: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	y: {
		...DEFAULT_AXIS_CONFIG,
		distributionOverlay: { ...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG, showBoxPlot: true },
	},
}

const mount = (panel: React.ReactNode, cfg: ChannelConfigs) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", cfg)
	/* eslint-enable @vc/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(<TestProvider initializeState={init}>{panel}</TestProvider>)
}

const subheaders = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")].map(
		(b) => b.textContent?.trim() ?? ""
	)

const PANELS: Array<[string, React.ReactNode]> = [
	["Color", <ColorPanel key="c" />],
	["Opacity", <OpacityOptionsPanel key="o" />],
	["Saturation", <SaturationOptionsPanel key="s" />],
	["Brightness", <BrightnessOptionsPanel key="b" />],
]

describe.each(PANELS)("%s menu point-target titles", (_name, panel) => {
	it("says Point fill / Point outline beside the Violin / box subheaders", () => {
		const headers = subheaders(mount(panel, BOX).container)
		expect(headers).toContain("Point fill")
		expect(headers).toContain("Point outline")
		expect(headers).toContain("Violin / box fill")
		expect(headers).toContain("Violin / box outline")
		expect(headers).not.toContain("Fill")
		expect(headers).not.toContain("Outline")
	})

	it("says Point fill / Point outline with no overlay too", () => {
		const headers = subheaders(mount(panel, EMPTY_CHANNEL_CONFIGS).container)
		expect(headers).toContain("Point fill")
		expect(headers).toContain("Point outline")
		expect(headers).not.toContain("Fill")
		expect(headers).not.toContain("Outline")
		expect(headers).not.toContain("Violin / box fill")
	})
})
