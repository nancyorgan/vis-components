/* eslint-disable no-restricted-globals, @th/no-storage-outside-try -- tests seed and inspect localStorage deliberately */
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import type { DataLabelsConfig } from "../../lib/channelConfig"
import { DEFAULT_MAP_CONFIG } from "../../lib/mapConfig"
import {
	DATA_LABELS_CONFIG_VERSION,
	MAP_CONFIG_VERSION,
} from "../../lib/storage/migrations"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type DataLabelsEncodings,
	type Dataset,
} from "../../lib/types"

import { GeoChoroplethPlot } from "./GeoChoroplethPlot"

/** Data labels on maps: the labels' `geography` channel joins region values
 *  independently of the map's own connection field, and each matched region
 *  renders one `<text>` at its centroid. Geometry + label-level detection
 *  are async, so assertions wait. Seeding goes through localStorage (not
 *  `initializeState`) — the atoms' persist effects re-read storage on first
 *  `get` (mirrors GeoChoroplethPlot.smoke.test.tsx). */

const DATASET_ID = "ds-geo-labels"

// `state` (abbrevs) drives the map join; `stateName` (full names) is a
// DIFFERENT field for the labels' geography, so the test exercises the
// label channel's own level detection + join rather than the reuse path.
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "rates",
		filename: "rates.csv",
		fields: [
			{ name: "state", inferredType: "categorical" },
			{ name: "stateName", inferredType: "categorical" },
			{ name: "rate", inferredType: "quantitative" },
		],
		rows: [
			{ state: "CA", stateName: "California", rate: "1" },
			{ state: "TX", stateName: "Texas", rate: "2" },
			{ state: "NY", stateName: "New York", rate: "3" },
			{ state: "FL", stateName: "Florida", rate: "4" },
		],
	})

const seed = (
	dataLabels: Partial<DataLabelsEncodings>,
	config?: Partial<DataLabelsConfig>
) => {
	installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) =>
		localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", {
		...emptyEncodings(),
		connection: { field: "state" },
		hue: { field: "rate" },
	})
	set("vis-components:currentDataLabelsEncodings", {
		...emptyDataLabelsEncodings(),
		...dataLabels,
	})
	if (config) {
		set("vis-components:currentDataLabelsConfig", {
			_v: DATA_LABELS_CONFIG_VERSION,
			data: config,
		})
	}
	set("vis-components:currentMapConfig", {
		_v: MAP_CONFIG_VERSION,
		data: { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" },
	})
	/* eslint-enable @th/use-wrapped-json-functions */
}

const labelTexts = (container: HTMLElement): string[] =>
	[...container.querySelectorAll("g[aria-hidden='true'] text")].map(
		(t) => t.textContent ?? ""
	)

afterEach(cleanup)

describe("data labels on maps", () => {
	it("labels each region matched by the geography field with its value", async () => {
		seed({
			geography: { field: "stateName" },
			value: { field: "rate" },
		})
		const { container } = render(
			<TestProvider>
				<svg width={800} height={600}>
					<GeoChoroplethPlot />
				</svg>
			</TestProvider>
		)
		await waitFor(
			() => {
				expect(labelTexts(container).sort()).toEqual(["1", "2", "3", "4"])
			},
			{ timeout: 5000 }
		)
	})

	it("renders no labels when geography is mapped without a value", async () => {
		seed({ geography: { field: "stateName" }, value: { field: null } })
		const { container } = render(
			<TestProvider>
				<svg width={800} height={600}>
					<GeoChoroplethPlot />
				</svg>
			</TestProvider>
		)
		// Regions must be drawn (geometry resolved) with zero label texts.
		await waitFor(
			() => {
				expect(
					container.querySelectorAll("path").length
				).toBeGreaterThanOrEqual(50)
			},
			{ timeout: 5000 }
		)
		expect(labelTexts(container)).toEqual([])
	})

	it("renders no labels when value is mapped without a geography", async () => {
		seed({ value: { field: "rate" } })
		const { container } = render(
			<TestProvider>
				<svg width={800} height={600}>
					<GeoChoroplethPlot />
				</svg>
			</TestProvider>
		)
		await waitFor(
			() => {
				expect(
					container.querySelectorAll("path").length
				).toBeGreaterThanOrEqual(50)
			},
			{ timeout: 5000 }
		)
		expect(labelTexts(container)).toEqual([])
	})

	it("draws styled leader lines from displaced labels back to their region centroids when enabled", async () => {
		// A big X offset displaces every label off its centroid, so each of
		// the four labels earns a leader line ending at the raw anchor.
		seed(
			{ geography: { field: "stateName" }, value: { field: "rate" } },
			{
				leaderLines: true,
				leaderLineColor: "#ff0000",
				leaderLineWidth: 2,
				xOffset: 60,
			}
		)
		const { container } = render(
			<TestProvider>
				<svg width={800} height={600}>
					<GeoChoroplethPlot />
				</svg>
			</TestProvider>
		)
		await waitFor(
			() => {
				const lines = container.querySelectorAll(
					"[data-testid='geo-leader-lines'] line"
				)
				expect(lines.length).toBe(4)
			},
			{ timeout: 5000 }
		)
		const line = container.querySelector(
			"[data-testid='geo-leader-lines'] line"
		)
		expect(line?.getAttribute("stroke")).toBe("#ff0000")
		expect(line?.getAttribute("stroke-width")).toBe("2")
	})

	it("draws no leader lines when labels sit on their centroids", async () => {
		// Leader lines on, but nothing displaces the labels — every anchor is
		// inside its own label box, so no line renders.
		seed(
			{ geography: { field: "stateName" }, value: { field: "rate" } },
			{ leaderLines: true }
		)
		const { container } = render(
			<TestProvider>
				<svg width={800} height={600}>
					<GeoChoroplethPlot />
				</svg>
			</TestProvider>
		)
		await waitFor(
			() => {
				expect(labelTexts(container).sort()).toEqual(["1", "2", "3", "4"])
			},
			{ timeout: 5000 }
		)
		expect(
			container.querySelectorAll("[data-testid='geo-leader-lines'] line")
		).toHaveLength(0)
	})
})
