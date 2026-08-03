import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import { DEFAULT_FACET_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import type { PlotInner } from "../../lib/plotLayout"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { AreaPlot } from "./AreaPlot"
import { BarPlot } from "./BarPlot"
import { PiePlot } from "./PiePlot"
import { ScatterPlot } from "./ScatterPlot"
import { TilePlot } from "./TilePlot"

/** Every mark renderer accepts an `inner` prop and emits SVG fragments
 *  into the parent's <svg>. PlotCanvas owns the outer <svg> element.
 *
 *  These tests pin the renderer contract:
 *    1. The renderer renders without crashing when `inner` is provided.
 *    2. Mark elements (rects, paths, lines) are positioned WITHIN the
 *       supplied inner rect — proving the renderer used `inner` and
 *       not some other rect.
 *    3. The renderer emits NO outer <svg> when `inner` is provided
 *       (it's just a Fragment of SVG fragments).
 */

const DATASET_ID = "ds-plot"

const buildScatterDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "scatter",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "g", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "s.csv",
			rows: [
				{ x: "1", y: "10", g: "A" },
				{ x: "2", y: "20", g: "A" },
				{ x: "3", y: "30", g: "B" },
				{ x: "4", y: "40", g: "B" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const buildBarDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "bars",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "v", inferredType: "quantitative" },
	],
	versions: [
		{
			id: "v1",
			filename: "b.csv",
			rows: [
				{ cat: "A", v: "10" },
				{ cat: "B", v: "20" },
				{ cat: "C", v: "15" },
			],
			createdAt: 0,
		},
	],
	latestVersionId: "v1",
	createdAt: 0,
})

const buildTileDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "tiles",
	fields: [
		{ name: "x", inferredType: "categorical" },
		{ name: "y", inferredType: "categorical" },
	],
	versions: [
		{
			id: "v1",
			filename: "t.csv",
			rows: [
				{ x: "A", y: "P" },
				{ x: "A", y: "Q" },
				{ x: "B", y: "P" },
				{ x: "B", y: "Q" },
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

type SeedOpts = {
	dataset: Dataset
	x: string | null
	y: string | null
	length?: string | null
}

const seedStorage = ({ dataset, x, y, length }: SeedOpts) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: dataset }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			...(x ? { x: { field: x } } : {}),
			...(y ? { y: { field: y } } : {}),
			...(length ? { length: { field: length } } : {}),
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({ facet: DEFAULT_FACET_CONFIG })
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const INNER: PlotInner = { x0: 50, y0: 20, x1: 550, y1: 400 }

/** Wrap the renderer in an outer <svg> since the inner-prop path emits
 *  SVG fragments only. This mimics what PlotCanvas does at runtime. */
const renderWithSvg = (el: ReactElement) =>
	render(
		<TestProvider>
			<svg width={600} height={420}>
				{el}
			</svg>
		</TestProvider>
	)

const expectMarksWithinInner = (container: HTMLElement, inner: PlotInner) => {
	const rects = [...container.querySelectorAll("rect")]
	// At least one mark rendered.
	expect(rects.length).toBeGreaterThan(0)
	for (const r of rects) {
		const x = Number(r.getAttribute("x") ?? "NaN")
		const y = Number(r.getAttribute("y") ?? "NaN")
		const w = Number(r.getAttribute("width") ?? "0")
		const h = Number(r.getAttribute("height") ?? "0")
		if (Number.isNaN(x) || Number.isNaN(y)) continue
		// All rect marks must sit within the inner bounds (allow ±0.5px float
		// drift). Excludes any background/clip rects that the Axes code may
		// emit — those aren't `<rect>` elements in the current renderers.
		expect(x).toBeGreaterThanOrEqual(inner.x0 - 0.5)
		expect(y).toBeGreaterThanOrEqual(inner.y0 - 0.5)
		expect(x + w).toBeLessThanOrEqual(inner.x1 + 0.5)
		expect(y + h).toBeLessThanOrEqual(inner.y1 + 0.5)
	}
}

describe("Plot — renderers accept `inner` prop", () => {
	it("ScatterPlot renders marks within the supplied inner rect", () => {
		seedStorage({ dataset: buildScatterDataset(), x: "x", y: "y" })
		const { container } = renderWithSvg(<ScatterPlot inner={INNER} />)
		// Scatter marks render as <path>. Confirm at least one exists.
		const paths = [...container.querySelectorAll("path")]
		expect(paths.length).toBeGreaterThan(0)
		// And every path's transform translate(cx,cy) places it within inner.
		for (const p of paths) {
			const t = p.getAttribute("transform") ?? ""
			const match = t.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/)
			if (!match) continue
			const cx = Number(match[1]!)
			const cy = Number(match[2]!)
			expect(cx).toBeGreaterThanOrEqual(INNER.x0 - 0.5)
			expect(cx).toBeLessThanOrEqual(INNER.x1 + 0.5)
			expect(cy).toBeGreaterThanOrEqual(INNER.y0 - 0.5)
			expect(cy).toBeLessThanOrEqual(INNER.y1 + 0.5)
		}
	})

	it("BarPlot renders bar rects within the supplied inner rect", () => {
		seedStorage({ dataset: buildBarDataset(), x: "cat", y: null, length: "v" })
		const { container } = renderWithSvg(<BarPlot inner={INNER} />)
		expectMarksWithinInner(container, INNER)
	})

	it("AreaPlot accepts inner prop without crashing", () => {
		// AreaPlot only mounts content when the resolved chart mode is
		// areas-x or areas-y; with x=categorical + length, the encoding
		// resolves to bars-x and AreaPlot returns null. The path-rendering
		// path is exercised by Playwright; here we just confirm the
		// inner-prop branch wires up without throwing.
		seedStorage({ dataset: buildBarDataset(), x: "cat", y: null, length: "v" })
		const { container } = renderWithSvg(<AreaPlot inner={INNER} />)
		expect(container.querySelectorAll("svg").length).toBe(1)
	})

	it("PiePlot accepts inner prop without crashing", () => {
		// Same caveat as AreaPlot: needs angular encoding for marks to
		// render. Smoke-test the inner-prop wiring only.
		seedStorage({ dataset: buildBarDataset(), x: null, y: null, length: "v" })
		const { container } = renderWithSvg(<PiePlot inner={INNER} />)
		expect(container.querySelectorAll("svg").length).toBe(1)
	})

	it("TilePlot renders cell rects within the supplied inner rect", () => {
		seedStorage({ dataset: buildTileDataset(), x: "x", y: "y" })
		const { container } = renderWithSvg(<TilePlot inner={INNER} />)
		expectMarksWithinInner(container, INNER)
	})

	it("inner-prop renderers do NOT emit their own outer <svg>", () => {
		// They emit Fragment children that live inside the parent SVG.
		// Confirm that wrapping a renderer in our outer SVG yields exactly
		// one <svg> element (the wrapper), not two.
		seedStorage({ dataset: buildScatterDataset(), x: "x", y: "y" })
		const { container } = renderWithSvg(<ScatterPlot inner={INNER} />)
		expect(container.querySelectorAll("svg").length).toBe(1)
	})
})
