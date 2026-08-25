import { scaleOrdinal } from "d3-scale"
import { describe, expect, it } from "vitest"
import type { AestheticScales } from "../store/useAestheticScales"

import { DEFAULT_SHAPE_CONFIG, EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { layerFillProp, resolveLayerColor } from "./resolveLayerColor"

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

describe("resolveLayerColor", () => {
	it("returns the default fill / opacity when nothing is mapped", () => {
		const r = resolveLayerColor({
			groupValues: {},
			defaultFill: "#abcdef",
			patternBgFallback: "#e2e8f0",
			aestheticScales: emptyScales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(r.fill).toBe("#abcdef")
		expect(r.opacity).toBe(1)
		expect(r.patternId).toBeNull()
	})

	it("applies the hue scale when hue is mapped and the row has a value", () => {
		// `applyHueScale` (called inside `resolveLayerColor`) requires a
		// real `HueScale` discriminated union — the categorical variant
		// wraps a d3 `scaleOrdinal`.
		const scales: AestheticScales = {
			...emptyScales,
			hue: {
				field: { name: "category", type: "categorical" },
				scale: {
					kind: "categorical",
					scale: scaleOrdinal<string, string>()
						.domain(["A", "B"])
						.range(["#ff0000", "#00ff00"]),
				},
			},
		}
		const r = resolveLayerColor({
			groupValues: { hue: "A" },
			defaultFill: "#000",
			patternBgFallback: "#fff",
			aestheticScales: scales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(r.fill).toBe("#ff0000")
	})

	it("falls back to defaultFill when the hue scale's lookup yields no color", () => {
		// scaleOrdinal returns "" (empty string) for unknown domain values
		// when the range is empty — and `applyHueScale` returns null when
		// `parseValue` can't coerce the input. We exercise the parseValue-
		// null path by passing a non-stringifiable hue value.
		const scales: AestheticScales = {
			...emptyScales,
			hue: {
				field: { name: "category", type: "quantitative" },
				scale: {
					kind: "categorical",
					scale: scaleOrdinal<string, string>()
						.domain(["A"])
						.range(["#ff0000"]),
				},
			},
		}
		const r = resolveLayerColor({
			// quantitative type but a non-numeric value → parseValue → null.
			groupValues: { hue: "not-a-number" },
			defaultFill: "#deadbe",
			patternBgFallback: "#fff",
			aestheticScales: scales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(r.fill).toBe("#deadbe")
	})

	it("uses channel-config defaults when sat/bri channels aren't mapped", () => {
		// modulateColor is deterministic for given (color, sat, bri) inputs.
		// We don't assert the exact output color (that's modulateColor's
		// contract) — just that ANY modulation happened (output differs
		// from input) when the default sat/bri are non-null.
		const r = resolveLayerColor({
			groupValues: {},
			defaultFill: "#888888",
			patternBgFallback: "#fff",
			aestheticScales: emptyScales,
			channelConfigs: {
				...EMPTY_CHANNEL_CONFIGS,
				defaultSaturation: 0.4,
				defaultBrightness: 0.7,
			},
		})
		// Modulation produced a different color (proves the default sat/bri
		// flowed into modulateColor, not that the output is a specific hex).
		expect(r.fill).not.toBe("#888888")
	})

	it("returns opacity 1 when no opacity is mapped and no default is set", () => {
		const r = resolveLayerColor({
			groupValues: {},
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: emptyScales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(r.opacity).toBe(1)
	})

	it("uses defaultOpacity from channelConfigs when opacity isn't mapped", () => {
		const r = resolveLayerColor({
			groupValues: {},
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: emptyScales,
			channelConfigs: { ...EMPTY_CHANNEL_CONFIGS, defaultOpacity: 0.3 },
		})
		expect(r.opacity).toBe(0.3)
	})

	it("falls back to defaultOpacity when the mapped opacity scale can't resolve", () => {
		// UNIFIED CONVENTION (2026-08): mapped-but-unresolvable values fall
		// back to the channel's DEFAULT level — the same rule hue follows with
		// `defaultFill`, shared with the per-row `resolveMarkAesthetics` so
		// row- and group-based renderers can't drift apart again.
		const scales: AestheticScales = {
			...emptyScales,
			opacity: {
				field: { name: "op", type: "quantitative" },
				scale: () => null,
			},
		}
		const r = resolveLayerColor({
			groupValues: { opacity: "junk" },
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: scales,
			channelConfigs: { ...EMPTY_CHANNEL_CONFIGS, defaultOpacity: 0.3 },
		})
		expect(r.opacity).toBe(0.3)
	})

	it("falls back to defaultSaturation when the mapped saturation scale can't resolve", () => {
		// Same unified convention for sat/bri: unresolvable-mapped degrades to
		// the channel default (modulation still applies) rather than silently
		// skipping modulation for one slice.
		const scales: AestheticScales = {
			...emptyScales,
			saturation: {
				field: { name: "sat", type: "quantitative" },
				scale: () => null,
			},
		}
		const r = resolveLayerColor({
			groupValues: { saturation: "junk" },
			defaultFill: "#6699cc",
			patternBgFallback: "#fff",
			aestheticScales: scales,
			channelConfigs: { ...EMPTY_CHANNEL_CONFIGS, defaultSaturation: 0.9 },
		})
		// Modulation at the default level happened (fill left the base color).
		expect(r.fill).not.toBe("#6699cc")
	})

	it("returns patternId=null when pattern channel isn't mapped", () => {
		const r = resolveLayerColor({
			groupValues: { pattern: "X" },
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: emptyScales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(r.patternId).toBeNull()
	})

	it("honors defaultPattern when the renderer opts in via patternOptions", () => {
		// UNIFIED CONVENTION (2026-08): the configured default pattern (no
		// pattern field mapped) applies to every mark-fill renderer — bars,
		// areas, pies AND scatter — via the same `includeDefaultPattern`
		// opt-in ScatterPlot already used. Without the opt-in (geo/structure
		// renderers keep their own pattern semantics) nothing changes.
		const configs = { ...EMPTY_CHANNEL_CONFIGS, defaultPattern: 3 }
		const withOptIn = resolveLayerColor({
			groupValues: {},
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: emptyScales,
			channelConfigs: configs,
			patternOptions: { includeDefaultPattern: true },
		})
		expect(withOptIn.patternId).toContain("vc-pat-3")
		const withoutOptIn = resolveLayerColor({
			groupValues: {},
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: emptyScales,
			channelConfigs: configs,
		})
		expect(withoutOptIn.patternId).toBeNull()
	})

	it("defaultToNone suppresses auto-cycled field-mapped patterns (line-chart context)", () => {
		const scales: AestheticScales = {
			...emptyScales,
			pattern: {
				field: { name: "p", type: "categorical" },
				categories: ["A", "B"],
			},
		}
		const base = {
			groupValues: { pattern: "A" },
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: scales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		}
		// Without the flag the palette auto-cycles by category position…
		expect(resolveLayerColor(base).patternId).not.toBeNull()
		// …with it, no per-category override means no pattern.
		expect(
			resolveLayerColor({
				...base,
				patternOptions: { defaultToNone: true },
			}).patternId
		).toBeNull()
	})

	it("keeps the palette-paired pattern ink when sat/bri modulation rewrites the fill", () => {
		// Regression: the ink lookup matches the theme palette's exact swatch
		// hexes. A theme-driven defaultSaturation modulates the fill hex out of
		// the palette; the lookup must key on the PRE-modulation hue color or
		// every mark falls back to the near-black default ink.
		const palette = ["#e0f2fe", "#7dd3fc"]
		const scales: AestheticScales = {
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
			pattern: {
				field: { name: "grp", type: "categorical" },
				categories: ["A", "B"],
			},
		}
		const r = resolveLayerColor({
			groupValues: { hue: "A", pattern: "A" },
			defaultFill: "#000",
			patternBgFallback: "#fff",
			aestheticScales: scales,
			channelConfigs: {
				...EMPTY_CHANNEL_CONFIGS,
				categoricalPalette: palette,
				categoricalPalettePatternInks: ["#ff0000", "#00ff00"],
				// Well BELOW the 0.5 anchor: levels are relative now, so a
				// level near the anchor barely moves a near-white swatch's
				// hex — this one has to actually leave the palette.
				defaultSaturation: 0.1,
			},
		})
		// Fill got modulated off the palette swatch…
		expect(r.fill).not.toBe(palette[0])
		// …but the pattern still carries the swatch's paired ink.
		expect(r.patternId).toContain("ff0000")
	})

	// Conditional outline rules test the mapped outline variable's value and
	// override the outlineHue scale color when one matches. Only fire when an
	// outline field is mapped.
	const outlineScales: AestheticScales = {
		...emptyScales,
		outlineHue: {
			field: { name: "value", type: "quantitative" },
			scale: {
				kind: "categorical",
				scale: scaleOrdinal<string, string>()
					.domain(["20"])
					.range(["#0000ff"]),
			},
		},
	}

	it("a matching outline rule overrides the outlineHue scale color", () => {
		const r = resolveLayerColor({
			groupValues: { outlineHue: "20" },
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: outlineScales,
			channelConfigs: {
				...EMPTY_CHANNEL_CONFIGS,
				shape: {
					...DEFAULT_SHAPE_CONFIG,
					outlineColorRules: [{ condition: "> 15", color: "#ff0000" }],
				},
			},
		})
		expect(r.outline).toBe("#ff0000")
	})

	it("keeps the scale color when no outline rule matches", () => {
		const r = resolveLayerColor({
			groupValues: { outlineHue: "20" },
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: outlineScales,
			channelConfigs: {
				...EMPTY_CHANNEL_CONFIGS,
				shape: {
					...DEFAULT_SHAPE_CONFIG,
					outlineColorRules: [{ condition: "> 50", color: "#ff0000" }],
				},
			},
		})
		expect(r.outline).toBe("#0000ff")
	})

	it("ignores outline rules when no outline field is mapped", () => {
		const r = resolveLayerColor({
			groupValues: {},
			defaultFill: "#fff",
			patternBgFallback: "#fff",
			aestheticScales: emptyScales,
			channelConfigs: {
				...EMPTY_CHANNEL_CONFIGS,
				shape: {
					...DEFAULT_SHAPE_CONFIG,
					outlineColorRules: [{ condition: "> 0", color: "#ff0000" }],
				},
			},
		})
		expect(r.outline).toBeNull()
	})
})

describe("layerFillProp", () => {
	it("returns the base fill when no pattern is applied", () => {
		expect(
			layerFillProp({ fill: "#123456", opacity: 1, patternId: null, outline: null })
		).toBe("#123456")
	})

	it("returns a url(#id) reference when a pattern is applied", () => {
		expect(
			layerFillProp({ fill: "#123456", opacity: 1, patternId: "pat-7", outline: null })
		).toBe("url(#pat-7)")
	})
})
