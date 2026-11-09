import { describe, expect, it } from "vitest"

import { applySettings } from "./applySettings"
import { DEFAULT_FACET_CONFIG, type FacetConfig } from "./channelConfig"
import { LIGHT_THEME_BASE } from "./systemThemes"
import type { Visual } from "./types"
import { newVisualDraft } from "./visualDefaults"

const base = (over: Partial<Visual> = {}): Visual => ({
	id: "vs-1",
	name: "Chart",
	folderId: null,
	datasetId: "ds-1",
	createdAtVersionId: null,
	...newVisualDraft(LIGHT_THEME_BASE),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...over,
})

const facet = (f: Partial<FacetConfig>): Visual => {
	const v = base()
	return {
		...v,
		channelConfigs: {
			...v.channelConfigs,
			facet: { ...DEFAULT_FACET_CONFIG, shareX: undefined, shareY: undefined, ...f },
		},
	}
}

const apply = (patch: Record<string, unknown>, v = base()) =>
	applySettings(v, patch, { mintId: (at) => `new-${at.split(".").pop()}` })

const paths = (patch: Record<string, unknown>, v?: Visual) => apply(patch, v).problems.map((p) => p.path)

describe("applySettings", () => {
	it("deep-merges objects, leaving siblings alone", () => {
		const v = base()
		const { visual, problems } = apply({ channelConfigs: { x: { gridlines: { enabled: true } } } }, v)
		expect(problems).toEqual([])
		expect(visual.channelConfigs.x?.gridlines?.enabled).toBe(true)
		expect(visual.channelConfigs.defaultFill).toBe(v.channelConfigs.defaultFill)
		expect(visual.labelsConfig).toEqual(v.labelsConfig)
	})

	it("refuses an unknown slice with a did-you-mean", () => {
		const { problems } = apply({ labelConfig: { title: "x" } })
		expect(problems).toEqual([
			{ path: "labelConfig", message: expect.stringContaining('did you mean "labelsConfig"') },
		])
	})

	it("refuses a deny-listed key as a slice", () => {
		expect(paths({ encodings: {} })).toEqual(["encodings"])
		expect(paths({ themeId: "t" })).toEqual(["themeId"])
	})

	it("refuses an unknown nested key with a did-you-mean among its siblings", () => {
		const { problems } = apply({ channelConfigs: { x: { gridline: { enabled: true } } } })
		expect(problems[0]).toEqual({
			path: "channelConfigs.x.gridline",
			message: expect.stringContaining('did you mean "gridlines"'),
		})
	})

	it("checks kinds, and refuses non-finite numbers", () => {
		expect(paths({ channelConfigs: { x: { gridlines: { enabled: "yes" } } } })).toEqual([
			"channelConfigs.x.gridlines.enabled",
		])
		expect(paths({ channelConfigs: { defaultRadius: Number.NaN } })).toEqual([
			"channelConfigs.defaultRadius",
		])
	})

	it("checks string-literal values", () => {
		const { problems } = apply({ channelConfigs: { connection: { hierarchyLayout: "tree" } } })
		expect(problems[0].message).toContain('"treemap"')
	})

	it("allows null only where the type does", () => {
		expect(apply({ channelConfigs: { defaultSaturation: null } }).problems).toEqual([])
		expect(paths({ channelConfigs: { defaultFill: null } })).toEqual(["channelConfigs.defaultFill"])
	})

	it("replaces lists whole", () => {
		const v = { ...base(), fieldOrder: ["a", "b", "c"] }
		expect(apply({ fieldOrder: ["c"] }, v).visual.fieldOrder).toEqual(["c"])
	})

	it("keeps a sent id and mints one for an entry without", () => {
		const text = { name: "", x: 0.5, y: 0.5, zOrder: "front", coordSystem: "percent", text: "Hi" }
		const v = base({
			annotationsConfig: { rectangles: [], circles: [], lineSegments: [], texts: [{ ...text, id: "text-1" } as never], images: [] },
		})
		const { visual, problems } = apply(
			{ annotationsConfig: { texts: [{ ...text, id: "text-1", text: "Edited" }, text] } },
			v
		)
		expect(problems).toEqual([])
		expect(visual.annotationsConfig?.texts.map((t) => [t.id, t.text])).toEqual([
			["text-1", "Edited"],
			["new-texts", "Hi"],
		])
		expect(visual.annotationsConfig?.rectangles).toEqual([])
	})

	it("mints ids in the sidebar's style by default", () => {
		const { visual } = applySettings(base(), { annotationsConfig: { rectangles: [{ xMin: 0 }] } })
		expect(visual.annotationsConfig?.rectangles[0].id).toMatch(/^rect-[a-z0-9]+-[a-z0-9]+$/)
	})

	it("refuses duplicate ids in a sent list", () => {
		expect(paths({ annotationsConfig: { circles: [{ id: "c" }, { id: "c" }] } })).toEqual([
			"annotationsConfig.circles[1].id",
		])
	})

	it("refuses a data key with a pipe or a control character", () => {
		expect(paths({ channelConfigs: { hue: { colors: { "a|b": "#fff" } } } })).toEqual([
			"channelConfigs.hue.colors.a|b",
		])
		expect(paths({ fieldLevelOrders: { "a\u001fb": ["x"] } })).toEqual(["fieldLevelOrders.a\u001fb"])
		expect(apply({ fieldLevelOrders: { "Region (US)": ["x"] } }).problems).toEqual([])
	})

	it("validates format strings with the Format box's parser", () => {
		expect(paths({ channelConfigs: { x: { customFormat: "bogus!" } } })).toEqual([
			"channelConfigs.x.customFormat",
		])
		for (const ok of [",.0f", "$,.1~fK", "%Y", "literal units", "{.1%} share", "", "country-name"])
			expect(apply({ dataLabelsConfig: { fieldFormats: { sales: ok } } }).problems).toEqual([])
	})

	it("refuses per-panel ranges while the axis is shared, naming the share setting", () => {
		const patch = { channelConfigs: { facet: { panelAxisOverrides: { North: { yMin: 0 } } } } }
		const { problems } = apply(patch, facet({}))
		expect(problems).toEqual([
			{
				path: "channelConfigs.facet.panelAxisOverrides",
				message: expect.stringContaining('"channelConfigs.facet.shareY" is "none" (it is "all")'),
			},
		])
		expect(apply(patch, facet({ shareY: "none" })).problems).toEqual([])
		// An x bound needs shareX; the share set in the same patch counts.
		expect(
			apply({ channelConfigs: { facet: { shareX: "none", panelAxisOverrides: { North: { xMax: 5 } } } } }, facet({}))
				.problems
		).toEqual([])
		expect(
			paths(
				{ channelConfigs: { facet: { gridPanelAxisOverrides: { A: { B: { xMin: 1 } } } } } },
				facet({ shareY: "none" })
			)
		).toEqual(["channelConfigs.facet.gridPanelAxisOverrides"])
	})

	it("runs the save intake after applying", () => {
		const { visual } = apply({
			channelConfigs: { connection: { hierarchyLayout: "chord" } },
			labelsConfig: { fontOverrides: { nodeTitle: { size: 15 } } },
		})
		expect(visual.labelsConfig.fontOverrides?.nodeTitle).toBeUndefined()
		expect(visual.dataLabelsConfig?.fontSize).toBe(15)
	})

	it("returns the visual unchanged when anything is refused", () => {
		const v = base()
		const { visual } = apply({ labelsConfig: { title: "New" }, channelConfigs: { nope: 1 } }, v)
		expect(visual).toBe(v)
	})

	it("handles 200k-entry lists and maps without spreading them into calls", () => {
		const many = Array.from({ length: 200_000 }, (_, i) => `level ${i}`)
		const { visual, problems } = apply({ fieldOrder: many, fieldLevelOrders: { region: many } })
		expect(problems).toEqual([])
		expect(visual.fieldOrder).toHaveLength(200_000)
		const colors = Object.fromEntries(many.map((l) => [l, "#123456"]))
		expect(apply({ channelConfigs: { hue: { colors } } }).problems).toEqual([])
	})
})
