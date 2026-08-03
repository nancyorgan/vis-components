import { describe, expect, it } from "vitest"
import { newCircle } from "./annotationsConfig"
import {
	computeCirclePixels,
	computePolarCirclePixels,
} from "./circleAnnotationGeometry"
import { makePositionScale } from "./scales"

const inner = { x: 100, y: 50, width: 400, height: 200 }
const noScales = {
	xScale: null,
	yScale: null,
	xType: null,
	yType: null,
}

describe("computeCirclePixels — percent mode", () => {
	it("places the center via plot-area-normalized coords (y flipped)", () => {
		const circle = newCircle("c1") // center (0.5, 0.5), radius 0.2, axis x
		const geo = computeCirclePixels(circle, inner, noScales)
		expect(geo).not.toBeNull()
		// cx = x + width * 0.5 = 100 + 200 = 300
		expect(geo?.cx).toBe(300)
		// cy = y + height * (1 - 0.5) = 50 + 100 = 150
		expect(geo?.cy).toBe(150)
	})

	it("scales radius off the x-axis extent (inner.width)", () => {
		const circle = { ...newCircle("c1"), radius: 0.25, radiusAxis: "x" as const }
		const geo = computeCirclePixels(circle, inner, noScales)
		// r = width * 0.25 = 100
		expect(geo?.r).toBe(100)
	})

	it("scales radius off the y-axis extent (inner.height) when axis=y", () => {
		const circle = { ...newCircle("c1"), radius: 0.25, radiusAxis: "y" as const }
		const geo = computeCirclePixels(circle, inner, noScales)
		// r = height * 0.25 = 50
		expect(geo?.r).toBe(50)
	})

	it("respects a non-centered center with the bottom-up y convention", () => {
		const circle = {
			...newCircle("c1"),
			centerX: 0.25,
			centerY: 0, // bottom of plot
			radius: 0.1,
		}
		const geo = computeCirclePixels(circle, inner, noScales)
		expect(geo?.cx).toBe(100 + 400 * 0.25) // 200
		expect(geo?.cy).toBe(50 + 200) // bottom edge = y + height = 250
	})
})

describe("computeCirclePixels — values mode", () => {
	// x domain 0..100 over pixel range [100, 500]: 4 px per unit.
	const xScale = makePositionScale([0, 100], "quantitative", [
		inner.x,
		inner.x + inner.width,
	])
	// y domain 0..50 over INVERTED range [250, 50]: 4 px per unit.
	const yScale = makePositionScale([0, 50], "quantitative", [
		inner.y + inner.height,
		inner.y,
	])
	const ctx = {
		xScale,
		yScale,
		xType: "quantitative" as const,
		yType: "quantitative" as const,
	}

	it("maps the center through the x/y scales", () => {
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: 50,
			centerY: 25,
			radius: 10,
			radiusAxis: "x" as const,
		}
		const geo = computeCirclePixels(circle, inner, ctx)
		// xScale(50): domain niced to [0,100] → midpoint 300
		expect(geo?.cx).toBeCloseTo(300, 5)
		// yScale(25): midpoint of inverted range → 150
		expect(geo?.cy).toBeCloseTo(150, 5)
	})

	it("converts a data-unit radius through the chosen x-axis scale", () => {
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: 50,
			centerY: 25,
			radius: 10,
			radiusAxis: "x" as const,
		}
		const geo = computeCirclePixels(circle, inner, ctx)
		// 10 units * 4 px/unit = 40 px
		expect(geo?.r).toBeCloseTo(40, 5)
	})

	it("uses the y-axis scale for radius when radiusAxis=y", () => {
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: 50,
			centerY: 25,
			radius: 10,
			radiusAxis: "y" as const,
		}
		const geo = computeCirclePixels(circle, inner, ctx)
		// y scale is also 4 px/unit (50 units over 200 px) → 40, magnitude
		expect(geo?.r).toBeCloseTo(40, 5)
	})

	it("skips (returns null) when a values-mode radius can't be expressed on a categorical axis", () => {
		const catScale = makePositionScale(["a", "b", "c"], "categorical", [
			inner.x,
			inner.x + inner.width,
		])
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: "b",
			centerY: 25,
			radius: 1,
			radiusAxis: "x" as const,
		}
		const geo = computeCirclePixels(circle, inner, {
			xScale: catScale,
			yScale,
			xType: "categorical",
			yType: "quantitative",
		})
		expect(geo).toBeNull()
	})
})

describe("computePolarCirclePixels — radar values mode", () => {
	const center = { cx: 300, cy: 200 }
	// Angle: 0 rad = 12 o'clock, clockwise. "north" at top, "east" at 3 o'clock.
	const angleScale = (raw: unknown): number | null => {
		if (raw === "north") return 0
		if (raw === "east") return Math.PI / 2
		return null
	}
	// r: 1 px per unit (rScale(v) = v).
	const rScale = (raw: unknown): number | null => {
		const n = typeof raw === "number" ? raw : Number(raw)
		return Number.isFinite(n) ? n : null
	}

	it("places the center via the angle + r scales (0 rad = 12 o'clock)", () => {
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: "north", // angle value
			centerY: 50, // r value → 50 px from center, straight up
			radius: 10,
		}
		const geo = computePolarCirclePixels(circle, {
			angleScale,
			rScale,
			center,
			rType: "quantitative",
		})
		expect(geo?.cx).toBeCloseTo(300, 5) // sin(0)=0 → no horizontal offset
		expect(geo?.cy).toBeCloseTo(150, 5) // cos(0)=1 → 50 px up from cy=200
		// radius: rScale(60) − rScale(50) = 10 px
		expect(geo?.r).toBeCloseTo(10, 5)
	})

	it("offsets along the angle (east = 3 o'clock)", () => {
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: "east",
			centerY: 50,
			radius: 5,
		}
		const geo = computePolarCirclePixels(circle, {
			angleScale,
			rScale,
			center,
			rType: "quantitative",
		})
		expect(geo?.cx).toBeCloseTo(350, 5) // sin(π/2)=1 → 50 px right
		expect(geo?.cy).toBeCloseTo(200, 5) // cos(π/2)=0 → level with center
		expect(geo?.r).toBeCloseTo(5, 5)
	})

	it("returns null when the angle value is unknown", () => {
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: "nowhere",
			centerY: 50,
			radius: 5,
		}
		expect(
			computePolarCirclePixels(circle, {
				angleScale,
				rScale,
				center,
				rType: "quantitative",
			})
		).toBeNull()
	})

	it("returns null when the r-axis is categorical (data-unit radius undefined)", () => {
		const circle = {
			...newCircle("c1"),
			coordSystem: "values" as const,
			centerX: "north",
			centerY: 50,
			radius: 5,
		}
		expect(
			computePolarCirclePixels(circle, {
				angleScale,
				rScale,
				center,
				rType: "categorical",
			})
		).toBeNull()
	})
})
