import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_FACET_CONFIG,
	type FacetConfig,
} from "../../../lib/channelConfig"
import type { SolverPanelOutput } from "../../../lib/facetLayoutSolver"
import { resolveFacetPanels } from "../../../lib/resolveFacetPanels"
import {
	emptyEncodings,
	type DatasetView,
	type Encodings,
	type FieldType,
} from "../../../lib/types"
import { groupRowsByShareGroup } from "./panelGrouping"
import { resolvePanelRenderInputs } from "./panelRenderInputs"

const view = (rows: Array<Record<string, string>>): DatasetView => ({
	id: "ds",
	name: "d",
	filename: "d.csv",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
		{ name: "h", inferredType: "categorical" },
	],
	rows,
	createdAt: 0,
	versionCreatedAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
})

// 2×2 grid fixture (facetRow=g, facetCol=h) with distinct per-cell row
// counts so every scale-row source is distinguishable by length alone:
//   cells   g1|h1=1  g1|h2=2  g2|h1=3  g2|h2=4
//   rows    g1=3     g2=7
//   cols    h1=4     h2=6
//   all     10
const gridRows: Array<Record<string, string>> = [
	{ cat: "a", val: "1", g: "g1", h: "h1" },
	{ cat: "a", val: "2", g: "g1", h: "h2" },
	{ cat: "b", val: "3", g: "g1", h: "h2" },
	{ cat: "a", val: "4", g: "g2", h: "h1" },
	{ cat: "b", val: "5", g: "g2", h: "h1" },
	{ cat: "c", val: "6", g: "g2", h: "h1" },
	{ cat: "a", val: "7", g: "g2", h: "h2" },
	{ cat: "b", val: "8", g: "g2", h: "h2" },
	{ cat: "c", val: "9", g: "g2", h: "h2" },
	{ cat: "d", val: "10", g: "g2", h: "h2" },
]

const gridEncodings = (): Encodings => {
	const e = emptyEncodings()
	e.x = { field: "cat" }
	e.y = { field: "val" }
	e.facetRow = { field: "g" }
	e.facetCol = { field: "h" }
	return e
}

const wrapEncodings = (): Encodings => {
	const e = emptyEncodings()
	e.x = { field: "cat" }
	e.y = { field: "val" }
	e.facet = { field: "g" }
	return e
}

type AxisFieldsArg = {
	xField: string | null
	yField: string | null
	xType: FieldType | null
	yType: FieldType | null
}

const AXIS_CAT_X_QUANT_Y: AxisFieldsArg = {
	xField: "cat",
	yField: "val",
	xType: "categorical",
	yType: "quantitative",
}

const RECT = { x: 0, y: 0, width: 100, height: 100 }

type Args = Parameters<typeof resolvePanelRenderInputs>[0]

/** Resolve one panel's render inputs against a real facet partition:
 *  panelData / share-group row maps come from resolveFacetPanels +
 *  groupRowsByShareGroup exactly as in PlotCanvas, and the panel's
 *  row/col come from its row-major position in panelData.values. */
const runPanel = ({
	key,
	rows,
	encodings,
	facetCfg = { ...DEFAULT_FACET_CONFIG },
	shareXMode = "none",
	shareYMode = "none",
	isPolar = false,
	measureAxis = null,
	axisFields = AXIS_CAT_X_QUANT_Y,
	channelConfigs = {},
	groupMeasureMaxByKey = new Map<string, number>(),
	panelRadiusScale = new Map<string, number>(),
}: {
	key: string
	rows: Array<Record<string, string>>
	encodings: Encodings
	facetCfg?: FacetConfig
	shareXMode?: Args["shareXMode"]
	shareYMode?: Args["shareYMode"]
	isPolar?: boolean
	measureAxis?: Args["measureAxis"]
	axisFields?: AxisFieldsArg
	channelConfigs?: Args["channelConfigs"]
	groupMeasureMaxByKey?: Map<string, number>
	panelRadiusScale?: Map<string, number>
}) => {
	const dataset = view(rows)
	const panelData = resolveFacetPanels(dataset, encodings, {}, {}, facetCfg)
	const { colRowsByColKey, rowRowsByRowKey } = groupRowsByShareGroup(panelData)
	const idx = panelData.values.indexOf(key)
	if (idx < 0) throw new Error(`unknown panel key: ${key}`)
	const p: SolverPanelOutput = {
		key,
		row: Math.floor(idx / panelData.grid.cols),
		col: idx % panelData.grid.cols,
		cell: RECT,
		inner: RECT,
		facetLabel: null,
		showXTicks: true,
		showYTicks: true,
		showXAxisTitle: false,
		showYAxisTitle: false,
	}
	return resolvePanelRenderInputs({
		p,
		panelData,
		isPolar,
		shareXMode,
		shareYMode,
		allDatasetRows: dataset.rows,
		colRowsByColKey,
		rowRowsByRowKey,
		measureAxis,
		axisFields,
		channelConfigs,
		facetCfg,
		groupMeasureMaxByKey,
		panelRadiusScale,
	})
}

describe("resolvePanelRenderInputs", () => {
	describe("scale-row sources per share mode", () => {
		it("share 'none' leaves both scale-row sources undefined (renderer falls back to the panel's own rows)", () => {
			const r = runPanel({
				key: "g1|h2",
				rows: gridRows,
				encodings: gridEncodings(),
				shareXMode: "none",
				shareYMode: "none",
			})
			expect(r.xScaleRows).toBeUndefined()
			expect(r.yScaleRows).toBeUndefined()
		})

		it("share 'perGroup' unions the panel's column rows for x and row rows for y", () => {
			const r = runPanel({
				key: "g1|h2",
				rows: gridRows,
				encodings: gridEncodings(),
				shareXMode: "perGroup",
				shareYMode: "perGroup",
			})
			// column h2 = g1|h2 (2) + g2|h2 (4); row g1 = g1|h1 (1) + g1|h2 (2)
			expect(r.xScaleRows).toHaveLength(6)
			expect(r.yScaleRows).toHaveLength(3)
		})

		it("share 'all' feeds the whole dataset to both axes", () => {
			const r = runPanel({
				key: "g1|h1",
				rows: gridRows,
				encodings: gridEncodings(),
				shareXMode: "all",
				shareYMode: "all",
			})
			expect(r.xScaleRows).toHaveLength(10)
			expect(r.yScaleRows).toHaveLength(10)
		})

		it("mixed modes resolve per axis independently", () => {
			const r = runPanel({
				key: "g2|h1",
				rows: gridRows,
				encodings: gridEncodings(),
				shareXMode: "all",
				shareYMode: "perGroup",
			})
			expect(r.xScaleRows).toHaveLength(10)
			// row g2 = g2|h1 (3) + g2|h2 (4)
			expect(r.yScaleRows).toHaveLength(7)
		})
	})

	describe("y-axis override precedence", () => {
		it("per-group row override beats the axis-config min/max under shareY 'perGroup'", () => {
			const shared = {
				rows: gridRows,
				encodings: gridEncodings(),
				shareYMode: "perGroup" as const,
				facetCfg: {
					...DEFAULT_FACET_CONFIG,
					rowAxisOverrides: { g1: { min: 5, max: 50 } },
				},
				channelConfigs: {
					y: { ...DEFAULT_AXIS_CONFIG, min: 0, max: 10 },
				},
			}
			const g1 = runPanel({ key: "g1|h1", ...shared })
			expect(g1.yMinOverride).toBe(5)
			expect(g1.yMaxOverride).toBe(50)
			// the other row has no group override → axis-config bounds apply
			const g2 = runPanel({ key: "g2|h1", ...shared })
			expect(g2.yMinOverride).toBe(0)
			expect(g2.yMaxOverride).toBe(10)
		})

		it("overall y range applies under shareY 'all' and beats the axis-config min/max", () => {
			const r = runPanel({
				key: "g2|h2",
				rows: gridRows,
				encodings: gridEncodings(),
				shareYMode: "all",
				facetCfg: {
					...DEFAULT_FACET_CONFIG,
					overallYRange: { min: 1, max: 99 },
				},
				channelConfigs: {
					y: { ...DEFAULT_AXIS_CONFIG, min: 0, max: 10 },
				},
			})
			expect(r.yMinOverride).toBe(1)
			expect(r.yMaxOverride).toBe(99)
		})

		it("legacy panelAxisOverrides apply in wrap mode with shareY 'none'", () => {
			const r = runPanel({
				key: "g1",
				rows: gridRows,
				encodings: wrapEncodings(),
				shareYMode: "none",
				facetCfg: {
					...DEFAULT_FACET_CONFIG,
					panelAxisOverrides: { g1: { yMin: 2, yMax: 20 } },
				},
			})
			expect(r.yMinOverride).toBe(2)
			expect(r.yMaxOverride).toBe(20)
		})

		it("legacy panelAxisOverrides are ignored in grid mode", () => {
			const r = runPanel({
				key: "g1|h1",
				rows: gridRows,
				encodings: gridEncodings(),
				shareYMode: "none",
				facetCfg: {
					...DEFAULT_FACET_CONFIG,
					panelAxisOverrides: { "g1|h1": { yMin: 2, yMax: 20 } },
				},
			})
			expect(r.yMinOverride).toBeUndefined()
			expect(r.yMaxOverride).toBeUndefined()
		})
	})

	describe("measure-axis translation (bar / area family)", () => {
		it("feeds groupMeasureMaxByKey into measureMaxOverride when no user bound is set", () => {
			const r = runPanel({
				key: "g1|h1",
				rows: gridRows,
				encodings: gridEncodings(),
				shareYMode: "all",
				measureAxis: "y",
				groupMeasureMaxByKey: new Map([["g1|h1", 42]]),
			})
			expect(r.measureMaxOverride).toBe(42)
			expect(r.measureMinOverride).toBeUndefined()
		})

		it("a user-set y max beats the shared-group max", () => {
			const r = runPanel({
				key: "g1|h1",
				rows: gridRows,
				encodings: gridEncodings(),
				shareYMode: "all",
				measureAxis: "y",
				channelConfigs: {
					y: { ...DEFAULT_AXIS_CONFIG, max: 100 },
				},
				groupMeasureMaxByKey: new Map([["g1|h1", 42]]),
			})
			expect(r.measureMaxOverride).toBe(100)
		})

		it("treats the measure axis as continuous even without a y field (histogram count axis)", () => {
			const r = runPanel({
				key: "g1|h1",
				rows: gridRows,
				encodings: gridEncodings(),
				measureAxis: "y",
				axisFields: { xField: "val", yField: null, xType: "quantitative", yType: null },
				channelConfigs: {
					y: { ...DEFAULT_AXIS_CONFIG, min: 0 },
				},
			})
			expect(r.measureMinOverride).toBe(0)
		})

		it("category-axis config min/max never leaks into the measure axis", () => {
			const r = runPanel({
				key: "g1|h1",
				rows: gridRows,
				encodings: gridEncodings(),
				measureAxis: "y",
				channelConfigs: {
					x: { ...DEFAULT_AXIS_CONFIG, min: 3, max: 7 },
				},
			})
			// x is categorical → not continuous → its config bounds are inert
			expect(r.xMinOverride).toBeUndefined()
			expect(r.xMaxOverride).toBeUndefined()
			expect(r.measureMinOverride).toBeUndefined()
			expect(r.measureMaxOverride).toBeUndefined()
		})
	})

	describe("polar", () => {
		it("looks up the panel's radius scale by key (hit and miss)", () => {
			const shared = {
				rows: gridRows,
				encodings: wrapEncodings(),
				isPolar: true,
				facetCfg: {
					...DEFAULT_FACET_CONFIG,
					shareAngle: "none" as const,
					shareR: "none" as const,
				},
				panelRadiusScale: new Map([["g1", 0.5]]),
			}
			expect(runPanel({ key: "g1", ...shared }).radiusScale).toBe(0.5)
			expect(runPanel({ key: "g2", ...shared }).radiusScale).toBeUndefined()
		})

		it("resolves the R override through shareR 'all' (overallRRange) and widens the R scale rows", () => {
			const r = runPanel({
				key: "g1",
				rows: gridRows,
				encodings: wrapEncodings(),
				isPolar: true,
				facetCfg: {
					...DEFAULT_FACET_CONFIG,
					shareAngle: "none",
					shareR: "all",
					overallRRange: { min: 0, max: 9 },
				},
			})
			expect(r.rMinOverride).toBe(0)
			expect(r.rMaxOverride).toBe(9)
			// the R (y) scale-row source follows the polar share mode too
			expect(r.yScaleRows).toHaveLength(10)
			expect(r.xScaleRows).toBeUndefined()
		})

		it("shareR 'none' reads the per-panel R override keyed by panel key in wrap mode", () => {
			const r = runPanel({
				key: "g2",
				rows: gridRows,
				encodings: wrapEncodings(),
				isPolar: true,
				facetCfg: {
					...DEFAULT_FACET_CONFIG,
					shareAngle: "none",
					shareR: "none",
					panelRAxisOverrides: { g2: { min: 1, max: 7 } },
				},
			})
			expect(r.rMinOverride).toBe(1)
			expect(r.rMaxOverride).toBe(7)
		})
	})
})
