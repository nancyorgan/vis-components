import { geoPath } from "d3-geo"
import type { Feature, FeatureCollection } from "geojson"
// us-atlas ships TopoJSON; topojson-client decodes it into GeoJSON features.
import { feature } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
// Statically bundled so the states map needs no network fetch (per the design;
// the file is ~100KB). countries (~110KB) ships statically too. counties
// (~842KB) is a DYNAMIC import inside buildCountiesBundle — lazy in dev, and
// vite-plugin-singlefile inlines it into the shareable dist/index.html (a
// runtime /public fetch would break the offline single-file build). zcta
// (33,791 features, 8.6MB — no us-atlas equivalent exists) is the one level
// too large for that treatment, so it loads through the zctaTopology SEAM:
// normally a fetch of the optional public/geo/ sidecar asset (built by
// `pnpm zcta`), or a registered runtime source; see zctaTopology.ts.
import statesTopology from "us-atlas/states-10m.json"
import countriesTopology from "world-atlas/countries-110m.json"
import type { GeographyLevel } from "../mapConfig"
import { stateLookup } from "./usStates"
import { countryLookup } from "./isoCountries"
import { countryNameAliases } from "./countryNames"
import type { GeoLookupRow } from "./resolveGeography"
import { loadZctaTopology } from "./zctaTopology"

/**
 * Decoded geometry for one geography level, plus everything a downstream
 * renderer / join needs:
 * - `features`  the GeoJSON features (one per region)
 * - `table`     a `GeoLookupRow[]` ready to hand to `resolveGeography`
 * - `centroids` featureId -> [x, y] label/symbol anchor
 */
export type GeometryBundle = {
	features: Feature[]
	table: GeoLookupRow[]
	centroids: Map<string, [number, number]>
}

// Normalize a us-atlas feature id (FIPS) to a zero-padded 2-char string so it
// joins against `stateLookup.byFips` (e.g. 6 / "6" -> "06"). us-atlas
// states-10m gives string ids already, but be defensive about numeric ones.
const normalizeFips = (id: unknown): string => String(id ?? "").padStart(2, "0")

// County FIPS are 5-digit (2-digit state + 3-digit county). counties-10m ids
// are 5-char strings already; the pad is the same defensiveness as above.
const normalizeCountyFips = (id: unknown): string =>
	String(id ?? "").padStart(5, "0")

// Zero-pad an ISO 3166-1 numeric code to 3 chars so a feature id of "4" or 4
// joins against the isoCountries `numeric` field ("004"). Width 3 — distinct
// from FIPS's width 2 — so the two must never be conflated.
const normalizeIsoNumeric = (id: unknown): string =>
	String(id ?? "").padStart(3, "0")

/**
 * The single canonical way to derive a feature's join id. Both the table
 * builder below AND the choropleth renderer call this so their lookups can
 * never diverge.
 *
 * `loadGeometry` normalizes every decoded feature's `id` IN PLACE to its
 * canonical table id during bundle construction (states: 2-digit FIPS;
 * countries: 3-digit ISO numeric, or a name-resolved synthetic numeric for the
 * 3 disputed features whose source `id` is `undefined`). So by the time anyone
 * holds a bundle feature, `feature.id` already IS the canonical id and this
 * helper is a trivial, geography-agnostic read — no level-specific logic and no
 * risk of the renderer and the table deriving different ids.
 */
export const featureId = (feature: { id?: string | number }): string =>
	String(feature.id)

// The bundled JSON is inferred with loose array types (number[] vs the tuples
// the TopoJSON spec wants), so assert it to the spec type once at the boundary.
const topology = statesTopology as unknown as Topology<{
	states: GeometryCollection
}>

const buildStatesBundle = (): GeometryBundle => {
	// `feature(topology, object)` returns a FeatureCollection for a geometry
	// collection; `.features` is the per-region array.
	const fc = feature(topology, topology.objects.states) as FeatureCollection
	const features = fc.features

	// No projection => geoPath uses raw lon/lat and returns a spherical
	// centroid. This is only a fallback anchor; for symbol placement we
	// recompute centroids in projected (pixel) space later (per the plan).
	const path = geoPath()

	const table: GeoLookupRow[] = []
	const centroids = new Map<string, [number, number]>()

	for (const f of features) {
		// Normalize the source FIPS to its canonical 2-digit form and write it
		// back so `featureId(f)` (and thus the renderer) reads the same id the
		// table is keyed on.
		const id = normalizeFips(f.id)
		f.id = id
		const state = stateLookup.byFips.get(id)
		// Defensive: a feature with no matching state row (territory, etc.)
		// still gets a row keyed on its fips so it is at least addressable.
		table.push({
			featureId: id,
			keys: {
				fips: id,
				abbrev: state?.abbrev,
				name: state?.name,
			},
		})
		centroids.set(id, path.centroid(f) as [number, number])
	}

	return { features, table, centroids }
}

// world-atlas countries-110m JSON is inferred with loose array types, so assert
// it to the TopoJSON spec type once at the boundary (mirrors the states cast).
const countriesTopo = countriesTopology as unknown as Topology<{
	countries: GeometryCollection
}>

const buildCountriesBundle = (): GeometryBundle => {
	const fc = feature(
		countriesTopo,
		countriesTopo.objects.countries,
	) as FeatureCollection
	const features = fc.features

	const path = geoPath()

	const table: GeoLookupRow[] = []
	const centroids = new Map<string, [number, number]>()

	for (const f of features) {
		// Resolve the canonical id. Most features carry `id` = numeric ISO code;
		// the 3 disputed features (Kosovo / N. Cyprus / Somaliland) have
		// `id == undefined` and must be resolved by NAME.
		const rawName = (f.properties as { name?: string } | null)?.name ?? ""
		// countryLookup.byName is keyed on `row.name.toLowerCase()` (NOT the
		// fuzzier normalizeName), and the geometry's `properties.name` matches
		// those table names verbatim, so a plain lowercase is the right key.
		const byName = countryLookup.byName.get(rawName.toLowerCase())

		// Canonical id: the padded numeric for id'd features; for id-less ones
		// the name-resolved row's numeric. Fall back (shouldn't happen — the
		// isoCountries coverage test guarantees all 177) to a name-derived id so
		// nothing collides or crashes.
		const id =
			f.id != null
				? normalizeIsoNumeric(f.id)
				: (byName?.numeric ?? `name:${rawName.toLowerCase()}`)

		// Look up the isoCountries row: by numeric for id'd features, by name for
		// id-less ones.
		const row = f.id != null ? countryLookup.byNumeric.get(id) : byName

		// Write the canonical id back so `featureId(f)` agrees with the table.
		f.id = id

		// Omit empty iso2/iso3 (N. Cyprus / Somaliland have "") so they don't
		// pollute the "iso" index; name + isoNumeric still let them join.
		// nameAliases carries the long-form / variant names (countryNames.ts)
		// so full names ("Democratic Republic of the Congo") and common
		// variants ("USA", "Republic of Korea") join the short atlas names.
		table.push({
			featureId: id,
			keys: {
				iso2: row?.iso2 || undefined,
				iso3: row?.iso3 || undefined,
				isoNumeric: id,
				name: row?.name ?? rawName,
				nameAliases: countryNameAliases(id),
			},
		})
		centroids.set(id, path.centroid(f) as [number, number])
	}

	return { features, table, centroids }
}

// Census county codes 510-899 are independent cities (41 features: 38 in VA
// plus St. Louis 29510, Baltimore 24510, Carson City 32510).
const isIndependentCity = (countyFips: string): boolean => {
	const countyCode = Number(countyFips.slice(2))
	return countyCode >= 510 && countyCode <= 899
}

const buildCountiesBundle = async (): Promise<GeometryBundle> => {
	// Dynamic import: the 842KB TopoJSON only loads (dev) / parses when a
	// counties map is actually opened. See the import note at the top.
	const mod = await import("us-atlas/counties-10m.json")
	const countiesTopo = mod.default as unknown as Topology<{
		counties: GeometryCollection
	}>
	const fc = feature(
		countiesTopo,
		countiesTopo.objects.counties,
	) as FeatureCollection
	const features = fc.features

	const path = geoPath()

	const table: GeoLookupRow[] = []
	const centroids = new Map<string, [number, number]>()

	for (const f of features) {
		const id = normalizeCountyFips(f.id)
		f.id = id

		// counties-10m names are bare ("Baltimore", "Tangipahoa") — no
		// "County"/"Parish" designator. Independent cities carry the SAME bare
		// name as their sibling county (Baltimore city 24510 vs Baltimore
		// County 24005 — all 6 within-state duplicate names are such pairs), so
		// suffix them " city" the way real data labels them. That makes every
		// state-qualified composite name unique. Carson/Charles/James City
		// already end in "City" and keep their name as-is.
		const rawName = (f.properties as { name?: string } | null)?.name ?? ""
		const name =
			isIndependentCity(id) && !/\bcity$/i.test(rawName)
				? `${rawName} city`
				: rawName

		// No abbrev key: a county row carrying its state's USPS code would let a
		// state-abbrev column join the county table and mis-map. stateFips (the
		// 2-digit prefix) instead powers the composite name keys — see
		// resolveGeography's buildIndex.
		table.push({
			featureId: id,
			keys: {
				fips: id,
				name: name || undefined,
				stateFips: id.slice(0, 2),
			},
		})
		centroids.set(id, path.centroid(f) as [number, number])
	}

	return { features, table, centroids }
}

// ZCTA codes are 5-digit strings ("00601"). Numeric sources (a CSV column
// parsed as numbers, a topology id stored numerically) lose leading zeros, so
// left-pad digits to 5. Mirrors normalizeCountyFips (also width 5) but kept
// separate: ZCTA codes are NOT FIPS codes and must never be conflated.
const normalizeZcta = (id: unknown): string => String(id ?? "").padStart(5, "0")

// Resolve a ZCTA feature's 5-digit code: the feature `id` when present,
// otherwise the usual Census cartographic-boundary properties (2020 vintage
// first, then 2010). Null when nothing usable is found (the feature is
// dropped — an id-less region can never join or be addressed).
const ZCTA_CODE_PROPS = ["ZCTA5CE20", "GEOID20", "ZCTA5CE10", "GEOID10"] as const
const zctaCode = (f: Feature): string | null => {
	if (f.id != null && f.id !== "") return normalizeZcta(f.id)
	const props = (f.properties ?? {}) as Record<string, unknown>
	for (const key of ZCTA_CODE_PROPS) {
		const v = props[key]
		if (v != null && v !== "") return normalizeZcta(v)
	}
	return null
}

const buildZctaBundle = async (): Promise<GeometryBundle> => {
	// Lazy by construction: the topology only loads (and its ~33k features only
	// decode) when a visual actually uses the ZCTA level — never on boot. The
	// decoded bundle (features + join table + centroids) is built ONCE here and
	// memoized forever via the loadGeometry promise cache below.
	const topo = await loadZctaTopology()
	// Contract (see zctaTopology.ts): features live in `objects.zctas`, or in
	// the topology's single object when the source kept its own layer name.
	const object =
		topo.objects.zctas ?? Object.values(topo.objects)[0] ?? null
	if (object === null) {
		throw new Error("ZCTA topology has no geometry objects")
	}
	const fc = feature(topo, object) as FeatureCollection

	const path = geoPath()

	const features: Feature[] = []
	const table: GeoLookupRow[] = []
	const centroids = new Map<string, [number, number]>()

	for (const f of fc.features) {
		const id = zctaCode(f)
		// Drop code-less or duplicate-coded features so featureId(feature)
		// always agrees with a unique table row (the renderer invariant every
		// bundle upholds).
		if (id === null || centroids.has(id)) continue
		f.id = id
		features.push(f)
		// The ONLY join key is the 5-digit code, under the dedicated "zip" key
		// type. No name/abbrev keys exist for ZCTAs, and indexing the codes as
		// "fips" would let county-FIPS columns silently mis-join.
		table.push({ featureId: id, keys: { zip: id } })
		centroids.set(id, path.centroid(f) as [number, number])
	}

	return { features, table, centroids }
}

// Memoize one decode promise per level so repeat calls share work and identity
// (`loadGeometry("states") === loadGeometry("states")`).
const cache = new Map<GeographyLevel, Promise<GeometryBundle>>()

/**
 * Load (and cache) the decoded geometry bundle for a geography level.
 *
 * All four levels are implemented; zcta additionally requires a topology
 * source (the sidecar asset or a registered loader — see zctaTopology.ts) and
 * rejects with a descriptive error when none exists. async so a sourceless
 * zcta rejects (rather than throws synchronously) while still returning a
 * cacheable promise. A REJECTED load is evicted from the cache so a source
 * registered later (or a transient failure) gets a fresh attempt.
 */
export const loadGeometry = (level: GeographyLevel): Promise<GeometryBundle> => {
	const cached = cache.get(level)
	if (cached) return cached

	const promise = (async (): Promise<GeometryBundle> => {
		if (level === "states") return buildStatesBundle()
		if (level === "countries") return buildCountriesBundle()
		if (level === "counties") return buildCountiesBundle()
		return buildZctaBundle()
	})()

	cache.set(level, promise)
	promise.catch(() => {
		// Don't poison the cache with a rejection (see the doc comment). The
		// original promise still rejects to every caller.
		if (cache.get(level) === promise) cache.delete(level)
	})
	return promise
}
