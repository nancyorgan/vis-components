// @vitest-environment node
import { describe, expect, it } from "vitest"

import { SETTING_CATALOG } from "../../src/contexts/chartBuilder/lib/applySettings"
import { composeVisual, type ChartSpec } from "../../src/contexts/chartBuilder/lib/chartSpec"
import { LIGHT_THEME_BASE } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type { Visual } from "../../src/contexts/chartBuilder/lib/types"
import { searchSettings, SETTINGS_PAGE_SIZE, type SettingSearchOptions } from "./settingSearch"

const deps = {
	theme: LIGHT_THEME_BASE,
	fields: [
		{ name: "region", type: "categorical" },
		{ name: "segment", type: "categorical" },
		{ name: "sales", type: "quantitative" },
		{ name: "date", type: "temporal" },
	] as const,
	now: 1000,
}

const compose = (over: Partial<ChartSpec>): Visual => {
	const { visual, problems } = composeVisual(
		{
			datasetId: "ds-1",
			folderId: null,
			encodings: {},
			settings: { legendConfig: { position: "bottom" } },
			...over,
		},
		deps
	)
	expect(problems).toEqual([])
	return visual
}

const BAR = compose({ family: "bar", encodings: { x: "region", length: "sales", hue: "segment" } })
const LINE = compose({
	family: "line",
	encodings: { x: "date", y: "sales", hue: "segment", connection: "segment" },
})

const search = (query: string, more: Omit<SettingSearchOptions, "query"> = {}) =>
	searchSettings({ query, ...more })
const firstPaths = (query: string) => search(query).rows.map((r) => r.path)
/** Every page's paths, in order. */
const allPaths = (query: string): string[] => {
	const out: string[] = []
	let offset: number | null = 0
	while (offset !== null) {
		const page = search(query, { offset })
		for (const r of page.rows) out.push(r.path)
		offset = page.next
	}
	return out
}
const size = (value: unknown) => JSON.stringify(value).length

describe("searchSettings", () => {
	it("1. requires every word in any order, with synonyms and singulars, never mid-token", () => {
		expect(allPaths("color line")).toEqual(allPaths("line color"))
		expect(search("line color").total).toBeLessThan(Math.min(search("line").total, search("color").total))
		expect(search("colours").total).toBe(search("color").total)
		expect(search("labels").total).toBe(search("label").total)
		expect(firstPaths("average")).toContain("channelConfigs.x.distributionOverlay.markMean")
		expect(firstPaths("text size").some((p) => /font\.?size/i.test(p))).toBe(true)
		expect(firstPaths("grid")).toContain("channelConfigs.x.gridlines")
		expect(firstPaths("x axis grid")[0]).toBe("channelConfigs.x.gridlines")
		expect(firstPaths("data labels").some((p) => p.startsWith("dataLabelsEncodings"))).toBe(true)
		// "round" finds rounded corners, never the "round" inside "background".
		const round = allPaths("round")
		expect(round.length).toBeGreaterThan(0)
		expect(round).not.toContain("legendConfig.backgroundColor")
		for (const path of round) {
			const text = `${path} ${SETTING_CATALOG.paths[path].doc ?? ""}`
			const words = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/)
			expect(words.some((w) => w.startsWith("round")), path).toBe(true)
		}
	})

	it("2. toggle words rank but never exclude", () => {
		expect(search("show the legend").total).toBe(search("legend").total)
		expect(search("turn off the legend").total).toBe(search("legend").total)
		expect(firstPaths("show the legend")[0]).toBe("legendConfig.enabled")
		expect(firstPaths("set the legend position to")[0]).toBe("legendConfig.position")
	})

	it("3. ranks path hits over doc hits, exact over prefix, shallow first", () => {
		for (const q of ["legend position", "position legend"]) {
			const paths = firstPaths(q)
			expect(paths[0]).toBe("legendConfig.position")
			for (const p of paths) expect(p.toLowerCase()).toContain("legend")
		}
		expect(search("colour").total).toBe(search("color").total)
		expect(firstPaths("data labels").slice(0, 2).sort()).toEqual(["dataLabelsConfig", "dataLabelsEncodings"])
		// "grid" names the gridlines exactly; `*` maps sink below them.
		expect(firstPaths("grid").slice(0, 3)).toEqual([
			"channelConfigs.r.gridlines",
			"channelConfigs.x.gridlines",
			"channelConfigs.y.gridlines",
		])
	})

	it("4. mean and average find the box plot mean marker", () => {
		for (const q of ["mean", "average"]) {
			expect(firstPaths(q).slice(0, 3).sort()).toEqual([
				"channelConfigs.r.distributionOverlay.markMean",
				"channelConfigs.x.distributionOverlay.markMean",
				"channelConfigs.y.distributionOverlay.markMean",
			])
		}
	})

	it("5. pages of 12 with total, offset and next", () => {
		const first = search("line")
		expect(first.rows).toHaveLength(SETTINGS_PAGE_SIZE)
		expect(first.total).toBeGreaterThan(12)
		expect(first.offset).toBe(0)
		expect(first.next).toBe(12)
		const second = search("line", { offset: 12 })
		expect(second.offset).toBe(12)
		const seen = new Set(first.rows.map((r) => r.path))
		expect(second.rows.some((r) => seen.has(r.path))).toBe(false)
		const lastOffset = Math.floor((first.total - 1) / 12) * 12
		expect(search("line", { offset: lastOffset }).next).toBeNull()
	})

	it("6. rows carry path, type, a cut doc and only short enums", () => {
		for (const r of search("line").rows) {
			expect(typeof r.type).toBe("string")
			if (r.doc) expect(r.doc.length).toBeLessThanOrEqual(100)
		}
		const cut = search("leader lines").rows.find((r) => r.path === "dataLabelsConfig.leaderLines")
		const full = search("leader lines", { descriptions: true }).rows.find(
			(r) => r.path === "dataLabelsConfig.leaderLines"
		)
		expect(cut?.doc).toMatch(/…$/)
		expect(full?.doc).toBe(SETTING_CATALOG.paths["dataLabelsConfig.leaderLines"].doc)
		expect(full!.doc!.length).toBeGreaterThan(100)
		const position = search("legend position").rows[0]
		expect(position).toMatchObject({ type: "enum", values: ["bottom", "inside", "left", "right", "top"] })
		// A long enum names its option count; its values come with descriptions.
		const [longPath, long] = Object.entries(SETTING_CATALOG.paths).find(
			([p, e]) => (e.values?.length ?? 0) > 8 && !p.includes("*")
		)!
		const row = search(longPath).rows.find((r) => r.path === longPath)!
		expect(row.values).toBeUndefined()
		expect(row.type).toBe(`enum(${long.values!.length})`)
		expect(search(longPath, { descriptions: true }).rows.find((r) => r.path === longPath)?.values).toEqual(
			long.values
		)
	})

	it("7. with a visual, each row carries the chart's current value", () => {
		const position = search("legend position", { visual: BAR }).rows[0]
		expect(position).toMatchObject({ path: "legendConfig.position", value: "bottom" })
		const labels = search("data labels", { visual: BAR }).rows
		expect(labels.find((r) => r.path === "dataLabelsConfig")).toMatchObject({ valueOmitted: true })
		expect(labels.find((r) => r.path === "dataLabelsConfig")).not.toHaveProperty("value")
		for (const r of labels) if ("value" in r) expect(size(r.value)).toBeLessThanOrEqual(300)
		// `*` paths give the map above the star; `[]` paths a list.
		const star = search("channelConfigs.connection.lineColors", { visual: LINE }).rows.find(
			(r) => r.path === "channelConfigs.connection.lineColors.*"
		)
		expect(star).toBeDefined()
		expect(star?.value).toEqual(LINE.channelConfigs.connection?.lineColors)
		const list = search("annotationsConfig.texts", { visual: BAR }).rows.find(
			(r) => r.path === "annotationsConfig.texts[].id"
		)
		expect(list).toBeDefined()
		expect(Array.isArray(list?.value)).toBe(true)
		// No visual, no values.
		expect(search("legend position").rows[0]).not.toHaveProperty("value")
	})

	it("8. partial matches name the missing words; nothing at all names the closest word", () => {
		const partial = search("legend position zebra")
		expect(partial.missed).toEqual(["zebra"])
		expect(partial.total).toBe(search("legend position").total)
		expect(partial.rows[0].path).toBe("legendConfig.position")
		expect(search("legend position").missed).toBeUndefined()
		const none = search("legnd")
		expect(none).toMatchObject({ total: 0, rows: [], next: null, closest: "legend" })
	})

	it("9. no query: a census of groups, no rows, under 2,000 characters", () => {
		const census = searchSettings({})
		expect(census.rows).toEqual([])
		const groups = census.census!.map((c) => c.group)
		expect(groups).toEqual(expect.arrayContaining(["legendConfig", "channelConfigs.x", "dataLabelsConfig"]))
		expect(groups).not.toContain("channelConfigs")
		const counted = census.census!.reduce((sum, c) => sum + c.count, 0)
		expect(counted).toBe(Object.keys(SETTING_CATALOG.paths).length)
		expect(size(census)).toBeLessThan(2000)
		expect(searchSettings({ query: "  " }).census).toBeDefined()
		// A census group as the query lists the paths under it.
		const group = search("channelConfigs.x")
		expect(group.total).toBe(census.census!.find((c) => c.group === "channelConfigs.x")!.count)
		for (const r of group.rows) expect(r.path.startsWith("channelConfigs.x")).toBe(true)
	})

	it("10. common queries stay under 3,000 characters with a chart", () => {
		for (const visual of [BAR, LINE])
			for (const q of ["line", "line color", "legend position", "data labels"])
				expect(size(searchSettings({ query: q, visual })), q).toBeLessThan(3000)
	})
})
