import { describe, expect, it } from "vitest"

import {
	ALL_DATASETS,
	BLANKS,
	CAFE,
	contextFor,
	DATES,
	RATIOS,
	STATES,
} from "../../../../testSupport/chartSpecFixtures"
import type { Visual } from "../types"
import { hydrateVisual } from "../visualDefaults"
import { parseChartEdit } from "./chartSpec"
import {
	composeChartEdit,
	composeChartSpec,
	composeVisual,
	type ComposeVisualResult,
} from "./composeVisual"

const ctx = (datasetId: string, now = 1_700_000_000_000) => ({
	...contextFor(ALL_DATASETS, datasetId),
	now,
})

const ok = (r: ComposeVisualResult): Visual => {
	if (!r.ok) throw new Error(r.errors.map((e) => `${e.path}: ${e.message}`).join("; "))
	return r.visual
}

const errorsOf = (r: ComposeVisualResult) => {
	if (r.ok) throw new Error("expected errors")
	return r.errors
}

const scatter = (): Visual =>
	ok(
		composeVisual(
			{
				datasetId: RATIOS.id,
				folderId: null,
				encodings: { x: "Ratio", y: "Country", hue: "Country" },
				title: "Specialists per primary care physician",
			},
			ctx(RATIOS.id)
		)
	)

const edit = (visual: Visual, input: unknown, step = 1) =>
	composeChartEdit(visual, input, ctx(visual.datasetId ?? "", visual.updatedAt + step))

/** Every slice except the ones named, and the save time. */
const without = (v: Visual, ...keys: string[]) => {
	const copy: Record<string, unknown> = { ...v }
	for (const k of [...keys, "updatedAt"]) delete copy[k]
	return copy
}

describe("editing a chart step by step (the lollipop walkthrough)", () => {
	it("builds the lollipop one instruction at a time", () => {
		const v0 = scatter()

		const v1 = ok(edit(v0, { sort: { Country: { by: "Ratio", decreasing: true } } }))
		expect(v1.fieldLevelOrders?.Country?.[0]).toBe("Greece")
		expect(v1.fieldLevelOrders?.Country?.at(-1)).toBe("Colombia")
		expect(v1.fieldLevelOrderSpecs?.Country).toEqual({
			by: "field",
			byField: "Ratio",
			decreasing: true,
		})

		const v2 = ok(
			edit(v1, {
				colorThreshold: { field: "Ratio", at: 1, below: "#ff8a00", above: "#8e81ee" },
			})
		)
		const hue = v2.channelConfigs.hue
		expect(hue?.kind).toBe("categorical")
		if (hue?.kind !== "categorical") return
		expect(hue.colors.Colombia).toBe("#ff8a00")
		expect(hue.colors.Portugal).toBe("#ff8a00")
		expect(hue.colors.Chile).toBe("#8e81ee")
		expect(hue.colors.Greece).toBe("#8e81ee")

		const v3 = ok(edit(v2, { stems: { axis: "x", at: 1 } }))
		expect(v3.channelConfigs.connection?.axisStem).toBe("custom-x")
		expect(v3.channelConfigs.connection?.axisStemCustomX).toBe(1)

		const v4 = ok(
			edit(v3, {
				annotations: [
					{ kind: "line", x: [1, 1], y: ["Colombia", "Greece"], color: "#0A1E33", thickness: 2 },
					{ kind: "band", x: [0, 1], y: ["Colombia", "Portugal"], color: "#eeeeee" },
				],
			})
		)
		const [line] = v4.annotationsConfig?.lineSegments ?? []
		const [band] = v4.annotationsConfig?.rectangles ?? []
		expect(line).toMatchObject({
			xMin: 1,
			xMax: 1,
			yMin: "Colombia",
			yMax: "Greece",
			coordSystem: "values",
			lineColor: "#0A1E33",
			lineThickness: 2,
			zOrder: "behind",
		})
		expect(band).toMatchObject({
			xMin: 0,
			xMax: 1,
			yMin: "Colombia",
			yMax: "Portugal",
			coordSystem: "values",
			backgroundColor: "#eeeeee",
			zOrder: "behind",
		})
		expect(line?.id).not.toBe(band?.id)

		// Each step kept everything the earlier steps set.
		expect(v4.fieldLevelOrders).toEqual(v1.fieldLevelOrders)
		expect(v4.channelConfigs.hue).toEqual(v2.channelConfigs.hue)
		expect(v4.labelsConfig.title).toBe("Specialists per primary care physician")
		// And the result is complete: a load fills nothing in.
		expect(hydrateVisual(v4)).toEqual(v4)
	})
})

describe("an edit changes only what it names", () => {
	it("a title edit leaves every other slice alone", () => {
		const v0 = scatter()
		const v1 = ok(edit(v0, { title: "New title" }))
		expect(v1.labelsConfig.title).toBe("New title")
		expect(without(v1, "labelsConfig")).toEqual(without(v0, "labelsConfig"))
		expect({ ...v1.labelsConfig, title: v0.labelsConfig.title }).toEqual(v0.labelsConfig)
	})

	it("keeps the name, folder and id, and moves updatedAt forward", () => {
		const v0 = scatter()
		const v1 = ok(edit(v0, { subtitle: "OECD" }))
		expect(v1.id).toBe(v0.id)
		expect(v1.name).toBe(v0.name)
		expect(v1.folderId).toBe(v0.folderId)
		expect(v1.createdAt).toBe(v0.createdAt)
		expect(v1.updatedAt).toBeGreaterThan(v0.updatedAt)
	})

	it("renames and moves when asked", () => {
		const v1 = ok(edit(scatter(), { name: "Lollipop", folderId: "fl-trends" }))
		expect(v1.name).toBe("Lollipop")
		expect(v1.folderId).toBe("fl-trends")
	})

	it("adds annotations to the ones the chart already has", () => {
		const v1 = ok(edit(scatter(), { annotations: [{ kind: "text", x: 2, y: "Chile", text: "a" }] }))
		const v2 = ok(edit(v1, { annotations: [{ kind: "text", x: 3, y: "Spain", text: "b" }] }))
		expect(v2.annotationsConfig?.texts.map((t) => t.text)).toEqual(["a", "b"])
	})

	it("starts from a complete visual even when the stored one lacks slices", () => {
		const full = scatter()
		const legacy = { ...full } as Partial<Visual>
		delete legacy.annotationsConfig
		delete legacy.fieldLevelOrderSpecs
		delete legacy.captionConfig
		const v1 = ok(edit(legacy as Visual, { title: "t" }))
		expect(hydrateVisual(v1)).toEqual(v1)
	})
})

describe("changing encodings", () => {
	it("maps, remaps and unmaps channels", () => {
		const v0 = scatter()
		const v1 = ok(edit(v0, { encodings: { hue: null } }))
		expect(v1.encodings.hue).toEqual({ field: null })
		expect(v1.encodings.x).toEqual({ field: "Ratio" })
		const v2 = ok(edit(v1, { encodings: { hue: "Country" } }))
		expect(v2.encodings.hue).toEqual({ field: "Country" })
	})

	it("switches hue to a gradient for a quantitative field and back", () => {
		const v0 = ok(edit(scatter(), { colors: { Greece: "#123456" } }))
		const v1 = ok(edit(v0, { encodings: { hue: "Ratio" } }))
		expect(v1.channelConfigs.hue?.kind).toBe("quantitative")
		const v2 = ok(edit(v1, { encodings: { hue: "Country" } }))
		const hue = v2.channelConfigs.hue
		expect(hue?.kind).toBe("categorical")
		if (hue?.kind === "categorical") expect(hue.colors.Greece).toBe("#123456")
	})

	it("refuses a conflict and says how to clear it", () => {
		const errors = errorsOf(edit(scatter(), { encodings: { r: "Ratio" } }))
		expect(errors.some((e) => e.path === "encodings.r" && /set "x" and "y" to null to unmap them/.test(e.message))).toBe(true)
	})

	it("refuses unmapping every channel", () => {
		const errors = errorsOf(edit(scatter(), { encodings: { x: null, y: null, hue: null } }))
		expect(errors.map((e) => e.message)).toContain("an edit can't unmap every channel")
	})

	it("clears the line-length fallback when length is unmapped", () => {
		const bars = ok(
			composeVisual(
				{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", length: "muffins" } },
				ctx(CAFE.id)
			)
		)
		const withFallback = { ...bars, channelConfigs: { ...bars.channelConfigs, defaultLength: 12 } }
		const v1 = ok(edit(withFallback, { encodings: { length: null, y: "coffees" } }))
		expect(v1.channelConfigs.defaultLength).toBeNull()
	})
})

describe("edit checks", () => {
	it.each([
		[{ datasetId: "x" }, "datasetId"],
		[{ themeId: "x" }, "themeId"],
		[{ datasetVersionId: "x" }, "datasetVersionId"],
		[{ encodings: { x: "Nope" } }, "encodings.x"],
		[{ sort: { Ratio: { by: "Country" } } }, "sort.Ratio"],
		[{ sort: { Country: { by: "Country" } } }, "sort.Country.by"],
		[{ sort: { Country: { by: "Ratio" } }, order: { Country: ["Chile"] } }, "order.Country"],
		[{ stems: { axis: "y", at: 1 } }, "stems.at"],
		[{ stems: { axis: "z" } }, "stems.axis"],
		[{ colorThreshold: { field: "Country", at: 1, below: "#000", above: "#fff" } }, "colorThreshold.field"],
		[{ colorThreshold: { field: "Ratio", at: 1, below: "red", above: "#fff" } }, "colorThreshold.below"],
		[{ annotations: [{ kind: "band", x: [0, 1], y: ["Atlantis", "Greece"] }] }, "annotations[0].y"],
		[{ annotations: [{ kind: "band", x: ["a", "b"], y: ["Chile", "Greece"] }] }, "annotations[0].x"],
		[{ annotations: [{ kind: "line", x: [1], y: ["Chile", "Greece"] }] }, "annotations[0].x"],
		[{ annotations: [{ kind: "arrow" }] }, "annotations[0].kind"],
		[{ annotations: [{ kind: "text", x: 1, y: "Chile", text: "" }] }, "annotations[0].text"],
		[{ annotations: [{ kind: "band", x: [0, 1], y: ["Chile", "Greece"], opacity: 2 }] }, "annotations[0].opacity"],
		[{ wat: 1 }, "wat"],
	])("%j is refused at %s", (input, path) => {
		const errors = errorsOf(edit(scatter(), input))
		expect(errors.map((e) => e.path)).toContain(path)
	})

	it("refuses stems on a bar chart", () => {
		const bars = ok(
			composeVisual(
				{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", length: "muffins" } },
				ctx(CAFE.id)
			)
		)
		expect(errorsOf(edit(bars, { stems: { axis: "y" } })).map((e) => e.path)).toContain("stems")
	})

	it("refuses a threshold when a hue level straddles it", () => {
		const bars = ok(
			composeVisual(
				{
					datasetId: CAFE.id,
					folderId: null,
					encodings: { x: "month", length: "muffins", hue: "flavor" },
				},
				ctx(CAFE.id)
			)
		)
		const errors = errorsOf(
			edit(bars, { colorThreshold: { field: "muffins", at: 12, below: "#000", above: "#fff" } })
		)
		expect(errors[0]?.message).toMatch(/both sides of 12/)
	})

	it("parses an edit without dataset, folder or encodings", () => {
		expect(parseChartEdit({ title: "t" })).toEqual({ ok: true, edit: { encodings: {}, title: "t" } })
		expect(parseChartEdit({ encodings: { x: null } })).toEqual({
			ok: true,
			edit: { encodings: { x: null } },
		})
	})

	it("refuses a null channel in a create", () => {
		const r = composeVisual(
			{ datasetId: RATIOS.id, folderId: null, encodings: { x: null as unknown as string } },
			ctx(RATIOS.id)
		)
		expect(r.ok).toBe(false)
	})
})

describe("new spec keys in a create", () => {
	it("creates the whole lollipop in one spec", () => {
		const v = ok(
			composeVisual(
				{
					datasetId: RATIOS.id,
					folderId: null,
					encodings: { x: "Ratio", y: "Country", hue: "Country" },
					sort: { Country: { by: "alphabetical" } },
					colorThreshold: { field: "Ratio", at: 1, below: "#ff8a00", above: "#8e81ee" },
					stems: { axis: "x" },
					annotations: [{ kind: "band", x: [0, 1], y: ["Colombia", "Portugal"], front: true, label: "Below 1" }],
				},
				ctx(RATIOS.id)
			)
		)
		expect(v.fieldLevelOrders?.Country?.[0]).toBe("Canada")
		expect(v.channelConfigs.connection?.axisStem).toBe("y-axis")
		expect(v.annotationsConfig?.rectangles[0]).toMatchObject({ zOrder: "front", text: "Below 1" })
		expect(hydrateVisual(v)).toEqual(v)
	})
})

describe("a named family uses its quick-start variation", () => {
	it("a dumbbell connects each category's own points", () => {
		const v = ok(
			composeVisual(
				{
					datasetId: CAFE.id,
					folderId: null,
					family: "dumbbell",
					encodings: { y: "flavor", x: "muffins", hue: "month", shape: "month", area: "coffees" },
				},
				ctx(CAFE.id)
			)
		)
		expect(v.encodings.connection).toEqual({ field: "flavor" })
		expect(v.channelConfigs.connection?.fill).toBe("line")
	})

	it("no family leaves connection unmapped", () => {
		const v = ok(
			composeVisual(
				{
					datasetId: CAFE.id,
					folderId: null,
					encodings: { y: "flavor", x: "muffins", hue: "month" },
				},
				ctx(CAFE.id)
			)
		)
		expect(v.encodings.connection).toEqual({ field: null })
	})

	it("a family whose variations don't fit falls back to plain channels", () => {
		const v = ok(
			composeVisual(
				{ datasetId: RATIOS.id, folderId: null, family: "scatter", encodings: { x: "Ratio", y: "Country" } },
				ctx(RATIOS.id)
			)
		)
		expect(v.encodings.x).toEqual({ field: "Ratio" })
	})
})

describe("review findings", () => {
	const create = (spec: Record<string, unknown>, datasetId = CAFE.id) =>
		composeVisual({ datasetId, folderId: null, ...spec } as never, ctx(datasetId))

	it.each([
		["hexbin", { x: "muffins", y: "coffees" }],
		["circles", { area: "muffins", connection: "flavor" }],
		["treemap", { area: "muffins", connection: "flavor" }],
		["sunburst", { area: "muffins", connection: "flavor" }],
		["sankey", { area: "muffins", connection: "flavor" }],
		["chord", { area: "muffins", connection: "flavor" }],
	])("family %s is reachable", (family, encodings) => {
		const r = create({ family, encodings })
		expect(r.ok ? "ok" : r.errors.map((e) => e.message).join("; ")).toBe("ok")
	})

	it("a map family gets a geographic map config", () => {
		const v = ok(create({ family: "map", encodings: { connection: "State", hue: "Value" } }, STATES.id))
		expect(v.mapConfig?.coordSystem).toBe("geographic")
	})

	it("naming a family never changes the stack default", () => {
		const hue = (spec: Record<string, unknown>) => {
			const h = ok(create(spec)).channelConfigs.hue
			return h?.kind === "categorical" ? h.stackMode : undefined
		}
		const enc = { x: "month", length: "muffins", hue: "flavor" }
		expect(hue({ family: "bar", encodings: enc })).toBe(hue({ encodings: enc }))
		expect(hue({ family: "bar", encodings: { y: "month", length: "muffins", hue: "flavor" } })).toBe(hue({ encodings: enc }))
	})

	it("a family missing a channel says which", () => {
		const errors = errorsOf(create({ family: "line", encodings: { x: "month", y: "muffins" } }))
		expect(errors[0]?.path).toBe("family")
		expect(errors[0]?.message).toMatch(/"connection"/)
	})

	it("blank cells are not levels", () => {
		const v = ok(
			create(
				{ encodings: { y: "region", length: "n", hue: "region" }, order: { region: ["South", "North"] } },
				BLANKS.id
			)
		)
		expect(v.fieldLevelOrders?.region).toEqual(["South", "North"])
		const s = ok(create({ encodings: { y: "region", length: "n" }, sort: { region: { by: "alphabetical" } } }, BLANKS.id))
		expect(s.fieldLevelOrders?.region).toEqual(["North", "South"])
	})

	it("an edit keeps a legacy text encoding", () => {
		const v0 = ok(create({ encodings: { x: "month", y: "flavor", hue: "muffins" } }))
		const legacy = { ...v0, encodings: { ...v0.encodings, text: { field: "coffees" } } }
		const v1 = ok(edit(legacy, { title: "t" }))
		expect(v1.encodings.text).toEqual({ field: "coffees" })
	})

	it("axis bounds apply when the stored chart has no axis config", () => {
		const v0 = ok(create({ encodings: { y: "flavor", length: "muffins" } }))
		const bare = { ...v0, channelConfigs: { ...v0.channelConfigs, x: undefined } } as unknown as Visual
		const v1 = ok(edit(bare, { axes: { x: { max: 50 } } }))
		expect(v1.channelConfigs.x?.max).toBe(50)
	})

	it("refuses stack on a gradient hue and junk on a temporal axis", () => {
		const v0 = ok(create({ encodings: { x: "muffins", y: "coffees", hue: "muffins" } }))
		expect(errorsOf(edit(v0, { stack: "group" })).map((e) => e.path)).toContain("stack")
		const dated = ok(create({ encodings: { x: "day", y: "n" } }, DATES.id))
		const r = edit(dated, { annotations: [{ kind: "line", x: ["yesterday", "tomorrow"], y: [0, 3] }] })
		expect(errorsOf(r).map((e) => e.path)).toContain("annotations[0].x")
		ok(edit(dated, { annotations: [{ kind: "line", x: ["2026-01-02", "2026-01-03"], y: [0, 3] }] }))
	})

	it("refuses an empty edit", () => {
		expect(errorsOf(edit(scatter(), {}))[0]?.message).toMatch(/at least one setting/)
	})
})

describe("removing annotations", () => {
	it("removes every annotation of the named kinds, then adds", () => {
		const v1 = ok(
			edit(scatter(), {
				annotations: [
					{ kind: "band", x: [0, 1], y: ["Chile", "Greece"] },
					{ kind: "line", x: [1, 1], y: ["Chile", "Greece"] },
				],
			})
		)
		const v2 = ok(edit(v1, { removeAnnotations: ["band"] }))
		expect(v2.annotationsConfig?.rectangles).toEqual([])
		expect(v2.annotationsConfig?.lineSegments).toHaveLength(1)
		const v3 = ok(
			edit(v2, { removeAnnotations: ["line"], annotations: [{ kind: "line", x: [2, 2], y: ["Chile", "Greece"] }] })
		)
		expect(v3.annotationsConfig?.lineSegments.map((l) => l.xMin)).toEqual([2])
	})

	it("refuses unknown kinds, and the key in a create", () => {
		expect(errorsOf(edit(scatter(), { removeAnnotations: ["circle"] })).map((e) => e.path)).toContain("removeAnnotations")
		const r = composeChartSpec(
			{ datasetId: RATIOS.id, folderId: null, encodings: { x: "Ratio" }, removeAnnotations: ["band"] },
			ctx(RATIOS.id)
		)
		expect(r.ok).toBe(false)
	})
})

describe("Nancy's encoding names", () => {
	it("accepts the editor's labels as channel names", () => {
		const v = ok(
			composeChartSpec(
				{
					datasetId: CAFE.id,
					folderId: null,
					encodings: { "X position": "month", Length: "muffins", Color: "flavor", "facet (wrap)": "month" },
				},
				ctx(CAFE.id)
			)
		)
		expect(v.encodings.x).toEqual({ field: "month" })
		expect(v.encodings.length).toEqual({ field: "muffins" })
		expect(v.encodings.hue).toEqual({ field: "flavor" })
		expect(v.encodings.facet).toEqual({ field: "month" })
	})

	it("takes labels in an edit, null included", () => {
		const v1 = ok(edit(scatter(), { encodings: { color: null } }))
		expect(v1.encodings.hue).toEqual({ field: null })
		const v2 = ok(edit(v1, { encodings: { "Outline color": "Country" } }))
		expect(v2.encodings.outlineHue).toEqual({ field: "Country" })
	})

	it("refuses two names for one channel, and suggests labels", () => {
		const r = composeChartSpec(
			{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", "X Position": "flavor", length: "muffins" } },
			ctx(CAFE.id)
		)
		expect(r.ok ? [] : r.errors.map((e) => e.message)).toContainEqual(expect.stringMatching(/same channel/))
		const typo = composeChartSpec(
			{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", Lenght: "muffins" } },
			ctx(CAFE.id)
		)
		expect(typo.ok ? "" : typo.errors[0]?.message).toMatch(/did you mean/)
	})
})

describe("reshape and derived variables", () => {
	const WIDE = "ds-cafe"
	it("melts wide columns and charts the result", () => {
		const v = ok(
			composeChartSpec(
				{
					datasetId: WIDE,
					folderId: null,
					reshape: { idFields: ["month", "flavor"], meltFields: ["muffins", "coffees"], variableName: "item", valueName: "sold" },
					encodings: { x: "month", length: "sold", hue: "item" },
				},
				ctx(CAFE.id)
			)
		)
		expect(v.reshapeConfig).toEqual({ idFields: ["month", "flavor"], meltFields: ["muffins", "coffees"], variableName: "item", valueName: "sold" })
		expect(v.encodings.hue).toEqual({ field: "item" })
	})

	it("builds a custom legend from a rules variable (Ford's Long Type)", () => {
		const v = ok(
			composeChartSpec(
				{
					datasetId: CAFE.id,
					folderId: null,
					derivedVariables: [
						{
							name: "Long Flavor",
							kind: "rules",
							rules: {
								rules: [
									{ condition: '{flavor} == "Bran"', output: "Bran (high fiber)" },
									{ condition: '{flavor} == "Lemon"', output: "Lemon poppy seed" },
								],
								fallback: "{flavor}",
							},
						},
						{ name: "Total", kind: "math", math: { formula: "{muffins} + {coffees}" } },
					],
					encodings: { x: "month", length: "Total", hue: "Long Flavor" },
					colors: { "Bran (high fiber)": "#123456" },
				},
				ctx(CAFE.id)
			)
		)
		expect(v.derivedVariablesConfig?.variables.map((d) => d.name)).toEqual(["Long Flavor", "Total"])
		const hue = v.channelConfigs.hue
		expect(hue?.kind === "categorical" ? hue.colors["Bran (high fiber)"] : null).toBe("#123456")
	})

	it("reports the editor's own problems with a derived variable", () => {
		const r = composeChartSpec(
			{
				datasetId: CAFE.id,
				folderId: null,
				derivedVariables: [
					{ name: "Bad", kind: "math", math: { formula: "{muffins} + {nope}" } },
					{ name: "Text math", kind: "math", math: { formula: "{flavor} * 2" } },
					{ name: "Odd", kind: "rules", rules: { rules: [{ condition: "{flavor} ==", output: "x" }], fallback: "" } },
				],
				encodings: { x: "month", length: "muffins" },
			},
			ctx(CAFE.id)
		)
		const paths = errorsOf(r).map((e) => e.path)
		expect(paths).toEqual(expect.arrayContaining(["derivedVariables[0]", "derivedVariables[1]", "derivedVariables[2]"]))
	})

	it("refuses a melt of a field that isn't there", () => {
		const r = composeChartSpec(
			{ datasetId: CAFE.id, folderId: null, reshape: { meltFields: ["mufins"] }, encodings: { x: "month" } },
			ctx(CAFE.id)
		)
		expect(errorsOf(r)[0]).toMatchObject({ path: "reshape.meltFields" })
		expect(errorsOf(r)[0]?.message).toMatch(/did you mean "muffins"/)
	})

	it("an edit replaces a derived variable by name, and turns a reshape off", () => {
		const v0 = ok(
			composeChartSpec(
				{
					datasetId: CAFE.id,
					folderId: null,
					reshape: { idFields: ["month"], meltFields: ["muffins", "coffees"] },
					derivedVariables: [{ name: "Label", kind: "concat", concat: { template: "{month}!" } }],
					encodings: { x: "month", length: "value", hue: "category" },
				},
				ctx(CAFE.id)
			)
		)
		const v1 = ok(edit(v0, { derivedVariables: [{ name: "Label", kind: "concat", concat: { template: "{month}?" } }] }))
		expect(v1.derivedVariablesConfig?.variables).toHaveLength(1)
		expect(v1.derivedVariablesConfig?.variables[0]?.concat?.template).toBe("{month}?")
		expect(v1.derivedVariablesConfig?.variables[0]?.id).toBe(v0.derivedVariablesConfig?.variables[0]?.id)
		const off = edit(v1, { reshape: null })
		expect(errorsOf(off).map((e) => e.message).join(" ")).toMatch(/no longer has|value|category/)
		ok(edit(v1, { reshape: null, encodings: { length: "muffins", hue: null } }))
	})
})

describe("temporal axis bounds", () => {
	it("takes dates or epoch ms on a temporal axis, numbers only on a quantitative one", () => {
		const v = ok(
			composeChartSpec(
				{ datasetId: DATES.id, folderId: null, encodings: { x: "day", y: "n" }, axes: { x: { min: "2026-01-01", max: 1767484800000 }, y: { max: 5 } } },
				ctx(DATES.id)
			)
		)
		expect(v.channelConfigs.x?.min).toBe(new Date(2026, 0, 1).getTime())
		expect(v.channelConfigs.x?.max).toBe(1767484800000)
		const bad = composeChartSpec(
			{ datasetId: DATES.id, folderId: null, encodings: { x: "day", y: "n" }, axes: { y: { max: "2026-01-01" } } },
			ctx(DATES.id)
		)
		expect(errorsOf(bad).map((e) => e.path)).toContain("axes.y.max")
	})
})

describe("settings by their stored names", () => {
	it("changes a setting the spec has no key for, and nothing else", () => {
		const v0 = scatter()
		const v1 = ok(edit(v0, { settings: { legendConfig: { position: "top" }, channelConfigs: { x: { tickCount: 7 } } } }))
		expect(v1.legendConfig?.position).toBe("top")
		expect(v1.channelConfigs.x?.tickCount).toBe(7)
		expect({ ...v1.channelConfigs.x, tickCount: v0.channelConfigs.x?.tickCount }).toEqual(v0.channelConfigs.x)
		expect(without(v1, "legendConfig", "channelConfigs")).toEqual(without(v0, "legendConfig", "channelConfigs"))
	})

	it("makes the lines between stacked areas white (Ford's case)", () => {
		const areas = ok(
			composeChartSpec(
				{ datasetId: CAFE.id, folderId: null, family: "area", encodings: { x: "month", length: "muffins", hue: "flavor", connection: "flavor" } },
				ctx(CAFE.id)
			)
		)
		const v1 = ok(edit(areas, { settings: { channelConfigs: { connection: { strokeColor: "#ffffff", thickness: 2 } } } }))
		expect(v1.channelConfigs.connection?.strokeColor).toBe("#ffffff")
		expect(v1.channelConfigs.connection?.thickness).toBe(2)
	})

	it("refuses unknown names with a suggestion, and wrong types", () => {
		const errors = errorsOf(
			edit(scatter(), {
				settings: {
					legendConfig: { postion: "top" },
					channelConfigs: { x: { tickCount: "7" } },
					encodings: { x: { field: "Ratio" } },
				},
			})
		)
		const byPath = Object.fromEntries(errors.map((e) => [e.path, e.message]))
		expect(byPath["settings.legendConfig.postion"]).toMatch(/did you mean "position"/)
		expect(byPath["settings.channelConfigs.x.tickCount"]).toMatch(/number, not a string/)
		expect(byPath["settings.encodings"]).toMatch(/isn't a settings slice/)
	})

	it("adds keys to the data-keyed maps a chart starts with empty", () => {
		const v1 = ok(edit(scatter(), { settings: { dataLabelsConfig: { fieldFormats: { Ratio: ".2f" } } } }))
		expect(v1.dataLabelsConfig?.fieldFormats?.Ratio).toBe(".2f")
	})

	it("works in a create, applied after the spec's own keys", () => {
		const v = ok(
			composeChartSpec(
				{ datasetId: RATIOS.id, folderId: null, encodings: { x: "Ratio", y: "Country" }, title: "T", settings: { labelsConfig: { title: "Settings win" } } },
				ctx(RATIOS.id)
			)
		)
		expect(v.labelsConfig.title).toBe("Settings win")
		expect(hydrateVisual(v)).toEqual(v)
	})
})

describe("settings review findings", () => {
	const labelled = () =>
		ok(
			composeChartSpec(
				{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", length: "muffins", hue: "flavor" }, dataLabels: true },
				ctx(CAFE.id)
			)
		)

	it("refuses a wrong-typed value in a data-keyed map", () => {
		const errors = errorsOf(edit(labelled(), { settings: { dataLabelsConfig: { fieldFormats: { muffins: 5 } } } }))
		expect(errors[0]).toMatchObject({ path: "settings.dataLabelsConfig.fieldFormats.muffins" })
		const colors = errorsOf(edit(labelled(), { settings: { channelConfigs: { hue: { colors: { Bran: 5, Lemon: { x: 1 } } } } } }))
		expect(colors.map((e) => e.path)).toEqual(
			expect.arrayContaining(["settings.channelConfigs.hue.colors.Bran", "settings.channelConfigs.hue.colors.Lemon"])
		)
		expect(errorsOf(edit(labelled(), { settings: { legendConfig: { hidden: { hue: "yes" } } } }))[0]?.message).toMatch(/boolean/)
	})

	it("adds keys to a data-keyed map that already has entries", () => {
		const v1 = ok(edit(labelled(), { settings: { legendConfig: { hidden: { hue: true } } } }))
		const v2 = ok(edit(v1, { settings: { legendConfig: { hidden: { shape: true } }, dataLabelsConfig: { fieldFormats: { muffins: ".0f" } } } }))
		const v3 = ok(edit(v2, { settings: { dataLabelsConfig: { fieldFormats: { coffees: ".1f" } } } }))
		expect(v3.legendConfig?.hidden).toEqual({ hue: true, shape: true })
		expect(v3.dataLabelsConfig?.fieldFormats).toEqual({ muffins: ".0f", coffees: ".1f" })
	})

	it("checks a setting stored as null against its declared type", () => {
		expect(errorsOf(edit(labelled(), { settings: { channelConfigs: { x: { tickLabelAngle: { deg: 45 } } } } }))[0]).toMatchObject({
			path: "settings.channelConfigs.x.tickLabelAngle",
			message: expect.stringMatching(/null or number, not an object/),
		})
		expect(ok(edit(labelled(), { settings: { channelConfigs: { x: { tickLabelAngle: 45 } } } })).channelConfigs?.x?.tickLabelAngle).toBe(45)
		const back = ok(edit(labelled(), { settings: { channelConfigs: { x: { tickLabelAngle: 45 } } } }))
		expect(ok(edit(back, { settings: { channelConfigs: { x: { tickLabelAngle: null } } } })).channelConfigs?.x?.tickLabelAngle).toBeNull()
	})

	it("checks a setting's allowed words", () => {
		expect(errorsOf(edit(labelled(), { settings: { legendConfig: { position: "topp" } } }))[0]?.message).toMatch(/must be one of .*did you mean "top"/)
	})

	it("checks the elements of a list setting", () => {
		const errors = errorsOf(edit(labelled(), { settings: { channelConfigs: { categoricalPalette: ["#123456", 7, { c: 1 }] } } }))
		expect(errors.map((e) => e.path)).toEqual([
			"settings.channelConfigs.categoricalPalette[1]",
			"settings.channelConfigs.categoricalPalette[2]",
		])
		const stops = errorsOf(edit(labelled(), { settings: { channelConfigs: { hue: { customStops: [{ value: 0, color: "#fff", colr: "x" }] } } } }))
		expect(stops[0]).toMatchObject({ path: "settings.channelConfigs.hue.customStops[0].colr", message: expect.stringMatching(/did you mean "color"/) })
	})

	it("refuses the legend toggle the renderer ignores, pointing at hidden", () => {
		expect(errorsOf(edit(labelled(), { settings: { legendConfig: { enabled: false } } }))[0]?.message).toMatch(/"hidden"/)
	})

	it("keeps counts, sizes and opacities in range", () => {
		const paths = (settings: unknown) => errorsOf(edit(labelled(), { settings } as never)).map((e) => e.path)
		expect(paths({ channelConfigs: { y: { tickCount: 1e8 } } })).toEqual(["settings.channelConfigs.y.tickCount"])
		expect(paths({ channelConfigs: { y: { tickCount: 2.5 } } })).toEqual(["settings.channelConfigs.y.tickCount"])
		expect(paths({ channelConfigs: { connection: { thickness: -1 } } })).toEqual(["settings.channelConfigs.connection.thickness"])
		expect(ok(edit(labelled(), { settings: { channelConfigs: { y: { tickCount: 6 } } } })).channelConfigs?.y?.tickCount).toBe(6)
	})

	it("checks colors and field names", () => {
		const errors = errorsOf(edit(labelled(), { settings: { channelConfigs: { hue: { colors: { Bran: "notacolor" } } } } }))
		expect(errors[0]).toMatchObject({ path: "settings.channelConfigs.hue.colors.Bran", message: expect.stringMatching(/isn't a color/) })
		const field = errorsOf(edit(labelled(), { settings: { channelConfigs: { connection: { thicknessField: "mufins" } } } }))
		expect(field[0]?.message).toMatch(/no field "mufins" in the data; did you mean "muffins"/)
		expect(ok(edit(labelled(), { settings: { channelConfigs: { connection: { thicknessField: "muffins" } } } })).channelConfigs?.connection?.thicknessField).toBe("muffins")
	})

	it("reports settings problems together with the others in a create", () => {
		const r = composeChartSpec(
			{ datasetId: CAFE.id, folderId: null, encodings: { x: "nope", length: "muffins" }, settings: { legendConfig: { position: "topp" } } },
			ctx(CAFE.id)
		)
		expect(errorsOf(r).map((e) => e.path)).toEqual(expect.arrayContaining(["encodings.x", "settings.legendConfig.position"]))
	})

	it("reports settings problems together with the others in an edit", () => {
		const errors = errorsOf(edit(labelled(), { title: 5, settings: { legendConfig: { postion: "top" } } } as never))
		expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining(["title", "settings.legendConfig.postion"]))
	})

	it("points axis bounds at the axes key", () => {
		expect(errorsOf(edit(labelled(), { settings: { channelConfigs: { y: { min: 0 } } } }))[0]?.message).toMatch(/"axes"/)
	})

	it("refuses an empty slice, and constructor as a key", () => {
		expect(errorsOf(edit(labelled(), { settings: { legendConfig: {} } }))[0]?.path).toBe("settings.legendConfig")
		expect(errorsOf(edit(labelled(), { settings: { channelConfigs: { hue: { colors: { constructor: "#fff" } } } } }))[0]?.message).toMatch(/can't be used/)
	})

	it("sets hue colors through settings in a create", () => {
		const v = ok(
			composeChartSpec(
				{ datasetId: CAFE.id, folderId: null, encodings: { x: "month", length: "muffins", hue: "flavor" }, settings: { channelConfigs: { hue: { colors: { Bran: "#123456" } } } } },
				ctx(CAFE.id)
			)
		)
		const hue = v.channelConfigs.hue
		expect(hue?.kind === "categorical" ? hue.colors.Bran : null).toBe("#123456")
	})
})

describe("temporal and removal review findings", () => {
	const line = () => ok(composeChartSpec({ datasetId: DATES.id, folderId: null, encodings: { x: "day", y: "n" } }, ctx(DATES.id)))

	it("reads dates as local midnight, a year as Jan 1, and refuses impossible days", () => {
		const v = ok(edit(line(), { axes: { x: { min: "2026", max: "2026-02" } } }))
		expect(v.channelConfigs.x?.min).toBe(new Date(2026, 0, 1).getTime())
		expect(v.channelConfigs.x?.max).toBe(new Date(2026, 1, 1).getTime())
		expect(errorsOf(edit(line(), { axes: { x: { max: "2026-02-30" } } }))[0]?.path).toBe("axes.x.max")
	})

	it("refuses a year given as a number on a temporal axis", () => {
		expect(errorsOf(edit(line(), { axes: { x: { min: 2020 } } }))[0]?.message).toMatch(/epoch milliseconds/)
	})

	it("refuses bounds on a bar chart's banded date axis", () => {
		const bars = ok(composeChartSpec({ datasetId: DATES.id, folderId: null, encodings: { x: "day", length: "n" } }, ctx(DATES.id)))
		expect(errorsOf(edit(bars, { axes: { x: { min: "2026-01-02" } } }))[0]?.message).toMatch(/one band per value/)
	})

	it("clears a bound with null in an edit", () => {
		const v1 = ok(edit(line(), { axes: { y: { min: 0, max: 9 } } }))
		const v2 = ok(edit(v1, { axes: { y: { max: null } } }))
		expect(v2.channelConfigs.y?.min).toBe(0)
		expect(v2.channelConfigs.y && "max" in v2.channelConfigs.y).toBe(false)
	})

	it("refuses a rule naming a field that isn't there", () => {
		const r = edit(scatter(), {
			derivedVariables: [{ name: "Big", kind: "rules", rules: { rules: [{ condition: "{Nope} > 1", output: "yes" }], fallback: "no" } }],
		})
		expect(errorsOf(r)[0]?.message).toMatch(/\{Nope\} isn't a variable/)
	})

	it("removes a derived variable by name", () => {
		const v1 = ok(edit(scatter(), { derivedVariables: [{ name: "Twice", kind: "math", math: { formula: "{Ratio} * 2" } }] }))
		const v2 = ok(edit(v1, { removeDerivedVariables: ["Twice"] }))
		expect(v2.derivedVariablesConfig?.variables).toEqual([])
		expect(errorsOf(edit(v2, { removeDerivedVariables: ["Twice"] }))[0]?.path).toBe("removeDerivedVariables")
	})

	it("hints at channels whatever the case", () => {
		const r = composeChartSpec({ datasetId: CAFE.id, folderId: null, encodings: { x: "month", Size: "muffins" } }, ctx(CAFE.id))
		expect(errorsOf(r)[0]?.message).toMatch(/"area" or "length"/)
	})
})

describe("choosing a variation", () => {
	const spec = (extra: Record<string, unknown>) => ({ datasetId: CAFE.id, folderId: null, encodings: { x: "flavor", y: "muffins" }, family: "violin", ...extra })

	it("makes the named variation instead of the first that fits", () => {
		const overlay = (extra: Record<string, unknown>) => ok(composeChartSpec(spec(extra), ctx(CAFE.id))).channelConfigs?.y?.distributionOverlay
		expect(overlay({})).toMatchObject({ showDensityViolin: true, showBoxPlot: false })
		expect(overlay({ variation: "box plot (vertical)" })).toMatchObject({ showDensityViolin: false, showBoxPlot: true })
	})

	it("refuses an unknown variation, one the encodings don't fill, and one in an edit", () => {
		expect(errorsOf(composeChartSpec(spec({ variation: "Box plot" }), ctx(CAFE.id)))[0]).toMatchObject({
			path: "variation",
			message: expect.stringMatching(/no "Box plot" variation of "violin".*Box plot \(vertical\)/),
		})
		expect(errorsOf(composeChartSpec(spec({ variation: "Violin (horizontal)" }), ctx(CAFE.id)))[0]?.message).toMatch(/needs "y" \(/)
		const made = ok(composeChartSpec(spec({}), ctx(CAFE.id)))
		expect(errorsOf(edit(made, { variation: "Box plot (vertical)" }))[0]?.path).toBe("variation")
	})
})
