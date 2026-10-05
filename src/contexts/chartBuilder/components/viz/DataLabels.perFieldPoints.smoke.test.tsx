import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
} from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Per-variable "Which labels" on a STACKED BAR chart — the recipe the user
 *  asked for: every slice labeled with its value, and the series name on
 *  the outside of the last bar only. Multi-field labels used to be a
 *  row-path (scatter / line) feature; bars pre-formatted a single value and
 *  ignored the templates AND the per-field formats. Mounted through the
 *  production path (ChartCanvas → PlotCanvas → BarPlot → DataLabelsLayer). */

const DATASET_ID = "ds-per-field-points"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "bars",
		filename: "bars.csv",
		fields: [
			{ name: "category", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
			{ name: "series", inferredType: "categorical" },
		],
		// Decimal shares so the per-field percent format is observable.
		rows: [
			{ category: "A", value: "0.1", series: "x" },
			{ category: "A", value: "0.2", series: "y" },
			{ category: "B", value: "0.15", series: "x" },
			{ category: "B", value: "0.25", series: "y" },
		],
	})

const seed = (labelsCfg: Partial<DataLabelsConfig>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "category" },
			length: { field: "value" },
			hue: { field: "series" },
		})
	)
	store.set("vis-components:currentChannelConfigs", JSON.stringify({}))
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify({
			...emptyDataLabelsEncodings(),
			x: { field: "category" },
			y: { field: "value" },
			value: { field: null, multiField: true, fields: ["value", "series"] },
		})
	)
	store.set(
		"vis-components:currentDataLabelsConfig",
		JSON.stringify({ ...DEFAULT_DATA_LABELS_CONFIG, ...labelsCfg })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

/** DataLabelsLayer wraps its labels in `<g aria-hidden pointer-events>`;
 *  filtering on that wrapper excludes axis tick labels. */
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
const x = (t: Element | undefined) => Number(t?.getAttribute("x") ?? NaN)

describe("Data labels — per-variable 'Which labels' on stacked bars", () => {
	it("labels every slice with the value and adds the series name on the last bar only", () => {
		seed({
			fieldFormats: { value: ".0%" },
			fieldLabelPoints: { series: "last" },
			lastLabel: { xOffset: 20, alignment: "left" },
		})
		const { container } = mount()
		// Four value labels (percent-formatted through the per-field spec)
		// plus one series-name label per series at the rightmost category.
		expect(texts(container)).toEqual(
			["10%", "20%", "15%", "25%", "x", "y"].sort()
		)
		const labels = renderedDataLabels(container)
		const byText = new Map(
			labels.map((t) => [t.textContent?.trim() ?? "", t] as const)
		)
		// The series-name labels take the last-label override: left-aligned
		// (text-anchor start) and pushed 20px right of their slice center,
		// while the value labels on the same slices keep the base styling.
		expect(byText.get("x")?.getAttribute("text-anchor")).toBe("start")
		expect(byText.get("15%")?.getAttribute("text-anchor")).toBe("middle")
		expect(x(byText.get("x"))).toBeCloseTo(x(byText.get("15%")) + 20, 5)
		expect(x(byText.get("y"))).toBeCloseTo(x(byText.get("25%")) + 20, 5)
	})

	it("a layer-wide 'last' with no per-field modes composes the full template on the last bar", () => {
		// Legacy multi-field save: both fields fall back to labelPoints, so the
		// one population shows the shared arrangement (fields joined).
		seed({ labelPoints: "last", fieldFormats: { value: ".0%" } })
		const { container } = mount()
		expect(texts(container)).toEqual(["15%, x", "25%, y"])
	})

	it("'all' for every field labels each slice with the arrangement", () => {
		seed({ labelTemplate: "{series}: {value}", fieldFormats: { value: ".0%" } })
		const { container } = mount()
		expect(texts(container)).toEqual(
			["x: 10%", "y: 20%", "x: 15%", "y: 25%"].sort()
		)
	})
})
