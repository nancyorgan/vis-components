import { describe, expect, it } from "vitest"

import type { Field, FieldType } from "../types"
import {
	detectGeoFields,
	EMPTY_GEO_DETECTION,
	hasGeoFields,
} from "./detectGeoFields"

const field = (name: string, inferredType: FieldType): Field => ({
	name,
	inferredType,
})

/** Build rows from parallel column value arrays (recycled to the longest). */
const rowsOf = (columns: Record<string, string[]>): Record<string, string>[] => {
	const names = Object.keys(columns)
	const length = Math.max(...names.map((n) => columns[n]!.length))
	return Array.from({ length }, (_, i) =>
		Object.fromEntries(
			names.map((n) => [n, columns[n]![i % columns[n]!.length]!])
		)
	)
}

describe("detectGeoFields — region fields", () => {
	it("detects a column of US state names (level states, keyType name)", () => {
		const fields = [field("place", "categorical"), field("sales", "quantitative")]
		const rows = rowsOf({
			place: ["California", "Texas", "New York", "Florida", "Ohio"],
			sales: ["1", "2", "3", "4", "5"],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields).toHaveLength(1)
		expect(d.regionFields[0]!.field.name).toBe("place")
		expect(d.regionFields[0]!.level).toBe("states")
		expect(d.regionFields[0]!.keyType).toBe("name")
		expect(hasGeoFields(d)).toBe(true)
	})

	it("detects USPS abbreviations as a states region field", () => {
		const fields = [field("st", "categorical")]
		const rows = rowsOf({ st: ["CA", "TX", "NY", "FL", "WA"] })
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields[0]?.level).toBe("states")
		expect(d.regionFields[0]?.keyType).toBe("abbrev")
	})

	it("detects ISO3 country codes as a countries region field", () => {
		const fields = [field("nation", "categorical")]
		const rows = rowsOf({ nation: ["USA", "FRA", "DEU", "JPN", "BRA"] })
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields[0]?.level).toBe("countries")
		expect(d.regionFields[0]?.keyType).toBe("iso")
	})

	it("detects country names as a countries region field", () => {
		const fields = [field("country", "categorical")]
		const rows = rowsOf({
			country: ["France", "Germany", "Japan", "Brazil", "Canada"],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields[0]?.level).toBe("countries")
		expect(d.regionFields[0]?.keyType).toBe("name")
	})

	it("accepts an integer FIPS column when the field NAME is geographic", () => {
		const fields = [field("state_fips", "quantitative")]
		const rows = rowsOf({ state_fips: ["6", "48", "36", "12", "39"] })
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields[0]?.field.name).toBe("state_fips")
		expect(d.regionFields[0]?.level).toBe("states")
		expect(d.regionFields[0]?.keyType).toBe("fips")
	})

	it("rejects the same integer values under a non-geographic name (month ≠ FIPS)", () => {
		const fields = [field("month", "quantitative")]
		const rows = rowsOf({
			month: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields).toHaveLength(0)
		expect(hasGeoFields(d)).toBe(false)
	})

	it("rejects ordinary categorical values", () => {
		const fields = [field("fruit", "categorical")]
		const rows = rowsOf({ fruit: ["apple", "banana", "cherry", "kiwi"] })
		expect(detectGeoFields(fields, rows).regionFields).toHaveLength(0)
	})

	it("rejects a column where only a minority of values are place-like", () => {
		// "Georgia" alone joins, but the 80% threshold keeps person-name
		// columns from reading as geography.
		const fields = [field("name", "categorical")]
		const rows = rowsOf({
			name: ["Georgia", "Alice", "Bob", "Carol", "Dave"],
		})
		expect(detectGeoFields(fields, rows).regionFields).toHaveLength(0)
	})

	it("tolerates a few unmatched values above the threshold", () => {
		// 4 of 5 distinct values join (80%) — Puerto Rico isn't in the
		// 50-states table but shouldn't disqualify the column.
		const fields = [field("state", "categorical")]
		const rows = rowsOf({
			state: ["California", "Texas", "New York", "Ohio", "Puerto Rico"],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields).toHaveLength(1)
		expect(d.regionFields[0]!.matchRate).toBeCloseTo(0.8)
	})

	it("breaks a name tie (e.g. Georgia) toward states", () => {
		const fields = [field("region", "categorical")]
		const rows = rowsOf({ region: ["Georgia"] })
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields[0]?.level).toBe("states")
	})

	it("respects field-type overrides (overridden-to-temporal is skipped)", () => {
		const fields = [field("place", "categorical")]
		const rows = rowsOf({ place: ["California", "Texas", "Ohio"] })
		const d = detectGeoFields(fields, rows, { place: "temporal" })
		expect(d.regionFields).toHaveLength(0)
	})
})

describe("detectGeoFields — county fields", () => {
	it("detects designator-suffixed county names (level counties, keyType name)", () => {
		const fields = [field("area", "categorical"), field("rate", "quantitative")]
		const rows = rowsOf({
			area: [
				"Cook County",
				"DuPage County",
				"Terrebonne Parish",
				"Kodiak Island Borough",
				"Yukon-Koyukuk Census Area",
			],
			rate: ["1", "2", "3", "4", "5"],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields).toHaveLength(1)
		expect(d.regionFields[0]!.field.name).toBe("area")
		expect(d.regionFields[0]!.level).toBe("counties")
		expect(d.regionFields[0]!.keyType).toBe("name")
		expect(hasGeoFields(d)).toBe(true)
	})

	it("detects state-qualified county names in the forms the resolver joins", () => {
		const fields = [field("region", "categorical")]
		const rows = rowsOf({
			region: [
				"Cook County, Illinois", // full state name
				"Harris County, TX", // USPS abbrev
				"Washington County, 48", // state FIPS qualifier
				"St. Landry Parish, LA",
				"Los Angeles County, CA",
			],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields[0]?.level).toBe("counties")
		expect(d.regionFields[0]?.keyType).toBe("name")
	})

	it("detects county FIPS codes under a geographic field name (padded or not)", () => {
		const fields = [field("county_fips", "quantitative")]
		const rows = rowsOf({
			county_fips: ["17031", "48201", "06037", "6037", "04013"],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields[0]?.level).toBe("counties")
		expect(d.regionFields[0]?.keyType).toBe("fips")
	})

	it("rejects 5-digit integers whose prefix is no state (ZIP-like) or whose field name isn't geographic", () => {
		// Valid county-FIPS values, but "code" carries no geographic hint.
		const unhinted = detectGeoFields(
			[field("code", "quantitative")],
			rowsOf({ code: ["17031", "48201", "06037"] })
		)
		expect(unhinted.regionFields).toHaveLength(0)

		// Geographic name, but the 2-digit prefixes (99/98/03) are no states.
		const badPrefix = detectGeoFields(
			[field("county_fips", "quantitative")],
			rowsOf({ county_fips: ["99001", "98002", "03003"] })
		)
		expect(badPrefix.regionFields).toHaveLength(0)
	})

	it("accepts designator-less qualified names ('Cook, IL') only on a county-named field", () => {
		const rows = rowsOf({
			county: ["Cook, IL", "Harris, TX", "Travis, TX", "King, WA"],
			city: ["Cook, IL", "Harris, TX", "Travis, TX", "King, WA"],
		})
		const fields = [field("county", "categorical"), field("city", "categorical")]
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields).toHaveLength(1)
		expect(d.regionFields[0]!.field.name).toBe("county")
		expect(d.regionFields[0]!.level).toBe("counties")
	})

	it("rejects bare unqualified names — ambiguous across states, collide with cities/people", () => {
		const fields = [field("county", "categorical")]
		const rows = rowsOf({
			county: ["Cook", "Harris", "Springfield", "Franklin", "Riverside"],
		})
		expect(detectGeoFields(fields, rows).regionFields).toHaveLength(0)
	})

	it("breaks a states/counties tie toward states, like the map's auto level", () => {
		// "Washington County" also joins the states table (normalizeName strips
		// the designator), so a column of ONLY state-named counties reads as
		// states — matching what geographyLevel "auto" resolves at render time.
		const fields = [field("area", "categorical")]
		const rows = rowsOf({ area: ["Washington County", "Utah County"] })
		expect(detectGeoFields(fields, rows).regionFields[0]?.level).toBe("states")
	})

	it("tolerates a few non-county values above the threshold", () => {
		// 4 of 5 join (80%) — one stray value shouldn't disqualify the column.
		const fields = [field("county", "categorical")]
		const rows = rowsOf({
			county: [
				"Cook County",
				"DuPage County",
				"Lake County",
				"Will County",
				"Unknown",
			],
		})
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields).toHaveLength(1)
		expect(d.regionFields[0]!.matchRate).toBeCloseTo(0.8)
	})
})

describe("detectGeoFields — lat/long", () => {
	const usLat = ["34.05", "40.71", "41.88", "29.76", "47.61"]
	const usLon = ["-118.24", "-74.01", "-87.63", "-95.37", "-122.33"]

	it("detects latitude/longitude columns by name + range", () => {
		const fields = [
			field("latitude", "quantitative"),
			field("longitude", "quantitative"),
			field("value", "quantitative"),
		]
		const rows = rowsOf({ latitude: usLat, longitude: usLon, value: ["1"] })
		const d = detectGeoFields(fields, rows)
		expect(d.latField?.name).toBe("latitude")
		expect(d.lonField?.name).toBe("longitude")
		expect(hasGeoFields(d)).toBe(true)
	})

	it("matches abbreviated and camelCase names (lat, pickupLng)", () => {
		const fields = [
			field("lat", "quantitative"),
			field("pickupLng", "quantitative"),
		]
		const rows = rowsOf({ lat: usLat, pickupLng: usLon })
		const d = detectGeoFields(fields, rows)
		expect(d.latField?.name).toBe("lat")
		expect(d.lonField?.name).toBe("pickupLng")
	})

	it("rejects a lat-named column whose values are out of coordinate range", () => {
		const fields = [
			field("lat", "quantitative"),
			field("lon", "quantitative"),
		]
		const rows = rowsOf({
			lat: ["500", "612", "833"], // not latitudes
			lon: usLon,
		})
		const d = detectGeoFields(fields, rows)
		expect(d.latField).toBeNull()
	})

	it("does not treat unrelated quantitative columns as coordinates", () => {
		const fields = [field("salary", "quantitative"), field("age", "quantitative")]
		const rows = rowsOf({ salary: ["50", "60"], age: ["30", "40"] })
		const d = detectGeoFields(fields, rows)
		expect(d.latField).toBeNull()
		expect(d.lonField).toBeNull()
	})

	it("suggests the states basemap for US points and countries for world points", () => {
		const fields = [field("lat", "quantitative"), field("lon", "quantitative")]
		const us = detectGeoFields(fields, rowsOf({ lat: usLat, lon: usLon }))
		expect(us.pointsLevel).toBe("states")

		const world = detectGeoFields(
			fields,
			rowsOf({
				lat: ["48.85", "35.68", "-33.87", "51.51", "55.75"],
				lon: ["2.35", "139.69", "151.21", "-0.13", "37.62"],
			})
		)
		expect(world.pointsLevel).toBe("countries")
	})
})

describe("detectGeoFields — misc", () => {
	it("returns the empty detection for an empty dataset", () => {
		expect(detectGeoFields([], [])).toEqual(EMPTY_GEO_DETECTION)
		expect(hasGeoFields(EMPTY_GEO_DETECTION)).toBe(false)
	})

	it("skips blank values when sampling", () => {
		const fields = [field("state", "categorical")]
		const rows = rowsOf({ state: ["", "California", "", "Texas", "Ohio"] })
		const d = detectGeoFields(fields, rows)
		expect(d.regionFields).toHaveLength(1)
		expect(d.regionFields[0]!.matchRate).toBe(1)
	})
})
