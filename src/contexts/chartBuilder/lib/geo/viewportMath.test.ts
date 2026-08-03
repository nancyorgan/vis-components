import { describe, expect, it } from "vitest"

import type { GeoViewport } from "../mapConfig"
import { clampViewport, panViewport, zoomViewport } from "./viewportMath"

const box: GeoViewport = { west: -100, south: 10, east: -60, north: 50 }
const span = (vp: GeoViewport) => ({
	lon: vp.east - vp.west,
	lat: vp.north - vp.south,
})

describe("viewportMath", () => {
	it("pans by a lon/lat delta, preserving span", () => {
		const moved = panViewport(box, 10, -5)
		expect(moved.west).toBeCloseTo(-90)
		expect(moved.east).toBeCloseTo(-50)
		expect(moved.south).toBeCloseTo(5)
		expect(moved.north).toBeCloseTo(45)
		expect(span(moved)).toEqual(span(box))
	})

	it("zooms IN around the center (factor < 1 shrinks the span)", () => {
		const z = zoomViewport(box, 0.5)
		const s0 = span(box)
		const s1 = span(z)
		expect(s1.lon).toBeCloseTo(s0.lon * 0.5)
		expect(s1.lat).toBeCloseTo(s0.lat * 0.5)
		// Center is preserved with no anchor.
		expect((z.west + z.east) / 2).toBeCloseTo((box.west + box.east) / 2)
		expect((z.south + z.north) / 2).toBeCloseTo((box.south + box.north) / 2)
	})

	it("zooms toward an anchor, keeping the anchored point fixed", () => {
		const anchor = { lon: box.west, lat: box.south } // SW corner
		const z = zoomViewport(box, 0.5, anchor)
		// The anchored corner stays put; the box shrinks toward it.
		expect(z.west).toBeCloseTo(box.west)
		expect(z.south).toBeCloseTo(box.south)
		expect(z.east).toBeCloseTo(box.west + (box.east - box.west) * 0.5)
	})

	it("clamps latitude into the safe band, re-centering rather than squashing", () => {
		const pushed = panViewport(box, 0, 100) // shove far north
		expect(pushed.north).toBeLessThanOrEqual(85)
		expect(pushed.south).toBeLessThan(pushed.north)
		// Span preserved (slid back in, not squashed).
		expect(span(pushed).lat).toBeCloseTo(span(box).lat)
	})

	it("never lets edges cross or zoom past the world", () => {
		const tiny = zoomViewport(box, 0.00001) // absurd zoom-in
		expect(tiny.east).toBeGreaterThan(tiny.west)
		expect(tiny.north).toBeGreaterThan(tiny.south)

		const huge = zoomViewport(box, 100000) // absurd zoom-out
		expect(clampViewport(huge).east).toBeGreaterThan(clampViewport(huge).west)
		expect(huge.east - huge.west).toBeLessThanOrEqual(360)
	})
})
