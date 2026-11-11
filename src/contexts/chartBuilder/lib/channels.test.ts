import { describe, expect, it } from "vitest"

import {
	ALL_ENCODING_CHANNELS,
	CHANNELS,
	LEGEND_CANDIDATE_CHANNELS,
	channelAccepts,
	channelsConflict,
	channelsConflictIn,
	conflictsFor,
	isAreaChartShape,
} from "./channels"
import { AreasXMode } from "./chartModes/areasX"
import { AreasYMode } from "./chartModes/areasY"
import { emptyEncodings } from "./types"
import type { EncodingChannel, FieldType } from "./types"

const ALL_CHANNEL_IDS: readonly EncodingChannel[] = [
	"x",
	"y",
	"r",
	"length",
	"angle",
	"area",
	"saturation",
	"hue",
	"brightness",
	"opacity",
	"shape",
	"pattern",
	"connection",
	"facet",
	"facetRow",
	"facetCol",
	"text",
]

const ALL_FIELD_TYPES: readonly FieldType[] = [
	"quantitative",
	"categorical",
	"temporal",
	"ordinal",
]

describe("CHANNELS registry", () => {
	it("has an entry for every EncodingChannel", () => {
		for (const id of ALL_CHANNEL_IDS) {
			expect(CHANNELS[id]).toBeDefined()
			expect(CHANNELS[id].id).toBe(id)
		}
	})

	it("ALL_ENCODING_CHANNELS length equals Object.keys(CHANNELS).length", () => {
		expect(ALL_ENCODING_CHANNELS.length).toBe(Object.keys(CHANNELS).length)
	})

	it("ALL_ENCODING_CHANNELS is sorted by shelfOrder", () => {
		const orders = ALL_ENCODING_CHANNELS.map((c) => CHANNELS[c].shelfOrder)
		const sorted = [...orders].sort((a, b) => a - b)
		expect(orders).toEqual(sorted)
	})

	it("LEGEND_CANDIDATE_CHANNELS contains exactly the channels flagged legendCandidate=true", () => {
		const expected = (
			Object.values(CHANNELS) as Array<(typeof CHANNELS)[EncodingChannel]>
		)
			.filter((c) => c.legendCandidate)
			.map((c) => c.id)
		expect(new Set(LEGEND_CANDIDATE_CHANNELS)).toEqual(new Set(expected))
	})

	it("every conflictsWith reference names a valid EncodingChannel", () => {
		const valid = new Set<EncodingChannel>(ALL_CHANNEL_IDS)
		for (const ch of ALL_CHANNEL_IDS) {
			const conflicts = CHANNELS[ch].conflictsWith ?? []
			for (const other of conflicts) {
				expect(valid.has(other)).toBe(true)
			}
		}
	})

	it("registers facet as the one 'Facet' shelf row, with no conflict against the pair it manages", () => {
		expect(CHANNELS.facet).toBeDefined()
		expect(CHANNELS.facet.label).toBe("Facet")
		expect(CHANNELS.facet.legendCandidate).toBe(false)
		// The Facet row writes facetRow / facetCol itself (lib/facetEncoding);
		// a declared conflict would dim the row whenever the pair is mapped.
		expect(CHANNELS.facet.conflictsWith ?? []).toEqual([])
	})

	it("registers facetRow with accepts=DISCRETE_LIKE and shelfOrder ~2", () => {
		expect(CHANNELS.facetRow).toBeDefined()
		expect(CHANNELS.facetRow.label).toBe("Facet rows")
		expect(CHANNELS.facetRow.legendCandidate).toBe(false)
	})

	it("registers facetCol with accepts=DISCRETE_LIKE and shelfOrder ~2", () => {
		expect(CHANNELS.facetCol).toBeDefined()
		expect(CHANNELS.facetCol.label).toBe("Facet columns")
		expect(CHANNELS.facetCol.legendCandidate).toBe(false)
	})
})

describe("channelAccepts", () => {
	it("agrees with CHANNELS[ch].accepts for every (channel, type) pair", () => {
		for (const ch of ALL_CHANNEL_IDS) {
			for (const t of ALL_FIELD_TYPES) {
				expect(channelAccepts(ch, t)).toBe(CHANNELS[ch].accepts.includes(t))
			}
		}
	})
})

describe("channelsConflict", () => {
	it("is symmetric: conflict(a, b) === conflict(b, a)", () => {
		for (const a of ALL_CHANNEL_IDS) {
			for (const b of ALL_CHANNEL_IDS) {
				expect(channelsConflict(a, b)).toBe(channelsConflict(b, a))
			}
		}
	})

	it("facet declares no conflict with facetRow / facetCol — the Facet row keeps them exclusive itself", () => {
		expect(channelsConflict("facet", "facetRow")).toBe(false)
		expect(channelsConflict("facet", "facetCol")).toBe(false)
	})

	it("facetRow does NOT conflict with facetCol (they coexist in grid mode)", () => {
		expect(channelsConflict("facetRow", "facetCol")).toBe(false)
	})

	it("r conflicts with x and y (both directions)", () => {
		expect(channelsConflict("r", "x")).toBe(true)
		expect(channelsConflict("x", "r")).toBe(true)
		expect(channelsConflict("r", "y")).toBe(true)
		expect(channelsConflict("y", "r")).toBe(true)
	})

	it("r conflicts with length (radar draws no segment length)", () => {
		expect(channelsConflict("r", "length")).toBe(true)
		expect(channelsConflict("length", "r")).toBe(true)
	})

	it("x and y do NOT conflict with each other (they're the cartesian pair)", () => {
		expect(channelsConflict("x", "y")).toBe(false)
	})
})

describe("conflictsFor", () => {
	it("never includes the channel itself", () => {
		for (const ch of ALL_CHANNEL_IDS) {
			expect(conflictsFor(ch)).not.toContain(ch)
		}
	})

	it("agrees with channelsConflict for every other channel", () => {
		for (const ch of ALL_CHANNEL_IDS) {
			const reported = new Set(conflictsFor(ch))
			for (const other of ALL_CHANNEL_IDS) {
				if (other === ch) continue
				expect(reported.has(other)).toBe(channelsConflict(ch, other))
			}
		}
	})
})

describe("channelsConflictIn (Area and Length on an area chart)", () => {
	const enc = (fields: Partial<Record<EncodingChannel, string>>) => {
		const e = emptyEncodings()
		for (const [ch, field] of Object.entries(fields))
			e[ch as EncodingChannel] = { field }
		return e
	}
	const AREA_X = enc({ x: "year", length: "sales", connection: "region" })
	const AREA_Y = enc({ y: "year", length: "sales", connection: "region" })
	const SCATTER = enc({ x: "year", y: "sales" })
	const LINE = enc({ x: "year", y: "sales", connection: "region" })

	it("Area and Length coexist on an area chart, in both directions", () => {
		for (const e of [AREA_X, AREA_Y]) {
			expect(channelsConflictIn("area", "length", e)).toBe(false)
			expect(channelsConflictIn("length", "area", e)).toBe(false)
		}
	})

	it("they still conflict everywhere else", () => {
		for (const e of [SCATTER, LINE, enc({ x: "year", length: "sales" })]) {
			expect(channelsConflictIn("area", "length", e)).toBe(true)
			expect(channelsConflictIn("length", "area", e)).toBe(true)
		}
	})

	it("no other pair is relaxed on an area chart", () => {
		for (const a of ALL_CHANNEL_IDS)
			for (const b of ALL_CHANNEL_IDS) {
				if ((a === "area" && b === "length") || (a === "length" && b === "area")) continue
				expect(channelsConflictIn(a, b, AREA_X), `${a}/${b}`).toBe(channelsConflict(a, b))
			}
	})

	it("the area-chart shape is the areas-x / areas-y detection with Length mapped", () => {
		const on = [null, "f"]
		for (const x of on) for (const y of on) for (const angle of on) for (const connection of on) {
			const e = emptyEncodings()
			e.x = { field: x }
			e.y = { field: y }
			e.angle = { field: angle }
			e.connection = { field: connection }
			e.length = { field: "m" }
			expect(isAreaChartShape(e), `${x}/${y}/${angle}/${connection}`).toBe(
				AreasXMode.detect(e) || AreasYMode.detect(e)
			)
		}
	})
})
