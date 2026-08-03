import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_SHAPE_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { HexbinPlot } from "./HexbinPlot"

/** Mounts HexbinPlot against two exact-duplicate point clusters — (1,1)×3
 *  and (9,9)×2 — so cluster→cell assignment is guaranteed regardless of bin
 *  geometry: two occupied cells, counts 3 and 2. */

const DATASET_ID = "ds-hexbin-test"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "points",
	fields: [
		{ name: "X", inferredType: "quantitative" },
		{ name: "Y", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "points.csv",
			rows: [
				{ X: "1", Y: "1" },
				{ X: "1", Y: "1" },
				{ X: "1", Y: "1" },
				{ X: "9", Y: "9" },
				{ X: "9", Y: "9" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

/** Map-backed localStorage shim — see ScatterPlot.lineChart.smoke.test.tsx
 *  for why happy-dom's built-in localStorage doesn't work with the
 *  persistEffect-backed atoms. */
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

const encodingsFor = (opts?: { dropY?: boolean }) => ({
	...emptyEncodings(),
	x: { field: "X" },
	...(opts?.dropY ? {} : { y: { field: "Y" } }),
	hue: { field: null, measureSource: "hexCount" as const },
})

const mountHexbin = (opts?: { dropY?: boolean; configs?: ChannelConfigs }) => {
	const store = installInMemoryLocalStorage()
	const configs = opts?.configs ?? EMPTY_CHANNEL_CONFIGS
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify(encodingsFor(opts))
	)
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	/* eslint-enable @th/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodingsFor(opts))
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

	return render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<svg>
					<HexbinPlot />
				</svg>
			</div>
		</TestProvider>
	)
}

describe("HexbinPlot", () => {
	it("renders one hexagon per occupied cell, colored by count", () => {
		const { container } = mountHexbin()
		const cells = container.querySelectorAll("path.vc-hexbin-cell")
		expect(cells).toHaveLength(2)
		const fills = [...cells].map((c) => c.getAttribute("fill"))
		expect(fills[0]).toBeTruthy()
		expect(fills[1]).toBeTruthy()
		// count-3 and count-2 cells sit at different gradient positions
		expect(fills[0]).not.toBe(fills[1])
	})

	it("renders nothing (but doesn't crash) when an axis is unmapped", () => {
		const { container } = mountHexbin({ dropY: true })
		expect(container.querySelectorAll("path.vc-hexbin-cell")).toHaveLength(0)
	})

	it("strokes cells with the Shape outline color/width; width 0 hides", () => {
		const { container } = mountHexbin({
			configs: {
				shape: { ...DEFAULT_SHAPE_CONFIG, outlineColor: "#123456", outlineWidth: 2 },
			},
		})
		const cell = container.querySelector("path.vc-hexbin-cell")
		expect(cell?.getAttribute("stroke")).toBe("#123456")
		expect(cell?.getAttribute("stroke-width")).toBe("2")

		const { container: hidden } = mountHexbin({
			configs: {
				shape: { ...DEFAULT_SHAPE_CONFIG, outlineColor: "#123456", outlineWidth: 0 },
			},
		})
		const hiddenCell = hidden.querySelector("path.vc-hexbin-cell")
		expect(hiddenCell?.getAttribute("stroke")).toBe("none")
	})
})
