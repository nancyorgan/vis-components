import { afterEach, describe, expect, it, vi } from "vitest"
import {
	DATASET_FILE_TYPE,
	datasetCsvFilename,
	datasetViewToCsv,
	downloadDatasetCsv,
} from "./downloadDataset"
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

const CSV = 'region,revenue\nEast,"$1,200"\n"West, North",800'

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe("datasetViewToCsv", () => {
	it("writes a header row from the fields and one line per row", () => {
		expect(datasetViewToCsv(view())).toBe(CSV)
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

	it("keeps an imported version's own CSV file name", () => {
		expect(
			datasetCsvFilename(view({ filename: "2024.csv" }), { imported: true })
		).toBe("2024.csv")
		expect(
			datasetCsvFilename(view({ filename: "Sales.CSV" }), { imported: true })
		).toBe("Sales.CSV")
	})

	it("names a pasted import after the dataset", () => {
		expect(
			datasetCsvFilename(view({ filename: "Pasted data" }), { imported: true })
		).toBe("q3-sales.csv")
	})

	it("names an edited or computed version after the dataset", () => {
		expect(
			datasetCsvFilename(view({ filename: "Edited data" }), { imported: false })
		).toBe("q3-sales.csv")
		// Even one that happens to carry a CSV-looking name.
		expect(datasetCsvFilename(view({ filename: "2024.csv" }))).toBe(
			"q3-sales.csv"
		)
	})

	it("drops any directory part of an imported file name", () => {
		expect(
			datasetCsvFilename(view({ filename: "../x.csv" }), { imported: true })
		).toBe("x.csv")
		expect(
			datasetCsvFilename(view({ filename: "C:\\data\\y.csv" }), {
				imported: true,
			})
		).toBe("y.csv")
		// Nothing left before the extension → the dataset name.
		expect(
			datasetCsvFilename(view({ filename: "dir/.csv" }), { imported: true })
		).toBe("q3-sales.csv")
	})
})

describe("downloadDatasetCsv", () => {
	it("offers the Save-as dialog under the dataset's name and writes the CSV there", async () => {
		const written: Blob[] = []
		const writable = {
			write: vi.fn((blob: Blob) => {
				written.push(blob)
				return Promise.resolve()
			}),
			close: vi.fn().mockResolvedValue(undefined),
		}
		const picker = vi.fn().mockResolvedValue({
			createWritable: vi.fn().mockResolvedValue(writable),
		})
		vi.stubGlobal("showSaveFilePicker", picker)
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {})

		await expect(downloadDatasetCsv(view())).resolves.toBe(true)

		expect(picker).toHaveBeenCalledWith({
			suggestedName: "q3-sales.csv",
			id: "vis-export-dataset",
			types: [
				{
					description: DATASET_FILE_TYPE.description,
					accept: { "text/csv": [".csv"] },
				},
			],
		})
		expect(written).toHaveLength(1)
		await expect(written[0]!.text()).resolves.toBe("\uFEFF" + CSV)
		expect(writable.close).toHaveBeenCalled()
		// Nothing also went out the anchor-download door.
		expect(click).not.toHaveBeenCalled()
	})

	it("saves nothing when the user closes the dialog", async () => {
		vi.stubGlobal(
			"showSaveFilePicker",
			vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"))
		)
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {})

		await expect(downloadDatasetCsv(view())).resolves.toBe(false)

		expect(click).not.toHaveBeenCalled()
	})

	it("falls back to an anchor download named after the dataset", async () => {
		const blobs: Blob[] = []
		vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
			blobs.push(blob as Blob)
			return "blob:fake"
		})
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
		const downloads: string[] = []
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			function (this: HTMLAnchorElement) {
				downloads.push(this.download)
			}
		)

		await expect(downloadDatasetCsv(view())).resolves.toBe(true)

		expect(downloads).toEqual(["q3-sales.csv"])
		expect(blobs).toHaveLength(1)
		await expect(blobs[0]!.text()).resolves.toBe("\uFEFF" + CSV)
	})

	it("offers an imported version under its own file name", async () => {
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake")
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
		const downloads: string[] = []
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			function (this: HTMLAnchorElement) {
				downloads.push(this.download)
			}
		)

		await expect(
			downloadDatasetCsv(view(), { imported: true })
		).resolves.toBe(true)

		expect(downloads).toEqual(["sales.csv"])
	})
})
