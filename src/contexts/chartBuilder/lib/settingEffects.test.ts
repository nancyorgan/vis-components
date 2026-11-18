import { describe, expect, it } from "vitest"

import { applySettings } from "./applySettings"
import { DEFAULT_FACET_CONFIG, type DataLabelsConfig } from "./channelConfig"
import { DEFAULT_CANVAS_HEIGHT, DEFAULT_CANVAS_WIDTH } from "./canvasSizeEdits"
import { withColorSlotDefaults } from "./colorSlotDefaults"
import { OPACITY_SLOT_DEFS } from "./opacitySlots"
import { settingsReadRows } from "./settingEffects"
import { LIGHT_THEME_BASE } from "./systemThemes"
import { OUTLINE_THICKNESS_MAX, OVERLAY_LINE_THICKNESS_MAX } from "./thicknessRanges"
import type { FieldType, Theme, Visual } from "./types"
import { newVisualDraft } from "./visualDefaults"

const theme = LIGHT_THEME_BASE
const fields: Array<{ name: string; type: FieldType }> = [
	{ name: "region", type: "categorical" },
	{ name: "year", type: "quantitative" },
	{ name: "sales", type: "quantitative" },
	{ name: "when", type: "temporal" },
]
const rows = [
	{ region: "West", year: "2019", sales: "5", when: "2019-01-01" },
	{ region: "East", year: "2020", sales: "9", when: "2020-01-01" },
	{ region: "North", year: "2021", sales: "1", when: "2021-01-01" },
]
const deps = { theme, fields, rows }

const base = (over: Partial<Visual> = {}): Visual => ({
	id: "vs-1",
	name: "Untitled",
	folderId: null,
	datasetId: "ds-1",
	createdAtVersionId: null,
	...newVisualDraft(theme),
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
	...over,
})

const bars = (over: Partial<Visual> = {}): Visual => {
	const v = base()
	return {
		...v,
		encodings: { ...v.encodings, x: { field: "region" }, length: { field: "sales" } },
		...over,
	}
}

let minted = 0
const apply = (patch: Record<string, unknown>, v = base(), d: Partial<typeof deps> = deps) =>
	applySettings(v, patch, { ...d, mintId: (at) => `new-${at.split(".").pop()}-${++minted}` })

const ok = (patch: Record<string, unknown>, v?: Visual) => {
	const r = apply(patch, v)
	expect(r.problems).toEqual([])
	return r.visual
}
const paths = (patch: Record<string, unknown>, v?: Visual) => apply(patch, v).problems.map((p) => p.path)

describe("applySettings: what the panels do beyond storing a value", () => {
	it("seeds a new annotation with the theme's style, the next name and percent coordinates", () => {
		const v = ok({ annotationsConfig: { texts: [{ text: "Peak" }] } })
		const [t] = v.annotationsConfig!.texts
		expect(t).toMatchObject({ name: "Text 1", text: "Peak", coordSystem: "percent", x: 0.5 })
		expect(t.id).toMatch(/^new-texts-/)
		expect(typeof t.textFontSize).toBe("number")
		const again = ok({ annotationsConfig: { texts: [...v.annotationsConfig!.texts, { text: "Dip" }] } }, v)
		expect(again.annotationsConfig!.texts.map((x) => x.name)).toEqual(["Text 1", "Text 2"])
	})

	it("stores an annotation's coordinates in the system it names, without converting", () => {
		const v = ok({ annotationsConfig: { circles: [{ coordSystem: "values", centerX: 2020, centerY: 4 }] } }, bars())
		expect(v.annotationsConfig!.circles[0]).toMatchObject({ coordSystem: "values", centerX: 2020, centerY: 4 })
	})

	it("refuses value-mode annotation coordinates on a chart without value axes", () => {
		const pie = base({ encodings: { ...base().encodings, angle: { field: "sales" }, hue: { field: "region" } } })
		expect(paths({ annotationsConfig: { texts: [{ coordSystem: "values" }] } }, pie)).toEqual([
			"annotationsConfig.texts[0].coordSystem",
		])
	})

	it("adds and removes composed labels with the value checklist and seeds a Bar total", () => {
		const v = ok({ dataLabelsEncodings: { value: { field: null, multiField: true, fields: ["sales", "Bar total"] } } }, bars())
		expect(v.dataLabelsConfig!.composedLabels).toEqual([
			{ id: "sales", template: "{sales}" },
			{ id: "Bar total", template: "{Bar total}" },
		])
		expect(v.dataLabelsConfig!.fieldLabelPoints).toEqual({ "Bar total": "last" })
		expect(v.dataLabelsConfig!.fieldBarPlacements).toEqual({ "Bar total": { position: "outside-end" } })
		const fewer = ok({ dataLabelsEncodings: { value: { field: null, multiField: true, fields: ["sales"] } } }, v)
		expect(fewer.dataLabelsConfig!.composedLabels).toEqual([{ id: "sales", template: "{sales}" }])
	})

	it("seeds the text palette when labels color by a categorical field", () => {
		const v = ok({ dataLabelsEncodings: { hue: { field: "region" } } }, bars())
		expect(v.dataLabelsConfig!.paletteId).not.toBeNull()
		expect(v.dataLabelsConfig!.palette.length).toBeGreaterThan(0)
		const quant = ok({ dataLabelsEncodings: { hue: { field: "sales" } } }, bars())
		expect(quant.dataLabelsConfig!.paletteId).toBeNull()
	})

	it("keeps a label channel's field and derived source exclusive", () => {
		const v = bars({ dataLabelsEncodings: { ...bars().dataLabelsEncodings!, hue: { field: null, measureSource: "rootGroup" } } })
		expect(ok({ dataLabelsEncodings: { hue: { field: "region" } } }, v).dataLabelsEncodings!.hue).toEqual({ field: "region" })
	})

	it("computes the level order from an Order by spec and drops a self-scope", () => {
		const v = ok({ fieldLevelOrderSpecs: { region: { by: "field", byField: "sales", decreasing: true, scopeField: "region", scopeLevel: "West" } } }, bars())
		expect(v.fieldLevelOrders).toEqual({ region: ["East", "West", "North"] })
		expect(v.fieldLevelOrderSpecs).toEqual({ region: { by: "field", byField: "sales", decreasing: true } })
		expect(ok({ fieldLevelOrderSpecs: { region: { by: "alphabetical" } } }, bars()).fieldLevelOrders).toEqual({
			region: ["East", "North", "West"],
		})
	})

	it("refuses an order-by field that isn't a measure, and an order without rows", () => {
		expect(apply({ fieldLevelOrderSpecs: { region: { by: "field", byField: "region" } } }, bars()).problems[0].message).toMatch(
			/quantitative or temporal/
		)
		expect(apply({ fieldLevelOrderSpecs: { region: { by: "alphabetical" } } }, bars(), { theme, fields }).problems[0].message).toMatch(/rows/)
	})

	it("forgets the Order by spec when the order is set by hand", () => {
		const v = ok({ fieldLevelOrderSpecs: { region: { by: "alphabetical" } } }, bars())
		expect(ok({ fieldLevelOrders: { region: ["West", "East", "North"] } }, v).fieldLevelOrderSpecs).toEqual({})
	})

	it("moves y to length and stacks a hue when the connection fills as an area", () => {
		const line = base({
			encodings: { ...base().encodings, x: { field: "year" }, y: { field: "sales" }, connection: { field: "region" }, hue: { field: "region" } },
		})
		const seeded = ok({ channelConfigs: { categoricalPaletteId: theme.categoricalPalettes[0].id } }, line)
		const v = ok({ channelConfigs: { connection: { fill: "area" } } }, { ...seeded, channelConfigs: { ...seeded.channelConfigs, hue: { ...seeded.channelConfigs.hue!, stackMode: "overlay" } } })
		expect(v.encodings.length.field).toBe("sales")
		expect(v.encodings.y.field).toBeNull()
		expect(v.channelConfigs.hue?.stackMode).toBe("stack")
		const back = ok({ channelConfigs: { connection: { fill: "line" } } }, v)
		expect(back.encodings.y.field).toBe("sales")
		expect(back.encodings.length.field).toBeNull()
	})

	it("seeds a custom axis-stem threshold and one thickness per level", () => {
		const line = base({ encodings: { ...base().encodings, x: { field: "year" }, y: { field: "sales" }, connection: { field: "region" } } })
		const v = ok({ channelConfigs: { connection: { axisStem: "custom-y", thicknessField: "region" } } }, line)
		expect(v.channelConfigs.connection?.axisStemCustomY).toBe(0)
		expect(v.channelConfigs.connection?.thicknessByValue).toEqual({ East: 2, North: 2, West: 2 })
		const none = ok({ channelConfigs: { connection: { thicknessField: null } } }, v)
		expect(none.channelConfigs.connection?.thicknessByValue).toEqual({})
		const seg = ok({ channelConfigs: { length: { segmentThicknessField: "region" } } }, bars())
		expect(Object.keys(seg.channelConfigs.length?.segmentThicknessByValue ?? {})).toHaveLength(3)
	})

	it("brings a palette's colors and pattern inks along with its id, and names the theme's palettes for an unknown one", () => {
		const pal = theme.categoricalPalettes[1] ?? theme.categoricalPalettes[0]
		const v = ok({ channelConfigs: { categoricalPaletteId: pal.id } }, bars())
		expect(v.channelConfigs.categoricalPalette).toEqual(pal.colors)
		expect(v.channelConfigs.categoricalPalettePatternInks).toHaveLength(pal.colors.length)
		expect(v.channelConfigs.hue).toMatchObject({ kind: "categorical", colors: {} })
		const r = apply({ channelConfigs: { categoricalPaletteId: "nope" } }, bars())
		expect(r.problems[0].message).toMatch(new RegExp(pal.id))
		const labels = ok({ dataLabelsConfig: { paletteId: pal.id } }, bars())
		expect(labels.dataLabelsConfig!.palette).toEqual(pal.colors)
	})

	it("gives a continuous Fill field a gradient when its config is still categorical", () => {
		const v = bars({ encodings: { ...bars().encodings, hue: { field: "sales" } } })
		const out = ok({ channelConfigs: { hue: { colors: { "5": "#ff0000" } } } }, v)
		expect(out.channelConfigs.hue?.kind).toBe("quantitative")
	})

	it("starts an absent config slice from the editor's defaults rather than a bare object", () => {
		const v = bars({ encodings: { ...bars().encodings, hue: { field: "region" } } })
		const out = ok({ channelConfigs: { hue: { colors: { West: "#ff0000" } } } }, v)
		expect(out.channelConfigs.hue).toMatchObject({ kind: "categorical", colors: { West: "#ff0000" }, stackMode: "stack" })
		const stems = ok({ channelConfigs: { connection: { axisStem: "custom-x" } } }, bars())
		expect(typeof stems.channelConfigs.connection?.thickness).toBe("number")
	})

	it("seeds a canvas size and an aspect ratio when they're enabled", () => {
		const v = ok({ channelConfigs: { canvasSize: { enabled: true }, aspectRatio: { enabled: true } } })
		expect(v.channelConfigs.canvasSize).toMatchObject({ enabled: true, width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT })
		expect(v.channelConfigs.aspectRatio).toEqual({ enabled: true, length: 1, width: 1 })
	})

	it("mirrors the chart title into the visual name while the name still tracks it", () => {
		const v = ok({ labelsConfig: { title: "Sales by region" } })
		expect(v.name).toBe("Sales by region")
		const renamed = ok({ labelsConfig: { title: "Other" } }, { ...v, name: "My chart" })
		expect(renamed.name).toBe("My chart")
	})

	it("writes a legend title to every channel sharing the field", () => {
		const v = bars({ encodings: { ...bars().encodings, hue: { field: "region" }, shape: { field: "region" } } })
		const out = ok({ labelsConfig: { legendTitles: { hue: "Region" } } }, v)
		expect(out.labelsConfig.legendTitles).toMatchObject({ hue: "Region", shape: "Region" })
	})

	it("keeps an axis side to its own axis and stores the default side as unset", () => {
		expect(paths({ channelConfigs: { x: { side: "left" } } }, bars())).toEqual(["channelConfigs.x.side"])
		expect(paths({ channelConfigs: { y: { side: "top" } } }, bars())).toEqual(["channelConfigs.y.side"])
		const flipped = ok({ channelConfigs: { x: { side: "top" }, y: { side: "right" } } }, bars())
		expect(flipped.channelConfigs.x?.side).toBe("top")
		expect(flipped.channelConfigs.y?.side).toBe("right")
		const back = ok({ channelConfigs: { x: { side: "bottom" }, y: { side: "left" } } }, flipped)
		expect(back.channelConfigs.x?.side).toBeUndefined()
		expect(back.channelConfigs.y?.side).toBeUndefined()
	})

	it("clears the panel size and moves an all-shared axis aside when facet sizing turns on", () => {
		const v = bars({ encodings: { ...bars().encodings, facetRow: { field: "region" }, facetCol: { field: "year" } } })
		const withFacet = { ...v, channelConfigs: { ...v.channelConfigs, facet: { ...DEFAULT_FACET_CONFIG, shareY: "all" as const, panelHeight: 200 } } }
		const out = ok({ channelConfigs: { facet: { proportionalSizingY: "categoryCount" } } }, withFacet)
		expect(out.channelConfigs.facet).toMatchObject({ proportionalSizingY: "categoryCount", panelHeight: null, shareY: "perGroup" })
	})

	it("snaps a wrap grid's other dimension so every panel has a cell", () => {
		const v = bars({ encodings: { ...bars().encodings, facet: { field: "region" } } })
		const withFacet = { ...v, channelConfigs: { ...v.channelConfigs, facet: { ...DEFAULT_FACET_CONFIG, rows: null, cols: null } } }
		expect(ok({ channelConfigs: { facet: { rows: 1 } } }, withFacet).channelConfigs.facet).toMatchObject({ rows: 1, cols: 3 })
		expect(paths({ channelConfigs: { facet: { rows: 9 } } }, withFacet)).toEqual(["channelConfigs.facet.rows"])
	})

	it("seeds the tooltip template and a custom map viewport", () => {
		const v = ok({ tooltipConfig: { useCustomHtml: true } }, bars())
		expect(v.tooltipConfig!.customHtml).toContain("{{sales}}")
		expect(v.tooltipConfig!.customCss).toContain("max-width")
		const map = ok({ mapConfig: { focusRegion: "custom" } })
		expect(map.mapConfig!.customViewport).not.toBeNull()
	})

	it("drops every pick of a custom pattern the patch deletes, the map's no-data pick included", () => {
		const svg = (n: number) => ({ svg: `data:image/svg+xml,<svg id="${n}"/>` })
		const withPatterns = ok({
			channelConfigs: {
				defaultPattern: 1000,
				pattern: { customPatterns: [svg(0), svg(1)], overrides: { West: 1001, East: 2 } },
			},
			mapConfig: { noDataPattern: 1000 },
		})
		// Picking them is a plain store…
		expect(withPatterns.mapConfig!.noDataPattern).toBe(1000)
		// …deleting the first (the × on its chip) empties its slot, and every
		// pick of it goes back to none; the other slot's picks stay.
		const v = ok({ channelConfigs: { pattern: { customPatterns: [null, svg(1)] } } }, withPatterns)
		expect(v.channelConfigs.pattern!.customPatterns).toEqual([null, svg(1)])
		expect(v.channelConfigs.defaultPattern).toBeNull()
		expect(v.mapConfig!.noDataPattern).toBeNull()
		expect(v.channelConfigs.pattern!.overrides).toEqual({ West: 1001, East: 2 })
	})

	it("fills the label x / y from the chart's axes when a value is set without them", () => {
		const v = ok({ dataLabelsEncodings: { value: { field: "sales" } } }, bars())
		expect(v.dataLabelsEncodings!.x).toEqual({ field: "region" })
		// Bars: the value axis takes the Length variable, so the labels draw.
		expect(v.dataLabelsEncodings!.y).toEqual({ field: "sales" })
		const own = ok({ dataLabelsEncodings: { value: { field: "sales" }, x: { field: "year" } } }, bars())
		expect(own.dataLabelsEncodings!.x).toEqual({ field: "year" })
		const none = ok({ dataLabelsEncodings: { value: { field: "sales" }, y: { field: null, none: true } } }, bars())
		expect(none.dataLabelsEncodings!.y).toEqual({ field: null, none: true })
	})

	it("refuses another position field where the labels are locked to the axes", () => {
		const tile = base({
			encodings: { ...base().encodings, x: { field: "region" }, y: { field: "when" }, hue: { field: "sales" } },
			fieldTypeOverrides: { when: "categorical" },
		})
		expect(paths({ dataLabelsEncodings: { x: { field: "sales" } } }, tile)).toEqual(["dataLabelsEncodings.x"])
		expect(ok({ dataLabelsEncodings: { x: { field: "region" } } }, tile).dataLabelsEncodings!.x).toEqual({ field: "region" })
	})

	it("refuses x / y label positions on a flow chart", () => {
		const flow = base({
			encodings: { ...base().encodings, connection: { field: "region" }, area: { field: "sales" } },
			channelConfigs: {
				...base().channelConfigs,
				connection: { ...base().channelConfigs.connection!, hierarchyLayout: "sankey", flowTargetField: "year" },
			},
		})
		const r = apply({ dataLabelsEncodings: { x: { field: "region" } } }, flow)
		expect(r.problems.map((p) => p.path)).toEqual(["dataLabelsEncodings.x"])
	})

	it("refuses a range or breaks on a categorical or mirrored axis", () => {
		expect(paths({ channelConfigs: { x: { min: 0 } } }, bars())).toEqual(["channelConfigs.x.min"])
		expect(ok({ channelConfigs: { y: { min: 0, max: 10 } } }, bars()).channelConfigs.y).toMatchObject({ min: 0, max: 10 })
		const mirrored = {
			...bars(),
			channelConfigs: { ...bars().channelConfigs, y: { ...bars().channelConfigs.y!, mirror: { enabled: true, directionField: "region" } } },
		}
		expect(apply({ channelConfigs: { y: { max: 10 } } }, mirrored).problems[0].message).toMatch(/mirrored/)
	})

	it("clamps numbers as the inputs do", () => {
		const v = ok({ legendConfig: { columns: 9, columnGap: -100 }, tooltipConfig: { hoverFadeAmount: 2 }, dataTableConfig: { maxRows: 0.2 } })
		expect(v.legendConfig).toMatchObject({ columns: 6, columnGap: -48 })
		expect(v.tooltipConfig!.hoverFadeAmount).toBe(1)
		expect(v.dataTableConfig!.maxRows).toBe(1)
		expect(ok({ channelConfigs: { connection: { pointEveryN: 0 } } }).channelConfigs.connection?.pointEveryN).toBe(1)
		expect(ok({ legendConfig: { padding: { left: -8, top: 20 } } }).legendConfig?.padding).toEqual({ left: 0, top: 20 })
	})

	it("keeps histogram, density, violin and box plot exclusive, and drops a mirror that's turned off", () => {
		const hist = ok({ channelConfigs: { x: { histogram: { enabled: true } } } })
		const box = ok({ channelConfigs: { x: { distributionOverlay: { showBoxPlot: true } } } }, hist)
		expect(box.channelConfigs.x?.histogram?.enabled).toBe(false)
		expect(box.channelConfigs.x?.distributionOverlay).toMatchObject({ showBoxPlot: true, showDensityViolin: false })
		const mirrored = ok({ channelConfigs: { y: { mirror: { enabled: true, directionField: "region" } } } })
		expect(ok({ channelConfigs: { y: { mirror: { enabled: false } } } }, mirrored).channelConfigs.y?.mirror).toBeUndefined()
		expect(ok({ channelConfigs: { y: { breaks: [] } } }, bars()).channelConfigs.y?.breaks).toBeUndefined()
	})

	it("stores a value equal to its default as unset", () => {
		const legend = ok({ legendConfig: { hidden: { hue: false }, swatchSizes: { hue: theme.legendSwatchSize } } })
		expect(legend.legendConfig!.hidden).toEqual({})
		expect(legend.legendConfig!.swatchSizes).toEqual({})
		const tip = ok({ tooltipConfig: { tooltipMaxWidth: theme.tooltipMaxWidth, tooltipCornerRadius: theme.tooltipCornerRadius + 1 } })
		expect(tip.tooltipConfig!.tooltipMaxWidth).toBeUndefined()
		expect(tip.tooltipConfig!.tooltipCornerRadius).toBe(theme.tooltipCornerRadius + 1)
		const labels = ok({ labelsConfig: { titleVerticalAlignments: { title: "middle" }, titleAngles: { title: 0 } } })
		expect(labels.labelsConfig.titleVerticalAlignments).toEqual({})
		expect(labels.labelsConfig.titleAngles).toEqual({})
		const wraps = ok({ labelsConfig: { titleWraps: { facetTitle: 12.6, facetRowTitle: 0 } } })
		expect(wraps.labelsConfig.titleWraps).toEqual({ facetTitle: 12, facetRowTitle: 1 })
		const table = ok({ dataTableConfig: { columnAlign: { region: "left" } } }, bars())
		expect(table.dataTableConfig!.columnAlign).toEqual({})
		const dash = ok({ channelConfigs: { connection: { dashGapFill: true } } }, bars())
		expect(dash.channelConfigs.connection?.dashGapFill).toBeNull()
	})

	it("a new chart's Title and Subtitle boxes start unchecked; typing one checks it", () => {
		const fresh = { title: true, subtitle: true }
		expect(base().labelsConfig.hiddenTitles).toEqual(fresh)
		const titled = ok({ labelsConfig: { title: "Sales" } })
		expect(titled.labelsConfig.title).toBe("Sales")
		// The other box stays unchecked.
		expect(titled.labelsConfig.hiddenTitles).toEqual({ subtitle: true })
		expect(ok({ labelsConfig: { subtitle: "By region" } }).labelsConfig.hiddenTitles).toEqual({ title: true })
		// Sparse once nothing is hidden.
		expect(ok({ labelsConfig: { title: "Sales", subtitle: "By region" } }).labelsConfig.hiddenTitles).toBeUndefined()
		// Blank text, or the patch setting the box itself, leaves the box alone.
		expect(ok({ labelsConfig: { title: " " } }).labelsConfig.hiddenTitles).toEqual(fresh)
		expect(
			ok({ labelsConfig: { title: "Sales", hiddenTitles: { title: true } } }).labelsConfig.hiddenTitles
		).toEqual(fresh)
	})

	it("runs without deps as a plain merge", () => {
		const r = applySettings(base(), { legendConfig: { position: "bottom" } })
		expect(r.problems).toEqual([])
		expect(r.visual.legendConfig!.position).toBe("bottom")
	})
})

/** What the Color, Opacity, Saturation, Brightness and Size menus do for
 * one PART of the marks (a stem, a violin's fill, an outline), reached by a
 * settings patch: the path a program writes through. */
describe("applySettings: a part's own color, opacity, saturation, brightness and thickness", () => {
	const scatter = (): Visual => {
		const v = base()
		return { ...v, encodings: { ...v.encodings, x: { field: "year" }, y: { field: "sales" } } }
	}
	/** Violins by region, colored by region: the violin fill follows Color. */
	const violin = (): Visual => {
		const v = base()
		return {
			...v,
			encodings: { ...v.encodings, x: { field: "region" }, y: { field: "sales" }, hue: { field: "region" } },
			channelConfigs: {
				...v.channelConfigs,
				y: { ...v.channelConfigs.y, distributionOverlay: { showDensityViolin: true, showBoxPlot: false } } as never,
			},
		}
	}
	/** The part colors the chart draws with: the stored ones plus Auto's. */
	const drawn = (v: Visual) => withColorSlotDefaults(v.channelConfigs, v.encodings, "categorical", theme).colorSlots

	it("stores only the part the patch names, so every other part stays on Auto", () => {
		expect(drawn(violin())?.violinFill?.field).toBe("region")
		const v = ok({ channelConfigs: { colorSlots: { rug: { singleColor: "#ff0000" } } } }, violin())
		expect(Object.keys(v.channelConfigs.colorSlots ?? {})).toEqual(["rug"])
		expect(v.channelConfigs.colorSlots?.rug).toMatchObject({ field: null, singleColor: "#ff0000" })
		// The violins still take the Color variable's colors.
		expect(drawn(v)?.violinFill?.field).toBe("region")
	})

	it("starts a part's first color edit from what its menu shows", () => {
		const auto = drawn(violin())?.violinFill
		const v = ok({ channelConfigs: { colorSlots: { violinFill: { hue: { colors: { West: "#ff0000" } } } } } }, violin())
		const fill = v.channelConfigs.colorSlots?.violinFill
		// Recoloring one category keeps the variable and the palette.
		expect(fill?.field).toBe("region")
		expect(fill?.palette).toEqual(auto?.palette)
		expect(fill?.hue).toMatchObject({ kind: "categorical", colors: { West: "#ff0000" } })
	})

	it("stores a color that says no more than Auto as unset", () => {
		const v = ok({ channelConfigs: { colorSlots: { violinFill: { field: "region" } } } }, violin())
		expect(v.channelConfigs.colorSlots?.violinFill).toBeUndefined()
		expect(drawn(v)?.violinFill?.field).toBe("region")
	})

	it("puts a part back on Auto with a null, in each of the four menus", () => {
		const colored = ok({ channelConfigs: { colorSlots: { rug: { singleColor: "#ff0000" }, stem: { singleColor: "#00ff00" } } } }, scatter())
		const back = ok({ channelConfigs: { colorSlots: { rug: null } } }, colored)
		expect(Object.keys(back.channelConfigs.colorSlots ?? {})).toEqual(["stem"])
		for (const map of ["opacitySlots", "saturationSlots", "brightnessSlots"] as const) {
			const set = ok({ channelConfigs: { [map]: { stem: { level: 0.4 } } } }, scatter())
			expect(set.channelConfigs[map]).toEqual({ stem: { field: null, level: 0.4 } })
			expect(ok({ channelConfigs: { [map]: { stem: null } } }, set).channelConfigs[map]).toEqual({})
		}
		// A null on a chart with no entries, and a part that doesn't exist.
		expect(ok({ channelConfigs: { colorSlots: { rug: null } } }, scatter()).channelConfigs.colorSlots ?? {}).toEqual({})
		expect(paths({ channelConfigs: { colorSlots: { nope: null } } }, scatter())).toEqual(["channelConfigs.colorSlots.nope"])
	})

	it('seeds a color\'s "Vary by" with the theme\'s palette or gradient, the fill palette for a body', () => {
		const fillTheme: Theme = {
			...theme,
			categoricalPalettes: [
				{ id: "main", name: "Main", colors: ["#110000", "#220000"] },
				{ id: "fill", name: "Fill", colors: ["#ffeeee", "#ffdddd"] },
			],
			defaultCategoricalPaletteId: "main",
			defaultFillPaletteId: "fill",
		}
		const seeded = apply(
			{ channelConfigs: { colorSlots: { stem: { field: "region" }, regressionCiFill: { field: "region" }, rug: { field: "sales" } } } },
			scatter(),
			{ ...deps, theme: fillTheme }
		)
		expect(seeded.problems).toEqual([])
		const slots = seeded.visual.channelConfigs.colorSlots
		expect(slots?.stem).toMatchObject({ field: "region", paletteId: "main", palette: ["#110000", "#220000"] })
		expect(slots?.regressionCiFill).toMatchObject({ field: "region", paletteId: "fill", palette: ["#ffeeee", "#ffdddd"] })
		expect(slots?.rug).toMatchObject({ field: "sales", hue: { kind: "quantitative" } })
	})

	it("leaves a part's colors alone when a patch restates its variable or brings its own", () => {
		const varied = ok({ channelConfigs: { colorSlots: { stem: { field: "region" } } } }, scatter())
		const recolored = ok({ channelConfigs: { colorSlots: { stem: { hue: { colors: { West: "#ff0000" } } } } } }, varied)
		const restated = ok({ channelConfigs: { colorSlots: { stem: { field: "region", singleColor: "#000001" } } } }, recolored)
		expect(restated.channelConfigs.colorSlots?.stem?.hue).toMatchObject({ colors: { West: "#ff0000" } })
		expect(restated.channelConfigs.colorSlots?.stem?.palette).toEqual(varied.channelConfigs.colorSlots?.stem?.palette)
		const own = ok(
			{ channelConfigs: { colorSlots: { stem: { field: "region", hue: { kind: "categorical", colors: { East: "#0000ff" } } } } } },
			scatter()
		)
		expect(own.channelConfigs.colorSlots?.stem?.hue).toMatchObject({ colors: { East: "#0000ff" } })
	})

	it("stores an opacity entry whole and seeds its scale when it varies by a variable", () => {
		const level = OPACITY_SLOT_DEFS.stem.defaultLevel
		const quant = ok({ channelConfigs: { opacitySlots: { stem: { field: "sales" } } } }, scatter())
		expect(quant.channelConfigs.opacitySlots?.stem).toMatchObject({ field: "sales", level, opacity: { kind: "quantitative" } })
		const cat = ok({ channelConfigs: { opacitySlots: { stem: { field: "region" } } } }, scatter())
		expect(cat.channelConfigs.opacitySlots?.stem).toMatchObject({ field: "region", level, opacity: { kind: "categorical" } })
		// Its own scale is kept, and restating the variable doesn't reseed it.
		const own = ok({ channelConfigs: { opacitySlots: { stem: { field: "sales", opacity: { kind: "quantitative", min: 0.2, max: 0.9 } } } } }, scatter())
		expect(own.channelConfigs.opacitySlots?.stem?.opacity).toMatchObject({ min: 0.2, max: 0.9 })
		const restated = ok({ channelConfigs: { opacitySlots: { stem: { field: "sales", level: 0.5 } } } }, own)
		expect(restated.channelConfigs.opacitySlots?.stem).toMatchObject({ level: 0.5, opacity: { min: 0.2, max: 0.9 } })
	})

	it("seeds the theme's range when a saturation or brightness varies by a variable", () => {
		const sat = ok({ channelConfigs: { saturationSlots: { stem: { field: "region" } } } }, scatter())
		expect(sat.channelConfigs.saturationSlots?.stem).toEqual({
			field: "region",
			level: null,
			range: { min: theme.saturationMin, max: theme.saturationMax },
		})
		const bri = ok({ channelConfigs: { brightnessSlots: { stem: { field: "region", range: { min: 0.1, max: 0.2 } } } } }, scatter())
		expect(bri.channelConfigs.brightnessSlots?.stem?.range).toEqual({ min: 0.1, max: 0.2 })
	})

	it("seeds one outline thickness per level, and reads the rows for it", () => {
		expect(settingsReadRows({ channelConfigs: { shape: { outlineWidthField: "region" } } })).toBe(true)
		const v = ok({ channelConfigs: { shape: { outlineWidthField: "region" } } }, scatter())
		const width = v.channelConfigs.shape!.outlineWidth
		expect(v.channelConfigs.shape?.outlineWidthByValue).toEqual({ East: width, North: width, West: width })
		expect(ok({ channelConfigs: { shape: { outlineWidthField: null } } }, v).channelConfigs.shape?.outlineWidthByValue).toEqual({})
		const own = ok({ channelConfigs: { shape: { outlineWidthField: "region", outlineWidthByValue: { West: 3 } } } }, scatter())
		expect(own.channelConfigs.shape?.outlineWidthByValue).toEqual({ West: 3 })
	})

	it("keeps a thickness to its box's range and a level to its slider's", () => {
		const v = ok(
			{
				channelConfigs: {
					connection: { thickness: -4, stemThickness: -5, smoothing: 7, thicknessByValue: { West: -1 } },
					length: { segmentThickness: -2 },
					shape: {
						outlineWidth: 99,
						outlineWidthByValue: { West: 99 },
						distributionOutlineWidth: -1,
						regionOutlineWidth: 99,
						densityCurveOutlineWidth: 99,
					},
					x: { regression: { strokeWidth: 99 } },
					defaultOpacity: 5,
					defaultSaturation: -3,
					saturation: { min: -2, max: 3 },
					opacitySlots: { stem: { level: 4 } },
					saturationSlots: { stem: { level: 9, range: { min: -1, max: 2, overrides: { West: 7 } } } },
					brightnessSlots: { outline: { level: -9 } },
				},
			},
			scatter()
		)
		const c = v.channelConfigs
		expect(c.connection).toMatchObject({ thickness: 0, stemThickness: 0, smoothing: 1, thicknessByValue: { West: 0 } })
		expect(c.length?.segmentThickness).toBe(0)
		expect(c.shape).toMatchObject({
			outlineWidth: OUTLINE_THICKNESS_MAX,
			outlineWidthByValue: { West: OUTLINE_THICKNESS_MAX },
			distributionOutlineWidth: 0,
			regionOutlineWidth: OUTLINE_THICKNESS_MAX,
			densityCurveOutlineWidth: OVERLAY_LINE_THICKNESS_MAX,
		})
		expect(c.x?.regression?.strokeWidth).toBe(OVERLAY_LINE_THICKNESS_MAX)
		expect(c.defaultOpacity).toBe(1)
		expect(c.defaultSaturation).toBe(0)
		expect(c.saturation).toMatchObject({ min: 0, max: 1 })
		expect(c.opacitySlots?.stem?.level).toBe(1)
		expect(c.saturationSlots?.stem).toMatchObject({ level: 1, range: { min: 0, max: 1, overrides: { West: 1 } } })
		expect(c.brightnessSlots?.outline?.level).toBe(0)
		// In range: stored as sent.
		const kept = ok({ channelConfigs: { shape: { outlineWidth: 2.5 }, connection: { smoothing: 0.3 } } }, scatter())
		expect(kept.channelConfigs.shape?.outlineWidth).toBe(2.5)
		expect(kept.channelConfigs.connection?.smoothing).toBe(0.3)
	})
})

const _types: DataLabelsConfig | null = null
void _types
