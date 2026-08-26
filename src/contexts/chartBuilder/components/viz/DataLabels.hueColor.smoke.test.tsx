import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
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

import { ScatterPlot } from "./ScatterPlot"

/** User reported: "when I change the [data-labels] palette the text colors
 *  change, but not according to the encoding — they all change to be the
 *  same color," on a scatter/line chart whose marks DO vary by a field.
 *
 *  Root cause: `DataLabelsLayer` built its categorical hue scale from the
 *  rows it was handed (a single facet panel / filtered subset) instead of
 *  the full dataset. A panel that contains a single hue value yields a
 *  one-entry ordinal domain, so every label resolves to `palette[0]` —
 *  while the marks, whose scale is built from the full dataset (see
 *  useAestheticScales), stay correctly varied.
 *
 *  This renders a "facet panel" (via `rowsOverride`) that contains only the
 *  `south` rows, while the full dataset also holds `north`. The label color
 *  must be the palette slot for `south` (the SECOND color), not the first. */

const DATASET_ID = "ds-hue-color"

const PALETTE = ["#ff0000", "#0000ff"] // north → red, south → blue

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "points",
		filename: "points.csv",
		fields: [
			{ name: "month", inferredType: "quantitative" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: [
			{ month: "1", sales: "10", region: "north" },
			{ month: "2", sales: "20", region: "north" },
			{ month: "1", sales: "5", region: "south" },
			{ month: "2", sales: "15", region: "south" },
		],
	})

// Just the south rows — simulates one facet panel.
const SOUTH_ROWS = [
	{ month: "1", sales: "5", region: "south" },
	{ month: "2", sales: "15", region: "south" },
]

const seedState = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			hue: { field: "region" },
		})
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify({
			...emptyDataLabelsEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			value: { field: "sales" },
			hue: { field: "region" },
		})
	)
	store.set(
		"vis-components:currentDataLabelsConfig",
		JSON.stringify({
			...DEFAULT_DATA_LABELS_CONFIG,
			palette: PALETTE,
			paletteId: "test-palette",
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState = (snap: TestStore) => {
	snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
	snap.set(currentDatasetIdAtom, DATASET_ID)
	snap.set(previewVersionIdAtom, null)
	snap.set(currentEncodingsAtom, {
		...emptyEncodings(),
		x: { field: "month" },
		y: { field: "sales" },
		hue: { field: "region" },
	})
	snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
	snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
	snap.set(currentDataLabelsConfigAtom, {
		...DEFAULT_DATA_LABELS_CONFIG,
		palette: PALETTE,
		paletteId: "test-palette",
	})
	snap.set(currentDataLabelsEncodingsAtom, {
		...emptyDataLabelsEncodings(),
		x: { field: "month" },
		y: { field: "sales" },
		value: { field: "sales" },
		hue: { field: "region" },
	})
	snap.set(currentFieldOverridesAtom, {})
	snap.set(currentFieldLevelOrdersAtom, {})
}

describe("Data labels — hue encoding drives per-category label color", () => {
	it("uses the full-dataset hue domain so a single-value panel keeps its real color", () => {
		seedState()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<div style={{ width: 600, height: 400 }}>
					{/* Only the south rows — one hue value in this panel. */}
					<ScatterPlot rowsOverride={SOUTH_ROWS} />
				</div>
			</TestProvider>
		)
		const dataLabelsGroups = container.querySelectorAll(
			'g[aria-hidden="true"][pointer-events="none"]'
		)
		const labels = [...dataLabelsGroups].flatMap((g) => [
			...g.querySelectorAll("text"),
		])
		const fills = new Set(labels.map((t) => t.getAttribute("fill")))
		expect(labels.length).toBeGreaterThan(0)
		// South is the SECOND distinct region in the full dataset, so its
		// palette slot is the second color. Before the fix the panel's
		// one-value domain collapsed this to the first color (#ff0000).
		expect([...fills]).toEqual(["#0000ff"])
	})
})
