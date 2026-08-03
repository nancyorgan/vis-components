import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	type DashRangeConfig,
	type RegressionConfig,
} from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { PatternOptionsPanel } from "./GlyphPickerPanel"

/** The Pattern panel's "Regression line" subheader: gated on scatter mode
 *  with the regression overlay enabled, offers the shared dash swatches plus
 *  the Custom dasharray input, and writes configs.x.regression. */

const DATASET_ID = "ds-regression-pattern-panel"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "measurements",
	fields: [
		{ name: "xval", inferredType: "quantitative" },
		{ name: "yval", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "measurements.csv",
			rows: Array.from({ length: 6 }, (_, i) => ({
				xval: String(i),
				yval: String(2 * i),
				region: i % 2 === 0 ? "East" : "West",
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

const seed = (encodings: Encodings, regression?: Partial<RegressionConfig>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	if (regression) {
		set("vis-components:currentChannelConfigs", {
			x: {
				...DEFAULT_AXIS_CONFIG,
				regression: {
					...DEFAULT_REGRESSION_CONFIG,
					enabled: true,
					...regression,
				},
			},
		})
	}
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	return store
}

// Datasets hydrate asynchronously (IndexedDB-backed persist effect) — settle
// a tick before asserting, and scope queries to this render's container.
const mount = async () => {
	const { container } = render(
		<TestProvider>
			<PatternOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

const XY: Encodings = {
	...emptyEncodings(),
	x: { field: "xval" },
	y: { field: "yval" },
}

/** Saved configs persist under the `{_v, data}` versioned envelope. */
type SavedConfigs = {
	x?: { regression?: RegressionConfig }
	connection?: { dashRange?: DashRangeConfig }
}
const readSavedConfigs = (store: Map<string, string>): SavedConfigs => {
	const parsed = JSON.parse(
		store.get("vis-components:currentChannelConfigs") ?? "{}"
	) as { _v?: number; data?: SavedConfigs }
	return parsed.data ?? (parsed as SavedConfigs)
}

describe("Pattern panel regression-line dash", () => {
	it("shows the Regression line subheader when the overlay is on", async () => {
		seed(XY, {})
		const q = await mount()
		const header = q.queryByText("Regression line")
		expect(header).not.toBeNull()
		// Collapsed by default — expand to reach the dash row.
		fireEvent.click(header!)
		expect(q.queryByLabelText("No dash for regression line")).not.toBeNull()
		expect(
			q.queryByLabelText("Custom dash for regression line")
		).not.toBeNull()
	})

	it("hides the subheader when the regression overlay is off", async () => {
		seed(XY)
		const q = await mount()
		expect(q.queryByText("Regression line")).toBeNull()
	})

	it("picking Custom opens the dasharray input and typing persists it", async () => {
		const store = seed(XY, {})
		const q = await mount()
		fireEvent.click(q.getByText("Regression line"))
		fireEvent.click(q.getByLabelText("Custom dash for regression line"))
		const input = q.getByLabelText("Custom dash pattern")
		fireEvent.change(input, { target: { value: "2,2" } })
		const configs = readSavedConfigs(store)
		expect(configs.x?.regression?.customDasharray).toBe("2,2")
	})

	it("picking a dash swatch writes lineStyle and clears any custom dash", async () => {
		const store = seed(XY, { customDasharray: "5,5" })
		const q = await mount()
		fireEvent.click(q.getByText("Regression line"))
		fireEvent.click(q.getByLabelText("Regression line dash dotted"))
		const configs = readSavedConfigs(store)
		expect(configs.x?.regression?.lineStyle).toBe("dotted")
		expect(configs.x?.regression?.customDasharray).toBeNull()
	})

	it("line charts: range rows in the Line dash section write connection.dashRange", async () => {
		// Connection mapped, no pattern field → compound mode; the "Line
		// dash" subsection is defaultOpen so the rows are reachable directly.
		const store = seed({ ...XY, connection: { field: "region" } })
		const q = await mount()
		fireEvent.click(q.getByLabelText("Apply pattern to range"))
		fireEvent.change(q.getByLabelText("Pattern range from"), {
			target: { value: "3" },
		})
		const configs = readSavedConfigs(store)
		expect(configs.connection?.dashRange).toEqual({
			enabled: true,
			min: "3",
			max: null,
		})
	})

	it("'Apply pattern to range' writes x.regression.dashRange", async () => {
		const store = seed(XY, {})
		const q = await mount()
		fireEvent.click(q.getByText("Regression line"))
		fireEvent.click(q.getByLabelText("Apply pattern to range"))
		fireEvent.change(q.getByLabelText("Pattern range from"), {
			target: { value: "4" },
		})
		const configs = readSavedConfigs(store)
		expect(configs.x?.regression?.dashRange).toEqual({
			enabled: true,
			min: "4",
			max: null,
		})
	})
})
