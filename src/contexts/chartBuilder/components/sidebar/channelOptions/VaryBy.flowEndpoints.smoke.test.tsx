import { fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { EMPTY_CHANNEL_CONFIGS, type ChannelConfigs } from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { ColorPanel } from "./ColorPanel"
import { OpacityOptionsPanel } from "./OpacityOptionsPanel"
import { BrightnessOptionsPanel, SaturationOptionsPanel } from "./RangePanel"

/** A part's "Vary by" lists only variables that can vary it on this chart.
 *
 *  On a flow diagram a node is not a dataset row — it is every row naming
 *  it at either end — so only the two endpoint columns have one value per
 *  node. The lists used to offer every column, and all but those two did
 *  nothing (the browser sweep recorded each of these "Vary by" controls as
 *  working for some choices only). Everywhere else every column stays. */

const ID = "ds-vary-by-flow"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "flows",
		filename: "flows.csv",
		fields: [
			{ name: "Start", inferredType: "categorical" },
			{ name: "Stop", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
			{ name: "Carrier", inferredType: "categorical" },
		],
		rows: [
			{ Start: "Nashville", Stop: "Memphis", Value: "5", Carrier: "rail" },
			{ Start: "New York", Stop: "Miami", Value: "8", Carrier: "air" },
			{ Start: "Seattle", Stop: "New York", Value: "4", Carrier: "air" },
		],
	})

const FLOW: Encodings = {
	...emptyEncodings(),
	connection: { field: "Start" },
	area: { field: "Value" },
}
const SCATTER: Encodings = {
	...emptyEncodings(),
	x: { field: "Value" },
	y: { field: "Value" },
}
const SANKEY = {
	...EMPTY_CHANNEL_CONFIGS,
	connection: { hierarchyLayout: "sankey", flowTargetField: "Stop" },
} as unknown as ChannelConfigs

const mount = (panel: React.ReactNode, encodings: Encodings, configs: ChannelConfigs) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	/* eslint-enable @vc/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(<TestProvider initializeState={init}>{panel}</TestProvider>).container
}

/** The "Vary by" options under one subsection, opened first. */
const varyByOptions = (container: HTMLElement, title: string): string[] => {
	const header = [...container.querySelectorAll("button[aria-expanded]")].find(
		(b) => b.textContent?.trim() === title
	)
	if (!header) throw new Error(`no "${title}" section; have: ${[...container.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent?.trim()).join(", ")}`)
	if (header.getAttribute("aria-expanded") === "false") fireEvent.click(header)
	const section = header.closest("div")!.parentElement!
	const select = within(section).getAllByLabelText("Vary by")[0] as HTMLSelectElement
	return [...select.options].map((o) => o.textContent ?? "")
}

describe("Vary by on a flow diagram — endpoint columns only", () => {
	it("Color → Node outline", () => {
		const c = mount(<ColorPanel />, FLOW, SANKEY)
		expect(varyByOptions(c, "Node outline")).toEqual(["— none —", "Start", "Stop"])
	})

	it("Opacity → Node outline", () => {
		const c = mount(<OpacityOptionsPanel />, FLOW, SANKEY)
		expect(varyByOptions(c, "Node outline")).toEqual(["— none —", "Start", "Stop"])
	})

	it("Saturation and Brightness → Node fill and Node outline", () => {
		for (const panel of [<SaturationOptionsPanel key="s" />, <BrightnessOptionsPanel key="b" />]) {
			const c = mount(panel, FLOW, SANKEY)
			expect(varyByOptions(c, "Node fill")).toEqual(["— none —", "Start", "Stop"])
			expect(varyByOptions(c, "Node outline")).toEqual(["— none —", "Start", "Stop"])
		}
	})

	it("keeps a variable picked on another chart type listed, so it can be cleared", () => {
		const c = mount(<OpacityOptionsPanel />, FLOW, {
			...SANKEY,
			opacitySlots: { border: { field: "Carrier", level: 1 } },
		} as ChannelConfigs)
		expect(varyByOptions(c, "Node outline")).toEqual([
			"— none —",
			"Start",
			"Stop",
			"Carrier",
		])
	})
})

describe("Vary by everywhere else — every column the channel accepts", () => {
	it("Opacity → Point outline on a scatter lists all four", () => {
		const c = mount(<OpacityOptionsPanel />, SCATTER, EMPTY_CHANNEL_CONFIGS)
		expect(varyByOptions(c, "Point outline")).toEqual([
			"— none —",
			"Start",
			"Stop",
			"Value",
			"Carrier",
		])
	})
})
