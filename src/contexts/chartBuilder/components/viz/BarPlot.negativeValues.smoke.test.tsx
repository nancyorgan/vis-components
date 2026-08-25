import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Negative measures used to render as nothing: the measure axis floored at
 *  zero, so a below-zero slice clamped to a zero-height rect. Bars now point
 *  the other way off the zero baseline. These mount the production render
 *  path (ChartCanvas → PlotCanvas → BarPlot) and measure the mark rects. */

const DATASET_ID = "ds-bar-negative"

// Every category mixes a positive and a negative series, so each band has a
// bar on both sides of the zero baseline.
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "bars",
		filename: "bars.csv",
		fields: [
			{ name: "category", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
			{ name: "series", inferredType: "categorical" },
		],
		rows: [
			{ category: "A", value: "10", series: "x" },
			{ category: "A", value: "-6", series: "y" },
			{ category: "B", value: "-4", series: "x" },
			{ category: "B", value: "8", series: "y" },
		],
	})

const seed = ({ horizontal = false }: { horizontal?: boolean } = {}) => {
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
			// bars-x puts categories on x; bars-y on y (measure runs horizontally).
			[horizontal ? "y" : "x"]: { field: "category" },
			length: { field: "value" },
			hue: { field: "series" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		// Grouped, not stacked: one bar per series so each sign gets its own
		// mark and the assertions below can read them independently.
		JSON.stringify({ hue: { stackMode: "group" } })
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

/** Mark rects only — the stroke attribute is what separates a bar slice from
 *  the chart's background / chrome rects. */
const markRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.filter((r) => r.getAttribute("stroke") !== null)
		.map((r) => ({
			x: Number(r.getAttribute("x")),
			y: Number(r.getAttribute("y")),
			w: Number(r.getAttribute("width")),
			h: Number(r.getAttribute("height")),
		}))

/** The value shared by the most mark edges along one axis. With every bar
 *  anchored at zero, that's the zero baseline — each rect contributes exactly
 *  one edge to it (its bottom if positive, its top if negative). */
const commonEdge = (edges: number[]): { value: number; count: number } => {
	const tally = new Map<number, number>()
	for (const e of edges) {
		const key = Math.round(e * 100) / 100
		tally.set(key, (tally.get(key) ?? 0) + 1)
	}
	let best = { value: 0, count: 0 }
	for (const [value, count] of tally)
		if (count > best.count) best = { value, count }
	return best
}

describe("BarPlot — negative measures", () => {
	it("vertical bars: negative values draw a real rect instead of collapsing", () => {
		seed()
		const { container } = mount()
		const rects = markRects(container)
		expect(rects).toHaveLength(4)
		for (const r of rects) expect(r.h).toBeGreaterThan(0)
	})

	it("vertical bars: every bar starts at the shared zero baseline", () => {
		seed()
		const { container } = mount()
		const rects = markRects(container)
		// Each rect touches zero with exactly one edge — positives with their
		// bottom, negatives with their top.
		const zero = commonEdge(rects.flatMap((r) => [r.y, r.y + r.h]))
		expect(zero.count).toBe(4)
		const above = rects.filter((r) => r.y + r.h <= zero.value + 0.01)
		const below = rects.filter((r) => r.y >= zero.value - 0.01)
		expect(above).toHaveLength(2)
		expect(below).toHaveLength(2)
	})

	it("vertical bars: bar length stays proportional to magnitude", () => {
		seed()
		const { container } = mount()
		const rects = markRects(container)
		const zero = commonEdge(rects.flatMap((r) => [r.y, r.y + r.h])).value
		// Values 10 / -6 / -4 / 8 → heights in that same ratio, regardless of
		// which side of the baseline each bar sits on.
		const heights = [...rects].sort((a, b) => a.x - b.x).map((r) => r.h)
		const perUnit = heights[0] / 10
		expect(heights[1]).toBeCloseTo(6 * perUnit, 1)
		expect(heights[2]).toBeCloseTo(4 * perUnit, 1)
		expect(heights[3]).toBeCloseTo(8 * perUnit, 1)
		// The -6 bar hangs below zero; the 10 bar rises above it.
		const tallest = rects.find((r) => r.h === Math.max(...heights))
		expect(tallest && tallest.y + tallest.h).toBeCloseTo(zero, 1)
	})

	it("horizontal bars: negative values draw leftward from the baseline", () => {
		seed({ horizontal: true })
		const { container } = mount()
		const rects = markRects(container)
		expect(rects).toHaveLength(4)
		for (const r of rects) expect(r.w).toBeGreaterThan(0)
		const zero = commonEdge(rects.flatMap((r) => [r.x, r.x + r.w]))
		expect(zero.count).toBe(4)
		// Two bars end at the baseline (negative, drawn leftward) and two
		// start from it (positive, drawn rightward).
		expect(
			rects.filter((r) => r.x + r.w <= zero.value + 0.01)
		).toHaveLength(2)
		expect(rects.filter((r) => r.x >= zero.value - 0.01)).toHaveLength(2)
	})

	it("all-positive data keeps the zero-floored axis (no regression)", () => {
		const store = installInMemoryLocalStorage()
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set(
			"vis-components:datasets",
			JSON.stringify({
				[DATASET_ID]: buildDatasetFixture({
					id: DATASET_ID,
					name: "bars",
					filename: "bars.csv",
					fields: [
						{ name: "category", inferredType: "categorical" },
						{ name: "value", inferredType: "quantitative" },
					],
					rows: [
						{ category: "A", value: "10" },
						{ category: "B", value: "5" },
					],
				}),
			})
		)
		store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set(
			"vis-components:currentEncodings",
			JSON.stringify({
				...emptyEncodings(),
				x: { field: "category" },
				length: { field: "value" },
			})
		)
		store.set("vis-components:currentChannelConfigs", JSON.stringify({}))
		store.set(
			"vis-components:currentLabels",
			JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
		)
		/* eslint-enable @th/use-wrapped-json-functions */
		const { container } = mount()
		const rects = markRects(container)
		expect(rects).toHaveLength(2)
		// Both bars sit on one baseline and the taller one is twice the other.
		const bottoms = rects.map((r) => r.y + r.h)
		expect(bottoms[0]).toBeCloseTo(bottoms[1], 1)
		const [tall, short] = [...rects].sort((a, b) => b.h - a.h)
		expect(tall.h).toBeCloseTo(short.h * 2, 1)
	})
})
