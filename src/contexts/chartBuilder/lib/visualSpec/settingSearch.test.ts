import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { stringifyJsonDangerous } from "../../../../lib/json"
import { extractSettingDocs, OUT, renderSettingDocs } from "../../../../../tooling/extract-setting-docs.js"
import { SYSTEM_LIGHT_THEME, themeOf } from "../systemThemes"
import type { Visual } from "../types"
import { newVisualDraft } from "../visualDefaults"
import { pathTokens, searchSettings, settingDoc, settingGroup } from "./settingSearch"
import { flattenSettings } from "./settings"

const rows = flattenSettings(newVisualDraft(themeOf(SYSTEM_LIGHT_THEME)) as Visual)
const paths = (q: string) => searchSettings(rows, q).settings.map((s) => s.path)

describe("searchSettings", () => {
	it("splits paths into words", () => {
		expect(pathTokens("channelConfigs.x.tickLabelAngle")).toEqual(["channel", "configs", "x", "tick", "label", "angle"])
		expect(pathTokens('dataLabelsConfig.fieldFormats["a b"]')).toContain("formats")
		expect(settingGroup("channelConfigs.x.gridlines.enabled")).toBe("channelConfigs.x")
		expect(settingGroup("legendConfig.position")).toBe("legendConfig")
	})

	it("keeps the old path-substring matches", () => {
		expect(paths("connection stroke")).toContain("channelConfigs.connection.strokeColor")
		expect(paths("legendConfig.position")).toContain("legendConfig.position")
	})

	it("ranks a whole-word match above a partial one", () => {
		expect(paths("tick")[0]).toMatch(/\.tick[A-Z]/)
	})

	it("finds settings through concept words and says which one matched", () => {
		const margin = searchSettings(rows, "margin")
		expect(margin.scope).toBe("rows")
		expect(margin.count).toBeGreaterThan(0)
		expect(margin.settings[0]?.matchedVia).toEqual([expect.stringMatching(/^margin → (pad|offset|gap|inset)$/)])
		expect(paths("spacing")).toContain("captionConfig.padding")
		expect(searchSettings(rows, "spacing").settings[0]?.matchedVia).toEqual(["spacing → pad"])
		expect(paths("make the lines between the areas white")).toContain("channelConfigs.connection.strokeColor")
		expect(paths("grid")).toContain("channelConfigs.x.gridlines.enabled")
	})

	it("searches doc comments, and returns them only when asked", () => {
		const plain = searchSettings(rows, "stroke")
		expect(plain.settings.some((s) => "description" in s)).toBe(false)
		const described = searchSettings(rows, "connection stroke", { includeDescriptions: true })
		const hit = described.settings.find((s) => s.path === "channelConfigs.connection.strokeColor")
		expect(hit?.description).toBe(settingDoc("channelConfigs.connection.strokeColor"))
		expect(hit?.description).toMatch(/stroke/i)
	})

	it("returns a census for no words, and for words that match nothing", () => {
		const all = searchSettings(rows, "  ")
		expect(all.scope).toBe("census")
		expect(all.count).toBe(rows.length)
		expect(all.settings).toEqual([])
		expect(all.groups?.reduce((n, g) => n + g.count, 0)).toBe(rows.length)
		expect(all.groups?.map((g) => g.group)).toContain("channelConfigs.x")
		expect(all.next).toMatch(/search with words/)
		const none = searchSettings(rows, "gridlnes")
		expect(none.scope).toBe("census")
		expect(none.message).toBe('no setting matches "gridlnes"')
		expect(none.closest).toContain("gridlines")
	})

	it("pages within a size budget", () => {
		const first = searchSettings(rows, "channel", { budget: 2_000 })
		expect(first.truncated).toBe(true)
		expect(first.returned).toBe(first.settings.length)
		expect(stringifyJsonDangerous(first.settings as never).length).toBeLessThan(2_600)
		const second = searchSettings(rows, "channel", { budget: 2_000, offset: first.nextOffset })
		expect(second.settings[0]?.path).not.toBe(first.settings[0]?.path)
		expect(searchSettings(rows, "channel", { limit: 3 }).settings).toHaveLength(3)
	})
})

describe("settingDocs.json", () => {
	it("matches the doc comments in the config types (pnpm setting-docs)", () => {
		expect(readFileSync(OUT, "utf8")).toBe(renderSettingDocs(extractSettingDocs()))
	}, 60_000)

	it("describes most default settings", () => {
		const described = rows.filter((r) => settingDoc(r.path) !== undefined).length
		expect(described / rows.length).toBeGreaterThan(0.3)
	})
})
