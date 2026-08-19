import { describe, expect, it } from "vitest"

import {
	applyPercentConversionToView,
	parsePercentCell,
} from "./percentCells"
import type { DatasetView } from "./types"

describe("parsePercentCell", () => {
	it("parses simple percents to fractions", () => {
		expect(parsePercentCell("14%")).toBe(0.14)
		expect(parsePercentCell("100%")).toBe(1)
		expect(parsePercentCell("0%")).toBe(0)
	})

	it("handles signs, decimals, and interior whitespace", () => {
		expect(parsePercentCell("-2.5%")).toBe(-0.025)
		expect(parsePercentCell(" 14 % ")).toBe(0.14)
		expect(parsePercentCell("1e2%")).toBe(1)
	})

	it("scrubs float noise from the division", () => {
		// 14.55 / 100 === 0.14550000000000002 in raw IEEE754.
		expect(parsePercentCell("14.55%")).toBe(0.1455)
	})

	it("returns null for non-percent values (bare numbers included)", () => {
		expect(parsePercentCell("14")).toBeNull()
		expect(parsePercentCell("Surgery")).toBeNull()
		expect(parsePercentCell("%")).toBeNull()
		expect(parsePercentCell("abc%")).toBeNull()
		expect(parsePercentCell("")).toBeNull()
		expect(parsePercentCell(null)).toBeNull()
		expect(parsePercentCell(undefined)).toBeNull()
	})
})

const makeView = (
	rows: Array<Record<string, string>>,
	fieldNames: string[]
): DatasetView => ({
	id: "d1",
	name: "test",
	filename: "test.csv",
	fields: fieldNames.map((name) => ({
		name,
		inferredType: "categorical",
	})),
	rows,
	createdAt: 0,
	versionId: "dv1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

describe("applyPercentConversionToView", () => {
	it("converts percent cells in a quantitative-overridden column", () => {
		const view = makeView(
			[
				{ group: "a", share: "14%" },
				{ group: "b", share: "50%" },
			],
			["group", "share"]
		)
		const out = applyPercentConversionToView(view, {
			share: "quantitative",
		})
		expect(out?.rows).toEqual([
			{ group: "a", share: "0.14" },
			{ group: "b", share: "0.5" },
		])
	})

	it("leaves non-percent cells in a converted column untouched", () => {
		const view = makeView(
			[
				{ share: "14%" },
				{ share: "12" },
				{ share: "Surgery" },
				{ share: "" },
			],
			["share"]
		)
		const out = applyPercentConversionToView(view, {
			share: "quantitative",
		})
		expect(out?.rows.map((r) => r.share)).toEqual([
			"0.14",
			"12",
			"Surgery",
			"",
		])
	})

	it("only converts columns overridden to quantitative", () => {
		const view = makeView(
			[{ share: "14%", label: "14%" }],
			["share", "label"]
		)
		const out = applyPercentConversionToView(view, {
			share: "quantitative",
			label: "ordinal",
		})
		expect(out?.rows[0]).toEqual({ share: "0.14", label: "14%" })
	})

	it("passes the view through by identity when nothing converts", () => {
		const view = makeView([{ share: "14%" }, { n: "5" }], ["share", "n"])
		// No overrides at all.
		expect(applyPercentConversionToView(view, {})).toBe(view)
		// Overridden column has no percent cells.
		expect(
			applyPercentConversionToView(view, { n: "quantitative" })
		).toBe(view)
	})

	it("returns undefined for an undefined view", () => {
		expect(applyPercentConversionToView(undefined, {})).toBeUndefined()
	})
})
