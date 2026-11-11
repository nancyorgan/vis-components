import { describe, expect, it } from "vitest"

import { chartSpecVocabulary, composeVisual, editVisual, type ChartSpec } from "./chartSpec"
import { UNTITLED_VISUAL_NAME } from "./nameUniqueness"
import { structureVisualKeys } from "./savedKeyStructure"
import { CONTENT_MIGRATIONS } from "./storage/migrations"
import { LIGHT_THEME_BASE } from "./systemThemes"
import type { Visual } from "./types"

const deps = {
	theme: LIGHT_THEME_BASE,
	fields: [
		{ name: "region", type: "categorical" },
		{ name: "segment", type: "categorical" },
		{ name: "sales", type: "quantitative" },
		{ name: "profit", type: "quantitative" },
		{ name: "date", type: "temporal" },
	] as const,
	folderIds: new Set(["f-1"]),
	now: 1000,
}

const spec = (over: Partial<ChartSpec>): ChartSpec => ({
	datasetId: "ds-1",
	folderId: null,
	encodings: {},
	...over,
})

const ok = (s: Partial<ChartSpec>): Visual => {
	const { visual, problems } = composeVisual(spec(s), deps)
	expect(problems).toEqual([])
	return visual
}

const BAR = { family: "bar", encodings: { x: "region", length: "sales" } } as const
const LINE = {
	family: "line",
	encodings: { x: "date", y: "sales", hue: "segment", connection: "segment" },
} as const
const SCATTER = { encodings: { x: "sales", y: "profit", area: "sales" } } as const
const PIE = { family: "pie", encodings: { angle: "sales", hue: "region" } } as const

describe("composeVisual", () => {
	it("makes a bar chart bound to its dataset, folder and theme", () => {
		const v = ok({ ...BAR, folderId: "f-1", themeId: "t-1" })
		expect(v.id).toMatch(/^vs-/)
		expect(v).toMatchObject({ datasetId: "ds-1", folderId: "f-1", themeId: "t-1", createdAt: 1000 })
		expect(v.encodings.x).toEqual({ field: "region" })
		expect(v.encodings.length).toEqual({ field: "sales" })
		expect(v.channelConfigs.hue).toBeUndefined()
	})

	it("makes a line chart with a temporal x and a categorical hue", () => {
		const v = ok(LINE)
		expect(v.encodings.hue).toEqual({ field: "segment" })
		expect(v.channelConfigs.hue?.kind).toBe("categorical")
	})

	it("makes a scatter with size, and seeds a quantitative hue from the theme", () => {
		const v = ok({ encodings: { ...SCATTER.encodings, hue: "profit" } })
		expect(v.encodings.area).toEqual({ field: "sales" })
		expect(v.channelConfigs.hue?.kind).toBe("quantitative")
	})

	it("makes a pie, and stacks / seeds outline hue the way the panels do", () => {
		expect(ok(PIE).encodings.angle).toEqual({ field: "sales" })
		const v = ok({
			...BAR,
			encodings: { ...BAR.encodings, hue: "segment", outlineHue: "profit" },
			stack: "group",
		})
		expect(v.channelConfigs.hue).toMatchObject({ kind: "categorical", stackMode: "group" })
		expect(v.channelConfigs.outlineHue?.kind).toBe("quantitative")
	})

	it("refuses an unknown field with a did-you-mean", () => {
		const { problems } = composeVisual(spec({ encodings: { x: "regoin", length: "sales" } }), deps)
		expect(problems).toEqual([
			{ path: "encodings.x", message: expect.stringContaining('did you mean "region"') },
		])
	})

	it("refuses a field whose type the channel doesn't take", () => {
		const { problems } = composeVisual(
			spec({ encodings: { x: "sales", y: "profit", area: "segment" } }),
			deps
		)
		expect(problems.map((p) => p.path)).toEqual(["encodings.area"])
	})

	it("refuses unknown keys, channels, families and variations", () => {
		const bad = { ...spec({ encodings: { colour: "region" } as never }), colr: 1, family: "bars" }
		const paths = composeVisual(bad as never, deps).problems.map((p) => p.path)
		expect(paths).toEqual(expect.arrayContaining(["colr", "family", "encodings.colour"]))
		const { problems } = composeVisual(spec({ ...BAR, variation: "Sideways" }), deps)
		expect(problems[0]).toMatchObject({
			path: "variation",
			message: expect.stringContaining('"Vertical bars"'),
		})
		expect(composeVisual(spec({ ...BAR, folderId: "nope" }), deps).problems[0]?.path).toBe(
			"folderId"
		)
	})

	it("writes titles and axis min/max/format where the panels store them", () => {
		const v = ok({
			...LINE,
			title: "Sales",
			subtitle: "by day",
			axes: {
				x: { title: "Day", min: "2020-01-01", format: "%b" },
				y: { min: 0, max: 100, format: ",.0f" },
			},
		})
		expect(v.labelsConfig).toMatchObject({ title: "Sales", subtitle: "by day", xAxisTitle: "Day" })
		expect(v.channelConfigs.x).toMatchObject({
			min: new Date(2020, 0, 1).getTime(),
			customFormat: "%b",
		})
		expect(v.channelConfigs.y).toMatchObject({ min: 0, max: 100, customFormat: ",.0f" })
		const bad = composeVisual(spec({ ...BAR, axes: { x: { min: 0 } } }), deps).problems
		expect(bad.map((p) => p.path)).toEqual(["axes.x.min"])
	})

	it("refuses an axis format the Format box can't parse", () => {
		const { problems } = composeVisual(spec({ ...BAR, axes: { y: { format: "bogus!" } } }), deps)
		expect(problems.map((p) => p.path)).toEqual(["axes.y.format"])
	})

	it("applies settings last, over the spec's own keys", () => {
		const v = ok({
			...BAR,
			title: "From the spec",
			settings: {
				labelsConfig: { title: "From settings" },
				channelConfigs: { y: { gridlines: { enabled: false } } },
			},
		})
		expect(v.labelsConfig.title).toBe("From settings")
		expect(v.channelConfigs.y?.gridlines?.enabled).toBe(false)
		const { problems } = composeVisual(
			spec({ ...BAR, settings: { channelConfigs: { x: { gridline: {} } } } }),
			deps
		)
		expect(problems).toEqual([
			{ path: "settings.channelConfigs.x.gridline", message: expect.stringContaining("gridlines") },
		])
		expect(composeVisual(spec({ ...BAR, settings: [] as never }), deps).problems[0]?.path).toBe(
			"settings"
		)
	})

	it("names the visual from name, then title, then Untitled", () => {
		expect(ok({ ...BAR, name: " Mine ", title: "T" }).name).toBe("Mine")
		expect(ok({ ...BAR, title: " T " }).name).toBe("T")
		expect(ok(BAR).name).toBe(UNTITLED_VISUAL_NAME)
	})

	it.each([
		["bar", BAR],
		["line", LINE],
		["scatter", SCATTER],
		["pie", PIE],
	])("a composed %s is already in the stored shape", (_name, s) => {
		const v = ok(s as Partial<ChartSpec>)
		expect(structureVisualKeys(v)).toBe(v)
		// Steps 1-2 are the one-time px→pt font resets against the stored
		// themes' sizes (fallbacks here), not shape upgrades; every other
		// step must leave a composed visual alone.
		CONTENT_MIGRATIONS.visuals.migrations.forEach((step, i) => {
			if (i !== 1 && i !== 2) expect(step([v]), `step ${i}`).toEqual([v])
		})
	})
})

describe("optional variation channels", () => {
	it("composes a dumbbell without shape or area, and still type-checks them when mapped", () => {
		const v = ok({ family: "dumbbell", encodings: { y: "region", x: "sales", hue: "segment" } })
		expect(v.encodings.connection).toEqual({ field: "region" })
		expect(v.encodings.shape.field).toBeNull()
		const { problems } = composeVisual(
			spec({ family: "dumbbell", encodings: { y: "region", x: "sales", hue: "segment", shape: "profit" } }),
			deps
		)
		expect(problems[0]?.path).toBe("encodings.shape")
		expect(chartSpecVocabulary().families.find((f) => f.name === "dumbbell")?.variations[0]).toMatchObject({
			optional: ["shape", "area"],
		})
	})
})

describe("editVisual", () => {
	it("clears a mapped channel that conflicts with the one the edit maps, and says so", () => {
		const base = ok(SCATTER)
		const { visual, problems, warnings } = editVisual(base, { encodings: { length: "profit" } }, deps)
		expect(problems).toEqual([])
		expect(visual.encodings.length).toEqual({ field: "profit" })
		expect(visual.encodings.area).toEqual({ field: null })
		expect(warnings).toEqual([`unmapped "area" (it can't be mapped with "length")`])
		expect(editVisual(base, { encodings: { length: "profit", shape: "region" } }, deps).problems[0]?.path).toBe(
			"encodings.shape"
		)
	})


	const base = (): Visual => ok({ ...LINE, axes: { y: { min: 0 } } })

	it("edits a visual whose deletedAt is null (live), refuses a trashed one", () => {
		const live = { ...base(), deletedAt: null }
		expect(editVisual(live, { name: "Renamed" }, deps).problems).toEqual([])
		const trashed = { ...base(), deletedAt: 5 }
		expect(editVisual(trashed, { name: "Renamed" }, deps).problems[0]?.message).toMatch(/Trash/)
	})

	it("unmaps a channel, clears a bound, and bumps updatedAt only", () => {
		const b = base()
		const { visual, problems } = editVisual(
			b,
			{ encodings: { hue: null }, axes: { y: { min: null } } },
			{ ...deps, now: 2000 }
		)
		expect(problems).toEqual([])
		expect(visual.encodings.hue).toEqual({ field: null })
		expect(visual.channelConfigs.y?.min).toBeNull()
		expect(visual).toMatchObject({ id: b.id, createdAt: 1000, updatedAt: 2000, name: b.name })
		expect(visual.encodings.x).toEqual(b.encodings.x)
	})

	it("seeds a new hue field's config and refuses wrong types", () => {
		expect(
			editVisual(base(), { encodings: { hue: "profit" } }, deps).visual.channelConfigs.hue?.kind
		).toBe("quantitative")
		expect(editVisual(base(), { encodings: { x: "nope" } }, deps).problems[0]?.path).toBe(
			"encodings.x"
		)
	})

	it("applies settings on an edit, merging into what is stored", () => {
		const b = base()
		const { visual, problems } = editVisual(
			b,
			{ settings: { legendConfig: { position: "bottom" } } },
			deps
		)
		expect(problems).toEqual([])
		expect(visual.legendConfig?.position).toBe("bottom")
		expect(visual.channelConfigs.y?.min).toBe(0)
		expect(editVisual(b, { settings: { nope: 1 } }, deps).problems[0]?.path).toBe("settings.nope")
	})

	it("re-themes on a themeId the way the Theme panel does, keeping user overrides", () => {
		const b = editVisual(base(), { title: "Kept", settings: { channelConfigs: { hue: { colors: { North: "#ff0000" } } } } }, deps).visual
		const theme = { ...LIGHT_THEME_BASE, defaultFill: "#abcdef", legendBackgroundColor: "#010203" }
		const { visual, problems } = editVisual(b, { themeId: "t-2" }, { ...deps, theme })
		expect(problems).toEqual([])
		expect(visual.themeId).toBe("t-2")
		expect(visual.channelConfigs.defaultFill).toBe("#abcdef")
		expect(visual.legendConfig?.backgroundColor).toBe("#010203")
		expect(visual.labelsConfig.title).toBe("Kept")
		expect(visual.channelConfigs.hue).toMatchObject({ colors: { North: "#ff0000" } })
	})

	it("with the stored theme as baseline, a themeId keeps the user's picks", () => {
		const b = editVisual(
			base(),
			{ settings: { channelConfigs: { defaultRadius: 14 }, legendConfig: { position: "left" } } },
			deps
		).visual
		const theme = { ...LIGHT_THEME_BASE, defaultRadius: 3, defaultFill: "#abcdef", legendPosition: "bottom" as const }
		const { visual, problems } = editVisual(b, { themeId: "t-2" }, { ...deps, theme, fromTheme: LIGHT_THEME_BASE })
		expect(problems).toEqual([])
		expect(visual.channelConfigs.defaultRadius).toBe(14)
		expect(visual.legendConfig?.position).toBe("left")
		expect(visual.channelConfigs.defaultFill).toBe("#abcdef")
		// No baseline: every theme-driven field follows, the old behavior.
		expect(editVisual(b, { themeId: "t-2" }, { ...deps, theme }).visual.channelConfigs.defaultRadius).toBe(3)
	})

	it("refuses templates and trashed rows", () => {
		const template = { ...base(), template: {} } as Visual
		expect(editVisual(template, { title: "x" }, deps).problems).toHaveLength(1)
		expect(editVisual({ ...base(), deletedAt: 5 }, { title: "x" }, deps).problems).toHaveLength(1)
		expect(editVisual(base(), { datasetId: "x" } as never, deps).problems[0]?.path).toBe(
			"datasetId"
		)
	})
})

describe("chartSpecVocabulary", () => {
	it("lists channels without text, every family, and the keys", () => {
		const vocab = chartSpecVocabulary()
		expect(vocab.channels.map((c) => c.name)).not.toContain("text")
		expect(vocab.families.map((f) => f.name)).toContain("bar")
		expect(vocab.families.map((f) => f.name)).toEqual(expect.arrayContaining(["map", "sankey", "chord"]))
		expect(Object.keys(vocab.specKeys)).toContain("encodings")
	})
})
