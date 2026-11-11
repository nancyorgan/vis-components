import { cleanup, fireEvent, render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"

import {
	DEFAULT_CATEGORICAL_HUE_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type DataLabelsEncodings,
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
import { ChartCanvas } from "../viz/ChartCanvas"

import { DataLabelsPanel } from "./DataLabelsPanel"

/** Data labels show on bars when turned on: picking a Value on a bar chart
 *  sets the value-axis label position to the Length variable (Y on vertical
 *  bars, X on horizontal), so the labels draw at once. */

const DATASET_ID = "ds-labels-bar-position"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "bars",
		fields: [
			{ name: "cat", inferredType: "categorical" },
			{ name: "level", inferredType: "categorical" },
			{ name: "val", inferredType: "quantitative" },
			{ name: "other", inferredType: "quantitative" },
		],
		rows: [
			{ cat: "A", level: "a", val: "10", other: "1" },
			{ cat: "A", level: "b", val: "20", other: "2" },
			{ cat: "B", level: "a", val: "5", other: "3" },
		],
	})

const VERTICAL: Encodings = { ...emptyEncodings(), x: { field: "cat" }, length: { field: "val" } }

const mount = (opts: {
	encodings: Encodings
	configs?: ChannelConfigs
	labels?: Partial<DataLabelsEncodings>
	withChart?: boolean
}) => {
	installInMemoryLocalStorage()
	let store: TestStore | null = null
	const init = (snap: TestStore) => {
		store = snap
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, opts.encodings)
		snap.set(currentChannelConfigsAtom, opts.configs ?? EMPTY_CHANNEL_CONFIGS)
		// Axis titles cleared: jsdom's small fallback canvas would otherwise
		// squeeze the plot the labels draw in.
		snap.set(currentLabelsAtom, { ...DEFAULT_LABELS_CONFIG, xAxisTitle: "", yAxisTitle: "" })
		snap.set(currentDataLabelsEncodingsAtom, { ...emptyDataLabelsEncodings(), ...opts.labels })
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const { container } = render(
		<TestProvider initializeState={init}>
			<DataLabelsPanel />
			{opts.withChart ? (
				<div data-testid="chart" style={{ width: 800, height: 600 }}>
					<ChartCanvas />
				</div>
			) : null}
		</TestProvider>
	)
	return { container, labels: () => store!.get(currentDataLabelsEncodingsAtom) }
}

const selectLabeled = (container: HTMLElement, text: string) => {
	const label = [...container.querySelectorAll("label")].find(
		(l) => l.textContent?.trim() === text
	)
	return label?.htmlFor
		? container.querySelector<HTMLSelectElement>(`#${CSS.escape(label.htmlFor)}`)
		: null
}

const pickValue = (container: HTMLElement, field: string) =>
	fireEvent.change(selectLabeled(container, "Value")!, { target: { value: field } })

const labelTexts = (container: HTMLElement) => {
	const chart = container.querySelector('[data-testid="chart"]')!
	return [...chart.querySelectorAll('g[aria-hidden="true"][pointer-events="none"] text')]
		.map((t) => t.textContent?.trim() ?? "")
		.filter(Boolean)
		.sort()
}

afterEach(cleanup)

describe("DataLabelsPanel — labels on bars draw when turned on", () => {
	it("vertical bars: picking a Value sets Y to the Length variable", () => {
		const { container, labels } = mount({ encodings: VERTICAL })
		pickValue(container, "val")
		expect(labels().y).toEqual({ field: "val" })
	})

	it("horizontal bars: picking a Value sets X to the Length variable", () => {
		const { container, labels } = mount({
			encodings: { ...emptyEncodings(), y: { field: "cat" }, length: { field: "val" } },
		})
		pickValue(container, "val")
		expect(labels().x).toEqual({ field: "val" })
	})

	it("a Y the person set (a field, or none) stays", () => {
		const a = mount({ encodings: VERTICAL, labels: { y: { field: "other" } } })
		pickValue(a.container, "val")
		expect(a.labels().y).toEqual({ field: "other" })
		cleanup()
		const b = mount({ encodings: VERTICAL, labels: { y: { field: null, none: true } } })
		pickValue(b.container, "val")
		expect(b.labels().y).toEqual({ field: null, none: true })
	})

	it("a scatter (both axes mapped) is left alone", () => {
		const { container, labels } = mount({
			encodings: { ...emptyEncodings(), x: { field: "val" }, y: { field: "other" } },
		})
		pickValue(container, "val")
		expect(labels().y?.field ?? null).toBeNull()
	})

	it("the chart draws the labels: plain vertical bars", () => {
		const { container } = mount({ encodings: VERTICAL, withChart: true })
		expect(labelTexts(container)).toEqual([])
		pickValue(container, "val")
		// One bar per category: A sums to 30.
		expect(labelTexts(container)).toEqual(["30", "5"])
	})

	it("the chart draws the labels: stacked bars with Color", () => {
		const { container } = mount({
			encodings: { ...VERTICAL, hue: { field: "level" } },
			configs: { ...EMPTY_CHANNEL_CONFIGS, hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, stackMode: "stack" } },
			withChart: true,
		})
		pickValue(container, "val")
		expect(labelTexts(container)).toEqual(["10", "20", "5"])
	})

	it("the chart draws the labels: grouped bars with Color", () => {
		const { container } = mount({
			encodings: { ...VERTICAL, hue: { field: "level" } },
			configs: { ...EMPTY_CHANNEL_CONFIGS, hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, stackMode: "group" } },
			withChart: true,
		})
		pickValue(container, "val")
		expect(labelTexts(container)).toEqual(["10", "20", "5"])
	})
})
