import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { BAR_TOTAL_FIELD } from "../../lib/barTotalLabel"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
// Axis titles seeded cleared (""): jsdom gives the chart a tiny fallback
// canvas, and the default field-name titles would squeeze the plot area
// these mark-geometry assertions measure down to nothing.
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type DataLabelsEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** The derived Bar total through the production path (ChartCanvas →
 *  PlotCanvas → BarPlot → DataLabelsLayer) on stacked bars: x = Setting,
 *  hue = level stacked, length = value. Home totals 33, Away 63. */

const DATASET_ID = "ds-label-bar-total"
const settings = ["Home", "Away"]
const levels = ["a", "b", "c"]

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "bars",
		filename: "bars.csv",
		fields: [
			{ name: "Setting", inferredType: "categorical" },
			{ name: "level", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
		],
		rows: settings.flatMap((s, si) =>
			levels.map((l, i) => ({
				Setting: s,
				level: l,
				value: String(10 * (si + 1) + i),
			}))
		),
	})

const seed = (
	value: DataLabelsEncodings["value"],
	labelsCfg: Partial<DataLabelsConfig>
) => {
	const store = installInMemoryLocalStorage()
	const encodings: Encodings = {
		...emptyEncodings(),
		x: { field: "Setting" },
		length: { field: "value" },
		hue: { field: "level" },
	}
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentChannelConfigs", JSON.stringify({}))
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: { ...DEFAULT_LABELS_CONFIG, xAxisTitle: "", yAxisTitle: "" } })
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify({
			...emptyDataLabelsEncodings(),
			x: { field: "Setting" },
			y: { field: "value" },
			value,
		})
	)
	store.set(
		"vis-components:currentDataLabelsConfig",
		JSON.stringify({ ...DEFAULT_DATA_LABELS_CONFIG, ...labelsCfg })
	)
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

const renderedDataLabels = (container: HTMLElement) => {
	const groups = container.querySelectorAll(
		'g[aria-hidden="true"][pointer-events="none"]'
	)
	return [...groups].flatMap((g) => [...g.querySelectorAll("text")])
}
const texts = (container: HTMLElement) =>
	renderedDataLabels(container)
		.map((t) => t.textContent?.trim() ?? "")
		.sort()
const labelY = (container: HTMLElement, text: string) =>
	Number(
		renderedDataLabels(container)
			.find((t) => t.textContent?.trim() === text)
			?.getAttribute("y") ?? NaN
	)

describe("Data labels — the derived Bar total on stacked bars", () => {
	it("as the Value with the seeded selection: one total per bar, the taller bar's higher up", () => {
		seed(
			{ field: BAR_TOTAL_FIELD, multiField: false, fields: [] },
			{
				labelPoints: "last",
				labelPointsScope: "stack",
				barLabelPosition: "outside-end",
			}
		)
		const { container } = mount()
		expect(texts(container)).toEqual(["33", "63"])
		// SVG y grows downward: the 63 bar is taller, so its total sits above.
		expect(labelY(container, "63")).toBeLessThan(labelY(container, "33"))
	})

	it("Multiple variables…: a {value} label on every layer beside a {Bar total} label on each stack's top layer", () => {
		seed(
			{ field: null, multiField: true, fields: ["value", BAR_TOTAL_FIELD] },
			{
				composedLabels: [
					{ id: "value", template: "{value}" },
					{ id: BAR_TOTAL_FIELD, template: `{${BAR_TOTAL_FIELD}}` },
				],
				fieldLabelPoints: { [BAR_TOTAL_FIELD]: "last" },
				fieldLabelPointsScope: { [BAR_TOTAL_FIELD]: "stack" },
				fieldBarPlacements: { [BAR_TOTAL_FIELD]: { position: "outside-end" } },
			}
		)
		const { container } = mount()
		expect(texts(container)).toEqual([
			"10",
			"11",
			"12",
			"20",
			"21",
			"22",
			"33",
			"63",
		])
	})

	it("every layer carries its bar's total, so a combination composes it on each slice", () => {
		seed(
			{ field: null, multiField: true, fields: ["value", BAR_TOTAL_FIELD] },
			{
				composedLabels: [
					{ id: "share", template: `{value} of {${BAR_TOTAL_FIELD}}` },
				],
			}
		)
		const { container } = mount()
		expect(texts(container)).toEqual([
			"10 of 33",
			"11 of 33",
			"12 of 33",
			"20 of 63",
			"21 of 63",
			"22 of 63",
		])
	})
})
