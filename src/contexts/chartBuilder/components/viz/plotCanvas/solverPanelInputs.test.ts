import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_FACET_CONFIG,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { buildTickFormatter } from "../../../lib/formatTick"
import { resolveTickFontSizePx } from "../../../lib/fontUnit"
import {
	DEFAULT_LABELS_CONFIG,
	resolveTextFont,
} from "../../../lib/labelsConfig"
import { resolveFacetPanels } from "../../../lib/resolveFacetPanels"
import {
	emptyEncodings,
	type DatasetView,
	type Encodings,
} from "../../../lib/types"
import { buildSolverPanelInputs } from "./solverPanelInputs"

const view = (rows: Array<Record<string, string>>): DatasetView => ({
	id: "ds",
	name: "d",
	filename: "d.csv",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	rows,
	createdAt: 0,
	versionCreatedAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
})

const tickFont = resolveTextFont(DEFAULT_LABELS_CONFIG.baseFont)
const bounds = { width: 800 }

const build = ({
	rows,
	encodings,
	facetCfg = { ...DEFAULT_FACET_CONFIG },
	channelConfigs = {},
	isFaceted = false,
}: {
	rows: Array<Record<string, string>>
	encodings: Encodings
	facetCfg?: FacetConfig
	channelConfigs?: Parameters<typeof buildSolverPanelInputs>[0]["channelConfigs"]
	isFaceted?: boolean
}) => {
	const dataset = view(rows)
	const panelData = resolveFacetPanels(dataset, encodings, {}, {}, facetCfg)
	return buildSolverPanelInputs({
		dataset,
		encodings,
		overrides: {},
		channelConfigs,
		bounds,
		isFaceted,
		facetCfg,
		panelData,
		tickFont,
	})
}

const xyEncodings = (x: string, y: string, facetRow?: string): Encodings => {
	const e = emptyEncodings()
	e.x = { field: x }
	e.y = { field: y }
	if (facetRow) e.facetRow = { field: facetRow }
	return e
}

describe("buildSolverPanelInputs", () => {
	it("returns an empty list without a dataset", () => {
		const encodings = xyEncodings("cat", "val")
		const panelData = resolveFacetPanels(undefined, encodings, {}, {}, {
			...DEFAULT_FACET_CONFIG,
		})
		expect(
			buildSolverPanelInputs({
				dataset: undefined,
				encodings,
				overrides: {},
				channelConfigs: {},
				bounds,
				isFaceted: false,
				facetCfg: { ...DEFAULT_FACET_CONFIG },
				panelData,
				tickFont,
			}),
		).toEqual([])
	})

	it("samples categorical x labels and min/max quantitative y labels for a single panel", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "10", g: "g1" },
				{ cat: "b", val: "148.50000000001", g: "g1" },
				{ cat: "a", val: "3", g: "g1" },
			],
			encodings: xyEncodings("cat", "val"),
			// sizing off so this test stays about label sampling; the weight
			// cases below exercise the sizing modes explicitly
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				proportionalSizingX: "off",
				proportionalSizingY: "off",
			},
		})
		expect(inputs).toHaveLength(1)
		const p = inputs[0]
		expect(p.row).toBe(0)
		expect(p.col).toBe(0)
		expect(p.xLabels).toEqual(["a", "b"])
		// min/max, trimmed to ~4 significant figures like the rendered ticks
		expect(p.yLabels).toEqual(["3", "148.5"])
		expect(p.xAxisContinuous).toBe(false)
		expect(p.xWeight).toBe(1)
		expect(p.yWeight).toBe(1)
	})

	it("marks a quantitative x axis as continuous", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "1", g: "g1" },
				{ cat: "b", val: "2", g: "g1" },
			],
			encodings: xyEncodings("val", "cat"),
		})
		expect(inputs[0].xAxisContinuous).toBe(true)
	})

	it("measures labels as the axis's custom d3-format renders them", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "1000", g: "g1" },
				{ cat: "b", val: "140000", g: "g1" },
			],
			encodings: xyEncodings("cat", "val"),
			channelConfigs: { y: { ...DEFAULT_AXIS_CONFIG, customFormat: "$,.0f" } },
		})
		const fmt = buildTickFormatter({ customFormat: "$,.0f" }, "quantitative")
		expect(fmt).not.toBeNull()
		expect(inputs[0].yLabels).toEqual([fmt?.(1000), fmt?.(140000)])
	})

	it("honors per-axis tick-label font size overrides", () => {
		const inputs = build({
			rows: [{ cat: "a", val: "1", g: "g1" }],
			encodings: xyEncodings("cat", "val"),
			channelConfigs: {
				y: { ...DEFAULT_AXIS_CONFIG, tickLabelFont: { size: 20 } },
			},
		})
		expect(inputs[0].yLabelFontSize).toBe(
			resolveTickFontSizePx(20, tickFont.size),
		)
		expect(inputs[0].xLabelFontSize).toBe(tickFont.size)
	})

	it("weights rows by category count in a single-column grid (shareY none)", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "1", g: "g1" },
				{ cat: "b", val: "2", g: "g1" },
				{ cat: "c", val: "3", g: "g1" },
				{ cat: "a", val: "4", g: "g2" },
			],
			encodings: xyEncodings("val", "cat", "g"),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingX: "off",
				proportionalSizingY: "categoryCount",
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([3, 1])
		expect(inputs.map((p) => p.xWeight)).toEqual([1, 1])
	})

	it("weights rows by quantitative range under 'unit' sizing", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "0", g: "g1" },
				{ cat: "b", val: "10", g: "g1" },
				{ cat: "a", val: "0", g: "g2" },
				{ cat: "b", val: "5", g: "g2" },
			],
			encodings: xyEncodings("cat", "val", "g"),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([10, 5])
	})

	it("applies the row range override to the unit weight in a single-column grid", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "0", g: "g1" },
				{ cat: "b", val: "10", g: "g1" },
				{ cat: "a", val: "0", g: "g2" },
				{ cat: "b", val: "5", g: "g2" },
			],
			encodings: xyEncodings("cat", "val", "g"),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
				rowAxisOverrides: { g1: { min: 0, max: 100 } },
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([100, 5])
	})

	it("collapses weights to 1 when sizing is stored but ill-defined for the share shape", () => {
		// 2-column grid via facetCol+facetRow would be needed for a multi-col
		// row; here: multi-column comes from wrap facet (2 panels, cols 2) with
		// shareY none — per-row weights are ill-defined, so they stay 1.
		const e = emptyEncodings()
		e.x = { field: "cat" }
		e.y = { field: "val" }
		e.facet = { field: "g" }
		const inputs = build({
			rows: [
				{ cat: "a", val: "0", g: "g1" },
				{ cat: "b", val: "10", g: "g1" },
				{ cat: "a", val: "0", g: "g2" },
				{ cat: "b", val: "5", g: "g2" },
			],
			encodings: e,
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
			},
		})
		expect(inputs.length).toBeGreaterThan(1)
		expect(inputs.every((p) => p.yWeight === 1)).toBe(true)
	})
})
