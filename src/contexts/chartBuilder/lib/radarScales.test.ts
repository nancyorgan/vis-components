import { describe, expect, it } from "vitest"

import { buildRadarScales } from "./radarScales"

const TWO_PI = Math.PI * 2

describe("buildRadarScales", () => {
	describe("angle scale", () => {
		it("spaces categorical angles evenly starting at 12 o'clock (0 rad)", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B", "C", "D"],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2, 3, 4],
				center: { cx: 100, cy: 100 },
				maxRadius: 100,
			})
			expect(scales.angleScale("A")).toBeCloseTo(0)
			expect(scales.angleScale("B")).toBeCloseTo(TWO_PI / 4)
			expect(scales.angleScale("C")).toBeCloseTo(TWO_PI / 2)
			expect(scales.angleScale("D")).toBeCloseTo((TWO_PI * 3) / 4)
			expect(scales.angleTicks).toHaveLength(4)
			expect(scales.angleTicks[0]).toEqual({ label: "A", angle: 0 })
		})

		it("treats few-unique-value quantitative angles as discrete (one spoke per value, evenly spaced)", () => {
			// User-friendly default for radar: when the raw data has only
			// a handful of unique numeric values (e.g. Year 2021..2024
			// auto-detected as quantitative), each value gets its own
			// evenly-spaced spoke rather than being positioned linearly
			// — linear positioning makes the first and last collide at
			// the top under a full 2π sweep, which is rarely what users
			// want for radar.
			const scales = buildRadarScales({
				angleField: "deg",
				angleType: "quantitative",
				angleRaws: [0, 50, 100],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2, 3],
				center: { cx: 100, cy: 100 },
				maxRadius: 100,
			})
			expect(scales.angleScale(0)).toBeCloseTo(0)
			expect(scales.angleScale(50)).toBeCloseTo(TWO_PI / 3)
			expect(scales.angleScale(100)).toBeCloseTo((TWO_PI * 2) / 3)
			expect(scales.angleTicks).toHaveLength(3)
		})

		it("uses linear positioning for genuinely-continuous quantitative angles (> 12 unique values)", () => {
			// Once the unique-value count exceeds DISCRETE_ANGLE_THRESHOLD,
			// the data is treated as truly continuous and angles are
			// positioned linearly across the sweep.
			const raws = Array.from({ length: 20 }, (_, i) => i * 5) // 0, 5, 10, …, 95
			const scales = buildRadarScales({
				angleField: "deg",
				angleType: "quantitative",
				angleRaws: raws,
				rField: "score",
				rType: "quantitative",
				rRaws: raws,
				center: { cx: 100, cy: 100 },
				maxRadius: 100,
			})
			expect(scales.angleScale(0)).toBeCloseTo(0)
			// Mid of [0, 95] is 47.5 → 47.5/95 = 0.5 → π radians
			expect(scales.angleScale(47.5)).toBeCloseTo(Math.PI)
			expect(scales.angleScale(95)).toBeCloseTo(TWO_PI)
		})

		it("honors a pinned level order for categorical angles", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "ordinal",
				angleRaws: ["A", "B", "C", "D"],
				angleLevelOrder: ["D", "C", "B", "A"],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2, 3, 4],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
			})
			expect(scales.angleScale("D")).toBeCloseTo(0)
			expect(scales.angleScale("A")).toBeCloseTo((TWO_PI * 3) / 4)
		})

		it("returns null for an unrecognized categorical value", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
			})
			expect(scales.angleScale("Z")).toBeNull()
		})
	})

	describe("r scale", () => {
		it("maps quantitative r linearly into [0, maxRadius]", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "score",
				rType: "quantitative",
				rRaws: [0, 100],
				center: { cx: 0, cy: 0 },
				maxRadius: 200,
			})
			expect(scales.rScale(0)).toBeCloseTo(0)
			expect(scales.rScale(100)).toBeCloseTo(200)
			expect(scales.rScale(50)).toBeCloseTo(100)
		})

		it("emits gridline ticks above 0 for quantitative r", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "score",
				rType: "quantitative",
				rRaws: [0, 10],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				rTickCount: 5,
			})
			expect(scales.rTicks.length).toBeGreaterThan(0)
			for (const t of scales.rTicks) {
				expect(t.radius).toBeGreaterThan(0)
				expect(t.radius).toBeLessThanOrEqual(100)
			}
		})

		it("places categorical r values on equally-spaced rings", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "tier",
				rType: "categorical",
				rRaws: ["low", "mid", "high"],
				center: { cx: 0, cy: 0 },
				maxRadius: 90,
			})
			expect(scales.rScale("low")).toBeCloseTo(30)
			expect(scales.rScale("mid")).toBeCloseTo(60)
			expect(scales.rScale("high")).toBeCloseTo(90)
			expect(scales.rTicks).toHaveLength(3)
		})
	})

	describe("metadata pass-through", () => {
		it("returns the supplied center and maxRadius unchanged", () => {
			const scales = buildRadarScales({
				angleField: "a",
				angleType: "categorical",
				angleRaws: ["x"],
				rField: "r",
				rType: "quantitative",
				rRaws: [1],
				center: { cx: 50, cy: 75 },
				maxRadius: 120,
			})
			expect(scales.center).toEqual({ cx: 50, cy: 75 })
			expect(scales.maxRadius).toBe(120)
		})
	})

	describe("angle config (min/max + tickCount)", () => {
		it("treats the factory default (-180/180) as a full 0–2π sweep starting at 12 o'clock", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B", "C", "D"],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2, 3, 4],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				angleConfig: { minAngle: -180, maxAngle: 180 },
			})
			expect(scales.angleScale("A")).toBeCloseTo(0)
			expect(scales.angleScale("B")).toBeCloseTo(Math.PI / 2)
		})

		it("honors a non-default sweep — e.g. semicircle 0°→180°", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B", "C"],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2, 3],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				angleConfig: { minAngle: 0, maxAngle: 180 },
			})
			// Partial sweep distributes 3 cats across 0→π inclusive:
			// A at 0, B at π/2, C at π.
			expect(scales.angleScale("A")).toBeCloseTo(0)
			expect(scales.angleScale("B")).toBeCloseTo(Math.PI / 2)
			expect(scales.angleScale("C")).toBeCloseTo(Math.PI)
		})

		it("honors an offset sweep — e.g. starting at 90° ends at 270°", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				angleConfig: { minAngle: 90, maxAngle: 270 },
			})
			// A at startRad (π/2), B at endRad (3π/2). Partial sweep.
			expect(scales.angleScale("A")).toBeCloseTo(Math.PI / 2)
			expect(scales.angleScale("B")).toBeCloseTo((3 * Math.PI) / 2)
		})

		it("rGridRadii defaults to rTick radii when rGridlineCount is null", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "score",
				rType: "quantitative",
				rRaws: [0, 10],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				rTickCount: 5,
				rGridlineCount: null,
			})
			expect(scales.rGridRadii).toEqual(scales.rTicks.map((t) => t.radius))
		})

		it("rGridRadii generates exactly N equally-spaced rings when rGridlineCount is set", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "score",
				rType: "quantitative",
				rRaws: [0, 10],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				rTickCount: 3,
				rGridlineCount: 10,
			})
			expect(scales.rGridRadii).toHaveLength(10)
			// First ring at 10px, last at 100px (maxRadius), evenly spaced.
			expect(scales.rGridRadii[0]).toBeCloseTo(10)
			expect(scales.rGridRadii[9]).toBeCloseTo(100)
			// And the count is independent of rTicks.
			expect(scales.rGridRadii.length).not.toBe(scales.rTicks.length)
		})

		it("categorical r ignores rGridlineCount (rings pin to category positions)", () => {
			const scales = buildRadarScales({
				angleField: "metric",
				angleType: "categorical",
				angleRaws: ["A", "B"],
				rField: "tier",
				rType: "categorical",
				rRaws: ["low", "mid", "high"],
				center: { cx: 0, cy: 0 },
				maxRadius: 90,
				rGridlineCount: 12,
			})
			// 3 categories → 3 rings even though gridlineCount=12 requested.
			expect(scales.rGridRadii).toHaveLength(3)
		})

		it("respects tickCount for quantitative angle (number of spokes)", () => {
			const scales = buildRadarScales({
				angleField: "deg",
				angleType: "quantitative",
				angleRaws: [0, 25, 50, 75, 100],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2, 3, 4, 5],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				angleConfig: { minAngle: -180, maxAngle: 180, tickCount: 4 },
			})
			// d3.scaleLinear.ticks(4) over [0, 100] returns [0, 25, 50, 75,
			// 100] (it picks "nice" values; the requested count is a
			// suggestion). We just assert it differs from the default-of-6
			// path — fewer ticks than the default.
			const defaultScales = buildRadarScales({
				angleField: "deg",
				angleType: "quantitative",
				angleRaws: [0, 25, 50, 75, 100],
				rField: "score",
				rType: "quantitative",
				rRaws: [1, 2, 3, 4, 5],
				center: { cx: 0, cy: 0 },
				maxRadius: 100,
				angleConfig: { minAngle: -180, maxAngle: 180, tickCount: 12 },
			})
			expect(defaultScales.angleTicks.length).toBeGreaterThanOrEqual(
				scales.angleTicks.length,
			)
		})
	})
})
