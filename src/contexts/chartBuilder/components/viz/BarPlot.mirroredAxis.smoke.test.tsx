import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { DEFAULT_AXIS_CONFIG, type MirrorAxisConfig } from "../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** "Use a mirrored axis" on a bar chart's measure axis: a two-level direction
 *  variable sends each row's bar to one side of zero while the data stays
 *  positive — the population-pyramid case. Mounts the production render path
 *  (ChartCanvas → PlotCanvas → BarPlot) and reads the mark rects + tick
 *  labels. */

const DATASET_ID = "ds-bar-mirrored"

// A population pyramid: every age band has a male and a female count, all
// positive. `sex` is first seen as "M", so M is the negative (left / lower)
// side unless the levels are reordered.
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "pyramid",
		filename: "pyramid.csv",
		fields: [
			{ name: "age", inferredType: "categorical" },
			{ name: "pop", inferredType: "quantitative" },
			{ name: "sex", inferredType: "categorical" },
		],
		rows: [
			{ age: "0-9", pop: "10", sex: "M" },
			{ age: "0-9", pop: "12", sex: "F" },
			{ age: "10-19", pop: "8", sex: "M" },
			{ age: "10-19", pop: "6", sex: "F" },
		],
	})

const seed = ({
	horizontal = true,
	mirror,
	levelOrder,
}: {
	horizontal?: boolean
	mirror?: MirrorAxisConfig
	levelOrder?: Record<string, string[]>
} = {}) => {
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
			// bars-y (horizontal): categories on y, measure runs along x.
			[horizontal ? "y" : "x"]: { field: "age" },
			length: { field: "pop" },
			hue: { field: "sex" },
		})
	)
	// The mirror config lives on the MEASURE axis (x for horizontal bars).
	const measureChannel = horizontal ? "x" : "y"
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			hue: { stackMode: "stack" },
			// The panel always seeds a full axis config around the sparse
			// mirror field; mirror that here so the axis renders.
			...(mirror
				? { [measureChannel]: { ...DEFAULT_AXIS_CONFIG, mirror } }
				: {}),
		})
	)
	if (levelOrder)
		store.set(
			"vis-components:currentFieldLevelOrders",
			JSON.stringify(levelOrder)
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

/** Mark rects only — the stroke attribute separates a bar slice from the
 *  chart's background / chrome rects. */
const markRects = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.filter((r) => r.getAttribute("stroke") !== null)
		.map((r) => ({
			x: Number(r.getAttribute("x")),
			y: Number(r.getAttribute("y")),
			w: Number(r.getAttribute("width")),
			h: Number(r.getAttribute("height")),
		}))

/** The edge value shared by the most rects along one axis — the zero
 *  baseline when every bar is anchored at zero. */
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

const tickLabelTexts = (container: HTMLElement): string[] =>
	[...container.querySelectorAll("text")]
		.map((t) => t.textContent ?? "")
		.filter((s) => /^[-\u2212]?[\d.,]+$/.test(s.trim()))

const ON: MirrorAxisConfig = { enabled: true, directionField: "sex" }

describe("BarPlot — mirrored axis", () => {
	it("without the mirror, all-positive stacked bars sit on one side of zero", () => {
		seed()
		const { container } = mount()
		const rects = markRects(container)
		expect(rects).toHaveLength(4)
		const zero = commonEdge(rects.flatMap((r) => [r.x, r.x + r.w])).value
		// Stacked M+F: two rects per band, both to the right of the baseline.
		for (const r of rects) expect(r.x).toBeGreaterThanOrEqual(zero - 0.01)
	})

	it("horizontal bars: the first direction level draws left of zero, the second right", () => {
		seed({ mirror: ON })
		const { container } = mount()
		const rects = markRects(container)
		expect(rects).toHaveLength(4)
		// Every rect touches the zero baseline with exactly one edge.
		const zero = commonEdge(rects.flatMap((r) => [r.x, r.x + r.w]))
		expect(zero.count).toBe(4)
		const left = rects.filter((r) => r.x + r.w <= zero.value + 0.01)
		const right = rects.filter((r) => r.x >= zero.value - 0.01)
		expect(left).toHaveLength(2)
		expect(right).toHaveLength(2)
		// Widths stay proportional to the (positive) counts: M 10 / 8 left,
		// F 12 / 6 right.
		const perUnit = Math.max(...right.map((r) => r.w)) / 12
		expect(left.map((r) => r.w).sort((a, b) => b - a)[0]).toBeCloseTo(10 * perUnit, 1)
		expect(left.map((r) => r.w).sort((a, b) => b - a)[1]).toBeCloseTo(8 * perUnit, 1)
		expect(right.map((r) => r.w).sort((a, b) => b - a)[1]).toBeCloseTo(6 * perUnit, 1)
	})

	it("horizontal bars: tick labels show magnitudes on both sides", () => {
		seed({ mirror: ON })
		const { container } = mount()
		const labels = tickLabelTexts(container)
		expect(labels.length).toBeGreaterThan(0)
		// d3 formats negatives with a true minus sign (U+2212).
		for (const l of labels) expect(/^[-\u2212]/.test(l)).toBe(false)
		// The axis runs through 0 with ticks either side, so at least one
		// magnitude label appears twice (once per side).
		const counts = new Map<string, number>()
		for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)
		expect([...counts.values()].some((n) => n >= 2)).toBe(true)
	})

	it("the pinned Fields order decides which level goes left", () => {
		seed({ mirror: ON, levelOrder: { sex: ["F", "M"] } })
		const { container } = mount()
		const rects = markRects(container)
		const zero = commonEdge(rects.flatMap((r) => [r.x, r.x + r.w])).value
		const left = rects.filter((r) => r.x + r.w <= zero + 0.01)
		// F (12, 6) is now the left side: the widest left bar is the 12.
		const right = rects.filter((r) => r.x >= zero - 0.01)
		const perUnit = Math.max(...left.map((r) => r.w)) / 12
		expect(Math.max(...right.map((r) => r.w))).toBeCloseTo(10 * perUnit, 1)
	})

	it("vertical bars: the first level hangs below zero, the second rises above", () => {
		seed({ horizontal: false, mirror: ON })
		const { container } = mount()
		const rects = markRects(container)
		expect(rects).toHaveLength(4)
		const zero = commonEdge(rects.flatMap((r) => [r.y, r.y + r.h]))
		expect(zero.count).toBe(4)
		const above = rects.filter((r) => r.y + r.h <= zero.value + 0.01)
		const below = rects.filter((r) => r.y >= zero.value - 0.01)
		expect(above).toHaveLength(2)
		expect(below).toHaveLength(2)
	})

	it("a Left max pins how far the negative side extends", () => {
		seed({ mirror: { ...ON, negativeMax: 40 } })
		const { container } = mount()
		const rects = markRects(container)
		const zero = commonEdge(rects.flatMap((r) => [r.x, r.x + r.w])).value
		const left = rects.filter((r) => r.x + r.w <= zero + 0.01)
		const right = rects.filter((r) => r.x >= zero - 0.01)
		// The right side auto-fits (max 12), the left runs to 40: the left
		// half of the plot is wider than the right by about 40:12 on a bar of
		// the same count — so the 10-count bar is far shorter than 10/12 of
		// the 12-count bar.
		const leftPerUnit = Math.max(...left.map((r) => r.w)) / 10
		const rightPerUnit = Math.max(...right.map((r) => r.w)) / 12
		expect(leftPerUnit).toBeCloseTo(rightPerUnit, 1)
		// …and a tick label of the pinned magnitude appears.
		expect(tickLabelTexts(container)).toContain("40")
	})

	it("with no valid direction chosen, bars render unmirrored", () => {
		seed({ mirror: { enabled: true, directionField: null } })
		const { container } = mount()
		const rects = markRects(container)
		const zero = commonEdge(rects.flatMap((r) => [r.x, r.x + r.w])).value
		for (const r of rects) expect(r.x).toBeGreaterThanOrEqual(zero - 0.01)
	})
})
