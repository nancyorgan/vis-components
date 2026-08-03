import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Beeswarm packing: a categorical axis (x) vs a quantitative axis (y) with the
 *  category side's `beeswarm` flag on. Points pack along x without overlapping.
 *  The key behavior under test is that the packing reads each point's RADIUS, so
 *  resizing the points (Point size → `defaultRadius`) re-spaces the swarm. */

const DATASET_ID = "ds-beeswarm"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "beeswarm",
	fields: [
		{ name: "group", inferredType: "categorical" },
		{ name: "value", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "beeswarm.csv",
			// One category so every point packs into a single band; values cluster
			// tightly so the points genuinely collide and must fan out along x.
			rows: Array.from({ length: 40 }, (_, i) => ({
				group: "A",
				value: String(50 + (i % 5)),
			})),
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

const seed = (defaultRadius: number) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		x: { field: "group" },
		y: { field: "value" },
	})
	set("vis-components:currentChannelConfigs", {
		defaultRadius,
		x: { ...DEFAULT_AXIS_CONFIG, beeswarm: true },
		y: { ...DEFAULT_AXIS_CONFIG },
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

/** Horizontal spread (max − min translate-x) of the rendered point paths. */
const pointSpreadX = (container: HTMLElement): number => {
	const xs: number[] = []
	for (const p of container.querySelectorAll("path[transform]")) {
		const m = /translate\(\s*([-\d.]+)\s*,/.exec(p.getAttribute("transform") ?? "")
		if (m) xs.push(Number(m[1]))
	}
	if (xs.length === 0) return 0
	return Math.max(...xs) - Math.min(...xs)
}

describe("beeswarm packing", () => {
	it("packs points into a horizontal swarm within one category", () => {
		seed(4)
		const { container } = mount()
		// 40 points fanned out → the swarm is meaningfully wider than a hair.
		expect(pointSpreadX(container)).toBeGreaterThan(10)
	})

	it("widens the swarm when the point size increases", () => {
		seed(4)
		const small = pointSpreadX(mount().container)
		seed(12)
		const large = pointSpreadX(mount().container)
		// Bigger points need more room, so the packing spreads them farther.
		expect(large).toBeGreaterThan(small * 1.5)
	})
})
