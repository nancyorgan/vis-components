import { describe, expect, it } from "vitest"

import { EMPTY_CHANNEL_CONFIGS, type ChannelConfigs } from "./channelConfig"
import { resolveLineStyle } from "./lineStyle"

/** The Line's style, resolved once for every chart that draws one (a line
 *  chart's lines, an area's edges, a radar's outlines). These pin the rules
 *  the three renderers used to each carry a copy of. */

const style = (
	connection: Record<string, unknown> = {},
	more: {
		pattern?: Record<string, unknown>
		patternField?: string | null
		patternDomain?: string[]
		hueField?: string | null
		configs?: Partial<ChannelConfigs>
	} = {}
) =>
	resolveLineStyle({
		channelConfigs: {
			...EMPTY_CHANNEL_CONFIGS,
			...more.configs,
			connection: { ...EMPTY_CHANNEL_CONFIGS.connection, ...connection },
			pattern: { ...EMPTY_CHANNEL_CONFIGS.pattern, ...more.pattern },
		} as ChannelConfigs,
		patternField: more.patternField ?? null,
		patternDomain: more.patternDomain ?? [],
		hueField: more.hueField ?? null,
		hueType: undefined,
		themeInkFallback: undefined,
	})

describe("resolveLineStyle — cap and smoothing", () => {
	it("an untouched line is round-capped, straight and solid", () => {
		const line = style()
		expect(line).toMatchObject({
			cap: "round",
			tickCap: false,
			smoothing: 0,
			defaultDashArray: null,
		})
		expect(line.dashFor({ patternValue: null })).toEqual({ dashArray: null, blank: false })
	})

	it("square and tick ends are flush; tick also marks each end", () => {
		expect(style({ lineCap: "square" })).toMatchObject({ cap: "butt", tickCap: false })
		expect(style({ lineCap: "tick" })).toMatchObject({ cap: "butt", tickCap: true })
	})

	it("carries the smoothing amount", () => {
		expect(style({ smoothing: 0.4 }).smoothing).toBe(0.4)
	})
})

describe("resolveLineStyle — the dash", () => {
	it("the default dash is the picked swatch's", () => {
		expect(style({ defaultDashPattern: "dashed" }).dashFor({ patternValue: null })).toEqual({
			dashArray: "8,7",
			blank: false,
		})
	})

	it("a typed custom dasharray wins over the swatch", () => {
		const line = style({ defaultDashPattern: "dotted", customDashPattern: "5 3" })
		expect(line.defaultDashArray).not.toBeNull()
		expect(line.defaultDashArray).not.toBe("2,6")
		// …even over "Blank": the line then has a dash to draw.
		expect(
			style({ defaultDashPattern: "blank", customDashPattern: "5 3" }).dashFor({
				patternValue: null,
			}).blank
		).toBe(false)
	})

	it("Blank is no dash at all — the renderer leaves the range window empty", () => {
		expect(style({ defaultDashPattern: "blank" }).dashFor({ patternValue: null })).toEqual({
			dashArray: null,
			blank: true,
		})
	})

	it("a line's own stored dash wins over the default", () => {
		const line = style({ defaultDashPattern: "dashed" })
		expect(line.dashFor({ patternValue: null, override: "dotted" }).dashArray).toBe("2,6")
		expect(line.dashFor({ patternValue: null, override: "solid" }).dashArray).toBeNull()
		expect(line.dashFor({ patternValue: null, override: "blank" }).blank).toBe(true)
	})

	describe("with a Pattern variable mapped", () => {
		const mapped = { patternField: "phase", patternDomain: ["known", "projected"] }

		it("each category takes the next dash in the cycle", () => {
			const line = style({}, mapped)
			expect(line.dashFor({ patternValue: "known" }).dashArray).toBe("8,7")
			expect(line.dashFor({ patternValue: "projected" }).dashArray).toBe("2,6")
		})

		it("a category's picked swatch, then its custom dasharray, win over the cycle", () => {
			const picked = style({}, { ...mapped, pattern: { dashOverrides: { known: "none" } } })
			expect(picked.dashFor({ patternValue: "known" }).dashArray).toBeNull()
			const custom = style(
				{},
				{
					...mapped,
					pattern: {
						dashOverrides: { known: "none" },
						customDashOverrides: { known: "9 1" },
					},
				}
			)
			expect(custom.dashFor({ patternValue: "known" }).dashArray).not.toBeNull()
		})

		it("precedence: category custom, the line's own, category swatch, default", () => {
			const line = style(
				{ defaultDashPattern: "dash-dot" },
				{ ...mapped, pattern: { customDashOverrides: { known: "9 1" } } }
			)
			const custom = line.dashFor({ patternValue: "known", override: "dotted" }).dashArray
			expect(custom).not.toBe("2,6")
			expect(custom).not.toBeNull()
			// No custom dasharray for "projected": the line's own dash is next.
			expect(line.dashFor({ patternValue: "projected", override: "dashed" }).dashArray).toBe("8,7")
			// Neither: the category's swatch (second in the cycle).
			expect(line.dashFor({ patternValue: "projected" }).dashArray).toBe("2,6")
			// A value outside the variable's categories: the default dash.
			expect(line.dashFor({ patternValue: null }).dashArray).toBe("8,6,2,6")
		})

		it("Blank never applies: the variable says where each dash goes", () => {
			const line = style({ defaultDashPattern: "blank" }, mapped)
			expect(line.dashFor({ patternValue: "known" }).blank).toBe(false)
			expect(line.dashFor({ patternValue: null, override: "blank" }).blank).toBe(false)
		})
	})
})

describe("resolveLineStyle — the gaps", () => {
	it("gaps are filled unless Pattern and Color map the same variable, or the user chose", () => {
		expect(style().gapFill).toBe(true)
		expect(style({}, { patternField: "phase", hueField: "series" }).gapFill).toBe(true)
		expect(style({}, { patternField: "phase", hueField: "phase" }).gapFill).toBe(false)
		expect(style({ dashGapFill: true }, { patternField: "phase", hueField: "phase" }).gapFill).toBe(
			true
		)
		expect(style({ dashGapFill: false }).gapFill).toBe(false)
	})

	const line = (connection: Record<string, unknown>, configs: Partial<ChannelConfigs> = {}) =>
		style(connection, { configs }).gapColor({
			overrideKeys: ["North", "line-1"],
			patternValue: null,
			hueColor: null,
			lineColor: "#123456",
		})

	it("a per-value gap color wins, by the line's Color value then its legacy key", () => {
		expect(line({ dashAlternateColors: { North: "#aa0000" }, dashGapColor: "#00aa00" })).toBe(
			"#aa0000"
		)
		expect(line({ dashAlternateColors: { "line-1": "#0000aa" } })).toBe("#0000aa")
	})

	it("then the single gap color, then the default pattern ink", () => {
		expect(line({ dashGapColor: "#00aa00" }, { defaultPatternInk: "#555555" })).toBe("#00aa00")
		expect(line({}, { defaultPatternInk: "#555555" })).toBe("#555555")
	})
})
