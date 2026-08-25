import { describe, expect, it } from "vitest"

import { applicableOpacitySlots, OPACITY_SLOT_REGISTRY } from "./opacitySlots"

describe("applicableOpacitySlots", () => {
	it("always includes border on every mode", () => {
		expect(
			applicableOpacitySlots("scatter", {} as never, {}).map((d) => d.key)
		).toContain("border")
		expect(
			applicableOpacitySlots("radar", {} as never, {}).map((d) => d.key)
		).toContain("border")
	})

	it("offers the rug slot only when a histogram is on", () => {
		expect(
			applicableOpacitySlots("bars-x", {} as never, {}).map((d) => d.key)
		).not.toContain("rug")
		expect(
			applicableOpacitySlots("bars-x", {} as never, {
				x: { histogram: { enabled: true } } as never,
			}).map((d) => d.key)
		).toContain("rug")
	})

	it("keeps the rug slot for the density display (scatter)", () => {
		expect(
			applicableOpacitySlots("scatter", {} as never, {
				x: { distributionOverlay: { showDensityCurve: true } } as never,
			}).map((d) => d.key)
		).toContain("rug")
		expect(
			applicableOpacitySlots("scatter", {} as never, {}).map((d) => d.key)
		).not.toContain("rug")
	})

	it("hides violin/box slots until an overlay is active", () => {
		expect(
			applicableOpacitySlots("scatter", {} as never, {}).map((d) => d.key)
		).not.toContain("violinFill")
		expect(
			applicableOpacitySlots("scatter", {} as never, {
				x: { distributionOverlay: { showBoxPlot: true } } as never,
			}).map((d) => d.key)
		).toContain("violinFill")
	})

	it("gates the density-curve fill slot on 'Fill under curve' (outline follows the curve alone)", () => {
		// Curve on, fill unchecked → outline opacity only.
		const noFill = applicableOpacitySlots("bars-x", {} as never, {
			x: { histogram: { enabled: true, showDensity: true } } as never,
		}).map((d) => d.key)
		expect(noFill).toContain("densityCurveStroke")
		expect(noFill).not.toContain("densityCurveFill")
		// Fill checked → both.
		const filled = applicableOpacitySlots("bars-x", {} as never, {
			x: {
				histogram: { enabled: true, showDensity: true, densityFill: true },
			} as never,
		}).map((d) => d.key)
		expect(filled).toContain("densityCurveStroke")
		expect(filled).toContain("densityCurveFill")
	})

	it("offers the node + ribbon slots on the flow modes only", () => {
		for (const mode of ["chord", "sankey"] as const) {
			const keys = applicableOpacitySlots(mode, {} as never, {}).map(
				(d) => d.key
			)
			expect(keys).toContain("node")
			expect(keys).toContain("ribbon")
		}
		const scatterKeys = applicableOpacitySlots("scatter", {} as never, {}).map(
			(d) => d.key
		)
		expect(scatterKeys).not.toContain("node")
		expect(scatterKeys).not.toContain("ribbon")
	})

	it("defaults ribbons to the 0.45 translucent wash and nodes to full opacity, level-only", () => {
		const node = OPACITY_SLOT_REGISTRY.find((d) => d.key === "node")
		const ribbon = OPACITY_SLOT_REGISTRY.find((d) => d.key === "ribbon")
		expect(ribbon?.defaultLevel).toBe(0.45)
		expect(node?.defaultLevel).toBe(1)
		expect(ribbon?.acceptsFieldMapping).toBe(false)
		expect(node?.acceptsFieldMapping).toBe(false)
	})

	it("spine is level-only and radar-scoped", () => {
		const spine = OPACITY_SLOT_REGISTRY.find((d) => d.key === "spine")
		expect(spine?.acceptsFieldMapping).toBe(false)
		expect(
			applicableOpacitySlots("radar", {} as never, {}).map((d) => d.key)
		).toContain("spine")
		expect(
			applicableOpacitySlots("scatter", {} as never, {}).map((d) => d.key)
		).not.toContain("spine")
	})

	it("every def carries a defaultLevel in [0,1]", () => {
		for (const d of OPACITY_SLOT_REGISTRY) {
			expect(d.defaultLevel).toBeGreaterThanOrEqual(0)
			expect(d.defaultLevel).toBeLessThanOrEqual(1)
		}
	})
})
