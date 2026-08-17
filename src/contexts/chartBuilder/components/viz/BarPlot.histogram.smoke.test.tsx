import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** A histogram bins a SINGLE quantitative variable and shows the row count
 *  per bin — no measure/length field. These tests mount the real render path
 *  (ChartCanvas → PlotCanvas → BarPlot) with only a quantitative `x` mapped,
 *  toggle the per-axis histogram config, and confirm the values collapse into
 *  the configured number of contiguous count bars. */

const DATASET_ID = "ds-bar-histogram"

/** 20 rows, score = 1..20 (quantitative). No measure field — bar height is
 *  the count of rows per bin. Four equal-width bins each hold 5 rows. */
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [{ name: "score", inferredType: "quantitative" }],
		rows: Array.from({ length: 20 }, (_, i) => ({
			score: String(i + 1),
		})),
	})

const seed = (channelConfigs: Record<string, unknown>) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "score" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify(channelConfigs)
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

/** Mark rects carry a stroke (outline); background rects don't. */
const markRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.filter((r) => r.getAttribute("stroke") !== null)
		.map((r) => ({
			x: Number(r.getAttribute("x")),
			width: Number(r.getAttribute("width")),
			height: Number(r.getAttribute("height")),
		}))
		.sort((a, b) => a.x - b.x)

const histogramConfig = (
	binCount: number,
	mode: "count" | "density" = "count"
) => ({
	x: { ...DEFAULT_AXIS_CONFIG, histogram: { enabled: true, binCount, mode } },
})

describe("BarPlot — histogram (single variable, count per bin)", () => {
	it("renders one count bar per bin from a lone quantitative variable", () => {
		seed(histogramConfig(4))
		const { container } = mount()
		expect(markRects(container)).toHaveLength(4)
	})

	it("applies the count axis's max (the derived measure axis honors min/max)", () => {
		// The count axis (Y) has no field, but its min/max must still apply.
		const numericTicks = (c: HTMLElement) =>
			[...c.querySelectorAll("text")]
				.map((t) => t.textContent)
				.filter((t): t is string => !!t && /^-?[\d.]+$/.test(t))
				.map(Number)
		seed({
			x: { ...DEFAULT_AXIS_CONFIG, histogram: { enabled: true, binCount: 4, mode: "count" } },
			y: { ...DEFAULT_AXIS_CONFIG, max: 50 },
		})
		const { container } = mount()
		// Natural count max is ~6; pinning max=50 must push the axis up.
		expect(Math.max(...numericTicks(container))).toBeGreaterThanOrEqual(50)
	})

	it("shifts the bins to start at a pinned min (binned-axis min)", () => {
		const binLabels = (c: HTMLElement) =>
			[...c.querySelectorAll("text")]
				.map((t) => t.textContent)
				.filter((t): t is string => !!t && t.includes("–"))
		// Data is 1..20; pinning min=10 must drop the lower bins and start the
		// first bin at 10.
		seed({
			x: {
				...DEFAULT_AXIS_CONFIG,
				min: 10,
				histogram: { enabled: true, binCount: 5, mode: "count" },
			},
		})
		const labels = binLabels(mount().container)
		expect(labels[0]).toMatch(/^10 –/)
		expect(labels.some((l) => l.startsWith("0 –"))).toBe(false)
	})

	it("shows empty bins below the data when min is pinned beneath it", () => {
		const binLabels = (c: HTMLElement) =>
			[...c.querySelectorAll("text")]
				.map((t) => t.textContent)
				.filter((t): t is string => !!t && t.includes("–"))
		// Data is 1..20; pinning min=-10 must extend the bins DOWN to -10 with
		// empty bins (the negative range has no rows) rather than dropping them.
		seed({
			x: {
				...DEFAULT_AXIS_CONFIG,
				min: -10,
				histogram: { enabled: true, binCount: 4, mode: "count" },
			},
		})
		const labels = binLabels(mount().container)
		expect(labels[0]).toMatch(/^-10 –/)
	})

	it("honors the bin-count control (round edges → exact here)", () => {
		// 1..20 with target 2 snaps to a step of 10 → bins 0–10, 10–20.
		seed(histogramConfig(2))
		const { container } = mount()
		expect(markRects(container)).toHaveLength(2)
	})

	it("makes bar heights reflect the row count per bin", () => {
		// 1..20 over round bins 0–5/5–10/10–15/15–20 → counts 4/5/5/6, so the
		// last (tallest) bar exceeds the first.
		seed(histogramConfig(4))
		const { container } = mount()
		const heights = markRects(container).map((r) => r.height)
		expect(heights).toHaveLength(4)
		for (const h of heights) expect(h).toBeGreaterThan(0)
		expect(heights[3]!).toBeGreaterThan(heights[0]!)
	})

	it("draws histogram bars that touch (zero padding)", () => {
		seed(histogramConfig(4))
		const { container } = mount()
		const rects = markRects(container)
		for (let i = 0; i < rects.length - 1; i++) {
			const gap = rects[i + 1]!.x - (rects[i]!.x + rects[i]!.width)
			expect(Math.abs(gap)).toBeLessThan(0.5)
		}
	})

	it("density mode renders the same bins, scaled to a 0–1 axis (shorter bars)", () => {
		// Density rescales counts to shares (≤1) on a 0–1 axis, so the tallest
		// bar is much shorter than in count mode (where it fills the axis).
		seed(histogramConfig(4, "count"))
		const countTallest = Math.max(
			...markRects(mount().container).map((r) => r.height)
		)
		seed(histogramConfig(4, "density"))
		const densityRects = markRects(mount().container)
		expect(densityRects).toHaveLength(4)
		const densityTallest = Math.max(...densityRects.map((r) => r.height))
		expect(densityTallest).toBeGreaterThan(0)
		expect(densityTallest).toBeLessThan(countTallest)
	})

	it("stays a scatter (no count bars) when the histogram toggle is off", () => {
		// A lone quantitative variable with no toggle is a strip/scatter plot,
		// not a histogram — so the bars renderer doesn't produce mark rects.
		seed({})
		const { container } = mount()
		expect(markRects(container)).toHaveLength(0)
	})
})
