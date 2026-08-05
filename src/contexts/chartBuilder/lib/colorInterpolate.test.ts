import { rgb as d3Rgb } from "d3-color"
import { describe, expect, it } from "vitest"

import { gradientInterpolator } from "./colorInterpolate"

/** Per-channel |Δ| between two colors, in 0–255 units. */
const maxChannelDiff = (a: string, b: string): number => {
	const ca = d3Rgb(a)
	const cb = d3Rgb(b)
	return Math.max(
		Math.abs(ca.r - cb.r),
		Math.abs(ca.g - cb.g),
		Math.abs(ca.b - cb.b),
	)
}

describe("gradientInterpolator", () => {
	it("rgb (and absent) returns d3's interpolateRgb — historical behavior", () => {
		// Same factory object, so existing custom gradients render identically.
		expect(gradientInterpolator("rgb")).toBe(gradientInterpolator(undefined))
		const mid = gradientInterpolator(undefined)("#ff0000", "#0000ff")(0.5)
		// d3 interpolateRgb midpoint of red→blue is the muddy dark purple.
		expect(maxChannelDiff(mid, "#800080")).toBeLessThanOrEqual(1)
	})

	it("all spaces hit the endpoint colors at t=0 and t=1 (±1/255 rounding)", () => {
		const pairs: [string, string][] = [
			["#ff0000", "#0000ff"],
			["#0d0887", "#f0f921"],
			["#ffffff", "#000000"],
			["#336699", "#99cc33"],
		]
		for (const space of ["rgb", "hsb", "oklch"] as const) {
			for (const [a, b] of pairs) {
				const f = gradientInterpolator(space)(a, b)
				expect(maxChannelDiff(f(0), a)).toBeLessThanOrEqual(1)
				expect(maxChannelDiff(f(1), b)).toBeLessThanOrEqual(1)
			}
		}
	})

	it("hsb: red→yellow passes through orange (hue takes the short arc)", () => {
		const mid = gradientInterpolator("hsb")("#ff0000", "#ffff00")(0.5)
		// Hue 0° → 60° midpoint is 30° at full sat/brightness: pure orange.
		expect(maxChannelDiff(mid, "#ff8000")).toBeLessThanOrEqual(1)
	})

	it("hsb: hue wraps the short way across 0° (magenta→red not via green)", () => {
		// 300° → 0° should pass 330° (rose), not 150°.
		const mid = gradientInterpolator("hsb")("#ff00ff", "#ff0000")(0.5)
		const c = d3Rgb(mid)
		expect(c.r).toBe(255)
		expect(c.g).toBe(0)
		expect(c.b).toBeGreaterThan(100) // rose keeps substantial blue
	})

	it("hsb: achromatic endpoint borrows the other endpoint's hue", () => {
		// White → blue must stay blue-tinted the whole way; a naive hue lerp
		// from an arbitrary 0 would detour through red.
		const f = gradientInterpolator("hsb")("#ffffff", "#0000ff")
		for (const t of [0.25, 0.5, 0.75]) {
			const c = d3Rgb(f(t))
			expect(c.b).toBeGreaterThanOrEqual(c.r)
			expect(c.r).toBe(c.g) // pure blue hue: r and g desaturate together
		}
	})

	it("oklch: differs from rgb between distant hues and stays brighter", () => {
		const rgbMid = gradientInterpolator("rgb")("#ff0000", "#0000ff")(0.5)
		const okMid = gradientInterpolator("oklch")("#ff0000", "#0000ff")(0.5)
		expect(okMid).not.toBe(rgbMid)
		// Perceptually uniform blending avoids the dark-purple dip: the OKLCH
		// midpoint is visibly lighter than sRGB's #800080.
		const c = d3Rgb(okMid)
		const rgbC = d3Rgb(rgbMid)
		expect(c.r + c.g + c.b).toBeGreaterThan(rgbC.r + rgbC.g + rgbC.b)
	})

	it("oklch: greyscale ramps stay neutral (no hue drift)", () => {
		const f = gradientInterpolator("oklch")("#ffffff", "#000000")
		for (const t of [0.2, 0.5, 0.8]) {
			const c = d3Rgb(f(t))
			expect(Math.abs(c.r - c.g)).toBeLessThanOrEqual(1)
			expect(Math.abs(c.g - c.b)).toBeLessThanOrEqual(1)
		}
	})

	it("oklch: output is always a valid in-gamut hex color", () => {
		// Saturated hue pairs can momentarily exit sRGB gamut mid-ramp; the
		// converter clamps instead of emitting NaN/out-of-range channels.
		const f = gradientInterpolator("oklch")("#00ff00", "#0000ff")
		for (let i = 0; i <= 10; i++) {
			expect(f(i / 10)).toMatch(/^#[0-9a-f]{6}$/)
		}
	})

	it("unparseable colors fall back to rgb interpolation rather than crash", () => {
		const f = gradientInterpolator("oklch")("not-a-color", "#0000ff")
		expect(typeof f(0.5)).toBe("string")
	})
})
