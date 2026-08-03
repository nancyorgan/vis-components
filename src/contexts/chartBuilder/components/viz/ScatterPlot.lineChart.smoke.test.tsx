import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_DATA_LABELS_CONFIG,
} from "../../lib/channelConfig"
import { getChartMode } from "../../lib/chartMode"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
} from "../../lib/types"
import {
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

import { AreaPlot } from "./AreaPlot"
import { ScatterPlot } from "./ScatterPlot"

/** Phase-1 evidence test for the recurring "no points on line charts"
 *  report. The user adds a `connection` encoding to a scatter chart with
 *  quantitative x + y and expects to see BOTH the polyline (joining
 *  points) AND the point markers (one per row). This test mounts
 *  ScatterPlot inside a minimal TestProvider, hands it a tiny dataset, and
 *  reads back the rendered SVG to verify each piece independently —
 *  giving us ground truth instead of relying on visual inspection. */

const DATASET_ID = "ds-test"

const buildLineChartDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "test",
	fields: [
		{ name: "month", inferredType: "quantitative" },
		{ name: "sales", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "test.csv",
			rows: [
				{ month: "1", sales: "10", region: "north" },
				{ month: "2", sales: "20", region: "north" },
				{ month: "3", sales: "30", region: "north" },
				{ month: "4", sales: "40", region: "north" },
				{ month: "1", sales: "12", region: "south" },
				{ month: "2", sales: "22", region: "south" },
				{ month: "3", sales: "32", region: "south" },
				{ month: "4", sales: "42", region: "south" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

/** Install a Map-backed in-memory localStorage shim. happy-dom's default
 *  localStorage in this Vitest config exposes the property but methods
 *  like `setItem` aren't actually callable, so the storage layer's
 *  `safeSet` silently no-ops and `safeGet` always returns the fallback.
 *  That means `persistEffect`'s `setSelf(load())` on first read clobbers
 *  whatever `initializeState` set. Replacing the whole object up-front
 *  with a working polyfill gets the atoms to load our test fixture. */
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

const seedLocalStorage = (opts: {
	connectionField: string
	hueField?: string
}) => {
	const store = installInMemoryLocalStorage()
	// Test-only seed of localStorage; the project's JSON-wrapper rule is
	// for runtime code that needs the safer parsing semantics. Test
	// fixtures are simple enough that direct stringify is fine.
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildLineChartDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			connection: { field: opts.connectionField },
			...(opts.hueField ? { hue: { field: opts.hueField } } : {}),
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initLineChartState =
	(opts: { connectionField: string; hueField?: string }) =>
	(snap: TestStore) => {
		// We still call snap.set for most atoms to anchor the store
		// baseline. currentChannelConfigsAtom is deliberately NOT set here:
		// it lazily bootstraps from localStorage, so `seedConnectionCfg`
		// below can inject per-test connection configs.
		snap.set(datasetsAtom, { [DATASET_ID]: buildLineChartDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			connection: { field: opts.connectionField },
			...(opts.hueField ? { hue: { field: opts.hueField } } : {}),
		})
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

/** Area-mode counterpart: uses `length` (not `y`) so the encoding combo
 *  routes to areas-x → AreaPlot. The area tests below verify AreaPlot's
 *  line-fill rendering of polylines + per-row point markers + dash
 *  patterns. */
const seedAreaChartStorage = (opts: {
	connectionField: string
	hueField?: string
}) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildLineChartDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "month" },
			length: { field: "sales" },
			connection: { field: opts.connectionField },
			...(opts.hueField ? { hue: { field: opts.hueField } } : {}),
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const initAreaChartState =
	(opts: { connectionField: string; hueField?: string }) =>
	(snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildLineChartDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, {
			...emptyEncodings(),
			x: { field: "month" },
			length: { field: "sales" },
			connection: { field: opts.connectionField },
			...(opts.hueField ? { hue: { field: opts.hueField } } : {}),
		})
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

/** Mount ScatterPlot with the given encodings + return the container's
 *  rendered SVG counts. Helper keeps the per-test bodies focused on the
 *  assertion. */
const mountAndCount = (opts: {
	connectionField: string
	hueField?: string
}) => {
	seedLocalStorage(opts)
	const { container } = render(
		<TestProvider initializeState={initLineChartState(opts)}>
			{/* Fixed-size wrapper so the `useMeasure` floor doesn't collapse
			 *  the inner rect to zero and suppress marks. */}
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot />
			</div>
		</TestProvider>
	)
	return {
		container,
		polylines: container.querySelectorAll("polyline").length,
		paths: container.querySelectorAll("path").length,
	}
}

describe("Line chart (scatter + connection) — points + line render together", () => {
	it("renders polylines AND <path> point markers when connection is mapped without hue", () => {
		// Two connection groups (north/south) × 4 points each → 2 polylines + 8 marks.
		const { polylines, paths } = mountAndCount({ connectionField: "region" })
		// Polyline = the connection line(s); one per connection group.
		expect(polylines).toBe(2)
		// Marks = <path> elements with d=symbolPath(...). With 8 rows we
		// expect 8 mark paths. Axes use <line>+<text> and gridlines use
		// <line>, so an exact-count assertion on <path> is safe and pins
		// the regression.
		expect(paths).toBe(8)
	})

	it("ROUTING: scatter+connection (no hue) goes to scatter mode (line chart with points)", () => {
		const enc = {
			...emptyEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			connection: { field: "region" },
		}
		expect(getChartMode(enc)).toBe("scatter")
	})

	it("ROUTING: scatter+connection+hue stays scatter (area mode is opt-in via length encoding)", () => {
		// Previous behavior auto-routed x + y + connection + hue to
		// areas-x → AreaPlot, which surprised line-chart users who'd
		// added hue to color their lines. Area mode is now strictly
		// opt-in via `length` (x + length + connection → areas-x).
		const enc = {
			...emptyEncodings(),
			x: { field: "month" },
			y: { field: "sales" },
			connection: { field: "region" },
			hue: { field: "region" },
		}
		expect(getChartMode(enc)).toBe("scatter")
	})

	it("ROUTING: x + length + connection + hue routes to areas-x (opt-in area mode)", () => {
		const enc = {
			...emptyEncodings(),
			x: { field: "month" },
			length: { field: "sales" },
			connection: { field: "region" },
			hue: { field: "region" },
		}
		expect(getChartMode(enc)).toBe("areas-x")
	})

	const seedConnectionCfg = (cfg: object) => {
		// Channel configs are seeded via localStorage (not snap.set):
		// the persisted atom bootstraps from storage on first read.
		/* eslint-disable @th/use-wrapped-json-functions */
		globalThis.localStorage.setItem(
			"vis-components:currentChannelConfigs",
			JSON.stringify({ connection: cfg })
		)
		/* eslint-enable @th/use-wrapped-json-functions */
	}

	it("connection polylines honor the Line cap option (square → stroke-linecap=butt)", () => {
		// Connection > Line properties > Line cap: "square" renders SVG's
		// `butt` cap (line ends flush at the data position); the default
		// "round" keeps the historical rounded ends.
		seedLocalStorage({ connectionField: "region" })
		seedConnectionCfg({ ...DEFAULT_CONNECTION_CONFIG, lineCap: "square" })
		const { container } = render(
			<TestProvider
				initializeState={initLineChartState({ connectionField: "region" })}
			>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		const polylines = [...container.querySelectorAll("polyline")]
		expect(polylines.length).toBe(2)
		expect(
			polylines.every((p) => p.getAttribute("stroke-linecap") === "butt")
		).toBe(true)
	})

	it("AreaPlot line-fill layer edges honor the Line cap option (square → stroke-linecap=butt)", () => {
		seedAreaChartStorage({ connectionField: "region", hueField: "region" })
		seedConnectionCfg({ ...DEFAULT_CONNECTION_CONFIG, lineCap: "square" })
		const { container } = render(
			<TestProvider
				initializeState={initAreaChartState({
					connectionField: "region",
					hueField: "region",
				})}
			>
				<div style={{ width: 600, height: 400 }}>
					<AreaPlot />
				</div>
			</TestProvider>
		)
		const layerLines = [...container.querySelectorAll("path")].filter(
			(p) => p.getAttribute("fill") === "none"
		)
		expect(layerLines.length).toBeGreaterThanOrEqual(2)
		expect(
			layerLines.every((p) => p.getAttribute("stroke-linecap") === "butt")
		).toBe(true)
	})

	it("AreaPlot in line-fill mode honors point sampling (`first-and-last` → 2 markers per layer)", () => {
		// Multi-line chart (areas-x mode with hue) where the user picks
		// "First and last only" under Connection > Show points. Each
		// layer should emit only 2 markers (the leftmost + rightmost
		// data points). Pre-fix, AreaPlot ignored pointSampling — every
		// row got a marker even when the user asked for fewer.
		seedAreaChartStorage({ connectionField: "region", hueField: "region" })
		seedConnectionCfg({
			...DEFAULT_CONNECTION_CONFIG,
			pointSampling: "first-and-last",
		})
		const { container } = render(
			<TestProvider
				initializeState={initAreaChartState({
					connectionField: "region",
					hueField: "region",
				})}
			>
				<div style={{ width: 600, height: 400 }}>
					<AreaPlot />
				</div>
			</TestProvider>
		)
		const points = container.querySelectorAll('circle[data-area-point="true"]')
		// 2 layers (north/south) × 2 markers each = 4.
		expect(points.length).toBe(4)
	})

	it("AreaPlot in line-fill mode honors dash patterns (dashed → underlay + dasharray top)", () => {
		// User-reported: in scatter+connection+hue mode (which routes to
		// areas-x → AreaPlot), patterns weren't rendering even though
		// color overrides did. Cause: AreaPlot's line-fill branch
		// didn't read `cfg.dashPatterns`. With the fix, a global
		// `defaultDashPattern: "dashed"` produces a stacked underlay
		// (alternate color, solid) + dashed top line PER layer.
		seedAreaChartStorage({ connectionField: "region", hueField: "region" })
		seedConnectionCfg({
			...DEFAULT_CONNECTION_CONFIG,
			defaultDashPattern: "dashed",
		})
		const { container } = render(
			<TestProvider
				initializeState={initAreaChartState({
					connectionField: "region",
					hueField: "region",
				})}
			>
				<div style={{ width: 600, height: 400 }}>
					<AreaPlot />
				</div>
			</TestProvider>
		)
		// 2 layers × (1 underlay + 1 dashed top) = 4 line paths with
		// `fill="none"`. The dashed top carries `stroke-dasharray="8,4"`.
		const pathsWithStrokeDash = [...container.querySelectorAll("path")].filter(
			(p) => p.getAttribute("stroke-dasharray") === "8,4"
		)
		expect(pathsWithStrokeDash.length).toBe(2)
	})

	it("connection lines honor 'Apply pattern to range' (solid before From, dashed after)", () => {
		// dashRange From=2 with months 1–4: each group's polyline splits at
		// x=2 into a solid 'pre' segment and a dashed 'in' segment (plus the
		// alternate-color underlay beneath the dashed part) → 3 polylines per
		// group, 6 total, exactly 2 of them dashed.
		seedLocalStorage({ connectionField: "region" })
		seedConnectionCfg({
			...DEFAULT_CONNECTION_CONFIG,
			defaultDashPattern: "dashed",
			dashRange: { enabled: true, min: "2", max: null },
		})
		const { container } = render(
			<TestProvider
				initializeState={initLineChartState({ connectionField: "region" })}
			>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		const polylines = [...container.querySelectorAll("polyline")]
		expect(polylines.length).toBe(6)
		const dashed = polylines.filter(
			(p) => p.getAttribute("stroke-dasharray") === "8,4"
		)
		expect(dashed.length).toBe(2)
		// The solid 'pre' segment ends exactly where the dashed segment
		// starts (the interpolated boundary point at From).
		const firstX = (p: Element): string =>
			(p.getAttribute("points") ?? "").split(" ")[0]?.split(",")[0] ?? ""
		const lastX = (p: Element): string =>
			(p.getAttribute("points") ?? "").split(" ").at(-1)?.split(",")[0] ?? ""
		const solidPre = polylines.filter(
			(p) => p.getAttribute("stroke-dasharray") === null
		)
		// 4 solid polylines: 2 'pre' + 2 underlays (which share the dashed
		// segment's geometry). Every dashed polyline's start x matches some
		// solid polyline's end x.
		expect(solidPre.length).toBe(4)
		for (const d of dashed) {
			expect(solidPre.some((s) => lastX(s) === firstX(d))).toBe(true)
		}
	})

	it("AreaPlot line-fill honors 'Apply pattern to range'", () => {
		seedAreaChartStorage({ connectionField: "region", hueField: "region" })
		seedConnectionCfg({
			...DEFAULT_CONNECTION_CONFIG,
			defaultDashPattern: "dashed",
			dashRange: { enabled: true, min: "2", max: null },
		})
		const { container } = render(
			<TestProvider
				initializeState={initAreaChartState({
					connectionField: "region",
					hueField: "region",
				})}
			>
				<div style={{ width: 600, height: 400 }}>
					<AreaPlot />
				</div>
			</TestProvider>
		)
		// Per layer: solid 'pre' edge + underlay + dashed 'in' edge = 3
		// fill="none" paths; 2 layers → 6, exactly 2 dashed.
		const layerLines = [...container.querySelectorAll("path")].filter(
			(p) => p.getAttribute("fill") === "none"
		)
		expect(layerLines.length).toBe(6)
		const dashed = layerLines.filter(
			(p) => p.getAttribute("stroke-dasharray") === "8,4"
		)
		expect(dashed.length).toBe(2)
	})

	it("dash range with no parseable boundary is inert (whole line dashed)", () => {
		seedLocalStorage({ connectionField: "region" })
		seedConnectionCfg({
			...DEFAULT_CONNECTION_CONFIG,
			defaultDashPattern: "dashed",
			dashRange: { enabled: true, min: null, max: null },
		})
		const { container } = render(
			<TestProvider
				initializeState={initLineChartState({ connectionField: "region" })}
			>
				<div style={{ width: 600, height: 400 }}>
					<ScatterPlot />
				</div>
			</TestProvider>
		)
		// No split: 2 underlays + 2 dashed lines, as without the range.
		expect(container.querySelectorAll("polyline").length).toBe(4)
	})

	it("AreaPlot in line-fill mode renders point markers at each data row (fixed)", () => {
		// User-opted area chart (x + length + connection + hue) routes to
		// areas-x → AreaPlot. With `fill = "line"` (the default), AreaPlot
		// emits the per-layer polyline AND a point marker per row.
		seedAreaChartStorage({ connectionField: "region", hueField: "region" })
		const { container } = render(
			<TestProvider
				initializeState={initAreaChartState({
					connectionField: "region",
					hueField: "region",
				})}
			>
				<div style={{ width: 600, height: 400 }}>
					<AreaPlot />
				</div>
			</TestProvider>
		)
		// AreaPlot renders the per-layer line as a `<path d="M..L..">` with
		// `fill="none"`. One per hue group (north / south).
		const layerLines = [...container.querySelectorAll("path")].filter(
			(p) => p.getAttribute("fill") === "none"
		)
		expect(layerLines.length).toBeGreaterThanOrEqual(2)
		// Point markers: one per row. AreaPlot's points layer emits
		// `<circle>` elements with `data-area-point="true"` so they're
		// distinguishable from any decorative circles the renderer might
		// add later.
		const points = container.querySelectorAll('circle[data-area-point="true"]')
		expect(points.length).toBe(8)
	})
})
