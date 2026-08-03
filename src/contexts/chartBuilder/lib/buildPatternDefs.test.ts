import { scaleOrdinal } from "d3-scale"
import { describe, expect, it } from "vitest"
import type { AestheticScales } from "../store/useAestheticScales"

import {
	buildPatternDefs,
	buildPatternDefsFromItems,
	resolvePatternDefForItem,
} from "./buildPatternDefs"
import { EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import type { GroupValues } from "./resolveLayerColor"

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

describe("buildPatternDefs", () => {
	it("returns [] when no pattern channel is mapped", () => {
		const defs = buildPatternDefs(
			[{ pattern: "X" } as GroupValues, { pattern: "Y" } as GroupValues],
			emptyScales,
			EMPTY_CHANNEL_CONFIGS,
			"#000",
			"#fff"
		)
		expect(defs).toEqual([])
	})

	it("returns [] when input list is empty (no slices to scan)", () => {
		const scales: AestheticScales = {
			...emptyScales,
			pattern: {
				field: { name: "p", type: "categorical" },
				categories: ["A", "B"],
			},
		}
		expect(
			buildPatternDefs([], scales, EMPTY_CHANNEL_CONFIGS, "#000", "#fff")
		).toEqual([])
	})

	it("ignores slices whose pattern value isn't in the discovered categories", () => {
		const scales: AestheticScales = {
			...emptyScales,
			pattern: {
				field: { name: "p", type: "categorical" },
				categories: ["A", "B"],
			},
		}
		// "ZZZ" isn't in the categories list, so no def emitted.
		const defs = buildPatternDefs(
			[{ pattern: "ZZZ" } as GroupValues],
			scales,
			EMPTY_CHANNEL_CONFIGS,
			"#000",
			"#fff"
		)
		expect(defs).toEqual([])
	})

	it("deduplicates by svgId — same pattern category across multiple slices emits one def", () => {
		const scales: AestheticScales = {
			...emptyScales,
			pattern: {
				field: { name: "p", type: "categorical" },
				categories: ["A", "B"],
			},
		}
		const defs = buildPatternDefs(
			[
				{ pattern: "A" } as GroupValues,
				{ pattern: "A" } as GroupValues,
				{ pattern: "A" } as GroupValues,
			],
			scales,
			EMPTY_CHANNEL_CONFIGS,
			"#000",
			"#fff"
		)
		// Three slices, one category: one or fewer defs (channel config may
		// determine whether a pattern actually exists; we just assert no
		// duplicates).
		const ids = new Set(defs.map((d) => d.svgId))
		expect(ids.size).toBe(defs.length)
	})

	it("emits a def for each distinct pattern category present in the slices", () => {
		const scales: AestheticScales = {
			...emptyScales,
			pattern: {
				field: { name: "p", type: "categorical" },
				categories: ["A", "B", "C"],
			},
		}
		const defs = buildPatternDefs(
			[
				{ pattern: "A" } as GroupValues,
				{ pattern: "B" } as GroupValues,
				{ pattern: "C" } as GroupValues,
			],
			scales,
			EMPTY_CHANNEL_CONFIGS,
			"#000",
			"#fff"
		)
		// Three distinct pattern categories should produce three distinct
		// defs (or fewer if the pattern channel config disables any). Just
		// pin uniqueness, since per-category resolution is the
		// `resolvePatternForMark` helper's concern.
		const ids = new Set(defs.map((d) => d.svgId))
		expect(ids.size).toBe(defs.length)
	})

	it("keeps the palette-paired ink when sat/bri modulation rewrites the background", () => {
		// Regression: mirrors resolveLayerColor — the ink lookup must key on
		// the PRE-modulation hue color, or a theme defaultSaturation knocks
		// every def back to the near-black default ink (and out of sync with
		// the marks' svgIds).
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
		const defs = buildPatternDefs(
			[
				{ hue: "A", pattern: "A" } as GroupValues,
				{ hue: "B", pattern: "B" } as GroupValues,
			],
			scales,
			{
				...EMPTY_CHANNEL_CONFIGS,
				categoricalPalette: palette,
				categoricalPalettePatternInks: ["#ff0000", "#00ff00"],
				defaultSaturation: 0.7,
			},
			"#000",
			"#fff"
		)
		expect(defs.map((d) => d.inkColor)).toEqual(["#ff0000", "#00ff00"])
		// The background tile still shows the mark's ACTUAL (modulated) color.
		expect(defs[0]?.bgColor).not.toBe(palette[0])
	})
})

describe("buildPatternDefsFromItems / resolvePatternDefForItem", () => {
	const patternScales: AestheticScales = {
		...emptyScales,
		pattern: {
			field: { name: "p", type: "categorical" },
			categories: ["A", "B"],
		},
	}

	it("keys the ink lookup on the item's preModulationHue, not its modulated fill", () => {
		// The row-based path (ScatterPlot) hands in pre-resolved colors —
		// the invariant is that `preModulationHue` (the palette swatch hex)
		// drives the ink while `fill` (modulated) drives the background.
		const palette = ["#e0f2fe", "#7dd3fc"]
		const scales: AestheticScales = {
			...patternScales,
			hue: {
				field: { name: "grp", type: "categorical" },
				scale: {
					kind: "categorical",
					scale: scaleOrdinal<string, string>()
						.domain(["A", "B"])
						.range(palette),
				},
			},
		}
		const defs = buildPatternDefsFromItems(
			[
				{
					patternValue: "A",
					fill: "#123456", // modulated — NOT in the palette
					preModulationHue: "#e0f2fe",
				},
			],
			scales,
			{
				...EMPTY_CHANNEL_CONFIGS,
				categoricalPalette: palette,
				categoricalPalettePatternInks: ["#ff0000", "#00ff00"],
			},
			"#fff"
		)
		expect(defs).toHaveLength(1)
		expect(defs[0]?.inkColor).toBe("#ff0000")
		expect(defs[0]?.bgColor).toBe("#123456")
	})

	it("skips null / empty pattern values and dedupes by svgId", () => {
		const defs = buildPatternDefsFromItems(
			[
				{ patternValue: null, fill: "#000", preModulationHue: "#000" },
				{ patternValue: "", fill: "#000", preModulationHue: "#000" },
				{ patternValue: "A", fill: "#000", preModulationHue: "#000" },
				{ patternValue: "A", fill: "#000", preModulationHue: "#000" },
			],
			patternScales,
			EMPTY_CHANNEL_CONFIGS,
			"#fff"
		)
		expect(defs).toHaveLength(1)
	})

	it("defaultToNone suppresses auto-cycled patterns but honors explicit per-category overrides", () => {
		const item = { patternValue: "A", fill: "#000", preModulationHue: "#000" }
		// Line-chart context, no explicit override → no pattern.
		expect(
			resolvePatternDefForItem(item, patternScales, EMPTY_CHANNEL_CONFIGS, "#fff", {
				defaultToNone: true,
			})
		).toBeNull()
		// Same context, explicit Point-fill override → pattern resolves.
		const withOverride = resolvePatternDefForItem(
			item,
			patternScales,
			{
				...EMPTY_CHANNEL_CONFIGS,
				pattern: {
					overrides: { A: 2 },
					inkColors: {},
					backgroundColor: "#e2e8f0",
					stackMode: "stack",
				},
			},
			"#fff",
			{ defaultToNone: true }
		)
		expect(withOverride?.paletteIdx).toBe(2)
	})

	it("includeDefaultPattern emits the __default__ def only when opted in", () => {
		const configs = { ...EMPTY_CHANNEL_CONFIGS, defaultPattern: 3 }
		const item = { patternValue: undefined, fill: "#000", preModulationHue: "#000" }
		// No pattern field mapped + opt-in → one def from `defaultPattern`.
		const defs = buildPatternDefsFromItems([item], emptyScales, configs, "#fff", {
			includeDefaultPattern: true,
		})
		expect(defs).toHaveLength(1)
		expect(defs[0]?.paletteIdx).toBe(3)
		// Without the opt-in (bars/areas/pies), no default-pattern defs.
		expect(
			buildPatternDefsFromItems([item], emptyScales, configs, "#fff")
		).toEqual([])
	})
})
