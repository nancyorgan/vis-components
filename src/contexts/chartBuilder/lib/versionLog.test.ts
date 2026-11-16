import { describe, expect, it } from "vitest"
import { parseCsvText } from "./parseCsv"
import type { DatasetMeta } from "./types"
import {
	VERSION_LOG_COLUMNS,
	formatLogDate,
	versionLogFilename,
	versionLogRows,
	versionLogToCsv,
} from "./versionLog"

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
	new Date(y, mo - 1, d, h, mi, 0).getTime()

const meta = (): Pick<
	DatasetMeta,
	"name" | "fields" | "versions" | "latestVersionId"
> => ({
	name: "Q3 Sales",
	fields: [
		{ name: "k", inferredType: "categorical" },
		{ name: "v", inferredType: "quantitative" },
		{ name: "double", inferredType: "quantitative" },
	],
	latestVersionId: "v4",
	versions: [
		{
			id: "v1",
			filename: "sales.csv",
			createdAt: at(2026, 3, 1, 9, 5),
			note: "First pull, from finance",
			rowCount: 12,
			fields: [{ name: "a", inferredType: "quantitative" }],
		},
		{
			id: "v2",
			filename: "Edited data",
			createdAt: at(2026, 3, 2, 14, 30),
			editedFrom: "v1",
			rowCount: 12,
			fields: [{ name: "a", inferredType: "quantitative" }],
		},
		{
			id: "v3",
			filename: "Reshaped data",
			createdAt: at(2026, 3, 3, 8, 0),
			editedFrom: "v2",
			rowCount: 24,
			fields: [
				{ name: "k", inferredType: "categorical" },
				{ name: "v", inferredType: "quantitative" },
			],
			transform: {
				reshape: { idFields: [], meltFields: ["a"], variableName: "k", valueName: "v" },
			},
		},
		{
			id: "v4",
			filename: "Derived data",
			createdAt: at(2026, 3, 4, 17, 45),
			editedFrom: "gone",
			rowCount: 24,
			transform: {
				added: [{ id: "d", name: "double", kind: "math", math: { formula: "{v} * 2" } }],
			},
		},
	],
})

describe("versionLogRows", () => {
	it("lists every version oldest first with how it was made", () => {
		const [header, ...rows] = versionLogRows(meta())
		expect(header).toEqual([...VERSION_LOG_COLUMNS])
		expect(rows).toEqual([
			["Q3 Sales", "v1", "2026-03-01 09:05:00", "Imported", "", "", "sales.csv", "First pull, from finance", "12", "1", ""],
			["Q3 Sales", "v2", "2026-03-02 14:30:00", "Edited", "edited by hand", "v1", "Edited data", "", "12", "1", ""],
			["Q3 Sales", "v3", "2026-03-03 08:00:00", "Edited", "reshaped (wide → long)", "v2", "Reshaped data", "", "24", "2", ""],
			["Q3 Sales", "v4", "2026-03-04 17:45:00", "Edited", "added “double”", "deleted version", "Derived data", "", "24", "3", "yes"],
		])
	})
})

describe("versionLogToCsv", () => {
	it("round-trips through the CSV parser, commas in notes included", () => {
		const parsed = parseCsvText(versionLogToCsv(meta()))
		expect(parsed.fieldNames).toEqual([...VERSION_LOG_COLUMNS])
		expect(parsed.rows).toHaveLength(4)
		expect(parsed.rows[0]?.Note).toBe("First pull, from finance")
	})
})

describe("names and dates", () => {
	it("names the file after the data set", () => {
		expect(versionLogFilename("Q3 Sales")).toMatch(/-versions\.csv$/)
		expect(versionLogFilename("")).toBe("dataset-versions.csv")
	})
	it("pads the date parts", () => {
		expect(formatLogDate(at(2026, 1, 2, 3, 4))).toBe("2026-01-02 03:04:00")
	})
})
