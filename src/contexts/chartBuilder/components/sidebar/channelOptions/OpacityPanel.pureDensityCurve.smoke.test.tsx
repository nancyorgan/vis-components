import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	DEFAULT_HISTOGRAM_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
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

import { OpacityOptionsPanel } from "./OpacityOptionsPanel"

/** Opacity-menu visibility on density charts, mirroring the Color menu:
 *  - PURE density curve (standalone "Density" display, marks suppressed): the
 *    overall "Fill" subsection and the mark "Outline" (border) slot hide —
 *    only the Density Curve (+ Rug) slots remain.
 *  - Histogram WITH the density overlay: Fill and Outline stay (bars render). */

const ID = "ds-opacity-pure-density"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "scores",
		filename: "scores.csv",
		fields: [{ name: "score", inferredType: "quantitative" }],
		rows: Array.from({ length: 30 }, (_, i) => ({ score: String(i + 1) })),
	})

const enc: Encodings = { ...emptyEncodings(), x: { field: "score" } }

/** Standalone "Density" display on a lone quantitative x (histogram off). */
const pureDensityConfigs: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	x: {
		...DEFAULT_AXIS_CONFIG,
		distributionOverlay: {
			...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
			showDensityCurve: true,
		},
		histogram: { ...DEFAULT_HISTOGRAM_CONFIG, densityFill: true },
	},
}

/** Histogram bars WITH the density overlay — bars still render. */
const histogramWithCurveConfigs: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	x: {
		...DEFAULT_AXIS_CONFIG,
		histogram: {
			...DEFAULT_HISTOGRAM_CONFIG,
			enabled: true,
			binCount: 8,
			showDensity: true,
			densityFill: true,
		},
	},
}

const mount = (configs: ChannelConfigs) => {
	const storeShim = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => storeShim.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", configs)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(
		<TestProvider initializeState={init}>
			<OpacityOptionsPanel />
		</TestProvider>
	)
}

/** Titles of the collapsible subheaders, in document order. */
const subheaders = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")].map(
		(b) => b.textContent?.trim() ?? ""
	)

describe("OpacityOptionsPanel — pure density curve visibility", () => {
	it("pure density curve: hides the overall Fill and the mark Outline slot", () => {
		const { container } = mount(pureDensityConfigs)
		const headers = subheaders(container)
		expect(headers).not.toContain("Fill")
		expect(headers).not.toContain("Outline")
		expect(headers).toContain("Density Curve Fill")
		expect(headers).toContain("Density Curve Outline")
	})

	it("histogram with a density overlay: keeps Fill and Outline alongside the curve slots", () => {
		const { container } = mount(histogramWithCurveConfigs)
		const headers = subheaders(container)
		expect(headers).toContain("Fill")
		expect(headers).toContain("Outline")
		expect(headers).toContain("Density Curve Fill")
		expect(headers).toContain("Density Curve Outline")
	})
})
