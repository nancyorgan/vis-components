import type { FeatureCollection } from "geojson"
import { describe, expect, it } from "vitest"

import { loadGeometry } from "../../../lib/geo/loadGeometry"
import type { PlotInner } from "../../../lib/plotLayout"
import { geographic } from "./geographic"

const inner: PlotInner = { x0: 0, y0: 0, x1: 800, y1: 500 }
const innerWidth = inner.x1 - inner.x0
const innerHeight = inner.y1 - inner.y0

describe("geographic coord system", () => {
	it("projects a CONUS point inside the inner rect and emits a path string", async () => {
		const bundle = await loadGeometry("states")
		const fitTo: FeatureCollection = {
			type: "FeatureCollection",
			features: bundle.features,
		}

		const coord = geographic({ projection: "albersUsa", inner, fitTo })

		expect(coord.kind).toBe("geographic")
		if (coord.kind !== "geographic") throw new Error("expected geographic")

		// Kansas ~ [-98, 38] is well inside CONUS and must land on a finite
		// pixel within [0,width] x [0,height].
		const kansas = coord.scales.project([-98, 38])
		expect(kansas).not.toBeNull()
		const [px, py] = kansas as [number, number]
		expect(Number.isFinite(px)).toBe(true)
		expect(Number.isFinite(py)).toBe(true)
		expect(px).toBeGreaterThanOrEqual(0)
		expect(px).toBeLessThanOrEqual(innerWidth)
		expect(py).toBeGreaterThanOrEqual(0)
		expect(py).toBeLessThanOrEqual(innerHeight)

		// path(feature) renders a non-empty SVG path starting with a moveto.
		const d = coord.scales.path(bundle.features[0])
		expect(typeof d).toBe("string")
		expect(d?.startsWith("M")).toBe(true)

		// renderAxes draws nothing (projection replaces cartesian axes).
		expect(coord.renderAxes("back", inner)).toBeNull()
		expect(coord.renderAxes("front", inner)).toBeNull()
	})

	it("positions the projection INSIDE an offset inner rect (fitExtent, not origin)", async () => {
		// The panel <g> has no transform, so the projection must render in
		// absolute SVG coords offset by inner.x0/y0 — like the cartesian scales.
		// A regression here is the map drawing at the SVG origin (over the title).
		const bundle = await loadGeometry("states")
		const fitTo: FeatureCollection = {
			type: "FeatureCollection",
			features: bundle.features,
		}
		const offset: PlotInner = { x0: 120, y0: 90, x1: 700, y1: 460 }
		const coord = geographic({ projection: "albersUsa", inner: offset, fitTo })
		if (coord.kind !== "geographic") throw new Error("expected geographic")

		// A CONUS point must land within the OFFSET rect, never above/left of it.
		const kansas = coord.scales.project([-98, 38]) as [number, number]
		expect(kansas[0]).toBeGreaterThanOrEqual(offset.x0)
		expect(kansas[0]).toBeLessThanOrEqual(offset.x1)
		expect(kansas[1]).toBeGreaterThanOrEqual(offset.y0)
		expect(kansas[1]).toBeLessThanOrEqual(offset.y1)
	})

	it("projects an out-of-clip point to null under albersUsa", async () => {
		const bundle = await loadGeometry("states")
		const fitTo: FeatureCollection = {
			type: "FeatureCollection",
			features: bundle.features,
		}
		const coord = geographic({ projection: "albersUsa", inner, fitTo })
		if (coord.kind !== "geographic") throw new Error("expected geographic")

		// Antarctica is outside the albersUsa clip extent -> null.
		expect(coord.scales.project([0, -85])).toBeNull()
	})

	it("clips to the PLOT RECT (fixed frame) with clipToFit, covering it", () => {
		// A small focus-style box (lon −100..−60, lat 10..60).
		const box: FeatureCollection = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: {},
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-100, 10],
								[-100, 60],
								[-60, 60],
								[-60, 10],
								[-100, 10],
							],
						],
					},
				},
			],
		}

		// Without clipToFit: no clip rect (the world backdrop must stay visible).
		const unclipped = geographic({ projection: "naturalEarth", inner, fitTo: box })
		if (unclipped.kind !== "geographic") throw new Error("expected geographic")
		expect(unclipped.scales.clipRect ?? null).toBeNull()

		// With clipToFit: the clip rect IS the full plot rect (the fixed frame),
		// and a point well south of the box (deep South America) projects below
		// it → clipped out.
		const clipped = geographic({
			projection: "naturalEarth",
			inner,
			fitTo: box,
			clipToFit: true,
		})
		if (clipped.kind !== "geographic") throw new Error("expected geographic")
		const rect = clipped.scales.clipRect
		expect(rect).toEqual([
			[inner.x0, inner.y0],
			[inner.x1, inner.y1],
		])

		const south = clipped.scales.project([-60, -40]) // deep in South America
		expect(south).not.toBeNull()
		const [, sy] = south as [number, number]
		// It projects BELOW the plot rect's bottom edge → would be clipped out.
		expect(sy).toBeGreaterThan(inner.y1)
	})
})
