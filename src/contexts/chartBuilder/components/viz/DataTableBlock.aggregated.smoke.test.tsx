import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { buildDataset } from "../../../../testSupport/fixtures"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import {
	DEFAULT_AXIS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../lib/channelConfig"
import { DEFAULT_DATA_TABLE_CONFIG } from "../../lib/dataTableConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
// Axis titles seeded cleared (""): jsdom gives the chart a tiny fallback
// canvas, and the default field-name titles would squeeze the plot area
// these mark-geometry assertions measure down to nothing.
import { emptyEncodings, type Encodings, type Field } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataTableConfigAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentVisualNameAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { ChartCanvas } from "./ChartCanvas"
import { DataTableBlock } from "./DataTableBlock"

/** Renderer-equality checks: the chart and its data table mounted side by
 *  side on the same store, the table's aggregated values compared against
 *  the marks the renderer actually drew. */

afterEach(cleanup)

const ID = "ds-agg-table"

const mount = (args: {
	fields: Field[]
	rows: Array<Record<string, string>>
	encodings: Partial<Encodings>
	channelConfigs?: ChannelConfigs
}) => {
	installInMemoryLocalStorage()
	const init = (s: TestStore) => {
		s.set(loadedDatasetsAtom, {
			[ID]: buildDataset({ id: ID, name: "d", fields: args.fields, rows: args.rows }),
		})
		s.set(currentDatasetIdAtom, ID)
		s.set(previewVersionIdAtom, null)
		s.set(currentEncodingsAtom, { ...emptyEncodings(), ...args.encodings })
		s.set(currentChannelConfigsAtom, args.channelConfigs ?? EMPTY_CHANNEL_CONFIGS)
		s.set(currentFieldOverridesAtom, {})
		s.set(currentFieldLevelOrdersAtom, {})
		s.set(currentLabelsAtom, { ...DEFAULT_LABELS_CONFIG, xAxisTitle: "", yAxisTitle: "" })
		s.set(currentVisualNameAtom, "Agg")
		s.set(currentDataTableConfigAtom, { ...DEFAULT_DATA_TABLE_CONFIG, enabled: true })
	}
	return render(
		<TestProvider initializeState={init}>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
			<DataTableBlock />
		</TestProvider>
	)
}

const tableRows = (container: HTMLElement): string[][] =>
	[...container.querySelectorAll("table.vc-data-table tbody tr")].map((tr) =>
		[...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")
	)

const headers = (container: HTMLElement): string[] =>
	[...container.querySelectorAll("table.vc-data-table thead th")].map(
		(th) => th.textContent ?? ""
	)

/** Bar mark rects (they carry an outline stroke; backgrounds don't). */
const barHeights = (container: HTMLElement): number[] =>
	[...container.querySelectorAll("svg rect")]
		.filter((r) => r.getAttribute("stroke") !== null)
		.map((r) => ({
			x: Number(r.getAttribute("x")),
			h: Number(r.getAttribute("height")),
		}))
		.filter((r) => r.h > 0)
		.sort((a, b) => a.x - b.x)
		.map((r) => r.h)

describe("Data table — aggregated values match the drawn marks", () => {
	it("bars: one row per bar, sums in proportion to the bar heights", () => {
		const { container } = mount({
			fields: [
				{ name: "region", inferredType: "categorical" },
				{ name: "sales", inferredType: "quantitative" },
			],
			rows: [
				{ region: "West", sales: "10" },
				{ region: "West", sales: "30" },
				{ region: "East", sales: "20" },
				{ region: "North", sales: "5" },
			],
			encodings: { x: { field: "region" }, length: { field: "sales" } },
		})
		expect(headers(container)).toEqual(["region", "sales (sum)"])
		const rows = tableRows(container)
		expect(rows).toEqual([
			["West", "40"],
			["East", "20"],
			["North", "5"],
		])
		const heights = barHeights(container)
		expect(heights).toHaveLength(3)
		const sums = rows.map((r) => Number(r[1]))
		// Heights ∝ sums (same scale, zero baseline).
		const k = (heights[0] ?? 0) / (sums[0] ?? 1)
		heights.forEach((h, i) => expect(h).toBeCloseTo((sums[i] ?? 0) * k, 3))
		expect(container.querySelector(".vc-data-table-note")?.textContent).toBe(
			"Values are sums per bar; the underlying data has 4 rows."
		)
		const table = container.querySelector("table.vc-data-table")
		expect(table?.getAttribute("aria-describedby")).toBe(
			container.querySelector(".vc-data-table-note")?.id
		)
	})

	it("histogram: the table's bins are the axis's bin labels, counts ∝ bar heights", () => {
		const { container } = mount({
			fields: [{ name: "score", inferredType: "quantitative" }],
			rows: Array.from({ length: 20 }, (_, i) => ({ score: String(i + 1) })),
			encodings: { x: { field: "score" } },
			channelConfigs: {
				...EMPTY_CHANNEL_CONFIGS,
				x: {
					...DEFAULT_AXIS_CONFIG,
					histogram: { enabled: true, binCount: 4, mode: "count" },
				} as ChannelConfigs["x"],
			},
		})
		expect(headers(container)).toEqual(["score (bin)", "Count"])
		const rows = tableRows(container)
		const axisBinLabels = [...container.querySelectorAll("svg text")]
			.map((t) => t.textContent ?? "")
			.filter((t) => t.includes("–"))
		expect(rows.map((r) => r[0])).toEqual(axisBinLabels)
		const counts = rows.map((r) => Number(r[1])).filter((n) => n > 0)
		const heights = barHeights(container)
		expect(heights).toHaveLength(counts.length)
		const k = (heights[0] ?? 0) / (counts[0] ?? 1)
		heights.forEach((h, i) => expect(h).toBeCloseTo((counts[i] ?? 0) * k, 3))
	})

	it("scatter keeps the row table and no note", () => {
		const { container } = mount({
			fields: [
				{ name: "a", inferredType: "quantitative" },
				{ name: "b", inferredType: "quantitative" },
			],
			rows: [
				{ a: "1", b: "2" },
				{ a: "1", b: "2" },
			],
			encodings: { x: { field: "a" }, y: { field: "b" } },
		})
		expect(tableRows(container)).toHaveLength(2)
		expect(container.querySelector(".vc-data-table-note")).toBeNull()
	})
})
