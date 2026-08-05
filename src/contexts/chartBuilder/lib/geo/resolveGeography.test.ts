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

	it("drops keys claimed by two different features (ambiguous -> unmatched)", () => {
		// ~444 county names repeat across states; silently first-writer-winning
		// would mis-map, so an ambiguous key matches nothing.
		const table = [
			{ featureId: "53061", keys: { name: "Washington" } },
			{ featureId: "53063", keys: { name: "Washington" } },
		]
		const r = resolveGeography(["Washington"], table, "name")
		expect(r.matched.size).toBe(0)
		expect(r.unmatched).toEqual(["Washington"])
	})

	it("re-adding a key from the SAME feature is not ambiguous", () => {
		// A row whose iso fields repeat the same code must keep its key.
		const table = [
			{ featureId: "840", keys: { iso: "USA", iso3: "USA" } },
		]
		const r = resolveGeography(["USA"], table, "iso")
		expect(r.matched.get("USA")).toBe("840")
	})

	it("normalizeName variants", () => {
		expect(normalizeName("  California  ")).toBe("california")
		expect(normalizeName("St. Louis County")).toBe("saint louis")
		expect(normalizeName("St Charles Parish")).toBe("saint charles")
		// Diacritics fold so "Dona Ana" data joins the "Doña Ana" geometry.
		expect(normalizeName("Doña Ana, NM")).toBe("dona ana nm")
		expect(normalizeName("De  Soto")).toBe("de soto")
		// Census designators strip; a trailing "city" does NOT (it separates
		// independent cities from their same-named counties).
		expect(normalizeName("Yukon-Koyukuk Census Area")).toBe("yukon-koyukuk")
		expect(normalizeName("Anchorage Municipality")).toBe("anchorage")
		expect(normalizeName("Juneau City and Borough")).toBe("juneau")
		expect(normalizeName("Matanuska-Susitna Borough")).toBe(
			"matanuska-susitna"
		)
		expect(normalizeName("Baltimore city")).toBe("baltimore city")
	})

	// --- counties (5-digit fips + state-qualified names) ---

	const COUNTY_TABLE = [
		{
			featureId: "48477",
			keys: { fips: "48477", name: "Washington", stateFips: "48" },
		},
		{
			featureId: "53061",
			keys: { fips: "53061", name: "Snohomish", stateFips: "53" },
		},
		{
			featureId: "24005",
			keys: { fips: "24005", name: "Baltimore", stateFips: "24" },
		},
		{
			featureId: "24510",
			keys: { fips: "24510", name: "Baltimore city", stateFips: "24" },
		},
		{
			featureId: "31177",
			keys: { fips: "31177", name: "Washington", stateFips: "31" },
		},
	]

	it("matches unpadded county fips ('6037'-style, 4 digits -> 5)", () => {
		const r = resolveGeography(["48477", "8477"], [
			...COUNTY_TABLE,
			{
				featureId: "08477",
				keys: { fips: "08477", name: "Fake", stateFips: "08" },
			},
		])
		expect(r.keyType).toBe("fips")
		expect(r.matched.get("48477")).toBe("48477")
		expect(r.matched.get("8477")).toBe("08477")
	})

	it("joins state-qualified county names via abbrev, full name, and fips qualifiers", () => {
		const r = resolveGeography(
			[
				"Washington County, TX",
				"Washington, Nebraska",
				"Snohomish County, 53",
			],
			COUNTY_TABLE,
			"name"
		)
		expect(r.matched.get("Washington County, TX")).toBe("48477")
		expect(r.matched.get("Washington, Nebraska")).toBe("31177")
		expect(r.matched.get("Snohomish County, 53")).toBe("53061")
		expect(r.unmatched).toEqual([])
	})

	it("bare duplicated county names stay unmatched; unique bare names join", () => {
		const r = resolveGeography(
			["Washington", "Snohomish County"],
			COUNTY_TABLE,
			"name"
		)
		expect(r.matched.get("Snohomish County")).toBe("53061")
		expect(r.unmatched).toEqual(["Washington"])
	})

	it("splits independent-city / county pairs on the ' city' suffix", () => {
		const r = resolveGeography(
			["Baltimore County, MD", "Baltimore city, MD"],
			COUNTY_TABLE,
			"name"
		)
		expect(r.matched.get("Baltimore County, MD")).toBe("24005")
		expect(r.matched.get("Baltimore city, MD")).toBe("24510")
	})

	it("auto-detects name over fips for qualified county name columns", () => {
		const r = resolveGeography(
			["Washington County, TX", "Baltimore County, MD"],
			COUNTY_TABLE
		)
		expect(r.keyType).toBe("name")
		expect(r.matched.size).toBe(2)
	})
})
