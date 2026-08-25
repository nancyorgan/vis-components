import { describe, expect, it } from "vitest"

import {
	QUICK_START_CHART_TYPES,
	QUICK_START_VARIATIONS,
	type QuickStartChartType,
	type QuickStartVariation,
} from "./quickStartVariations"
import { ALL_ENCODING_CHANNELS } from "./types"
import type { EncodingChannel, FieldType } from "./types"

/** The table is pure declarative data with no functions of its own, so what
 *  can rot is its INTERNAL CONSISTENCY: a family added to the record but not
 *  to the ordered list (invisible in the icon bar), a `hueFrom` pointing at a
 *  channel the variation never assigns (a silent no-op), a `requiresFlowTarget`
 *  on a variation with no source column, and so on. Every assertion below is
 *  derived from the field docs in quickStartVariations.ts, and none of them
 *  pin the *content* of a particular variation — behavioural assertions about
 *  specific entries live in quickStart.test.ts, alongside the functions that
 *  consume them. */

const FIELD_TYPES: readonly FieldType[] = [
	"quantitative",
	"categorical",
	"temporal",
	"ordinal",
]

/** Every (family, variation) pair, flattened, so each `it` can sweep the whole
 *  table and report which entry tripped it. */
const allVariations = (): Array<
	[QuickStartChartType, QuickStartVariation, number]
> =>
	(Object.keys(QUICK_START_VARIATIONS) as QuickStartChartType[]).flatMap(
		(type) =>
			QUICK_START_VARIATIONS[type].map(
				(v, i) => [type, v, i] as [QuickStartChartType, QuickStartVariation, number]
			)
	)

/** Label used in assertion messages — `name` alone repeats across nothing
 *  today, but the family + index localizes a failure regardless. */
const where = (type: QuickStartChartType, v: QuickStartVariation, i: number) =>
	`${type}[${i}] "${v.name}"`

const channelsOf = (v: QuickStartVariation): EncodingChannel[] =>
	Object.keys(v.channels) as EncodingChannel[]

describe("QUICK_START_CHART_TYPES", () => {
	it("lists exactly the families the variations record defines", () => {
		// QuickStartIconBar renders one button per entry in the ORDERED list and
		// looks the variations up out of the record. A family in one but not the
		// other is either an unreachable button or an invisible chart family.
		expect([...QUICK_START_CHART_TYPES].sort()).toEqual(
			Object.keys(QUICK_START_VARIATIONS).sort()
		)
	})

	it("has no duplicate entries (each family gets one icon-bar button)", () => {
		expect(new Set(QUICK_START_CHART_TYPES).size).toBe(
			QUICK_START_CHART_TYPES.length
		)
	})

	it("gives every family at least one variation to cycle through", () => {
		for (const type of QUICK_START_CHART_TYPES) {
			expect(QUICK_START_VARIATIONS[type].length, type).toBeGreaterThan(0)
		}
	})
})

describe("QUICK_START_VARIATIONS channel declarations", () => {
	it("names every variation uniquely within its family", () => {
		// The name is the cycle's user-facing label; two identical labels in one
		// family make the cycle look stuck.
		for (const type of QUICK_START_CHART_TYPES) {
			const names = QUICK_START_VARIATIONS[type].map((v) => v.name)
			expect(new Set(names).size, type).toBe(names.length)
		}
	})

	it("gives every variation a non-empty name", () => {
		for (const [type, v, i] of allVariations()) {
			expect(v.name.trim(), where(type, v, i)).not.toBe("")
		}
	})

	it("only names real encoding channels, with non-empty valid type lists", () => {
		for (const [type, v, i] of allVariations()) {
			for (const [channel, types] of Object.entries(v.channels)) {
				expect(ALL_ENCODING_CHANNELS, `${where(type, v, i)} → ${channel}`).toContain(
					channel
				)
				// An empty list means "no field type qualifies" — the variation
				// would be permanently unsatisfiable rather than degrading.
				expect(types, `${where(type, v, i)} → ${channel}`).not.toHaveLength(0)
				for (const t of types ?? []) {
					expect(FIELD_TYPES, `${where(type, v, i)} → ${channel}`).toContain(t)
				}
			}
		}
	})

	it("assigns at least one channel unless the variation is geo-detected", () => {
		// A non-geo variation with no channels would scaffold a blank chart. The
		// geo families are the documented exception: their position channels come
		// from `detectGeoFields`, so "Dot map" legitimately declares none.
		for (const [type, v, i] of allVariations()) {
			if (v.geo !== undefined) continue
			expect(channelsOf(v).length, where(type, v, i)).toBeGreaterThan(0)
		}
	})

	it("leaves the geo-detected position channels out of `channels`", () => {
		// Documented on `geo`: choropleth/symbols take the region key on
		// `connection`, points take x/y from detection. Listing them here too
		// would have `assignFields` overwrite the detected fields with random
		// ones.
		for (const [type, v, i] of allVariations()) {
			if (v.geo === undefined) continue
			const detected: EncodingChannel[] =
				v.geo === "points" ? ["x", "y"] : ["connection"]
			for (const channel of detected) {
				expect(v.channels, `${where(type, v, i)} → ${channel}`).not.toHaveProperty(
					channel
				)
			}
		}
	})
})

describe("QUICK_START_VARIATIONS cross-field references", () => {
	it("points `hueFrom` / `connectionFrom` / `dataLabelsValueFrom` at channels the variation actually assigns", () => {
		// These three reuse the field that landed on another channel. A dangling
		// reference isn't a type error — it just silently maps nothing.
		for (const [type, v, i] of allVariations()) {
			const assigned = new Set<EncodingChannel>(channelsOf(v))
			// Geo variations get their detected channels on top of `channels`.
			if (v.geo === "points") {
				assigned.add("x")
				assigned.add("y")
			} else if (v.geo !== undefined) assigned.add("connection")

			for (const key of ["hueFrom", "connectionFrom", "dataLabelsValueFrom"] as const) {
				const target = v[key]
				if (target === undefined) continue
				expect([...assigned], `${where(type, v, i)} → ${key}`).toContain(target)
			}
		}
	})

	it("never both maps hue directly and derives it", () => {
		// `channels.hue`, `hueFrom` and `hueMeasureSource` are three ways to fill
		// the same slot; two at once means one of them loses, quietly.
		for (const [type, v, i] of allVariations()) {
			const sources = [
				v.channels.hue !== undefined,
				v.hueFrom !== undefined,
				v.hueMeasureSource !== undefined,
			].filter(Boolean)
			expect(sources.length, `${where(type, v, i)} hue sources`).toBeLessThan(2)
		}
	})

	it("turns opportunistic hue OFF wherever hue is derived", () => {
		// Opportunistic hue picks a random spare categorical. On a variation that
		// deliberately points hue at an endpoint column (`hueFrom`) or the
		// hierarchy root (`hueMeasureSource`), that random pick would fight the
		// intended coloring.
		for (const [type, v, i] of allVariations()) {
			if (v.hueFrom === undefined && v.hueMeasureSource === undefined) continue
			expect(v.allowOpportunisticHue, where(type, v, i)).toBe(false)
		}
	})

	it("only requires a flow target on variations that map a source column", () => {
		// `requiresFlowTarget` means "a spare categorical must survive the source
		// + value assignment"; without a `connection` source there is nothing for
		// `resolveFlowTargetField` to pick a partner for.
		for (const [type, v, i] of allVariations()) {
			if (v.requiresFlowTarget !== true) continue
			expect(v.channels, where(type, v, i)).toHaveProperty("connection")
		}
	})

	it("maps area + connection on every hierarchy / flow layout", () => {
		// `hierarchyLayout` is written to `connection.hierarchyLayout`, and the
		// chart-mode registry dispatches on the area+connection signature — a
		// layout without both would never reach the intended renderer.
		for (const [type, v, i] of allVariations()) {
			if (v.hierarchyLayout === undefined) continue
			expect(v.channels, where(type, v, i)).toHaveProperty("area")
			expect(v.channels, where(type, v, i)).toHaveProperty("connection")
		}
	})

	it("only sets `connectionFill` where a connection field exists", () => {
		// `connectionFill` writes `connection.fill`; with no connection mapped
		// (directly or via `connectionFrom`) the knob is inert.
		for (const [type, v, i] of allVariations()) {
			if (v.connectionFill === undefined) continue
			const hasConnection =
				v.channels.connection !== undefined || v.connectionFrom !== undefined
			expect(hasConnection, where(type, v, i)).toBe(true)
		}
	})
})

describe("QUICK_START_VARIATIONS distribution overlays", () => {
	it("puts a violin / box overlay on the VALUE axis, opposite the category axis", () => {
		// Documented on `distributionOverlay`: the overlay sits on the value axis,
		// the opposite side from the category axis named in `channels`. Flipping
		// the two silently produces an overlay of the category codes.
		for (const [type, v, i] of allVariations()) {
			const overlay = v.distributionOverlay
			if (overlay === undefined || overlay.mode === "density") continue
			const other = overlay.axis === "x" ? "y" : "x"
			expect(
				v.channels[overlay.axis],
				`${where(type, v, i)} value axis ${overlay.axis}`
			).toContain("quantitative")
			expect(
				v.channels[other],
				`${where(type, v, i)} category axis ${other}`
			).toContain("categorical")
		}
	})

	it("gives a density curve a LONE strictly-quantitative position axis", () => {
		// The density display shares the histogram's gate (strictly quantitative,
		// ordinals read better as bars) and implies the opposite axis, so a
		// second position channel would fight the implied density axis.
		for (const [type, v, i] of allVariations()) {
			const overlay = v.distributionOverlay
			if (overlay?.mode !== "density") continue
			expect(v.channels[overlay.axis], where(type, v, i)).toEqual([
				"quantitative",
			])
			const other = overlay.axis === "x" ? "y" : "x"
			expect(v.channels, where(type, v, i)).not.toHaveProperty(other)
			expect(v.channels, where(type, v, i)).not.toHaveProperty("length")
		}
	})

	it("only sets `densityFill` on a density overlay", () => {
		// `densityFill` lands on the axis's histogram config as `densityFill`; on
		// a violin/box variation it would be written and never read.
		for (const [type, v, i] of allVariations()) {
			if (v.densityFill !== true) continue
			expect(v.distributionOverlay?.mode, where(type, v, i)).toBe("density")
		}
	})
})
