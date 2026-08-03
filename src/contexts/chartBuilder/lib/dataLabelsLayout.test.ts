import { describe, expect, it } from "vitest"

import {
	CHAR_WIDTH_RATIO,
	estimateDataLabelMargins,
	keepLastPerSeries,
	labelHeight,
	labelWidth,
	nudgeOverlaps,
	sampleConnectionPointIndices,
	selectEndpointsPerSeries,
	type LabelBox,
} from "./dataLabelsLayout"

const lb = (
	overrides: Partial<LabelBox> & Pick<LabelBox, "index">
): LabelBox => ({
	cx: 0,
	cy: 0,
	text: "abc",
	fontSize: 10,
	series: "",
	...overrides,
})

describe("labelWidth / labelHeight", () => {
	it("scales width by character count and font size (linear in both)", () => {
		const a = lb({ index: 0, text: "abc", fontSize: 10 })
		const b = lb({ index: 0, text: "abcdef", fontSize: 10 })
		expect(labelWidth(b)).toBeCloseTo(labelWidth(a) * 2)
	})

	it("uses the documented CHAR_WIDTH_RATIO so renderer-side estimates stay in sync", () => {
		// Locks the constant so a future tweak (say, switching to 0.55) still
		// reads consistently across helper + UI.
		expect(labelWidth(lb({ index: 0, text: "x", fontSize: 10 }))).toBeCloseTo(
			10 * CHAR_WIDTH_RATIO
		)
	})

	it("height is proportional to font size, not text length", () => {
		expect(labelHeight(lb({ index: 0, fontSize: 12 }))).toBeCloseTo(13.2)
		expect(
			labelHeight(lb({ index: 0, text: "very long text here", fontSize: 12 }))
		).toBeCloseTo(13.2)
	})

	it("width of a wrapped label is its longest line, not the whole string", () => {
		// "aaaa\nbb" → longest line is 4 chars, not 7 (6 letters + newline).
		expect(
			labelWidth(lb({ index: 0, text: "aaaa\nbb", fontSize: 10 }))
		).toBeCloseTo(4 * 10 * CHAR_WIDTH_RATIO)
	})

	it("height of a wrapped label grows one line per newline segment", () => {
		// Three lines at fontSize 12 → 3 * 13.2.
		expect(
			labelHeight(lb({ index: 0, text: "a\nb\nc", fontSize: 12 }))
		).toBeCloseTo(3 * 13.2)
	})
})

describe("keepLastPerSeries", () => {
	it("keeps the rightmost (largest cx) anchor per series", () => {
		// Three rows for series "A", three for series "B", interleaved.
		// Position (cx) — not index — drives the ordering: in real data
		// the rows are often unsorted but the visual "last" is always
		// the rightmost cx.
		const boxes: LabelBox[] = [
			{ cx: 10, cy: 0, text: "a-mid", fontSize: 10, series: "A", index: 0 },
			{ cx: 5, cy: 0, text: "b-mid", fontSize: 10, series: "B", index: 1 },
			{
				cx: 30,
				cy: 0,
				text: "a-rightmost",
				fontSize: 10,
				series: "A",
				index: 2,
			},
			{
				cx: 25,
				cy: 0,
				text: "b-rightmost",
				fontSize: 10,
				series: "B",
				index: 3,
			},
			{ cx: 20, cy: 0, text: "a-middle", fontSize: 10, series: "A", index: 4 },
		]
		const out = keepLastPerSeries(boxes)
		// `a-rightmost` (cx=30) wins for series A even though it's NOT
		// the highest index — that's the regression fix for line charts
		// where row order doesn't match cx order.
		const labels = out.map((b) => b.text).sort()
		expect(labels).toEqual(["a-rightmost", "b-rightmost"].sort())
	})

	it("with axis='y', keeps the bottom-most (largest cy) anchor per series — for horizontal bar charts", () => {
		// Horizontal bars put the category axis on y, so "last category"
		// = largest cy. Without the axis="y" hint, the helper would pick
		// the largest-measure slice instead of the last category.
		const boxes: LabelBox[] = [
			{ cx: 5, cy: 10, text: "a-top", fontSize: 10, series: "A", index: 0 },
			{
				cx: 100,
				cy: 20,
				text: "a-bigval-mid",
				fontSize: 10,
				series: "A",
				index: 1,
			},
			{ cx: 30, cy: 50, text: "a-bottom", fontSize: 10, series: "A", index: 2 },
		]
		const out = keepLastPerSeries(boxes, "y")
		expect(out.map((b) => b.text)).toEqual(["a-bottom"])
	})

	it("ties on primary axis: tiebreak on perpendicular axis", () => {
		// Stacked bar slices share the same cx (one category column). The
		// "last" slice should be the one nearest the visual end of the
		// stack — the lowest cy in a vertical chart (highest stack
		// position), or the highest cy if the stack grows downward. The
		// helper just picks the larger perpendicular value; callers can
		// adapt by reversing input order if they need the other end.
		const boxes: LabelBox[] = [
			{ cx: 100, cy: 50, text: "bottom", fontSize: 10, series: "S", index: 0 },
			{ cx: 100, cy: 30, text: "middle", fontSize: 10, series: "S", index: 1 },
			{ cx: 100, cy: 10, text: "top", fontSize: 10, series: "S", index: 2 },
		]
		// All cx tied; tiebreak picks the largest cy (bottom).
		const out = keepLastPerSeries(boxes)
		expect(out.map((b) => b.text)).toEqual(["bottom"])
	})

	it("treats anchors with no series key as one implicit 'unsorted' group", () => {
		// When neither hue nor connection is mapped, we still want "only show
		// last" to render exactly one label rather than silently emitting
		// zero. The empty-string series gives us that single-survivor behavior.
		const boxes: LabelBox[] = [
			{ cx: 5, cy: 0, text: "x", fontSize: 10, series: "", index: 0 },
			{
				cx: 30,
				cy: 0,
				text: "y-rightmost",
				fontSize: 10,
				series: "",
				index: 1,
			},
			{ cx: 15, cy: 0, text: "z", fontSize: 10, series: "", index: 2 },
		]
		expect(keepLastPerSeries(boxes).map((b) => b.text)).toEqual(["y-rightmost"])
	})

	it("is a no-op for 0- and 1-element lists", () => {
		expect(keepLastPerSeries([])).toEqual([])
		const single: LabelBox[] = [
			{ cx: 0, cy: 0, text: "only", fontSize: 10, series: "", index: 0 },
		]
		expect(keepLastPerSeries(single)).toEqual(single)
	})
})

describe("selectEndpointsPerSeries", () => {
	it("tags each series' leftmost box 'first' and rightmost 'last' (position, not index)", () => {
		const boxes: LabelBox[] = [
			{ cx: 10, cy: 0, text: "a-mid", fontSize: 10, series: "A", index: 0 },
			{ cx: 5, cy: 0, text: "b-first", fontSize: 10, series: "B", index: 1 },
			{ cx: 30, cy: 0, text: "a-last", fontSize: 10, series: "A", index: 2 },
			{ cx: 25, cy: 0, text: "b-last", fontSize: 10, series: "B", index: 3 },
			// Leftmost for A despite the HIGHEST index — position drives it.
			{ cx: 2, cy: 0, text: "a-first", fontSize: 10, series: "A", index: 4 },
		]
		const tags = selectEndpointsPerSeries(boxes)
		const byText = new Map(
			[...tags.entries()].map(([b, t]) => [b.text, t] as const)
		)
		expect(byText.get("a-first")).toBe("first")
		expect(byText.get("a-last")).toBe("last")
		expect(byText.get("b-first")).toBe("first")
		expect(byText.get("b-last")).toBe("last")
		// Interior anchors are absent from the map entirely.
		expect(byText.has("a-mid")).toBe(false)
	})

	it("with axis='y', ranks by cy — topmost 'first', bottom-most 'last'", () => {
		const boxes: LabelBox[] = [
			{ cx: 100, cy: 20, text: "mid", fontSize: 10, series: "A", index: 0 },
			{ cx: 5, cy: 10, text: "top", fontSize: 10, series: "A", index: 1 },
			{ cx: 30, cy: 50, text: "bottom", fontSize: 10, series: "A", index: 2 },
		]
		const tags = selectEndpointsPerSeries(boxes, "y")
		const byText = new Map(
			[...tags.entries()].map(([b, t]) => [b.text, t] as const)
		)
		expect(byText.get("top")).toBe("first")
		expect(byText.get("bottom")).toBe("last")
	})

	it("ties on the primary axis break on the perpendicular axis, then index", () => {
		// All cx tied (stacked slices in one category): largest cy is "last",
		// smallest is "first" — mirroring keepLastPerSeries' comparator.
		const boxes: LabelBox[] = [
			{ cx: 100, cy: 50, text: "bottom", fontSize: 10, series: "S", index: 0 },
			{ cx: 100, cy: 30, text: "middle", fontSize: 10, series: "S", index: 1 },
			{ cx: 100, cy: 10, text: "top", fontSize: 10, series: "S", index: 2 },
		]
		const tags = selectEndpointsPerSeries(boxes)
		const byText = new Map(
			[...tags.entries()].map(([b, t]) => [b.text, t] as const)
		)
		expect(byText.get("bottom")).toBe("last")
		expect(byText.get("top")).toBe("first")
	})

	it("empty series keys form one implicit group", () => {
		const boxes: LabelBox[] = [
			{ cx: 5, cy: 0, text: "first", fontSize: 10, series: "", index: 0 },
			{ cx: 30, cy: 0, text: "last", fontSize: 10, series: "", index: 1 },
			{ cx: 15, cy: 0, text: "mid", fontSize: 10, series: "", index: 2 },
		]
		const tags = selectEndpointsPerSeries(boxes)
		expect(tags.size).toBe(2)
		const byText = new Map(
			[...tags.entries()].map(([b, t]) => [b.text, t] as const)
		)
		expect(byText.get("first")).toBe("first")
		expect(byText.get("last")).toBe("last")
	})

	it("a single-anchor series tags 'both'", () => {
		const boxes: LabelBox[] = [
			{ cx: 5, cy: 0, text: "solo", fontSize: 10, series: "A", index: 0 },
			{ cx: 1, cy: 0, text: "b1", fontSize: 10, series: "B", index: 1 },
			{ cx: 9, cy: 0, text: "b2", fontSize: 10, series: "B", index: 2 },
		]
		const tags = selectEndpointsPerSeries(boxes)
		const byText = new Map(
			[...tags.entries()].map(([b, t]) => [b.text, t] as const)
		)
		expect(byText.get("solo")).toBe("both")
	})

	it("keepLastPerSeries delegates: 'last' + 'both' survive, matching its old behavior", () => {
		const boxes: LabelBox[] = [
			{ cx: 5, cy: 0, text: "a1", fontSize: 10, series: "A", index: 0 },
			{ cx: 30, cy: 0, text: "a2", fontSize: 10, series: "A", index: 1 },
			{ cx: 7, cy: 0, text: "solo", fontSize: 10, series: "B", index: 2 },
		]
		expect(keepLastPerSeries(boxes).map((b) => b.text)).toEqual(["a2", "solo"])
	})
})

describe("nudgeOverlaps", () => {
	it("leaves non-overlapping boxes untouched", () => {
		// Two labels far apart on x — no collision, no nudging.
		const boxes: LabelBox[] = [
			{ cx: 0, cy: 0, text: "a", fontSize: 10, series: "", index: 0 },
			{ cx: 200, cy: 0, text: "b", fontSize: 10, series: "", index: 1 },
		]
		const out = nudgeOverlaps(boxes)
		expect(out[0].cy).toBe(0)
		expect(out[1].cy).toBe(0)
	})

	it("separates colliding labels vertically, splitting the displacement between them", () => {
		// Two labels at the same position. They should end up at least one
		// full label height apart (sum of the two half-heights) — and the
		// least-displacement solve balances the pair around the shared
		// anchor rather than making the second label absorb the whole shift.
		const boxes: LabelBox[] = [
			{ cx: 0, cy: 0, text: "a", fontSize: 10, series: "", index: 0 },
			{ cx: 0, cy: 0, text: "a", fontSize: 10, series: "", index: 1 },
		]
		const out = nudgeOverlaps(boxes)
		expect(out[1].cy - out[0].cy).toBeGreaterThanOrEqual(labelHeight(boxes[0]))
		expect(out[0].cy).toBeLessThan(0)
		expect(out[1].cy).toBeGreaterThan(0)
	})

	it("moves a label UP when its anchor sits above its collider's (end-of-line stack)", () => {
		// User-reported: line-chart end labels. Medicare Advantage's line ends
		// ABOVE Direct Purchase's, but the old down-only sweep (input = data
		// order, not spatial order) rammed its label below Direct Purchase —
		// then cascaded Medicare Traditional under CHIP, two lines away from
		// its own anchor. The stack solve must keep anchor order: labels above
		// stay above, and a label with free space overhead moves up into it.
		const two = "12% Medicare\nAdvantage" // 2-line wrapped label
		const boxes: LabelBox[] = [
			{ cx: 865, cy: 565, text: "9% Direct Purchase", fontSize: 16, series: "dp", index: 0 },
			{ cx: 865, cy: 543, text: two, fontSize: 16, series: "ma", index: 1 },
			{ cx: 865, cy: 566, text: "9% Medicare\nTraditional", fontSize: 16, series: "mt", index: 2 },
			{ cx: 865, cy: 639, text: "2% CHIP", fontSize: 16, series: "chip", index: 3 },
		]
		const out = nudgeOverlaps(boxes)
		const cy = (series: string): number =>
			(out.find((b) => b.series === series) as LabelBox).cy
		// Anchor order preserved: MA above DP above MT above CHIP.
		expect(cy("ma")).toBeLessThan(cy("dp"))
		expect(cy("dp")).toBeLessThan(cy("mt"))
		expect(cy("mt")).toBeLessThan(cy("chip"))
		// MA moved up from its anchor into the free space above the cluster.
		expect(cy("ma")).toBeLessThan(543)
		// CHIP had no conflict below the cluster and stays on its anchor.
		expect(cy("chip")).toBeCloseTo(639)
		// And nothing overlaps: neighbors sit at least their half-height sum apart.
		const sorted = [...out].sort((a, b) => a.cy - b.cy)
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i].cy - sorted[i - 1].cy).toBeGreaterThanOrEqual(
				labelHeight(sorted[i]) / 2 + labelHeight(sorted[i - 1]) / 2
			)
		}
	})

	it("reserves the taller footprint for a wrapped (multi-line) label", () => {
		// A label wrapped to two lines is taller than its single-line form, so
		// the colliding label below must be pushed down further. Encode the
		// wrap as `\n` in `text` (matching how DataLabelsLayer feeds the pass).
		const single: LabelBox[] = [
			{ cx: 0, cy: 0, text: "hello world", fontSize: 10, series: "", index: 0 },
			{ cx: 0, cy: 0, text: "x", fontSize: 10, series: "", index: 1 },
		]
		const wrapped: LabelBox[] = [
			{ cx: 0, cy: 0, text: "hello\nworld", fontSize: 10, series: "", index: 0 },
			{ cx: 0, cy: 0, text: "x", fontSize: 10, series: "", index: 1 },
		]
		const singleGap = nudgeOverlaps(single)[1].cy
		const wrappedGap = nudgeOverlaps(wrapped)[1].cy
		expect(wrappedGap).toBeGreaterThan(singleGap)
	})

	it("does not over-separate on the narrower width of a wrapped label", () => {
		// Two wrapped labels offset horizontally by more than their longest
		// line but less than the unwrapped string: with wrap-aware width they
		// no longer overlap, so neither is nudged.
		const boxes: LabelBox[] = [
			{ cx: 0, cy: 0, text: "aaaa\nbbbb", fontSize: 10, series: "", index: 0 },
			{ cx: 40, cy: 0, text: "aaaa\nbbbb", fontSize: 10, series: "", index: 1 },
		]
		// Longest line = 4 chars → width 4*10*0.6 = 24px; centers 40px apart
		// clear each other (24/2 + 24/2 = 24 < 40).
		const out = nudgeOverlaps(boxes)
		expect(out[1].cy).toBe(0)
	})

	it("two labels nudged below the same collider don't stack on each other (float tangency)", () => {
		// Regression: user's line chart had three wrapped end-of-line labels
		// clustered near the bottom (cys from the real chart). The 2nd and 3rd
		// each collided with the 1st and were nudged to EXACT tangency below
		// it — but the resulting gap float-computes to 35.19999999999999
		// (< 35.2), so the strict `<` overlap test kept re-firing against the
		// 1st box with dy ≈ 1e-14 until the safety bound ran out. Both labels
		// exited at the identical cy, fully overlapping each other. The
		// clearance in the nudge makes each iteration definitively clear its
		// collider, so the 3rd label goes on to resolve against the 2nd.
		const wrapped = "0.0827 Medicare\nAdvantage"
		const boxes: LabelBox[] = [
			{ cx: 865, cy: 493.478, text: wrapped, fontSize: 16, series: "a", index: 0 },
			{ cx: 865, cy: 500.667, text: wrapped, fontSize: 16, series: "b", index: 1 },
			{ cx: 865, cy: 516.072, text: wrapped, fontSize: 16, series: "c", index: 2 },
		]
		const out = nudgeOverlaps(boxes)
		const h = labelHeight(boxes[0])
		for (let i = 0; i < out.length; i++) {
			for (let j = i + 1; j < out.length; j++) {
				expect(Math.abs(out[i].cy - out[j].cy)).toBeGreaterThanOrEqual(h)
			}
		}
	})

	it("preserves the input array (no mutation)", () => {
		// Regression guard: mutating the caller's array would silently change
		// chart anchors elsewhere on the page. The helper returns a fresh
		// copy.
		const boxes: LabelBox[] = [
			{ cx: 0, cy: 0, text: "a", fontSize: 10, series: "", index: 0 },
			{ cx: 0, cy: 0, text: "a", fontSize: 10, series: "", index: 1 },
		]
		nudgeOverlaps(boxes)
		expect(boxes[1].cy).toBe(0)
	})
})

describe("estimateDataLabelMargins", () => {
	it("returns all zeros when labels are disabled (no padding cost)", () => {
		const out = estimateDataLabelMargins({
			enabled: false,
			xOffset: 50,
			yOffset: -30,
			fontSize: 12,
		})
		expect(out).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
	})

	it("returns ZERO when the offset is within the chart's base margin (no chart-shift)", () => {
		// User-reported regression: dialing a small offset visibly shifted
		// the chart instead of moving the labels. Cause: estimate added
		// margin even for offsets that fit in the existing BASE_MARGIN
		// reserve (24px right, 76px left, 16px top, 64px bottom). Now
		// the helper only requests EXTRA margin for offsets that exceed
		// those built-in reserves.
		const small = estimateDataLabelMargins({
			enabled: true,
			xOffset: 20, // well within BASE_RIGHT (24)
			yOffset: -10, // well within BASE_TOP (16)
			fontSize: 12,
		})
		expect(small).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
	})

	it("only adds margin for the PORTION of the offset that exceeds the base reserve", () => {
		// xOffset 50 → 50 - BASE_RIGHT (24) = 26 of extra right margin.
		// yOffset -100 → 100 - BASE_TOP (16) = 84 of extra top margin.
		const out = estimateDataLabelMargins({
			enabled: true,
			xOffset: 50,
			yOffset: -100,
			fontSize: 12,
		})
		expect(out.right).toBe(26)
		expect(out.top).toBe(84)
		expect(out.left).toBe(0)
		expect(out.bottom).toBe(0)
	})

	it("zero offsets produce zero margins (no padding when not nudged)", () => {
		const out = estimateDataLabelMargins({
			enabled: true,
			xOffset: 0,
			yOffset: 0,
			fontSize: 12,
		})
		expect(out).toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
	})
})

describe("sampleConnectionPointIndices", () => {
	it("returns every index for 'all'", () => {
		expect(sampleConnectionPointIndices(5, "all", 1)).toEqual([0, 1, 2, 3, 4])
	})

	it("'first-only' / 'last-only' / 'first-and-last' return the named anchors", () => {
		expect(sampleConnectionPointIndices(5, "first-only", 1)).toEqual([0])
		expect(sampleConnectionPointIndices(5, "last-only", 1)).toEqual([4])
		expect(sampleConnectionPointIndices(5, "first-and-last", 1)).toEqual([0, 4])
	})

	it("'every-n' walks by stride and ALWAYS includes the last index even when stride doesn't land on it", () => {
		// 10 points, stride 3 → walks 0, 3, 6, 9. Already lands on last.
		expect(sampleConnectionPointIndices(10, "every-n", 3)).toEqual([0, 3, 6, 9])
		// 10 points, stride 4 → walks 0, 4, 8. Last anchor (9) is added on
		// top so endpoints stay visible. Without this anchor, dense-point
		// lines lose their visual end-of-line marker.
		expect(sampleConnectionPointIndices(10, "every-n", 4)).toEqual([0, 4, 8, 9])
	})

	it("clamps fractional or zero strides to 1 (every point)", () => {
		// Defensive: the panel input could theoretically push 0 or 0.5
		// through; the helper coerces it to a valid step instead of dividing
		// by zero or producing duplicate indices.
		expect(sampleConnectionPointIndices(4, "every-n", 0)).toEqual([0, 1, 2, 3])
		expect(sampleConnectionPointIndices(4, "every-n", 0.5)).toEqual([
			0, 1, 2, 3,
		])
	})

	it("handles the 0- and 1-point edge cases without throwing", () => {
		expect(sampleConnectionPointIndices(0, "all", 1)).toEqual([])
		expect(sampleConnectionPointIndices(1, "all", 1)).toEqual([0])
		expect(sampleConnectionPointIndices(1, "first-and-last", 1)).toEqual([0])
	})
})
