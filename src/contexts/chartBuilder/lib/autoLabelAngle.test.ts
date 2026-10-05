import { describe, expect, it } from "vitest"

import { AUTO_ANGLE_DEG, autoLabelAngleFor } from "./autoLabelAngle"

describe("autoLabelAngleFor", () => {
	const base = { fontSize: 16, userAngle: null }

	it("honors any explicit angle — including 0 — over the heuristic", () => {
		const crowded = {
			...base,
			labels: ["Cardiothoracic Surgery", "Internal Medicine"],
			bandWidthPx: 40,
		}
		expect(autoLabelAngleFor({ ...crowded, userAngle: 0 })).toBe(0)
		expect(autoLabelAngleFor({ ...crowded, userAngle: -30 })).toBe(-30)
		expect(autoLabelAngleFor({ ...crowded, userAngle: null })).toBe(AUTO_ANGLE_DEG)
		expect(autoLabelAngleFor({ ...crowded, userAngle: undefined })).toBe(AUTO_ANGLE_DEG)
	})

	it("stays level while wrapping is the overflow strategy", () => {
		expect(
			autoLabelAngleFor({
				...base,
				labels: ["Cardiothoracic Surgery", "Internal Medicine"],
				bandWidthPx: 40,
				wrapEnabled: true,
			})
		).toBe(0)
	})

	it("compares NEIGHBORS, not the widest label against the band", () => {
		// 2020…2024 are narrow; only the last label is wide. Centered on
		// 77px ticks, half of 120 + half of 38 + a 4px gap = 83 > 77 → collide.
		const widths = [40, 38, 38, 38, 38, 120]
		const labels = ["2020", "2021", "2022", "2023", "2024", "2025 (Jan–May)"]
		expect(
			autoLabelAngleFor({ ...base, labels, labelWidthsPx: widths, bandWidthPx: 77 })
		).toBe(AUTO_ANGLE_DEG)
		// At 84px the same pair clears: 60 + 19 + 4 = 83 ≤ 84. The old
		// widest-vs-band rule (120 > 0.9 × 84) would still have rotated.
		expect(
			autoLabelAngleFor({ ...base, labels, labelWidthsPx: widths, bandWidthPx: 84 })
		).toBe(0)
		// Two wide labels side by side collide at a width where one would fit.
		expect(
			autoLabelAngleFor({
				...base,
				labels: ["2025 (Jan–May)", "2026 (Jan–May)"],
				labelWidthsPx: [120, 120],
				bandWidthPx: 120,
			})
		).toBe(AUTO_ANGLE_DEG)
	})

	it("uses real tick positions when given (strided axes keep an uneven last gap)", () => {
		const labels = ["A", "B", "Long label here"]
		const widths = [10, 10, 100]
		// Uniform 60px spacing: 5 + 50 + 4 = 59 ≤ 60 → fits.
		expect(
			autoLabelAngleFor({ ...base, labels, labelWidthsPx: widths, bandWidthPx: 60 })
		).toBe(0)
		// Same labels, but the last tick sits only 40px from its neighbor.
		expect(
			autoLabelAngleFor({
				...base,
				labels,
				labelWidthsPx: widths,
				bandWidthPx: 60,
				positionsPx: [0, 60, 100],
			})
		).toBe(AUTO_ANGLE_DEG)
	})

	it("falls back to the char-count estimate without measured widths", () => {
		// 14 chars × 16px × 0.55 = 123px each; two of them need ~127px.
		const labels = ["2025 (Jan–May)", "2026 (Jan–May)"]
		expect(autoLabelAngleFor({ ...base, labels, bandWidthPx: 120 })).toBe(AUTO_ANGLE_DEG)
		expect(autoLabelAngleFor({ ...base, labels, bandWidthPx: 130 })).toBe(0)
		// A 0 entry (canvas unavailable) also falls back, per label.
		expect(
			autoLabelAngleFor({ ...base, labels, labelWidthsPx: [0, 0], bandWidthPx: 120 })
		).toBe(AUTO_ANGLE_DEG)
	})

	it("never rotates a single label or an empty axis", () => {
		expect(autoLabelAngleFor({ ...base, labels: ["x".repeat(80)], bandWidthPx: 10 })).toBe(0)
		expect(autoLabelAngleFor({ ...base, labels: [], bandWidthPx: 10 })).toBe(0)
		expect(autoLabelAngleFor({ ...base, labels: ["a", "b"], bandWidthPx: 0 })).toBe(0)
	})
})
