import { describe, expect, it } from "vitest"

import { CAFE, contextFor, DATES, THEME } from "../../../../testSupport/chartSpecFixtures"
import { newTextAnnotation } from "../annotationsConfig"
import { getChartMode } from "../chartMode"
import { DEFAULT_MAP_CONFIG } from "../mapConfig"
import { themeOf } from "../systemThemes"
import { textAnnotationStyleFromTheme } from "../themeConfig"
import { emptyEncodings, type Visual } from "../types"
import { composeChartEdit, composeChartSpec, type ComposeVisualResult } from "./composeVisual"

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

const set = (visual: Visual, settings: unknown) =>
	composeChartEdit(visual, { settings }, { ...contextFor(DATASETS, visual.datasetId), now: visual.updatedAt + 1 })

describe("annotations", () => {
	it("starts a new text as the panel's Add does, with the theme's style, then takes what was sent", () => {
		const v = ok(set(bars(), { annotationsConfig: { texts: [{ text: "Lower Value", x: 0.9, y: 0.1 }] } }))
		const [text] = v.annotationsConfig?.texts ?? []
		const made = newTextAnnotation("", textAnnotationStyleFromTheme(themeOf(THEME)))
		expect(text).toEqual({ ...made, id: expect.stringMatching(/^text-/), name: "Text 1", text: "Lower Value", x: 0.9, y: 0.1 })
	})

	it("names each new one after the ones before it, of every kind", () => {
		const v = ok(
			set(bars(), {
				annotationsConfig: {
					rectangles: [{ xMin: 0, xMax: 0.5 }, { name: "Band" }, {}],
					lineSegments: [{}],
					circles: [{}],
				},
			})
		)
		expect(v.annotationsConfig?.rectangles.map((r) => r.name)).toEqual(["Rectangle 1", "Band", "Rectangle 3"])
		expect(v.annotationsConfig?.rectangles.map((r) => r.id.split("-")[0])).toEqual(["rect", "rect", "rect"])
		expect(v.annotationsConfig?.lineSegments[0]).toMatchObject({ name: "Line 1", id: expect.stringMatching(/^line-/) })
		expect(v.annotationsConfig?.circles[0]).toMatchObject({ name: "Circle 1", id: expect.stringMatching(/^circle-/) })
	})

	it("keeps an entry the chart has, sent back whole, and drops one left out of the list", () => {
		const v1 = ok(set(bars(), { annotationsConfig: { texts: [{ text: "a" }, { text: "b" }] } }))
		const [a] = v1.annotationsConfig?.texts ?? []
		const v2 = ok(set(v1, { annotationsConfig: { texts: [{ ...a, textAlign: "right" }, { text: "c" }] } }))
		expect(v2.annotationsConfig?.texts.map((t) => [t.id === a?.id, t.text, t.name])).toEqual([
			[true, "a", "Text 1"],
			[false, "c", "Text 2"],
		])
		expect(v2.annotationsConfig?.texts[0]?.textAlign).toBe("right")
	})

	it("refuses an id the chart doesn't have, one used twice, and a field the kind doesn't take", () => {
		const v1 = ok(set(bars(), { annotationsConfig: { texts: [{ text: "a" }] } }))
		const [a] = v1.annotationsConfig?.texts ?? []
		const errors = errorsOf(
			set(v1, { annotationsConfig: { texts: [a, { ...a }, { id: "text-made-up", text: "x" }, { text: "y", align: "right" }] } })
		)
		expect(errors.map((e) => e.path)).toEqual([
			"settings.annotationsConfig.texts[1].id",
			// An entry with an id isn't new, so it isn't completed either.
			"settings.annotationsConfig.texts[2]",
			"settings.annotationsConfig.texts[2].id",
			"settings.annotationsConfig.texts[3].align",
		])
	})
})

describe("data labels", () => {
	it("labels by one field, switching the Value row back from several", () => {
		const v = ok(set(bars(), { dataLabelsEncodings: { value: { field: "flavor" } } }))
		expect(v.dataLabelsEncodings?.value).toMatchObject({ field: "flavor", multiField: false })
		expect(errorsOf(set(bars(), { dataLabelsEncodings: { value: { field: "flavr" } } }))[0]?.message).toMatch(
			/did you mean "flavor"/
		)
	})

	it("labels by several fields, the composed labels following the checklist", () => {
		const v1 = ok(set(bars(), { dataLabelsEncodings: { value: { fields: ["flavor", "muffins"] } } }))
		expect(v1.dataLabelsEncodings?.value).toEqual({ field: null, multiField: true, fields: ["flavor", "muffins"] })
		expect(v1.dataLabelsConfig?.composedLabels).toEqual([
			{ id: "flavor", template: "{flavor}" },
			{ id: "muffins", template: "{muffins}" },
		])
		const v2 = ok(set(v1, { dataLabelsEncodings: { value: { fields: ["muffins", "coffees"] } } }))
		expect(v2.dataLabelsConfig?.composedLabels?.map((l) => l.id)).toEqual(["muffins", "coffees"])
	})

	it("keeps composed labels the patch sends, and refuses a field the data lacks", () => {
		const v = ok(
			set(bars(), {
				dataLabelsEncodings: { value: { fields: ["flavor", "muffins"] } },
				dataLabelsConfig: { composedLabels: [{ id: "flavor", template: "{flavor} ({muffins})" }] },
			})
		)
		expect(v.dataLabelsConfig?.composedLabels).toEqual([{ id: "flavor", template: "{flavor} ({muffins})" }])
		const errors = errorsOf(set(bars(), { dataLabelsEncodings: { value: { fields: ["flavor", "mufins"] } } }))
		expect(errors[0]).toMatchObject({ path: "settings.dataLabelsEncodings.value.fields[1]" })
	})

	it("refuses a field checked twice, which would make two labels with one id", () => {
		const errors = errorsOf(set(bars(), { dataLabelsEncodings: { value: { fields: ["flavor", "flavor"] } } }))
		expect(errors).toEqual([
			{ path: "settings.dataLabelsEncodings.value.fields[1]", message: `"flavor" is checked twice (fields[0] too); check each field once` },
		])
	})

	it("refuses a checklist that would leave two composed labels with one id", () => {
		const v1 = ok(set(bars(), { dataLabelsEncodings: { value: { fields: ["flavor"] } } }))
		const twice = { ...v1, dataLabelsConfig: { ...v1.dataLabelsConfig, composedLabels: [{ id: "flavor", template: "{flavor}" }, { id: "flavor", template: "{flavor}!" }] } } as Visual
		const errors = errorsOf(set(twice, { dataLabelsEncodings: { value: { fields: ["flavor", "muffins"] } } }))
		expect(errors).toEqual([
			{ path: "settings.dataLabelsConfig.composedLabels", message: expect.stringMatching(/"flavor" twice/) },
		])
	})

	it("starts a Bar total where a total reads as the bar's", () => {
		const v = ok(set(bars(), { dataLabelsEncodings: { value: { field: "Bar total" } } }))
		expect(v.dataLabelsConfig).toMatchObject({ labelPoints: "last", labelPointsScope: "stack", barLabelPosition: "outside-end" })
	})

	it("starts a checked Bar total there too, unless the patch places it", () => {
		const v = ok(set(bars(), { dataLabelsEncodings: { value: { fields: ["flavor", "Bar total"] } } }))
		expect(v.dataLabelsConfig).toMatchObject({
			fieldLabelPoints: { "Bar total": "last" },
			fieldLabelPointsScope: { "Bar total": "stack" },
			fieldBarPlacements: { "Bar total": { position: "outside-end" } },
		})
		expect(v.dataLabelsConfig?.fieldLabelPoints?.flavor).toBeUndefined()
		const placed = ok(
			set(bars(), {
				dataLabelsEncodings: { value: { fields: ["Bar total"] } },
				dataLabelsConfig: { fieldBarPlacements: { "Bar total": { position: "inside-end" } } },
			})
		)
		expect(placed.dataLabelsConfig?.fieldBarPlacements?.["Bar total"]?.position).toBe("inside-end")
		expect(placed.dataLabelsConfig?.fieldLabelPoints?.["Bar total"]).toBe("last")
	})

	it("labels a map made in the editor", () => {
		// A spec can't make a map yet; the editor can, and its labels are settable.
		const v0 = bars()
		const map: Visual = {
			...v0,
			encodings: { ...emptyEncodings(), connection: v0.encodings.x, hue: v0.encodings.length },
			mapConfig: { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" },
		}
		expect(getChartMode(map.encodings, undefined, map.channelConfigs, map.mapConfig)).toBe("geo-choropleth")
		const v = ok(set(map, { dataLabelsEncodings: { value: { field: "muffins" } } }))
		expect(v.dataLabelsEncodings?.value).toMatchObject({ field: "muffins", multiField: false })
	})
})

describe("level orders", () => {
	const ordered = (v: Visual) => v.fieldLevelOrders?.flavor

	it("orders levels by another field, as the Order-by picker does, and remembers the choice", () => {
		const v = ok(set(bars(), { fieldLevelOrderSpecs: { flavor: { by: "field", byField: "coffees", decreasing: true } } }))
		expect(ordered(v)).toEqual(["Blueberry", "Bran", "Lemon"])
		expect(v.fieldLevelOrderSpecs?.flavor).toEqual({ by: "field", byField: "coffees", decreasing: true })
		const up = ok(set(bars(), { fieldLevelOrderSpecs: { flavor: { by: "field", byField: "coffees" } } }))
		expect(ordered(up)).toEqual(["Lemon", "Bran", "Blueberry"])
	})

	it("orders alphabetically within a scope, and a new choice replaces the old one whole", () => {
		const v1 = ok(
			set(bars(), {
				fieldLevelOrderSpecs: { flavor: { by: "field", byField: "muffins", scopeField: "month", scopeLevel: "2026-01" } },
			})
		)
		expect(v1.fieldLevelOrderSpecs?.flavor).toMatchObject({ scopeLevel: "2026-01" })
		const v2 = ok(set(v1, { fieldLevelOrderSpecs: { flavor: { by: "alphabetical", decreasing: true } } }))
		expect(ordered(v2)).toEqual(["Lemon", "Bran", "Blueberry"])
		expect(v2.fieldLevelOrderSpecs?.flavor).toEqual({ by: "alphabetical", decreasing: true })
	})

	it("clears the choice when the order is set by hand, and keeps both when both are sent", () => {
		const v1 = ok(set(bars(), { fieldLevelOrderSpecs: { flavor: { by: "alphabetical" } } }))
		const v2 = ok(set(v1, { fieldLevelOrders: { flavor: ["Bran", "Lemon", "Blueberry"] } }))
		expect(ordered(v2)).toEqual(["Bran", "Lemon", "Blueberry"])
		expect(v2.fieldLevelOrderSpecs?.flavor).toBeUndefined()
		const copy = ok(
			set(bars(), {
				fieldLevelOrders: { flavor: ["Bran", "Lemon", "Blueberry"] },
				fieldLevelOrderSpecs: { flavor: { by: "alphabetical" } },
			})
		)
		expect(ordered(copy)).toEqual(["Bran", "Lemon", "Blueberry"])
		expect(copy.fieldLevelOrderSpecs?.flavor).toEqual({ by: "alphabetical" })
	})

	it("refuses an order of a measure, by a category, by a missing field, or in a missing scope level", () => {
		const paths = (settings: unknown) => errorsOf(set(bars(), settings)).map((e) => e.path)
		expect(paths({ fieldLevelOrderSpecs: { muffins: { by: "alphabetical" } } })).toEqual(["settings.fieldLevelOrderSpecs.muffins"])
		expect(paths({ fieldLevelOrderSpecs: { flavor: { by: "field", byField: "month" } } })).toEqual([
			"settings.fieldLevelOrderSpecs.flavor.byField",
		])
		expect(paths({ fieldLevelOrderSpecs: { flavor: { by: "field" } } })).toEqual(["settings.fieldLevelOrderSpecs.flavor"])
		expect(paths({ fieldLevelOrderSpecs: { flavor: { by: "field", byField: "cofees" } } })).toEqual([
			"settings.fieldLevelOrderSpecs.flavor.byField",
		])
		expect(
			paths({ fieldLevelOrderSpecs: { flavor: { by: "field", byField: "muffins", scopeField: "month", scopeLevel: "2025-12" } } })
		).toEqual(["settings.fieldLevelOrderSpecs.flavor.scopeLevel"])
	})

	it("orders in a create too", () => {
		const v = ok(create({ settings: { fieldLevelOrderSpecs: { flavor: { by: "alphabetical", decreasing: true } } } }))
		expect(ordered(v)).toEqual(["Lemon", "Bran", "Blueberry"])
	})
})
