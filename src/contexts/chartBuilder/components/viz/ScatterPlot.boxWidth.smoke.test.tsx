import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** `boxWidthScale` fattens/thins the box's dimension perpendicular to the value
 *  axis. A single quantitative variable on X draws a horizontal box, so the
 *  scale drives the box rect's HEIGHT — doubling the scale doubles the height. */

const DATASET_ID = "ds-box-width"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "scores",
	fields: [{ name: "score", inferredType: "quantitative" }],
	versions: [
		{
			id: "v1",
			filename: "scores.csv",
			rows: Array.from({ length: 20 }, (_, i) => ({ score: String(i + 1) })),
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

const seed = (overlay: Record<string, unknown>) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	// Only X is mapped (a single quantitative variable → horizontal box).
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "score" },
	})
	set("vis-components:currentChannelConfigs", {
		x: {
			...DEFAULT_AXIS_CONFIG,
			distributionOverlay: {
				...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
				showBoxPlot: true,
				showPoints: false,
				...overlay,
			},
		},
	})
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

// The box's body is the only <rect> filled with the default box fill color.
const boxRectHeight = (container: HTMLElement): number => {
	const rect = [...container.querySelectorAll("rect")].find(
		(r) => r.getAttribute("fill") === DEFAULT_DISTRIBUTION_OVERLAY_CONFIG.fillColor
	)
	expect(rect).toBeTruthy()
	return Number(rect!.getAttribute("height"))
}

describe("box-plot width scale", () => {
	it("doubles the box thickness when boxWidthScale doubles", () => {
		seed({ boxWidthScale: 1 })
		const single = boxRectHeight(mount().container)

		seed({ boxWidthScale: 2 })
		const doubled = boxRectHeight(mount().container)

		expect(single).toBeGreaterThan(0)
		expect(doubled).toBeCloseTo(single * 2, 1)
	})
})
