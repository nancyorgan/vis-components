/**
 * Long-form / variant name table for the world-atlas country set.
 *
 * world-atlas `countries-110m.json` renders SHORT feature names ("Dem. Rep.
 * Congo", "Central African Rep.", "S. Sudan"). Real-world CSVs carry the full
 * names ("Democratic Republic of the Congo") and common variants ("USA",
 * "South Korea" as "Republic of Korea", World Bank's "Congo, Dem. Rep."), so
 * without this table those rows silently fail the name join.
 *
 * One table serves both directions:
 * - JOIN: `countryNameAliases(numeric)` feeds the countries lookup table's
 *   `nameAliases` (see loadGeometry / resolveGeography), so every listed form
 *   joins its feature under the "name" key type.
 * - DISPLAY: `fullCountryName(raw)` resolves any recognizable country value
 *   (short/long/variant name, ISO alpha-2/alpha-3, 3-digit numeric) to its
 *   preferred long form — the data-label "Full country name" format
 *   (`COUNTRY_NAME_FORMAT`) prints labels through it.
 *
 * Invariants (enforced by countryNames.test.ts):
 * - `numeric` is the canonical feature id the countries bundle assigns
 *   (3-digit ISO numeric; the synthetic ids for Kosovo / N. Cyprus /
 *   Somaliland), and `atlas` is the feature's `properties.name` verbatim.
 * - Every alias is UNAMBIGUOUS after `normalizeName`: no alias collides with
 *   another country's atlas name, full name, or aliases. Genuinely ambiguous
 *   forms (bare "Korea", "Congo" for the DRC, "America") are deliberately
 *   absent — better unmatched than silently wrong.
 */
import { countryLookup } from "./isoCountries"
import { normalizeName } from "./resolveGeography"

export type CountryNameRow = {
	/** Canonical countries-bundle feature id (3-digit ISO numeric, or the
	 *  synthetic ids "383" / "900" / "901" for the id-less disputed features). */
	numeric: string
	/** The world-atlas feature's `properties.name`, verbatim. */
	atlas: string
	/** Preferred long/full display form when the atlas name is abbreviated or
	 *  outdated. Omitted when the atlas name already IS the full name. */
	full?: string
	/** Additional variant names that JOIN to this country (never displayed). */
	aliases?: string[]
}

export const COUNTRY_NAME_ROWS: readonly CountryNameRow[] = [
	// --- abbreviated / outdated atlas names → full form ---------------------
	{
		numeric: "070",
		atlas: "Bosnia and Herz.",
		full: "Bosnia and Herzegovina",
		aliases: ["Bosnia", "Bosnia & Herzegovina"],
	},
	{
		numeric: "140",
		atlas: "Central African Rep.",
		full: "Central African Republic",
	},
	{
		numeric: "180",
		atlas: "Dem. Rep. Congo",
		full: "Democratic Republic of the Congo",
		aliases: [
			"Democratic Republic of Congo",
			"DR Congo",
			"DRC",
			"Congo-Kinshasa",
			"Congo, Dem. Rep.",
			"Zaire",
		],
	},
	{
		// The OTHER Congo. Its atlas name is the bare "Congo"; the full form
		// disambiguates it from the DRC on labels. No alias here (and none
		// above) may ever normalize to a form the DRC also claims.
		numeric: "178",
		atlas: "Congo",
		full: "Republic of the Congo",
		aliases: ["Republic of Congo", "Congo-Brazzaville", "Congo, Rep."],
	},
	{ numeric: "214", atlas: "Dominican Rep.", full: "Dominican Republic" },
	{ numeric: "226", atlas: "Eq. Guinea", full: "Equatorial Guinea" },
	{
		numeric: "238",
		atlas: "Falkland Is.",
		full: "Falkland Islands",
		aliases: ["Falkland Islands (Malvinas)"],
	},
	{
		numeric: "260",
		atlas: "Fr. S. Antarctic Lands",
		full: "French Southern and Antarctic Lands",
		aliases: ["French Southern Territories"],
	},
	{ numeric: "090", atlas: "Solomon Is.", full: "Solomon Islands" },
	{ numeric: "728", atlas: "S. Sudan", full: "South Sudan" },
	{ numeric: "732", atlas: "W. Sahara", full: "Western Sahara" },
	{
		numeric: "900",
		atlas: "N. Cyprus",
		full: "Northern Cyprus",
		aliases: ["Turkish Republic of Northern Cyprus"],
	},
	{
		numeric: "748",
		atlas: "eSwatini",
		full: "Eswatini",
		aliases: ["Swaziland", "Kingdom of Eswatini"],
	},
	{
		numeric: "807",
		atlas: "Macedonia",
		full: "North Macedonia",
		aliases: [
			"Republic of North Macedonia",
			"Former Yugoslav Republic of Macedonia",
			"Macedonia, FYR",
		],
	},
	{ numeric: "203", atlas: "Czechia", full: "Czech Republic" },
	{
		numeric: "270",
		atlas: "Gambia",
		full: "The Gambia",
		aliases: ["Gambia, The"],
	},
	{
		numeric: "044",
		atlas: "Bahamas",
		full: "The Bahamas",
		aliases: ["Bahamas, The"],
	},

	// --- atlas name already full; common variants join ----------------------
	{
		numeric: "840",
		atlas: "United States of America",
		aliases: ["United States", "USA", "US"],
	},
	{
		numeric: "826",
		atlas: "United Kingdom",
		aliases: [
			"UK",
			"Great Britain",
			"Britain",
			"United Kingdom of Great Britain and Northern Ireland",
		],
	},
	{ numeric: "643", atlas: "Russia", aliases: ["Russian Federation"] },
	{ numeric: "104", atlas: "Myanmar", aliases: ["Burma", "Myanmar (Burma)"] },
	{
		numeric: "384",
		atlas: "Côte d'Ivoire",
		// The curly-quote form: normalizeName folds diacritics but not
		// apostrophe variants, so it's listed explicitly.
		aliases: ["Ivory Coast", "Côte d’Ivoire"],
	},
	{
		numeric: "410",
		atlas: "South Korea",
		aliases: ["Republic of Korea", "Korea, Rep.", "Korea, South", "S. Korea"],
	},
	{
		numeric: "408",
		atlas: "North Korea",
		aliases: [
			"Democratic People's Republic of Korea",
			"Korea, Dem. People's Rep.",
			"Korea, North",
			"N. Korea",
			"DPRK",
		],
	},
	{
		numeric: "626",
		atlas: "Timor-Leste",
		aliases: ["East Timor", "Timor Leste"],
	},
	{ numeric: "624", atlas: "Guinea-Bissau", aliases: ["Guinea Bissau"] },
	{
		numeric: "528",
		atlas: "Netherlands",
		aliases: ["The Netherlands", "Holland"],
	},
	{
		numeric: "834",
		atlas: "Tanzania",
		aliases: ["United Republic of Tanzania"],
	},
	{
		numeric: "364",
		atlas: "Iran",
		aliases: [
			"Islamic Republic of Iran",
			"Iran, Islamic Rep.",
			"Iran (Islamic Republic of)",
		],
	},
	{ numeric: "760", atlas: "Syria", aliases: ["Syrian Arab Republic"] },
	{
		numeric: "418",
		atlas: "Laos",
		aliases: ["Lao PDR", "Lao People's Democratic Republic"],
	},
	{ numeric: "704", atlas: "Vietnam", aliases: ["Viet Nam"] },
	{ numeric: "096", atlas: "Brunei", aliases: ["Brunei Darussalam"] },
	{
		numeric: "068",
		atlas: "Bolivia",
		aliases: [
			"Plurinational State of Bolivia",
			"Bolivia (Plurinational State of)",
		],
	},
	{
		numeric: "862",
		atlas: "Venezuela",
		aliases: [
			"Bolivarian Republic of Venezuela",
			"Venezuela, RB",
			"Venezuela (Bolivarian Republic of)",
		],
	},
	{ numeric: "498", atlas: "Moldova", aliases: ["Republic of Moldova"] },
	{
		numeric: "818",
		atlas: "Egypt",
		aliases: ["Arab Republic of Egypt", "Egypt, Arab Rep."],
	},
	{ numeric: "417", atlas: "Kyrgyzstan", aliases: ["Kyrgyz Republic"] },
	{ numeric: "703", atlas: "Slovakia", aliases: ["Slovak Republic"] },
	{ numeric: "792", atlas: "Turkey", aliases: ["Türkiye"] },
	{
		numeric: "887",
		atlas: "Yemen",
		aliases: ["Republic of Yemen", "Yemen, Rep."],
	},
	{ numeric: "156", atlas: "China", aliases: ["People's Republic of China"] },
	{
		numeric: "158",
		atlas: "Taiwan",
		aliases: ["Taiwan, Province of China", "Chinese Taipei"],
	},
	{
		numeric: "275",
		atlas: "Palestine",
		aliases: [
			"State of Palestine",
			"West Bank and Gaza",
			"Palestinian Territories",
		],
	},
	{ numeric: "784", atlas: "United Arab Emirates", aliases: ["UAE"] },
	{ numeric: "688", atlas: "Serbia", aliases: ["Republic of Serbia"] },
	{
		numeric: "780",
		atlas: "Trinidad and Tobago",
		aliases: ["Trinidad & Tobago"],
	},
	{
		numeric: "682",
		atlas: "Saudi Arabia",
		aliases: ["Kingdom of Saudi Arabia"],
	},
	{ numeric: "608", atlas: "Philippines", aliases: ["The Philippines"] },
	{ numeric: "383", atlas: "Kosovo", aliases: ["Republic of Kosovo"] },
	{ numeric: "901", atlas: "Somaliland", aliases: ["Republic of Somaliland"] },
]

const rowsByNumeric = new Map(COUNTRY_NAME_ROWS.map((r) => [r.numeric, r]))

/**
 * Join aliases for a countries-bundle feature id: the preferred full form
 * (when one exists) plus every listed variant. Undefined when the country
 * needs none — its atlas name is the only form worth indexing.
 */
export const countryNameAliases = (numeric: string): string[] | undefined => {
	const row = rowsByNumeric.get(numeric)
	if (!row) return undefined
	const out = row.full
		? [row.full, ...(row.aliases ?? [])]
		: (row.aliases ?? [])
	return out.length > 0 ? out : undefined
}

/**
 * Sentinel format spec meaning "print the value's full country name" — the
 * data-label Label-format dropdown's Geography option (offered on
 * countries-level geo charts). Handled in `formatField` (dataLabelsStyle)
 * alongside the d3 spec routing, like `LITERAL_FORMAT` in formatTick.
 */
export const COUNTRY_NAME_FORMAT = "country-name"

/** Preferred display form for a feature id: the row's full form, else the
 *  ISO/atlas name. Undefined for ids the tables don't know. */
const displayName = (numeric: string): string | undefined =>
	rowsByNumeric.get(numeric)?.full ??
	countryLookup.byNumeric.get(numeric)?.name ??
	rowsByNumeric.get(numeric)?.atlas

// normalized name form -> numeric, over the ISO table's names (atlas-verbatim
// for atlas members) plus every atlas/full/alias form above. Built once; a
// form claimed by two DIFFERENT countries indexes nothing (mirrors
// resolveGeography's ambiguity guard).
const nameToNumeric = (() => {
	const index = new Map<string, string>()
	const ambiguous = new Set<string>()
	const add = (form: string, numeric: string): void => {
		const key = normalizeName(form)
		if (key === "" || ambiguous.has(key)) return
		const existing = index.get(key)
		if (existing === undefined) {
			index.set(key, numeric)
		} else if (existing !== numeric) {
			index.delete(key)
			ambiguous.add(key)
		}
	}
	for (const [numeric, row] of countryLookup.byNumeric) add(row.name, numeric)
	for (const row of COUNTRY_NAME_ROWS) {
		add(row.atlas, row.numeric)
		if (row.full) add(row.full, row.numeric)
		for (const alias of row.aliases ?? []) add(alias, row.numeric)
	}
	return index
})()

/**
 * Resolve any recognizable country value — short/long/variant name, ISO
 * alpha-2 / alpha-3 code, or 3-digit numeric — to its preferred long display
 * form. Null when the value isn't recognizably a country (callers print the
 * raw value unchanged).
 */
export const fullCountryName = (raw: string): string | null => {
	const v = raw.trim()
	if (v === "") return null
	// ISO alpha codes (uppercased): "us" / "USA" / "gbr".
	const upper = v.toUpperCase()
	const isoRow =
		countryLookup.byIso2.get(upper) ?? countryLookup.byIso3.get(upper)
	if (isoRow) return displayName(isoRow.numeric) ?? isoRow.name
	// ISO numeric (zero-pad tolerated: "4" -> "004").
	if (/^\d{1,3}$/.test(v)) {
		const numeric = v.padStart(3, "0")
		const name = displayName(numeric)
		if (name !== undefined) return name
	}
	// Names, through the same normalization the geo join uses.
	const numeric = nameToNumeric.get(normalizeName(v))
	if (numeric !== undefined) return displayName(numeric) ?? null
	return null
}
