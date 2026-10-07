import { describe, expect, it } from "vitest"

import { BarsYMode } from "./chartModes/barsY"
import { ChordMode } from "./chartModes/chord"
import { PackedCirclesMode } from "./chartModes/packedCircles"
import { PiesMode } from "./chartModes/pies"
import { ScatterMode } from "./chartModes/scatter"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	DEFAULT_HISTOGRAM_CONFIG,
	type ChannelConfigs,
} from "./channelConfig"
import {
	DEFAULT_LABELS_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	type LabelsConfig,
	type LegendConfig,
} from "./labelsConfig"
import {
	chunkColumns,
	orderCategories,
	planLegendSections,
	sampleRampCssStops,
	uniqueValues,
	type PlanLegendSectionsInput,
	type SectionInfo,
} from "./legendSections"
import { hierarchyHighlightField } from "./packedMeasure"
import { makeHueScale } from "./scales"
import {
	emptyEncodings,
	type DatasetView,
	type Encodings,
	type Field,
} from "./types"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A small scatter-ish table: two categoricals + two quantitatives. */
const FIELDS: Field[] = [
	{ name: "region", inferredType: "categorical" },
	{ name: "kind", inferredType: "categorical" },
	{ name: "score", inferredType: "quantitative" },
	{ name: "weight", inferredType: "quantitative" },
]
const ROWS: Array<Record<string, string>> = [
	{ region: "North", kind: "a", score: "1", weight: "10" },
	{ region: "South", kind: "b", score: "5", weight: "20" },
	{ region: "North", kind: "c", score: "9", weight: "30" },
	{ region: "East", kind: "a", score: "3", weight: "40" },
]

const view = (
	fields: Field[] = FIELDS,
	rows: Array<Record<string, string>> = ROWS,
): DatasetView => ({
	id: "ds-1",
	name: "data",
	filename: "data.csv",
	fields,
	rows,
	createdAt: 0,
	versionId: "dv-1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

/** Map channels to fields on top of `emptyEncodings()`. */
const enc = (map: Partial<Record<keyof Encodings, string>>): Encodings => {
	const e = emptyEncodings()
	for (const [ch, field] of Object.entries(map)) {
		e[ch as keyof Encodings] = { field: field ?? null }
	}
	return e
}

const legendCfg = (patch: Partial<LegendConfig> = {}): LegendConfig => ({
	...DEFAULT_LEGEND_CONFIG,
	hidden: {},
	channels: {},
	...patch,
})

const labelsCfg = (patch: Partial<LabelsConfig> = {}): LabelsConfig => ({
	...DEFAULT_LABELS_CONFIG,
	legendTitles: {},
	...patch,
})

const NO_EXTRAS = { top: 0, right: 0, bottom: 0, left: 0 }

const plan = (patch: Partial<PlanLegendSectionsInput> = {}) =>
	planLegendSections({
		encodings: emptyEncodings(),
		configs: {},
		dataset: view(),
		overrides: {},
		labels: labelsCfg(),
		legendCfg: legendCfg(),
		modeDef: ScatterMode,
		insideExtras: NO_EXTRAS,
		...patch,
	})

/** Section planning only — the part most tests care about. */
const sectionsOf = (patch: Partial<PlanLegendSectionsInput> = {}): SectionInfo[] =>
	plan(patch)?.sections ?? []

/** Compact, order-preserving fingerprint of a section for assertions. */
const describeSection = (s: SectionInfo) =>
	s.kind === "single"
		? { kind: s.kind, channel: s.channel, field: s.field, type: s.type }
		: s.kind === "combined"
			? { kind: s.kind, channels: [...s.channels], field: s.field, type: s.type }
			: { kind: s.kind, legendKey: s.legendKey, slotKey: s.slotKey, field: s.field }

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("legendSections helpers", () => {
	it("uniqueValues dedupes stringified parsed values and drops blanks", () => {
		expect(uniqueValues(["b", "a", "b", "", null, undefined], "categorical")).toEqual([
			"b",
			"a",
		])
		// Quantitative parsing normalizes numeric text; non-numbers drop out.
		expect(uniqueValues(["1", "1.0", "x", "2"], "quantitative")).toEqual(["1", "2"])
	})

	it("orderCategories keeps discovery order without a pin and leads with pinned levels", () => {
		const discovered = ["c", "a", "b"]
		expect(orderCategories(discovered, "categorical", undefined)).toEqual(discovered)
		expect(orderCategories(discovered, "categorical", [])).toEqual(discovered)
		const pinned = orderCategories(discovered, "categorical", ["b", "zzz"])
		expect(pinned[0]).toBe("b")
		expect([...pinned].sort()).toEqual(["a", "b", "c"])
	})

	it("chunkColumns splits into balanced contiguous groups", () => {
		expect(chunkColumns([1, 2, 3, 4, 5], 2)).toEqual([
			[1, 2, 3],
			[4, 5],
		])
		expect(chunkColumns([1, 2, 3, 4, 5], 1)).toEqual([[1, 2, 3, 4, 5]])
		expect(chunkColumns([1], 3)).toEqual([[1]])
		// Never emits an empty trailing column when cols > items.
		expect(chunkColumns([1, 2], 3)).toEqual([[1], [2]])
	})

	it("sampleRampCssStops emits 32 stops from t=0 to t=1 with a color each", () => {
		const scale = makeHueScale(["0", "10"], "quantitative")
		const stops = sampleRampCssStops(scale, 0, 10, "quantitative")
		expect(stops).toHaveLength(32)
		expect(stops[0]?.t).toBe(0)
		expect(stops.at(-1)?.t).toBe(1)
		expect(stops.every((s) => typeof s.color === "string" && s.color.length > 0)).toBe(
			true,
		)
	})
})

// ---------------------------------------------------------------------------
// Section planning
// ---------------------------------------------------------------------------

describe("planLegendSections — field-backed sections", () => {
	it("returns null when no legend candidate is mapped", () => {
		expect(plan()).toBeNull()
		// x/y alone never produce a legend.
		expect(plan({ encodings: enc({ x: "score", y: "weight" }) })).toBeNull()
	})

	it("categorical hue alone is one combined section carrying the column values", () => {
		const sections = sectionsOf({ encodings: enc({ hue: "region" }) })
		expect(sections.map(describeSection)).toEqual([
			{ kind: "combined", channels: ["hue"], field: "region", type: "categorical" },
		])
		expect(sections[0]?.values).toEqual(["North", "South", "North", "East"])
		expect(sections[0]?.kind === "combined" && sections[0].titleChannel).toBe("hue")
	})

	it("quantitative hue reads the inferred type; a type override wins over it", () => {
		expect(sectionsOf({ encodings: enc({ hue: "score" }) })[0]?.type).toBe(
			"quantitative",
		)
		expect(
			sectionsOf({
				encodings: enc({ hue: "score" }),
				overrides: { score: "ordinal" },
			})[0]?.type,
		).toBe("ordinal")
	})

	it("hue + shape on the SAME field collapse into one combined section", () => {
		const sections = sectionsOf({ encodings: enc({ hue: "region", shape: "region" }) })
		expect(sections.map(describeSection)).toEqual([
			{
				kind: "combined",
				channels: ["hue", "shape"],
				field: "region",
				type: "categorical",
			},
		])
	})

	it("hue + shape on DIFFERENT fields are two sections, shape standalone", () => {
		const sections = sectionsOf({ encodings: enc({ hue: "region", shape: "kind" }) })
		expect(sections.map(describeSection)).toEqual([
			{ kind: "combined", channels: ["hue"], field: "region", type: "categorical" },
			{ kind: "single", channel: "shape", field: "kind", type: "categorical" },
		])
	})

	it("solo size / length / angle fall through to their standalone renderers", () => {
		for (const ch of ["area", "length", "angle"] as const) {
			const sections = sectionsOf({ encodings: enc({ [ch]: "weight" }) })
			expect(sections.map(describeSection)).toEqual([
				{ kind: "single", channel: ch, field: "weight", type: "quantitative" },
			])
		}
	})

	it("solo pattern / opacity stay combined-kind (the composed swatch draws them)", () => {
		expect(sectionsOf({ encodings: enc({ pattern: "kind" }) }).map(describeSection)).toEqual([
			{ kind: "combined", channels: ["pattern"], field: "kind", type: "categorical" },
		])
		expect(sectionsOf({ encodings: enc({ opacity: "weight" }) }).map(describeSection)).toEqual(
			[{ kind: "combined", channels: ["opacity"], field: "weight", type: "quantitative" }],
		)
	})

	it("orders sections by the legend candidate order, not the mapping order", () => {
		const sections = sectionsOf({
			encodings: enc({ opacity: "weight", pattern: "kind", hue: "region", area: "score" }),
		})
		// hue(0) → pattern(2) → area(3) → opacity(4)
		expect(sections.map((s) => s.field)).toEqual(["region", "kind", "score", "weight"])
	})

	it("mode traits suppress the length legend in bars and the angle legend in pies", () => {
		expect(
			plan({ encodings: enc({ x: "region", length: "score" }), modeDef: BarsYMode }),
		).toBeNull()
		expect(plan({ encodings: enc({ angle: "score" }), modeDef: PiesMode })).toBeNull()
		// …but the same encodings keep their legend in scatter.
		expect(sectionsOf({ encodings: enc({ angle: "score" }) })).toHaveLength(1)
	})
})

describe("planLegendSections — hidden toggles + combine control", () => {
	it("a hidden channel drops out of a shared-field group; the rest still render", () => {
		const sections = sectionsOf({
			encodings: enc({ hue: "region", shape: "region" }),
			legendCfg: legendCfg({ hidden: { hue: true } }),
		})
		// Shape left alone is a standalone single section.
		expect(sections.map(describeSection)).toEqual([
			{ kind: "single", channel: "shape", field: "region", type: "categorical" },
		])
	})

	it("hiding every mapped channel yields null", () => {
		expect(
			plan({
				encodings: enc({ hue: "region", area: "weight" }),
				legendCfg: legendCfg({ hidden: { hue: true, area: true } }),
			}),
		).toBeNull()
	})

	it("combineSameVariable=false emits one section per channel on a shared field", () => {
		const sections = sectionsOf({
			encodings: enc({ hue: "region", pattern: "region" }),
			legendCfg: legendCfg({ combineSameVariable: false }),
		})
		expect(sections.map(describeSection)).toEqual([
			{ kind: "combined", channels: ["hue"], field: "region", type: "categorical" },
			{ kind: "combined", channels: ["pattern"], field: "region", type: "categorical" },
		])
		expect(sections.map((s) => s.kind === "combined" && s.titleChannel)).toEqual([
			"hue",
			"pattern",
		])
	})
})

describe("planLegendSections — legend titles drive splitting", () => {
	const shared = enc({ hue: "region", outlineHue: "region" })

	it("two DISTINCT titles on a shared field split it into a legend per title", () => {
		const sections = sectionsOf({
			encodings: shared,
			labels: labelsCfg({ legendTitles: { hue: "Fill", outlineHue: "Status" } }),
		})
		expect(sections.map(describeSection)).toEqual([
			{ kind: "combined", channels: ["hue"], field: "region", type: "categorical" },
			{ kind: "combined", channels: ["outlineHue"], field: "region", type: "categorical" },
		])
		expect(sections.map((s) => s.kind === "combined" && s.titleChannel)).toEqual([
			"hue",
			"outlineHue",
		])
	})

	it("the SAME title on both channels keeps one combined legend", () => {
		const sections = sectionsOf({
			encodings: shared,
			labels: labelsCfg({ legendTitles: { hue: "Region", outlineHue: "Region" } }),
		})
		expect(sections.map(describeSection)).toEqual([
			{
				kind: "combined",
				channels: ["hue", "outlineHue"],
				field: "region",
				type: "categorical",
			},
		])
	})

	it("titling only the outline keeps one legend headed by the outline channel", () => {
		const sections = sectionsOf({
			encodings: shared,
			labels: labelsCfg({ legendTitles: { outlineHue: "Status" } }),
		})
		expect(sections).toHaveLength(1)
		expect(sections[0]?.kind === "combined" && sections[0].titleChannel).toBe("outlineHue")
	})
})

// ---------------------------------------------------------------------------
// Derived / synthetic sections
// ---------------------------------------------------------------------------

/** Canonical edge list (Parent, Child, Value) — three top-level groups,
 *  Melon nesting three deep. */
const TREE_FIELDS: Field[] = [
	{ name: "Parent", inferredType: "categorical" },
	{ name: "Child", inferredType: "categorical" },
	{ name: "Value", inferredType: "quantitative" },
]
const TREE_ROWS = [
	{ Parent: "Pome", Child: "Apple", Value: "7" },
	{ Parent: "Pome", Child: "Pear", Value: "7" },
	{ Parent: "Citrus", Child: "Lemon", Value: "8" },
	{ Parent: "Melon", Child: "Watermelon", Value: "" },
	{ Parent: "Melon", Child: "Canteloupe", Value: "7" },
	{ Parent: "Watermelon", Child: "Mini", Value: "1" },
	{ Parent: "Watermelon", Child: "Seedless", Value: "1" },
]

const treeEncodings = (source: "rootGroup" | "depth"): Encodings => {
	const e = enc({ connection: "Parent", area: "Value" })
	e.hue = { field: null, measureSource: source }
	return e
}

describe("planLegendSections — hierarchy-derived Color", () => {
	it("Top-level group leads the legend as a categorical section over the root groups", () => {
		const sections = sectionsOf({
			encodings: treeEncodings("rootGroup"),
			dataset: view(TREE_FIELDS, TREE_ROWS),
			modeDef: PackedCirclesMode,
			legendCfg: legendCfg({ hidden: { area: true } }),
		})
		expect(sections.map(describeSection)).toEqual([
			{ kind: "single", channel: "hue", field: "Top-level group", type: "categorical" },
		])
		const s = sections[0]
		expect(s?.values).toEqual(["Pome", "Citrus", "Melon"])
		expect(s?.kind === "single" && s.highlightField).toBe(
			hierarchyHighlightField("rootGroup"),
		)
	})

	it("Nesting depth is an ORDINAL section over the depth levels present", () => {
		const sections = sectionsOf({
			encodings: treeEncodings("depth"),
			dataset: view(TREE_FIELDS, TREE_ROWS),
			modeDef: PackedCirclesMode,
			legendCfg: legendCfg({ hidden: { area: true } }),
		})
		expect(sections.map(describeSection)).toEqual([
			{ kind: "single", channel: "hue", field: "Nesting depth", type: "ordinal" },
		])
		expect(sections[0]?.values).toEqual(["1", "2", "3"])
		expect(sections[0]?.kind === "single" && sections[0].highlightField).toBe(
			hierarchyHighlightField("depth"),
		)
	})

	it("the derived section sits AHEAD of field-backed sections and honors the hue toggle", () => {
		const e = treeEncodings("rootGroup")
		e.pattern = { field: "Parent" }
		const dataset = view(TREE_FIELDS, TREE_ROWS)
		const shown = sectionsOf({
			encodings: e,
			dataset,
			modeDef: PackedCirclesMode,
			legendCfg: legendCfg({ hidden: { area: true } }),
		})
		expect(shown.map((s) => s.field)).toEqual(["Top-level group", "Parent"])

		const hidden = sectionsOf({
			encodings: e,
			dataset,
			modeDef: PackedCirclesMode,
			legendCfg: legendCfg({ hidden: { area: true, hue: true } }),
		})
		expect(hidden.map((s) => s.field)).toEqual(["Parent"])
	})

	it("outside the tree modes a derived hue source adds nothing", () => {
		expect(
			plan({
				encodings: treeEncodings("rootGroup"),
				dataset: view(TREE_FIELDS, TREE_ROWS),
				modeDef: ScatterMode,
				legendCfg: legendCfg({ hidden: { area: true } }),
			}),
		).toBeNull()
	})
})

describe("planLegendSections — flow node union", () => {
	const FLOW_FIELDS: Field[] = [
		{ name: "src", inferredType: "categorical" },
		{ name: "dst", inferredType: "categorical" },
		{ name: "flow", inferredType: "quantitative" },
	]
	const FLOW_ROWS = [
		{ src: "A", dst: "B", flow: "1" },
		{ src: "B", dst: "C", flow: "2" },
		{ src: "A", dst: "C", flow: "3" },
	]

	it("an endpoint-field section reads the source ∪ target names in first-appearance order", () => {
		const sections = sectionsOf({
			encodings: enc({ connection: "src", area: "flow", hue: "src" }),
			configs: { connection: { ...DEFAULT_CONNECTION_CONFIG, flowTargetField: "dst" } },
			dataset: view(FLOW_FIELDS, FLOW_ROWS),
			modeDef: ChordMode,
			legendCfg: legendCfg({ hidden: { area: true } }),
		})
		expect(sections.map(describeSection)).toEqual([
			{ kind: "combined", channels: ["hue"], field: "src", type: "categorical" },
		])
		// The raw column would be ["A", "B", "A"] — C is destination-only.
		expect(sections[0]?.values).toEqual(["A", "B", "C"])
	})
})

describe("planLegendSections — histogram + hexbin measures", () => {
	// Two 0–20 bins over 18 rows: counts [9, 9].
	const HIST_FIELDS: Field[] = [{ name: "v", inferredType: "quantitative" }]
	const HIST_ROWS = [
		...[1, 2, 3, 4, 5, 15, 16, 17],
		...[1, 2, 3, 4, 11, 12, 13, 14, 15, 16],
	].map((v) => ({ v: String(v) }))
	const histConfigs = (mode: "count" | "density" = "count"): ChannelConfigs => ({
		x: {
			...DEFAULT_AXIS_CONFIG,
			histogram: { ...DEFAULT_HISTOGRAM_CONFIG, enabled: true, binCount: 2, mode },
		},
	})

	it("Count-colored histogram bars get a synthetic quantitative section over [0, max bin]", () => {
		const e = enc({ x: "v" })
		e.hue = { field: null, measureSource: "count" }
		const sections = sectionsOf({
			encodings: e,
			configs: histConfigs(),
			dataset: view(HIST_FIELDS, HIST_ROWS),
		})
		expect(sections.map(describeSection)).toEqual([
			{ kind: "single", channel: "hue", field: "Count", type: "quantitative" },
		])
		expect(sections[0]?.values).toEqual([0, 9])
	})

	it("Density on opacity titles the section Density; the hue toggle hides only hue", () => {
		const e = enc({ x: "v" })
		e.hue = { field: null, measureSource: "count" }
		e.opacity = { field: null, measureSource: "density" }
		const sections = sectionsOf({
			encodings: e,
			configs: histConfigs("density"),
			dataset: view(HIST_FIELDS, HIST_ROWS),
			legendCfg: legendCfg({ hidden: { hue: true } }),
		})
		expect(sections.map(describeSection)).toEqual([
			{ kind: "single", channel: "opacity", field: "Density", type: "quantitative" },
		])
		const [lo, hi] = sections[0]?.values ?? []
		expect(lo).toBe(0)
		expect(typeof hi === "number" && hi > 0).toBe(true)
	})

	it("hexbin point count becomes a quantitative hue section over [0, max cell count]", () => {
		const e = enc({ x: "score", y: "weight" })
		e.hue = { field: null, measureSource: "hexCount" }
		const rows = [
			{ region: "n", kind: "a", score: "1", weight: "1" },
			{ region: "n", kind: "a", score: "1", weight: "1" },
			{ region: "n", kind: "a", score: "9", weight: "9" },
		]
		const sections = sectionsOf({ encodings: e, dataset: view(FIELDS, rows) })
		expect(sections.map(describeSection)).toEqual([
			{ kind: "single", channel: "hue", field: "Point count", type: "quantitative" },
		])
		expect(sections[0]?.values[0]).toBe(0)
		expect(sections[0]?.values[1]).toBe(2)
	})

	it("hexbin needs both positions quantitative; a categorical x adds nothing", () => {
		const e = enc({ x: "region", y: "weight" })
		e.hue = { field: null, measureSource: "hexCount" }
		expect(plan({ encodings: e })).toBeNull()
	})
})

describe("planLegendSections — color-slot sections", () => {
	const rugConfigs = (showRug: boolean): ChannelConfigs => ({
		x: {
			...DEFAULT_AXIS_CONFIG,
			histogram: { ...DEFAULT_HISTOGRAM_CONFIG, enabled: true, showRug },
		},
		colorSlots: { rug: { field: "region", singleColor: "#000000" } },
	})

	it("a field-colored rug gets a slot section only while a rug is drawn", () => {
		const e = enc({ x: "score" })
		const sections = sectionsOf({ encodings: e, configs: rugConfigs(true) })
		expect(sections.map(describeSection)).toEqual([
			{ kind: "slot", legendKey: "rug", slotKey: "rug", field: "region" },
		])
		expect(sections[0]?.type).toBe("categorical")
		expect(plan({ encodings: e, configs: rugConfigs(false) })).toBeNull()
		expect(
			plan({
				encodings: e,
				configs: rugConfigs(true),
				legendCfg: legendCfg({ hidden: { rug: true } }),
			}),
		).toBeNull()
	})

	it("a grouped density curve coalesces into one section keyed on the stroke slot when mapped", () => {
		const e = enc({ x: "score" })
		const curveOn: ChannelConfigs["x"] = {
			...DEFAULT_AXIS_CONFIG,
			distributionOverlay: {
				...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
				showDensityCurve: true,
			},
		}
		const fillOnly = sectionsOf({
			encodings: e,
			configs: {
				x: curveOn,
				colorSlots: { densityCurveFill: { field: "kind", singleColor: "#000000" } },
			},
		})
		expect(fillOnly.map(describeSection)).toEqual([
			{
				kind: "slot",
				legendKey: "densityCurve",
				slotKey: "densityCurveFill",
				field: "kind",
			},
		])
		const both = sectionsOf({
			encodings: e,
			configs: {
				x: curveOn,
				colorSlots: {
					densityCurveFill: { field: "kind", singleColor: "#000000" },
					densityCurveStroke: { field: "kind", singleColor: "#000000" },
				},
			},
		})
		expect(both).toHaveLength(1)
		expect(both[0]?.kind === "slot" && both[0].slotKey).toBe("densityCurveStroke")
		// No curve drawn → no legend, even with the slot mapped.
		expect(
			plan({
				encodings: e,
				configs: {
					colorSlots: { densityCurveFill: { field: "kind", singleColor: "#000000" } },
				},
			}),
		).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// Box layout
// ---------------------------------------------------------------------------

describe("planLegendSections — layout plan", () => {
	const two = enc({ hue: "region", shape: "kind" })

	it("≥2 sections + columns>1 pack whole sections, capped at the section count", () => {
		const p = plan({ encodings: two, legendCfg: legendCfg({ columns: 3, columnGap: 10 }) })
		expect(p?.columnsApply).toBe(true)
		expect(p?.packSections).toBe(true)
		expect(p?.effectiveCols).toBe(2)
		expect(p?.entryColumns).toBe(1)
		expect(p?.innerStyle["--vc-legend-col-gap" as keyof typeof p.innerStyle]).toBe("10px")
	})

	it("a single categorical section wraps its ENTRIES across the columns", () => {
		const p = plan({ encodings: enc({ hue: "region" }), legendCfg: legendCfg({ columns: 2 }) })
		expect(p?.columnsApply).toBe(true)
		expect(p?.packSections).toBe(false)
		expect(p?.entryColumns).toBe(2)
	})

	it("a single quantitative (gradient) section ignores the columns ticker", () => {
		const p = plan({ encodings: enc({ hue: "score" }), legendCfg: legendCfg({ columns: 2 }) })
		expect(p?.columnsApply).toBe(false)
		expect(p?.effectiveCols).toBe(1)
		expect(p?.entryColumns).toBe(1)
	})

	it("stacked vertical sections share a swatch column; horizontal entries do not", () => {
		const vertical = plan({ encodings: two })
		expect(vertical?.alignSwatchColumn).toBe(true)
		expect(
			vertical?.innerStyle["--vc-legend-swatch-col" as keyof typeof vertical.innerStyle],
		).toMatch(/px$/)
		const horizontal = plan({
			encodings: two,
			legendCfg: legendCfg({ orientation: "horizontal" }),
		})
		expect(horizontal?.alignSwatchColumn).toBe(false)
		expect(plan({ encodings: enc({ hue: "region" }) })?.alignSwatchColumn).toBe(false)
	})

	it("an outside legend budgets a numeric width that grows with measured text", () => {
		const base = plan({ encodings: enc({ hue: "region" }) })
		const width = base?.outerStyle?.width
		expect(typeof width).toBe("number")
		expect(width as number).toBeGreaterThanOrEqual(100)
		expect(width as number).toBeLessThanOrEqual(560)
		const wide = plan({ encodings: enc({ hue: "region" }), measureText: () => 400 })
		expect(wide?.outerStyle?.width as number).toBeGreaterThan(width as number)
		// The cap holds even for absurd measurements.
		const huge = plan({ encodings: enc({ hue: "region" }), measureText: () => 5000 })
		expect(huge?.outerStyle?.width).toBe(560)
	})

	it("a user-fixed width replaces the estimate and switches the inner box to wrapping", () => {
		const p = plan({ encodings: enc({ hue: "region" }), legendCfg: legendCfg({ width: 300 }) })
		expect(p?.outerStyle?.width).toBe(300)
		expect(p?.outerStyle?.maxWidth).toBeUndefined()
		expect(p?.innerClass).toContain("vc-legend-fixed-width")
		expect(p?.innerStyle.width).toBe("100%")
		// ≤ 0 reads as auto.
		const auto = plan({ encodings: enc({ hue: "region" }), legendCfg: legendCfg({ width: 0 }) })
		expect(auto?.innerClass).not.toContain("vc-legend-fixed-width")
	})

	it("inside legends anchor the RIGHT edge when insideX is auto and the LEFT edge once typed", () => {
		const auto = plan({
			encodings: enc({ hue: "region" }),
			legendCfg: legendCfg({ position: "inside", insideX: null }),
		})
		expect(auto?.outerClass).toBe("absolute z-10")
		expect(auto?.innerClass).toBe("inline-block p-3")
		expect(auto?.outerStyle?.right).toMatch(/^calc\(/)
		expect(auto?.outerStyle?.left).toBeUndefined()
		const typed = plan({
			encodings: enc({ hue: "region" }),
			legendCfg: legendCfg({ position: "inside", insideX: 0.1 }),
		})
		expect(typed?.outerStyle?.left).toMatch(/^calc\(/)
		expect(typed?.outerStyle?.right).toBeUndefined()
	})

	it("border + background + per-visual text font flow into the inner style", () => {
		const p = plan({
			encodings: enc({ hue: "region" }),
			legendCfg: legendCfg({
				showBorder: true,
				borderColor: "#123456",
				borderRadius: 3,
				backgroundColor: null,
				textFont: { family: "Georgia", color: "#abcdef" },
			}),
		})
		expect(p?.innerStyle.border).toBe("1px solid #123456")
		expect(p?.innerStyle.borderRadius).toBe("3px")
		expect(p?.innerStyle.backgroundColor).toBe("transparent")
		expect(p?.textFont.family).toBe("Georgia")
		expect(p?.innerStyle.fontFamily).toBe("Georgia")
		expect(p?.innerStyle.color).toBe("#abcdef")
	})
})
