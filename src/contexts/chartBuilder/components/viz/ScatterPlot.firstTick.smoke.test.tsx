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

import { ScatterPlot } from "./ScatterPlot"

/** Per-axis first-tick anchoring. PlotCanvas pins a categorical axis's
 *  first/last ticks 12px from the plot edges ONLY when that axis is
 *  shared across facet panels; an unshared axis keeps d3's `padding(0.5)`
 *  spacing (first tick at step/2), so a panel with two categories shows
 *  them at 25% / 75% of the width instead of stretched to the edges.
 *  These tests pin the renderer half of that contract: each axis honors
 *  ITS OWN offset prop and ignores the other's. */

const DATASET_ID = "ds-first-tick"

const INNER = { x0: 100, y0: 50, x1: 500, y1: 350 }

const buildDataset = (rows: Array<Record<string, string>>): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "ft",
		filename: "ft.csv",
		fields: [
			{ name: "g", inferredType: "categorical" },
			{ name: "h", inferredType: "categorical" },
		],
		rows,
	})

const TWO_BY_TWO = [
	{ g: "A", h: "P" },
	{ g: "B", h: "Q" },
]

const mount = (
	rows: Array<Record<string, string>>,
	props: { firstTickPxOffsetX?: number; firstTickPxOffsetY?: number },
) => {
	const encodings: Encodings = {
		...emptyEncodings(),
		x: { field: "g" },
		y: { field: "h" },
	}
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset(rows) }),
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset(rows) })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const { container } = render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot inner={INNER} {...props} />
			</div>
		</TestProvider>,
	)
	// Marks are <path transform="translate(cx,cy)…"> glyphs.
	const marks = [...container.querySelectorAll("path")]
		.map((p) => p.getAttribute("transform") ?? "")
		.map((t) => /^translate\(([-\d.]+),([-\d.]+)\)/.exec(t))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => ({ cx: Number(m[1]), cy: Number(m[2]) }))
	return {
		xs: marks.map((m) => m.cx).sort((a, b) => a - b),
		ys: marks.map((m) => m.cy).sort((a, b) => a - b),
	}
}

describe("ScatterPlot — per-axis first-tick anchoring", () => {
	// inner width 400 (100..500), height 300 (350..50, y-inverted).
	it("no offsets: padding(0.5) spacing on both axes (2 cats at 25% / 75%)", () => {
		const { xs, ys } = mount(TWO_BY_TWO, {})
		expect(xs).toEqual([200, 400])
		expect(ys).toEqual([125, 275])
	})

	it("firstTickPxOffsetX only: x pinned 12px from edges, y untouched", () => {
		const { xs, ys } = mount(TWO_BY_TWO, { firstTickPxOffsetX: 12 })
		expect(xs).toEqual([112, 488])
		expect(ys).toEqual([125, 275])
	})

	it("firstTickPxOffsetY only: y pinned 12px from edges, x untouched", () => {
		const { xs, ys } = mount(TWO_BY_TWO, { firstTickPxOffsetY: 12 })
		expect(xs).toEqual([200, 400])
		expect(ys).toEqual([62, 338])
	})

	it("single category without offset centers in the band (unshared sparse panel)", () => {
		const { xs } = mount([{ g: "A", h: "P" }], {})
		expect(xs).toEqual([300])
	})
})

