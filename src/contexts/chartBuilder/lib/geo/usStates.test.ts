import { describe, expect, it } from "vitest"

import { US_STATES, stateLookup } from "./usStates"

describe("usStates", () => {
	it("has 51 entries (50 states + DC)", () => {
		expect(US_STATES).toHaveLength(51)
	})
	it("maps CA / 06 / California to the same FIPS", () => {
		expect(stateLookup.byAbbrev.get("CA")?.fips).toBe("06")
		expect(stateLookup.byFips.get("06")?.abbrev).toBe("CA")
		expect(stateLookup.byName.get("california")?.fips).toBe("06")
	})
	it("has well-formed rows (2-char fips, 2-char uppercase abbrev, no duplicates)", () => {
		for (const row of US_STATES) {
			expect(row.fips).toMatch(/^\d{2}$/)
			expect(row.abbrev).toMatch(/^[A-Z]{2}$/)
			expect(row.name.length).toBeGreaterThan(0)
		}
		expect(new Set(US_STATES.map((r) => r.fips)).size).toBe(51)
		expect(new Set(US_STATES.map((r) => r.abbrev)).size).toBe(51)
		expect(new Set(US_STATES.map((r) => r.name)).size).toBe(51)
	})
})
