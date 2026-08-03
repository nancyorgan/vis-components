import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import type { DrawOrderConfig } from "../../lib/drawOrder"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Aesthetics "Draw order": SVG paints in document order, so the setting
 *  controls which overlapping point wins by re-ordering the mark <path>
 *  elements. Rows carry distinct x values so each mark's translate-x
 *  identifies its row — the DOM sequence of translate-x values IS the paint
 *  order. */

const DATASET_ID = "ds-draw-order"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "draw-order",
	fields: [
		{ name: "xv", inferredType: "quantitative" },
		{ name: "yv", inferredType: "quantitative" },
		{ name: "size", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "draw-order.csv",
			// Dataset order deliberately NOT sorted by `size` (or by x):
			// row 0 → x=2/size=5, row 1 → x=3/size=9, row 2 → x=1/size=1.
			rows: [
				{ xv: "2", yv: "1", size: "5" },
				{ xv: "3", yv: "2", size: "9" },
				{ xv: "1", yv: "3", size: "1" },
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

/** translate-x of each mark path, in DOM (= paint) order. */
const markXs = (container: HTMLElement): number[] => {
	const xs: number[] = []
	for (const p of container.querySelectorAll("path[transform]")) {
		const m = /translate\(\s*([-\d.]+)\s*,/.exec(p.getAttribute("transform") ?? "")
		if (m) xs.push(Number(m[1]))
	}
	return xs
}

describe("draw order (Aesthetics)", () => {
	it("defaults to dataset row order", () => {
		seed(null)
		const xs = markXs(mount().container)
		expect(xs).toHaveLength(3)
		// Dataset order is x = 2, 3, 1 — the x scale is monotonic, so the
		// paint sequence goes mid, high, low.
		expect(xs[2]).toBeLessThan(xs[0])
		expect(xs[0]).toBeLessThan(xs[1])
	})

	it("ascending sort paints the highest value last (on top)", () => {
		seed({ field: "size", dir: "asc" })
		const xs = markXs(mount().container)
		expect(xs).toHaveLength(3)
		// size asc = 1, 5, 9 → x = 1, 2, 3: strictly increasing.
		expect(xs[0]).toBeLessThan(xs[1])
		expect(xs[1]).toBeLessThan(xs[2])
	})

	it("descending sort paints the lowest value last (on top)", () => {
		seed({ field: "size", dir: "desc" })
		const xs = markXs(mount().container)
		expect(xs).toHaveLength(3)
		// size desc = 9, 5, 1 → x = 3, 2, 1: strictly decreasing.
		expect(xs[0]).toBeGreaterThan(xs[1])
		expect(xs[1]).toBeGreaterThan(xs[2])
	})
})
