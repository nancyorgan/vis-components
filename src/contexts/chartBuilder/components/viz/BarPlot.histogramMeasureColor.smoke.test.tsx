import { render } from "@testing-library/react"
import { rgb as d3Rgb } from "d3-color"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Histograms can encode Fill color / opacity by each bin's derived measure
 *  (Count or Density) instead of a data field. These mount the real render
 *  path and confirm a bin's color / opacity tracks its height: the tallest bin
 *  lands at the gradient's high color / max opacity, the shortest at the low
 *  end. With a white→black gradient over [0, maxCount], a taller bin is darker. */

const DATASET_ID = "ds-bar-hist-measure"

/** 20 rows, score 1..20. Over round bins 0–5/5–10/10–15/15–20 the counts are
 *  4/5/5/6 — so the last bar is the tallest, the first the shortest. */
const buildDataset = (): Dataset => ({
	id: DATASET_ID,
	name: "scores",
	fields: [{ name: "score", inferredType: "quantitative" }],
	versions: [
		{
			id: "v1",
			filename: "scores.csv",
			rows: Array.from({ length: 20 }, (_, i) => ({ score: String(i + 1) })),
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

/** White→black linear gradient so a higher value maps to a darker color. */
const WHITE_BLACK_HUE = {
	kind: "quantitative",
	palette: "customLinear",
	lowColor: "#ffffff",
	highColor: "#000000",
	midColor: null,
	lowValue: null,
	midValue: null,
	highValue: null,
}

const seed = (encodings: Record<string, unknown>, configExtras: Record<string, unknown>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({ ...emptyEncodings(), x: { field: "score" }, ...encodings })
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			x: {
				...DEFAULT_AXIS_CONFIG,
				histogram: { enabled: true, binCount: 4, mode: "count" },
			},
			...configExtras,
		})
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

/** Mark rects (stroked), left-to-right, with fill + fillOpacity + height. */
const markRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.filter((r) => r.getAttribute("stroke") !== null)
		.map((r) => ({
			x: Number(r.getAttribute("x")),
			height: Number(r.getAttribute("height")),
			fill: r.getAttribute("fill") ?? "",
			fillOpacity: Number(r.getAttribute("fill-opacity")),
		}))
		.sort((a, b) => a.x - b.x)

/** Perceived lightness (0 = black, 255 = white) of a CSS color string. */
const lightness = (color: string): number => {
	const c = d3Rgb(color)
	return (c.r + c.g + c.b) / 3
}

describe("BarPlot — histogram Fill color/opacity by measure", () => {
	it("colors each bin by its count (taller bin → darker on a white→black ramp)", () => {
		seed({ hue: { field: null, measureSource: "count" } }, { hue: WHITE_BLACK_HUE })
		const rects = markRects(mount().container)
		expect(rects).toHaveLength(4)
		// Distinct fills (not one flat color).
		expect(new Set(rects.map((r) => r.fill)).size).toBeGreaterThan(1)
		// Tallest bar (last, count 6) is darker than the shortest (first, count 4).
		expect(lightness(rects[3]!.fill)).toBeLessThan(lightness(rects[0]!.fill))
	})

	it("fades each bin by its count (taller bin → higher opacity)", () => {
		seed(
			{ opacity: { field: null, measureSource: "count" } },
			{ opacity: { kind: "quantitative", min: 0.2, max: 1 } }
		)
		const rects = markRects(mount().container)
		expect(rects).toHaveLength(4)
		expect(new Set(rects.map((r) => r.fillOpacity)).size).toBeGreaterThan(1)
		// Tallest bar (last) is the most opaque; shortest (first) the least.
		expect(rects[3]!.fillOpacity).toBeGreaterThan(rects[0]!.fillOpacity)
	})

	it("leaves bins a single flat fill when no measure source is set", () => {
		seed({}, { hue: WHITE_BLACK_HUE })
		const rects = markRects(mount().container)
		expect(rects).toHaveLength(4)
		// No measure source → every bar shares the default fill.
		expect(new Set(rects.map((r) => r.fill)).size).toBe(1)
	})

	// NOTE: jsdom drops the `background: linear-gradient(...)` shorthand from the
	// serialized style attribute, so we identify the quantitative ramp by its
	// section title + numeric break labels rather than the gradient CSS itself.
	const legendTitle = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll("div")].some((d) => d.textContent === text)

	it("shows a quantitative legend titled 'Count' for color-by-count", () => {
		seed({ hue: { field: null, measureSource: "count" } }, { hue: WHITE_BLACK_HUE })
		const { container } = mount()
		// The legend section is titled by the measure...
		expect(legendTitle(container, "Count")).toBe(true)
		// ...and renders quantitative break labels spanning the count domain
		// (max bin = 6 over these data) — the signal it's a [0, max] ramp.
		const hasMaxBreak = [...container.querySelectorAll("span")].some(
			(s) => s.textContent === "6.00"
		)
		expect(hasMaxBreak).toBe(true)
	})

	it("renders no measure legend when no measure source is set", () => {
		seed({}, { hue: WHITE_BLACK_HUE })
		const { container } = mount()
		// Hue isn't mapped to a field or a measure, so no legend title renders.
		expect(legendTitle(container, "Count")).toBe(false)
	})
})
