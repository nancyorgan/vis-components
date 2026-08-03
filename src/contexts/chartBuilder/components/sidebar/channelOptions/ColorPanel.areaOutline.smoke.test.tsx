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

import { ColorPanel } from "./ColorPanel"

/** The Color menu for area/radar should show "Fill" and "Outline" as SEPARATE
 *  sibling subheaders — not "Outline" nested inside "Fill". */

const ID = "ds-color-area"

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
			<ColorPanel />
		</TestProvider>
	)
}

/** Titles of the collapsible subheaders, in document order. */
const subheaders = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")].map(
		(b) => b.textContent?.trim() ?? ""
	)

describe("ColorPanel — area outline organization", () => {
	it("shows Fill and Outline as separate sibling subheaders (no nested Fill)", () => {
		const { container } = mount()
		const headers = subheaders(container)
		// Exactly one Fill and one Outline header — the old layout nested a second
		// Fill (and the Outline) inside the outer Fill.
		expect(headers.filter((h) => h === "Fill")).toHaveLength(1)
		expect(headers.filter((h) => h === "Outline")).toHaveLength(1)

		// Sibling check: the Outline header is NOT inside the Fill subsection.
		const fillBtn = [...container.querySelectorAll("button[aria-expanded]")].find(
			(b) => b.textContent?.trim() === "Fill"
		)!
		const outlineBtn = [
			...container.querySelectorAll("button[aria-expanded]"),
		].find((b) => b.textContent?.trim() === "Outline")!
		// The Fill subsection root is the button's grandparent (button → header row
		// → subsection div). Outline must not live within it.
		const fillSubsection = fillBtn.closest("div")?.parentElement
		expect(fillSubsection?.contains(outlineBtn)).toBe(false)
	})

	it("does not show a 'Vary by' selector under Fill (redundant for area/radar)", () => {
		const { queryByText } = mount()
		// Fill is open by default; the in-panel "Vary by" field selector is hidden
		// (the color field is the series, set via the Color shelf row).
		expect(queryByText("Vary by")).toBeNull()
	})

	it("Outline subheader hosts the line-palette editor (Match fill default)", () => {
		const { container, getByText } = mount()
		const outlineBtn = [
			...container.querySelectorAll("button[aria-expanded]"),
		].find((b) => b.textContent?.trim() === "Outline")!
		fireEvent.click(outlineBtn) // expand
		// The line-palette dropdown offers "Match fill" as the linked default.
		expect(getByText("Match fill")).toBeTruthy()
	})
})
