import { geoPath, geoNaturalEarth1 } from "d3-geo"
import { describe, expect, it } from "vitest"

import { FOCUS_REGIONS } from "../mapConfig"
import { FOCUS_REGION_BOUNDS, focusRegionGeoJson } from "./focusRegion"

describe("focusRegionGeoJson", () => {
	it("returns null for auto (callers fall back to fitting the geometry)", () => {
		expect(focusRegionGeoJson("auto")).toBeNull()
	})

	it("builds a closed polygon ring within the region's bounds for every region", () => {
		for (const region of FOCUS_REGIONS) {
			const feature = focusRegionGeoJson(region)
			expect(feature).not.toBeNull()
			expect(feature!.geometry.type).toBe("Polygon")
			const ring = (feature!.geometry as GeoJSON.Polygon).coordinates[0]
			// Closed ring: first point equals last.
			expect(ring[0]).toEqual(ring[ring.length - 1])

			// Every vertex sits within the declared bounds (densified edges never
			// stray outside the box).
			const [[west, south], [east, north]] = FOCUS_REGION_BOUNDS[region]
			for (const [lon, lat] of ring) {
				expect(lon).toBeGreaterThanOrEqual(west)
				expect(lon).toBeLessThanOrEqual(east)
				expect(lat).toBeGreaterThanOrEqual(south)
				expect(lat).toBeLessThanOrEqual(north)
			}
		}
	})

	it("produces a fittable region (non-degenerate projected bounds)", () => {
		// The whole point is to drive `fitSize`; a degenerate (zero-area)
		// projected bbox would zoom to a point. Project Europe and assert the
		// path bounds have real width + height.
		const feature = focusRegionGeoJson("europe")!
		const proj = geoNaturalEarth1()
		const [[x0, y0], [x1, y1]] = geoPath(proj).bounds(feature)
		expect(x1 - x0).toBeGreaterThan(0)
		expect(y1 - y0).toBeGreaterThan(0)
	})

	it("winds clockwise so fitSize zooms IN, not out (d3-geo spherical interior)", () => {
		// Regression guard for the winding-order gotcha: a counterclockwise ring
		// makes d3-geo read the box as the whole-globe complement, so fitSize
		// fits the entire sphere and the focus is a no-op. A correctly wound
		// (clockwise) region must fit at a MUCH larger scale than the full
		// sphere — i.e. it actually zooms in on the region.
		for (const region of FOCUS_REGIONS) {
			const regionProj = geoNaturalEarth1()
			regionProj.fitSize([600, 400], focusRegionGeoJson(region)! as never)
			const sphereProj = geoNaturalEarth1()
			sphereProj.fitSize([600, 400], { type: "Sphere" } as never)
			expect(regionProj.scale()).toBeGreaterThan(sphereProj.scale())
		}
	})
})
