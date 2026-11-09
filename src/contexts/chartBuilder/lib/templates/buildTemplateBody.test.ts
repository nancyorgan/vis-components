import { describe, expect, it } from "vitest"
import {
	newCircle,
	newLineSegment,
	newRectangle,
	newImageAnnotation,
	newTextAnnotation,
} from "../annotationsConfig"
import { DEFAULT_CAPTION_CONFIG } from "../captionConfig"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DASH_RANGE,
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_FACET_CONFIG,
	DEFAULT_QUANTITATIVE_HUE_CONFIG,
	DEFAULT_REGRESSION_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "../channelConfig"
import { DEFAULT_DATA_TABLE_CONFIG } from "../dataTableConfig"
import { DEFAULT_DERIVED_VARIABLES_CONFIG } from "../derivedVariables"
import {
	DEFAULT_LEGEND_CHANNEL_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	DEFAULT_TOOLTIP_CONFIG,
} from "../labelsConfig"
import { DEFAULT_RESHAPE_CONFIG } from "../reshape"
import { SYSTEM_LIGHT_THEME } from "../systemThemes"
import { labelsFromTheme } from "../themeConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Field,
	type Visual,
} from "../types"
import { buildTemplateBody, buildTemplateMeta } from "./buildTemplateBody"

const quantHue = {
	...DEFAULT_QUANTITATIVE_HUE_CONFIG,
	palette: "customDiverging" as const,
	lowValue: 0,
	midColor: "#ffffff",
	midValue: 50,
	highValue: 100,
	customStops: [
		{ color: "#000000", value: 10 },
		{ color: "#ff0000", value: 90 },
	],
}

const axis = {
	...DEFAULT_AXIS_CONFIG,
	customFormat: "$,.0f",
	min: 0,
	max: 500,
	breaks: [0, 250, 500],
	gridlines: { ...DEFAULT_AXIS_CONFIG.gridlines, breaks: [100, 200] },
	mirror: {
		enabled: true,
		directionField: "Side",
		negativeMax: 40,
		positiveMax: 60,
		breaks: [-40, 0, 60],
	},
	regression: {
		...DEFAULT_REGRESSION_CONFIG,
		dashRange: { enabled: true, min: 1, max: 9 },
	},
}

const pixelRect = {
	...newRectangle("r1"),
	coordSystem: "pixels" as const,
	text: "Recession",
	facetKeys: [{ row: "A", col: "B" }],
}
const valueRect = { ...newRectangle("r2"), coordSystem: "values" as const }

const visual = (): Visual => {
	const encodings = emptyEncodings()
	encodings.x = { field: "Date" }
	encodings.y = { field: "Sales" }
	encodings.hue = { field: "Region" }
	const dle = emptyDataLabelsEncodings()
	dle.value = { field: "Sales" }
	const labels = labelsFromTheme(SYSTEM_LIGHT_THEME)
	return {
		id: "v1",
		name: "Revenue",
		folderId: "f1",
		datasetId: "ds1",
		createdAtVersionId: "ver1",
		fieldTypeOverrides: { Year: "categorical" },
		encodings,
		channelConfigs: {
			...EMPTY_CHANNEL_CONFIGS,
			x: axis,
			y: axis,
			r: axis,
			hue: quantHue,
			outlineHue: quantHue,
			hueQuantStash: quantHue,
			hueCategoricalStash: {
				kind: "categorical",
				colors: { East: "#123456" },
				stackMode: "stack",
			},
			colorSlots: {
				line: { field: "Sales", hue: quantHue, singleColor: "#000" },
				rug: {
					field: "Region",
					hue: { kind: "categorical", colors: { East: "#abcdef" }, stackMode: "stack" },
					singleColor: "#000",
				},
			},
			connection: {
				...DEFAULT_CONNECTION_CONFIG,
				dashRange: { enabled: true, min: 3, max: 7 },
				axisStemCustomX: 42,
				axisStemCustomY: 0.5,
			},
			facet: {
				...DEFAULT_FACET_CONFIG,
				gapX: 12,
				panelAxisOverrides: { East: { yMax: 9 } },
				gridPanelAxisOverrides: { A: { B: { yMax: 9 } } },
				rowAxisOverrides: { A: { max: 5 } },
				colAxisOverrides: { B: { max: 5 } },
				overallXRange: { min: 1 },
				overallYRange: { max: 2 },
				overallRRange: { max: 3 },
				rowRAxisOverrides: { A: { max: 1 } },
				colRAxisOverrides: { B: { max: 1 } },
				panelRAxisOverrides: { C: { max: 1 } },
				panelOrder: { East: 0, West: 1 },
			},
		},
		labelsConfig: {
			...labels,
			title: "Q3 revenue",
			subtitle: "By region",
			xAxisTitle: "Month",
			yAxisTitle: "",
			legendTitles: { hue: "Sales region" },
			titlePrefix: { enabled: true, text: "FIGURE 5." },
			facetTitleColors: { East: "#ff0000" },
		},
		legendConfig: {
			...DEFAULT_LEGEND_CONFIG,
			channels: {
				hue: { ...DEFAULT_LEGEND_CHANNEL_CONFIG, format: ".0%", breaks: [0, 1] },
			},
		},
		tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, customHtml: "<b>{Sales}</b>" },
		dataLabelsEncodings: dle,
		dataLabelsConfig: {
			...DEFAULT_DATA_LABELS_CONFIG,
			labelTemplate: "{Sales}",
			fieldFormats: { Sales: "$.2s" },
			facetKeys: [{ row: "A", col: "B" }],
			fieldFacetKeys: { Sales: null },
			fieldColors: { Sales: { field: "Sales", hue: quantHue, singleColor: "#000" } },
		},
		themeId: "theme-1",
		fieldLevelOrders: { Region: ["West", "East"] },
		fieldLevelOrderSpecs: { Region: { by: "alphabetical" } },
		fieldOrder: ["Sales", "Date"],
		annotationsConfig: {
			rectangles: [pixelRect, valueRect],
			circles: [
				{ ...newCircle("c1"), facetKeys: null },
				{ ...newCircle("c2"), coordSystem: "values" },
			],
			lineSegments: [
				newLineSegment("l1"),
				{ ...newLineSegment("l2"), coordSystem: "values" },
			],
			texts: [newTextAnnotation("t1")],
			images: [
				{ ...newImageAnnotation("m1"), href: "data:image/png;base64,AA==", facetKeys: [] },
				{ ...newImageAnnotation("m2"), href: "data:image/png;base64,AA==", coordSystem: "values" },
			],
		},
		captionConfig: { ...DEFAULT_CAPTION_CONFIG, text: "Source: ACME", fontSize: 20 },
		dataTableConfig: {
			...DEFAULT_DATA_TABLE_CONFIG,
			enabled: true,
			selectedColumns: ["Sales"],
			hiddenPlottedColumns: ["Date"],
			columnAlign: { Sales: "left" },
			title: "Sales by region",
			caption: "Figures in USD",
			fontSize: 11,
		},
		reshapeConfig: { ...DEFAULT_RESHAPE_CONFIG, idFields: ["Region"], meltFields: ["Q1", "Q2"] },
		derivedVariablesConfig: {
			variables: [{ id: "d1", name: "Twice", kind: "math", expression: "{Sales} * 2" }],
		} as unknown as Visual["derivedVariablesConfig"],
		thumbnail: "data:image/png;base64,AAAA",
		thumbnailAt: 5,
		createdAt: 1,
		updatedAt: 2,
		updatedBy: { id: "u", name: "U" } as Visual["updatedBy"],
		templateId: "tpl-0",
	}
}

describe("buildTemplateBody — identity and data binding", () => {
	const body = buildTemplateBody(visual()) as Record<string, unknown>

	it("drops identity / bookkeeping keys and the per-visual field order", () => {
		for (const k of [
			"id",
			"name",
			"folderId",
			"thumbnail",
			"thumbnailAt",
			"createdAt",
			"updatedAt",
			"updatedBy",
			"deletedAt",
			"template",
			"templateId",
			"fieldOrder",
		])
			expect(body).not.toHaveProperty(k)
	})

	it("unbinds the data set and resets reshape / derived / level orders", () => {
		expect(body.datasetId).toBeNull()
		expect(body.createdAtVersionId).toBeNull()
		expect(body.reshapeConfig).toEqual(DEFAULT_RESHAPE_CONFIG)
		expect(body.derivedVariablesConfig).toEqual(DEFAULT_DERIVED_VARIABLES_CONFIG)
		expect(body.fieldLevelOrders).toEqual({})
		expect(body.fieldLevelOrderSpecs).toEqual({})
	})
})

describe("buildTemplateBody — data-value strips", () => {
	const body = buildTemplateBody(visual())
	const cc = body.channelConfigs

	it("strips axis min / max / breaks, gridline breaks, mirror maxima and breaks, regression dash range", () => {
		for (const ch of ["x", "y", "r"] as const) {
			const a = cc[ch]!
			expect(a).not.toHaveProperty("min")
			expect(a).not.toHaveProperty("max")
			expect(a).not.toHaveProperty("breaks")
			expect(a.gridlines).not.toHaveProperty("breaks")
			expect(a.mirror).toEqual({ enabled: true, directionField: "Side" })
			expect(a.regression?.dashRange).toEqual({ enabled: true, min: null, max: null })
			expect(a.customFormat).toBe("$,.0f")
		}
	})

	it("resets every facet override and the panel order, keeping layout knobs", () => {
		const f = cc.facet!
		expect(f.panelAxisOverrides).toEqual({})
		expect(f.rowAxisOverrides).toEqual({})
		expect(f.colAxisOverrides).toEqual({})
		expect(f.panelOrder).toEqual({})
		expect(f.overallXRange).toEqual(DEFAULT_FACET_CONFIG.overallXRange)
		expect(f.overallYRange).toEqual(DEFAULT_FACET_CONFIG.overallYRange)
		for (const k of [
			"gridPanelAxisOverrides",
			"rowRAxisOverrides",
			"colRAxisOverrides",
			"panelRAxisOverrides",
			"overallRRange",
		])
			expect(f).not.toHaveProperty(k)
		expect(f.gapX).toBe(12)
	})

	it("nulls gradient stop values on every quantitative hue, keeping colors", () => {
		const stripped = [
			cc.hue,
			cc.outlineHue,
			cc.hueQuantStash,
			cc.colorSlots?.line?.hue,
			body.dataLabelsConfig?.fieldColors?.Sales.hue,
		]
		for (const h of stripped) {
			expect(h).toMatchObject({
				kind: "quantitative",
				lowValue: null,
				midValue: null,
				highValue: null,
				midColor: "#ffffff",
				customStops: [
					{ color: "#000000", value: null },
					{ color: "#ff0000", value: null },
				],
			})
		}
		expect(cc.colorSlots?.rug?.hue).toEqual({
			kind: "categorical",
			colors: { East: "#abcdef" },
			stackMode: "stack",
		})
	})

	it("nulls the connection dash range", () => {
		expect(cc.connection?.dashRange).toEqual({ enabled: true, min: null, max: null })
	})

	it("clears legend break values, keeping the format", () => {
		expect(body.legendConfig?.channels?.hue).toEqual({
			...DEFAULT_LEGEND_CHANNEL_CONFIG,
			format: ".0%",
			breaks: [],
		})
	})

	it("drops value-placed and text annotations, keeps pixel/percent ones without scope or text", () => {
		const a = body.annotationsConfig!
		expect(a.rectangles.map((r) => r.id)).toEqual(["r1"])
		expect(a.rectangles[0].text).toBe("")
		expect(a.rectangles[0]).not.toHaveProperty("facetKeys")
		expect(a.rectangles[0].coordSystem).toBe("pixels")
		expect(a.circles.map((c) => c.id)).toEqual(["c1"])
		expect(a.circles[0]).not.toHaveProperty("facetKeys")
		expect(a.lineSegments.map((l) => l.id)).toEqual(["l1"])
		expect(a.texts).toEqual([])
		// Pictures are format (a logo on every chart), so they stay — minus
		// value-mode placements and panel scopes, like the shapes.
		expect(a.images.map((m) => m.id)).toEqual(["m1"])
		expect("facetKeys" in a.images[0]!).toBe(false)
	})

	it("drops data-label panel scope", () => {
		expect(body.dataLabelsConfig).not.toHaveProperty("facetKeys")
		expect(body.dataLabelsConfig?.fieldFacetKeys).toEqual({})
	})

	it("clears the data-table column picks, keeping style", () => {
		const t = body.dataTableConfig!
		expect(t.selectedColumns).toEqual([])
		expect(t.hiddenPlottedColumns).toEqual([])
		expect(t.columnAlign).toEqual({})
		expect(t.enabled).toBe(true)
		expect(t.fontSize).toBe(11)
	})

	it("clears the data-table title and caption (custom prose)", () => {
		expect(body.dataTableConfig?.title).toBeNull()
		expect(body.dataTableConfig?.caption).toBeNull()
	})

	it("drops the custom threshold stems (data values)", () => {
		expect(body.channelConfigs.connection).toBeDefined()
		expect("axisStemCustomX" in body.channelConfigs.connection!).toBe(false)
		expect("axisStemCustomY" in body.channelConfigs.connection!).toBe(false)
	})
})

describe("buildTemplateBody — custom text", () => {
	const body = buildTemplateBody(visual())

	it("placeholders the titles and reverts axis / legend titles to automatic", () => {
		const l = body.labelsConfig
		expect(l.title).toBe("Title")
		expect(l.subtitle).toBe("Subtitle")
		expect(l.xAxisTitle).toBeUndefined()
		expect(l.yAxisTitle).toBeUndefined()
		expect(l.legendTitles).toEqual({})
		expect(l.titlePrefix).toEqual({ enabled: true, text: "" })
	})

	it("clears the caption text, keeping its style", () => {
		expect(body.captionConfig?.text).toBe("")
		expect(body.captionConfig?.fontSize).toBe(20)
	})
})

describe("buildTemplateBody — kept", () => {
	const v = visual()
	const body = buildTemplateBody(v)

	it("keeps per-category styling, theme, overrides, tooltip and label templates", () => {
		expect(body.channelConfigs.hueCategoricalStash?.colors).toEqual({ East: "#123456" })
		expect(body.labelsConfig.facetTitleColors).toEqual({ East: "#ff0000" })
		expect(body.labelsConfig.baseFont).toEqual(v.labelsConfig.baseFont)
		expect(body.themeId).toBe("theme-1")
		expect(body.fieldTypeOverrides).toEqual({ Year: "categorical" })
		expect(body.tooltipConfig?.customHtml).toBe("<b>{Sales}</b>")
		expect(body.dataLabelsConfig?.labelTemplate).toBe("{Sales}")
		expect(body.dataLabelsConfig?.fieldFormats).toEqual({ Sales: "$.2s" })
		expect(body.encodings).toEqual(v.encodings)
	})

	it("keeps a categorical main hue's colors", () => {
		const cat = visual()
		cat.channelConfigs = {
			...cat.channelConfigs,
			hue: { kind: "categorical", colors: { East: "#111111" }, stackMode: "group" },
		}
		expect(buildTemplateBody(cat).channelConfigs.hue).toEqual({
			kind: "categorical",
			colors: { East: "#111111" },
			stackMode: "group",
		})
	})

	it("does not mutate its input", () => {
		const before = visual()
		buildTemplateBody(v)
		expect(v).toEqual(before)
	})

	it("leaves an unconfigured dash range alone", () => {
		const plain = visual()
		plain.channelConfigs = {
			...plain.channelConfigs,
			connection: { ...DEFAULT_CONNECTION_CONFIG, dashRange: DEFAULT_DASH_RANGE },
		}
		expect(buildTemplateBody(plain).channelConfigs.connection?.dashRange).toBe(
			DEFAULT_DASH_RANGE,
		)
	})
})

describe("buildTemplateMeta", () => {
	it("records source fields and the non-Auto formats by kind", () => {
		const fields: Field[] = [
			{ name: "Date", inferredType: "temporal" },
			{ name: "Sales", inferredType: "quantitative", formatHint: "dollar" },
			{ name: "Region", inferredType: "categorical" },
			{ name: "Year", inferredType: "quantitative" },
		]
		const meta = buildTemplateMeta(visual(), fields)
		expect(meta.sourceFields).toEqual([
			{ name: "Date", type: "temporal", kind: "date" },
			{ name: "Sales", type: "quantitative", kind: "dollar" },
			{ name: "Region", type: "categorical", kind: "category" },
			{ name: "Year", type: "categorical", kind: "category" },
		])
		expect(meta.formatMemory).toEqual({
			"axis:x": { date: "$,.0f" },
			"axis:y": { dollar: "$,.0f" },
			"labels:value": { dollar: "$.2s" },
			// The fixture's hue legend carries a stored format over a
			// categorical field; memory records it under that kind.
			"legend:hue": { category: ".0%" },
		})
	})
})
