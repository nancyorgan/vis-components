import type { RegionKeyType } from "../mapConfig"

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
 * - strip periods/commas
 * - "St." / "St " -> "Saint " (word boundary)
 * - drop a trailing " County" / " Parish"
 * - collapse runs of whitespace
 */
export const normalizeName = (raw: string): string => {
	let s = raw.toLowerCase().trim()
	// "st." or "st " at a word boundary -> "saint ". Do this before stripping
	// punctuation so the period that signals the abbreviation is still present.
	s = s.replace(/\bst\.?\s+/g, "saint ")
	// Strip punctuation (periods, commas).
	s = s.replace(/[.,]/g, "")
	// Drop a trailing county/parish designator.
	s = s.replace(/\s+(county|parish)$/i, "")
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
// STATES-only assumption: this pads to width 2. County FIPS are 5-digit
// zero-padded ("06037"), so a future phase must make the pad width
// geography-aware (2 for states, 5 for counties).
// TODO(phase4): county FIPS need 5-digit-aware padding
const padFips = (s: string): string =>
	/^\d+$/.test(s) ? s.padStart(2, "0") : s

// Pad a numeric-looking ISO-3166 numeric code to 3 digits so an unpadded "84"
// joins against a stored "084" and "840" stays "840". SEPARATE from padFips:
// US state FIPS are width 2, ISO numeric codes are width 3, so the two paddings
// must not be conflated. Non-numeric values pass through unchanged.
const padIsoNumeric = (s: string): string =>
	/^\d+$/.test(s) ? s.padStart(3, "0") : s

// Produce the comparison key(s) for a raw input value under a given key type.
// fips also yields a zero-padded variant so "6" can match "06". iso yields the
// value uppercased+trimmed (matches alpha-2/alpha-3/legacy iso) AND the value
// padded to a 3-digit numeric (matches isoNumeric), so country codes in any of
// their three ISO-3166 forms resolve under the single "iso" keyType.
const inputKeys = (keyType: RegionKeyType, raw: string): string[] => {
	const v = raw.trim()
	if (v === "") return []
	switch (keyType) {
		case "fips":
			return v === padFips(v) ? [v] : [v, padFips(v)]
		case "abbrev":
			return [v.toUpperCase()]
		case "iso": {
			const upper = v.toUpperCase()
			const numeric = padIsoNumeric(v)
			return numeric === upper ? [upper] : [upper, numeric]
		}
		case "name":
			return [normalizeName(v)]
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
	// First writer wins; lookup tables are expected to be unique per key.
	// Duplicate keys collapse silently to the first table row — fine for
	// states (unique names), but Phase 4 has ~30 "Washington" counties, so
	// name-only county joins will silently mis-map.
	// TODO(phase4): duplicate region names (counties) need disambiguation
	const add = (key: string, featureId: string): void => {
		if (key !== "" && !index.has(key)) index.set(key, featureId)
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
