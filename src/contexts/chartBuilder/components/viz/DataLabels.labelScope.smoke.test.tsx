import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_BRIGHTNESS_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** "Which labels" scope on bars, through the production path (ChartCanvas →
 *  PlotCanvas → BarPlot → DataLabelsLayer).
 *
 *  Grouped case = the CCI chart shape: x = Setting, hue = Setting (cosmetic),
 *  brightness = level, GROUPED. "First" must label every bar of the first
 *  setting (series scope) or the first bar of every setting (group scope) —
 *  never depend on hue sharing the x field.
 *  Stacked case: x = Setting, hue = level stacked. "First" / "Last" of each
 *  stack = the baseline / top layer of every bar. */

const DATASET_ID = "ds-label-scope"
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
		rows: settings.flatMap((s) =>
			levels.map((l, i) => ({ Setting: s, level: l, value: String(10 + i) }))
		),
	})

const seed = (
	layout: "grouped" | "stacked" | "pies",
	labelsCfg: Partial<DataLabelsConfig>
) => {
	const store = installInMemoryLocalStorage()
	const encodings: Encodings =
		layout === "grouped"
			? {
					...emptyEncodings(),
					x: { field: "Setting" },
					length: { field: "value" },
					hue: { field: "Setting" },
					brightness: { field: "level" },
				}
			: layout === "pies"
				? {
						...emptyEncodings(),
						x: { field: "Setting" },
						angle: { field: "value" },
						hue: { field: "level" },
					}
				: {
						...emptyEncodings(),
						x: { field: "Setting" },
						length: { field: "value" },
						hue: { field: "level" },
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
		"vis-components:currentChannelConfigs",
		JSON.stringify(
			layout === "grouped"
				? {
						hue: { kind: "categorical", colors: {}, stackMode: "group" },
						brightness: { ...DEFAULT_BRIGHTNESS_CONFIG, stackMode: "group" },
					}
				: {}
		)
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify({
			...emptyDataLabelsEncodings(),
			x: { field: "Setting" },
			y: { field: "value" },
			value: { field: "level", multiField: false, fields: [] },
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
const num = (t: Element, attr: "x" | "y") => Number(t.getAttribute(attr) ?? NaN)

describe("Data labels — 'Which labels' scope on bars", () => {
	it("grouped, hue = x: 'First' labels every bar of the first setting (series scope)", () => {
		seed("grouped", { labelPoints: "all" })
		const all = mount()
		// Each level appears once per setting; the Home copy sits left.
		const homeX = new Map(
			levels.map((l) => [
				l,
				Math.min(
					...renderedDataLabels(all.container)
						.filter((t) => t.textContent?.trim() === l)
						.map((t) => num(t, "x"))
				),
			])
		)
		all.unmount()

		seed("grouped", { labelPoints: "first" })
		const { container } = mount()
		expect(texts(container)).toEqual(["a", "b", "c"])
		for (const t of renderedDataLabels(container)) {
			expect(num(t, "x")).toBeCloseTo(homeX.get(t.textContent?.trim() ?? "") ?? NaN, 5)
		}
	})

	it("grouped: 'First' of each group labels the first bar of every setting", () => {
		seed("grouped", { labelPoints: "first", labelPointsScope: "group" })
		const { container } = mount()
		expect(texts(container)).toEqual(["a", "a"])
	})

	it("stacked: 'First' / 'Last' of each stack label the baseline / top layer of every bar", () => {
		seed("stacked", { labelPoints: "first", labelPointsScope: "stack" })
		const first = mount()
		expect(texts(first.container)).toEqual(["a", "a"])
		const baseY = num(renderedDataLabels(first.container)[0] as Element, "y")
		first.unmount()

		seed("stacked", { labelPoints: "last", labelPointsScope: "stack" })
		const last = mount()
		expect(texts(last.container)).toEqual(["c", "c"])
		// SVG y grows downward: the top layer's label sits above the baseline's.
		expect(num(renderedDataLabels(last.container)[0] as Element, "y")).toBeLessThan(baseY)
	})

	it("several pies: 'First' labels every wedge of the first pie; 'First' of each pie labels the first wedge of every pie", () => {
		seed("pies", { labelPoints: "first" })
		const first = mount()
		expect(texts(first.container)).toEqual(["a", "b", "c"])
		first.unmount()

		seed("pies", { labelPoints: "first", labelPointsScope: "stack" })
		const { container } = mount()
		expect(texts(container)).toEqual(["a", "a"])
	})

	it("stacked: 'stack' scope stored on an unstacked chart reads as series", () => {
		// Grouped bars have no layer channel: "stack" falls back to "series",
		// labeling every bar of the first setting.
		seed("grouped", { labelPoints: "first", labelPointsScope: "stack" })
		const { container } = mount()
		expect(texts(container)).toEqual(["a", "b", "c"])
	})
})
