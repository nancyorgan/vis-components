import { render } from "@testing-library/react"
import { useAtomValue } from "jotai"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
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

const Probe = () => {
	const cfg = useAtomValue(currentDataLabelsConfigAtom)
	const enc = useAtomValue(currentDataLabelsEncodingsAtom)
	// eslint-disable-next-line no-console
	console.log("[probe] dataLabels onlyLastLabel:", cfg.onlyLastLabel)
	// eslint-disable-next-line no-console
	console.log("[probe] dataLabels value field:", enc.value?.field)
	return null
}

/** User reported: "Only show last labels per series is showing labels in
 *  places that aren't the last point." This test mounts a scatter +
 *  connection line chart with `onlyLastLabel: true` and verifies the
 *  rendered text labels are at the rightmost data point of each
 *  connection group — concrete evidence rather than visual inspection. */

const DATASET_ID = "ds-only-last"

const buildLineDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "lines",
	fields: [
		{ name: "month", inferredType: "quantitative" },
		{ name: "sales", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "lines.csv",
			// Rows are deliberately SCRAMBLED so the row index doesn't match
			// the visual left-to-right order. If `keepLastPerSeries` falls
			// back to picking by index instead of by `cx`, it'll pick
			// e.g. month=1 (the LAST row in input order) and the labels
			// will land at the leftmost point — the user-reported bug.
			rows: [
				{ month: "4", sales: "40", region: "north" }, // rightmost
				{ month: "1", sales: "10", region: "north" },
				{ month: "3", sales: "30", region: "north" },
				{ month: "2", sales: "20", region: "north" }, // last in input
				{ month: "4", sales: "35", region: "south" }, // rightmost
				{ month: "1", sales: "5", region: "south" },
				{ month: "3", sales: "25", region: "south" },
				{ month: "2", sales: "15", region: "south" }, // last in input
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const installInMemoryLocalStorage = (): Map<string, string> => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? store.get(k)! : null),
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	Object.defineProperty(window, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	return store
}

const seedState = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildLineDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			connection: { field: "region" },
		})
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify({
			...emptyDataLabelsEncodings(),
			// DataLabels needs its OWN x/y mappings to position labels in
			// the row-based path (scatter). Only mapping `value` won't
			// render anything — the layer's early-return fires.
			x: { field: "month" },
			y: { field: "sales" },
			value: { field: "sales" },
		})
	)
	store.set(
		"vis-components:currentDataLabelsConfig",
		JSON.stringify({
			...DEFAULT_DATA_LABELS_CONFIG,
			onlyLastLabel: true,
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState = (snap: TestStore) => {
	snap.set(datasetsAtom, { [DATASET_ID]: buildLineDataset() })
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
	snap.set(currentDataLabelsConfigAtom, {
		...DEFAULT_DATA_LABELS_CONFIG,
		onlyLastLabel: true,
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

describe("Data labels — onlyLastLabel on a scatter+connection line chart", () => {
	it("renders exactly one label per connection group, at the rightmost data point", () => {
		seedState()
		const { container } = render(
			<TestProvider initializeState={initState}>
				<div style={{ width: 600, height: 400 }}>
					<Probe />
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		// DataLabelsLayer wraps text labels in a `<g aria-hidden="true"
		// pointerEvents="none">`. Filter on that wrapper to avoid axis
		// tick labels (which use `<text>` directly under the axis `<g>`).
		const dataLabelsGroups = container.querySelectorAll(
			'g[aria-hidden="true"][pointer-events="none"]'
		)
		const labels = [...dataLabelsGroups].flatMap((g) => [
			...g.querySelectorAll("text"),
		])
		// onlyLastLabel: per series (connection group), keep the rightmost
		// (highest cx) box. Two groups → two labels.
		const labelTexts = labels.map((t) => t.textContent?.trim() ?? "").sort()
		expect(labelTexts).toEqual(["35", "40"])
		expect(labels.length).toBe(2)
	})
})
