import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	DEFAULT_FACET_CONFIG,
	type PanelBorderConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import type { PlotInner } from "../../lib/plotLayout"
import { emptyEncodings, type Dataset } from "../../lib/types"
import { ScatterPlot } from "./ScatterPlot"

/** Aesthetics → Chart background → "Draw panel border": one closed
 *  rectangle stroked around the panel's inner plot rect. */

const DATASET_ID = "ds-panel-border"

const dataset: Dataset = {
	id: DATASET_ID,
	name: "scatter",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "s.csv",
			rows: [
				{ x: "1", y: "10" },
				{ x: "2", y: "20" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
}

const INNER: PlotInner = { x0: 50, y0: 20, x1: 550, y1: 400 }

const seed = (panelBorder: PanelBorderConfig | undefined) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: dataset }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({ ...emptyEncodings(), x: { field: "x" }, y: { field: "y" } })
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			facet: DEFAULT_FACET_CONFIG,
			...(panelBorder === undefined ? {} : { panelBorder }),
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<svg width={600} height={420}>
				<ScatterPlot inner={INNER} />
			</svg>
		</TestProvider>
	)

describe("Plot — panel border", () => {
	it("draws nothing for a chart saved before the setting existed", () => {
		seed(undefined)
		const { container } = mount()
		expect(container.querySelector("[data-panel-border]")).toBeNull()
	})

	it("draws nothing while the checkbox is off", () => {
		seed({ enabled: false, width: 2, color: "#ff0000" })
		const { container } = mount()
		expect(container.querySelector("[data-panel-border]")).toBeNull()
	})

	it("strokes the inner plot rect with the chosen width and color", () => {
		seed({ enabled: true, width: 2, color: "#ff0000" })
		const { container } = mount()
		const rect = container.querySelector("[data-panel-border]")
		expect(rect).not.toBeNull()
		expect(rect!.getAttribute("x")).toBe("50")
		expect(rect!.getAttribute("y")).toBe("20")
		expect(rect!.getAttribute("width")).toBe("500")
		expect(rect!.getAttribute("height")).toBe("380")
		expect(rect!.getAttribute("fill")).toBe("none")
		expect(rect!.getAttribute("stroke")).toBe("#ff0000")
		expect(rect!.getAttribute("stroke-width")).toBe("2")
	})
})
