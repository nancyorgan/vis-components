import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { wrapByCharCount } from "../../lib/multilineText"
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

/** User reported: "wrap text seemed to stop working." Root cause: labels
 *  with per-variable COLORS render as `<tspan fill>` segments, and the
 *  segmented path ignored `wrapText` entirely (one inline line, no x/dy) —
 *  a limitation that predates the endpoint work but bites as soon as a
 *  field-color slot is configured. This mounts a multi-field label with a
 *  per-variable color + wrapText and verifies the segments line-break. */

const DATASET_ID = "ds-wrap-segments"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "wrap-segments",
		filename: "wrap-segments.csv",
		fields: [
			{ name: "month", inferredType: "quantitative" },
			{ name: "sales", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: [
			{ month: "1", sales: "10", region: "the far northern region" },
			{ month: "2", sales: "20", region: "the far northern region" },
		],
	})

const cfg: DataLabelsConfig = {
	...DEFAULT_DATA_LABELS_CONFIG,
	wrapText: true,
	wrapMaxChars: 10,
	labelTemplate: "{sales} {region}",
	// A configured slot makes the region segments a different fill from the
	// base, forcing the segmented render path.
	fieldColors: { region: { field: null, singleColor: "#ff0000" } },
}

const initState = (snap: TestStore) => {
	snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
	snap.set(currentDatasetIdAtom, DATASET_ID)
	snap.set(previewVersionIdAtom, null)
	snap.set(currentEncodingsAtom, {
		...emptyEncodings(),
		x: { field: "month" },
		y: { field: "sales" },
		connection: { field: "region" },
	})
	snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
	snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
	snap.set(currentDataLabelsConfigAtom, cfg)
	snap.set(currentDataLabelsEncodingsAtom, {
		...emptyDataLabelsEncodings(),
		x: { field: "month" },
		y: { field: "sales" },
		value: { field: null, multiField: true, fields: ["sales", "region"] },
	})
	snap.set(currentFieldOverridesAtom, {})
	snap.set(currentFieldLevelOrdersAtom, {})
}

describe("Data labels — wrapText on per-variable colored (segmented) labels", () => {
	it("line-breaks colored segments and keeps their fills", () => {
		installInMemoryLocalStorage()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		const groups = container.querySelectorAll(
			'g[aria-hidden="true"][pointer-events="none"]'
		)
		const texts = [...groups].flatMap((g) => [...g.querySelectorAll("text")])
		expect(texts.length).toBeGreaterThan(0)
		for (const text of texts) {
			const tspans = [...text.querySelectorAll("tspan")]
			// Wrapped: more than one tspan carries an x + dy (one per line
			// start). "10 the far northern region" at 10 chars/line → 3 lines.
			const lineStarts = tspans.filter(
				(t) => t.getAttribute("x") !== null && t.getAttribute("dy") !== null
			)
			expect(lineStarts.length).toBeGreaterThan(1)
			// The region pieces keep their per-variable fill even when split
			// across lines; the value piece keeps the base fill.
			const fills = new Set(tspans.map((t) => t.getAttribute("fill")))
			expect(fills.has("#ff0000")).toBe(true)
			// Full text survives the wrap, minus the break spaces the wrapper
			// consumes — identical to the plain-label wrap path.
			const flat = tspans.map((t) => t.textContent ?? "").join("")
			const value = flat.startsWith("10") ? "10" : "20"
			expect(flat).toBe(
				wrapByCharCount(`${value} the far northern region`, 10).join("")
			)
		}
	})
})
