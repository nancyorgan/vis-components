import { describe, expect, it } from "vitest"

import { DEFAULT_MAP_CONFIG } from "../mapConfig"
import { emptyEncodings } from "../types"
import { GeoPointsMode } from "./geoPoints"

const geo = { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" as const }

describe("GeoPointsMode.detect", () => {
	it("true when geographic + x + y mapped (lat/long dot map)", () => {
		const e = {
			...emptyEncodings(),
			x: { field: "lon" },
			y: { field: "lat" },
		}
		expect(GeoPointsMode.detect(e, undefined, undefined, geo)).toBe(true)
	})

	it("false when geographic + x but no y", () => {
		const e = { ...emptyEncodings(), x: { field: "lon" } }
		expect(GeoPointsMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("false when geographic + y but no x", () => {
		const e = { ...emptyEncodings(), y: { field: "lat" } }
		expect(GeoPointsMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("false when NOT geographic even with x + y mapped", () => {
		const e = {
			...emptyEncodings(),
			x: { field: "lon" },
			y: { field: "lat" },
		}
		expect(
			GeoPointsMode.detect(e, undefined, undefined, DEFAULT_MAP_CONFIG)
		).toBe(false)
	})

	it("safe-false when mapConfig is absent", () => {
		const e = {
			...emptyEncodings(),
			x: { field: "lon" },
			y: { field: "lat" },
		}
		expect(GeoPointsMode.detect(e)).toBe(false)
	})

	it("still true when area is also mapped (sized point markers, still a point map)", () => {
		const e = {
			...emptyEncodings(),
			x: { field: "lon" },
			y: { field: "lat" },
			area: { field: "pop" },
		}
		expect(GeoPointsMode.detect(e, undefined, undefined, geo)).toBe(true)
	})

	it("still true when connection is also mapped (x/y position wins)", () => {
		const e = {
			...emptyEncodings(),
			x: { field: "lon" },
			y: { field: "lat" },
			connection: { field: "state" },
		}
		expect(GeoPointsMode.detect(e, undefined, undefined, geo)).toBe(true)
	})
})

describe("GeoPointsMode.legend", () => {
	// x/y carry the position (lon/lat); the connection / length / angle channels
	// are not visual series here, mirroring the other geographic modes.
	it("hides the connection legend section", () => {
		expect(GeoPointsMode.legend.hideConnectionInThisMode).toBe(true)
	})
})
