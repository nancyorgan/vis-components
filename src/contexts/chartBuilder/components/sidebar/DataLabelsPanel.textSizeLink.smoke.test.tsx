import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
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
	sidebarJumpTargetAtom,
} from "../../store/atoms"

import { DataLabelsPanel } from "./DataLabelsPanel"

/** Font size lives on the Size row, not under Text: Text carries a note
 *  whose "Size" link opens the Size row's options. */

const DATASET_ID = "ds-labels-text-size-link"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "sales",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
		],
		rows: [
			{ x: "1", y: "10" },
			{ x: "2", y: "20" },
		],
	})

const mountPanel = () => {
	installInMemoryLocalStorage()
	const encodings: Encodings = {
		...emptyEncodings(),
		x: { field: "x" },
		y: { field: "y" },
	}
	const dataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		x: { field: "x" },
		y: { field: "y" },
		value: { field: "y" },
	}
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
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const { container } = render(
		<TestProvider initializeState={init}>
			<DataLabelsPanel />
		</TestProvider>
	)
	return { container, store: () => snapRef! }
}

const buttonNamed = (container: HTMLElement, text: string) =>
	[...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === text
	) ?? null

describe("DataLabelsPanel — Text points to Size for font size", () => {
	afterEach(() => cleanup())

	it("the Text note's Size link opens the Size row's options", () => {
		const { container, store } = mountPanel()
		fireEvent.click(buttonNamed(container, "Text")!)
		expect(container.textContent).toContain("Set the font size under Size.")
		expect(container.textContent).not.toContain("Default size")

		act(() => {
			fireEvent.click(buttonNamed(container, "Size")!)
		})

		expect(container.textContent).toContain("Default size")
		expect(store().get(sidebarJumpTargetAtom)).toBeNull()
	})
})
