import { describe, expect, it } from "vitest"
import { datasetCsvFilename, datasetViewToCsv } from "./downloadDataset"
import { parseCsvText } from "./parseCsv"
import type { DatasetView } from "./types"

const view = (over: Partial<DatasetView> = {}): DatasetView => ({
	id: "ds-1",
	name: "Q3 Sales",
	filename: "sales.csv",
	fields: [
		{ name: "region", inferredType: "categorical" },
		{ name: "revenue", inferredType: "quantitative" },
	],
	rows: [
		{ region: "East", revenue: "$1,200" },
		{ region: "West, North", revenue: "800" },
	],
	createdAt: 0,
	versionId: "dv-1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
	...over,
})

describe("datasetViewToCsv", () => {
	it("writes a header row from the fields and one line per row", () => {
		expect(datasetViewToCsv(view())).toBe(
			'region,revenue\nEast,"$1,200"\n"West, North",800'
		)
	})

	it("keeps field order and emits blanks for missing cells", () => {
		const csv = datasetViewToCsv(
			view({
				fields: [
					{ name: "b", inferredType: "categorical" },
					{ name: "a", inferredType: "categorical" },
					{ name: "empty", inferredType: "categorical" },
				],
				rows: [{ a: "1", b: "2" }],
			})
		)
		expect(csv).toBe("b,a,empty\n2,1,")
	})

	it("round-trips through the upload parser", () => {
		const source = view({
			rows: [
				{ region: 'He said "hi"', revenue: "1" },
				{ region: "multi\nline", revenue: "" },
			],
		})
		const parsed = parseCsvText(datasetViewToCsv(source))
		expect(parsed.fieldNames).toEqual(["region", "revenue"])
		expect(parsed.rows).toEqual(source.rows)
	})
})

describe("datasetCsvFilename", () => {
	it("slugs the dataset name", () => {
		expect(datasetCsvFilename({ name: "Q3 Sales (final)" })).toBe(
			"q3-sales-final.csv"
		)
	})

	it("falls back to a dataset-flavored name", () => {
		expect(datasetCsvFilename({ name: "📊" })).toBe("dataset.csv")
	})
})
