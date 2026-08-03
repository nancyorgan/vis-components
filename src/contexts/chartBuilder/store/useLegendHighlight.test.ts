import { describe, expect, it } from "vitest"

import { DEFAULT_HOVER_HIGHLIGHT_COLOR } from "../lib/labelsConfig"
import type { AestheticScales } from "./useAestheticScales"
import {
	groupHighlight,
	rowHighlight,
	LEGEND_HIGHLIGHT_DIM,
	NEUTRAL_HIGHLIGHT,
	type LegendHighlight,
} from "./useLegendHighlight"

/** Build the `LegendHighlight` shape `useLegendHighlight` returns, without
 * standing up the atom/store — the pure `resolve` logic is what we test.
 * Mirrors the default appearance options (recolor on, outline off, fade at
 * 0.85 → others drop to 0.15). */
const highlightFor = (
	field: string,
	value: string,
	opts: { recolor?: boolean; outline?: boolean; fadedOpacity?: number } = {}
): LegendHighlight => {
	const recolor = opts.recolor ?? true
	const outline = opts.outline ?? false
	const fadedOpacity = opts.fadedOpacity ?? LEGEND_HIGHLIGHT_DIM
	const color = DEFAULT_HOVER_HIGHLIGHT_COLOR
	return {
		field,
		value,
		resolve: (v) =>
			String(v) === value
				? {
						matched: true,
						opacityMul: 1,
						fill: recolor ? color : null,
						outline: outline ? color : null,
						outlineWidth: 2,
					}
				: {
						matched: false,
						opacityMul: fadedOpacity,
						fill: null,
						outline: null,
						outlineWidth: 2,
					},
	}
}

describe("rowHighlight", () => {
	it("returns the neutral result when nothing is hovered", () => {
		expect(rowHighlight(null, { region: "West" })).toEqual(NEUTRAL_HIGHLIGHT)
	})

	it("recolors + keeps a matching row, fades a non-matching one", () => {
		const hl = highlightFor("region", "West")
		expect(rowHighlight(hl, { region: "West" })).toEqual({
			matched: true,
			opacityMul: 1,
			fill: DEFAULT_HOVER_HIGHLIGHT_COLOR,
			outline: null,
			outlineWidth: 2,
		})
		expect(rowHighlight(hl, { region: "East" })).toEqual({
			matched: false,
			opacityMul: LEGEND_HIGHLIGHT_DIM,
			fill: null,
			outline: null,
			outlineWidth: 2,
		})
	})

	it("passes through an outline color for matched marks when outline is on", () => {
		const hl = highlightFor("region", "West", { outline: true })
		expect(rowHighlight(hl, { region: "West" }).outline).toBe(
			DEFAULT_HOVER_HIGHLIGHT_COLOR
		)
	})

	it("leaves a row missing the hovered field untouched (unrelated legend)", () => {
		const hl = highlightFor("region", "West")
		expect(rowHighlight(hl, { product: "Widget" })).toEqual(NEUTRAL_HIGHLIGHT)
	})

	it("compares by stringified value", () => {
		const hl = highlightFor("year", "2024")
		expect(rowHighlight(hl, { year: 2024 }).matched).toBe(true)
		expect(rowHighlight(hl, { year: 2023 }).matched).toBe(false)
	})
})

describe("groupHighlight", () => {
	// Minimal aesthetic-scale stub: only the field names are read.
	const scales = {
		hue: { field: { name: "region", type: "categorical" } },
	} as unknown as AestheticScales

	it("returns neutral when nothing is hovered", () => {
		expect(groupHighlight(null, { hue: "West" }, scales)).toEqual(
			NEUTRAL_HIGHLIGHT
		)
	})

	it("matches the group channel whose field is the hovered field", () => {
		const hl = highlightFor("region", "West")
		expect(groupHighlight(hl, { hue: "West" }, scales).matched).toBe(true)
		expect(groupHighlight(hl, { hue: "East" }, scales).opacityMul).toBe(
			LEGEND_HIGHLIGHT_DIM
		)
	})

	it("leaves the mark untouched when the hovered field isn't a group channel here", () => {
		const hl = highlightFor("product", "Widget")
		expect(groupHighlight(hl, { hue: "West" }, scales)).toEqual(
			NEUTRAL_HIGHLIGHT
		)
	})
})
