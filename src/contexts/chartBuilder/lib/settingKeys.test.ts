import { describe, expect, it } from "vitest"

import { composeVisual, type ChartSpec } from "./chartSpec"
import { composedLabelIds, settingKeysOf } from "./settingKeys"
import { LIGHT_THEME_BASE } from "./systemThemes"
import type { Visual } from "./types"

const fields = [
	{ name: "region", type: "categorical" },
	{ name: "segment", type: "categorical" },
	{ name: "sales", type: "quantitative" },
] as const

const rows = [
	{ region: "West", segment: "Retail", sales: 10 },
	{ region: "East", segment: "Retail", sales: 20 },
	{ region: "West", segment: "Online", sales: 30 },
]

const compose = (over: Partial<ChartSpec>): Visual => {
	const { visual, problems } = composeVisual(
		{ datasetId: "ds-1", folderId: null, encodings: {}, ...over },
		{ theme: LIGHT_THEME_BASE, fields, folderIds: new Set<string>(), now: 1000 }
	)
	expect(problems).toEqual([])
	return visual
}

describe("settingKeysOf", () => {
	it("lists every field, and as table columns too", () => {
		const keys = settingKeysOf(compose({ family: "bar", encodings: { x: "region", length: "sales" } }), fields, rows)
		expect(keys.fields).toEqual(["region", "segment", "sales"])
		expect(keys.columns).toEqual(["region", "segment", "sales"])
	})

	it("lists the levels of mapped categorical fields only, in first-appearance order", () => {
		const keys = settingKeysOf(compose({ family: "bar", encodings: { x: "region", length: "sales" } }), fields, rows)
		expect(keys.levels).toEqual({ region: ["West", "East"] })
	})

	it("has no facet keys on an unfaceted chart", () => {
		const keys = settingKeysOf(compose({ family: "bar", encodings: { x: "region", length: "sales" } }), fields, rows)
		expect(keys.facetPanels).toEqual([])
		expect(keys.facetRows).toEqual([])
		expect(keys.facetCols).toEqual([])
	})

	it("lists a wrap facet's panels and records its levels", () => {
		const visual = compose({ family: "bar", encodings: { x: "region", length: "sales" } })
		const faceted: Visual = { ...visual, encodings: { ...visual.encodings, facet: { field: "segment" } } }
		const keys = settingKeysOf(faceted, fields, rows)
		expect(keys.facetPanels).toEqual(["Retail", "Online"])
		expect(keys.levels.segment).toEqual(["Retail", "Online"])
	})

	it("reads a field's type override before its data set type", () => {
		const visual = compose({ family: "bar", encodings: { x: "region", length: "sales" } })
		const overridden: Visual = { ...visual, fieldTypeOverrides: { region: "quantitative" } }
		expect(settingKeysOf(overridden, fields, rows).levels).toEqual({})
	})

	it("caps the levels listed per field at 200", () => {
		const many = Array.from({ length: 250 }, (_, i) => ({ region: `r${i}`, segment: "Retail", sales: i }))
		const keys = settingKeysOf(compose({ family: "bar", encodings: { x: "region", length: "sales" } }), fields, many)
		expect(keys.levels.region).toHaveLength(200)
	})
})

describe("composedLabelIds", () => {
	it("is empty for a chart with no data labels", () => {
		expect(composedLabelIds(compose({ family: "bar", encodings: { x: "region", length: "sales" } }))).toEqual([])
	})
})
