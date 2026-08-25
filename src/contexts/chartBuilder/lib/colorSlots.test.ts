import { describe, expect, it } from "vitest"

import type { ColorSlotConfig } from "./channelConfig"
import { applicableColorSlots, COLOR_SLOT_DEFS, legacySlotColor } from "./colorSlots"
import { resolveSlotColor } from "./resolveLayerColor"
import { makeHueScale } from "./scales"

describe("resolveSlotColor", () => {
	const row = { grp: "B" }

	it("returns the legacy fallback when the slot is absent", () => {
		expect(resolveSlotColor(undefined, undefined, row, "#legacy")).toBe("#legacy")
	})

	it("returns the slot's single color when no field is mapped", () => {
		const cfg: ColorSlotConfig = { field: null, singleColor: "#abcdef" }
		expect(resolveSlotColor(undefined, cfg, row, "#legacy")).toBe("#abcdef")
	})

	it("colors by the mapped field's scale when a field is set", () => {
		const scale = makeHueScale(["A", "B", "C"], "categorical", undefined, [
			"#ff0000",
			"#00ff00",
			"#0000ff",
		])
		const cfg: ColorSlotConfig = {
			field: "grp",
			singleColor: "#abcdef",
			palette: ["#ff0000", "#00ff00", "#0000ff"],
		}
		const slot = { scale, field: { name: "grp", type: "categorical" as const } }
		// "B" is the 2nd category → second palette color.
		expect(resolveSlotColor(slot, cfg, row, "#legacy")).toBe("#00ff00")
	})
})

describe("legacySlotColor", () => {
	it("reads the superseded per-feature color field", () => {
		expect(
			legacySlotColor("rug", { x: { histogram: { rugColor: "#123456" } } as never })
		).toBe("#123456")
		expect(
			legacySlotColor("violinFill", {
				x: { distributionOverlay: { fillColor: "#654321" } } as never,
			})
		).toBe("#654321")
		expect(legacySlotColor("spine", { angle: { spine: { color: "#0a0b0c" } } as never })).toBe(
			"#0a0b0c"
		)
	})
})

describe("applicableColorSlots", () => {
	it("offers the rug slot for a histogram bar chart", () => {
		const slots = applicableColorSlots(
			"bars-x",
			{} as never,
			{ x: { histogram: { enabled: true } } as never }
		)
		expect(slots.map((s) => s.key)).toContain("rug")
	})

	it("keeps the rug slot for the density display (scatter), so it survives the histogram→density switch", () => {
		// No histogram, but a standalone density curve is active → rug slot stays.
		const slots = applicableColorSlots("scatter", {} as never, {
			x: { distributionOverlay: { showDensityCurve: true } } as never,
		})
		expect(slots.map((s) => s.key)).toContain("rug")
		// Plain scatter (no density, no histogram) → no rug slot.
		expect(
			applicableColorSlots("scatter", {} as never, {}).map((s) => s.key)
		).not.toContain("rug")
	})

	it("offers the spine slot only in radar mode", () => {
		expect(
			applicableColorSlots("radar", {} as never, {}).map((s) => s.key)
		).toContain("spine")
		expect(
			applicableColorSlots("scatter", {} as never, {}).map((s) => s.key)
		).not.toContain("spine")
	})

	it("hides violin/box slots until an overlay is active", () => {
		expect(
			applicableColorSlots("scatter", {} as never, {}).map((s) => s.key)
		).not.toContain("violinFill")
		const withOverlay = applicableColorSlots("scatter", {} as never, {
			x: { distributionOverlay: { showBoxPlot: true } } as never,
		})
		expect(withOverlay.map((s) => s.key)).toContain("violinFill")
	})

	it("hides both density curve slots when no curve is shown (plain histogram / plain scatter)", () => {
		// Histogram bars without the density overlay → no curve slots.
		const plainHistogram = applicableColorSlots("bars-x", {} as never, {
			x: { histogram: { enabled: true } } as never,
		}).map((s) => s.key)
		expect(plainHistogram).not.toContain("densityCurveFill")
		expect(plainHistogram).not.toContain("densityCurveStroke")
		// Plain scatter → no curve slots either.
		const plainScatter = applicableColorSlots("scatter", {} as never, {}).map(
			(s) => s.key
		)
		expect(plainScatter).not.toContain("densityCurveFill")
		expect(plainScatter).not.toContain("densityCurveStroke")
	})

	it("offers only the curve OUTLINE slot when the curve is shown without 'Fill under curve'", () => {
		// Histogram + density overlay, fill unchecked → outline only.
		const overlayNoFill = applicableColorSlots("bars-x", {} as never, {
			x: { histogram: { enabled: true, showDensity: true } } as never,
		}).map((s) => s.key)
		expect(overlayNoFill).toContain("densityCurveStroke")
		expect(overlayNoFill).not.toContain("densityCurveFill")
		// Standalone density curve, fill unchecked → outline only.
		const standaloneNoFill = applicableColorSlots("scatter", {} as never, {
			x: { distributionOverlay: { showDensityCurve: true } } as never,
		}).map((s) => s.key)
		expect(standaloneNoFill).toContain("densityCurveStroke")
		expect(standaloneNoFill).not.toContain("densityCurveFill")
	})

	it("offers the curve FILL slot only once 'Fill under curve' is checked", () => {
		// Histogram + density overlay + fill → both curve slots.
		const overlayFilled = applicableColorSlots("bars-x", {} as never, {
			x: {
				histogram: { enabled: true, showDensity: true, densityFill: true },
			} as never,
		}).map((s) => s.key)
		expect(overlayFilled).toContain("densityCurveStroke")
		expect(overlayFilled).toContain("densityCurveFill")
		// Standalone curve + fill (the shared `densityFill` flag lives on the
		// axis's histogram config even for the standalone Density display).
		const standaloneFilled = applicableColorSlots("scatter", {} as never, {
			x: {
				distributionOverlay: { showDensityCurve: true },
				histogram: { densityFill: true },
			} as never,
		}).map((s) => s.key)
		expect(standaloneFilled).toContain("densityCurveStroke")
		expect(standaloneFilled).toContain("densityCurveFill")
	})

	it("does not let a stale densityFill flag surface the fill slot without a curve", () => {
		// `densityFill` left true from an earlier session, but the curve itself is
		// off → neither slot.
		const keys = applicableColorSlots("bars-x", {} as never, {
			x: { histogram: { enabled: true, densityFill: true } } as never,
		}).map((s) => s.key)
		expect(keys).not.toContain("densityCurveFill")
		expect(keys).not.toContain("densityCurveStroke")
	})

	it("offers the geo point fill + outline slots in geo-symbols (bubble map) mode", () => {
		const keys = applicableColorSlots("geo-symbols", {} as never, {}).map(
			(s) => s.key
		)
		expect(keys).toContain("geoPointFill")
		expect(keys).toContain("geoPointStroke")
	})

	it("does not offer the geo point slots in scatter or geo-choropleth modes", () => {
		const scatter = applicableColorSlots("scatter", {} as never, {}).map((s) => s.key)
		expect(scatter).not.toContain("geoPointFill")
		expect(scatter).not.toContain("geoPointStroke")
		const choropleth = applicableColorSlots("geo-choropleth", {} as never, {}).map(
			(s) => s.key
		)
		expect(choropleth).not.toContain("geoPointFill")
		expect(choropleth).not.toContain("geoPointStroke")
	})
})

describe("geo point color slots", () => {
	it("are labeled Point fill / Point outline and accept a field mapping", () => {
		const fill = COLOR_SLOT_DEFS.geoPointFill
		const stroke = COLOR_SLOT_DEFS.geoPointStroke
		expect(fill.label).toBe("Point fill")
		expect(stroke.label).toBe("Point outline")
		expect(fill.acceptsFieldMapping).toBe(true)
		expect(stroke.acceptsFieldMapping).toBe(true)
	})

	it("are applicable within geo-symbols mode with no extra gate", () => {
		expect(COLOR_SLOT_DEFS.geoPointFill.isApplicable({} as never, {}, "geo-symbols")).toBe(
			true
		)
		expect(
			COLOR_SLOT_DEFS.geoPointStroke.isApplicable({} as never, {}, "geo-symbols")
		).toBe(true)
	})
})
