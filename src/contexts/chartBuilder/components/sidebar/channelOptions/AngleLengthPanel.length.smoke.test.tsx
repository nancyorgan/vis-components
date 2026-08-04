import { cleanup, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { LengthOptionsPanel } from "./AngleLengthPanel"

/** The Length panel's Min/Max px range only applies where the length scale is
 *  actually consumed (segment marks on scatter, the length legend ramp). In
 *  bar modes the mapped variable IS the bar length via the position scale, so
 *  the panel suppresses the inert range inputs and explains why. */

const DATASET_ID = "ds-length-panel"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "sales",
	fields: [
		{ name: "region", inferredType: "categorical" },
		{ name: "sales", inferredType: "quantitative" },
		{ name: "profit", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "sales.csv",
			rows: Array.from({ length: 6 }, (_, i) => ({
				region: i % 2 === 0 ? "East" : "West",
				sales: String(2 * i),
				profit: String(i),
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

const seed = (encodings: Encodings) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	return store
}

// Datasets hydrate asynchronously (IndexedDB-backed persist effect) — settle
// a tick before asserting, and scope queries to this render's container.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<LengthOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

/** `x + length`, no y/angle → bars-x: the measure IS the bar length. */
const BARS: Encodings = {
	...emptyEncodings(),
	x: { field: "region" },
	length: { field: "sales" },
}

/** `x + y + length` → scatter with segment marks: px range applies. */
const SEGMENTS: Encodings = {
	...emptyEncodings(),
	x: { field: "sales" },
	y: { field: "profit" },
	length: { field: "sales" },
}

describe("Length panel — length variable mapped", () => {
	it("bar mode: hides the inert Min/Max px range and explains why", async () => {
		seed(BARS)
		const q = await mount()
		expect(q.queryByLabelText("Min")).toBeNull()
		expect(q.queryByLabelText("Max")).toBeNull()
		expect(q.getByText(/axis scale/)).not.toBeNull()
	})

	it("segment mode: still offers the Min/Max px range", async () => {
		seed(SEGMENTS)
		const q = await mount()
		expect(q.queryByLabelText("Min")).not.toBeNull()
		expect(q.queryByLabelText("Max")).not.toBeNull()
	})
})
