import { describe, expect, it } from "vitest"

import type { ChannelConfigs, ConnectionConfig } from "./channelConfig"
import { sampleMarkersByConnection } from "./connectionSampling"

const configs = (connection: Partial<ConnectionConfig>): ChannelConfigs =>
	({ connection }) as ChannelConfigs

/** Two connection groups laid out so encounter order ≠ sort-key order. */
const items = [
	{ i: 0, sort: 30, row: { grp: "a" } },
	{ i: 1, sort: 10, row: { grp: "a" } },
	{ i: 2, sort: 20, row: { grp: "a" } },
	{ i: 3, sort: 2, row: { grp: "b" } },
	{ i: 4, sort: 1, row: { grp: "b" } },
	{ i: 5, sort: 5, row: {} }, // no connection value → ungrouped
]

const sample = (connection: Partial<ConnectionConfig>) =>
	sampleMarkersByConnection(items, "grp", configs(connection), (m) => m.sort)

describe("sampleMarkersByConnection", () => {
	it('returns null (no filtering) for "all"', () => {
		expect(sample({ pointSampling: "all" })).toBeNull()
	})

	it("returns null for an unrecognized / legacy-null sampling value", () => {
		expect(
			sample({ pointSampling: null as unknown as "all" })
		).toBeNull()
		expect(
			sample({ pointSampling: "bogus" as unknown as "all" })
		).toBeNull()
	})

	it('returns an empty set for "none" (lines draw, no markers)', () => {
		expect(sample({ pointSampling: "none" })).toEqual(new Set())
	})

	it("keeps the sort-key-first item per group plus every ungrouped item", () => {
		// Group a's lowest sort key is i=1 (not the first-encountered i=0);
		// group b's is i=4. The ungrouped i=5 always renders.
		expect(sample({ pointSampling: "first-only" })).toEqual(
			new Set([1, 4, 5])
		)
	})

	it("keeps first and last by sort key per group", () => {
		expect(sample({ pointSampling: "first-and-last" })).toEqual(
			new Set([0, 1, 3, 4, 5])
		)
	})
})
