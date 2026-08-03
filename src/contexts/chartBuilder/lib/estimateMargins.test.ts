import { describe, expect, it } from "vitest"

import {
	estimateExtraBottomMargin,
	estimateExtraLeftMargin,
	estimateInteriorBottomChrome,
	estimateInteriorLeftChrome,
	estimateTextWidth,
} from "./estimateMargins"

describe("estimateTextWidth", () => {
	it("scales linearly with text length", () => {
		const w1 = estimateTextWidth("a", 12)
		const w10 = estimateTextWidth("aaaaaaaaaa", 12)
		// Allowing for the constant 4px base, the 10x string should be roughly
		// 10x larger than the 1-char string MINUS the constant.
		expect(w10 - 4).toBeCloseTo((w1 - 4) * 10, 0)
	})

	it("scales linearly with font size", () => {
		const w12 = estimateTextWidth("hello", 12) - 4
		const w24 = estimateTextWidth("hello", 24) - 4
		expect(w24 / w12).toBeCloseTo(2, 1)
	})

	it("returns the base constant for empty text", () => {
		expect(estimateTextWidth("", 12)).toBe(4)
	})
})

describe("estimateExtraLeftMargin", () => {
	it("returns 0 when no labels and no title", () => {
		expect(
			estimateExtraLeftMargin({
				yLabels: [],
				yLabelFontSize: 11,
				yTitleRotated: true,
				yTitleText: "",
				yTitleFontSize: 13,
			})
		).toBe(0)
	})

	it("returns 0 for short labels (default reserve is enough)", () => {
		expect(
			estimateExtraLeftMargin({
				yLabels: ["1", "2", "3", "4"],
				yLabelFontSize: 11,
				yTitleRotated: true,
				yTitleText: "Count",
				yTitleFontSize: 13,
			})
		).toBe(0)
	})

	it("grows for long category labels", () => {
		const extra = estimateExtraLeftMargin({
			yLabels: ["Cardiothoracic Surgery", "Neurology", "Orthopedics"],
			yLabelFontSize: 11,
			yTitleRotated: true,
			yTitleText: "Service Line",
			yTitleFontSize: 13,
		})
		expect(extra).toBeGreaterThan(60)
	})

	it("reserves more for horizontal y-axis title than rotated", () => {
		const horiz = estimateExtraLeftMargin({
			yLabels: ["X"],
			yLabelFontSize: 11,
			yTitleRotated: false,
			yTitleText: "Some long title here",
			yTitleFontSize: 13,
		})
		const rotated = estimateExtraLeftMargin({
			yLabels: ["X"],
			yLabelFontSize: 11,
			yTitleRotated: true,
			yTitleText: "Some long title here",
			yTitleFontSize: 13,
		})
		expect(horiz).toBeGreaterThan(rotated)
	})

	it("horizontal title with empty yLabels (quant axis) reserves enough for the tick-gap floor", () => {
		// User-reported bug: a non-faceted chart with quantitative y axis
		// and a horizontal y-title had the title overflow the SVG left
		// edge. Root cause: ScatterPlot passes `yLabels: []` for quant
		// axes (numeric ticks come from the scale at render time), so
		// the estimate's `labelPx` was ~4. But `Axes.tsx` positions the
		// horizontal title at `inner.x0 - dynamicGap` where dynamicGap
		// has a floor of `40 + tickFontSize` — bigger than what the
		// estimate reserved, so the title overflowed leftward.
		//
		// The fix floors the label-area allowance to that same value
		// for horizontal titles. This test pins the floor so a future
		// regression that drops it surfaces here.
		const fontSize = 12
		const titleText = "Average monthly revenue (USD)"
		const horiz = estimateExtraLeftMargin({
			yLabels: [],
			yLabelFontSize: fontSize,
			yTitleRotated: false,
			yTitleText: titleText,
			yTitleFontSize: 13,
		})
		// Lower bound: title width + the dynamicGap floor + breathing,
		// minus the base 76px. With this fix, the returned extra must be
		// LARGE ENOUGH that BASE_MARGIN.left (76) + extra accommodates
		// `(40 + fontSize) + titleWidth + breathing`.
		const titleWidthApprox = titleText.length * 13 * 0.55 + 4 // ~227
		const minExpected = 40 + fontSize + titleWidthApprox + 16 - 76 // ~219
		expect(horiz).toBeGreaterThanOrEqual(minExpected - 10) // 10px slack on heuristics
	})

	it("multi-line horizontal y-title reserves space for the widest line, not the full string length", () => {
		// User-reported: editing a long horizontal y-title to include
		// `\n` line breaks didn't reduce the reserved horizontal space.
		// Root cause: the estimate used the FULL string length via
		// `estimateTextWidth`, treating "Long\nTitle" as a single
		// 10-char line. The fix uses `estimateLongestLineWidth` which
		// splits on `\n` and uses the widest line — matching what
		// `renderMultilineTspans` actually draws (stacked tspans whose
		// bounding box is the widest line).
		const oneLine = estimateExtraLeftMargin({
			yLabels: ["X"],
			yLabelFontSize: 11,
			yTitleRotated: false,
			yTitleText: "Average monthly revenue per facility",
			yTitleFontSize: 13,
		})
		const broken = estimateExtraLeftMargin({
			yLabels: ["X"],
			yLabelFontSize: 11,
			yTitleRotated: false,
			yTitleText: "Average monthly\nrevenue per\nfacility",
			yTitleFontSize: 13,
		})
		// Breaking the title into shorter lines should reduce the
		// reserved width meaningfully. "Average monthly" is the widest
		// at 15 chars vs the 36-char single-line version.
		expect(broken).toBeLessThan(oneLine)
	})

	it("rotated title with empty yLabels does NOT get the floor allowance (no regression)", () => {
		// The floor only applies to horizontal titles — rotated ones are
		// only ~one fontSize wide, so the floor would over-reserve.
		const fontSize = 12
		const rotated = estimateExtraLeftMargin({
			yLabels: [],
			yLabelFontSize: fontSize,
			yTitleRotated: true,
			yTitleText: "Average monthly revenue (USD)",
			yTitleFontSize: 13,
		})
		// Rotated needed = labelPx (4) + (13 + 24) + 24 - 76 = -11 → 0.
		// Cap at 0 — we shouldn't have over-reserved here.
		expect(rotated).toBe(0)
	})
})

describe("estimateExtraBottomMargin", () => {
	it("returns 0 when no labels and no title", () => {
		expect(
			estimateExtraBottomMargin({
				xLabels: [],
				xLabelFontSize: 11,
				xLabelAngleDeg: 0,
				xTitleText: "",
				xTitleFontSize: 13,
				xTitleLineCount: 0,
			})
		).toBe(0)
	})

	it("returns >0 for short non-rotated labels WITH a title (default 64px is NOT enough)", () => {
		// Regression guard for user-reported May 2026 bug where the
		// x-axis title was clipping into the data table below. The
		// formula now includes TITLE_LABEL_GAP_PX so BASE_MARGIN.bottom
		// (64px) gets bumped up when a title is present.
		const extra = estimateExtraBottomMargin({
			xLabels: ["A", "B", "C"],
			xLabelFontSize: 11,
			xLabelAngleDeg: 0,
			xTitleText: "Label",
			xTitleFontSize: 13,
			xTitleLineCount: 1,
		})
		expect(extra).toBeGreaterThan(0)
	})

	it("returns 0 for short non-rotated labels WITHOUT a title", () => {
		expect(
			estimateExtraBottomMargin({
				xLabels: ["A", "B", "C"],
				xLabelFontSize: 11,
				xLabelAngleDeg: 0,
				xTitleText: "",
				xTitleFontSize: 13,
				xTitleLineCount: 0,
			})
		).toBe(0)
	})

	it("grows when labels are rotated 90°", () => {
		const noRotation = estimateExtraBottomMargin({
			xLabels: ["JanuaryFebruaryMarch", "AprilMay", "June"],
			xLabelFontSize: 11,
			xLabelAngleDeg: 0,
			xTitleText: "",
			xTitleFontSize: 13,
			xTitleLineCount: 0,
		})
		const rotated = estimateExtraBottomMargin({
			xLabels: ["JanuaryFebruaryMarch", "AprilMay", "June"],
			xLabelFontSize: 11,
			xLabelAngleDeg: 90,
			xTitleText: "",
			xTitleFontSize: 13,
			xTitleLineCount: 0,
		})
		expect(rotated).toBeGreaterThan(noRotation)
	})

	it("grows for multi-line titles", () => {
		const oneLine = estimateExtraBottomMargin({
			xLabels: ["A"],
			xLabelFontSize: 11,
			xLabelAngleDeg: 0,
			xTitleText: "Line 1",
			xTitleFontSize: 13,
			xTitleLineCount: 1,
		})
		const threeLines = estimateExtraBottomMargin({
			xLabels: ["A"],
			xLabelFontSize: 11,
			xLabelAngleDeg: 0,
			xTitleText: "Line 1\nLine 2\nLine 3",
			xTitleFontSize: 13,
			xTitleLineCount: 3,
		})
		expect(threeLines).toBeGreaterThan(oneLine)
	})
})

describe("wrapped (multi-line) tick labels", () => {
	// The "Wrap text" toggle pre-wraps tick labels into `\n`-joined strings
	// before they reach the estimators. Width math must use the widest LINE
	// (the rendered bounding box of stacked tspans); bottom-chrome math must
	// reserve one line-box per line.

	it("bottom margin reserves one line-box per wrapped line (unrotated)", () => {
		const single = estimateExtraBottomMargin({
			xLabels: ["Cardiothoracic", "Surgery"],
			xLabelFontSize: 11,
			xLabelAngleDeg: 0,
			xTitleText: "Specialty",
			xTitleFontSize: 13,
			xTitleLineCount: 1,
		})
		const wrapped = estimateExtraBottomMargin({
			xLabels: ["Cardiothoracic\nSurgery", "Internal\nMedicine"],
			xLabelFontSize: 11,
			xLabelAngleDeg: 0,
			xTitleText: "Specialty",
			xTitleFontSize: 13,
			xTitleLineCount: 1,
		})
		// Two stacked lines need one extra line-box (11 × 1.4 ≈ 15.4px).
		expect(wrapped - single).toBeCloseTo(11 * 1.4, 1)
	})

	it("left margin uses the widest LINE of a wrapped y-label, not the joined string", () => {
		const long = estimateExtraLeftMargin({
			yLabels: ["Cardiothoracic Surgery Department"],
			yLabelFontSize: 11,
			yTitleRotated: true,
			yTitleText: "",
			yTitleFontSize: 13,
		})
		const wrapped = estimateExtraLeftMargin({
			yLabels: ["Cardiothoracic\nSurgery\nDepartment"],
			yLabelFontSize: 11,
			yTitleRotated: true,
			yTitleText: "",
			yTitleFontSize: 13,
		})
		// Wrapping shrinks the horizontal claim to the widest line
		// ("Cardiothoracic", 14 chars vs 33 for the full string).
		expect(wrapped).toBeLessThan(long)
	})

	it("interior chrome mirrors the same multi-line rules", () => {
		const singleBottom = estimateInteriorBottomChrome({
			xLabels: ["Alpha"],
			xLabelFontSize: 10,
			xLabelAngleDeg: 0,
		})
		const wrappedBottom = estimateInteriorBottomChrome({
			xLabels: ["Alpha\nBeta\nGamma"],
			xLabelFontSize: 10,
			xLabelAngleDeg: 0,
		})
		expect(wrappedBottom - singleBottom).toBeCloseTo(2 * 10 * 1.4, 1)

		const longLeft = estimateInteriorLeftChrome({
			yLabels: ["A very long unwrapped label"],
			yLabelFontSize: 10,
		})
		const wrappedLeft = estimateInteriorLeftChrome({
			yLabels: ["A very long\nunwrapped label"],
			yLabelFontSize: 10,
		})
		expect(wrappedLeft).toBeLessThan(longLeft)
	})
})
