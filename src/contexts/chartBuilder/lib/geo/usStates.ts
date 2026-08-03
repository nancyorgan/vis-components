/**
 * Static lookup of the 50 US states + District of Columbia.
 *
 * us-atlas state features carry `id` = 2-digit FIPS and `properties.name`,
 * but not the USPS abbreviation. This table lets `resolveGeography` recognize
 * "CA" / "06" / "California" and map them all to FIPS "06".
 *
 * - `fips`: 2-digit zero-padded ANSI/FIPS state code (string; leading zeros matter)
 * - `abbrev`: 2-letter uppercase USPS code
 * - `name`: full state name as it appears in us-atlas `properties.name`
 */
export type UsStateRow = {
	fips: string
	abbrev: string
	name: string
}

export const US_STATES: readonly UsStateRow[] = [
	{ fips: "01", abbrev: "AL", name: "Alabama" },
	{ fips: "02", abbrev: "AK", name: "Alaska" },
	{ fips: "04", abbrev: "AZ", name: "Arizona" },
	{ fips: "05", abbrev: "AR", name: "Arkansas" },
	{ fips: "06", abbrev: "CA", name: "California" },
	{ fips: "08", abbrev: "CO", name: "Colorado" },
	{ fips: "09", abbrev: "CT", name: "Connecticut" },
	{ fips: "10", abbrev: "DE", name: "Delaware" },
	{ fips: "11", abbrev: "DC", name: "District of Columbia" },
	{ fips: "12", abbrev: "FL", name: "Florida" },
	{ fips: "13", abbrev: "GA", name: "Georgia" },
	{ fips: "15", abbrev: "HI", name: "Hawaii" },
	{ fips: "16", abbrev: "ID", name: "Idaho" },
	{ fips: "17", abbrev: "IL", name: "Illinois" },
	{ fips: "18", abbrev: "IN", name: "Indiana" },
	{ fips: "19", abbrev: "IA", name: "Iowa" },
	{ fips: "20", abbrev: "KS", name: "Kansas" },
	{ fips: "21", abbrev: "KY", name: "Kentucky" },
	{ fips: "22", abbrev: "LA", name: "Louisiana" },
	{ fips: "23", abbrev: "ME", name: "Maine" },
	{ fips: "24", abbrev: "MD", name: "Maryland" },
	{ fips: "25", abbrev: "MA", name: "Massachusetts" },
	{ fips: "26", abbrev: "MI", name: "Michigan" },
	{ fips: "27", abbrev: "MN", name: "Minnesota" },
	{ fips: "28", abbrev: "MS", name: "Mississippi" },
	{ fips: "29", abbrev: "MO", name: "Missouri" },
	{ fips: "30", abbrev: "MT", name: "Montana" },
	{ fips: "31", abbrev: "NE", name: "Nebraska" },
	{ fips: "32", abbrev: "NV", name: "Nevada" },
	{ fips: "33", abbrev: "NH", name: "New Hampshire" },
	{ fips: "34", abbrev: "NJ", name: "New Jersey" },
	{ fips: "35", abbrev: "NM", name: "New Mexico" },
	{ fips: "36", abbrev: "NY", name: "New York" },
	{ fips: "37", abbrev: "NC", name: "North Carolina" },
	{ fips: "38", abbrev: "ND", name: "North Dakota" },
	{ fips: "39", abbrev: "OH", name: "Ohio" },
	{ fips: "40", abbrev: "OK", name: "Oklahoma" },
	{ fips: "41", abbrev: "OR", name: "Oregon" },
	{ fips: "42", abbrev: "PA", name: "Pennsylvania" },
	{ fips: "44", abbrev: "RI", name: "Rhode Island" },
	{ fips: "45", abbrev: "SC", name: "South Carolina" },
	{ fips: "46", abbrev: "SD", name: "South Dakota" },
	{ fips: "47", abbrev: "TN", name: "Tennessee" },
	{ fips: "48", abbrev: "TX", name: "Texas" },
	{ fips: "49", abbrev: "UT", name: "Utah" },
	{ fips: "50", abbrev: "VT", name: "Vermont" },
	{ fips: "51", abbrev: "VA", name: "Virginia" },
	{ fips: "53", abbrev: "WA", name: "Washington" },
	{ fips: "54", abbrev: "WV", name: "West Virginia" },
	{ fips: "55", abbrev: "WI", name: "Wisconsin" },
	{ fips: "56", abbrev: "WY", name: "Wyoming" },
]

export const stateLookup = {
	byFips: new Map(US_STATES.map((row) => [row.fips, row])),
	byAbbrev: new Map(US_STATES.map((row) => [row.abbrev, row])),
	byName: new Map(US_STATES.map((row) => [row.name.toLowerCase(), row])),
}
