import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { DataLabelsPanel } from "./DataLabelsPanel"

/** "Label all facets" under Label selection and overlap: shown only on
 *  faceted charts, checked by default (facetKeys null = every panel), and
 *  unchecking lists the facet panels so the user ticks which keep labels. */

const DATASET_ID = "ds-labels-facets"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
			{ name: "g", inferredType: "categorical" },
		],
		rows: [
			{ x: "1", y: "10", g: "A" },
			{ x: "2", y: "20", g: "B" },
			{ x: "3", y: "30", g: "C" },
		],
	})

const mountPanel = (opts: {
	faceted: boolean
	cfg?: Partial<DataLabelsConfig>
}) => {
	const store = installInMemoryLocalStorage()
	const encodings: Encodings = {
		...emptyEncodings(),
		x: { field: "x" },
		y: { field: "y" },
		...(opts.faceted ? { facet: { field: "g" } } : {}),
	}
	const dataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		x: { field: "x" },
		y: { field: "y" },
		value: { field: "y" },
	}
	const cfg: DataLabelsConfig = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...(opts.cfg ?? {}),
	}
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify(dataLabelsEncodings)
	)
	store.set("vis-components:currentDataLabelsConfig", JSON.stringify(cfg))
	/* eslint-enable @th/use-wrapped-json-functions */

	let snapRef: TestStore | null = null
	const init = (snap: TestStore) => {
		snapRef = snap
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, dataLabelsEncodings)
		snap.set(currentDataLabelsConfigAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

	const { container } = render(
		<TestProvider initializeState={init}>
			<DataLabelsPanel />
		</TestProvider>
	)
	return {
		container,
		readCfg: () => snapRef!.get(currentDataLabelsConfigAtom),
	}
}

const sectionHeader = (container: HTMLElement, title: string) =>
	[...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) =>
			b.getAttribute("aria-expanded") !== null &&
			b.textContent?.trim() === title
	) ?? null

const expandSelection = (container: HTMLElement) => {
	const header = sectionHeader(container, "Label selection and overlap")
	expect(header).not.toBeNull()
	fireEvent.click(header!)
}

/** The checkbox whose <label> text is exactly `text`. */
const checkboxLabeled = (container: HTMLElement, text: string) => {
	const label = [...container.querySelectorAll("label")].find(
		(l) => l.textContent?.trim() === text
	)
	if (!label) return null
	const input =
		label.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
		(label.htmlFor
			? container.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)
			: null)
	return input
}

describe("DataLabelsPanel — Label all facets", () => {
	afterEach(cleanup)

	it("is hidden on an unfaceted chart", () => {
		const { container } = mountPanel({ faceted: false })
		expandSelection(container)
		expect(container.textContent).toContain("Avoid overlapping labels")
		expect(container.textContent).not.toContain("Label all facets")
	})

	it("shows checked by default on a faceted chart, right after Avoid overlapping labels", () => {
		const { container } = mountPanel({ faceted: true })
		expandSelection(container)
		const text = container.textContent ?? ""
		const avoidAt = text.indexOf("Avoid overlapping labels")
		const allAt = text.indexOf("Label all facets")
		expect(avoidAt).toBeGreaterThan(-1)
		expect(allAt).toBeGreaterThan(avoidAt)
		const toggle = checkboxLabeled(container, "Label all facets")
		expect(toggle?.checked).toBe(true)
		// No per-facet list while every facet is labeled.
		expect(checkboxLabeled(container, "A")).toBeNull()
	})

	it("unchecking lists every facet (all ticked) and stores the full key list", () => {
		const { container, readCfg } = mountPanel({ faceted: true })
		expandSelection(container)
		fireEvent.click(checkboxLabeled(container, "Label all facets")!)
		expect(readCfg().facetKeys).toEqual(["A", "B", "C"])
		for (const key of ["A", "B", "C"]) {
			expect(checkboxLabeled(container, key)?.checked).toBe(true)
		}
	})

	it("unticking a facet removes it; re-checking Label all facets clears to null", () => {
		const { container, readCfg } = mountPanel({
			faceted: true,
			cfg: { facetKeys: ["A", "B", "C"] },
		})
		expandSelection(container)
		expect(checkboxLabeled(container, "Label all facets")?.checked).toBe(false)
		fireEvent.click(checkboxLabeled(container, "B")!)
		expect(readCfg().facetKeys).toEqual(["A", "C"])
		fireEvent.click(checkboxLabeled(container, "Label all facets")!)
		expect(readCfg().facetKeys).toBeNull()
	})
})
