import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { BAR_LABEL_EDGE_PAD_PX } from "../../lib/dataLabelsLayout"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
// Axis titles seeded cleared (""): jsdom gives the chart a tiny fallback
// canvas, and the default field-name titles would squeeze the plot area
// these mark-geometry assertions measure down to nothing.
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** "Bar side" through the production path (ChartCanvas → PlotCanvas →
 *  BarPlot → DataLabelsLayer): a stacked bar labeled with its level names
 *  BESIDE the bar. Each label must start exactly the pad past the bar's
 *  right edge with its text hanging rightward — whatever Alignment and
 *  series-end alignment the config carries — and an X nudge measures from
 *  that edge. Position values are read off the SVG attributes (the
 *  headless DOM has no layout boxes). */

const DATASET_ID = "ds-bar-side"
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
	labelsCfg: Partial<DataLabelsConfig>,
	value: { field: string | null; multiField: boolean; fields: string[] } = {
		field: "level",
		multiField: false,
		fields: [],
	}
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

const dataLabels = (container: HTMLElement) =>
	[
		...container.querySelectorAll(
			'g[aria-hidden="true"][pointer-events="none"]'
		),
	].flatMap((g) => [...g.querySelectorAll("text")])

const num = (el: Element, attr: string) => Number(el.getAttribute(attr) ?? NaN)

/** Right edge of the widest-reaching bar slice: `x + width` over the bar
 *  rects (the ones whose parent group carries the chart's slices). */
const barRightEdges = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.filter((r) => r.getAttribute("fill")?.startsWith("#") && num(r, "height") > 0)
		.map((r) => num(r, "x") + num(r, "width"))

describe("Data labels — Bar side on stacked bars", () => {
	it("'after' starts every label the pad past its bar's right edge, text hanging right", () => {
		seed({ barLabelSide: "after", alignment: "right", xOffset: 0 })
		const { container } = mount()
		const labels = dataLabels(container)
		expect(labels.map((t) => t.textContent?.trim()).sort()).toEqual([
			"a",
			"a",
			"b",
			"b",
			"c",
			"c",
		])
		const edges = new Set(barRightEdges(container).map((e) => e.toFixed(3)))
		for (const t of labels) {
			// The forced alignment: the stored "right" is overridden.
			expect(t.getAttribute("text-anchor")).toBe("start")
			const edge = num(t, "x") - BAR_LABEL_EDGE_PAD_PX
			expect(edges.has(edge.toFixed(3))).toBe(true)
		}
	})

	it("an X nudge measures from the bar's edge, not its center", () => {
		seed({ barLabelSide: "after", xOffset: 0 })
		const plain = mount()
		const plainX = dataLabels(plain.container).map((t) => num(t, "x"))
		plain.unmount()

		seed({ barLabelSide: "after", xOffset: 12 })
		const nudged = mount()
		const nudgedX = dataLabels(nudged.container).map((t) => num(t, "x"))
		expect(nudgedX).toHaveLength(plainX.length)
		nudgedX.forEach((x, i) => expect(x - plainX[i]).toBeCloseTo(12, 5))
	})

	it("'before' ends every label the pad before its bar's left edge", () => {
		seed({ barLabelSide: "before", alignment: "left" })
		const { container } = mount()
		const lefts = new Set(
			[...container.querySelectorAll("rect")]
				.filter((r) => r.getAttribute("fill")?.startsWith("#") && num(r, "height") > 0)
				.map((r) => num(r, "x").toFixed(3))
		)
		const labels = dataLabels(container)
		expect(labels).toHaveLength(6)
		for (const t of labels) {
			expect(t.getAttribute("text-anchor")).toBe("end")
			expect(lefts.has((num(t, "x") + BAR_LABEL_EDGE_PAD_PX).toFixed(3))).toBe(true)
		}
	})

	it("a series-end alignment override can't undo the side", () => {
		seed({
			barLabelSide: "after",
			labelPoints: "last",
			labelPointsScope: "stack",
			lastLabel: { alignment: "right" },
		})
		const { container } = mount()
		const labels = dataLabels(container)
		expect(labels.map((t) => t.textContent?.trim())).toEqual(["c", "c"])
		for (const t of labels) expect(t.getAttribute("text-anchor")).toBe("start")
	})
})

describe("Data labels — per-variable placement with separate variables", () => {
	const seedSeparate = (labelsCfg: Partial<DataLabelsConfig>) =>
		seed(labelsCfg, { field: null, multiField: true, fields: ["level", "value"] })

	it("the level sits beside the bar while the value stays centered inside it", () => {
		seedSeparate({
			combineVariables: false,
			fieldBarPlacements: { level: { side: "after" } },
		})
		const { container } = mount()
		const labels = dataLabels(container)
		const levelLabels = labels.filter((t) => levels.includes(t.textContent?.trim() ?? ""))
		const valueLabels = labels.filter((t) => /^\d+$/.test(t.textContent?.trim() ?? ""))
		expect(levelLabels).toHaveLength(6)
		expect(valueLabels).toHaveLength(6)
		const edges = new Set(barRightEdges(container).map((e) => e.toFixed(3)))
		for (const t of levelLabels) {
			expect(t.getAttribute("text-anchor")).toBe("start")
			expect(edges.has((num(t, "x") - BAR_LABEL_EDGE_PAD_PX).toFixed(3))).toBe(true)
		}
		// Values keep the layer's centered placement: band centers, middle anchor.
		const centers = new Set(
			[...container.querySelectorAll("rect")]
				.filter((r) => r.getAttribute("fill")?.startsWith("#") && num(r, "height") > 0)
				.map((r) => (num(r, "x") + num(r, "width") / 2).toFixed(3))
		)
		for (const t of valueLabels) {
			expect(t.getAttribute("text-anchor")).toBe("middle")
			expect(centers.has(num(t, "x").toFixed(3))).toBe(true)
		}
	})
})
