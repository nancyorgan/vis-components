import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FACET_CONFIG,
	type ChannelConfigs,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type DataLabelsEncodings,
	type Encodings,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { ChartCanvas } from "./ChartCanvas"

/** Data Labels' `facetKeys` ("Label all facets" unchecked): only the ticked
 *  facet panels draw labels. PlotCanvas provides each panel's key through
 *  FacetPanelContext; the layer reads it and stands down on other panels. */

const DATASET_ID = "ds-labels-facet-scope"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "f",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "f.csv",
			rows: [
				{ x: "1", y: "10", g: "A" },
				{ x: "2", y: "20", g: "A" },
				{ x: "3", y: "30", g: "B" },
				{ x: "4", y: "40", g: "B" },
				{ x: "5", y: "50", g: "C" },
				{ x: "6", y: "60", g: "C" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const encodings: Encodings = {
	...emptyEncodings(),
	x: { field: "x" },
	y: { field: "y" },
	facet: { field: "g" },
}
const channelConfigs: ChannelConfigs = {
	facet: { ...DEFAULT_FACET_CONFIG, rows: 1, cols: 3 },
}
const dataLabelsEncodings: DataLabelsEncodings = {
	...emptyDataLabelsEncodings(),
	x: { field: "x" },
	y: { field: "y" },
	value: { field: "y" },
}

const mount = (cfgOverrides: Partial<DataLabelsConfig>) => {
	const cfg: DataLabelsConfig = { ...DEFAULT_DATA_LABELS_CONFIG, ...cfgOverrides }
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify(channelConfigs)
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify(dataLabelsEncodings)
	)
	store.set("vis-components:currentDataLabelsConfig", JSON.stringify(cfg))
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, channelConfigs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, cfg)
		snap.set(currentDataLabelsEncodingsAtom, dataLabelsEncodings)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(
		<TestProvider initializeState={init}>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)
}

/** Data-label texts per panel key. DataLabelsLayer wraps its labels in
 *  `<g aria-hidden pointer-events="none">`, which excludes axis ticks. */
const labelsByPanel = (container: HTMLElement): Record<string, string[]> => {
	const out: Record<string, string[]> = {}
	for (const panel of container.querySelectorAll("[data-panel-key]")) {
		const key = panel.getAttribute("data-panel-key")!
		out[key] = [
			...panel.querySelectorAll(
				'g[aria-hidden="true"][pointer-events="none"] text'
			),
		]
			.map((t) => t.textContent?.trim() ?? "")
			.sort()
	}
	return out
}

describe("Data labels — Label all facets scope", () => {
	it("labels every panel by default (facetKeys unset)", () => {
		const { container } = mount({})
		expect(labelsByPanel(container)).toEqual({
			A: ["10", "20"],
			B: ["30", "40"],
			C: ["50", "60"],
		})
	})

	it("draws labels only on the ticked panels", () => {
		const { container } = mount({ facetKeys: ["A", "C"] })
		expect(labelsByPanel(container)).toEqual({
			A: ["10", "20"],
			B: [],
			C: ["50", "60"],
		})
	})

	it("an empty selection labels no panel", () => {
		const { container } = mount({ facetKeys: [] })
		expect(labelsByPanel(container)).toEqual({ A: [], B: [], C: [] })
	})
})
