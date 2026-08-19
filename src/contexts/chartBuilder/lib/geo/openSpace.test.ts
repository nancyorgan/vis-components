import type { Feature } from "geojson"
import { describe, expect, it } from "vitest"

import { buildOpenSpacePredicate } from "./openSpace"

/** A 10×10-degree square region near the equator, wound CLOCKWISE — d3-geo's
 *  spherical convention for an exterior ring smaller than a hemisphere (the
 *  same winding the real topojson-derived bundles carry). The identity
 *  `invert` below treats pixels as [lon, lat] directly, so pixel space and
 *  geo space coincide and the geometry doubles as its own pixel bounds. */
const square = (id: string): Feature => ({
	type: "Feature",
	id,
	properties: {},
	geometry: {
		type: "Polygon",
		coordinates: [
			[
				[0, 0],
				[0, 10],
				[10, 10],
				[10, 0],
				[0, 0],
			],
		],
	},
})

const identityArgs = {
	bounds: (): [[number, number], [number, number]] => [
		[0, 0],
		[10, 10],
	],
	invert: (pixel: [number, number]): [number, number] | null => pixel,
}

describe("buildOpenSpacePredicate", () => {
	it("marks pixels inside a data-carrying region as NOT open", () => {
		const isOpen = buildOpenSpacePredicate({
			features: [square("06")],
			occupiedIds: new Set(["06"]),
			...identityArgs,
		})
		expect(isOpen(5, 5)).toBe(false)
	})

	it("marks pixels outside every region (ocean) as open", () => {
		const isOpen = buildOpenSpacePredicate({
			features: [square("06")],
			occupiedIds: new Set(["06"]),
			...identityArgs,
		})
		expect(isOpen(50, 50)).toBe(true)
	})

	it("marks pixels inside a NO-DATA region as open — empty neighbors are fair game", () => {
		const isOpen = buildOpenSpacePredicate({
			features: [square("06")],
			occupiedIds: new Set<string>(),
			...identityArgs,
		})
		expect(isOpen(5, 5)).toBe(true)
	})

	it("treats uninvertible pixels (outside a composite projection) as open", () => {
		const isOpen = buildOpenSpacePredicate({
			features: [square("06")],
			occupiedIds: new Set(["06"]),
			bounds: identityArgs.bounds,
			invert: () => null,
		})
		// Inside the pixel bbox, but the projection can't invert it — nothing
		// is drawn there, so it's open.
		expect(isOpen(5, 5)).toBe(true)
	})
})
