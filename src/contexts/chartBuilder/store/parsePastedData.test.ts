import { describe, expect, it } from "vitest"
import { PASTED_DATA_FILENAME, parsePastedData } from "./useCreateNewDataset"

/** Pasted data takes whatever delimiter the clipboard brought: a spreadsheet
 *  selection arrives tab-separated, a CSV's contents comma-separated. The
 *  first row is the header either way, as with a file upload. */
describe("parsePastedData", () => {
	it("reads a tab-separated spreadsheet paste", () => {
		const parsed = parsePastedData(
			"country\tyear\tpopulation\nChile\t2020\t19.1\nPeru\t2020\t33.0\n"
		)
		expect(parsed.filename).toBe(PASTED_DATA_FILENAME)
		expect(parsed.fields).toEqual([
			{ name: "country", inferredType: "categorical" },
			{ name: "year", inferredType: "quantitative" },
			{ name: "population", inferredType: "quantitative" },
		])
		expect(parsed.rows).toEqual([
			{ country: "Chile", year: "2020", population: "19.1" },
			{ country: "Peru", year: "2020", population: "33.0" },
		])
	})

	it("reads comma-separated text, quotes included", () => {
		const parsed = parsePastedData('name,note\n"Smith, J",hello\nLee,"a ""b"""')
		expect(parsed.fields.map((f) => f.name)).toEqual(["name", "note"])
		expect(parsed.rows).toEqual([
			{ name: "Smith, J", note: "hello" },
			{ name: "Lee", note: 'a "b"' },
		])
	})

	it("ignores surrounding blank lines and whitespace", () => {
		const parsed = parsePastedData("\n\n  a,b\n1,2\n\n  \n")
		expect(parsed.rows).toEqual([{ a: "1", b: "2" }])
	})

	it("accepts a single column, which has no delimiter to detect", () => {
		const parsed = parsePastedData("score\n1\n2\n3")
		expect(parsed.fields).toEqual([{ name: "score", inferredType: "quantitative" }])
		expect(parsed.rows).toEqual([{ score: "1" }, { score: "2" }, { score: "3" }])
	})

	it("refuses an empty paste or a header with no rows", () => {
		expect(() => parsePastedData("")).toThrow(/header row and at least one data row/)
		expect(() => parsePastedData("   \n ")).toThrow(/header row and at least one data row/)
		expect(() => parsePastedData("a,b,c")).toThrow(/header row and at least one data row/)
	})
})
