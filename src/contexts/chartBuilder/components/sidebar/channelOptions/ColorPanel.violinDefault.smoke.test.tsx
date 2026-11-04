import { fireEvent, render, within } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../../lib/types"
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

/** An untouched Violin / box fill or outline has no "Auto" option: it shows
 *  the Color-following default it draws — "Vary by" the Color variable
 *  (see `defaultColorSlot`). */

const ID = "ds-violin-slot-default"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "group", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
		],
		rows: ["A", "B"].flatMap((group) =>
			Array.from({ length: 4 }, (_, i) => ({ group, score: String(i + 1) }))
		),
	})

const enc = {
	...emptyEncodings(),
	x: { field: "group" },
	y: { field: "score" },
	hue: { field: "group" },
}
const BOX: ChannelConfigs = {
	...EMPTY_CHANNEL_CONFIGS,
	y: {
		...DEFAULT_AXIS_CONFIG,
		distributionOverlay: { ...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG, showBoxPlot: true },
	},
}

const mount = (panel: React.ReactNode, cfg: ChannelConfigs) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", enc)
	set("vis-components:currentChannelConfigs", cfg)
	/* eslint-enable @vc/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, enc)
		snap.set(currentChannelConfigsAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(<TestProvider initializeState={init}>{panel}</TestProvider>)
}

/** The "Vary by" select inside the named Color subsection, expanded. */
const varyBy = (c: HTMLElement, title: string): HTMLSelectElement => {
	const header = [...c.querySelectorAll("button[aria-expanded]")].find(
		(b) => b.textContent?.trim() === title
	) as HTMLButtonElement
	if (header.getAttribute("aria-expanded") === "false") fireEvent.click(header)
	const section = header.closest("[data-jump-id], section, div") as HTMLElement
	return within(section.parentElement ?? section).getByLabelText(/Vary by/i) as HTMLSelectElement
}

describe("Violin / box color slots, untouched", () => {
	it.each(["Violin / box fill", "Violin / box outline"])(
		"%s varies by the Color variable, with no Auto option",
		(title) => {
			const select = varyBy(mount(<ColorPanel />, BOX).container, title)
			expect(select.value).toBe("group")
			const labels = [...select.options].map((o) => o.textContent)
			expect(labels).not.toContain("Auto")
		}
	)
})

describe("Violin / box color slots, touched", () => {
	it("a stored \"— none —\" outline shows none while the fill keeps its default", () => {
		const cfg = { ...BOX, colorSlots: { violinStroke: { field: null, singleColor: "#000000" } } }
		const { container } = mount(<ColorPanel />, cfg)
		expect(varyBy(container, "Violin / box outline").value).toBe("")
		expect(varyBy(container, "Violin / box fill").value).toBe("group")
	})
})
