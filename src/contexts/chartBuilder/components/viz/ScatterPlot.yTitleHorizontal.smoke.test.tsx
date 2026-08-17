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
	datasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { ScatterPlot } from "./ScatterPlot"

/** Pins the NON-faceted code path: a standalone ScatterPlot with
 *  `labels.yAxisTitleHorizontal: true` must render its y-axis title
 *  WITHOUT the rotation transform. Axes.tsx branches at `if
 *  (yTitleHorizontal)` to emit a non-rotated `<text>` element; this
 *  test surfaces a regression where the branch silently doesn't fire
 *  (e.g. prop not threaded through). */
const DATASET_ID = "ds-scatter-y-horizontal"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scatter",
		filename: "d.csv",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "categorical" },
		],
		rows: [
			{ x: "10", y: "A" },
			{ x: "20", y: "B" },
			{ x: "30", y: "C" },
		],
	})

const seed = (horizontal: boolean) => {
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
			x: { field: "x" },
			y: { field: "y" },
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({
			_v: 1,
			data: { ...DEFAULT_LABELS_CONFIG, yAxisTitleHorizontal: horizontal },
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState = (horizontal: boolean) => (snap: TestStore) => {
	snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
	snap.set(currentDatasetIdAtom, DATASET_ID)
	snap.set(previewVersionIdAtom, null)
	snap.set(currentEncodingsAtom, {
		...emptyEncodings(),
		x: { field: "x" },
		y: { field: "y" },
	})
	snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
	snap.set(currentLabelsAtom, {
		...DEFAULT_LABELS_CONFIG,
		yAxisTitleHorizontal: horizontal,
	})
	snap.set(currentDataLabelsConfigAtom, {
		...DEFAULT_DATA_LABELS_CONFIG,
		fontFamily: "system-ui, sans-serif",
		fontSize: 11,
		fontWeight: 500,
		color: "#111827",
		decimals: null,
		xOffset: 0,
		yOffset: 0,
	})
	snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
	snap.set(currentFieldOverridesAtom, {})
	snap.set(currentFieldLevelOrdersAtom, {})
}

describe("ScatterPlot — yAxisTitleHorizontal flag", () => {
	it("when horizontal=false (default), the y-title is rendered with rotate(-90) transform", () => {
		seed(false)
		const { container } = render(
			<TestProvider initializeState={initState(false)}>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		// The y-axis title `<text>` element is the one containing the
		// label "y" (the y-field name). Its `transform` attribute should
		// include `rotate(-90)`.
		const yTitle = [...container.querySelectorAll("text")].find(
			(t) => (t.textContent ?? "").trim() === "y"
		)
		expect(yTitle).not.toBeUndefined()
		expect(yTitle?.getAttribute("transform") ?? "").toMatch(/rotate\(-?90\)/)
	})

	it("when horizontal=true, the y-title is rendered WITHOUT rotation", () => {
		seed(true)
		const { container } = render(
			<TestProvider initializeState={initState(true)}>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		const yTitle = [...container.querySelectorAll("text")].find(
			(t) => (t.textContent ?? "").trim() === "y"
		)
		expect(yTitle).not.toBeUndefined()
		// The horizontal branch in Axes.tsx omits the `transform` attribute
		// entirely. A regression that fell through to the rotated branch
		// would leave a `rotate(...)` in the transform.
		const transform = yTitle?.getAttribute("transform") ?? ""
		expect(transform).not.toMatch(/rotate/)
	})
})
