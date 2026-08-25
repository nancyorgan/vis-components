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
			{ featureId: "840", keys: { iso3: "USA" } },
			{ featureId: "124", keys: { iso3: "CAN" } },
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

	// --- name aliases (long-form / variant country names) ---

	const ALIASED_COUNTRIES = [
		{
			featureId: "180",
			keys: {
				iso3: "COD",
				name: "Dem. Rep. Congo",
				nameAliases: [
					"Democratic Republic of the Congo",
					"DRC",
					"Congo-Kinshasa",
				],
			},
		},
		{
			featureId: "178",
			keys: {
				iso3: "COG",
				name: "Congo",
				nameAliases: ["Republic of the Congo", "Congo-Brazzaville"],
			},
		},
		{
			featureId: "840",
			keys: {
				iso3: "USA",
				name: "United States of America",
				nameAliases: ["United States", "USA", "US"],
			},
		},
	]

	it("joins long-form names via nameAliases under the name key type", () => {
		const r = resolveGeography(
			["Democratic Republic of the Congo", "Republic of the Congo"],
			ALIASED_COUNTRIES
		)
		expect(r.keyType).toBe("name")
		expect(r.matched.get("Democratic Republic of the Congo")).toBe("180")
		expect(r.matched.get("Republic of the Congo")).toBe("178")
		expect(r.unmatched).toEqual([])
	})

	it("keeps the two Congos distinct (short + long + informal forms)", () => {
		const r = resolveGeography(
			["Congo", "Congo-Kinshasa", "Congo-Brazzaville", "DRC"],
			ALIASED_COUNTRIES,
			"name"
		)
		expect(r.matched.get("Congo")).toBe("178")
		expect(r.matched.get("Congo-Brazzaville")).toBe("178")
		expect(r.matched.get("Congo-Kinshasa")).toBe("180")
		expect(r.matched.get("DRC")).toBe("180")
		expect(r.unmatched).toEqual([])
	})

	it("normalizes aliases like primary names (case, diacritics, punctuation)", () => {
		const r = resolveGeography(
			["  united states ", "u.s."],
			ALIASED_COUNTRIES,
			"name"
		)
		expect(r.matched.get("  united states ")).toBe("840")
		expect(r.matched.get("u.s.")).toBe("840")
	})

	it("still joins the primary short names when aliases exist (no regression)", () => {
		const r = resolveGeography(
			["Dem. Rep. Congo", "United States of America"],
			ALIASED_COUNTRIES,
			"name"
		)
		expect(r.matched.get("Dem. Rep. Congo")).toBe("180")
		expect(r.matched.get("United States of America")).toBe("840")
	})

	it("an alias claimed by two features is ambiguous and matches nothing", () => {
		const table = [
			{ featureId: "A", keys: { name: "Alpha", nameAliases: ["Shared"] } },
			{ featureId: "B", keys: { name: "Beta", nameAliases: ["Shared"] } },
		]
		const r = resolveGeography(["Shared", "Alpha"], table, "name")
		expect(r.matched.get("Alpha")).toBe("A")
		expect(r.unmatched).toEqual(["Shared"])
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

// --- ZIP/ZCTA join normalization ---------------------------------------
// ZCTA codes are 5-digit strings under the dedicated "zip" key type. The
// classic trap: numeric CSV columns lose leading zeros ("00601" parses to
// 601), so the input side left-pads digits to 5 before matching.

const ZCTA_TABLE = [
	{ featureId: "00601", keys: { zip: "00601" } },
	{ featureId: "02134", keys: { zip: "02134" } },
	{ featureId: "90210", keys: { zip: "90210" } },
]

describe("resolveGeography (zip)", () => {
	it("auto-detects zip keys on a ZCTA table", () => {
		const r = resolveGeography(["90210", "02134"], ZCTA_TABLE)
		expect(r.keyType).toBe("zip")
		expect(r.matched.get("90210")).toBe("90210")
		expect(r.matched.get("02134")).toBe("02134")
	})

	it("left-pads digits that lost leading zeros ('601' -> '00601', '2134' -> '02134')", () => {
		const r = resolveGeography(["601", "2134"], ZCTA_TABLE, "zip")
		expect(r.matched.get("601")).toBe("00601")
		expect(r.matched.get("2134")).toBe("02134")
		expect(r.unmatched).toEqual([])
	})

	it("auto-detects zip even when every code arrived unpadded", () => {
		const r = resolveGeography(["601", "2134", "90210"], ZCTA_TABLE)
		expect(r.keyType).toBe("zip")
		expect(r.matched.size).toBe(3)
	})

	it("matches ZIP+4 values by their 5-digit prefix", () => {
		const r = resolveGeography(["90210-1234", "02134-0001"], ZCTA_TABLE, "zip")
		expect(r.matched.get("90210-1234")).toBe("90210")
		expect(r.matched.get("02134-0001")).toBe("02134")
	})

	it("trims whitespace and reports non-joining values as unmatched", () => {
		const r = resolveGeography(["  90210  ", "not-a-zip"], ZCTA_TABLE, "zip")
		expect(r.matched.get("  90210  ")).toBe("90210")
		expect(r.unmatched).toEqual(["not-a-zip"])
	})

	it("never joins a fips column against zip keys (distinct key types)", () => {
		// A ZCTA table indexes NO fips keys, so a fips override matches nothing
		// — county-FIPS columns can't silently mis-join a ZCTA map.
		const r = resolveGeography(["00601", "90210"], ZCTA_TABLE, "fips")
		expect(r.keyType).toBe("fips")
		expect(r.matched.size).toBe(0)
	})
})
