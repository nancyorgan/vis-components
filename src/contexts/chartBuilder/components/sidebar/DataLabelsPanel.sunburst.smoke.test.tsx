import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import { type ChannelConfigs } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { DataLabelsPanel } from "./DataLabelsPanel"

/** Tree layouts hide the Data Labels position rows (the layout places
 *  labels), but the fine-tuning subsections differ by layout: the sunburst
 *  renders through the shared label layer, so it keeps selection / overlap,
 *  Position Adjustment (with a ring-relative polar pair, no per-series
 *  "Which labels"), and Text Background; packed circles / treemap draw
 *  their own labels and keep those subsections hidden. */

const DATASET_ID = "ds-hier-panel"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "fruit",
		filename: "fruit.csv",
		fields: [
			{ name: "Parent", inferredType: "categorical" },
			{ name: "Child", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
		],
		rows: [
			{ Parent: "Pome", Child: "Apple", Value: "7" },
			{ Parent: "Pome", Child: "Pear", Value: "7" },
			{ Parent: "Citrus", Child: "Lemon", Value: "8" },
		],
	})

const mountPanel = (layout: "treemap" | "sunburst" | "pack") => {
	const store = installInMemoryLocalStorage()
	const encodings = {
		...emptyEncodings(),
		connection: { field: "Parent" },
		area: { field: "Value" },
	}
	const configs: ChannelConfigs = {
		connection: { hierarchyLayout: layout } as never,
	}
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	/* eslint-enable @th/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

	const { container } = render(
		<TestProvider initializeState={init}>
			<DataLabelsPanel />
		</TestProvider>
	)
	return container
}

// CollapsibleSubsection renders the title as the header button's only text
// (chevron + changed-dot are textless), so trimmed textContent finds it.
const sectionHeader = (container: HTMLElement, title: string) =>
	[...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) =>
			b.getAttribute("aria-expanded") !== null &&
			b.textContent?.trim() === title
	) ?? null

const expand = (container: HTMLElement, title: string) => {
	const header = sectionHeader(container, title)
	expect(header, `subsection header "${title}"`).not.toBeNull()
	fireEvent.click(header!)
}

describe("DataLabelsPanel — sunburst fine-tuning", () => {
	afterEach(cleanup)

	it("sunburst shows Text Background, Position Adjustment, and selection/overlap", () => {
		const c = mountPanel("sunburst")
		expect(sectionHeader(c, "Text Background")).not.toBeNull()
		expect(sectionHeader(c, "Position Adjustment and Alignment")).not.toBeNull()
		expect(sectionHeader(c, "Label selection and overlap")).not.toBeNull()
		// Position rows stay hidden — the layout places labels.
		expect(c.textContent).not.toContain("X position")
		expect(c.textContent).toContain("fine-tune placement")
	})

	it("sunburst hides the per-series 'Which labels' select but keeps Avoid overlaps", () => {
		const c = mountPanel("sunburst")
		expand(c, "Label selection and overlap")
		expect(c.textContent).not.toContain("Which labels")
		expect(c.textContent).toContain("Avoid overlapping labels")
	})

	it("sunburst Adjust position carries the ring-relative Angle / R pair plus X / Y", () => {
		const c = mountPanel("sunburst")
		expand(c, "Position Adjustment and Alignment")
		expect(c.textContent).toContain("percent of the ring")
		const inputs = [...c.querySelectorAll<HTMLInputElement>("input")]
		// R defaults to 50 (the ring's middle), not the pie's 100 (the rim).
		expect(inputs.some((i) => i.value === "50")).toBe(true)
		expect(c.textContent).toContain("Alignment")
		expect(c.textContent).toContain("Wrap text")
	})

	it("treemap and packed circles keep the fine-tuning hidden (self-drawn labels)", () => {
		for (const layout of ["treemap", "pack"] as const) {
			const c = mountPanel(layout)
			expect(sectionHeader(c, "Text Background")).toBeNull()
			expect(sectionHeader(c, "Position Adjustment and Alignment")).toBeNull()
			expect(sectionHeader(c, "Label selection and overlap")).toBeNull()
			expect(sectionHeader(c, "Text Properties")).not.toBeNull()
			cleanup()
		}
	})
})
