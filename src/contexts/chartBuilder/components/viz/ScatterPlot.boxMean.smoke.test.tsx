import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
// Axis titles seeded cleared (""): jsdom gives the chart a tiny fallback
// canvas, and the default field-name titles would squeeze the plot area
// these mark-geometry assertions measure down to nothing.
import { emptyEncodings, type Dataset, type Encodings } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** The box plot's "Mark mean" draws one scatter-styled point per box at the
 *  category's mean — only while the box is on AND the underlying points are
 *  hidden (with them visible the mean would be lost among them). */

const DATASET_ID = "ds-box-mean"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [
			{ name: "group", inferredType: "categorical" },
			{ name: "score", inferredType: "quantitative" },
		],
		// Group A averages 2, group B averages 20.
		rows: [
			{ group: "A", score: "1" },
			{ group: "A", score: "2" },
			{ group: "A", score: "3" },
			{ group: "B", score: "10" },
			{ group: "B", score: "20" },
			{ group: "B", score: "30" },
		],
	})

const seed = (
	encodings: Partial<Encodings>,
	valueAxis: "x" | "y",
	overlay: Record<string, unknown>
) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", { ...emptyEncodings(), ...encodings })
	set("vis-components:currentChannelConfigs", {
		[valueAxis]: {
			...DEFAULT_AXIS_CONFIG,
			distributionOverlay: {
				...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
				showBoxPlot: true,
				showPoints: false,
				markMean: true,
				...overlay,
			},
		},
	})
	set("vis-components:currentLabels", { _v: 1, data: { ...DEFAULT_LABELS_CONFIG, xAxisTitle: "", yAxisTitle: "" } })
	/* eslint-enable no-restricted-globals, @vc/no-storage-outside-try, @vc/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

const meanMarks = (container: HTMLElement) =>
	[...container.querySelectorAll("[data-box-mean] path")]

const translateY = (el: Element): number => {
	const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute("transform") ?? "")
	expect(m).toBeTruthy()
	return Number(m![2])
}

describe("box-plot Mark mean", () => {
	it("draws one point per box at the category mean on a strip plot", () => {
		seed({ x: { field: "group" }, y: { field: "score" } }, "y", {})
		const marks = meanMarks(mount().container)
		expect(marks).toHaveLength(2)
		// Value on y: A's mean (2) is lower on the chart (larger y) than B's (20).
		const [a, b] = marks as [Element, Element]
		expect(translateY(a)).toBeGreaterThan(translateY(b))
	})

	it("draws a single point for a lone quantitative variable", () => {
		seed({ x: { field: "score" } }, "x", {})
		expect(meanMarks(mount().container)).toHaveLength(1)
	})

	it("draws nothing while the data points are shown", () => {
		seed({ x: { field: "group" }, y: { field: "score" } }, "y", { showPoints: true })
		expect(meanMarks(mount().container)).toHaveLength(0)
	})

	it("draws nothing when the option is off", () => {
		seed({ x: { field: "group" }, y: { field: "score" } }, "y", { markMean: false })
		expect(meanMarks(mount().container)).toHaveLength(0)
	})
})
