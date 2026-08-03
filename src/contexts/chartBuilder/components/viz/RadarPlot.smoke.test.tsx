import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ConnectionConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
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
	datasetsAtom,
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

/** Atoms backed by `persistEffect` reload from localStorage at
 *  construction, overriding `initializeState`. Seed both so the
 *  initial atom values are the ones we want. */
const installInMemoryLocalStorage = (): Map<string, string> => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? store.get(k)! : null),
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	Object.defineProperty(window, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	return store
}

type Opts = {
	withConnection?: boolean
	connectionCfg?: Partial<ConnectionConfig>
	drawOrder?: { field: string; dir: "asc" | "desc" } | null
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
		}),
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState =
	(opts: Opts) =>
	(snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildRadarDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			r: { field: "score" },
			angle: { field: "metric" },
			...(opts.withConnection ? { connection: { field: "team" } } : {}),
		})
		snap.set(currentChannelConfigsAtom, {
			...EMPTY_CHANNEL_CONFIGS,
			connection: {
				...DEFAULT_CONNECTION_CONFIG,
				...(opts.connectionCfg ?? {}),
			},
			...(opts.drawOrder !== undefined ? { drawOrder: opts.drawOrder } : {}),
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
})
