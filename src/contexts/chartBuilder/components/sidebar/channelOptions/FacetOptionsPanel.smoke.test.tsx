import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import {
	DEFAULT_FACET_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { FacetOptionsPanel } from "./FacetOptionsPanel"
import { FacetRowOptionsPanel } from "./FacetRowOptionsPanel"

/** The facet panels' axis-RANGE editors must gate on the field the axis
 *  actually reads. A vertical bar chart puts its measure on Length and
 *  leaves Y position empty; reading the raw Y encoding hid the per-panel /
 *  per-row Y range editor on every such chart (user-reported: an unshared
 *  facet whose stack summed a hair over 100 niced to 110 with no way to pin
 *  it back). */

afterEach(cleanup)

const ID = "ds-facet-options-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "facetoptions",
		filename: "facetoptions.csv",
		fields: [
			{ name: "setting", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
			{ name: "panel", inferredType: "categorical" },
			{ name: "band", inferredType: "categorical" },
		],
		rows: [
			{ setting: "Home", value: "34", panel: "Home", band: "A" },
			{ setting: "SNF", value: "12", panel: "Everything else", band: "A" },
			{ setting: "Home", value: "20", panel: "Home", band: "B" },
			{ setting: "SNF", value: "30", panel: "Everything else", band: "B" },
		],
	})

/** Vertical bars: x ← setting, measure ← Length (value), Y position empty. */
const lengthBarEncodings = (overrides: Partial<Encodings> = {}): Encodings => ({
	...emptyEncodings(),
	x: { field: "setting" },
	length: { field: "value" },
	...overrides,
})

const facetConfigs = (facet: Partial<FacetConfig> = {}): Partial<ChannelConfigs> => ({
	...EMPTY_CHANNEL_CONFIGS,
	facet: { ...DEFAULT_FACET_CONFIG, ...facet },
})

const mount = (
	encodings: Encodings,
	configs: Partial<ChannelConfigs>,
	children: React.ReactNode,
) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(<TestProvider initializeState={init}>{children}</TestProvider>)
}

const expand = (utils: ReturnType<typeof render>, title: RegExp) => {
	fireEvent.click(utils.getAllByRole("button", { name: title })[0]!)
}

describe("FacetOptionsPanel — Y range editors on a length-encoded bar chart", () => {
	it("wrap mode, Share Y = none: per-panel Y range editor lists every facet value", () => {
		const utils = mount(
			lengthBarEncodings({ facet: { field: "panel" } }),
			facetConfigs({ shareY: "none" }),
			<FacetOptionsPanel />,
		)
		expand(utils, /rows/i)
		expect(utils.getByText("Y axis range per panel")).toBeTruthy()
		expect(utils.getByText("Home")).toBeTruthy()
		expect(utils.getByText("Everything else")).toBeTruthy()
		// The unit-range sizing toggle stays hidden: its solver weights
		// read the Y POSITION field, so it would be inert here.
		expect(utils.queryByText(/size rows by unit range/i)).toBeNull()
	})

	it("wrap mode, Share Y = all: overall Y range editor surfaces", () => {
		const utils = mount(
			lengthBarEncodings({ facet: { field: "panel" } }),
			facetConfigs({ shareY: "all" }),
			<FacetOptionsPanel />,
		)
		expand(utils, /rows/i)
		expect(utils.getByText("Y axis range")).toBeTruthy()
	})

	it("grid row panel, Share Y = per row: per-row Y range editor surfaces", () => {
		const utils = mount(
			lengthBarEncodings({
				facetRow: { field: "panel" },
				facetCol: { field: "band" },
			}),
			facetConfigs({ shareY: "perGroup" }),
			<FacetRowOptionsPanel />,
		)
		expand(utils, /rows/i)
		expect(utils.getByText("Y axis range per row")).toBeTruthy()
		expect(utils.getByText("Home")).toBeTruthy()
		expect(utils.getByText("Everything else")).toBeTruthy()
	})
})
