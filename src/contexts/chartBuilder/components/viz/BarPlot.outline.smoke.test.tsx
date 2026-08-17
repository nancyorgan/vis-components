import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** User reported: the ability to separate stacked-bar segments with an
 *  outline color (Shape > Outline) no longer takes effect. This test
 *  mounts a real stacked bar chart through the production render path
 *  (ChartCanvas → PlotCanvas → BarPlot) and inspects the stroke actually
 *  applied to the mark <rect>s. */

const DATASET_ID = "ds-bar-outline"

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
		rows: [
			{ category: "A", value: "10", series: "x" },
			{ category: "A", value: "20", series: "y" },
			{ category: "B", value: "15", series: "x" },
			{ category: "B", value: "25", series: "y" },
		],
	})

const seed = (shape: Record<string, unknown> | null) => {
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
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify(shape ? { shape } : {})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
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

const markRectStrokes = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.map((r) => ({
			stroke: r.getAttribute("stroke"),
			strokeWidth: r.getAttribute("stroke-width"),
			h: r.getAttribute("height"),
		}))
		// Drop background / non-stroked rects to focus on mark rects.
		.filter((r) => r.stroke !== null)

describe("BarPlot — stack outline (Shape > Outline)", () => {
	it("strokes each stack segment with the configured outline color/width", () => {
		seed({ outlineColor: "#ff0000", outlineWidth: 3 })
		const { container } = mount()
		const strokes = markRectStrokes(container)
		const outlined = strokes.filter(
			(s) => s.stroke === "#ff0000" && s.strokeWidth === "3"
		)
		expect(outlined.length).toBeGreaterThanOrEqual(4)
	})

	it("uses default white 1px outline when shape config is empty", () => {
		seed(null)
		const { container } = mount()
		const strokes = markRectStrokes(container)
		const outlined = strokes.filter(
			(s) => s.stroke === "#ffffff" && s.strokeWidth === "1"
		)
		expect(outlined.length).toBeGreaterThanOrEqual(4)
	})
})
