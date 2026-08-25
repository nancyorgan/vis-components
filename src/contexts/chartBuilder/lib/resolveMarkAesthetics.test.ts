import { scaleOrdinal } from "d3-scale"
import { describe, expect, it } from "vitest"
import type { AestheticScales } from "../store/useAestheticScales"

import {
	DEFAULT_FILL,
	DEFAULT_OPACITY,
	DEFAULT_RADIUS,
	EMPTY_CHANNEL_CONFIGS,
} from "./channelConfig"
import { resolveMarkAesthetics } from "./resolveMarkAesthetics"

/** AestheticScales with every channel un-mapped (the "no encoding"
 *  baseline). Each test below populates only the channel(s) it exercises. */
const emptyScales: AestheticScales = {
	hue: null,
	outlineHue: null,
	saturation: null,
	brightness: null,
	pattern: null,
	colorSlots: {},
	opacitySlots: {},
	opacity: null,
	area: null,
	shape: null,
	length: null,
	angle: null,
}

const hueScales = (palette: string[]): AestheticScales => ({
	...emptyScales,
	hue: {
		field: { name: "grp", type: "categorical" },
		scale: {
			kind: "categorical",
			scale: scaleOrdinal<string, string>()
				.domain(["A", "B"])
				.range(palette),
		},
	},
})

describe("resolveMarkAesthetics", () => {
	it("returns the built-in defaults when nothing is mapped or configured", () => {
		const r = resolveMarkAesthetics({}, emptyScales, EMPTY_CHANNEL_CONFIGS)
		expect(r.fill).toBe(DEFAULT_FILL)
		expect(r.preModulationHue).toBe(DEFAULT_FILL)
		expect(r.opacity).toBe(DEFAULT_OPACITY)
		expect(r.radius).toBe(DEFAULT_RADIUS)
	})

	it("prefers the configured defaults over the built-ins", () => {
		const r = resolveMarkAesthetics({}, emptyScales, {
			...EMPTY_CHANNEL_CONFIGS,
			defaultFill: "#abcdef",
			defaultOpacity: 0.4,
			defaultRadius: 9,
		})
		expect(r.fill).toBe("#abcdef")
		expect(r.opacity).toBe(0.4)
		expect(r.radius).toBe(9)
	})

	it("applies the hue scale to the row's value when hue is mapped", () => {
		const r = resolveMarkAesthetics(
			{ grp: "B" },
			hueScales(["#ff0000", "#00ff00"]),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(r.fill).toBe("#00ff00")
		expect(r.preModulationHue).toBe("#00ff00")
	})

	it("keeps preModulationHue at the palette hex when sat/bri modulation rewrites the fill", () => {
		// LOAD-BEARING INVARIANT: pattern-ink lookups match the theme
		// palette's exact swatch hexes, so they must key on the
		// PRE-modulation hue color — modulation rewrites the fill hex out
		// of the palette.
		const palette = ["#e0f2fe", "#7dd3fc"]
		const r = resolveMarkAesthetics({ grp: "A" }, hueScales(palette), {
			...EMPTY_CHANNEL_CONFIGS,
			// Below the anchor — see the note in buildPatternDefs.test.ts.
			defaultSaturation: 0.1,
		})
		expect(r.preModulationHue).toBe(palette[0])
		expect(r.fill).not.toBe(palette[0])
	})

	it("runs the opacity scale over the row's value when opacity is mapped", () => {
		const scales: AestheticScales = {
			...emptyScales,
			opacity: {
				field: { name: "op", type: "quantitative" },
				scale: (raw) => (typeof raw === "number" ? raw / 10 : null),
			},
		}
		const r = resolveMarkAesthetics({ op: 5 }, scales, EMPTY_CHANNEL_CONFIGS)
		expect(r.opacity).toBe(0.5)
	})

	it("falls back to defaultOpacity when the mapped opacity scale returns null", () => {
		const scales: AestheticScales = {
			...emptyScales,
			opacity: {
				field: { name: "op", type: "quantitative" },
				scale: () => null,
			},
		}
		const r = resolveMarkAesthetics({ op: "junk" }, scales, {
			...EMPTY_CHANNEL_CONFIGS,
			defaultOpacity: 0.2,
		})
		// UNIFIED CONVENTION (2026-08): mapped-but-unresolvable rows fall back
		// to the channel's DEFAULT level — the same rule hue follows with
		// `defaultFill`, and the same rule `resolveLayerColor` applies for the
		// GroupValues renderers. (Previously these rows got 1, diverging from
		// the configured default.)
		expect(r.opacity).toBe(0.2)
	})

	it("mapped-but-unresolvable opacity with no configured default gets DEFAULT_OPACITY", () => {
		const scales: AestheticScales = {
			...emptyScales,
			opacity: {
				field: { name: "op", type: "quantitative" },
				scale: () => null,
			},
		}
		const r = resolveMarkAesthetics({ op: "junk" }, scales, EMPTY_CHANNEL_CONFIGS)
		expect(r.opacity).toBe(DEFAULT_OPACITY)
	})

	it("falls back to defaultSaturation when the mapped saturation scale returns null", () => {
		// UNIFIED CONVENTION (2026-08): a mapped sat/bri channel whose value
		// can't resolve degrades to the channel default (modulation still
		// applies), instead of silently skipping modulation for that row —
		// keeping row-based renderers in lockstep with the GroupValues path.
		const palette = ["#e0f2fe", "#7dd3fc"]
		const scales: AestheticScales = {
			...hueScales(palette),
			saturation: {
				field: { name: "sat", type: "quantitative" },
				scale: () => null,
			},
		}
		const r = resolveMarkAesthetics({ grp: "A", sat: "junk" }, scales, {
			...EMPTY_CHANNEL_CONFIGS,
			// Below the anchor — see the note in buildPatternDefs.test.ts.
			defaultSaturation: 0.1,
		})
		expect(r.satUnit).toBe(0.1)
		// Modulation happened (the fill left the palette swatch)…
		expect(r.fill).not.toBe(palette[0])
		// …but the pattern-ink key stays the pre-modulation palette hex.
		expect(r.preModulationHue).toBe(palette[0])
	})

	it("mapped-but-unresolvable saturation with no default applies no modulation", () => {
		const palette = ["#e0f2fe", "#7dd3fc"]
		const scales: AestheticScales = {
			...hueScales(palette),
			saturation: {
				field: { name: "sat", type: "quantitative" },
				scale: () => null,
			},
		}
		const r = resolveMarkAesthetics(
			{ grp: "A", sat: "junk" },
			scales,
			EMPTY_CHANNEL_CONFIGS
		)
		expect(r.satUnit).toBeNull()
		expect(r.fill).toBe(palette[0])
	})
})
