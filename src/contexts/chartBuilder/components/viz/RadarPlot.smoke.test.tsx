import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_ANGLE_CONFIG,
	DEFAULT_AXIS_CONFIG,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_PATTERN_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
	type ConnectionConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { RadarPlot } from "./RadarPlot"

/** Smoke tests for the radar (spider) chart renderer. Each test mounts
 *  RadarPlot with seed state representative of the relevant case and
 *  reads back the rendered SVG to verify the user-visible behavior. */

const DATASET_ID = "ds-radar"

const buildRadarDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "radar",
	fields: [
		{ name: "metric", inferredType: "categorical" },
		{ name: "score", inferredType: "quantitative" },
		{ name: "team", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "radar.csv",
			rows: [
				{ metric: "A", score: "10", team: "north" },
				{ metric: "B", score: "20", team: "north" },
				{ metric: "C", score: "15", team: "north" },
				{ metric: "D", score: "25", team: "north" },
				{ metric: "A", score: "18", team: "south" },
				{ metric: "B", score: "12", team: "south" },
				{ metric: "C", score: "22", team: "south" },
				{ metric: "D", score: "8", team: "south" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

type Opts = {
	withConnection?: boolean
	connectionCfg?: Partial<ConnectionConfig>
	drawOrder?: { field: string; dir: "asc" | "desc" } | null
	/** Extra encodings (e.g. a pattern variable) merged over the base. */
	extraEncodings?: Partial<Encodings>
	/** Extra channel configs (e.g. pattern picks) merged over the base. */
	extraConfigs?: Partial<ChannelConfigs>
}

const seedStorage = (opts: Opts) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildRadarDataset() }),
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			r: { field: "score" },
			angle: { field: "metric" },
			...(opts.withConnection ? { connection: { field: "team" } } : {}),
			...(opts.extraEncodings ?? {}),
		}),
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			connection: {
				...DEFAULT_CONNECTION_CONFIG,
				...(opts.connectionCfg ?? {}),
			},
			...(opts.drawOrder !== undefined ? { drawOrder: opts.drawOrder } : {}),
			...(opts.extraConfigs ?? {}),
		}),
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState =
	(opts: Opts) =>
	(snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildRadarDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			r: { field: "score" },
			angle: { field: "metric" },
			...(opts.withConnection ? { connection: { field: "team" } } : {}),
			...(opts.extraEncodings ?? {}),
		})
		snap.set(currentChannelConfigsAtom, {
			...EMPTY_CHANNEL_CONFIGS,
			connection: {
				...DEFAULT_CONNECTION_CONFIG,
				...(opts.connectionCfg ?? {}),
			},
			...(opts.drawOrder !== undefined ? { drawOrder: opts.drawOrder } : {}),
			...(opts.extraConfigs ?? {}),
		})
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

const mount = (opts: Opts = {}) => {
	seedStorage(opts)
	const { container } = render(
		<TestProvider initializeState={initState(opts)}>
			<svg width={600} height={400}>
				<RadarPlot />
			</svg>
		</TestProvider>,
	)
	return container
}

describe("RadarPlot — basics", () => {
	it("renders one mark (dot) per row when only r + angle are mapped (no connection)", () => {
		const c = mount()
		// Dots render as <path> glyphs so the shape encoding takes effect;
		// 8 rows in the fixture → 8 paths.
		const dots = c.querySelectorAll("path")
		expect(dots.length).toBe(8)
	})

	it("does NOT draw a polygon when connection is unmapped", () => {
		const c = mount()
		expect(c.querySelectorAll("polygon").length).toBe(0)
	})

	it("draws one closed polygon per connection group when connection is mapped", () => {
		const c = mount({ withConnection: true })
		const polygons = c.querySelectorAll("polygon")
		// Two teams (north, south) → two polygons.
		expect(polygons.length).toBe(2)
	})

	it("polygon stroke is non-empty (visible outline)", () => {
		const c = mount({ withConnection: true })
		const polygons = [...c.querySelectorAll("polygon")]
		for (const p of polygons) {
			const stroke = p.getAttribute("stroke")
			expect(stroke && stroke !== "none").toBe(true)
		}
	})

	it("polygon fill is 'none' when fillPolygon is off (default)", () => {
		const c = mount({ withConnection: true })
		const polygons = [...c.querySelectorAll("polygon")]
		for (const p of polygons) {
			expect(p.getAttribute("fill")).toBe("none")
		}
	})

	it("polygon fill matches stroke color when fillPolygon is on", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { fillPolygon: true },
		})
		const polygons = [...c.querySelectorAll("polygon")]
		for (const p of polygons) {
			const fill = p.getAttribute("fill")
			const stroke = p.getAttribute("stroke")
			expect(fill).toBe(stroke)
			// Filled polygon body now renders at the group's overall opacity
			// (the Fill subheader = opacity encoding); with no encoding mapped
			// that's the default opacity (0.85). Border opacity is independent.
			expect(p.getAttribute("fill-opacity")).toBe("0.85")
		}
	})

	it("per-value `lineColors` override the polygon outline independently of fill", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: {
				fillPolygon: true,
				lineColors: { north: "#123456", south: "#abcdef" },
			},
		})
		const polygons = [...c.querySelectorAll("polygon")]
		expect(polygons.length).toBe(2)
		const strokes = polygons.map((p) => p.getAttribute("stroke")).sort()
		expect(strokes).toEqual(["#123456", "#abcdef"])
		// With fillPolygon on and the stroke overridden, the fill should
		// stay on the hue-resolved color (default categorical fallback in
		// this fixture) — i.e. NOT match the stroke. The two channels are
		// now independent.
		for (const p of polygons) {
			expect(p.getAttribute("fill")).not.toBe(p.getAttribute("stroke"))
		}
	})

	it("`linePalette` drives polygon outlines by group index when no per-value override", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: {
				fillPolygon: true,
				linePalette: ["#ff0000", "#00ff00"],
			},
		})
		const polygons = [...c.querySelectorAll("polygon")]
		expect(polygons.length).toBe(2)
		const strokes = polygons.map((p) => p.getAttribute("stroke"))
		// Two groups → palette[0] and palette[1] map to the two polygons
		// in iteration order.
		expect(strokes).toEqual(["#ff0000", "#00ff00"])
	})

	it("honors `pointSampling: 'first-only'` — one dot per connection group", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { pointSampling: "first-only" },
		})
		const dots = c.querySelectorAll("path")
		// Two teams × 1 dot each = 2 dots. The two polygons still draw
		// through every vertex (they're <polygon> elements, not <circle>).
		expect(dots.length).toBe(2)
		// Polygons unaffected — sampling only thins dots, not the outline.
		expect(c.querySelectorAll("polygon").length).toBe(2)
	})

	it("honors `pointSampling: 'first-and-last'` — two dots per connection group", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { pointSampling: "first-and-last" },
		})
		const dots = c.querySelectorAll("path")
		expect(dots.length).toBe(4)
	})

	it("honors `pointSampling: 'none'` — no dots, polygons stay", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { pointSampling: "none" },
		})
		const dots = c.querySelectorAll("path")
		expect(dots.length).toBe(0)
		expect(c.querySelectorAll("polygon").length).toBe(2)
	})

	it("draw order sorts which polygon paints last (on top); palette color stays put", () => {
		// Per-value line colors identify each team's polygon regardless of
		// paint order (palette index counts in encounter order).
		const cfg = { lineColors: { north: "#111111", south: "#222222" } }
		const strokeOrder = (c: HTMLElement) =>
			[...c.querySelectorAll("polygon")].map((p) => p.getAttribute("stroke"))
		// Encounter order (row 0 = north) → north then south.
		expect(strokeOrder(mount({ withConnection: true, connectionCfg: cfg }))).toEqual([
			"#111111",
			"#222222",
		])
		// desc by the connection field flips the paint order (south on top)…
		expect(
			strokeOrder(
				mount({
					withConnection: true,
					connectionCfg: cfg,
					drawOrder: { field: "team", dir: "desc" },
				}),
			),
		).toEqual(["#222222", "#111111"])
		// …asc restores north-then-south, and colors never swap.
		expect(
			strokeOrder(
				mount({
					withConnection: true,
					connectionCfg: cfg,
					drawOrder: { field: "team", dir: "asc" },
				}),
			),
		).toEqual(["#111111", "#222222"])
	})

	it("draws spokes for each angle category and gridline rings for r ticks", () => {
		const c = mount()
		// 4 categories → 4 spokes (lines from center to perimeter). Radar
		// has no tick-mark notches by design — see the Angle panel for
		// the simpler "Spokes" controls.
		const lines = c.querySelectorAll("line")
		expect(lines.length).toBe(4)
		// Gridline rings: at least one ring drawn for r ticks > 0.
		const rings = [...c.querySelectorAll("circle")].filter(
			(el) => el.getAttribute("fill") === "none",
		)
		expect(rings.length).toBeGreaterThan(0)
	})

	it("the r-axis 'Adjust position' nudge moves the r-tick labels only (screen px); rings stay put", () => {
		// r-tick labels are the numeric texts along the 12 o'clock spoke;
		// the perimeter angle labels are the metric letters.
		const rLabelPositions = (c: HTMLElement) =>
			[...c.querySelectorAll("text")]
				.filter((t) => /^\d/.test(t.textContent ?? ""))
				.map((t) => [
					Number(t.getAttribute("x")),
					Number(t.getAttribute("y")),
				])
		const ringRadii = (c: HTMLElement) =>
			[...c.querySelectorAll("circle")]
				.filter((el) => el.getAttribute("fill") === "none")
				.map((el) => el.getAttribute("r"))

		const base = mount()
		const nudged = mount({
			extraConfigs: {
				r: { ...DEFAULT_AXIS_CONFIG, offsetX: 10, offsetY: -5 },
			},
		})
		const before = rLabelPositions(base)
		const after = rLabelPositions(nudged)
		expect(before.length).toBeGreaterThan(0)
		expect(after.length).toBe(before.length)
		before.forEach(([x, y], i) => {
			expect(after[i]![0]).toBeCloseTo(x + 10)
			expect(after[i]![1]).toBeCloseTo(y - 5)
		})
		expect(ringRadii(nudged)).toEqual(ringRadii(base))
	})
})

/** Pattern fills on radar: the polygon body and the points are SEPARATE
 *  pattern targets (Pattern menu → "Polygon fill" vs "Point fill"). */
describe("RadarPlot — pattern fills", () => {
	const isPatternUrl = (fill: string | null) =>
		!!fill && fill.startsWith("url(#vc-pat-")

	it("pattern.defaultPolygonPattern tiles the filled polygon and registers its <pattern> def; points stay plain", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { fillPolygon: true },
			extraConfigs: {
				pattern: { ...DEFAULT_PATTERN_CONFIG, defaultPolygonPattern: 2 },
			},
		})
		const polygons = [...c.querySelectorAll("polygon")]
		expect(polygons.length).toBe(2)
		for (const p of polygons) {
			const fill = p.getAttribute("fill")
			expect(isPatternUrl(fill)).toBe(true)
			const id = fill!.slice("url(#".length, -1)
			expect(id.startsWith("vc-pat-2-")).toBe(true)
			expect(c.querySelector(`pattern#${id}`)).not.toBeNull()
		}
		for (const dot of c.querySelectorAll("path")) {
			expect(isPatternUrl(dot.getAttribute("fill"))).toBe(false)
		}
	})

	it("the polygon pick does nothing while fillPolygon is off (no body to pattern)", () => {
		const c = mount({
			withConnection: true,
			extraConfigs: {
				pattern: { ...DEFAULT_PATTERN_CONFIG, defaultPolygonPattern: 2 },
			},
		})
		for (const p of c.querySelectorAll("polygon")) {
			expect(p.getAttribute("fill")).toBe("none")
		}
		expect(c.querySelectorAll("pattern").length).toBe(0)
	})

	it("the POINT default pattern fills the dots but leaves the polygon body plain", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { fillPolygon: true },
			extraConfigs: { defaultPattern: 1 },
		})
		for (const p of c.querySelectorAll("polygon")) {
			expect(isPatternUrl(p.getAttribute("fill"))).toBe(false)
		}
		// Axis paths share the <path> tag with the dots — count the patterned
		// ones: every one of the 8 data points.
		const dots = [...c.querySelectorAll("path")].filter((el) =>
			isPatternUrl(el.getAttribute("fill"))
		)
		expect(dots.length).toBe(8)
		for (const dot of dots) {
			const fill = dot.getAttribute("fill")!
			expect(c.querySelector(`pattern#${fill.slice("url(#".length, -1)}`)).not.toBeNull()
		}
	})

	it("with a pattern variable mapped, only categories with a polygon pick get a patterned body", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { fillPolygon: true },
			extraEncodings: { pattern: { field: "team" } },
			extraConfigs: {
				pattern: {
					...DEFAULT_PATTERN_CONFIG,
					polygonOverrides: { north: 3 },
					// A point-fill pick for south must not leak onto its polygon.
					overrides: { south: 0 },
				},
			},
		})
		const fills = [...c.querySelectorAll("polygon")].map((p) =>
			p.getAttribute("fill")
		)
		expect(fills.filter((f) => isPatternUrl(f)).length).toBe(1)
		expect(fills.some((f) => f!.startsWith("url(#vc-pat-3-"))).toBe(true)
	})
})

describe("RadarPlot — series paint order", () => {
	it("paints each series as one unit: polygon, then ITS dots, before the next series", () => {
		const c = mount({
			withConnection: true,
			connectionCfg: { fillPolygon: true },
		})
		const groups = [...c.querySelectorAll("[data-radar-series]")]
		expect(groups.length).toBe(2)
		for (const g of groups) {
			const kids = [...g.children]
			// Polygon first, then that series' 4 dots — nothing else.
			expect(kids[0]?.tagName.toLowerCase()).toBe("polygon")
			expect(kids.slice(1).map((k) => k.tagName.toLowerCase())).toEqual([
				"path",
				"path",
				"path",
				"path",
			])
		}
		// The two series are consecutive siblings: the second polygon comes
		// AFTER the first series' dots, so the lower series' points can't
		// poke through the upper series' fill.
		expect(groups[0]!.nextElementSibling).toBe(groups[1]!)
	})

	it("draw order reorders whole series (dots travel with their polygon)", () => {
		const asc = mount({
			withConnection: true,
			connectionCfg: { fillPolygon: true },
			drawOrder: { field: "team", dir: "asc" },
		})
		const desc = mount({
			withConnection: true,
			connectionCfg: { fillPolygon: true },
			drawOrder: { field: "team", dir: "desc" },
		})
		const keys = (c: HTMLElement) =>
			[...c.querySelectorAll("[data-radar-series]")].map((g) =>
				g.getAttribute("data-radar-series")
			)
		expect(keys(asc)).toEqual([...keys(desc)].reverse())
	})
})

describe("RadarPlot — Angle panel Spoke Labels (label every / distance)", () => {
	// Perimeter labels are the single-letter metric names; the r-tick labels
	// are numeric.
	const spokeLabels = (c: HTMLElement) =>
		[...c.querySelectorAll("text")].filter((t) =>
			/^[A-D]$/.test(t.textContent ?? ""),
		)

	it("'Label every' thins the perimeter labels while every spoke still draws", () => {
		const c = mount({
			extraConfigs: { angle: { ...DEFAULT_ANGLE_CONFIG, tickLabelEvery: 2 } },
		})
		expect(spokeLabels(c).map((t) => t.textContent)).toEqual(["A", "C"])
		// 4 categories → still 4 spokes.
		expect(c.querySelectorAll("line").length).toBe(4)
	})

	it("a positive 'Distance' pushes labels radially outward; negative pulls them onto the disc and flips the anchor", () => {
		const labelA = (c: HTMLElement) =>
			spokeLabels(c).find((t) => t.textContent === "A")!
		const labelB = (c: HTMLElement) =>
			spokeLabels(c).find((t) => t.textContent === "B")!
		// "A" sits at 12 o'clock, so its spoke's tip is the topmost line end and
		// the label sits `gap` px above it. Measuring the GAP (not the absolute
		// y) isolates the distance from the fit math, which also shrinks the
		// radar to keep pushed-out labels inside the cell.
		const spokeTipY = (c: HTMLElement) =>
			Math.min(
				...[...c.querySelectorAll("line")].map((l) =>
					Number(l.getAttribute("y2")),
				),
			)
		const gapAboveTip = (c: HTMLElement) =>
			spokeTipY(c) - Number(labelA(c).getAttribute("y"))

		const base = mount()
		const baseGap = gapAboveTip(base)
		expect(baseGap).toBeGreaterThan(0)

		const out = mount({
			extraConfigs: {
				angle: { ...DEFAULT_ANGLE_CONFIG, tickLabelDistance: 20 },
			},
		})
		expect(gapAboveTip(out)).toBeCloseTo(baseGap + 20)
		// The chart gave up room for the pushed-out labels: the tip moved in.
		expect(spokeTipY(out)).toBeGreaterThan(spokeTipY(base))

		const inward = mount({
			extraConfigs: {
				angle: { ...DEFAULT_ANGLE_CONFIG, tickLabelDistance: -30 },
			},
		})
		// Onto the disc: the label now sits BELOW the spoke tip, and the
		// radar itself did not shrink (negative distance reserves nothing).
		expect(gapAboveTip(inward)).toBeCloseTo(baseGap - 30)
		expect(spokeTipY(inward)).toBeCloseTo(spokeTipY(base))
		// "B" sits at 3 o'clock: outside it anchors "start" (reads outward);
		// inside the disc it anchors "end" (reads toward the center).
		expect(labelB(base).getAttribute("text-anchor")).toBe("start")
		expect(labelB(inward).getAttribute("text-anchor")).toBe("end")
	})
})
