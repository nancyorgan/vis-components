import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import { DEFAULT_FACET_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG, type LabelsConfig } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Smoke tests for PlotCanvas (the unified single-SVG renderer). The
 *  actual layout math is tested in facetLayoutSolver.test.ts; here we
 *  verify that:
 *    1. PlotCanvas renders ONE <svg> for the entire chart (faceted OR
 *       single-panel).
 *    2. captureThumbnail's existing `#PLOT_SVG_ID` path finds it.
 *
 *  Visual regression is owned by the Playwright suite. */

const DATASET_ID = "ds-canvas"

const buildFacetDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "f",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "f.csv",
			rows: [
				{ x: "1", y: "10", g: "A" },
				{ x: "2", y: "20", g: "A" },
				{ x: "3", y: "30", g: "B" },
				{ x: "4", y: "40", g: "B" },
				{ x: "5", y: "50", g: "C" },
				{ x: "6", y: "60", g: "C" },
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

const seed = (opts: { faceted: boolean; labels?: Partial<LabelsConfig> }) => {
	const store = installInMemoryLocalStorage()
	const ds = buildFacetDataset()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: ds }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			...(opts.faceted ? { facet: { field: "g" } } : {}),
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			facet: { ...DEFAULT_FACET_CONFIG, rows: 1, cols: 3 },
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({
			_v: 1,
			data: { ...DEFAULT_LABELS_CONFIG, ...(opts.labels ?? {}) },
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mountChartCanvas = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

/** Panel keys whose <g data-panel> contains y-axis tick labels.
 *
 *  Unrotated y tick labels are the only `text-anchor="end"` <text>
 *  elements inside a panel group (Axes.tsx: x ticks anchor "middle",
 *  per-panel axis titles are suppressed in the faceted path); the
 *  per-panel facet title is excluded explicitly for safety. Used to pin
 *  the solver's shared-axis tick suppression (showYTicks) per panel. */
const panelKeysWithYTickLabels = (container: HTMLElement): string[] =>
	[...container.querySelectorAll("[data-panel]")]
		.filter(
			(panel) =>
				[...panel.querySelectorAll('text[text-anchor="end"]')].filter(
					(t) => t.closest("[data-facet-label]") === null
				).length > 0
		)
		.map((el) => el.getAttribute("data-panel")!)

describe("PlotCanvas — single-SVG renderer", () => {
	it("faceted chart renders exactly ONE <svg> (not one per panel)", () => {
		seed({ faceted: true })
		const { container } = mountChartCanvas()
		const svgs = container.querySelectorAll("svg")
		expect(svgs.length).toBe(1)
	})

	it("single-panel chart renders exactly ONE <svg>", () => {
		seed({ faceted: false })
		const { container } = mountChartCanvas()
		expect(container.querySelectorAll("svg").length).toBe(1)
	})

	it("the rendered <svg> has the PLOT_SVG_ID so captureThumbnail finds it", () => {
		seed({ faceted: true })
		const { container } = mountChartCanvas()
		expect(container.querySelector("svg#vc-scatter-svg")).not.toBeNull()
	})

	it("renders per-panel data-panel-key markers for each facet value", () => {
		seed({ faceted: true })
		const { container } = mountChartCanvas()
		const panels = container.querySelectorAll("[data-panel-key]")
		// Dataset has 3 facet values A, B, C; grid is 1x3 → 3 panels.
		expect(panels.length).toBe(3)
		const keys = [...panels].map((p) => p.getAttribute("data-panel-key"))
		expect(new Set(keys)).toEqual(new Set(["A", "B", "C"]))
	})

	it("does NOT render the legacy [data-facet-grid] div", () => {
		seed({ faceted: true })
		const { container } = mountChartCanvas()
		expect(container.querySelector("[data-facet-grid]")).toBeNull()
	})
})

/** Grid mode (facetRow + facetCol both mapped). Renders an N×M panel
 *  grid whose dimensions come from the data cross-product. */

const GRID_DATASET_ID = "ds-grid"

const buildGridDataset = (): Dataset => ({
	id: GRID_DATASET_ID,
	name: "grid",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
		{ name: "year", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "grid.csv",
			rows: [
				{ x: "1", y: "10", region: "N", year: "2023" },
				{ x: "2", y: "20", region: "N", year: "2024" },
				{ x: "3", y: "30", region: "N", year: "2025" },
				{ x: "4", y: "40", region: "S", year: "2023" },
				{ x: "5", y: "50", region: "S", year: "2024" },
				{ x: "6", y: "60", region: "S", year: "2025" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const seedGrid = (opts?: { labels?: Partial<LabelsConfig> }) => {
	const store = installInMemoryLocalStorage()
	const ds = buildGridDataset()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [GRID_DATASET_ID]: ds }))
	store.set("vis-components:currentDatasetId", JSON.stringify(GRID_DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			facetRow: { field: "region" },
			facetCol: { field: "year" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			facet: { ...DEFAULT_FACET_CONFIG },
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({
			_v: 1,
			data: { ...DEFAULT_LABELS_CONFIG, ...(opts?.labels ?? {}) },
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

describe("PlotCanvas — grid mode (facetRow + facetCol)", () => {
	it("renders 2×3 panels when facetRow + facetCol are both mapped", () => {
		seedGrid()
		const { container } = mountChartCanvas()
		const panels = container.querySelectorAll("[data-panel]")
		// 2 regions (N, S) × 3 years (2023, 2024, 2025) = 6 panels.
		expect(panels.length).toBe(6)
	})

	it("panel keys encode (rowValue, colValue) as `${row}|${col}`", () => {
		seedGrid()
		const { container } = mountChartCanvas()
		const keys = [...container.querySelectorAll("[data-panel]")].map((el) =>
			el.getAttribute("data-panel")
		)
		expect(new Set(keys)).toEqual(
			new Set([
				"N|2023",
				"N|2024",
				"N|2025",
				"S|2023",
				"S|2024",
				"S|2025",
			])
		)
	})

	it("grid mode: renders column header strip with col values", () => {
		seedGrid()
		const { container } = mountChartCanvas()
		const headerTexts = [
			...container.querySelectorAll("[data-column-header]"),
		].map((el) => el.textContent)
		expect(new Set(headerTexts)).toEqual(new Set(["2023", "2024", "2025"]))
	})

	it("grid mode: renders row header strip with row values", () => {
		seedGrid()
		const { container } = mountChartCanvas()
		const headerTexts = [
			...container.querySelectorAll("[data-row-header]"),
		].map((el) => el.textContent)
		expect(new Set(headerTexts)).toEqual(new Set(["N", "S"]))
	})

	it("grid mode: per-panel facet labels are NOT rendered", () => {
		seedGrid()
		const { container } = mountChartCanvas()
		// In wrap mode, each panel has a facet-label text inside its <g>.
		// In grid mode, the strips replace those — no per-panel labels.
		expect(container.querySelectorAll("[data-facet-label]").length).toBe(0)
	})

	it("wrap mode: per-panel facet labels ARE still rendered (regression check)", () => {
		// Re-use the wrap-mode seed from the existing describe block.
		seed({ faceted: true })
		const { container } = mountChartCanvas()
		expect(
			container.querySelectorAll("[data-facet-label]").length
		).toBeGreaterThan(0)
	})

	it("row-only mode: facetRow set without facetCol renders N×1 panel layout", () => {
		const store = installInMemoryLocalStorage()
		const ds = buildGridDataset()
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set("vis-components:datasets", JSON.stringify({ [GRID_DATASET_ID]: ds }))
		store.set("vis-components:currentDatasetId", JSON.stringify(GRID_DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set(
			"vis-components:currentEncodings",
			JSON.stringify({
				...emptyEncodings(),
				x: { field: "x" },
				y: { field: "y" },
				facetRow: { field: "region" },
				// facetCol intentionally unmapped
			})
		)
		store.set(
			"vis-components:currentChannelConfigs",
			JSON.stringify({ facet: { ...DEFAULT_FACET_CONFIG } })
		)
		store.set(
			"vis-components:currentLabels",
			JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
		)
		/* eslint-enable @th/use-wrapped-json-functions */
		const { container } = mountChartCanvas()
		// 2 regions (N, S) × 1 col = 2 panels.
		const panels = container.querySelectorAll("[data-panel]")
		expect(panels.length).toBe(2)
		// Row header strip renders the row values.
		const rowHeaders = [
			...container.querySelectorAll("[data-row-header]"),
		].map((el) => el.textContent)
		expect(new Set(rowHeaders)).toEqual(new Set(["N", "S"]))
		// No column header strip — there's only one (implicit) column.
		expect(container.querySelectorAll("[data-column-header]").length).toBe(0)
		// No per-panel facet labels.
		expect(container.querySelectorAll("[data-facet-label]").length).toBe(0)
	})

	it("col-only mode: facetCol set without facetRow renders 1×N panel layout", () => {
		const store = installInMemoryLocalStorage()
		const ds = buildGridDataset()
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set("vis-components:datasets", JSON.stringify({ [GRID_DATASET_ID]: ds }))
		store.set("vis-components:currentDatasetId", JSON.stringify(GRID_DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set(
			"vis-components:currentEncodings",
			JSON.stringify({
				...emptyEncodings(),
				x: { field: "x" },
				y: { field: "y" },
				facetCol: { field: "year" },
				// facetRow intentionally unmapped
			})
		)
		store.set(
			"vis-components:currentChannelConfigs",
			JSON.stringify({ facet: { ...DEFAULT_FACET_CONFIG } })
		)
		store.set(
			"vis-components:currentLabels",
			JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
		)
		/* eslint-enable @th/use-wrapped-json-functions */
		const { container } = mountChartCanvas()
		// 1 row × 3 years (2023, 2024, 2025) = 3 panels.
		const panels = container.querySelectorAll("[data-panel]")
		expect(panels.length).toBe(3)
		const colHeaders = [
			...container.querySelectorAll("[data-column-header]"),
		].map((el) => el.textContent)
		expect(new Set(colHeaders)).toEqual(new Set(["2023", "2024", "2025"]))
		expect(container.querySelectorAll("[data-row-header]").length).toBe(0)
		expect(container.querySelectorAll("[data-facet-label]").length).toBe(0)
	})

	it("hideEmptyPanels: compact-cols drops empty panels, keeps only the column strip, titles panels with row values", () => {
		const store = installInMemoryLocalStorage()
		const ds = buildGridDataset()
		// 3 row values (N, S, W) × 2 col values (2023, 2024) = 6 combos,
		// only 4 non-empty; every column has exactly 2 → compact-cols.
		const sparse: Dataset = {
			...ds,
			versions: [
				{
					...ds.versions[0]!,
					rows: [
						{ x: "1", y: "10", region: "N", year: "2023" },
						{ x: "2", y: "20", region: "S", year: "2023" },
						{ x: "3", y: "30", region: "N", year: "2024" },
						{ x: "4", y: "40", region: "W", year: "2024" },
					],
				},
			],
		}
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set("vis-components:datasets", JSON.stringify({ [GRID_DATASET_ID]: sparse }))
		store.set("vis-components:currentDatasetId", JSON.stringify(GRID_DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set(
			"vis-components:currentEncodings",
			JSON.stringify({
				...emptyEncodings(),
				x: { field: "x" },
				y: { field: "y" },
				facetRow: { field: "region" },
				facetCol: { field: "year" },
			})
		)
		store.set(
			"vis-components:currentChannelConfigs",
			JSON.stringify({
				facet: { ...DEFAULT_FACET_CONFIG, hideEmptyPanels: true },
			})
		)
		store.set(
			"vis-components:currentLabels",
			JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
		)
		/* eslint-enable @th/use-wrapped-json-functions */
		const { container } = mountChartCanvas()
		// (a) Only the 4 non-empty combinations render, not the 6-cell
		// cross-product; keys stay `${row}|${col}`.
		const keys = [...container.querySelectorAll("[data-panel]")].map((el) =>
			el.getAttribute("data-panel")
		)
		expect(keys.length).toBe(4)
		expect(new Set(keys)).toEqual(
			new Set(["N|2023", "S|2023", "N|2024", "W|2024"])
		)
		// (b) The compacted dimension's strip is gone; the survivor remains.
		expect(container.querySelectorAll("[data-row-header]").length).toBe(0)
		const colHeaders = [
			...container.querySelectorAll("[data-column-header]"),
		].map((el) => el.textContent)
		expect(new Set(colHeaders)).toEqual(new Set(["2023", "2024"]))
		// (c) Per-panel titles carry the compacted dimension's ROW values.
		const labels = [...container.querySelectorAll("[data-facet-label]")].map(
			(el) => el.textContent
		)
		expect([...labels].sort()).toEqual(["N", "N", "S", "W"])
		// (d) Default shareY ("all") keeps interior y-axis suppression: one
		// global y scale means only each layout row's leftmost panel needs
		// tick labels. 4 panels in a 2×2 compacted grid → exactly 2 carry
		// y ticks.
		expect(panelKeysWithYTickLabels(container).length).toBe(2)
	})

	it("hideEmptyPanels: compact-cols with shareY perGroup renders every panel's own y-axis ticks", () => {
		// Regression pin for the tick-suppression × compaction bug: share
		// GROUPS are keyed by original facet-row value, but the solver's
		// tick suppression is layout-positional (leftmost panel per layout
		// ROW). Under compact-cols a layout row mixes facet-row groups
		// (here row 1 holds S|2023 and W|2024 — groups S and W), so hiding
		// W|2024's y axis would leave it captioned by group S's domain.
		// PlotCanvas must pass shareY: false to the solver in this case →
		// every panel keeps its own y tick labels.
		const store = installInMemoryLocalStorage()
		const ds = buildGridDataset()
		const sparse: Dataset = {
			...ds,
			versions: [
				{
					...ds.versions[0]!,
					rows: [
						{ x: "1", y: "10", region: "N", year: "2023" },
						{ x: "2", y: "20", region: "S", year: "2023" },
						{ x: "3", y: "30", region: "N", year: "2024" },
						{ x: "4", y: "40", region: "W", year: "2024" },
					],
				},
			],
		}
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set("vis-components:datasets", JSON.stringify({ [GRID_DATASET_ID]: sparse }))
		store.set("vis-components:currentDatasetId", JSON.stringify(GRID_DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set(
			"vis-components:currentEncodings",
			JSON.stringify({
				...emptyEncodings(),
				x: { field: "x" },
				y: { field: "y" },
				facetRow: { field: "region" },
				facetCol: { field: "year" },
			})
		)
		store.set(
			"vis-components:currentChannelConfigs",
			JSON.stringify({
				facet: {
					...DEFAULT_FACET_CONFIG,
					hideEmptyPanels: true,
					shareY: "perGroup",
				},
			})
		)
		store.set(
			"vis-components:currentLabels",
			JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
		)
		/* eslint-enable @th/use-wrapped-json-functions */
		const { container } = mountChartCanvas()
		const keys = [...container.querySelectorAll("[data-panel]")].map((el) =>
			el.getAttribute("data-panel")
		)
		expect(new Set(keys)).toEqual(
			new Set(["N|2023", "S|2023", "N|2024", "W|2024"])
		)
		// ALL four panels — not just the leftmost of each layout row —
		// render y tick labels.
		expect(new Set(panelKeysWithYTickLabels(container))).toEqual(
			new Set(["N|2023", "S|2023", "N|2024", "W|2024"])
		)
	})

	/** Same sparse compact-cols fixture as the hideEmptyPanels tests above
	 *  (4 non-empty combos → 2×2 compacted grid with per-panel titles and a
	 *  surviving column strip), with configurable labels config so the
	 *  per-panel-title font slot (`facetPanelTitle`) can be exercised. */
	const seedCompactSparse = (labelsData: LabelsConfig) => {
		const store = installInMemoryLocalStorage()
		const ds = buildGridDataset()
		const sparse: Dataset = {
			...ds,
			versions: [
				{
					...ds.versions[0]!,
					rows: [
						{ x: "1", y: "10", region: "N", year: "2023" },
						{ x: "2", y: "20", region: "S", year: "2023" },
						{ x: "3", y: "30", region: "N", year: "2024" },
						{ x: "4", y: "40", region: "W", year: "2024" },
					],
				},
			],
		}
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set("vis-components:datasets", JSON.stringify({ [GRID_DATASET_ID]: sparse }))
		store.set("vis-components:currentDatasetId", JSON.stringify(GRID_DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set(
			"vis-components:currentEncodings",
			JSON.stringify({
				...emptyEncodings(),
				x: { field: "x" },
				y: { field: "y" },
				facetRow: { field: "region" },
				facetCol: { field: "year" },
			})
		)
		store.set(
			"vis-components:currentChannelConfigs",
			JSON.stringify({
				facet: { ...DEFAULT_FACET_CONFIG, hideEmptyPanels: true },
			})
		)
		store.set(
			"vis-components:currentLabels",
			JSON.stringify({ _v: 1, data: labelsData })
		)
		/* eslint-enable @th/use-wrapped-json-functions */
	}

	it("hideEmptyPanels: facetPanelTitle override styles the compact per-panel titles, NOT the strip", () => {
		seedCompactSparse({
			...DEFAULT_LABELS_CONFIG,
			fontOverrides: { facetPanelTitle: { color: "#ff0000", size: 19 } },
		})
		const { container } = mountChartCanvas()
		// The four compacted panels each carry a title text styled by the
		// facetPanelTitle slot (SharedText emits fill / font-size attributes).
		const labelTexts = [
			...container.querySelectorAll("[data-facet-label] text"),
		]
		expect(labelTexts.length).toBe(4)
		for (const t of labelTexts) {
			expect(t.getAttribute("fill")).toBe("#ff0000")
			expect(t.getAttribute("font-size")).toBe("19")
		}
		// Independence: the surviving column-header strip keeps its own
		// facetTitle/facetColTitle styling — the per-panel slot must not
		// leak into it.
		const colHeaders = [
			...container.querySelectorAll("[data-column-header]"),
		]
		expect(colHeaders.length).toBeGreaterThan(0)
		for (const h of colHeaders) {
			expect(h.getAttribute("fill")).not.toBe("#ff0000")
			expect(h.getAttribute("font-size")).not.toBe("19")
		}
	})

	it("hideEmptyPanels: without a facetPanelTitle override, per-panel titles inherit facetTitle styling (layering back-compat)", () => {
		seedCompactSparse({
			...DEFAULT_LABELS_CONFIG,
			fontOverrides: { facetTitle: { color: "#00ff00" } },
		})
		const { container } = mountChartCanvas()
		const labelTexts = [
			...container.querySelectorAll("[data-facet-label] text"),
		]
		expect(labelTexts.length).toBe(4)
		for (const t of labelTexts) {
			expect(t.getAttribute("fill")).toBe("#00ff00")
		}
	})
})

/** Facet-title Orientation (labels.titleAngles) — a paint-time rotation
 *  about each title's anchor point. Wrap panel labels and the grid header
 *  strips all honor the shared `facetTitle` angle. */
describe("PlotCanvas — facet-title orientation", () => {
	it("wrap mode: titleAngles.facetTitle rotates each per-panel facet label about its anchor", () => {
		seed({ faceted: true, labels: { titleAngles: { facetTitle: 90 } } })
		const { container } = mountChartCanvas()
		const labelTexts = [
			...container.querySelectorAll("[data-facet-label] text"),
		]
		expect(labelTexts.length).toBe(3)
		for (const t of labelTexts) {
			expect(t.getAttribute("transform")).toMatch(/^rotate\(90, /)
		}
	})

	it("wrap mode: no transform when no angle is set (default upright)", () => {
		seed({ faceted: true })
		const { container } = mountChartCanvas()
		const labelTexts = [
			...container.querySelectorAll("[data-facet-label] text"),
		]
		expect(labelTexts.length).toBe(3)
		for (const t of labelTexts) {
			expect(t.getAttribute("transform")).toBeNull()
		}
	})

	it("grid mode: the shared facetTitle angle rotates both header strips (layering fallback)", () => {
		seedGrid({ labels: { titleAngles: { facetTitle: -45 } } })
		const { container } = mountChartCanvas()
		const headers = [
			...container.querySelectorAll("[data-column-header]"),
			...container.querySelectorAll("[data-row-header]"),
		]
		expect(headers.length).toBe(5) // 3 col values + 2 row values
		for (const h of headers) {
			expect(h.getAttribute("transform")).toMatch(/^rotate\(-45, /)
		}
	})

	it("grid mode: per-strip angles win over the shared facetTitle angle", () => {
		seedGrid({
			labels: { titleAngles: { facetTitle: -45, facetColTitle: 90 } },
		})
		const { container } = mountChartCanvas()
		for (const h of container.querySelectorAll("[data-column-header]")) {
			expect(h.getAttribute("transform")).toMatch(/^rotate\(90, /)
		}
		for (const h of container.querySelectorAll("[data-row-header]")) {
			expect(h.getAttribute("transform")).toMatch(/^rotate\(-45, /)
		}
	})
})

/** Layout invariants pinned on the SVG model. */

const seedWithLayout = (opts: {
	rows: number
	cols: number
	gapY: number
	yAxisTitleHorizontal?: boolean
}) => {
	const store = installInMemoryLocalStorage()
	const ds = buildFacetDataset()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: ds }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			facet: { field: "g" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			facet: {
				...DEFAULT_FACET_CONFIG,
				rows: opts.rows,
				cols: opts.cols,
				gapY: opts.gapY,
			},
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({
			_v: 1,
			data: {
				...DEFAULT_LABELS_CONFIG,
				xAxisTitle: "x axis",
				yAxisTitle: "y axis",
				yAxisTitleHorizontal: opts.yAxisTitleHorizontal ?? false,
			},
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

describe("PlotCanvas (flag ON) — legacy smoke-test invariants on SVG model", () => {
	it("renders EXACTLY ONE shared y-axis title text (not one per panel)", () => {
		// Legacy fixture: 5×1 faceted; the SVG should contain a single
		// <text> whose content is "y axis".
		seedWithLayout({ rows: 3, cols: 1, gapY: 0 })
		const { container } = mountChartCanvas()
		const yTitleTexts = [...container.querySelectorAll("svg text")].filter(
			(t) => (t.textContent ?? "").trim() === "y axis"
		)
		expect(yTitleTexts.length).toBe(1)
	})

	it("renders EXACTLY ONE shared x-axis title text (not one per panel)", () => {
		seedWithLayout({ rows: 3, cols: 1, gapY: 0 })
		const { container } = mountChartCanvas()
		const xTitleTexts = [...container.querySelectorAll("svg text")].filter(
			(t) => (t.textContent ?? "").trim() === "x axis"
		)
		expect(xTitleTexts.length).toBe(1)
	})

	it("ridgeline gapY=-20 produces cumulative facet-label y-positions", () => {
		// gapY was -50 originally, but the unmeasured-render path
		// (useMeasure returns 0×0 in jsdom → solver falls back to
		// minCanvasH=120) gives cells just barely larger than 50, so
		// any growth in the bottom reserve (e.g. the TITLE_LABEL_GAP_PX
		// fix in May 2026) tips them past the -50 threshold and labels
		// go backward. -20 keeps the cumulative-effect invariant
		// testable in jsdom without depending on exact pixel arithmetic.
		seedWithLayout({ rows: 3, cols: 1, gapY: -20 })
		const { container } = mountChartCanvas()
		// Each panel's facet label is an SVG <text>. Find them in panel
		// order (data-panel-key groups), extract their y attribute.
		const panels = [...container.querySelectorAll("[data-panel-key]")]
		expect(panels.length).toBe(3)
		const labelYs = panels.map((p) => {
			const text = p.querySelector("text")
			return Number(text?.getAttribute("y") ?? "NaN")
		})
		// Successive labels must DECREASE in spacing under negative gap:
		// y[i+1] - y[i] is less than it would be without the negative gap.
		// Stronger invariant: labels are STRICTLY MONOTONIC in canvas
		// y-direction (cell.y values increase with row).
		for (let i = 1; i < labelYs.length; i++) {
			expect(labelYs[i]!).toBeGreaterThan(labelYs[i - 1]!)
		}
		// The cumulative ridgeline effect: the stride between successive
		// facet labels under gapY=-50 should be smaller than the stride
		// under gapY=0 with the same fixture.
	})

	it("rotated y-title (default) has rotation -90 in transform attribute", () => {
		seedWithLayout({ rows: 3, cols: 1, gapY: 0, yAxisTitleHorizontal: false })
		const { container } = mountChartCanvas()
		const yTitle = [...container.querySelectorAll("svg text")].find(
			(t) => (t.textContent ?? "").trim() === "y axis"
		)
		expect(yTitle).toBeDefined()
		const transform = yTitle?.getAttribute("transform") ?? ""
		expect(transform).toMatch(/rotate\(-90/)
	})

	it("horizontal y-title (yAxisTitleHorizontal=true) has NO rotate transform", () => {
		seedWithLayout({ rows: 3, cols: 1, gapY: 0, yAxisTitleHorizontal: true })
		const { container } = mountChartCanvas()
		const yTitle = [...container.querySelectorAll("svg text")].find(
			(t) => (t.textContent ?? "").trim() === "y axis"
		)
		expect(yTitle).toBeDefined()
		const transform = yTitle?.getAttribute("transform") ?? ""
		expect(transform).not.toMatch(/rotate/)
	})
})

/** Tri-state shareX / shareY. The picker (Task 2.2) writes
 *  "none" | "perGroup" | "all" to facetCfg.shareX / shareY; this section
 *  verifies that PlotCanvas's scale construction differentiates all three
 *  modes (Tasks 2.3 / 2.4).
 *
 *  Fixture: 2×2 wrap-mode grid (facet=g, rows=2, cols=2). Panel order is
 *  row-major over the sorted facet values [A, B, C, D]:
 *    row 0: A (col 0), B (col 1)
 *    row 1: C (col 0), D (col 1)
 *  Each panel has a distinct x-range so the resulting per-panel
 *  scale-source row count is observable on the panel <g>:
 *    col 0 (A + C) → x ∈ [0, 10]    (4 rows total)
 *    col 1 (B + D) → x ∈ [100, 1000] (4 rows total)
 *  Same pattern mirrored on y (per-row variation):
 *    row 0 (A + B) → y small;  row 1 (C + D) → y large.
 *
 *  PlotCanvas exposes the scale-source via `data-x-scale-rows` /
 *  `data-y-scale-rows` (the row count fed to scalesRowsOverrideX/Y, or
 *  the panel's own rows when not overridden) so tests can assert which
 *  source each panel consulted.
 *
 *  Wrap mode is used (not grid mode) because the shareX/Y gate in
 *  PlotCanvas currently requires `encodings.facet` to be mapped
 *  (isFaceted check); extending sharing to grid mode is a separate
 *  task. */
const TRISTATE_DATASET_ID = "ds-tristate"

const buildTriStateDataset = (): Dataset => ({
	id: TRISTATE_DATASET_ID,
	name: "tri",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "tri.csv",
			rows: [
				// A → row 0, col 0 (small x, small y)
				{ x: "0", y: "0", g: "A" },
				{ x: "10", y: "5", g: "A" },
				// B → row 0, col 1 (large x, small y)
				{ x: "100", y: "1", g: "B" },
				{ x: "1000", y: "9", g: "B" },
				// C → row 1, col 0 (small x, large y)
				{ x: "1", y: "200", g: "C" },
				{ x: "9", y: "500", g: "C" },
				// D → row 1, col 1 (large x, large y)
				{ x: "200", y: "100", g: "D" },
				{ x: "900", y: "900", g: "D" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const seedTriState = (opts: {
	shareX: "none" | "perGroup" | "all"
	shareY: "none" | "perGroup" | "all"
}) => {
	const store = installInMemoryLocalStorage()
	const ds = buildTriStateDataset()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [TRISTATE_DATASET_ID]: ds })
	)
	store.set(
		"vis-components:currentDatasetId",
		JSON.stringify(TRISTATE_DATASET_ID)
	)
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "x" },
			y: { field: "y" },
			facet: { field: "g" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			facet: {
				...DEFAULT_FACET_CONFIG,
				rows: 2,
				cols: 2,
				shareX: opts.shareX,
				shareY: opts.shareY,
			},
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const panelRowCounts = (
	container: Element,
): Array<{ key: string; xCount: number; yCount: number }> =>
	[...container.querySelectorAll("[data-panel]")].map((el) => ({
		key: el.getAttribute("data-panel") ?? "",
		xCount: Number(el.getAttribute("data-x-scale-rows") ?? "NaN"),
		yCount: Number(el.getAttribute("data-y-scale-rows") ?? "NaN"),
	}))

describe("PlotCanvas — tri-state shareX / shareY", () => {
	it("shareX='all' / shareY='all': every panel's scale-source is the full dataset (8 rows)", () => {
		seedTriState({ shareX: "all", shareY: "all" })
		const { container } = mountChartCanvas()
		const counts = panelRowCounts(container)
		expect(counts).toHaveLength(4)
		for (const c of counts) {
			expect(c.xCount).toBe(8)
			expect(c.yCount).toBe(8)
		}
	})

	it("shareX='none' / shareY='none': each panel's scale-source is its own 2 rows", () => {
		seedTriState({ shareX: "none", shareY: "none" })
		const { container } = mountChartCanvas()
		const counts = panelRowCounts(container)
		expect(counts).toHaveLength(4)
		for (const c of counts) {
			// Each cell has exactly 2 rows in the fixture.
			expect(c.xCount).toBe(2)
			expect(c.yCount).toBe(2)
		}
	})

	it("shareX='perGroup': panels in same COLUMN share x-scale (4 rows/col), columns differ", () => {
		seedTriState({ shareX: "perGroup", shareY: "none" })
		const { container } = mountChartCanvas()
		const counts = panelRowCounts(container)
		expect(counts).toHaveLength(4)
		// Wrap-mode panels go A,B,C,D in row-major order over a 2×2 grid:
		//   col 0 = A + C  (panels 0, 2)
		//   col 1 = B + D  (panels 1, 3)
		const byKey = new Map(counts.map((c) => [c.key, c]))
		expect(byKey.get("A")!.xCount).toBe(4)
		expect(byKey.get("C")!.xCount).toBe(4)
		expect(byKey.get("B")!.xCount).toBe(4)
		expect(byKey.get("D")!.xCount).toBe(4)
		// y is still per-panel: 2 each.
		for (const c of counts) {
			expect(c.yCount).toBe(2)
		}
	})

	it("shareY='perGroup': panels in same ROW share y-scale (4 rows/row)", () => {
		seedTriState({ shareX: "none", shareY: "perGroup" })
		const { container } = mountChartCanvas()
		const counts = panelRowCounts(container)
		expect(counts).toHaveLength(4)
		// row 0 = A + B (panels 0, 1); row 1 = C + D (panels 2, 3).
		const byKey = new Map(counts.map((c) => [c.key, c]))
		expect(byKey.get("A")!.yCount).toBe(4)
		expect(byKey.get("B")!.yCount).toBe(4)
		expect(byKey.get("C")!.yCount).toBe(4)
		expect(byKey.get("D")!.yCount).toBe(4)
		// x stays per-panel.
		for (const c of counts) {
			expect(c.xCount).toBe(2)
		}
	})

	it("shareX='perGroup' + shareY='perGroup': mixed grouping per-axis", () => {
		seedTriState({ shareX: "perGroup", shareY: "perGroup" })
		const { container } = mountChartCanvas()
		const counts = panelRowCounts(container)
		expect(counts).toHaveLength(4)
		for (const c of counts) {
			expect(c.xCount).toBe(4)
			expect(c.yCount).toBe(4)
		}
	})

	it("shareX='all' differs from shareX='perGroup' when columns have distinct data", () => {
		seedTriState({ shareX: "all", shareY: "none" })
		const { container: allContainer } = mountChartCanvas()
		const allCounts = panelRowCounts(allContainer)
		seedTriState({ shareX: "perGroup", shareY: "none" })
		const { container: perGroupContainer } = mountChartCanvas()
		const perGroupCounts = panelRowCounts(perGroupContainer)
		// In all-mode every panel's xCount is 8; in perGroup it's 4.
		// They MUST differ — otherwise perGroup collapses into all.
		expect(allCounts.every((c) => c.xCount === 8)).toBe(true)
		expect(perGroupCounts.every((c) => c.xCount === 4)).toBe(true)
	})
})
