import { describe, expect, it } from "vitest"

import { resolveGeoProjection } from "./geoProjection"

describe("resolveGeoProjection", () => {
	it("auto + countries -> naturalEarth", () => {
		expect(resolveGeoProjection("countries", "auto")).toBe("naturalEarth")
	})

	it("auto + states -> albersUsa", () => {
		expect(resolveGeoProjection("states", "auto")).toBe("albersUsa")
	})

	it("auto + non-country levels -> albersUsa", () => {
		expect(resolveGeoProjection("counties", "auto")).toBe("albersUsa")
		expect(resolveGeoProjection("zcta", "auto")).toBe("albersUsa")
	})

	it("explicit projection passes through regardless of level", () => {
		expect(resolveGeoProjection("countries", "albersUsa")).toBe("albersUsa")
		expect(resolveGeoProjection("states", "naturalEarth")).toBe("naturalEarth")
		expect(resolveGeoProjection("countries", "mercator")).toBe("mercator")
		expect(resolveGeoProjection("states", "mercator")).toBe("mercator")
	})

	it("a focus region forces a world projection (albersUsa can't pan/zoom)", () => {
		// Even an explicit albersUsa is overridden — it clips everything outside
		// the US, so a focused map would otherwise be blank.
		expect(resolveGeoProjection("states", "albersUsa", "europe")).toBe(
			"naturalEarth"
		)
		expect(resolveGeoProjection("states", "auto", "northAmerica")).toBe(
			"naturalEarth"
		)
	})

	it("a focus region honors an explicit Mercator", () => {
		expect(resolveGeoProjection("countries", "mercator", "asia")).toBe(
			"mercator"
		)
	})
})
