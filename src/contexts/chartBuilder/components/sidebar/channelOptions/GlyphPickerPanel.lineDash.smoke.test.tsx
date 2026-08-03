import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../../testSupport/TestProvider"
import { afterEach, describe, expect, it } from "vitest"

import type {
	ConnectionConfig,
	LineDashPattern,
} from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"

import { PatternOptionsPanel } from "./GlyphPickerPanel"

/** The Pattern panel's Line-dash controls in line-chart context:
 *  - the no-field default row writes `connection.defaultDashPattern` (the
 *    field the renderers read), NOT the point-fill `defaultPattern`;
 *  - "Apply pattern to range" is hidden once a pattern variable is mapped
 *    (the variable says where each dash applies — the two conflict);
 *  - the "Fill dash gaps" checkbox writes `connection.dashGapFill`, with
 *    AUTO defaults by whether pattern and hue share a field. */

const DATASET_ID = "ds-line-dash-panel"

const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "sales",
	fields: [
		{ name: "month", inferredType: "quantitative" },
		{ name: "sales", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
		{ name: "status", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "sales.csv",
			rows: Array.from({ length: 6 }, (_, i) => ({
				month: String(i),
				sales: String(2 * i),
				region: i % 2 === 0 ? "East" : "West",
				status: i < 3 ? "known" : "proj",
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
			<PatternOptionsPanel />
		</TestProvider>
	)
	await new Promise((r) => setTimeout(r, 50))
	return within(container)
}

afterEach(cleanup)

/** Line-chart encodings (scatter + connection → compound pattern mode). */
const LINE: Encodings = {
	...emptyEncodings(),
	x: { field: "month" },
	y: { field: "sales" },
	connection: { field: "region" },
}

/** Saved configs persist under the `{_v, data}` versioned envelope. */
type SavedConfigs = {
	defaultPattern?: number | null
	connection?: Partial<ConnectionConfig> & {
		defaultDashPattern?: LineDashPattern
	}
}
const readSavedConfigs = (store: Map<string, string>): SavedConfigs => {
	const parsed = JSON.parse(
		store.get("vis-components:currentChannelConfigs") ?? "{}"
	) as { _v?: number; data?: SavedConfigs }
	return parsed.data ?? (parsed as SavedConfigs)
}

describe("Pattern panel — no-field Line dash row (line chart)", () => {
	it("picking a dash writes connection.defaultDashPattern, NOT the point-fill defaultPattern", async () => {
		const store = seed(LINE)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Line dash option 1"))
		const configs = readSavedConfigs(store)
		expect(configs.connection?.defaultDashPattern).toBe("dashed")
		expect(configs.defaultPattern ?? null).toBeNull()
	})

	it("'None' resets the default dash to solid", async () => {
		const store = seed(LINE)
		const q = await mount()
		fireEvent.click(q.getByLabelText("Line dash option 2"))
		fireEvent.click(q.getByLabelText("No line dash"))
		const configs = readSavedConfigs(store)
		expect(configs.connection?.defaultDashPattern).toBe("solid")
	})

	it("a Point fill pick keeps writing defaultPattern and leaves the dash alone", async () => {
		const store = seed(LINE)
		const q = await mount()
		// Point-fill subsection swatches keep the "Pattern option N" labels.
		fireEvent.click(q.getAllByLabelText("Pattern option 1")[0]!)
		const configs = readSavedConfigs(store)
		expect(configs.defaultPattern).toBe(0)
		expect(configs.connection?.defaultDashPattern ?? "solid").toBe("solid")
	})

	it("shows 'Apply pattern to range' when no pattern variable is mapped", async () => {
		seed(LINE)
		const q = await mount()
		expect(q.queryByLabelText("Apply pattern to range")).not.toBeNull()
	})
})

describe("Pattern panel — pattern variable mapped (line chart)", () => {
	it("hides 'Apply pattern to range' (conflicts with the variable's own split)", async () => {
		seed({ ...LINE, pattern: { field: "status" } })
		const q = await mount()
		expect(q.queryByLabelText("Apply pattern to range")).toBeNull()
	})

	it("still lists per-category dash rows for the mapped variable", async () => {
		seed({ ...LINE, pattern: { field: "status" } })
		const q = await mount()
		// Each category appears in BOTH the Line dash and Point fill
		// subsections (compound mode) — two "None" buttons per category.
		expect(q.getAllByLabelText("No pattern for known").length).toBe(2)
		expect(q.getAllByLabelText("No pattern for proj").length).toBe(2)
	})
})

describe("Pattern panel — 'Fill dash gaps' checkbox", () => {
	const checkbox = (q: ReturnType<typeof within>) =>
		q.getByLabelText("Fill dash gaps") as HTMLInputElement

	it("defaults CHECKED when pattern and hue map different fields", async () => {
		seed({
			...LINE,
			pattern: { field: "status" },
			hue: { field: "region" },
		})
		const q = await mount()
		expect(checkbox(q).checked).toBe(true)
	})

	it("defaults UNCHECKED when pattern and hue map the SAME field (opt-in)", async () => {
		seed({
			...LINE,
			pattern: { field: "region" },
			hue: { field: "region" },
		})
		const q = await mount()
		expect(checkbox(q).checked).toBe(false)
	})

	it("unchecking writes dashGapFill: false; re-checking back to auto clears it to null", async () => {
		const store = seed({
			...LINE,
			pattern: { field: "status" },
			hue: { field: "region" },
		})
		const q = await mount()
		fireEvent.click(checkbox(q))
		expect(readSavedConfigs(store).connection?.dashGapFill).toBe(false)
		fireEvent.click(checkbox(q))
		expect(readSavedConfigs(store).connection?.dashGapFill).toBeNull()
	})

	it("checking (same-field auto-off case) writes dashGapFill: true", async () => {
		const store = seed({
			...LINE,
			pattern: { field: "region" },
			hue: { field: "region" },
		})
		const q = await mount()
		fireEvent.click(checkbox(q))
		expect(readSavedConfigs(store).connection?.dashGapFill).toBe(true)
	})

	it("is offered with no pattern variable too (default dash + gaps)", async () => {
		seed(LINE)
		const q = await mount()
		expect(checkbox(q).checked).toBe(true)
	})
})

describe("Pattern panel — gap-color swatches (shown while 'Fill dash gaps' is on)", () => {
	it("hue mapped: one swatch per COLOR-encoding category; edits key dashAlternateColors by hue value", async () => {
		const store = seed({
			...LINE,
			pattern: { field: "status" },
			hue: { field: "region" },
		})
		const q = await mount()
		// One row per hue category (East/West), not per pattern category.
		expect(q.queryByLabelText("Gap color for East")).not.toBeNull()
		expect(q.queryByLabelText("Gap color for West")).not.toBeNull()
		expect(q.queryByLabelText("Gap color for known")).toBeNull()
		fireEvent.change(q.getByLabelText("Gap color for East"), {
			target: { value: "#aa0000" },
		})
		expect(readSavedConfigs(store).connection?.dashAlternateColors).toEqual({
			East: "#aa0000",
		})
		// Clearing the text input removes the override.
		fireEvent.change(q.getByLabelText("Gap color for East"), {
			target: { value: "" },
		})
		expect(readSavedConfigs(store).connection?.dashAlternateColors).toEqual({})
	})

	it("no hue encoding: a single 'Gap color' swatch writes dashGapColor", async () => {
		const store = seed(LINE)
		const q = await mount()
		fireEvent.change(q.getByLabelText("Gap color"), {
			target: { value: "#00aa00" },
		})
		expect(readSavedConfigs(store).connection?.dashGapColor).toBe("#00aa00")
	})

	it("swatches hide while 'Fill dash gaps' is unchecked", async () => {
		seed({
			...LINE,
			pattern: { field: "region" },
			hue: { field: "region" },
		})
		const q = await mount()
		// pattern === hue → auto-unchecked → no swatch rows.
		expect(q.queryByLabelText("Gap color for East")).toBeNull()
		// Checking it reveals them.
		fireEvent.click(q.getByLabelText("Fill dash gaps"))
		expect(q.queryByLabelText("Gap color for East")).not.toBeNull()
	})
})
