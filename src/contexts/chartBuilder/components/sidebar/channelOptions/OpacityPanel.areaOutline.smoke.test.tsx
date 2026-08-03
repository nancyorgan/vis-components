import { fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { OpacityOptionsPanel } from "./OpacityOptionsPanel"

/** The Opacity menu for area/radar mirrors the Color menu: "Fill" and "Outline"
 *  are separate sibling subheaders, neither carrying a redundant "Vary by" —
 *  fill and outline are linked to the series. */

const ID = "ds-opacity-area"

const buildDataset = (): Dataset => ({
	id: ID,
	name: "area",
	createdAt: 0,
	latestVersionId: "v1",
	fields: [
		{ name: "month", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "series", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "area.csv",
			createdAt: 0,
			rows: [
				{ month: "Jan", val: "10", series: "A" },
				{ month: "Jan", val: "8", series: "B" },
			],
		},
	],
})

const installInMemoryLocalStorage = () => {
	const store = new Map<string, string>()
	const fake: Storage = {
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
		value: fake,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fake,
		writable: true,
		configurable: true,
	})
	return store
}

const enc = {
	...emptyEncodings(),
	x: { field: "month" },
	length: { field: "val" },
	connection: { field: "series" },
	hue: { field: "series" },
	// Map opacity to a categorical field so the Fill control renders its
	// per-value (categorical) branch — the branch whose "Vary by" must also be
	// hidden when linked.
	opacity: { field: "series" },
}
const cfg = {
	...EMPTY_CHANNEL_CONFIGS,
	hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG },
	connection: { ...DEFAULT_CONNECTION_CONFIG, fill: "area" as const },
}

const mount = () => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", cfg)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(
		<TestProvider initializeState={init}>
			<OpacityOptionsPanel />
		</TestProvider>
	)
}

const subheaders = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")].map(
		(b) => b.textContent?.trim() ?? ""
	)

describe("OpacityOptionsPanel — area outline organization", () => {
	it("shows Fill and Outline as sibling subheaders", () => {
		const { container } = mount()
		const headers = subheaders(container)
		expect(headers).toContain("Fill")
		expect(headers).toContain("Outline")
		// Outline must not be nested inside the Fill subsection.
		const all = [...container.querySelectorAll("button[aria-expanded]")]
		const fillBtn = all.find((b) => b.textContent?.trim() === "Fill")!
		const outlineBtn = all.find((b) => b.textContent?.trim() === "Outline")!
		const fillSubsection = fillBtn.closest("div")?.parentElement
		expect(fillSubsection?.contains(outlineBtn)).toBe(false)
	})

	it("does not show a 'Vary by' selector under Fill or Outline (linked)", () => {
		const { container, queryAllByText } = mount()
		// Fill is open by default; expand Outline too.
		const outlineBtn = [
			...container.querySelectorAll("button[aria-expanded]"),
		].find((b) => b.textContent?.trim() === "Outline")!
		fireEvent.click(outlineBtn)
		expect(queryAllByText("Vary by")).toHaveLength(0)
	})
})
