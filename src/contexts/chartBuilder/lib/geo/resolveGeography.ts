import type { RegionKeyType } from "../mapConfig"
import { stateLookup, type UsStateRow } from "./usStates"

/**
 * One row of a geometry lookup table: a feature plus whatever keys we know
 * how to join it on. Not every key is always present (e.g. countries have no
 * USPS abbrev), so every key field is optional.
 */
export type GeoLookupRow = {
	featureId: string
	keys: {
		fips?: string
		abbrev?: string
		// `iso` is the legacy single-form ISO field. Countries additionally carry
		// the three ISO-3166 forms: alpha-2 (iso2), alpha-3 (iso3) and numeric
		// (isoNumeric). All four participate in the "iso" keyType index.
		iso?: string
		iso2?: string
		iso3?: string
		isoNumeric?: string
		name?: string
		/** Owning state's 2-digit FIPS, for sub-state geographies (counties).
		 *  When present, the name index ALSO maps the composite key
		 *  `"{name}|{stateFips}"` so state-qualified inputs ("Washington
		 *  County, TX") disambiguate the ~444 county names that repeat across
		 *  states. States/countries rows leave it unset. */
		stateFips?: string
	}
}

/**
 * Result of joining a column of raw values against a lookup table:
 * - `keyType`   the format the values were interpreted as
 * - `matched`   original raw value -> featureId (only the ones that joined)
 * - `unmatched` original raw values that did not join, in input order
 */
export type GeoResolution = {
	keyType: RegionKeyType
	matched: Map<string, string>
	unmatched: string[]
}

/**
 * Normalize a place name for fuzzy joining:
 * - lowercase + trim
 * - fold diacritics ("Doña Ana" matches "Dona Ana")
 * - strip periods/commas
 * - "St." / "St " -> "Saint " (word boundary)
 * - drop a trailing census designator ("County", "Parish", "Borough",
 *   "Census Area", "Municipality", "City and Borough") — but NOT a trailing
 *   "city", which distinguishes independent cities from their same-named
 *   counties (Baltimore city 24510 vs Baltimore County 24005)
 * - collapse runs of whitespace
 */
export const normalizeName = (raw: string): string => {
	let s = raw.toLowerCase().trim()
	// Fold diacritics: decompose, then drop the combining marks.
	s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
	// "st." or "st " at a word boundary -> "saint ". Do this before stripping
	// punctuation so the period that signals the abbreviation is still present.
	s = s.replace(/\bst\.?\s+/g, "saint ")
	// Strip punctuation (periods, commas).
	s = s.replace(/[.,]/g, "")
	// Drop a trailing designator. Longest alternatives first so "city and
	// borough" wins over the bare "borough".
	s = s.replace(
		/\s+(city and borough|census area|municipality|borough|county|parish)$/i,
		""
	)
	// Collapse internal whitespace and re-trim.
	s = s.replace(/\s+/g, " ").trim()
	return s
}

// Candidate key types, in tie-break priority order: the earliest one wins when
// two key types match the same number of distinct values. FIPS first because a
// numeric column is almost never coincidentally a valid abbrev/iso, then the
// short alpha codes, with free-text name last as the loosest interpretation.
const KEY_TYPE_PRIORITY: RegionKeyType[] = ["fips", "abbrev", "iso", "name"]

// Pad a numeric-looking fips value to at least 2 digits so an unpadded "6"
// joins against a stored "06". Non-numeric values pass through unchanged.
// This is the INDEX-side canonicalization: state tables store 2-digit codes
// ("6" -> "06") and county tables store 5-digit codes (already >= 5 chars, so
// the pad is a no-op). The INPUT side additionally tries a 5-digit pad — see
// `inputKeys` — so an unpadded county fips like "6037" still joins "06037".
const padFips = (s: string): string =>
	/^\d+$/.test(s) ? s.padStart(2, "0") : s

// Resolve the state-qualifier tail of a comma-qualified place name ("…, TX" /
// "…, Texas" / "…, 48") to its US_STATES row, or undefined if it isn't one.
const resolveStateQualifier = (raw: string): UsStateRow | undefined => {
	const v = raw.trim()
	if (v === "") return undefined
	if (/^\d{1,2}$/.test(v)) return stateLookup.byFips.get(v.padStart(2, "0"))
	if (v.length === 2) return stateLookup.byAbbrev.get(v.toUpperCase())
	return stateLookup.byName.get(v.toLowerCase())
}

// Pad a numeric-looking ISO-3166 numeric code to 3 digits so an unpadded "84"
// joins against a stored "084" and "840" stays "840". SEPARATE from padFips:
// US state FIPS are width 2, ISO numeric codes are width 3, so the two paddings
// must not be conflated. Non-numeric values pass through unchanged.
const padIsoNumeric = (s: string): string =>
	/^\d+$/.test(s) ? s.padStart(3, "0") : s

// Produce the comparison key(s) for a raw input value under a given key type.
// fips also yields zero-padded variants — width 2 (states) AND width 5
// (counties) — so "6" can match "06" and "6037" can match "06037"; each table
// only indexes its own canonical width, so the extra candidate just misses.
// iso yields the value uppercased+trimmed (matches alpha-2/alpha-3/legacy iso)
// AND the value padded to a 3-digit numeric (matches isoNumeric), so country
// codes in any of their three ISO-3166 forms resolve under the single "iso"
// keyType. name additionally yields a composite `"{name}|{stateFips}"` when
// the value carries a comma state qualifier ("Washington County, TX"),
// matching the composite keys county tables index (see buildIndex).
const inputKeys = (keyType: RegionKeyType, raw: string): string[] => {
	const v = raw.trim()
	if (v === "") return []
	switch (keyType) {
		case "fips": {
			if (!/^\d+$/.test(v)) return [v]
			const keys = [v]
			for (const p of [v.padStart(2, "0"), v.padStart(5, "0")]) {
				if (!keys.includes(p)) keys.push(p)
			}
			return keys
		}
		case "abbrev":
			return [v.toUpperCase()]
		case "iso": {
			const upper = v.toUpperCase()
			const numeric = padIsoNumeric(v)
			return numeric === upper ? [upper] : [upper, numeric]
		}
		case "name": {
			const keys = [normalizeName(v)]
			// A comma may qualify the name with a state ("Los Angeles County,
			// CA"). Split at the LAST comma so an embedded comma stays with the
			// name; if the tail resolves as a state, try the composite key.
			const comma = v.lastIndexOf(",")
			if (comma > 0) {
				const state = resolveStateQualifier(v.slice(comma + 1))
				const head = normalizeName(v.slice(0, comma))
				if (state && head !== "") keys.push(`${head}|${state.fips}`)
			}
			return keys
		}
		default: {
			const _exhaustive: never = keyType
			return _exhaustive
		}
	}
}

// Build an index (comparison key -> featureId) for one key type from the table.
const buildIndex = (
	keyType: RegionKeyType,
	table: GeoLookupRow[],
): Map<string, string> => {
	const index = new Map<string, string>()
	// A key claimed by two DIFFERENT features is ambiguous and indexes nothing
	// — better unmatched (surfaced in the match status) than silently mapped
	// to an arbitrary region. This is what keeps bare county names honest:
	// "washington" (31 counties) matches nothing, while the composite
	// "washington|48" and the unique bare names still join. States/countries
	// keys are unique, so this changes nothing for them. Re-adding a key from
	// the SAME feature (e.g. a row whose iso fields repeat) stays fine.
	const ambiguous = new Set<string>()
	const add = (key: string, featureId: string): void => {
		if (key === "" || ambiguous.has(key)) return
		const existing = index.get(key)
		if (existing === undefined) {
			index.set(key, featureId)
		} else if (existing !== featureId) {
			index.delete(key)
			ambiguous.add(key)
		}
	}
	for (const row of table) {
		// The "iso" keyType draws from EVERY ISO-ish field present on the row —
		// the legacy `iso` plus alpha-2/alpha-3 (uppercased) and the numeric form
		// (zero-padded to 3) — so country codes match in any of their ISO-3166
		// forms. The other key types read their single same-named field.
		if (keyType === "iso") {
			for (const f of [row.keys.iso, row.keys.iso2, row.keys.iso3]) {
				if (f == null) continue
				add(f.trim().toUpperCase(), row.featureId)
			}
			const num = row.keys.isoNumeric
			if (num != null) add(padIsoNumeric(num.trim()), row.featureId)
			continue
		}
		const raw = row.keys[keyType]
		if (raw == null) continue
		const v = raw.trim()
		if (v === "") continue
		let key: string
		switch (keyType) {
			case "fips":
				key = padFips(v)
				break
			case "abbrev":
				key = v.toUpperCase()
				break
			case "name":
				key = normalizeName(v)
				// Sub-state rows (counties) also index the state-qualified
				// composite so "Washington County, TX" resolves even though the
				// bare "washington" is ambiguous.
				if (row.keys.stateFips) {
					add(`${key}|${row.keys.stateFips}`, row.featureId)
				}
				break
			default: {
				const _exhaustive: never = keyType
				return _exhaustive
			}
		}
		add(key, row.featureId)
	}
	return index
}

// Look up a single raw value in a prebuilt index, trying each candidate
// comparison key. Returns the featureId or undefined.
const lookup = (
	keyType: RegionKeyType,
	raw: string,
	index: Map<string, string>,
): string | undefined => {
	for (const k of inputKeys(keyType, raw)) {
		const hit = index.get(k)
		if (hit !== undefined) return hit
	}
	return undefined
}

/**
 * Join a column of raw geographic values against a lookup table.
 *
 * When `keyTypeOverride` is given it is used unconditionally (even if nothing
 * matches). Otherwise each key type is scored by how many distinct input
 * values it joins, and the highest score wins (ties broken by
 * KEY_TYPE_PRIORITY).
 */
export const resolveGeography = (
	values: string[],
	table: GeoLookupRow[],
	keyTypeOverride?: RegionKeyType,
): GeoResolution => {
	// De-duplicate inputs while preserving first-seen order. Skip blank values.
	const distinct: string[] = []
	const seen = new Set<string>()
	for (const v of values) {
		if (v == null) continue
		if (v.trim() === "") continue
		if (seen.has(v)) continue
		seen.add(v)
		distinct.push(v)
	}

	// TODO(phase4): build only the needed index (ZCTA ~33k features) — skip unused index builds when overridden
	const indexes = new Map<RegionKeyType, Map<string, string>>()
	for (const kt of KEY_TYPE_PRIORITY) indexes.set(kt, buildIndex(kt, table))

	let keyType: RegionKeyType
	if (keyTypeOverride) {
		keyType = keyTypeOverride
	} else {
		// Score every key type; pick the best, breaking ties by priority order.
		let best: RegionKeyType = KEY_TYPE_PRIORITY[0]
		let bestScore = -1
		for (const [kt, index] of indexes) {
			let score = 0
			for (const v of distinct) {
				if (lookup(kt, v, index) !== undefined) score++
			}
			if (score > bestScore) {
				bestScore = score
				best = kt
			}
		}
		keyType = best
	}

	const index = indexes.get(keyType) ?? buildIndex(keyType, table)
	const matched = new Map<string, string>()
	const unmatched: string[] = []
	for (const v of distinct) {
		const hit = lookup(keyType, v, index)
		if (hit !== undefined) matched.set(v, hit)
		else unmatched.push(v)
	}

	return { keyType, matched, unmatched }
}
