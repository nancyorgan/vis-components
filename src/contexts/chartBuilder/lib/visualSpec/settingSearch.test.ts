import { describe, expect, it } from "vitest"
import { stringifyJsonDangerous } from "../../../../lib/json"
import { SYSTEM_LIGHT_THEME, themeOf } from "../systemThemes"
import type { Visual } from "../types"
import { CHANNELS } from "../channels"
import { newVisualDraft } from "../visualDefaults"
import { pathTokens, searchSettings, settingDoc, settingGroup } from "./settingSearch"
import { SETTING_CATALOG } from "./settingCatalog"
import { flattenSettings, unsetSettings } from "./settings"

const rows = flattenSettings(newVisualDraft(themeOf(SYSTEM_LIGHT_THEME)) as Visual)
const paths = (q: string) => searchSettings(rows, q).settings.map((s) => s.path)
const top3 = (q: string) => paths(q).slice(0, 3)
const isEmptyObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0
const searchable = rows.filter((r) => !(r.type === "object" && isEmptyObject(r.value)))
const CHANNEL_NAMES = new Set(Object.keys(CHANNELS))

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
		expect(all.count).toBe(searchable.length)
		expect(all.settings).toEqual([])
		expect(all.groups?.reduce((n, g) => n + g.count, 0)).toBe(searchable.length)
		expect(all.groups?.every((g) => !g.group.startsWith("channelConfigs.") || CHANNEL_NAMES.has(g.group.split(".")[1] ?? ""))).toBe(true)
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

describe("searchSettings on everyday requests", () => {
	it("answers words that are Object.prototype keys", () => {
		for (const q of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
			expect(() => searchSettings(rows, q)).not.toThrow()
		}
	})

	it("finds the legend's hide map however it is switched off, not the ignored toggle", () => {
		for (const q of ["turn off the legend", "legend off", "remove legend", "no legend", "hide legend"]) {
			expect(top3(q), q).toContain("legendConfig.hidden")
			expect(top3(q), q).not.toContain("legendConfig.enabled")
		}
	})

	it("finds the line color slot's field for coloring lines by a field", () => {
		const all = [...rows, ...unsetSettings(newVisualDraft(themeOf(SYSTEM_LIGHT_THEME)) as Visual)]
		for (const q of ["line color by payer", "color the lines by region"]) {
			expect(searchSettings(all, q, { limit: 3 }).settings.map((r) => r.path), q).toContain("channelConfigs.colorSlots.line.field")
		}
	})

	it("treats comparatives as size", () => {
		const r = searchSettings(rows, "make it bigger")
		expect(r.scope).toBe("rows")
		expect(r.settings[0]?.matchedVia?.[0]).toMatch(/^bigger → /)
	})

	it("never echoes the query as a suggestion, and names the words that matched nothing", () => {
		const r = searchSettings(rows, "x axis label font size")
		expect(r.closest ?? []).not.toContain("x axis label font size")
		expect(r.next).not.toContain('try "x axis label font size"')
		const miss = searchSettings(rows, "legend flarb")
		expect(miss.unmatched).toEqual(["flarb"])
		expect(miss.settings[0]?.missed).toEqual(["flarb"])
		const none = searchSettings(rows, "gridlnes")
		expect(none.unmatched).toEqual(["gridlnes"])
		expect(none.closest).toEqual(["gridlines"])
	})

	it("never matches a word inside a token", () => {
		const round = searchSettings(rows, "round").settings
		const firstRadius = round.findIndex((s) => /radius/i.test(s.path))
		const firstBackground = round.findIndex((s) => /background/i.test(s.path) && !/radius/i.test(s.path))
		expect(firstRadius).toBeGreaterThanOrEqual(0)
		expect(firstBackground === -1 || firstRadius < firstBackground).toBe(true)
		// "background" holds "round" mid-token; only its doc comment can match.
		for (const s of round.filter((r) => /background/i.test(r.path) && !/radius/i.test(r.path))) expect(s.matchedVia).toEqual(["round → description"])
	})

	it("ranks the meant setting first", () => {
		expect(paths("line thickness")[0]).toBe("channelConfigs.connection.thickness")
		const lines = paths("lines")
		const firstConnection = lines.findIndex((p) => p.startsWith("channelConfigs.connection."))
		const firstGrid = lines.findIndex((p) => p.includes(".gridlines."))
		expect(firstConnection).toBeGreaterThanOrEqual(0)
		expect(firstGrid === -1 || firstConnection < firstGrid).toBe(true)
		expect(paths("axis label angle")[0]).toMatch(/^channelConfigs\.[xy]\.tickLabelAngle$/)
		expect(paths("x axis")[0]).toMatch(/^channelConfigs\.x\./)
		expect(paths("legend")[0]).toMatch(/^legendConfig\./)
	})

	it("scores a plural like its singular", () => {
		const plural = searchSettings(rows, "tick labels").settings
		const singular = searchSettings(rows, "tick label").settings
		expect(plural[0]?.path).toBe(singular[0]?.path)
		expect(paths("tick labels")).toContain("channelConfigs.x.tickLabelAngle")
	})

	it("leaves empty objects out: a patch cannot add keys to them", () => {
		expect(paths("legend font")).not.toContain("legendConfig.textFont")
	})

	it("says when an offset is past the last result", () => {
		const r = searchSettings(rows, "font", { offset: 9_999 })
		expect(r.returned).toBe(0)
		expect(r.next).toMatch(/past the last result/)
	})

	it("sends an oversized first value as a marker, within the budget", () => {
		const big = [{ path: "tooltipConfig.customHtml", type: "string", value: "x".repeat(50_000) }]
		const r = searchSettings(big, "custom html", { budget: 1_000 })
		expect(r.settings[0]).toMatchObject({ path: "tooltipConfig.customHtml", value: null, valueOmitted: true })
		expect(stringifyJsonDangerous(r.settings as never).length).toBeLessThan(1_000)
	})
})

describe("the setting catalog", () => {
	it("declares a type for every default setting outside data-keyed maps", () => {
		const untyped = rows.filter((r) => r.type !== "map" && SETTING_CATALOG.types[r.path.replace(/\[[^\]]*\]/g, "")] === undefined)
		expect(untyped.map((r) => r.path)).toEqual([])
	})

	it("describes most default settings", () => {
		const described = rows.filter((r) => settingDoc(r.path) !== undefined).length
		expect(described / rows.length).toBeGreaterThan(0.3)
	})
})
