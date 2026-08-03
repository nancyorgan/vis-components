import type { FeatureCollection } from "geojson"
import { feature } from "topojson-client"
import type { GeometryCollection, Topology } from "topojson-specification"
import countriesTopology from "world-atlas/countries-110m.json"
import { describe, expect, it } from "vitest"

import { ISO_COUNTRIES, countryLookup } from "./isoCountries"

// Decode the bundled world-atlas geometry the same way the geometry loader
// will: `feature(topo, topo.objects.countries)`. The features carry a numeric
// ISO id (as a string) -- except a few Natural-Earth disputed entries whose id
// is `undefined`; those join by name only.
const topology = countriesTopology as unknown as Topology<{
	countries: GeometryCollection
}>
const fc = feature(topology, topology.objects.countries) as FeatureCollection
const features = fc.features

// Mirror the id normalization used at the join boundary: a defined id becomes a
// 3-digit zero-padded numeric string; an undefined id stays undefined.
const normalizeNumeric = (id: unknown): string | undefined =>
	id == null ? undefined : String(id).padStart(3, "0")

describe("isoCountries", () => {
	it("covers every world-atlas countries-110m feature (numeric OR name)", () => {
		const unmatched: string[] = []
		for (const f of features) {
			const numeric = normalizeNumeric(f.id)
			const name = String(f.properties?.name ?? "")
			const byNumeric = numeric ? countryLookup.byNumeric.get(numeric) : undefined
			const byName = countryLookup.byName.get(name.toLowerCase())
			if (!byNumeric && !byName) {
				unmatched.push(`${numeric ?? "(undef)"} / ${name}`)
			}
		}
		expect(unmatched).toEqual([])
	})

	it("covers every feature with a numeric id via byNumeric", () => {
		const missing: string[] = []
		for (const f of features) {
			const numeric = normalizeNumeric(f.id)
			if (numeric && !countryLookup.byNumeric.has(numeric)) {
				missing.push(`${numeric} / ${String(f.properties?.name)}`)
			}
		}
		expect(missing).toEqual([])
	})

	it("makes every disputed (id-less) feature findable by name", () => {
		// The handful of Natural-Earth entries with no numeric id (Kosovo,
		// N. Cyprus, Somaliland) can only join by name, so their geometry name
		// MUST be a byName key.
		const missing: string[] = []
		for (const f of features) {
			if (f.id != null) continue
			const name = String(f.properties?.name ?? "")
			if (!countryLookup.byName.has(name.toLowerCase())) {
				missing.push(name)
			}
		}
		expect(missing).toEqual([])
	})

	it("has well-formed rows (numeric 3 digits; iso2/iso3 empty or upper)", () => {
		for (const row of ISO_COUNTRIES) {
			expect(row.numeric).toMatch(/^\d{3}$/)
			expect(row.iso2 === "" || /^[A-Z]{2}$/.test(row.iso2)).toBe(true)
			expect(row.iso3 === "" || /^[A-Z]{3}$/.test(row.iso3)).toBe(true)
			expect(row.name.length).toBeGreaterThan(0)
		}
	})

	it("has unique numeric codes and unique non-empty iso2/iso3", () => {
		const numerics = ISO_COUNTRIES.map((r) => r.numeric)
		expect(new Set(numerics).size).toBe(numerics.length)

		const iso2s = ISO_COUNTRIES.map((r) => r.iso2).filter((v) => v !== "")
		expect(new Set(iso2s).size).toBe(iso2s.length)

		const iso3s = ISO_COUNTRIES.map((r) => r.iso3).filter((v) => v !== "")
		expect(new Set(iso3s).size).toBe(iso3s.length)
	})

	it("builds lookup Maps consistent with the row array", () => {
		expect(countryLookup.byNumeric.size).toBe(ISO_COUNTRIES.length)
		// byName has one key per row (names are unique in the table).
		expect(countryLookup.byName.size).toBe(ISO_COUNTRIES.length)
	})

	it("matches well-known countries exactly", () => {
		const cases: Array<[string, string, string]> = [
			["840", "US", "USA"],
			["826", "GB", "GBR"],
			["250", "FR", "FRA"],
			["276", "DE", "DEU"],
			["156", "CN", "CHN"],
			["392", "JP", "JPN"],
			["076", "BR", "BRA"],
			["356", "IN", "IND"],
			["643", "RU", "RUS"],
			["124", "CA", "CAN"],
		]
		for (const [numeric, iso2, iso3] of cases) {
			expect(countryLookup.byIso3.get(iso3)?.numeric).toBe(numeric)
			expect(countryLookup.byIso2.get(iso2)?.numeric).toBe(numeric)
			expect(countryLookup.byIso2.get(iso2)?.iso3).toBe(iso3)
			expect(countryLookup.byNumeric.get(numeric)?.iso2).toBe(iso2)
		}
	})

	it("keys byName in lowercase", () => {
		expect(countryLookup.byName.get("france")?.iso3).toBe("FRA")
		expect(countryLookup.byName.get("united states of america")?.numeric).toBe(
			"840",
		)
	})
})
