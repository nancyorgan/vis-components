import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_FACET_CONFIG,
	DEFAULT_HISTOGRAM_CONFIG,
	type FacetConfig,
} from "../../../lib/channelConfig"
import { buildTickFormatter } from "../../../lib/formatTick"
import { resolveTickFontSizePx } from "../../../lib/fontUnit"
import {
	DEFAULT_LABELS_CONFIG,
	resolveTextFont,
} from "../../../lib/labelsConfig"
import { AreasXMode } from "../../../lib/chartModes/areasX"
import { BarsXMode } from "../../../lib/chartModes/barsX"
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
	mode,
	overrides = {},
}: {
	rows: Array<Record<string, string>>
	encodings: Encodings
	facetCfg?: FacetConfig
	channelConfigs?: Parameters<typeof buildSolverPanelInputs>[0]["channelConfigs"]
	isFaceted?: boolean
	mode?: Parameters<typeof buildSolverPanelInputs>[0]["mode"]
	overrides?: Parameters<typeof buildSolverPanelInputs>[0]["overrides"]
}) => {
	const dataset = view(rows)
	const panelData = resolveFacetPanels(dataset, encodings, {}, overrides, facetCfg)
	return buildSolverPanelInputs({
		dataset,
		encodings,
		overrides,
		channelConfigs,
		bounds,
		isFaceted,
		facetCfg,
		panelData,
		tickFont,
		mode,
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

	it("samples categorical x labels and the nice'd tick labels of a quantitative y for a single panel", () => {
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
		// The ticks the axis draws: d3 nice()s [3, 148.5] out to [0, 160] and
		// lays five-ish ticks across it — NOT the raw data min / max ("148.5"
		// is narrower than the "150" that actually renders).
		expect(p.yLabels).toEqual(["0", "50", "100", "150"])
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
		// Every sampled tick carries the format; the top tick is the widest.
		expect(inputs[0].yLabels).toContain(fmt?.(140000))
		expect(inputs[0].yLabels.every((l) => l.startsWith("$"))).toBe(true)
	})

	it("follows a pinned Scale range and the axis tick Count", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "3", g: "g1" },
				{ cat: "b", val: "7", g: "g1" },
			],
			encodings: xyEncodings("cat", "val"),
			channelConfigs: {
				y: { ...DEFAULT_AXIS_CONFIG, min: 0, max: 1000, tickCount: 3 },
			},
		})
		// Both ends pinned → exactly `count` evenly spaced ticks, ends included.
		expect(inputs[0].yLabels).toEqual(["0", "500", "1000"])
	})

	it("adds custom breaks inside the domain to the sampled labels", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "0", g: "g1" },
				{ cat: "b", val: "10", g: "g1" },
			],
			encodings: xyEncodings("cat", "val"),
			channelConfigs: {
				y: { ...DEFAULT_AXIS_CONFIG, tickCount: 0, breaks: [2.5, 99] },
			},
		})
		// Count 0 → no auto ticks; only the in-domain break labels.
		expect(inputs[0].yLabels).toEqual(["2.5"])
	})

	it("samples a facet panel's Custom breaks in place of its auto ticks + breaks", () => {
		// Row-only grid, share Y = none: each row panel reads its own row entry.
		const inputs = build({
			rows: [
				{ cat: "a", val: "0", g: "g1" },
				{ cat: "b", val: "10", g: "g1" },
				{ cat: "a", val: "0", g: "g2" },
				{ cat: "b", val: "10", g: "g2" },
			],
			encodings: xyEncodings("cat", "val", "g"),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				rowAxisOverrides: { g1: { ticks: [1000000, 5] } },
			},
			channelConfigs: { y: { ...DEFAULT_AXIS_CONFIG, breaks: [2.5] } },
		})
		// Exactly the custom ticks, formatted (and sorted) as the Axis draws
		// them — the formatter reads the ends of the sorted set.
		expect(inputs[0].yLabels).toEqual(["5", "1,000,000"])
		// The other row keeps the normal layout (auto + the 2.5 break).
		expect(inputs[1].yLabels).toContain("2.5")
	})

	// Vertical bars / areas draw the `length` measure on y. Sampling
	// `encodings.y` here found no field, measured a 0px label width, and
	// let the y-title gap collapse onto the tick labels (the stacked-area
	// report of Oct 2026).
	it("samples y labels from the length measure for vertical bars", () => {
		const e = emptyEncodings()
		e.x = { field: "cat" }
		e.length = { field: "val" }
		const inputs = build({
			rows: [
				{ cat: "a", val: "10", g: "g1" },
				{ cat: "b", val: "25", g: "g1" },
			],
			encodings: e,
			mode: BarsXMode,
		})
		expect(inputs[0].xLabels).toEqual(["a", "b"])
		expect(inputs[0].yLabels.length).toBeGreaterThan(0)
		expect(inputs[0].yLabels).toContain("25")
	})

	it("samples the stacked total, not the raw column max, on a stacked measure axis", () => {
		const e = emptyEncodings()
		e.x = { field: "cat" }
		e.length = { field: "val" }
		e.hue = { field: "g" }
		const rows = [
			{ cat: "a", val: "60", g: "g1" },
			{ cat: "a", val: "40", g: "g2" },
			{ cat: "b", val: "30", g: "g1" },
		]
		// Default stack mode: category "a" stacks to 100 though no row exceeds 60.
		const stacked = build({ rows, encodings: e, mode: AreasXMode })
		expect(stacked[0].yLabels).toContain("100")
		// Group mode: bars sit side by side, so the axis tops out at the row max.
		const grouped = build({
			rows,
			encodings: e,
			mode: BarsXMode,
			channelConfigs: {
				hue: { kind: "categorical", colors: {}, stackMode: "group" },
			},
		})
		expect(grouped[0].yLabels).not.toContain("100")
		expect(grouped[0].yLabels).toContain("60")
	})

	// "Size row heights by unit range" on a faceted vertical bar weighs each
	// row by its measure-axis extent (zero baseline included), not the raw
	// Length column's min–max.
	it("weighs size-by-unit rows by the bar measure extent", () => {
		const e = emptyEncodings()
		e.x = { field: "cat" }
		e.length = { field: "val" }
		e.facetRow = { field: "g" }
		const inputs = build({
			rows: [
				{ cat: "a", val: "10", g: "g1" },
				{ cat: "b", val: "20", g: "g1" },
				{ cat: "a", val: "30", g: "g2" },
				{ cat: "b", val: "40", g: "g2" },
			],
			encodings: e,
			mode: BarsXMode,
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([20, 40])
	})

	it("samples the count axis of a histogram, which has no field of its own", () => {
		const e = emptyEncodings()
		e.x = { field: "val" }
		const inputs = build({
			rows: Array.from({ length: 12 }, (_, i) => ({
				cat: "a",
				val: String(i < 9 ? 1 : 9),
				g: "g1",
			})),
			encodings: e,
			mode: BarsXMode,
			channelConfigs: {
				x: {
					...DEFAULT_AXIS_CONFIG,
					histogram: {
						...DEFAULT_HISTOGRAM_CONFIG,
						enabled: true,
						binCount: 2,
						mode: "count",
					},
				},
			},
		})
		// Nine rows land in the low bin: the count axis spans 0–9 and ticks
		// 0, 2, … 8 — the same nice ticks the renderer's count scale draws.
		expect(inputs[0].yLabels).toEqual(["0", "2", "4", "6", "8"])
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

	// Every renderer draws the d3-nice'd auto-fit domain (1.2–32 → 0–35, 1.1–29 → 0–30),
	// so the weight spans that domain, not the raw data min–max; otherwise
	// px-per-unit differs per panel and "30" sits at a different height in
	// each one.
	it("weighs by the nice'd axis domain, not the raw data extent", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "1.2", g: "g1" },
				{ cat: "b", val: "32", g: "g1" },
				{ cat: "a", val: "1.1", g: "g2" },
				{ cat: "b", val: "29", g: "g2" },
			],
			encodings: xyEncodings("cat", "val", "g"),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([35, 30])
	})

	// A pinned end stays exact (the renderer never re-nices it); the other
	// end is still the nice'd auto-fit value.
	it("keeps a pinned end exact and nices the free end", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "1.2", g: "g1" },
				{ cat: "b", val: "32", g: "g1" },
				{ cat: "a", val: "1.1", g: "g2" },
				{ cat: "b", val: "29", g: "g2" },
			],
			encodings: xyEncodings("cat", "val", "g"),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
				rowAxisOverrides: { g1: { min: 3 } },
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([32, 30])
	})

	// The Y axis panel's own Scale range is the lowest-precedence pin on
	// the render side (panelRenderInputs); the weight reads it too, so a
	// range every panel draws can't leave the weights uneven.
	it("falls back to the axis panel's Scale range for the unit weight", () => {
		const inputs = build({
			rows: [
				{ cat: "a", val: "0", g: "g1" },
				{ cat: "b", val: "10", g: "g1" },
				{ cat: "a", val: "0", g: "g2" },
				{ cat: "b", val: "5", g: "g2" },
			],
			encodings: xyEncodings("cat", "val", "g"),
			isFaceted: true,
			channelConfigs: { y: { ...DEFAULT_AXIS_CONFIG, min: 0, max: 50 } },
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([50, 50])
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

	it("gives each panel its own weight under shareY none (per-panel sizing)", () => {
		// Wrap facet, 2 panels side by side, shareY none: each panel weighs
		// its own y range; the solver shrinks the shorter one in its cell.
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
		expect(inputs.map((p) => p.yWeight)).toEqual([10, 5])
	})

	it("collapses weights to uniform under shareY all", () => {
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
				shareY: "all",
				proportionalSizingY: "unit",
			},
		})
		const ws = inputs.map((p) => p.yWeight)
		expect(new Set(ws).size).toBe(1)
	})
})

describe("buildSolverPanelInputs — temporal axes", () => {
	// `cat` holds the dates; the temporal override is what the Fields panel
	// stores when the user retypes a column.
	const temporal = { cat: "temporal" as const }

	it("samples a date axis's labels as d3's time ticks, not epoch numbers", () => {
		const inputs = build({
			rows: [
				{ cat: "2019-03-01", val: "1", g: "g1" },
				{ cat: "2021-06-15", val: "2", g: "g1" },
				{ cat: "2023-11-01", val: "3", g: "g1" },
			],
			encodings: xyEncodings("cat", "val"),
			overrides: temporal,
		})
		const labels = inputs[0].xLabels
		// Nice'd to year starts and ticked yearly: "2019" … "2024".
		expect(labels.length).toBeGreaterThanOrEqual(5)
		expect(labels.every((l) => /^\d{4}$/.test(l))).toBe(true)
	})

	it("reads a pinned date range as dates and keeps the labels short and level", () => {
		// A line chart over Year 1947–2025 (bare years parse as Jan 1) with the
		// Scale range pinned to 1949-01-01 … 2019-01-01 (epoch ms) and Count 8.
		// Sampling the raw ms values produced thirteen-character labels that
		// "collided" at narrow widths and reserved a rotated-label band the
		// real "1949" labels never needed.
		const rows = Array.from({ length: 79 }, (_, i) => ({
			cat: String(1947 + i),
			val: String(i),
			g: "g1",
		}))
		const inputs = build({
			rows,
			encodings: xyEncodings("cat", "val"),
			overrides: temporal,
			channelConfigs: {
				x: {
					...DEFAULT_AXIS_CONFIG,
					tickCount: 8,
					min: -662688000000,
					max: 1546300800000,
				},
			},
		})
		const labels = inputs[0].xLabels
		expect(labels.length).toBe(8)
		expect(labels.some((l) => /\d{6,}/.test(l))).toBe(false)
		expect(labels).toContain("1959")
		expect(inputs[0].xLabelAngleDeg).toBe(0)
	})

	it("runs date ticks through the axis Format", () => {
		const inputs = build({
			rows: [
				{ cat: "2019-03-01", val: "1", g: "g1" },
				{ cat: "2023-11-01", val: "3", g: "g1" },
			],
			encodings: xyEncodings("cat", "val"),
			overrides: temporal,
			channelConfigs: { x: { ...DEFAULT_AXIS_CONFIG, customFormat: "'%y" } },
		})
		expect(inputs[0].xLabels.every((l) => /^'\d{2}$/.test(l))).toBe(true)
	})
})

describe("buildSolverPanelInputs on large datasets", () => {
	// A browser takes about 120k arguments per call, so the extent of a
	// larger dataset cannot be spread into Math.min.
	const LARGE = 300_000

	it("measures a quantitative axis over more rows than a call takes arguments", () => {
		const rows = Array.from({ length: LARGE }, (_, i) => ({
			cat: "a",
			val: String(i % 1000),
			g: "g1",
		}))
		const inputs = build({ rows, encodings: xyEncodings("val", "cat") })
		expect(inputs[0].xAxisContinuous).toBe(true)
	})

	it("weighs 'unit' sizing over panels larger than a call takes arguments", () => {
		const rows = Array.from({ length: LARGE }, (_, i) => ({
			cat: i % 2 ? "a" : "b",
			val: String(i % 2 ? i % 11 : i % 6),
			g: i < LARGE / 2 ? "g1" : "g2",
		}))
		const inputs = build({
			rows,
			encodings: xyEncodings("cat", "val", "g"),
			isFaceted: true,
			facetCfg: {
				...DEFAULT_FACET_CONFIG,
				shareY: "none",
				proportionalSizingY: "unit",
			},
		})
		expect(inputs.map((p) => p.yWeight)).toEqual([10, 10])
	})
})
