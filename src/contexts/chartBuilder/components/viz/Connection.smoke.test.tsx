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

import { ScatterPlot } from "./ScatterPlot"

/** Smoke tests for the connection (line-chart) features the user
 *  reported as missing or broken: default fill mode, point sampling,
 *  and per-line dash patterns. Each test mounts ScatterPlot with a
 *  scatter+connection chart and reads back the SVG to verify the
 *  user-visible behavior. */

const DATASET_ID = "ds-conn"

const buildLineDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "lines",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "lines.csv",
			rows: [
				{ x: "1", y: "10", g: "north" },
				{ x: "2", y: "20", g: "north" },
				{ x: "3", y: "30", g: "north" },
				{ x: "4", y: "40", g: "north" },
				{ x: "5", y: "50", g: "north" },
				{ x: "1", y: "5", g: "south" },
				{ x: "2", y: "15", g: "south" },
				{ x: "3", y: "25", g: "south" },
				{ x: "4", y: "35", g: "south" },
				{ x: "5", y: "45", g: "south" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

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

const seedState = (connectionCfg: Partial<ConnectionConfig> = {}) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildLineDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			connection: { field: "g" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			connection: { ...DEFAULT_CONNECTION_CONFIG, ...connectionCfg },
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initState =
	(connectionCfg: Partial<ConnectionConfig> = {}) =>
	(snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildLineDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			connection: { field: "g" },
		})
		snap.set(currentChannelConfigsAtom, {
			...EMPTY_CHANNEL_CONFIGS,
			connection: { ...DEFAULT_CONNECTION_CONFIG, ...connectionCfg },
		})
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

const mount = (cfg: Partial<ConnectionConfig> = {}) => {
	seedState(cfg)
	const { container } = render(
		<TestProvider initializeState={initState(cfg)}>
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot />
			</div>
		</TestProvider>
	)
	return container
}

describe("Connection — point sampling", () => {
	it("default `pointSampling=all` renders one mark per row (10 rows → 10 paths)", () => {
		const c = mount()
		const paths = c.querySelectorAll("path")
		expect(paths.length).toBe(10)
	})

	it("`first-and-last` renders only 2 marks per group (4 marks total for 2 groups)", () => {
		const c = mount({ pointSampling: "first-and-last" })
		const paths = c.querySelectorAll("path")
		// 2 groups × 2 marks (first + last) = 4 marks total.
		expect(paths.length).toBe(4)
	})

	it("`first-only` renders 1 mark per group (2 marks total)", () => {
		const c = mount({ pointSampling: "first-only" })
		const paths = c.querySelectorAll("path")
		expect(paths.length).toBe(2)
	})
})

describe("Connection — default fill", () => {
	it("DEFAULT_CONNECTION_CONFIG.fill is 'line'", () => {
		// Pure value check — 'line' (not 'area') is the deliberate default.
		// Lives here so changing the default flips this loudly.
		expect(DEFAULT_CONNECTION_CONFIG.fill).toBe("line")
	})
})

describe("Connection — axis stems (lollipop)", () => {
	it("default `axisStem=none` draws no stem lines", () => {
		const c = mount()
		expect(c.querySelectorAll(".vc-axis-stem").length).toBe(0)
	})

	it("`x-axis` draws one vertical stem per point (10 rows → 10 vertical lines)", () => {
		const c = mount({ axisStem: "x-axis" })
		const lines = [...c.querySelectorAll(".vc-axis-stem")]
		expect(lines.length).toBe(10)
		// Vertical stem: x1 === x2, and it drops DOWN to the baseline (y2 >= y1).
		for (const l of lines) {
			expect(l.getAttribute("x1")).toBe(l.getAttribute("x2"))
			expect(Number(l.getAttribute("y2"))).toBeGreaterThanOrEqual(
				Number(l.getAttribute("y1"))
			)
		}
	})

	it("`y-axis` draws one horizontal stem per point (10 horizontal lines)", () => {
		const c = mount({ axisStem: "y-axis" })
		const lines = [...c.querySelectorAll(".vc-axis-stem")]
		expect(lines.length).toBe(10)
		// Horizontal stem: y1 === y2, and it runs LEFT to the baseline (x2 <= x1).
		for (const l of lines) {
			expect(l.getAttribute("y1")).toBe(l.getAttribute("y2"))
			expect(Number(l.getAttribute("x2"))).toBeLessThanOrEqual(
				Number(l.getAttribute("x1"))
			)
		}
	})

	it("colors stems by `stemColorField` through the chosen palette", () => {
		// `g` has 2 values: north (rows 0–4) then south (rows 5–9). The
		// ordinal scale maps them to palette[0] / palette[1] by first
		// appearance.
		const c = mount({
			axisStem: "x-axis",
			stemColorMode: "field",
			stemColorField: "g",
			stemColorPalette: ["#ff0000", "#00ff00"],
		})
		const strokes = [...c.querySelectorAll(".vc-axis-stem")].map((l) =>
			l.getAttribute("stroke")
		)
		expect(strokes.filter((s) => s === "#ff0000").length).toBe(5)
		expect(strokes.filter((s) => s === "#00ff00").length).toBe(5)
	})

	it("`single` mode paints every stem the one `stemColor` swatch", () => {
		const c = mount({
			axisStem: "x-axis",
			stemColorMode: "single",
			stemColor: "#123456",
		})
		const strokes = [...c.querySelectorAll(".vc-axis-stem")].map((l) =>
			l.getAttribute("stroke")
		)
		expect(strokes.length).toBe(10)
		expect(strokes.every((s) => s === "#123456")).toBe(true)
	})
})

describe("Connection — dash patterns", () => {
	it("default solid pattern emits a single polyline per group with NO stroke-dasharray", () => {
		const c = mount()
		const polylines = [...c.querySelectorAll("polyline")]
		// 2 groups × 1 polyline each = 2.
		expect(polylines.length).toBe(2)
		// None of them should have stroke-dasharray since the default is solid.
		const dashed = polylines.filter((p) => p.hasAttribute("stroke-dasharray"))
		expect(dashed.length).toBe(0)
	})

	it("smoothing > 0 swaps the straight polyline for a curved <path> per group", () => {
		const c = mount({ smoothing: 0.6 })
		// No connection polylines left — they render as smoothed paths now.
		expect(c.querySelectorAll("polyline").length).toBe(0)
		// The connection lines are the fill="none" paths (point marks carry a
		// real fill); each should be a cardinal spline (cubic C commands).
		const linePaths = [...c.querySelectorAll("path")].filter(
			(p) => p.getAttribute("fill") === "none"
		)
		expect(linePaths.length).toBe(2)
		expect(linePaths.every((p) => (p.getAttribute("d") ?? "").includes("C"))).toBe(
			true
		)
	})

	it("smoothing 0 (default) keeps a straight polyline per group", () => {
		const c = mount({ smoothing: 0 })
		expect(c.querySelectorAll("polyline").length).toBe(2)
	})

	it("dashed pattern emits a stacked underlay + dashed-top per group (4 polylines for 2 groups)", () => {
		// Apply a global default dashed pattern so every group inherits it.
		const c = mount({
			defaultDashPattern: "dashed",
		})
		const polylines = [...c.querySelectorAll("polyline")]
		// Each group gets 2 polylines: an alternate-color underlay (solid)
		// and a top dashed line. 2 groups → 4 polylines.
		expect(polylines.length).toBe(4)
		// Exactly half should carry stroke-dasharray (the top dashed line);
		// the other half (the underlay) should be solid.
		const dashed = polylines.filter((p) => p.hasAttribute("stroke-dasharray"))
		expect(dashed.length).toBe(2)
		// Confirm the dasharray value matches the "dashed" recipe.
		expect(dashed[0]?.getAttribute("stroke-dasharray")).toBe("8,4")
	})
})
