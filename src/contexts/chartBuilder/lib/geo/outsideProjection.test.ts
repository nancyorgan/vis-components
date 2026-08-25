import { describe, expect, it } from "vitest"

import {
	countCentroidsOutsideProjection,
	countPointsOutsideProjection,
} from "./outsideProjection"

/** Rows shaped like the dot map's data: lon on `x`'s field, lat on `y`'s. */
const row = (lon: unknown, lat: unknown) => ({ lon, lat })

const NYC = row("-74", "40.7")
const LA = row("-118", "34")
const HONOLULU = row("-157.8", "21.3") // albersUsa Hawaii INSET — still inside
const TOKYO = row("139.7", "35.7")
const PARIS = row("2.35", "48.85")

describe("countPointsOutsideProjection", () => {
	it("counts non-US points as outside under albersUsa (US insets included)", () => {
		const rows = [NYC, LA, HONOLULU, TOKYO, PARIS]
		expect(countPointsOutsideProjection(rows, "lon", "lat", "albersUsa")).toEqual(
			{ outside: 2, total: 5 }
		)
	})

	it("counts nothing outside under the world projections", () => {
		const rows = [NYC, TOKYO, PARIS]
		expect(
			countPointsOutsideProjection(rows, "lon", "lat", "naturalEarth")
		).toEqual({ outside: 0, total: 3 })
		expect(countPointsOutsideProjection(rows, "lon", "lat", "mercator")).toEqual(
			{ outside: 0, total: 3 }
		)
	})

	it("excludes rows with unusable lon/lat from BOTH counts (they never draw)", () => {
		// Mirrors GeoPointPlot's parse: blank / non-numeric / missing rows are
		// skipped before projection, so they aren't "outside" anything.
		const rows = [NYC, row("", "40"), row("not a lon", "40"), row("-74", null), TOKYO]
		expect(countPointsOutsideProjection(rows, "lon", "lat", "albersUsa")).toEqual(
			{ outside: 1, total: 2 }
		)
	})

	it("returns zeros for no rows", () => {
		expect(countPointsOutsideProjection([], "lon", "lat", "albersUsa")).toEqual({
			outside: 0,
			total: 0,
		})
	})
})

describe("countCentroidsOutsideProjection", () => {
	it("counts non-US centroids as outside under albersUsa only", () => {
		const centroids: Array<[number, number]> = [
			[-98.5, 39.8], // ~geographic center of the lower 48
			[133.7, -25.2], // ~Australia
		]
		expect(countCentroidsOutsideProjection(centroids, "albersUsa")).toEqual({
			outside: 1,
			total: 2,
		})
		expect(countCentroidsOutsideProjection(centroids, "naturalEarth")).toEqual({
			outside: 0,
			total: 2,
		})
	})
})
