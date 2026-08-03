import { geoPath } from "d3-geo"
import type { Feature, FeatureCollection } from "geojson"
// us-atlas ships TopoJSON; topojson-client decodes it into GeoJSON features.
import { feature } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
// Statically bundled so the states map needs no network fetch (per the design;
// the file is ~100KB). counties/zcta are loaded in a later phase and
// intentionally not imported here. countries (~110KB) ships statically too.
import statesTopology from "us-atlas/states-10m.json"
import countriesTopology from "world-atlas/countries-110m.json"
import type { GeographyLevel } from "../mapConfig"
import { stateLookup } from "./usStates"
import { countryLookup } from "./isoCountries"
import type { GeoLookupRow } from "./resolveGeography"

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
// TODO(phase4): county FIPS need 5-digit-aware padding.
const normalizeFips = (id: unknown): string => String(id ?? "").padStart(2, "0")

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
		table.push({
			featureId: id,
			keys: {
				iso2: row?.iso2 || undefined,
				iso3: row?.iso3 || undefined,
				isoNumeric: id,
				name: row?.name ?? rawName,
			},
		})
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
 * Implements `"states"` (Phase 1) and `"countries"` (Phase 2); other levels
 * reject with a NotImplemented-style error. async so unimplemented levels reject
 * (rather than throw synchronously) while still returning a cacheable promise.
 */
export const loadGeometry = (level: GeographyLevel): Promise<GeometryBundle> => {
	const cached = cache.get(level)
	if (cached) return cached

	const promise = (async (): Promise<GeometryBundle> => {
		if (level === "states") return buildStatesBundle()
		if (level === "countries") return buildCountriesBundle()
		throw new Error(`loadGeometry: level "${level}" not implemented yet`)
	})()

	cache.set(level, promise)
	return promise
}
