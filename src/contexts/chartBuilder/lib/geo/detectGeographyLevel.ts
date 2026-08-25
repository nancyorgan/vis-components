import type { GeographyLevel, RegionKeyType } from "../mapConfig"
import { loadGeometry } from "./loadGeometry"
import { resolveGeography, type GeoLookupRow } from "./resolveGeography"
import { zctaTopologyAvailable } from "./zctaTopology"

/** How well a candidate level must match before we stop looking. When the
 *  best of states/countries clears this, the (lazily imported, 842KB)
 *  counties table isn't loaded at all — the common case stays cheap. */
export const GOOD_MATCH_THRESHOLD = 0.5

/** Cap on distinct values scored per level. Detection needs a verdict, not a
 *  full join — the sidebar match status still resolves every value. */
const SAMPLE_CAP = 500

/** Fraction of the sampled distinct values that join `table` (0..1). */
export const scoreGeographyTable = (
	values: string[],
	table: GeoLookupRow[],
	keyTypeOverride?: RegionKeyType
): number => {
	if (values.length === 0) return 0
	const { matched } = resolveGeography(values, table, keyTypeOverride)
	return matched.size / values.length
}

// De-duplicate (preserving first-seen order, skipping blanks) and cap. Mirrors
// resolveGeography's own distinct pass so the score denominator counts each
// value once.
const sampleDistinct = (values: string[]): string[] => {
	const distinct: string[] = []
	const seen = new Set<string>()
	for (const v of values) {
		if (v == null || v.trim() === "" || seen.has(v)) continue
		seen.add(v)
		distinct.push(v)
		if (distinct.length >= SAMPLE_CAP) break
	}
	return distinct
}

// Whether the sampled values LOOK like ZIP/ZCTA codes — mostly 3-to-5-digit
// numerics (leading zeros may be lost) or ZIP+4. Gates the third detection
// stage below so the ~33k-feature ZCTA topology is only ever loaded when it's
// a live possibility; nothing but digit columns can match a ZCTA table anyway.
const looksZipLike = (sample: string[]): boolean => {
	let hits = 0
	for (const v of sample) {
		if (/^\d{3,5}(-\d{4})?$/.test(v.trim())) hits++
	}
	return hits >= sample.length / 2
}

/**
 * Detect the geography level for `geographyLevel: "auto"` by scoring the
 * connection field's values against each implemented level's lookup table
 * and picking the best join.
 *
 * Three stages: states + countries are statically bundled, so they always
 * score; the counties table (a lazy 842KB import) only loads when neither
 * clears GOOD_MATCH_THRESHOLD — county data matches states/countries at ~0%,
 * so this triggers exactly when counties is a live possibility. The zcta
 * table (~33k features behind the zctaTopology seam) is heavier still, so it
 * only loads when counties ALSO fell short, a ZCTA source exists, and the
 * sample even looks ZIP-like (mostly 3–5-digit numerics).
 *
 * Ties (and the nothing-matches fallback) resolve in states > counties >
 * countries > zcta order — states is the legacy meaning of "auto", so
 * anything genuinely ambiguous keeps behaving as before.
 */
export const detectGeographyLevel = async (
	values: string[],
	keyTypeOverride?: RegionKeyType
): Promise<GeographyLevel> => {
	const sample = sampleDistinct(values)
	if (sample.length === 0) return "states"

	const [states, countries] = await Promise.all([
		loadGeometry("states"),
		loadGeometry("countries"),
	])
	const statesScore = scoreGeographyTable(sample, states.table, keyTypeOverride)
	const countriesScore = scoreGeographyTable(
		sample,
		countries.table,
		keyTypeOverride
	)
	if (Math.max(statesScore, countriesScore) >= GOOD_MATCH_THRESHOLD) {
		return statesScore >= countriesScore ? "states" : "countries"
	}

	const counties = await loadGeometry("counties")
	const countiesScore = scoreGeographyTable(
		sample,
		counties.table,
		keyTypeOverride
	)
	if (countiesScore >= GOOD_MATCH_THRESHOLD) return "counties"

	// Third stage: zcta. Guarded three ways (see the doc comment); a failed
	// topology load counts as "not a candidate" rather than failing detection.
	let zctaScore = 0
	if (zctaTopologyAvailable() && looksZipLike(sample)) {
		try {
			const zcta = await loadGeometry("zcta")
			zctaScore = scoreGeographyTable(sample, zcta.table, keyTypeOverride)
		} catch {
			zctaScore = 0
		}
	}

	const best = Math.max(statesScore, countiesScore, countriesScore, zctaScore)
	if (best === 0 || statesScore === best) return "states"
	if (countiesScore === best) return "counties"
	if (countriesScore === best) return "countries"
	return "zcta"
}
