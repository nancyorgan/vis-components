import { describe, expect, it } from "vitest"
import {
	DATASET_REJECT_BYTES as SERVER_REJECT_BYTES,
} from "../../../../server/src/limits"
import {
	DATASET_REJECT_BYTES,
	DATASET_WARN_BYTES,
	DATASET_WARN_DISTINCT_VALUES,
	DATASET_WARN_ROWS,
	datasetPerformanceWarning,
	datasetSizeIssue,
} from "./datasetLimits"

describe("datasetSizeIssue", () => {
	it("passes small files silently", () => {
		expect(datasetSizeIssue(0)).toBeNull()
		expect(datasetSizeIssue(DATASET_WARN_BYTES)).toBeNull()
	})

	it("warns between the thresholds", () => {
		expect(datasetSizeIssue(DATASET_WARN_BYTES + 1)).toBe("warn")
		expect(datasetSizeIssue(DATASET_REJECT_BYTES)).toBe("warn")
	})

	it("rejects above the hard limit", () => {
		expect(datasetSizeIssue(DATASET_REJECT_BYTES + 1)).toBe("reject")
	})
})

describe("client/server threshold sync", () => {
	// The server enforces the hard limit independently (never trust the
	// client); this pins the two constants together so neither drifts.
	it("client and server agree on the hard limit", () => {
		expect(DATASET_REJECT_BYTES).toBe(SERVER_REJECT_BYTES)
	})
})

describe("datasetPerformanceWarning", () => {
	const rows = (count: number, value: (i: number) => string) =>
		Array.from({ length: count }, (_, i) => ({ price: value(i), cut: "Ideal" }))
	const fields = [{ name: "price" }, { name: "cut" }]

	it("stays quiet on a small, low-cardinality data set", () => {
		expect(datasetPerformanceWarning(fields, rows(100, () => "5"))).toBeNull()
	})

	it("stays quiet exactly at both thresholds", () => {
		const atRowLimit = rows(DATASET_WARN_ROWS, () => "5")
		expect(datasetPerformanceWarning(fields, atRowLimit)).toBeNull()
		const atDistinctLimit = rows(DATASET_WARN_DISTINCT_VALUES, (i) => String(i))
		expect(datasetPerformanceWarning(fields, atDistinctLimit)).toBeNull()
	})

	it("names the one column that is too wide to chart quickly", () => {
		const wide = rows(DATASET_WARN_DISTINCT_VALUES + 1, (i) => String(i))
		const warning = datasetPerformanceWarning(fields, wide)
		expect(warning).toContain("over 5,000 distinct values in `price`")
		expect(warning).toContain("pre-aggregating")
		// Advisory only — nothing here caps or bins the data.
		expect(warning).not.toContain("limit")
	})

	it("counts columns instead of naming them once several are wide", () => {
		const wide = Array.from(
			{ length: DATASET_WARN_DISTINCT_VALUES + 1 },
			(_, i) => ({ price: String(i), cut: String(i) })
		)
		expect(datasetPerformanceWarning(fields, wide)).toContain(
			"over 5,000 distinct values in 2 columns"
		)
	})

	it("reports row count and width together in one note", () => {
		const big = rows(DATASET_WARN_ROWS + 1, (i) => String(i))
		const warning = datasetPerformanceWarning(fields, big)
		expect(warning).toContain("50,001 rows and over 5,000 distinct values")
	})

	it("ignores blank cells when counting distinct values", () => {
		const blanks = rows(DATASET_WARN_DISTINCT_VALUES + 10, (i) =>
			i < DATASET_WARN_DISTINCT_VALUES ? String(i) : ""
		)
		expect(datasetPerformanceWarning(fields, blanks)).toBeNull()
	})
})
