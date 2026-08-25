import type { RegionKeyType } from "../mapConfig"
import type { Field, FieldType } from "../types"
import { ISO_COUNTRIES } from "./isoCountries"
import {
	resolveGeography,
	resolveStateQualifier,
	type GeoLookupRow,
} from "./resolveGeography"
import { stateLookup, US_STATES } from "./usStates"

/** The geography levels detection can point a scaffold at.
 *
 * Counties are detected too — by value FORM rather than a table join (see the
 * county section below) — and a county region field carries `"counties"` in
 * `RegionFieldMatch.level` at RUNTIME. The union can't name it yet only
 * because quickStart.ts (edited concurrently) narrows a consumed `level` to
 * `"states" | "countries"` in `mapConfigForVariation`; `"counties"` is a
 * valid `GeographyLevel`, so the value flows through that code correctly.
 * TODO: widen this union and that annotation together. */
export type DetectedGeoLevel = "states" | "countries"

/** Runtime level value for county region matches — see the DetectedGeoLevel
 * note above for why this is a cast rather than a union member (yet). */
const COUNTIES_LEVEL = "counties" as unknown as DetectedGeoLevel

/** One dataset field whose VALUES join against a geography lookup table well
 * enough to drive a region map (choropleth / symbol map). */
export type RegionFieldMatch = {
	field: Field
	level: DetectedGeoLevel
	keyType: RegionKeyType
	/** Fraction of the field's sampled distinct values that joined. */
	matchRate: number
}

/** Everything the quick-start needs to know about a dataset's geographic
 * content. Region fields drive choropleth/symbol maps (via `connection`);
 * a lat/long pair drives the dot map (via `y`/`x`). */
export type GeoFieldDetection = {
	regionFields: RegionFieldMatch[]
	latField: Field | null
	lonField: Field | null
	/** Basemap level for a lat/long dot map: `"states"` when the sampled
	 * points sit inside the US, `"countries"` otherwise. */
	pointsLevel: DetectedGeoLevel
}

export const EMPTY_GEO_DETECTION: GeoFieldDetection = {
	regionFields: [],
	latField: null,
	lonField: null,
	pointsLevel: "states",
}

/** True when the dataset can drive at least one map variation. */
export const hasGeoFields = (d: GeoFieldDetection): boolean =>
	d.regionFields.length > 0 || (!!d.latField && !!d.lonField)

// Detection joins against lightweight tables built straight from the static
// code lists — NOT the decoded geometry bundles — so it stays synchronous and
// cheap. The keys mirror what loadGeometry puts in its bundle tables, so a
// field that matches here will also join at render time.
const STATES_TABLE: GeoLookupRow[] = US_STATES.map((s) => ({
	featureId: s.fips,
	keys: { fips: s.fips, abbrev: s.abbrev, name: s.name },
}))

const COUNTRIES_TABLE: GeoLookupRow[] = ISO_COUNTRIES.map((c) => ({
	featureId: c.numeric,
	keys: {
		iso2: c.iso2 || undefined,
		iso3: c.iso3 || undefined,
		isoNumeric: c.numeric,
		name: c.name,
	},
}))

// ---- Counties -------------------------------------------------------------
// The county lookup table is a lazy 842KB import (see loadGeometry), so unlike
// states/countries detection can't join against it synchronously. Instead it
// recognizes county values by FORM, accepting exactly the shapes
// resolveGeography's county matching joins:
//
//   - county FIPS ("06037"; the resolver zero-pads "6037" too) whose 2-digit
//     state prefix is real and whose 3-digit county part is non-zero
//   - names carrying a census designator ("Cook County", "Terrebonne Parish",
//     "Yukon-Koyukuk Census Area"), optionally state-qualified ("Cook County,
//     Illinois" / "…, IL" / "…, 17")
//   - designator-less state-qualified names ("Cook, IL") — but only when the
//     field NAME says county (COUNTY_FIELD_HINT): by value alone that form is
//     indistinguishable from "City, ST" data
//
// Bare unqualified names ("Cook") stay undetected on purpose: ~444 county
// names repeat across states and collide with city/person names, and the
// resolver itself refuses ambiguous bare names.

// Trailing census designators, mirroring the set normalizeName strips (and
// like it, deliberately NOT a bare trailing "city" — that marks independent
// cities and, in other datasets, plain city columns).
const COUNTY_DESIGNATOR_RE =
	/\b(city and borough|census area|municipality|borough|county|parish)\s*$/i

/** Field-name hint that a designator-less state-qualified value ("Cook, IL")
 * means a county rather than a city. */
const COUNTY_FIELD_HINT = /count(y|ie)|parish|borough/i

// County FIPS shape: 4–5 digits (the resolver pads 4 to 5), a real state
// prefix, and a non-zero county part ("XX000" would be the state itself).
// Like all all-integer columns this only gets scored when the field name
// passes GEO_NAME_HINT — a ZIP code column is value-indistinguishable.
const isCountyFips = (v: string): boolean => {
	if (!/^\d{4,5}$/.test(v)) return false
	const p = v.padStart(5, "0")
	return p.slice(2) !== "000" && stateLookup.byFips.has(p.slice(0, 2))
}

const isCountyName = (v: string, fieldNameHintsCounty: boolean): boolean => {
	let head = v.trim()
	let stateQualified = false
	// Split at the LAST comma, as the resolver does; the tail must resolve as
	// a state for the value to count as qualified.
	const comma = head.lastIndexOf(",")
	if (comma > 0 && resolveStateQualifier(head.slice(comma + 1))) {
		head = head.slice(0, comma).trim()
		stateQualified = true
	}
	if (head === "") return false
	if (COUNTY_DESIGNATOR_RE.test(head)) return true
	return stateQualified && fieldNameHintsCounty
}

const scoreCountyForms = (
	fieldName: string,
	distinct: string[]
): { keyType: RegionKeyType; matchRate: number } => {
	const hinted = COUNTY_FIELD_HINT.test(fieldName)
	let fips = 0
	let named = 0
	for (const v of distinct) {
		if (isCountyFips(v)) fips++
		else if (isCountyName(v, hinted)) named++
	}
	return {
		keyType: fips >= named ? "fips" : "name",
		matchRate: (fips + named) / distinct.length,
	}
}

// Sampling caps: enough rows to be representative, bounded so detection stays
// O(fields) cheap on large datasets (it runs in a render-time useMemo).
const MAX_ROWS_SCANNED = 1000
const MAX_DISTINCT_SAMPLED = 200

/** A region field must join at least this fraction of its sampled distinct
 * values. High enough to reject coincidental matches (month abbreviations,
 * person names containing "Georgia"), low enough to tolerate a few
 * out-of-table values (territories, typos). */
const MIN_REGION_MATCH_RATE = 0.8

/** Integer-code columns (FIPS, ISO numeric) are indistinguishable from
 * ordinary small-integer data by values alone — a 1–12 month column matches
 * state FIPS perfectly. So all-integer columns only qualify when the field
 * NAME says it's geographic. */
const GEO_NAME_HINT = /fips|geoid|iso|state|county|countr|region|nation/i

const LAT_NAME_TOKENS = new Set(["lat", "latitude"])
const LON_NAME_TOKENS = new Set(["lon", "lng", "long", "longitude"])

/** Fraction of a lat/long candidate's parsed values that must fall inside the
 * coordinate range (|lat| ≤ 90, |lon| ≤ 180). */
const MIN_COORD_IN_RANGE_RATE = 0.95

/** Fraction of sampled points that must land inside the US for the dot map to
 * scaffold on the states basemap instead of the world. */
const MIN_US_POINTS_RATE = 0.8

const effectiveTypeOf = (
	field: Field,
	overrides: Record<string, FieldType>
): FieldType => overrides[field.name] ?? field.inferredType

/** Split a field name into lowercase word tokens, breaking on non-letters and
 * camelCase boundaries ("pickupLongitude" → ["pickup", "longitude"]). */
const nameTokens = (name: string): string[] =>
	name
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z]+/)
		.filter(Boolean)

/** First `MAX_DISTINCT_SAMPLED` distinct non-blank values of a column, drawn
 * from the first `MAX_ROWS_SCANNED` rows. */
const sampleDistinct = (
	rows: ReadonlyArray<Record<string, string>>,
	fieldName: string
): string[] => {
	const distinct: string[] = []
	const seen = new Set<string>()
	const limit = Math.min(rows.length, MAX_ROWS_SCANNED)
	for (let i = 0; i < limit && distinct.length < MAX_DISTINCT_SAMPLED; i++) {
		const v = String(rows[i]?.[fieldName] ?? "").trim()
		if (v === "" || seen.has(v)) continue
		seen.add(v)
		distinct.push(v)
	}
	return distinct
}

const scoreTable = (
	distinct: string[],
	table: GeoLookupRow[]
): { keyType: RegionKeyType; matchRate: number } => {
	const { keyType, matched } = resolveGeography(distinct, table)
	return { keyType, matchRate: matched.size / distinct.length }
}

// US bounding boxes (CONUS + Alaska + Hawaii) for the dot-map level heuristic.
// Deliberately loose — a point set that's "mostly US-shaped" should get the
// albersUsa states basemap even if a few points sit in Canada/Mexico.
const inUsBounds = (lon: number, lat: number): boolean =>
	(lon >= -125 && lon <= -66 && lat >= 24 && lat <= 50) || // CONUS
	(lon >= -180 && lon <= -129 && lat >= 51 && lat <= 72) || // Alaska
	(lon >= -161 && lon <= -154 && lat >= 18 && lat <= 23) // Hawaii

/**
 * Scan the dataset for geographic content:
 *
 * - **Region fields** — columns whose values join a states or countries
 *   lookup table (names, USPS/ISO codes, FIPS/ISO-numeric), or whose values
 *   are county-shaped ("Cook County[, IL]", county FIPS — see the county
 *   section above), at ≥ `MIN_REGION_MATCH_RATE`. All-integer columns
 *   additionally need a geographic field name (see `GEO_NAME_HINT`).
 * - **Lat/long pair** — quantitative columns named like latitude/longitude
 *   whose values sit in coordinate range.
 *
 * Pure and synchronous — joins against the static code lists, not the decoded
 * geometry bundles, so it's safe to call from a render-time memo.
 */
export const detectGeoFields = (
	fields: readonly Field[],
	rows: ReadonlyArray<Record<string, string>>,
	overrides: Record<string, FieldType> = {}
): GeoFieldDetection => {
	const regionFields: RegionFieldMatch[] = []
	let latField: Field | null = null
	let lonField: Field | null = null

	for (const field of fields) {
		const type = effectiveTypeOf(field, overrides)
		if (type === "temporal") continue

		const distinct = sampleDistinct(rows, field.name)
		if (distinct.length === 0) continue

		// Lat/long candidacy: quantitative, geographically named, in range.
		// A lat/long column is a coordinate, not a region key, so it doesn't
		// also compete for region detection.
		if (type === "quantitative") {
			const tokens = nameTokens(field.name)
			const looksLat = tokens.some((t) => LAT_NAME_TOKENS.has(t))
			const looksLon = tokens.some((t) => LON_NAME_TOKENS.has(t))
			if (looksLat !== looksLon) {
				const nums = distinct.map(Number).filter(Number.isFinite)
				const bound = looksLat ? 90 : 180
				const inRange = nums.filter((n) => Math.abs(n) <= bound).length
				if (
					nums.length > 0 &&
					inRange / nums.length >= MIN_COORD_IN_RANGE_RATE
				) {
					if (looksLat) latField = latField ?? field
					else lonField = lonField ?? field
					continue
				}
			}
		}

		// Region candidacy. Integer-code columns need a geographic name (see
		// GEO_NAME_HINT) — by value alone they're indistinguishable from any
		// small-integer measure.
		const allInteger = distinct.every((v) => /^\d+$/.test(v))
		if (allInteger && !GEO_NAME_HINT.test(field.name)) continue

		const states = scoreTable(distinct, STATES_TABLE)
		const countries = scoreTable(distinct, COUNTRIES_TABLE)
		const counties = scoreCountyForms(field.name, distinct)
		// Ties resolve states > counties > countries, mirroring how the map's
		// "auto" geography level resolves (a lone "Georgia" is a state; so is a
		// lone "Washington County", which the states table's normalizeName also
		// joins — a real county column outscores states on its non-state-named
		// values).
		let best: {
			level: DetectedGeoLevel
			keyType: RegionKeyType
			matchRate: number
		}
		if (
			states.matchRate >= counties.matchRate &&
			states.matchRate >= countries.matchRate
		) {
			best = { level: "states", ...states }
		} else if (counties.matchRate >= countries.matchRate) {
			best = { level: COUNTIES_LEVEL, ...counties }
		} else {
			best = { level: "countries", ...countries }
		}
		if (best.matchRate >= MIN_REGION_MATCH_RATE) {
			regionFields.push({ field, ...best })
		}
	}

	// Dot-map basemap level: states when the sampled points sit inside the US.
	let pointsLevel: DetectedGeoLevel = "states"
	if (latField && lonField) {
		let total = 0
		let inUs = 0
		const limit = Math.min(rows.length, MAX_ROWS_SCANNED)
		for (let i = 0; i < limit; i++) {
			const rawLat = String(rows[i]?.[latField.name] ?? "").trim()
			const rawLon = String(rows[i]?.[lonField.name] ?? "").trim()
			if (rawLat === "" || rawLon === "") continue
			const lat = Number(rawLat)
			const lon = Number(rawLon)
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
			total++
			if (inUsBounds(lon, lat)) inUs++
		}
		pointsLevel =
			total > 0 && inUs / total >= MIN_US_POINTS_RATE ? "states" : "countries"
	}

	return { regionFields, latField, lonField, pointsLevel }
}
