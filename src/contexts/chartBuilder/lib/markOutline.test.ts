import { scaleOrdinal } from "d3-scale"
import { describe, expect, it } from "vitest"
import type { AestheticScales } from "../store/useAestheticScales"

import { EMPTY_CHANNEL_CONFIGS, type ChannelConfigs } from "./channelConfig"
import { markOutlineResolver, outlineWidthResolver } from "./markOutline"

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

/** The Outline variable mapped to `tier`: gold → red, silver → blue. */
const withOutlineVariable: AestheticScales = {
	...emptyScales,
	outlineHue: {
		field: { name: "tier", type: "categorical" },
		scale: {
			kind: "categorical",
			scale: scaleOrdinal<string, string>()
				.domain(["gold", "silver"])
				.range(["#ff0000", "#0000ff"]),
		},
	},
}

const configs = (shape: Record<string, unknown>, more: Partial<ChannelConfigs> = {}) =>
	({
		...EMPTY_CHANNEL_CONFIGS,
		shape: { ...EMPTY_CHANNEL_CONFIGS.shape, outlineColor: "#111111", ...shape },
		...more,
	}) as ChannelConfigs

describe("markOutlineResolver", () => {
	it("draws the one outline color at full opacity when nothing else is set", () => {
		const outline = markOutlineResolver(configs({ outlineWidth: 2 }), emptyScales)
		expect(outline({})).toEqual({ stroke: "#111111", strokeOpacity: 1, strokeWidth: 2 })
	})

	it("draws at the one thickness, or the mark's level's when it varies by a variable", () => {
		const one = markOutlineResolver(configs({ outlineWidth: 2 }), emptyScales)
		expect(one({ tier: "gold" }).strokeWidth).toBe(2)
		const varied = markOutlineResolver(
			configs({
				outlineWidth: 2,
				outlineWidthField: "tier",
				outlineWidthByValue: { gold: 5, silver: 0 },
			}),
			emptyScales
		)
		expect(varied({ tier: "gold" }).strokeWidth).toBe(5)
		// 0 is a thickness: that level draws no outline.
		expect(varied({ tier: "silver" }).strokeWidth).toBe(0)
		// A level with no entry, and a row with no value, take the one thickness.
		expect(varied({ tier: "bronze" }).strokeWidth).toBe(2)
		expect(varied({}).strokeWidth).toBe(2)
	})

	it("takes the Outline variable's color for the mark's row", () => {
		const outline = markOutlineResolver(configs({}), withOutlineVariable)
		expect(outline({ tier: "gold" }).stroke).toBe("#ff0000")
		expect(outline({ tier: "silver" }).stroke).toBe("#0000ff")
		// A row the scale cannot place keeps the one outline color.
		expect(outline({}).stroke).toBe("#111111")
	})

	it("lets a matching outline color rule win over the variable", () => {
		const outline = markOutlineResolver(
			configs({ outlineColorRules: [{ id: "r", condition: "== gold", color: "#00ff00" }] }),
			withOutlineVariable
		)
		expect(outline({ tier: "gold" }).stroke).toBe("#00ff00")
		expect(outline({ tier: "silver" }).stroke).toBe("#0000ff")
	})

	it("uses a color the caller already resolved, and treats null as 'none matched'", () => {
		const outline = markOutlineResolver(configs({}), withOutlineVariable)
		expect(outline({ tier: "gold" }, { color: "#abcdef" }).stroke).toBe("#abcdef")
		expect(outline({ tier: "gold" }, { color: null }).stroke).toBe("#111111")
	})

	it("draws at the Outline opacity, a level or varied by a field", () => {
		const level = markOutlineResolver(
			configs({}, { opacitySlots: { border: { field: null, level: 0.4 } } }),
			emptyScales
		)
		expect(level({}).strokeOpacity).toBe(0.4)

		const varied = markOutlineResolver(
			configs({}, { opacitySlots: { border: { field: "tier", level: 1 } } }),
			{
				...emptyScales,
				opacitySlots: {
					border: {
						field: { name: "tier", type: "categorical" },
						scale: ((v: unknown) => (v === "gold" ? 0.2 : 0.9)) as never,
					},
				},
			}
		)
		expect(varied({ tier: "gold" }).strokeOpacity).toBe(0.2)
		expect(varied({ tier: "silver" }).strokeOpacity).toBe(0.9)
	})

	it("shades the outline by its Saturation and Brightness", () => {
		const plain = markOutlineResolver(configs({ outlineColor: "#ff0000" }), emptyScales)
		const desaturated = markOutlineResolver(
			configs(
				{ outlineColor: "#ff0000" },
				{ saturationSlots: { outline: { field: null, level: 0 } } }
			),
			emptyScales
		)
		expect(plain({}).stroke).toBe("#ff0000")
		const shaded = desaturated({}).stroke
		expect(shaded).not.toBe("#ff0000")
		// Fully desaturated red is a grey: equal channels.
		const rgb = shaded.match(/\d+(\.\d+)?/g)?.map(Number) ?? []
		if (shaded.startsWith("#")) {
			const [r, g, b] = [1, 3, 5].map((i) => parseInt(shaded.slice(i, i + 2), 16))
			expect(r).toBe(g)
			expect(g).toBe(b)
		} else {
			expect(rgb[0]).toBeCloseTo(rgb[1] ?? NaN, 0)
			expect(rgb[1]).toBeCloseTo(rgb[2] ?? NaN, 0)
		}
	})
})

describe("outlineWidthResolver", () => {
	it("is the one thickness for every mark until a variable is picked", () => {
		const width = outlineWidthResolver(configs({ outlineWidth: 3 }))
		expect(width({ tier: "gold" })).toBe(3)
		expect(width(undefined)).toBe(3)
	})

	it("a per-level map with no variable named does nothing", () => {
		// The map is only read through the variable; left behind after "— none —"
		// it must not vary anything.
		const width = outlineWidthResolver(
			configs({ outlineWidth: 3, outlineWidthByValue: { gold: 9 } })
		)
		expect(width({ tier: "gold" })).toBe(3)
	})

	it("reads the level off the row, as text", () => {
		const width = outlineWidthResolver(
			configs({ outlineWidth: 1, outlineWidthField: "year", outlineWidthByValue: { 2024: 4 } })
		)
		expect(width({ year: 2024 })).toBe(4)
		expect(width({ year: "2024" })).toBe(4)
		expect(width({ year: 2025 })).toBe(1)
	})
})
