import { scaleOrdinal } from "d3-scale"
import { describe, expect, it } from "vitest"

import type { AestheticScales } from "../store/useAestheticScales"

import { DEFAULT_SHAPE, EMPTY_CHANNEL_CONFIGS, type ChannelConfigs } from "./channelConfig"
import { pointStyleResolver } from "./pointStyle"

/** A point's glyph and colors, resolved once for every chart that draws
 *  points (scatter and line charts, combos, radar, the markers on an area's
 *  edge). */

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

/** Shape mapped to `kind`: a → 0, b → 1. */
const withShape: AestheticScales = {
	...emptyScales,
	shape: {
		field: { name: "kind", type: "categorical" },
		idx: (raw: unknown) => ["a", "b"].indexOf(String(raw)),
	},
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

const configs = (shape: Record<string, unknown> = {}, more: Partial<ChannelConfigs> = {}) =>
	({
		...EMPTY_CHANNEL_CONFIGS,
		shape: { ...EMPTY_CHANNEL_CONFIGS.shape, outlineColor: "#111111", ...shape },
		...more,
	}) as ChannelConfigs

describe("pointStyleResolver — the glyph", () => {
	it("is the default shape until Shape is mapped", () => {
		expect(pointStyleResolver(configs(), emptyScales).shapeIndex({ kind: "b" })).toBe(DEFAULT_SHAPE)
		expect(
			pointStyleResolver(configs({}, { defaultShape: 3 }), emptyScales).shapeIndex({})
		).toBe(3)
	})

	it("is the row's Shape category's once it is", () => {
		const style = pointStyleResolver(configs({}, { defaultShape: 3 }), withShape)
		expect(style.shapeIndex({ kind: "a" })).toBe(0)
		expect(style.shapeIndex({ kind: "b" })).toBe(1)
	})
})

describe("pointStyleResolver — fill and outline", () => {
	it("an untouched point: the Color mapping's fill, the single outline color", () => {
		expect(pointStyleResolver(configs(), emptyScales).colors({}, "#abcdef")).toEqual({
			fill: "#abcdef",
			stroke: "#111111",
		})
	})

	it("the Outline variable colors the ring per row", () => {
		const style = pointStyleResolver(configs(), withOutlineVariable)
		expect(style.colors({ tier: "gold" }, "#abcdef").stroke).toBe("#ff0000")
		expect(style.colors({ tier: "silver" }, "#abcdef").stroke).toBe("#0000ff")
	})

	it("a Shape category's own fill and outline win", () => {
		const style = pointStyleResolver(
			configs({ fillOverrides: { a: "#00ff00" }, strokeOverrides: { a: "#222222" } }),
			{ ...withOutlineVariable, shape: withShape.shape }
		)
		expect(style.colors({ kind: "a", tier: "gold" }, "#abcdef")).toEqual({
			fill: "#00ff00",
			stroke: "#222222",
		})
		// Another category keeps the Color fill and the Outline variable's color.
		expect(style.colors({ kind: "b", tier: "gold" }, "#abcdef")).toEqual({
			fill: "#abcdef",
			stroke: "#ff0000",
		})
	})

	it("the outline is shaded by the Point outline's own level, not the fill's", () => {
		const plain = pointStyleResolver(configs(), emptyScales).colors({}, "#abcdef")
		const shaded = pointStyleResolver(
			configs({}, { brightnessSlots: { outline: { field: null, level: 0.9 } } } as never),
			emptyScales
		).colors({}, "#abcdef")
		expect(shaded.fill).toBe(plain.fill)
		expect(shaded.stroke).not.toBe(plain.stroke)
	})
})
