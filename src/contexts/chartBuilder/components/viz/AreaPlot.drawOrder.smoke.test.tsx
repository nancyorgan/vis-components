import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_CONNECTION_CONFIG,
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

import { AreaPlot } from "./AreaPlot"

/** Draw order on OVERLAY-mode area charts: which layer paints last (on top)
 *  follows the Aesthetics "Draw order" setting, ranking layers by the hue
 *  field that defines them (the same field-value ranking the line-chart
 *  series sort uses). In stack mode the setting is a deliberate no-op — the
 *  stacking order is load-bearing. Layers are told apart by top-edge height:
 *  the "big" group sits higher (smaller pixel-y) than "small". */

const DATASET_ID = "ds-area-draw-order"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "area-draw-order",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "conn", inferredType: "categorical" },
		{ name: "grp", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "area-draw-order.csv",
			rows: [
				{ cat: "P", val: "90", conn: "c", grp: "big" },
				{ cat: "Q", val: "80", conn: "c", grp: "big" },
				{ cat: "P", val: "10", conn: "c", grp: "small" },
				{ cat: "Q", val: "15", conn: "c", grp: "small" },
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

type Opts = { drawOrder?: { field: string; dir: "asc" | "desc" } | null }

const channelConfigs = (opts: Opts) => ({
	...EMPTY_CHANNEL_CONFIGS,
	// Overlay layout so the layer paint order is a free choice (in stack mode
	// it would be load-bearing). Line fill so each layer emits one top-edge
	// path we can measure.
	hue: { kind: "categorical" as const, colors: {}, stackMode: "overlay" as const },
	connection: { ...DEFAULT_CONNECTION_CONFIG, fill: "line" as const },
	...(opts.drawOrder !== undefined ? { drawOrder: opts.drawOrder } : {}),
})

const seedStorage = (opts: Opts) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "cat" },
			length: { field: "val" },
			connection: { field: "conn" },
			hue: { field: "grp" },
		}),
	)
	store.set("vis-components:currentChannelConfigs", JSON.stringify(channelConfigs(opts)))
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState =
	(opts: Opts) =>
	(snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			x: { field: "cat" },
			length: { field: "val" },
			connection: { field: "conn" },
			hue: { field: "grp" },
		})
		snap.set(currentChannelConfigsAtom, channelConfigs(opts))
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

const mount = (opts: Opts = {}) => {
	seedStorage(opts)
	const { container } = render(
		<TestProvider initializeState={initState(opts)}>
			<div style={{ width: 600, height: 400 }}>
				<AreaPlot />
			</div>
		</TestProvider>,
	)
	return container
}

/** Each layer <path> classified to its group ("big" = higher = smaller mean
 *  pixel-y, "small" = lower), in DOM (= paint) order. Only the two layer
 *  top-edge paths carry many coordinate pairs; skip any stray short paths. */
const layerPaintOrder = (container: HTMLElement): string[] => {
	const means: number[] = []
	for (const p of container.querySelectorAll("path")) {
		const nums = (p.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g)
		if (!nums || nums.length < 4) continue
		const ys: number[] = []
		for (let i = 1; i < nums.length; i += 2) ys.push(Number(nums[i]))
		means.push(ys.reduce((s, n) => s + n, 0) / ys.length)
	}
	const mid = (Math.max(...means) + Math.min(...means)) / 2
	return means.map((m) => (m < mid ? "big" : "small"))
}

describe("area-layer draw order (overlay mode)", () => {
	it("defaults to peak-value order: largest layer behind, smallest on top", () => {
		// Default overlay sort paints big (peak 90) first, small last.
		expect(layerPaintOrder(mount())).toEqual(["big", "small"])
	})

	it("descending by the hue field flips which layer paints on top", () => {
		// desc paints the lowest-ranked value last: "big" < "small"
		// alphabetically, so "big" is drawn last (on top), flipping the
		// peak-value default.
		expect(layerPaintOrder(mount({ drawOrder: { field: "grp", dir: "desc" } }))).toEqual([
			"small",
			"big",
		])
	})

	it("ascending by the hue field puts the highest value on top", () => {
		// grp asc = big, small → small on top, matching the peak default here.
		expect(layerPaintOrder(mount({ drawOrder: { field: "grp", dir: "asc" } }))).toEqual([
			"big",
			"small",
		])
	})
})
