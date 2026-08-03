import { describe, expect, it } from "vitest"

import { planArcLabel, type ArcLabelObstacles } from "./packArcLabels"

const NONE: ArcLabelObstacles = { disks: [], bands: [], rects: [] }

const base = {
	cx: 100,
	cy: 100,
	r: 40,
	fontSize: 11,
	textWidth: 40,
	preferredPhi: 0,
}

describe("planArcLabel", () => {
	it("places at the preferred angle when nothing is in the way", () => {
		const plan = planArcLabel({ ...base, obstacles: NONE })
		expect(plan).not.toBeNull()
		expect(plan!.phi).toBe(0)
		expect(plan!.flipped).toBe(false)
		// Upper-half path draws clockwise (sweep flag 1).
		expect(plan!.pathD).toMatch(/A [\d.]+ [\d.]+ 0 0 1 /)
	})

	it("rotates away from a circle blocking the preferred spot", () => {
		// A tangent sibling directly above the labeled circle — exactly the
		// pack-layout case the collision pass exists for.
		const plan = planArcLabel({
			...base,
			obstacles: { ...NONE, disks: [{ x: 100, y: 30, r: 30 }] },
		})
		expect(plan).not.toBeNull()
		expect(plan!.phi).not.toBe(0)
	})

	it("flips the path for lower-half placements so the text stays upright", () => {
		const plan = planArcLabel({
			...base,
			preferredPhi: Math.PI, // most exposed side is straight down
			obstacles: NONE,
		})
		expect(plan).not.toBeNull()
		expect(plan!.flipped).toBe(true)
		// Reversed direction = counterclockwise sweep (flag 0).
		expect(plan!.pathD).toMatch(/A [\d.]+ [\d.]+ 0 0 0 /)
	})

	it("returns null when every angle is blocked", () => {
		// A disk that swallows the whole label band — no window anywhere.
		const plan = planArcLabel({
			...base,
			obstacles: { ...NONE, disks: [{ x: 100, y: 100, r: 70 }] },
		})
		expect(plan).toBeNull()
	})

	it("dodges an already-placed arc label band", () => {
		const first = planArcLabel({ ...base, obstacles: NONE })!
		const second = planArcLabel({
			...base,
			obstacles: { ...NONE, bands: [first.band] },
		})
		expect(second).not.toBeNull()
		expect(Math.abs(second!.phi)).toBeGreaterThan(
			first.band.halfSpan + second!.band.halfSpan - 1e-9
		)
	})

	it("dodges a rim-label rect", () => {
		// Rect sitting right on the top of the band.
		const plan = planArcLabel({
			...base,
			obstacles: {
				...NONE,
				rects: [{ x0: 80, y0: 44, x1: 120, y1: 56 }],
			},
		})
		expect(plan).not.toBeNull()
		expect(plan!.phi).not.toBe(0)
	})

	it("returns null when the text can't fit even a half-circumference", () => {
		const plan = planArcLabel({
			...base,
			r: 10,
			textWidth: 500,
			obstacles: NONE,
		})
		expect(plan).toBeNull()
	})
})
