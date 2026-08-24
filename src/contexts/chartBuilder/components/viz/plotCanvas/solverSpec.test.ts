import { describe, expect, it } from "vitest"
import {
	DEFAULT_FACET_CONFIG,
	type ChannelConfigs,
	type FacetConfig,
} from "../../../lib/channelConfig"
import {
	DEFAULT_LABELS_CONFIG,
	resolveTitleFont,
	type LabelsConfig,
} from "../../../lib/labelsConfig"
import {
	resolveFacetPanels,
	type FacetPanels,
} from "../../../lib/resolveFacetPanels"
import {
	emptyEncodings,
	type DatasetView,
	type Encodings,
} from "../../../lib/types"
import { resolveFacetTitleStyles } from "./facetTitleStyles"
import { buildSolverInput } from "./solverSpec"

const view = (rows: Array<Record<string, string>>): DatasetView => ({
	id: "ds",
	name: "d",
	filename: "d.csv",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "r", inferredType: "categorical" },
		{ name: "c", inferredType: "categorical" },
	],
	rows,
	createdAt: 0,
	versionCreatedAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
})

const GRID_ROWS = [
	{ cat: "a", val: "1", r: "r1", c: "c1" },
	{ cat: "b", val: "2", r: "r1", c: "c2" },
	{ cat: "a", val: "3", r: "r2", c: "c1" },
	{ cat: "b", val: "4", r: "r2", c: "c2" },
]

const build = ({
	encodings = emptyEncodings(),
	panelData,
	facetCfg = { ...DEFAULT_FACET_CONFIG },
	channelConfigs = {},
	labels = { ...DEFAULT_LABELS_CONFIG },
	isFaceted = false,
	isPolar = false,
	sharedXAxisTitle = "",
	sharedYAxisTitle = "",
	dataLabelOverflow = { left: 0, right: 0 },
	captionReserve = 0,
}: {
	encodings?: Encodings
	panelData?: FacetPanels
	facetCfg?: FacetConfig
	channelConfigs?: ChannelConfigs
	labels?: LabelsConfig
	isFaceted?: boolean
	isPolar?: boolean
	sharedXAxisTitle?: string
	sharedYAxisTitle?: string
	dataLabelOverflow?: { left: number; right: number }
	captionReserve?: number
}) =>
	buildSolverInput({
		bounds: { width: 800, height: 600 },
		isFaceted,
		isPolar,
		facetCfg,
		panelData:
			panelData ??
			resolveFacetPanels(view(GRID_ROWS), encodings, {}, {}, facetCfg),
		panelInputs: [],
		channelConfigs,
		labels,
		encodings,
		titleFont: resolveTitleFont(labels.baseFont, "primary", undefined),
		subtitleFont: resolveTitleFont(labels.baseFont, "subtitle", undefined),
		xAxisTitleFont: resolveTitleFont(labels.baseFont, "secondary", undefined),
		yAxisTitleFont: resolveTitleFont(labels.baseFont, "secondary", undefined),
		facetTitles: resolveFacetTitleStyles(labels, encodings),
		sharedXAxisTitle,
		sharedYAxisTitle,
		dataLabelOverflow,
		captionReserve,
	})

const gridEncodings = (): Encodings => {
	const e = emptyEncodings()
	e.x = { field: "cat" }
	e.y = { field: "val" }
	e.facetRow = { field: "r" }
	e.facetCol = { field: "c" }
	return e
}

describe("buildSolverInput", () => {
	it("builds a bare single-panel input with defaults", () => {
		const input = build({})
		expect(input.containerWidth).toBe(800)
		expect(input.containerHeight).toBe(600)
		expect(input.rows).toBe(1)
		expect(input.cols).toBe(1)
		expect(input.chartTitle).toBeUndefined()
		expect(input.facetLabel).toBeUndefined()
		expect(input.columnHeaders).toBeUndefined()
		expect(input.rowHeaders).toBeUndefined()
		expect(input.rowHeaderWidth).toBe(80)
		expect(input.shareX).toBe(false)
		expect(input.shareY).toBe(false)
		expect(input.panelWidthOverride).toBeNull()
		expect(input.panelHeightOverride).toBeNull()
		expect(input.aspectRatio).toBeNull()
		expect(input.proportionalSizing).toBe(false)
		expect(input.minPanelPx).toBe(0)
		expect(input.isPolar).toBe(false)
	})

	it("wires the extra margins from the data-label reserve and caption band", () => {
		const input = build({
			dataLabelOverflow: { left: 12, right: 34 },
			captionReserve: 56,
		})
		expect(input.extraLeftMargin).toBe(12)
		expect(input.extraRightMargin).toBe(34)
		expect(input.extraBottomMargin).toBe(56)
	})

	it("passes chart title text, size, and offsets through", () => {
		const labels: LabelsConfig = {
			...DEFAULT_LABELS_CONFIG,
			title: "My chart",
			titleOffsets: { title: { x: 5, y: -3 } },
		}
		const input = build({ labels })
		expect(input.chartTitle?.text).toBe("My chart")
		expect(input.chartTitle?.offsetX).toBe(5)
		expect(input.chartTitle?.offsetY).toBe(-3)
	})

	it("scroll mode reserves a 200px panel minimum; fit reserves none", () => {
		expect(build({ channelConfigs: {} }).minPanelPx).toBe(0)
		expect(
			build({ channelConfigs: { scrollMode: "scroll" } }).minPanelPx,
		).toBe(200)
	})

	it("resolves the aspect-ratio config to a height/width factor", () => {
		expect(
			build({
				channelConfigs: {
					aspectRatio: { enabled: true, length: 2, width: 1 },
				},
			}).aspectRatio,
		).toBe(2)
		expect(
			build({
				channelConfigs: {
					aspectRatio: { enabled: false, length: 2, width: 1 },
				},
			}).aspectRatio,
		).toBeNull()
	})

	it("emits header strips for a both-axes grid, sized to fit the labels", () => {
		const input = build({ encodings: gridEncodings(), isFaceted: true })
		expect(input.rows).toBe(2)
		expect(input.cols).toBe(2)
		expect(input.columnHeaders?.map((h) => h.text)).toEqual(["c1", "c2"])
		expect(input.rowHeaders?.map((h) => h.text)).toEqual(["r1", "r2"])
		expect(input.rowHeaderWidth).toBeGreaterThanOrEqual(80)
		// grid mode without compaction: no per-panel facet label band
		expect(input.facetLabel).toBeUndefined()
	})

	it("wrap facets get a per-panel label band instead of strips", () => {
		const e = emptyEncodings()
		e.x = { field: "cat" }
		e.y = { field: "val" }
		e.facet = { field: "r" }
		const labels = { ...DEFAULT_LABELS_CONFIG }
		const input = build({ encodings: e, isFaceted: true, labels })
		expect(input.columnHeaders).toBeUndefined()
		expect(input.rowHeaders).toBeUndefined()
		const size = resolveFacetTitleStyles(labels, e).facetTitleFont.size
		expect(input.facetLabel).toEqual({
			fontSize: size,
			height: Math.max(20, Math.ceil(size * 1.4)),
			align: "center",
		})
	})

	it("honors explicit panel dims when faceted and sizing is off", () => {
		const input = build({
			encodings: gridEncodings(),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				panelWidth: 300,
				panelHeight: 250,
				proportionalSizingX: "off",
				proportionalSizingY: "off",
			},
		})
		expect(input.panelWidthOverride).toBe(300)
		expect(input.panelHeightOverride).toBe(250)
	})

	it("ignores an explicit dim on an axis actively driven by proportional sizing", () => {
		const input = build({
			encodings: gridEncodings(),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				panelWidth: 300,
				panelHeight: 250,
				// perGroup share + 2×2 grid → sizing meaningful on both axes
				shareX: "perGroup",
				shareY: "perGroup",
				proportionalSizingX: "categoryCount",
				proportionalSizingY: "categoryCount",
			},
		})
		expect(input.panelWidthOverride).toBeNull()
		expect(input.panelHeightOverride).toBeNull()
		expect(input.proportionalSizing).toBe(true)
	})

	it("suppresses interior ticks only when the hidden axes are redundant", () => {
		// share "all": always safe to suppress
		const all = build({
			encodings: gridEncodings(),
			isFaceted: true,
			facetCfg: { ...DEFAULT_FACET_CONFIG, shareX: "all", shareY: "all" },
		})
		expect(all.shareX).toBe(true)
		expect(all.shareY).toBe(true)
		// share "none": never suppress
		const none = build({
			encodings: gridEncodings(),
			isFaceted: true,
			facetCfg: { ...DEFAULT_FACET_CONFIG, shareX: "none", shareY: "none" },
		})
		expect(none.shareX).toBe(false)
		expect(none.shareY).toBe(false)
	})

	it("compaction suppresses the compacted strip and switches to per-panel bands", () => {
		// Hand-built compacted grid: the row strip survived ("rows"), so the
		// column strip must neither draw nor reserve, and panels get the
		// facetPanelTitle band.
		const rowsByValue = new Map<string, Array<Record<string, unknown>>>([
			["p1", [{ cat: "a", val: "1" }]],
			["p2", [{ cat: "b", val: "2" }]],
		])
		const panelData: FacetPanels = {
			mode: "grid",
			values: ["p1", "p2"],
			rowsByValue,
			grid: { rows: 2, cols: 1 },
			rowValues: ["r1", "r2"],
			colValues: ["c1", "c2"],
			compact: {
				strip: "rows",
				panels: {
					p1: { rowValue: "r1", colValue: "c1", label: "c1" },
					p2: { rowValue: "r2", colValue: "c2", label: "c2" },
				},
			},
		}
		const input = build({
			encodings: gridEncodings(),
			isFaceted: true,
			panelData,
		})
		expect(input.columnHeaders).toBeUndefined()
		expect(input.rowHeaders?.map((h) => h.text)).toEqual(["r1", "r2"])
		expect(input.facetLabel).toBeDefined()
	})
})
