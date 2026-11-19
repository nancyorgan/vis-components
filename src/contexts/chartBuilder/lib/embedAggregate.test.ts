import { describe, expect, it } from "vitest"

import { buildDataset } from "../../../testSupport/fixtures"
import { composeVisual, type ChartSpec } from "./chartSpec"
import { aggregateEmbedRecords } from "./embedAggregate"
import { DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import { LIGHT_THEME_BASE } from "./systemThemes"
import type { Dataset, Field, Visual } from "./types"

type Rows = Array<Record<string, string>>

const FIELDS: Field[] = [
	{ name: "Region", inferredType: "categorical" },
	{ name: "Quarter", inferredType: "ordinal" },
	{ name: "Rep", inferredType: "categorical" },
	{ name: "Sales", inferredType: "quantitative" },
	{ name: "Units", inferredType: "quantitative" },
]

const ROWS: Rows = [
	{ Region: "West", Quarter: "Q1", Rep: "Ana", Sales: "10", Units: "1" },
	{ Region: "West", Quarter: "Q1", Rep: "Ben", Sales: "20", Units: "2" },
	{ Region: "West", Quarter: "Q2", Rep: "Cy", Sales: "30", Units: "3" },
	{ Region: "East", Quarter: "Q1", Rep: "Dee", Sales: "40", Units: "4" },
	{ Region: "East", Quarter: "Q1", Rep: "Eli", Sales: "0.1", Units: "5" },
	{ Region: "East", Quarter: "Q2", Rep: "Fay", Sales: "0.2", Units: "6" },
]

const dataset = (rows: Rows = ROWS, fields: Field[] = FIELDS): Dataset =>
	buildDataset({ id: "ds", name: "sales", fields, rows })

const chart = (spec: Omit<ChartSpec, "datasetId" | "folderId">, fields: Field[] = FIELDS): Visual => {
	const { visual, problems } = composeVisual(
		{ datasetId: "ds", folderId: null, ...spec },
		{ fields: fields.map((f) => ({ name: f.name, type: f.inferredType })), theme: LIGHT_THEME_BASE }
	)
	expect(problems).toEqual([])
	return visual
}

const BARS = { family: "bar", encodings: { x: "Region", length: "Sales" } } as const

const run = (visual: Visual, data: Dataset = dataset()) => {
	const out = aggregateEmbedRecords(visual, data)
	return { ...out, rows: out.dataset.versions[0]?.rows ?? [] }
}

describe("aggregateEmbedRecords", () => {
	it("publishes one row per bar: the measure added up, the hover's columns from the first row", () => {
		const { aggregation, rows } = run(chart(BARS))
		expect(aggregation).toEqual({ aggregated: true, rowsBefore: 6, rowsAfter: 2, measure: "Sales" })
		expect(rows).toEqual([
			{ Region: "West", Quarter: "Q1", Rep: "Ana", Sales: "60", Units: "1" },
			// 40 + 0.1 + 0.2, added in row order as the chart adds them.
			{ Region: "East", Quarter: "Q1", Rep: "Dee", Sales: String(40 + 0.1 + 0.2), Units: "4" },
		])
	})

	it("keeps rows apart on every grouping and facet", () => {
		const { aggregation, rows } = run(
			chart({ family: "bar", encodings: { x: "Region", length: "Sales", hue: "Quarter" } })
		)
		expect(aggregation).toMatchObject({ aggregated: true, rowsAfter: 4 })
		expect(rows.map((r) => [r.Region, r.Quarter, r.Sales])).toEqual([
			["West", "Q1", "30"],
			["West", "Q2", "30"],
			["East", "Q1", "40.1"],
			["East", "Q2", "0.2"],
		])
	})

	it("never folds a blank or text cell into a total", () => {
		const rows: Rows = [
			{ Region: "West", Quarter: "Q1", Rep: "Ana", Sales: "", Units: "1" },
			{ Region: "West", Quarter: "Q1", Rep: "Ben", Sales: "20", Units: "2" },
			{ Region: "West", Quarter: "Q1", Rep: "Cy", Sales: "", Units: "3" },
			{ Region: "West", Quarter: "Q1", Rep: "Dee", Sales: "n/a", Units: "4" },
			{ Region: "West", Quarter: "Q1", Rep: "Eli", Sales: "5", Units: "5" },
		]
		const out = run(chart(BARS), dataset(rows))
		// First-seen order: the blank rows come first, as they do in the data.
		expect(out.rows.map((r) => [r.Sales, r.Rep])).toEqual([
			["", "Ana"],
			["25", "Ben"],
			["n/a", "Dee"],
		])
	})

	it("carries a dollar or percent column's cue on the column once its cells are plain totals", () => {
		const rows: Rows = ROWS.map((r, i) => ({ ...r, Sales: "$" + String(i + 1) + ",500" }))
		const out = run(chart(BARS), dataset(rows))
		expect(out.aggregation).toMatchObject({ aggregated: true })
		expect(out.rows.map((r) => r.Sales)).toEqual(["7500", "16500"])
		const field = out.dataset.versions[0]?.fields?.find((f) => f.name === "Sales")
		expect(field?.formatHint).toBe("dollar")
		expect(out.dataset.fields.find((f) => f.name === "Sales")?.formatHint).toBe("dollar")
	})

	it("leaves the records alone when nothing would be removed", () => {
		const data = dataset(ROWS.slice(0, 1))
		const out = aggregateEmbedRecords(chart(BARS), data)
		expect(out.dataset).toBe(data)
		expect(out.aggregation).toEqual({ aggregated: false, reason: null })
	})

	it("publishes rows, with nothing to say, for a chart that draws from rows", () => {
		const scatter = chart({ family: "scatter", encodings: { x: "Sales", y: "Units" } })
		expect(run(scatter).aggregation).toEqual({ aggregated: false, reason: null })
	})

	it("publishes rows, and says why, for a sum chart it can't collapse safely", () => {
		const reason = (visual: Visual, data?: Dataset) => {
			const out = run(visual, data)
			expect(out.dataset).toBe(data ?? out.dataset)
			return out.aggregation.aggregated ? "COLLAPSED" : out.aggregation.reason
		}
		// A bar that counts rows.
		expect(
			reason(chart({ family: "bar", encodings: { x: "Region", length: "Quarter", hue: "Quarter" } }))
		).toBe("its marks count rows")
		// A rule that tests the measure row by row.
		const bars = chart(BARS)
		const ruled: Visual = {
			...bars,
			channelConfigs: {
				...bars.channelConfigs,
				hue: {
					...bars.channelConfigs.hue,
					colorRules: [{ condition: "{Sales} > 15", color: "#ff0000" }],
				} as unknown as Visual["channelConfigs"]["hue"],
			},
		}
		expect(reason(ruled)).toBe("a setting reads Sales row by row")
		// A second number a label adds up.
		const labelled: Visual = {
			...bars,
			dataLabelsEncodings: {
				...bars.dataLabelsEncodings,
				value: { field: "Units" },
			} as unknown as Visual["dataLabelsEncodings"],
		}
		expect(reason(labelled)).toBe("a label adds up Units as well")
		// The measure doubling as a grouping.
		expect(
			reason(chart({ family: "bar", encodings: { x: "Region", length: "Sales", opacity: "Sales" } }))
		).toBe("its measure is also used to group the marks")
	})

	it("an area chart collapses only once its hover no longer lists the measure", () => {
		const area = chart({
			family: "area",
			encodings: { x: "Quarter", length: "Sales", connection: "Region" },
		})
		const listed = run(area).aggregation
		expect(listed).toMatchObject({ aggregated: false })
		expect(listed.aggregated ? "" : listed.reason).toContain("hovering a layer shows Sales from one row")
		const unticked: Visual = {
			...area,
			tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, visibleFields: ["Region", "Quarter"] },
		}
		expect(run(unticked).aggregation).toMatchObject({ aggregated: true, rowsAfter: 4 })
		const off: Visual = { ...area, tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, enabled: false } }
		expect(run(off).aggregation).toMatchObject({ aggregated: true })
	})

	it("a column a rule names is a key: rows merge only where it agrees", () => {
		const bars = chart(BARS)
		const ruled: Visual = {
			...bars,
			channelConfigs: {
				...bars.channelConfigs,
				hue: {
					...bars.channelConfigs.hue,
					colorRules: [{ condition: "{Rep} == Ana", color: "#ff0000" }],
				} as unknown as Visual["channelConfigs"]["hue"],
			},
		}
		// Every row has its own Rep, so nothing merges and the rows stay.
		expect(run(ruled).aggregation).toEqual({ aggregated: false, reason: null })
		const sameRep = dataset(ROWS.map((r) => ({ ...r, Rep: r.Region === "West" ? "Ana" : "Ben" })))
		expect(run(ruled, sameRep).aggregation).toMatchObject({ aggregated: true, rowsAfter: 2 })
	})
})
