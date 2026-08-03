import type { RegionKeyType } from "../mapConfig"
import type { Field, FieldType } from "../types"
import { ISO_COUNTRIES } from "./isoCountries"
import { resolveGeography, type GeoLookupRow } from "./resolveGeography"
import { US_STATES } from "./usStates"

/** The geography levels detection can point a scaffold at. Only the two
 * statically-bundled levels — counties/zcta load lazily in a later phase and
 * can't be verified against here. */
export type DetectedGeoLevel = "states" | "countries"

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
 *   lookup table (names, USPS/ISO codes, FIPS/ISO-numeric) at
 *   ≥ `MIN_REGION_MATCH_RATE`. All-integer columns additionally need a
 *   geographic field name (see `GEO_NAME_HINT`).
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
		// Ties (e.g. a lone "Georgia") go to states, mirroring how the map's
		// "auto" geography level resolves.
		const best =
			states.matchRate >= countries.matchRate
				? { level: "states" as const, ...states }
				: { level: "countries" as const, ...countries }
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
