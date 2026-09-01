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

/** Text angle: each data label's group rotates by `textAngle` degrees around
 *  the label's own anchor point (same convention as the axes' tickLabelAngle),
 *  and an angle of 0 emits no transform at all — keeping the default render
 *  byte-identical to before the option existed.
 *
 *  Data values are 17 / -7 so neither collides with an axis tick label
 *  (d3 picks round ticks), keeping the text lookup unambiguous. */

const DATASET_ID = "ds-text-angle"

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

const initState = (textAngle: number) => (snap: TestStore) => {
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
		textAngle,
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

/** Render the scatter with the given angle and return each data label's
 *  position + its wrapping group's transform, keyed by label text. */
const renderLabels = (
	textAngle: number
): Map<string, { x: number; y: number; transform: string | null }> => {
	seedState()
	const { container, unmount } = render(
		<TestProvider initializeState={initState(textAngle)}>
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot />
			</div>
		</TestProvider>
	)
	const groups = container.querySelectorAll(
		'g[aria-hidden="true"][pointer-events="none"]'
	)
	const out = new Map<string, { x: number; y: number; transform: string | null }>()
	for (const g of groups) {
		for (const t of g.querySelectorAll("text")) {
			const text = t.textContent ?? ""
			if (text !== "17" && text !== "-7") continue
			out.set(text, {
				x: Number(t.getAttribute("x")),
				y: Number(t.getAttribute("y")),
				transform: t.parentElement?.getAttribute("transform") ?? null,
			})
		}
	}
	unmount()
	return out
}

describe("Data labels — text angle", () => {
	it("rotates each label around its own anchor point", () => {
		const base = renderLabels(0)
		const rotated = renderLabels(-45)
		for (const text of ["17", "-7"]) {
			const b = base.get(text)
			const r = rotated.get(text)
			expect(b).toBeDefined()
			expect(r).toBeDefined()
			// Angle 0 emits NO transform (default render unchanged).
			expect(b?.transform).toBeNull()
			// The anchor position itself doesn't move — rotation happens
			// around it, per label.
			expect(r?.x).toBe(b?.x)
			expect(r?.y).toBe(b?.y)
			expect(r?.transform).toBe(`rotate(-45 ${r?.x} ${r?.y})`)
		}
	})
})
