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
 *  Adjust position (with a ring-relative polar pair, no per-series
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
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	/* eslint-enable @vc/use-wrapped-json-functions */

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

	it("sunburst shows Box and Position and alignment; no empty Label selection", () => {
		const c = mountPanel("sunburst")
		expect(sectionHeader(c, "Box")).not.toBeNull()
		expect(sectionHeader(c, "Position and alignment")).not.toBeNull()
		// Unfaceted sunburst: no series ends, no facets, not a map or flow —
		// Label selection would be empty, so it is skipped.
		expect(sectionHeader(c, "Label selection")).toBeNull()
		// Position rows stay hidden — the layout places labels.
		expect(c.textContent).not.toContain("X position")
	})

	it("sunburst hides the per-series 'Which labels' select but keeps Avoid overlaps", () => {
		const c = mountPanel("sunburst")
		expect(c.textContent).not.toContain("Which labels")
		// Overlap avoidance lives with the placement knobs.
		expand(c, "Position and alignment")
		expect(c.textContent).toContain("Avoid overlapping labels")
	})

	it("sunburst Adjust position carries the ring-relative Angle / R pair plus X / Y", () => {
		const c = mountPanel("sunburst")
		expand(c, "Position and alignment")
		const inputs = [...c.querySelectorAll<HTMLInputElement>("input")]
		// R defaults to 50 (the ring's middle), not the pie's 100 (the rim).
		expect(inputs.some((i) => i.value === "50")).toBe(true)
		expect(c.textContent).toContain("Align")
		expect(c.textContent).toContain("Wrap text")
	})

	it("sunburst Align offers the outward option", () => {
		const c = mountPanel("sunburst")
		expand(c, "Position and alignment")
		expect(
			c.querySelectorAll('button[aria-label^="Align outward"]')
		).toHaveLength(1)
	})

	it("the treemap keeps the fine-tuning hidden (self-drawn labels)", () => {
		const c = mountPanel("treemap")
		expect(sectionHeader(c, "Box")).toBeNull()
		expect(sectionHeader(c, "Position and alignment")).toBeNull()
		expect(sectionHeader(c, "Label selection")).toBeNull()
		expect(sectionHeader(c, "Text")).not.toBeNull()
	})

	it("packed circles show the Box and position fine-tuning (shared layer)", () => {
		const c = mountPanel("pack")
		expect(sectionHeader(c, "Box")).not.toBeNull()
		expect(sectionHeader(c, "Position and alignment")).not.toBeNull()
	})
})

describe("DataLabelsPanel — tree layouts label by name by default", () => {
	afterEach(() => cleanup())
	const selectFor = (container: HTMLElement, label: string) => {
		const lbl = [...container.querySelectorAll("label")].find(
			(l) => l.textContent?.trim() === label
		)
		const id = lbl?.getAttribute("for")
		return id
			? container.querySelector<HTMLSelectElement>(`select[id="${CSS.escape(id)}"]`)
			: null
	}

	it("an unset Value shows the name column selected; — none — sticks", () => {
		const c = mountPanel("pack")
		// No Child value reappears as a Parent, so the tree groups one level
		// by Parent — the column that names its nodes.
		expect(selectFor(c, "Value")?.value).toBe("Parent")
		fireEvent.change(selectFor(c, "Value")!, { target: { value: "" } })
		expect(selectFor(c, "Value")?.value).toBe("")
	})
})
