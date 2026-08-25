import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** UNIFIED CONVENTION (2026-08): the Pattern panel's "Default pattern"
 *  picker (`channelConfigs.defaultPattern`, offered whenever no pattern
 *  FIELD is mapped) applies to every mark-fill renderer — previously only
 *  ScatterPlot honored it, leaving the control inert on bars/areas/pies.
 *  This mounts a real bar chart through the production render path
 *  (ChartCanvas → PlotCanvas → BarPlot) and asserts the mark <rect>s
 *  reference an emitted default-pattern `<pattern>` def. */

const DATASET_ID = "ds-bar-default-pattern"

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

const seed = (channelConfigs: Record<string, unknown>) => {
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
		JSON.stringify(channelConfigs)
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

const patternFilledRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")].filter((r) =>
		(r.getAttribute("fill") ?? "").startsWith("url(#vc-pat-")
	)

describe("BarPlot — default pattern (no pattern field mapped)", () => {
	it("fills every mark rect with the configured default pattern and emits its defs", () => {
		seed({ defaultPattern: 2 })
		const { container } = mount()
		const patterned = patternFilledRects(container)
		// Two categories × two hue slices = 4 mark rects, all patterned.
		expect(patterned.length).toBeGreaterThanOrEqual(4)
		// Every referenced def is actually emitted (mark ↔ defs stay in sync),
		// and carries the picked palette index in its id.
		for (const rect of patterned) {
			const id = (rect.getAttribute("fill") ?? "").slice(
				"url(#".length,
				-")".length
			)
			expect(id.startsWith("vc-pat-2-")).toBe(true)
			expect(container.querySelector(`pattern[id="${id}"]`)).not.toBeNull()
		}
	})

	it("renders plain color fills when no default pattern is configured", () => {
		seed({})
		const { container } = mount()
		expect(patternFilledRects(container)).toHaveLength(0)
	})
})
