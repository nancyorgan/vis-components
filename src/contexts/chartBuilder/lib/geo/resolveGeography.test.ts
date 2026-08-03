import { describe, expect, it } from "vitest"

import { normalizeName, resolveGeography } from "./resolveGeography"

const TABLE = [
	{ featureId: "06", keys: { fips: "06", abbrev: "CA", name: "California" } },
	{ featureId: "48", keys: { fips: "48", abbrev: "TX", name: "Texas" } },
]

describe("resolveGeography", () => {
	it("auto-detects abbreviation keys", () => {
		const r = resolveGeography(["CA", "TX"], TABLE)
		expect(r.keyType).toBe("abbrev")
		expect(r.matched.get("CA")).toBe("06")
		expect(r.unmatched).toEqual([])
	})
	it("auto-detects FIPS keys", () => {
		expect(resolveGeography(["06", "48"], TABLE).keyType).toBe("fips")
	})
	it("normalizes names (St. == Saint, trailing County)", () => {
		expect(normalizeName("St. Louis County")).toBe("saint louis")
	})
	it("reports unmatched values", () => {
		const r = resolveGeography(["CA", "ZZ"], TABLE)
		expect(r.unmatched).toEqual(["ZZ"])
	})
	it("honors a keyType override even on a worse match rate", () => {
		const r = resolveGeography(["California"], TABLE, "name")
		expect(r.keyType).toBe("name")
		expect(r.matched.get("California")).toBe("06")
	})

	// --- robustness ---

	it("matches unpadded numeric fips ('6' -> '06')", () => {
		const r = resolveGeography(["6", "48"], TABLE)
		expect(r.keyType).toBe("fips")
		expect(r.matched.get("6")).toBe("06")
		expect(r.matched.get("48")).toBe("48")
	})

	it("uppercases abbreviations before matching ('ca' -> CA)", () => {
		const r = resolveGeography(["ca", "tx"], TABLE)
		expect(r.keyType).toBe("abbrev")
		expect(r.matched.get("ca")).toBe("06")
	})

	it("trims surrounding whitespace on inputs", () => {
		const r = resolveGeography(["  CA  "], TABLE)
		expect(r.matched.get("  CA  ")).toBe("06")
	})

	it("matches names with trailing County and St. abbreviation", () => {
		const table = [
			{ featureId: "29189", keys: { name: "St. Louis County" } },
		]
		const r = resolveGeography(["Saint Louis"], table)
		expect(r.keyType).toBe("name")
		expect(r.matched.get("Saint Louis")).toBe("29189")
	})

	it("override to a keyType with zero matches still returns that keyType, all unmatched", () => {
		const r = resolveGeography(["CA", "TX"], TABLE, "name")
		expect(r.keyType).toBe("name")
		expect(r.matched.size).toBe(0)
		expect(r.unmatched).toEqual(["CA", "TX"])
	})

	it("breaks score ties by priority order (fips before name)", () => {
		// "06" matches fips; "California" matches name. Each key type scores 1,
		// so the tie-break (fips first) decides.
		const r = resolveGeography(["06", "California"], TABLE)
		expect(r.keyType).toBe("fips")
		expect(r.matched.get("06")).toBe("06")
		expect(r.unmatched).toEqual(["California"])
	})

	it("handles empty input (defaults to highest-priority key type)", () => {
		const r = resolveGeography([], TABLE)
		expect(r.keyType).toBe("fips")
		expect(r.matched.size).toBe(0)
		expect(r.unmatched).toEqual([])
	})

	it("ignores blank/null-ish values and de-duplicates inputs", () => {
		const r = resolveGeography(["CA", "CA", "", "  "], TABLE)
		expect([...r.matched.keys()]).toEqual(["CA"])
		expect(r.unmatched).toEqual([])
	})

	it("auto-detects iso keys", () => {
		const table = [
			{ featureId: "840", keys: { iso: "USA" } },
			{ featureId: "124", keys: { iso: "CAN" } },
		]
		const r = resolveGeography(["USA", "CAN"], table)
		expect(r.keyType).toBe("iso")
		expect(r.matched.get("USA")).toBe("840")
		expect(r.matched.get("CAN")).toBe("124")
		expect(r.unmatched).toEqual([])
	})

	// --- country ISO codes (phase 2) ---

	// A countries-style lookup table: only ISO keys + name, NO fips/abbrev.
	const COUNTRIES = [
		{
			featureId: "840",
			keys: {
				iso2: "US",
				iso3: "USA",
				isoNumeric: "840",
				name: "United States of America",
			},
		},
		{
			featureId: "124",
			keys: {
				iso2: "CA",
				iso3: "CAN",
				isoNumeric: "124",
				name: "Canada",
			},
		},
	]

	it("auto-detects alpha-2 ISO country codes as iso", () => {
		const r = resolveGeography(["US", "CA"], COUNTRIES)
		expect(r.keyType).toBe("iso")
		expect(r.matched.get("US")).toBe("840")
		expect(r.matched.get("CA")).toBe("124")
		expect(r.unmatched).toEqual([])
	})

	it("auto-detects alpha-3 ISO country codes as iso", () => {
		const r = resolveGeography(["USA", "CAN"], COUNTRIES)
		expect(r.keyType).toBe("iso")
		expect(r.matched.get("USA")).toBe("840")
		expect(r.matched.get("CAN")).toBe("124")
		expect(r.unmatched).toEqual([])
	})

	it("auto-detects numeric ISO country codes as iso, not fips", () => {
		const r = resolveGeography(["840", "124"], COUNTRIES)
		expect(r.keyType).toBe("iso")
		expect(r.matched.get("840")).toBe("840")
		expect(r.matched.get("124")).toBe("124")
		expect(r.unmatched).toEqual([])
	})

	it("auto-detects country names as name", () => {
		const r = resolveGeography(
			["United States of America", "Canada"],
			COUNTRIES,
		)
		expect(r.keyType).toBe("name")
		expect(r.matched.get("United States of America")).toBe("840")
		expect(r.matched.get("Canada")).toBe("124")
		expect(r.unmatched).toEqual([])
	})

	it("reports unmatched country ISO codes (partial)", () => {
		const r = resolveGeography(["US", "ZZ"], COUNTRIES)
		expect(r.keyType).toBe("iso")
		expect(r.matched.get("US")).toBe("840")
		expect(r.unmatched).toEqual(["ZZ"])
	})

	it("honors a keyType override to iso for country codes", () => {
		const r = resolveGeography(["us", "can", "840"], COUNTRIES, "iso")
		expect(r.keyType).toBe("iso")
		expect(r.matched.get("us")).toBe("840")
		expect(r.matched.get("can")).toBe("124")
		expect(r.matched.get("840")).toBe("840")
	})

	it("collapses duplicate table keys to the first row (first writer wins)", () => {
		const table = [
			{ featureId: "53061", keys: { name: "Washington" } },
			{ featureId: "53063", keys: { name: "Washington" } },
		]
		const r = resolveGeography(["Washington"], table, "name")
		expect(r.matched.get("Washington")).toBe("53061")
	})

	it("normalizeName variants", () => {
		expect(normalizeName("  California  ")).toBe("california")
		expect(normalizeName("St. Louis County")).toBe("saint louis")
		expect(normalizeName("St Charles Parish")).toBe("saint charles")
		expect(normalizeName("Doña Ana, NM")).toBe("doña ana nm")
		expect(normalizeName("De  Soto")).toBe("de soto")
	})
})
