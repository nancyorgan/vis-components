import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import type { DrawOrderConfig } from "../../lib/drawOrder"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Aesthetics "Draw order" on a LINE chart: the setting re-orders the SERIES
 *  paint order (which line draws on top of a crossing), not just overlapping
 *  points. Two series sit at distinct y bands so each <polyline>'s mean
 *  pixel-y identifies which series it is; the DOM sequence IS the paint order.
 *  Each series carries a `rank` constant within the series so the sort ranks
 *  them by their representative row. */

const DATASET_ID = "ds-line-draw-order"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "line-draw-order",
	fields: [
		{ name: "xv", inferredType: "quantitative" },
		{ name: "yv", inferredType: "quantitative" },
		{ name: "series", inferredType: "categorical" },
		{ name: "rank", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "line-draw-order.csv",
			// Encounter order is B (rank 2, high y) then A (rank 1, low y):
			// the un-sorted paint order is [B, A].
			rows: [
				{ xv: "1", yv: "9", series: "B", rank: "2" },
				{ xv: "2", yv: "9", series: "B", rank: "2" },
				{ xv: "1", yv: "1", series: "A", rank: "1" },
				{ xv: "2", yv: "1", series: "A", rank: "1" },
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

const seed = (drawOrder: DrawOrderConfig | null) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "xv" },
		y: { field: "yv" },
		connection: { field: "series" },
	})
	set("vis-components:currentChannelConfigs", { drawOrder })
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

/** Each connection <polyline> classified to its series ("A" = low value =
 *  larger pixel-y, "B" = high value = smaller pixel-y), in DOM (= paint)
 *  order. */
const seriesPaintOrder = (container: HTMLElement): string[] => {
	const means: number[] = []
	for (const pl of container.querySelectorAll("polyline[points]")) {
		const pts = (pl.getAttribute("points") ?? "")
			.trim()
			.split(/\s+/)
			.map((p) => Number(p.split(",")[1]))
			.filter((n) => Number.isFinite(n))
		if (pts.length === 0) continue
		means.push(pts.reduce((s, n) => s + n, 0) / pts.length)
	}
	// The y scale is inverted (larger data value → smaller pixel y), so the
	// low-value series A sits lower on screen (larger mean pixel y). Classify
	// each polyline relative to the other rather than an absolute threshold.
	const mid = (Math.max(...means) + Math.min(...means)) / 2
	return means.map((m) => (m > mid ? "A" : "B"))
}

describe("line-series draw order (Aesthetics)", () => {
	it("defaults to dataset encounter order", () => {
		seed(null)
		expect(seriesPaintOrder(mount().container)).toEqual(["B", "A"])
	})

	it("ascending paints the highest-ranked series last (on top)", () => {
		seed({ field: "rank", dir: "asc" })
		// rank asc = A(1) then B(2): B ends up on top, flipping encounter order.
		expect(seriesPaintOrder(mount().container)).toEqual(["A", "B"])
	})

	it("descending paints the lowest-ranked series last (on top)", () => {
		seed({ field: "rank", dir: "desc" })
		// rank desc = B(2) then A(1): A ends up on top.
		expect(seriesPaintOrder(mount().container)).toEqual(["B", "A"])
	})
})
