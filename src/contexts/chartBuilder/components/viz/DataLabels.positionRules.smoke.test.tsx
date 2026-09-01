import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type LabelPositionRule,
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

/** Position rules: a label whose backing value matches a rule's condition
 *  takes the RULE's X/Y offsets instead of the layer-wide ones — the
 *  diverging-bars use case (positive labels nudge one way, negatives the
 *  other). Verified by rendering the same chart with and without the rule
 *  and diffing each label's position: the matching (negative) label must
 *  move by exactly the rule's offsets, the non-matching one not at all.
 *
 *  Data values are 17 / -7 so neither collides with an axis tick label
 *  (d3 picks round ticks), keeping the text lookup unambiguous. */

const DATASET_ID = "ds-position-rules"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "points",
		filename: "points.csv",
		fields: [
			{ name: "month", inferredType: "quantitative" },
			{ name: "sales", inferredType: "quantitative" },
		],
		rows: [
			{ month: "1", sales: "17" },
			{ month: "2", sales: "-7" },
		],
	})

const seedState = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState = (rules: LabelPositionRule[]) => (snap: TestStore) => {
	snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
	snap.set(currentDatasetIdAtom, DATASET_ID)
	snap.set(previewVersionIdAtom, null)
	snap.set(currentEncodingsAtom, {
		...emptyEncodings(),
		x: { field: "month" },
		y: { field: "sales" },
	})
	snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
	snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
	snap.set(currentDataLabelsConfigAtom, {
		...DEFAULT_DATA_LABELS_CONFIG,
		positionRules: rules,
	})
	snap.set(currentDataLabelsEncodingsAtom, {
		...emptyDataLabelsEncodings(),
		x: { field: "month" },
		y: { field: "sales" },
		value: { field: "sales" },
	})
	snap.set(currentFieldOverridesAtom, {})
	snap.set(currentFieldLevelOrdersAtom, {})
}

/** Render the scatter with the given rules and return each data label's
 *  position keyed by its text. */
const renderLabels = (
	rules: LabelPositionRule[]
): Map<string, { x: number; y: number }> => {
	seedState()
	const { container, unmount } = render(
		<TestProvider initializeState={initState(rules)}>
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot />
			</div>
		</TestProvider>
	)
	const groups = container.querySelectorAll(
		'g[aria-hidden="true"][pointer-events="none"]'
	)
	const out = new Map<string, { x: number; y: number }>()
	for (const g of groups) {
		for (const t of g.querySelectorAll("text")) {
			const text = t.textContent ?? ""
			if (text !== "17" && text !== "-7") continue
			out.set(text, {
				x: Number(t.getAttribute("x")),
				y: Number(t.getAttribute("y")),
			})
		}
	}
	unmount()
	return out
}

describe("Data labels — conditional position rules", () => {
	it("moves only the matching label, by the rule's own offsets", () => {
		const base = renderLabels([])
		const ruled = renderLabels([{ condition: "< 0", xOffset: 10, yOffset: -6 }])
		expect(base.get("17")).toBeDefined()
		expect(base.get("-7")).toBeDefined()
		// Non-matching label: untouched.
		expect(ruled.get("17")).toEqual(base.get("17"))
		// Matching label: shifted by exactly the rule's offsets (the rule
		// REPLACES the base offsets, which are 0 here).
		expect(ruled.get("-7")).toEqual({
			x: (base.get("-7")?.x ?? 0) + 10,
			y: (base.get("-7")?.y ?? 0) - 6,
		})
	})
})
