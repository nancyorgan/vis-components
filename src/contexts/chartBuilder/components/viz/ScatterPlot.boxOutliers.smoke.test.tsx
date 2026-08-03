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

/** Box-plot outlier circles double-draw the real data points when "Show
 *  points" is on (the points already mark those values), so BoxShape only
 *  renders them while the points are hidden. */

const DATASET_ID = "ds-box-outliers"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "scores",
	fields: [{ name: "score", inferredType: "quantitative" }],
	versions: [
		{
			id: "v1",
			filename: "scores.csv",
			// A tight cluster (1..20) plus a far value: 100 sits well past
			// q3 + 1.5*IQR, so the Tukey box classifies it as an outlier.
			rows: [
				...Array.from({ length: 20 }, (_, i) => ({ score: String(i + 1) })),
				{ score: "100" },
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

const seed = (overlay: Record<string, unknown>) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	// Only X is mapped (a single quantitative variable, no Y).
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

// BoxShape's outlier markers are the only r=2 unfilled circles in the chart.
const outlierCircles = (container: HTMLElement) =>
	[...container.querySelectorAll("circle")].filter(
		(c) => c.getAttribute("r") === "2" && c.getAttribute("fill") === "none"
	)

describe("box-plot outlier circles vs Show points", () => {
	it("draws outlier circles when the underlying points are hidden", () => {
		seed({ showPoints: false })
		const { container } = mount()
		expect(outlierCircles(container).length).toBeGreaterThan(0)
	})

	it("suppresses outlier circles when Show points is on", () => {
		seed({ showPoints: true })
		const { container } = mount()
		expect(outlierCircles(container)).toHaveLength(0)
		// The data points themselves still render (marks are symbol <path>s;
		// one per row, so more than the box's own shapes).
		expect(container.querySelectorAll("path").length).toBeGreaterThan(20)
	})
})
