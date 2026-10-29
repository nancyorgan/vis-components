import { describe, expect, it } from "vitest"

import { CAFE, contextFor, DATES } from "../../../../testSupport/chartSpecFixtures"
import { DEFAULT_CATEGORICAL_HUE_CONFIG } from "../channelConfig"
import type { Visual } from "../types"
import { hydrateVisual } from "../visualDefaults"
import { composeChartEdit, composeChartSpec, type ComposeVisualResult } from "./composeVisual"
import { settingRows } from "./settings"

const DATASETS = [CAFE, DATES]

const ok = (r: ComposeVisualResult): Visual => {
	if (!r.ok) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join("; "))
	return r.visual
}

const errorsOf = (r: ComposeVisualResult) => {
	if (r.ok) throw new Error("expected errors")
	return r.errors
}

const create = (extra: Record<string, unknown> = {}) =>
	composeChartSpec(
		{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", length: "muffins", hue: "flavor" }, ...extra },
		contextFor(DATASETS, CAFE.id)
	)

const bars = (): Visual => ok(create())

const edit = (visual: Visual, input: unknown) =>
	composeChartEdit(visual, input, { ...contextFor(DATASETS, visual.datasetId), now: visual.updatedAt + 1 })

const set = (visual: Visual, settings: unknown) => edit(visual, { settings })

describe("settings keyed by data", () => {
	it("sets a per-panel axis bound", () => {
		const v = ok(set(bars(), { channelConfigs: { facet: { panelAxisOverrides: { "331": { yMax: 100_000 } } } } }))
		expect(v.channelConfigs.facet?.panelAxisOverrides?.["331"]?.yMax).toBe(100_000)
	})

	it("sets a line color per level", () => {
		const v = ok(set(bars(), { channelConfigs: { colorSlots: { line: { hue: { colors: { Bran: "#123456" } } } } } }))
		const hue = v.channelConfigs.colorSlots?.line?.hue
		expect(hue && "colors" in hue ? hue.colors.Bran : null).toBe("#123456")
	})

	it("hides a legend title keyed legend:hue", () => {
		const v = ok(set(bars(), { labelsConfig: { hiddenTitles: { "legend:hue": true } } }))
		expect(v.labelsConfig.hiddenTitles?.["legend:hue"]).toBe(true)
	})

	it("colors one level of one piece of a label", () => {
		const piece = { color: { field: "flavor", singleColor: "#000000", hue: { colors: { Bran: "#ff0000" } } } }
		const v = ok(set(bars(), { dataLabelsConfig: { pieces: { label: { flavor: piece } } } }))
		expect(v.dataLabelsConfig?.pieces?.label?.flavor?.color).toMatchObject(piece.color)
	})

	it("refuses a value of the wrong type, or a color that isn't one, in a map", () => {
		const errors = errorsOf(
			set(bars(), {
				channelConfigs: {
					pattern: { overrides: { Bran: "dots" } },
					hue: { colors: { Lemon: "bluish", Bran: 5 } },
					facet: { panelAxisOverrides: { All: { yMax: "high" } } },
				},
				labelsConfig: { hiddenTitles: { "legend:hue": "yes" } },
			})
		)
		expect(Object.fromEntries(errors.map((e) => [e.path, e.message]))).toEqual({
			"settings.channelConfigs.pattern.overrides.Bran": expect.stringMatching(/must be one of "none"/),
			"settings.channelConfigs.hue.colors.Lemon": expect.stringMatching(/isn't a color/),
			"settings.channelConfigs.hue.colors.Bran": expect.stringMatching(/string, not a number/),
			"settings.channelConfigs.facet.panelAxisOverrides.All.yMax": expect.stringMatching(/number.*not a string/),
			'settings.labelsConfig.hiddenTitles["legend:hue"]': expect.stringMatching(/boolean, not a string/),
		})
	})

	it("refuses a key outside a closed map", () => {
		const errors = errorsOf(set(bars(), { labelsConfig: { hiddenTitles: { "legend:colour": true } } }))
		expect(errors[0]).toMatchObject({ path: 'settings.labelsConfig.hiddenTitles["legend:colour"]' })
	})
})

describe("slices beyond the configs", () => {
	it("writes a screen-reader description and a data table", () => {
		const v = ok(set(bars(), { accessibilityConfig: { description: "Muffins by month" }, dataTableConfig: { enabled: true } }))
		expect(v.accessibilityConfig?.description).toBe("Muffins by month")
		expect(v.dataTableConfig?.enabled).toBe(true)
	})

	it("refuses the spec's own keys and the chart's identity", () => {
		const errors = errorsOf(set(bars(), { encodings: { x: { field: "month" } }, id: "vs-other" }))
		expect(errors.map((e) => e.path)).toEqual(["settings.encodings", "settings.id"])
		expect(errors[0]?.message).toMatch(/isn't a settings slice/)
	})
})

describe("lists keyed by id", () => {
	const labelled = () =>
		ok(
			set(bars(), {
				dataLabelsEncodings: { value: { field: null, multiField: true, fields: ["flavor", "muffins"] } },
				dataLabelsConfig: { composedLabels: [{ id: "flavor", template: "{flavor} ({muffins})" }] },
			})
		)

	it("gives a new entry an id, and keeps the ones the chart has", () => {
		const v1 = labelled()
		const v2 = ok(
			set(v1, { dataLabelsConfig: { composedLabels: [{ id: "flavor", template: "{flavor}" }, { template: "{muffins}" }] } })
		)
		const [kept, added] = v2.dataLabelsConfig?.composedLabels ?? []
		expect(kept).toEqual({ id: "flavor", template: "{flavor}" })
		expect(added?.id).toMatch(/^lbl-/)
		expect(added?.template).toBe("{muffins}")
	})

	it("refuses an id twice in one list, and an id the chart doesn't have", () => {
		const errors = errorsOf(
			set(labelled(), {
				dataLabelsConfig: {
					composedLabels: [
						{ id: "flavor", template: "a" },
						{ id: "flavor", template: "b" },
						{ id: "lbl-made-up", template: "c" },
					],
				},
			})
		)
		expect(errors.map((e) => e.path)).toEqual([
			"settings.dataLabelsConfig.composedLabels[1].id",
			"settings.dataLabelsConfig.composedLabels[2].id",
		])
		expect(errors[0]?.message).toMatch(/entry 0 has this id too/)
		expect(errors[1]?.message).toMatch(/leave "id" out of a new entry/)
	})

	it("replaces the list it is sent", () => {
		const v = ok(set(labelled(), { dataLabelsConfig: { composedLabels: [] } }))
		expect(v.dataLabelsConfig?.composedLabels).toEqual([])
	})
})

describe("settings checks", () => {
	it("changes what it names and nothing else", () => {
		const v0 = bars()
		const v1 = ok(set(v0, { legendConfig: { position: "top" }, channelConfigs: { x: { tickCount: 7 } } }))
		expect(v1.legendConfig?.position).toBe("top")
		expect({ ...v1.channelConfigs.x, tickCount: v0.channelConfigs.x?.tickCount }).toEqual(v0.channelConfigs.x)
		const rest = (v: Visual) => ({ ...v, legendConfig: null, channelConfigs: null, updatedAt: null })
		expect(rest(v1)).toEqual(rest(v0))
	})

	it("refuses unknown names with a suggestion, wrong types and unknown words", () => {
		const errors = errorsOf(
			set(bars(), { legendConfig: { postion: "top" }, channelConfigs: { x: { tickCount: "7" } }, tooltipConfig: { enabled: "on" } })
		)
		const byPath = Object.fromEntries(errors.map((e) => [e.path, e.message]))
		expect(byPath["settings.legendConfig.postion"]).toMatch(/did you mean "position"/)
		expect(byPath["settings.channelConfigs.x.tickCount"]).toMatch(/number, not a string/)
		expect(byPath["settings.tooltipConfig.enabled"]).toMatch(/boolean, not a string/)
		expect(errorsOf(set(bars(), { legendConfig: { position: "topp" } }))[0]?.message).toMatch(/did you mean "top"/)
	})

	it("checks the entries of a list, and the fields every entry needs", () => {
		const palette = errorsOf(set(bars(), { channelConfigs: { categoricalPalette: ["#123456", 7] } }))
		expect(palette.map((e) => e.path)).toEqual(["settings.channelConfigs.categoricalPalette[1]"])
		const stops = errorsOf(set(bars(), { channelConfigs: { hue: { customStops: [{ value: 0, color: "#fff", colr: "x" }] } } }))
		expect(stops[0]).toMatchObject({ path: "settings.channelConfigs.hue.customStops[0].colr", message: expect.stringMatching(/did you mean "color"/) })
		const rules = errorsOf(set(bars(), { dataLabelsConfig: { textColorRules: [{ color: "#000000" }] } }))
		expect(rules[0]).toMatchObject({ path: "settings.dataLabelsConfig.textColorRules[0]", message: expect.stringMatching(/"condition"/) })
	})

	it("keeps counts, sizes and opacities in range, and colors and fields real", () => {
		const paths = (settings: unknown) => errorsOf(set(bars(), settings)).map((e) => e.path)
		expect(paths({ channelConfigs: { y: { tickCount: 2.5 } } })).toEqual(["settings.channelConfigs.y.tickCount"])
		expect(paths({ channelConfigs: { connection: { thickness: -1 } } })).toEqual(["settings.channelConfigs.connection.thickness"])
		expect(paths({ channelConfigs: { connection: { thicknessField: "mufins" } } })).toEqual([
			"settings.channelConfigs.connection.thicknessField",
		])
		expect(errorsOf(set(bars(), { channelConfigs: { connection: { thicknessField: "mufins" } } }))[0]?.message).toMatch(
			/did you mean "muffins"/
		)
	})

	it("judges an entry of an object keyed by channel by the object's name", () => {
		const v = ok(set(bars(), { legendConfig: { swatchSizes: { opacity: 11 }, swatchOutlineWidths: { opacity: 1.5 } } }))
		expect(v.legendConfig?.swatchSizes?.opacity).toBe(11)
		expect(errorsOf(set(bars(), { legendConfig: { swatchOutlineColors: { hue: "bluish" } } }))[0]?.message).toMatch(/isn't a color/)
	})

	it("keeps what the chart already stores, even a field the data no longer has", () => {
		const stale = { ...bars() }
		stale.channelConfigs = {
			...stale.channelConfigs,
			colorSlots: { ...stale.channelConfigs.colorSlots, line: { field: "Type", singleColor: "#000000" } },
		}
		const sent = { channelConfigs: { colorSlots: { line: stale.channelConfigs.colorSlots?.line } }, legendConfig: { position: "top" } }
		expect(ok(set(stale, sent)).channelConfigs.colorSlots?.line?.field).toBe("Type")
		expect(errorsOf(set(bars(), sent))[0]?.path).toBe("settings.channelConfigs.colorSlots.line.field")
	})

	it("labels by what the Data Labels panel derives, as well as by the data", () => {
		const v = ok(set(bars(), { dataLabelsEncodings: { value: { field: "Bar total" } } }))
		expect(v.dataLabelsEncodings?.value.field).toBe("Bar total")
		expect(errorsOf(set(bars(), { dataLabelsEncodings: { value: { field: "Bar totl" } } }))[0]?.message).toMatch(
			/did you mean "Bar total"/
		)
	})

	it("points axis bounds at the axes key, and the retired legend toggle at hidden", () => {
		expect(errorsOf(set(bars(), { channelConfigs: { y: { min: 0 } } }))[0]?.message).toMatch(/"axes"/)
		expect(errorsOf(set(bars(), { legendConfig: { enabled: false } }))[0]?.message).toMatch(/"hidden"/)
	})

	it("refuses an empty slice, and constructor as a key", () => {
		expect(errorsOf(set(bars(), { legendConfig: {} }))[0]?.path).toBe("settings.legendConfig")
		expect(errorsOf(set(bars(), { channelConfigs: { hue: { colors: { constructor: "#fff" } } } }))[0]?.message).toMatch(/can't be used/)
	})

	it("colors the lines by a field through the line color slot, as the Color panel does", () => {
		const v = ok(set(bars(), { channelConfigs: { colorSlots: { line: { field: "flavor" } } } }))
		expect(v.channelConfigs.colorSlots?.line).toMatchObject({
			field: "flavor",
			hue: { kind: "categorical" },
			palette: v.channelConfigs.categoricalPalette,
		})
	})

	it("completes a new slot's hue as the Color panel makes one, so its swatches have colors", () => {
		const line = { field: "flavor", singleColor: "#000000", hue: { kind: "categorical" } }
		const v = ok(set(bars(), { channelConfigs: { colorSlots: { line } } }))
		expect(v.channelConfigs.colorSlots?.line?.hue).toEqual({ ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} })
		const quant = { field: "muffins", singleColor: "#000000", hue: { kind: "quantitative", palette: "plasma" } }
		const q = ok(set(bars(), { channelConfigs: { colorSlots: { line: quant } } }))
		expect(q.channelConfigs.colorSlots?.line?.hue).toMatchObject({ kind: "quantitative", palette: "plasma", lowColor: expect.any(String) })
	})

	it("takes a whole new slot as sent, and gives a slot with no field its single color", () => {
		const line = { field: "flavor", singleColor: "#000000", hue: { kind: "categorical", colors: { Bran: "#123456" }, stackMode: "group" } }
		expect(ok(set(bars(), { channelConfigs: { colorSlots: { line } } })).channelConfigs.colorSlots?.line).toEqual(line)
		const stem = ok(set(bars(), { channelConfigs: { colorSlots: { stem: { colorRules: [] } } } })).channelConfigs.colorSlots?.stem
		expect(stem).toEqual({ field: null, singleColor: expect.any(String), colorRules: [] })
	})

	it("refuses a new config missing what its shape needs", () => {
		const errors = errorsOf(set(bars(), { channelConfigs: { outlineHue: { kind: "categorical" }, opacity: { kind: "categorical" } } }))
		expect(errors).toEqual([
			{ path: "settings.channelConfigs.opacity", message: `this setting needs "overrides" when "kind" is "categorical"` },
		])
	})

	it("works in a create, after the spec's own keys, and reports with the other problems", () => {
		const v = ok(create({ title: "T", settings: { labelsConfig: { title: "Settings win" } } }))
		expect(v.labelsConfig.title).toBe("Settings win")
		expect(hydrateVisual(v)).toEqual(v)
		const errors = errorsOf(create({ encodings: { x: "nope", length: "muffins" }, settings: { legendConfig: { position: "topp" } } }))
		expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining(["encodings.x", "settings.legendConfig.position"]))
	})

	it("refuses settings that aren't a non-empty object", () => {
		expect(errorsOf(create({ settings: [] }))[0]?.path).toBe("settings")
	})
})

describe("settingRows", () => {
	it("lists every setting with its type and doc", () => {
		const rows = settingRows()
		const yMax = rows.find((r) => r.path === "channelConfigs.facet.panelAxisOverrides.*.yMax")
		expect(yMax).toMatchObject({ type: expect.stringMatching(/number/) })
		expect(rows.find((r) => r.path === "legendConfig.position")).toMatchObject({ type: "string", values: expect.arrayContaining(["top"]) })
		expect(rows.some((r) => r.path === "legendConfig.enabled")).toBe(false)
		expect(rows.every((r) => r.value === undefined)).toBe(true)
	})

	it("gives a visual's values, and a row for each of its entries of a map", () => {
		const v = ok(
			set(bars(), {
				channelConfigs: { hue: { colors: { Bran: "#123456" } } },
				labelsConfig: { hiddenTitles: { "legend:hue": true } },
			})
		)
		const rows = settingRows(v)
		expect(rows.find((r) => r.path === "channelConfigs.hue.colors.Bran")).toMatchObject({
			setting: "channelConfigs.hue.colors.*",
			type: "string",
			value: "#123456",
		})
		expect(rows.find((r) => r.path === "labelsConfig.hiddenTitles.legend:hue")?.value).toBe(true)
		expect(rows.find((r) => r.path === "labelsConfig.title")?.value).toBe(v.labelsConfig.title)
	})
})
