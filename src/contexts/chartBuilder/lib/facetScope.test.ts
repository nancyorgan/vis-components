import { describe, expect, it } from "vitest"

import { dataLabelsOnPanel, onFacetPanel } from "./facetScope"

describe("onFacetPanel", () => {
	it("null / undefined keys apply to every panel", () => {
		expect(onFacetPanel(null, "A")).toBe(true)
		expect(onFacetPanel(undefined, "a|x")).toBe(true)
	})

	it("an array applies only to the listed panel keys", () => {
		expect(onFacetPanel(["A", "C"], "A")).toBe(true)
		expect(onFacetPanel(["A", "C"], "B")).toBe(false)
		expect(onFacetPanel([], "A")).toBe(false)
	})

	it("always applies on the unfaceted single panel and outside any panel", () => {
		// A selection stored while faceted must not blank an unfaceted chart.
		expect(onFacetPanel(["A"], "__all__")).toBe(true)
		expect(onFacetPanel(["A"], null)).toBe(true)
		expect(onFacetPanel([], null)).toBe(true)
	})
})

describe("dataLabelsOnPanel", () => {
	it("reads the Data Labels config's facetKeys", () => {
		expect(dataLabelsOnPanel({}, "A")).toBe(true)
		expect(dataLabelsOnPanel({ facetKeys: null }, "A")).toBe(true)
		expect(dataLabelsOnPanel({ facetKeys: ["B"] }, "A")).toBe(false)
		expect(dataLabelsOnPanel({ facetKeys: ["B"] }, "B")).toBe(true)
	})
})
