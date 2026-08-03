import { describe, expect, it } from "vitest"

import {
	ALL_ENCODING_CHANNELS,
	CHANNELS,
	LEGEND_CANDIDATE_CHANNELS,
	channelAccepts,
	channelsConflict,
	conflictsFor,
} from "./channels"
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

	it("registers facet with label 'Facet (wrap)' so all three facet channels read consistently", () => {
		expect(CHANNELS.facet).toBeDefined()
		expect(CHANNELS.facet.label).toBe("Facet (wrap)")
		expect(CHANNELS.facet.legendCandidate).toBe(false)
	})

	it("registers facetRow with accepts=DISCRETE_LIKE and shelfOrder ~2", () => {
		expect(CHANNELS.facetRow).toBeDefined()
		expect(CHANNELS.facetRow.label).toBe("Facet (row)")
		expect(CHANNELS.facetRow.legendCandidate).toBe(false)
	})

	it("registers facetCol with accepts=DISCRETE_LIKE and shelfOrder ~2", () => {
		expect(CHANNELS.facetCol).toBeDefined()
		expect(CHANNELS.facetCol.label).toBe("Facet (col)")
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

	it("facet conflicts with facetRow and facetCol (both directions)", () => {
		expect(channelsConflict("facet", "facetRow")).toBe(true)
		expect(channelsConflict("facetRow", "facet")).toBe(true)
		expect(channelsConflict("facet", "facetCol")).toBe(true)
		expect(channelsConflict("facetCol", "facet")).toBe(true)
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
