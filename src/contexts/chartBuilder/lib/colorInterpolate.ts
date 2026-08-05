// Blend-space interpolation for custom hue gradients. d3-interpolate ships
// RGB (and HSL/Lab/HCL), but not HSB or OKLCH — those two are implemented
// here from the standard conversions so the gradient editor can offer them
// without a color-library dependency.

import { rgb as d3Rgb } from "d3-color"
import { interpolateRgb } from "d3-interpolate"

/** Color space used to blend between the stops of a custom gradient.
 * "rgb" is the historical default (and what CSS gradients themselves do);
 * "hsb" rotates through hue; "oklch" is perceptually uniform, avoiding the
 * muddy midpoints RGB produces between distant hues. Only the custom
 * gradient paths read this — presets (viridis, RdBu, …) are continuous
 * baked ramps with every in-between color already specified. */
export type GradientInterpolation = "rgb" | "hsb" | "oklch"

/** Dropdown options for the gradient editor's blend-space picker. */
export const GRADIENT_INTERPOLATIONS: {
	id: GradientInterpolation
	label: string
}[] = [
	{ id: "rgb", label: "RGB" },
	{ id: "hsb", label: "HSB" },
	{ id: "oklch", label: "OKLCH" },
]

/** Channels in [0, 1]. */
type Rgb = { r: number; g: number; b: number }

const parseRgb = (color: string): Rgb | null => {
	const c = d3Rgb(color)
	if (!c || !Number.isFinite(c.r + c.g + c.b)) return null
	return { r: c.r / 255, g: c.g / 255, b: c.b / 255 }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

const toHex = ({ r, g, b }: Rgb): string => {
	const ch = (v: number) =>
		Math.round(clamp01(v) * 255)
			.toString(16)
			.padStart(2, "0")
	return `#${ch(r)}${ch(g)}${ch(b)}`
}

/** Interpolate hue along the shorter arc of the wheel. NaN marks an
 * achromatic endpoint (greys have no hue) — it borrows the other
 * endpoint's hue so a grey→blue ramp stays blue instead of sweeping the
 * whole wheel. */
const interpolateHueDeg = (a: number, b: number): ((t: number) => number) => {
	if (Number.isNaN(a) && Number.isNaN(b)) return () => 0
	if (Number.isNaN(a)) return () => b
	if (Number.isNaN(b)) return () => a
	const d = ((b - a + 540) % 360) - 180
	return (t) => a + d * t
}

/** Linear interpolation where a NaN endpoint (undefined component, e.g.
 * black's saturation) borrows the other endpoint's value. */
const interpolateMaybe = (a: number, b: number): ((t: number) => number) => {
	if (Number.isNaN(a) && Number.isNaN(b)) return () => 0
	if (Number.isNaN(a)) return () => b
	if (Number.isNaN(b)) return () => a
	return (t) => a + (b - a) * t
}

// --- HSB (a.k.a. HSV) ------------------------------------------------------

/** h in degrees (NaN when achromatic), s in [0,1] (NaN for black, whose
 * saturation is undefined), b(rightness) in [0,1]. */
const rgbToHsb = ({ r, g, b }: Rgb): { h: number; s: number; v: number } => {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const d = max - min
	let h = NaN
	if (d > 0) {
		if (max === r) h = 60 * (((g - b) / d) % 6)
		else if (max === g) h = 60 * ((b - r) / d + 2)
		else h = 60 * ((r - g) / d + 4)
		if (h < 0) h += 360
	}
	return { h, s: max === 0 ? NaN : d / max, v: max }
}

const hsbToRgb = (h: number, s: number, v: number): Rgb => {
	const hh = (((h % 360) + 360) % 360) / 60
	const c = v * s
	const x = c * (1 - Math.abs((hh % 2) - 1))
	const m = v - c
	const [r, g, b] =
		hh < 1
			? [c, x, 0]
			: hh < 2
				? [x, c, 0]
				: hh < 3
					? [0, c, x]
					: hh < 4
						? [0, x, c]
						: hh < 5
							? [x, 0, c]
							: [c, 0, x]
	return { r: r + m, g: g + m, b: b + m }
}

const interpolateHsb = (
	aStr: string,
	bStr: string,
): ((t: number) => string) => {
	const a = parseRgb(aStr)
	const b = parseRgb(bStr)
	if (!a || !b) return interpolateRgb(aStr, bStr)
	const ha = rgbToHsb(a)
	const hb = rgbToHsb(b)
	const h = interpolateHueDeg(ha.h, hb.h)
	const s = interpolateMaybe(ha.s, hb.s)
	const v = interpolateMaybe(ha.v, hb.v)
	return (t) => toHex(hsbToRgb(h(t), s(t), v(t)))
}

// --- OKLCH ------------------------------------------------------------------
// Björn Ottosson's OKLab (https://bottosson.github.io/posts/oklab/) in polar
// form. Lightness/chroma interpolate linearly; hue takes the shorter arc.

const srgbToLinear = (c: number): number =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

const linearToSrgb = (c: number): number => {
	const v = Math.max(0, c) // out-of-gamut negatives would NaN under **(1/2.4)
	return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}

/** L in [0,1], C ≥ 0, h in degrees (NaN when achromatic). */
const rgbToOklch = ({ r, g, b }: Rgb): { L: number; C: number; h: number } => {
	const lr = srgbToLinear(r)
	const lg = srgbToLinear(g)
	const lb = srgbToLinear(b)
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	const C = Math.hypot(A, B)
	const h = C < 1e-6 ? NaN : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
	return { L, C, h }
}

const oklchToRgb = (L: number, C: number, h: number): Rgb => {
	const hr = (h * Math.PI) / 180
	const A = C * Math.cos(hr)
	const B = C * Math.sin(hr)
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
	return {
		r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	}
}

const interpolateOklch = (
	aStr: string,
	bStr: string,
): ((t: number) => string) => {
	const a = parseRgb(aStr)
	const b = parseRgb(bStr)
	if (!a || !b) return interpolateRgb(aStr, bStr)
	const oa = rgbToOklch(a)
	const ob = rgbToOklch(b)
	const h = interpolateHueDeg(oa.h, ob.h)
	// Achromatic endpoints keep C = 0 at their end (interpolating toward the
	// other's chroma) — plain lerp does exactly that since their C is 0.
	return (t) =>
		toHex(
			oklchToRgb(
				oa.L + (ob.L - oa.L) * t,
				oa.C + (ob.C - oa.C) * t,
				h(t),
			),
		)
}

/** The (a, b) → (t → color) factory for a blend space — plugs straight into
 * d3 scaleLinear's `.interpolate()`. "rgb" / absent returns d3's own
 * interpolateRgb, so charts saved before the option existed render
 * byte-identically. */
export const gradientInterpolator = (
	space: GradientInterpolation | undefined,
): ((a: string, b: string) => (t: number) => string) => {
	if (space === "hsb") return interpolateHsb
	if (space === "oklch") return interpolateOklch
	return interpolateRgb
}
