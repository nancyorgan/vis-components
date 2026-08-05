import { interpolateRdBu } from "d3-scale-chromatic"
import { describe, expect, it } from "vitest"

import { DEFAULT_QUANTITATIVE_HUE_CONFIG } from "./channelConfig"
import {
	CATEGORICAL_HUE_PALETTE,
	applyAreaScale,
	applyHueScale,
	autoDivergingMid,
	makeAreaScale,
	makeHueScale,
	makePositionScale,
	outlinePaletteForHueType,
} from "./scales"

describe("makeHueScale (categorical)", () => {
	it("maps each unique value to a distinct color from the palette", () => {
		const hs = makeHueScale(["A", "B", "C"], "categorical")
		if (hs.kind !== "categorical") throw new Error("expected categorical scale")
		const a = hs.scale("A")
		const b = hs.scale("B")
		const c = hs.scale("C")
		expect(new Set([a, b, c]).size).toBe(3)
		expect(a).toBe(CATEGORICAL_HUE_PALETTE[0])
		expect(b).toBe(CATEGORICAL_HUE_PALETTE[1])
		expect(c).toBe(CATEGORICAL_HUE_PALETTE[2])
	})

	it("maps a single unique value to palette[0]", () => {
		const hs = makeHueScale(["A", "A", "A"], "categorical")
		if (hs.kind !== "categorical") throw new Error("expected categorical scale")
		expect(hs.scale("A")).toBe(CATEGORICAL_HUE_PALETTE[0])
	})

	it("regression: makeHueScale(['A','B','C'])('B') differs from makeHueScale(['B'])('B')", () => {
		// Documents why useAestheticScales must call makeHueScale with the full
		// dataset's values, never a facet-filtered subset. A filtered subset
		// would shift "B" from palette[1] to palette[0], making colors
		// inconsistent across facet panels.
		const fullHs = makeHueScale(["A", "B", "C"], "categorical")
		const filteredHs = makeHueScale(["B"], "categorical")
		if (fullHs.kind !== "categorical" || filteredHs.kind !== "categorical") {
			throw new Error("expected categorical scales")
		}
		expect(fullHs.scale("B")).not.toBe(filteredHs.scale("B"))
		expect(fullHs.scale("B")).toBe(CATEGORICAL_HUE_PALETTE[1])
		expect(filteredHs.scale("B")).toBe(CATEGORICAL_HUE_PALETTE[0])
	})
})

describe("autoDivergingMid", () => {
	it("returns 0 when the domain spans 0", () => {
		expect(autoDivergingMid(-10, 30)).toBe(0)
	})
	it("returns the domain midpoint when the data is one-signed", () => {
		expect(autoDivergingMid(10, 30)).toBe(20)
		expect(autoDivergingMid(-30, -10)).toBe(-20)
	})
})

describe("makeHueScale (quantitative diverging)", () => {
	const divergingCfg = {
		...DEFAULT_QUANTITATIVE_HUE_CONFIG,
		palette: "customDiverging" as const,
		lowColor: "#0000ff",
		midColor: "#ffffff",
		highColor: "#ff0000",
	}

	it("customDiverging: auto mid sits at 0 when the data spans 0", () => {
		const hs = makeHueScale([-10, 30], "quantitative", divergingCfg)
		expect(applyHueScale(hs, 0, "quantitative")).toBe("rgb(255, 255, 255)")
		// The domain midpoint (10) is no longer the neutral center.
		expect(applyHueScale(hs, 10, "quantitative")).not.toBe(
			"rgb(255, 255, 255)",
		)
	})

	it("customDiverging: auto mid falls back to the domain midpoint for one-signed data", () => {
		const hs = makeHueScale([10, 30], "quantitative", divergingCfg)
		expect(applyHueScale(hs, 20, "quantitative")).toBe("rgb(255, 255, 255)")
	})

	it("customDiverging: an explicit midValue wins over the 0 default", () => {
		const hs = makeHueScale([-10, 30], "quantitative", {
			...divergingCfg,
			midValue: 5,
		})
		expect(applyHueScale(hs, 5, "quantitative")).toBe("rgb(255, 255, 255)")
	})

	it("diverging presets center on 0 when the data spans it", () => {
		const hs = makeHueScale([-10, 30], "quantitative", {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "RdBu" as const,
		})
		expect(hs.kind).toBe("diverging")
		expect(applyHueScale(hs, 0, "quantitative")).toBe(interpolateRdBu(0.5))
	})

	it("diverging presets stay sequential over one-signed data", () => {
		const hs = makeHueScale([10, 30], "quantitative", {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "RdBu" as const,
		})
		expect(hs.kind).toBe("sequential")
	})

	it("linear presets never divert, even over sign-spanning data", () => {
		const hs = makeHueScale([-10, 30], "quantitative", {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "viridis" as const,
		})
		expect(hs.kind).toBe("sequential")
	})
})

describe("makeHueScale — custom gradient interpolation", () => {
	const linearCfg = {
		...DEFAULT_QUANTITATIVE_HUE_CONFIG,
		palette: "customLinear" as const,
		lowColor: "#ff0000",
		highColor: "#0000ff",
	}

	it("defaults to rgb — absent field keeps the historical midpoint", () => {
		const hs = makeHueScale([0, 10], "quantitative", linearCfg)
		// d3 interpolateRgb midpoint of red→blue: the dark sRGB purple.
		expect(applyHueScale(hs, 5, "quantitative")).toBe("rgb(128, 0, 128)")
	})

	it("oklch blends perceptually — midpoint differs from the sRGB purple", () => {
		const hs = makeHueScale([0, 10], "quantitative", {
			...linearCfg,
			interpolation: "oklch" as const,
		})
		const mid = applyHueScale(hs, 5, "quantitative")
		expect(mid).not.toBe("rgb(128, 0, 128)")
		expect(mid).toMatch(/^#[0-9a-f]{6}$/)
		// Endpoints still resolve to the configured stop colors.
		expect(applyHueScale(hs, 0, "quantitative")).toBe("#ff0000")
		expect(applyHueScale(hs, 10, "quantitative")).toBe("#0000ff")
	})

	it("hsb rotates through hue — red→yellow midpoint is orange", () => {
		const hs = makeHueScale([0, 10], "quantitative", {
			...linearCfg,
			highColor: "#ffff00",
			interpolation: "hsb" as const,
		})
		expect(applyHueScale(hs, 5, "quantitative")).toBe("#ff8000")
	})

	it("interpolation applies to manual customStops gradients too", () => {
		const hs = makeHueScale([0, 10], "quantitative", {
			...DEFAULT_QUANTITATIVE_HUE_CONFIG,
			palette: "custom" as const,
			customStops: [
				{ color: "#ff0000", value: null },
				{ color: "#ffff00", value: null },
			],
			interpolation: "hsb" as const,
		})
		expect(applyHueScale(hs, 5, "quantitative")).toBe("#ff8000")
	})
})

describe("makeAreaScale — sizeBy", () => {
	// Domain [0, 100] → range [0, 10] px so the exponent's effect is easy
	// to read off: the quarter-way value lands at half the radius under √
	// (area-true) and at a quarter of the radius under linear (diameter).
	const values = ["0", "100"]
	const cfg = { minRadius: 0, maxRadius: 10 }

	it("defaults to area-true sizing (radius grows with √value)", () => {
		const areaScale = makeAreaScale(values, "quantitative", cfg)
		if (areaScale.kind !== "numeric") throw new Error("expected numeric scale")
		expect(areaScale.scale(25)).toBeCloseTo(5)
		expect(areaScale.scale(100)).toBeCloseTo(10)
	})

	it("'diameter' drives the radius linearly (exaggerated)", () => {
		const areaScale = makeAreaScale(values, "quantitative", {
			...cfg,
			sizeBy: "diameter",
		})
		if (areaScale.kind !== "numeric") throw new Error("expected numeric scale")
		expect(areaScale.scale(25)).toBeCloseTo(2.5)
		expect(areaScale.scale(100)).toBeCloseTo(10)
	})
})

describe("makeAreaScale — non-numeric ordinal", () => {
	const values = ["low", "med", "high", "low", "high"]
	const cfg = { minRadius: 4, maxRadius: 16 }

	it("spreads distinct categories evenly across [minRadius, maxRadius] (first → min, last → max)", () => {
		const areaScale = makeAreaScale(values, "ordinal", cfg)
		expect(areaScale.kind).toBe("ordinal")
		// 3 categories → even steps over [4,16]: 4, 10, 16
		expect(applyAreaScale(areaScale, "low", "ordinal")).toBeCloseTo(4)
		expect(applyAreaScale(areaScale, "med", "ordinal")).toBeCloseTo(10)
		expect(applyAreaScale(areaScale, "high", "ordinal")).toBeCloseTo(16)
	})

	it("ignores sizeBy — rank order has no magnitude, so the spread stays even", () => {
		const areaTrue = makeAreaScale(values, "ordinal", cfg)
		const diameter = makeAreaScale(values, "ordinal", { ...cfg, sizeBy: "diameter" })
		expect(applyAreaScale(areaTrue, "med", "ordinal")).toBeCloseTo(10)
		expect(applyAreaScale(diameter, "med", "ordinal")).toBeCloseTo(10)
	})

	it("per-category overrides win over the auto spread", () => {
		const areaScale = makeAreaScale(values, "ordinal", {
			...cfg,
			overrides: { med: 30 },
		})
		expect(applyAreaScale(areaScale, "med", "ordinal")).toBe(30)
		expect(applyAreaScale(areaScale, "low", "ordinal")).toBeCloseTo(4)
	})

	it("returns null for a category absent from the training values", () => {
		const areaScale = makeAreaScale(values, "ordinal", cfg)
		expect(applyAreaScale(areaScale, "unseen", "ordinal")).toBeNull()
	})

	it("numeric ordinals stay continuous (size by value, not by category rank)", () => {
		const areaScale = makeAreaScale(["0", "100"], "ordinal", {
			minRadius: 0,
			maxRadius: 10,
			sizeBy: "diameter",
		})
		if (areaScale.kind !== "numeric") throw new Error("expected numeric scale")
		expect(areaScale.scale(50)).toBeCloseTo(5)
	})
})

describe("makePositionScale — categorical with firstTickPxOffset", () => {
	/** With `padding(0.5)` (the default), first-tick position depends on
	 *  range size AND N — exactly the math that produces the facet
	 *  title-to-first-tick drift bug. With `firstTickPxOffset` set, the
	 *  position is FIXED. These tests pin both behaviors so a future
	 *  refactor can't silently flip the contract. */

	it("default behavior: first-tick position depends on N (current d3 padding(0.5))", () => {
		// Range size 100, N=2 → step = 50, first at 25 (range[0] + 0.5*step).
		const s2 = makePositionScale(
			["A", "B"],
			"categorical",
			[0, 100]
		) as ReturnType<typeof makePositionScale> & {
			(v: string): number
		}
		expect(s2("A")).toBe(25)

		// Same range size, N=5 → step = 20, first at 10.
		const s5 = makePositionScale(
			["A", "B", "C", "D", "E"],
			"categorical",
			[0, 100]
		) as typeof s2
		expect(s5("A")).toBe(10)

		// Confirms the bug: same range, different first-tick.
		expect(s2("A")).not.toBe(s5("A"))
	})

	it("with firstTickPxOffset=12: first tick lands at offset from range[0] regardless of N", () => {
		const s2 = makePositionScale(
			["A", "B"],
			"categorical",
			[0, 100],
			undefined,
			{ firstTickPxOffset: 12 }
		) as ReturnType<typeof makePositionScale> & {
			(v: string): number
		}
		const s5 = makePositionScale(
			["A", "B", "C", "D", "E"],
			"categorical",
			[0, 100],
			undefined,
			{ firstTickPxOffset: 12 }
		) as typeof s2

		expect(s2("A")).toBe(12)
		expect(s5("A")).toBe(12)
		// First tick is CONSTANT across N — this is the property the
		// facet-title fix relies on.
		expect(s2("A")).toBe(s5("A"))
	})

	it("with firstTickPxOffset=12: LAST tick lands at range[1] minus offset, regardless of N", () => {
		const s2 = makePositionScale(
			["A", "B"],
			"categorical",
			[0, 100],
			undefined,
			{ firstTickPxOffset: 12 }
		) as ReturnType<typeof makePositionScale> & { (v: string): number }
		const s5 = makePositionScale(
			["A", "B", "C", "D", "E"],
			"categorical",
			[0, 100],
			undefined,
			{ firstTickPxOffset: 12 }
		) as typeof s2

		expect(s2("B")).toBe(88) // last of 2
		expect(s5("E")).toBe(88) // last of 5
	})

	it("with firstTickPxOffset on a SINGLE-category scale: the only tick lands at range[0] + offset", () => {
		// N=1 is the case that surfaced the bug — under padding(0.5),
		// the single point goes to the middle of the range.
		const s = makePositionScale(["only"], "categorical", [0, 100], undefined, {
			firstTickPxOffset: 12,
		}) as ReturnType<typeof makePositionScale> & { (v: string): number }
		expect(s("only")).toBe(12)
	})

	it("with firstTickPxOffset and a REVERSED range (y-axis convention), inset is still inward", () => {
		// range[0]=100 (bottom of plot, large y) > range[1]=0 (top, small y).
		// First-listed category should land near range[0] (bottom) at
		// 100 - 12 = 88, last near range[1] at 0 + 12 = 12.
		const s = makePositionScale(
			["first", "second"],
			"categorical",
			[100, 0],
			undefined,
			{ firstTickPxOffset: 12 }
		) as ReturnType<typeof makePositionScale> & { (v: string): number }
		expect(s("first")).toBe(88)
		expect(s("second")).toBe(12)
	})

	it("firstTickPxOffset=0 is a no-op (falls through to default padding behavior)", () => {
		const sDefault = makePositionScale(
			["A", "B"],
			"categorical",
			[0, 100]
		) as ReturnType<typeof makePositionScale> & { (v: string): number }
		const sZero = makePositionScale(
			["A", "B"],
			"categorical",
			[0, 100],
			undefined,
			{ firstTickPxOffset: 0 }
		) as typeof sDefault
		expect(sZero("A")).toBe(sDefault("A"))
		expect(sZero("B")).toBe(sDefault("B"))
	})

	it("quantitative scales ignore firstTickPxOffset (no categorical anchoring needed)", () => {
		const s = makePositionScale([0, 100], "quantitative", [0, 100], undefined, {
			firstTickPxOffset: 12,
		}) as ReturnType<typeof makePositionScale> & { (v: number): number }
		// Linear scale: 0 maps to 0, 100 maps to 100. No inset.
		expect(s(0)).toBe(0)
		expect(s(100)).toBe(100)
	})
})

describe("makePositionScale — numeric ordinal edge padding", () => {
	/*  Numeric-ordinal axes use a linear scale, but should still leave a
	 *  little breathing room before the first value and after the last —
	 *  the same half-step (R / 2N) outer padding a categorical scalePoint
	 *  gets — instead of butting the extremes against the plot edges. */
	it("insets the linear range by half a step so first/last don't touch edges", () => {
		const s = makePositionScale([1, 2, 3, 4, 5], "ordinal", [0, 100]) as ReturnType<
			typeof makePositionScale
		> & { (v: number): number }
		// 5 distinct values → halfStep = 100 / (2*5) = 10 → range [10, 90].
		expect(s(1)).toBe(10)
		expect(s(5)).toBe(90)
		expect(s(3)).toBe(50)
	})

	it("honors firstTickPxOffset for faceted numeric-ordinal axes", () => {
		const s = makePositionScale(
			[1, 2, 3],
			"ordinal",
			[0, 100],
			undefined,
			{ firstTickPxOffset: 12 }
		) as ReturnType<typeof makePositionScale> & { (v: number): number }
		expect(s(1)).toBe(12)
		expect(s(3)).toBe(88)
	})

	it("insets inward on a reversed range (y-axis convention)", () => {
		const s = makePositionScale([1, 2, 3, 4, 5], "ordinal", [100, 0]) as ReturnType<
			typeof makePositionScale
		> & { (v: number): number }
		// halfStep = 10 → reversed range insets to [90, 10].
		expect(s(1)).toBe(90)
		expect(s(5)).toBe(10)
	})
})

describe("outlinePaletteForHueType", () => {
	const fill = ["#f1", "#f2"]
	const fillOrdinal = ["#o1", "#o2"]
	const outline = ["#x1", "#x2"]
	const outlineOrdinal = ["#xo1", "#xo2"]

	it("uses outline's own categorical palette when set", () => {
		expect(
			outlinePaletteForHueType("categorical", {
				categoricalPalette: fill,
				outlineCategoricalPalette: outline,
			})
		).toBe(outline)
	})

	it("falls back to the fill categorical palette when outline has no palette (pre-picker default)", () => {
		expect(
			outlinePaletteForHueType("categorical", { categoricalPalette: fill })
		).toBe(fill)
	})

	it("prefers the outline ordinal palette for ordinal fields", () => {
		expect(
			outlinePaletteForHueType("ordinal", {
				categoricalPalette: fill,
				ordinalPalette: fillOrdinal,
				outlineCategoricalPalette: outline,
				outlineOrdinalPalette: outlineOrdinal,
			})
		).toBe(outlineOrdinal)
	})

	it("ordinal falls back outline-categorical → fill-ordinal → fill-categorical", () => {
		// No outline ordinal → outline categorical wins.
		expect(
			outlinePaletteForHueType("ordinal", {
				categoricalPalette: fill,
				ordinalPalette: fillOrdinal,
				outlineCategoricalPalette: outline,
			})
		).toBe(outline)
		// No outline palettes at all → fill ordinal.
		expect(
			outlinePaletteForHueType("ordinal", {
				categoricalPalette: fill,
				ordinalPalette: fillOrdinal,
			})
		).toBe(fillOrdinal)
		// Only a fill categorical palette → that.
		expect(
			outlinePaletteForHueType("ordinal", { categoricalPalette: fill })
		).toBe(fill)
	})
})

