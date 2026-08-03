import { describe, expect, it } from "vitest"

import { DEFAULT_SHAPE_CONFIG } from "./channelConfig"
import {
	resetShapeCategoryOverrides,
	resolveShapeColors,
	shapeCategoryHasOverride,
} from "./shapeColors"

/** Per-shape fill / stroke resolution. Outline color is now an explicit
 * user setting (seeded from the theme) that always drives the stroke —
 * dropping the earlier "inherit from hue" auto-path. To hide outlines,
 * set `outlineWidth` to 0 instead of matching the fill. Per-category
 * `strokeOverrides[value]` still wins when set. */
describe("resolveShapeColors", () => {
	it("uses the theme outline color for stroke regardless of hue mapping", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: true,
			fallbackOutline: "#ffffff",
		})
		expect(out.fill).toBe("#cc3333")
		// Stroke = fallbackOutline (the user's chosen outlineColor),
		// NOT the hue color anymore.
		expect(out.stroke).toBe("#ffffff")
	})

	it("uses outline color for stroke when hue is NOT mapped", () => {
		const out = resolveShapeColors({
			hueFill: "#888888",
			shapeCategoryValue: "Apple",
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: false,
			fallbackOutline: "#ffffff",
		})
		expect(out.stroke).toBe("#ffffff")
	})

	it("user-picked outline color wins even when hue is mapped (the bubble-chart case)", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: true,
			fallbackOutline: "#ff0000", // user set outline to red
		})
		expect(out.stroke).toBe("#ff0000")
	})

	it("per-category fill override wins over hue color (stroke uses outline)", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: {
				...DEFAULT_SHAPE_CONFIG,
				fillOverrides: { Apple: "#ff00ff" },
			},
			hueMapped: true,
			fallbackOutline: "#ffffff",
		})
		expect(out.fill).toBe("#ff00ff")
		expect(out.stroke).toBe("#ffffff")
	})

	it("per-category stroke override wins over outline color", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: {
				...DEFAULT_SHAPE_CONFIG,
				strokeOverrides: { Apple: "#000000" },
			},
			hueMapped: true,
			fallbackOutline: "#ffffff",
		})
		expect(out.fill).toBe("#cc3333")
		expect(out.stroke).toBe("#000000")
	})

	it("'none' is a valid fill override (renders hollow shape)", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: {
				...DEFAULT_SHAPE_CONFIG,
				fillOverrides: { Apple: "none" },
			},
			hueMapped: true,
			fallbackOutline: "#ffffff",
		})
		expect(out.fill).toBe("none")
		// Hollow shapes still wear the user's outline color so they
		// remain visible (rather than vanishing entirely).
		expect(out.stroke).toBe("#ffffff")
	})

	it("uses the outlineHue scale color when an outline field is mapped", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: true,
			fallbackOutline: "#ffffff",
			outlineScaleColor: "#0000ff",
		})
		// Scale color drives the stroke, taking precedence over the universal
		// outline fallback.
		expect(out.stroke).toBe("#0000ff")
	})

	it("per-category stroke override still wins over the outlineHue scale color", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: {
				...DEFAULT_SHAPE_CONFIG,
				strokeOverrides: { Apple: "#000000" },
			},
			hueMapped: true,
			fallbackOutline: "#ffffff",
			outlineScaleColor: "#0000ff",
		})
		expect(out.stroke).toBe("#000000")
	})

	it("falls back to the universal outline color when the scale color is null", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: true,
			fallbackOutline: "#ffffff",
			outlineScaleColor: null,
		})
		expect(out.stroke).toBe("#ffffff")
	})

	it("a matching outline rule color wins over the outlineHue scale color", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: true,
			fallbackOutline: "#ffffff",
			outlineScaleColor: "#0000ff",
			outlineRuleColor: "#ff0000",
		})
		// Rule overrides the palette-derived scale color.
		expect(out.stroke).toBe("#ff0000")
	})

	it("per-category stroke override still wins over a matching outline rule", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: {
				...DEFAULT_SHAPE_CONFIG,
				strokeOverrides: { Apple: "#000000" },
			},
			hueMapped: true,
			fallbackOutline: "#ffffff",
			outlineScaleColor: "#0000ff",
			outlineRuleColor: "#ff0000",
		})
		expect(out.stroke).toBe("#000000")
	})

	it("falls back to the scale color when no outline rule matches", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: "Apple",
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: true,
			fallbackOutline: "#ffffff",
			outlineScaleColor: "#0000ff",
			outlineRuleColor: null,
		})
		expect(out.stroke).toBe("#0000ff")
	})

	it("uses outline color when shape category is null (no per-category lookup)", () => {
		const out = resolveShapeColors({
			hueFill: "#cc3333",
			shapeCategoryValue: null,
			shapeConfig: DEFAULT_SHAPE_CONFIG,
			hueMapped: true,
			fallbackOutline: "#ffffff",
		})
		expect(out.fill).toBe("#cc3333")
		expect(out.stroke).toBe("#ffffff")
	})
})

describe("resetShapeCategoryOverrides", () => {
	const cfg = {
		overrides: { Apple: 2, Banana: 5 },
		fillOverrides: { Apple: "#ff00ff", Banana: "none" as const },
		strokeOverrides: { Apple: "#000000" },
	}

	it("clears shape, fill, AND stroke overrides for the category in one call", () => {
		const out = resetShapeCategoryOverrides(cfg, "Apple")
		expect(out.overrides).toEqual({ Banana: 5 })
		expect(out.fillOverrides).toEqual({ Banana: "none" })
		expect(out.strokeOverrides).toEqual({})
	})

	it("leaves OTHER categories intact", () => {
		// Regression guard for "reset link wipes too much": only the named
		// category's overrides should be cleared. Banana stays unchanged.
		const out = resetShapeCategoryOverrides(cfg, "Apple")
		expect(out.overrides.Banana).toBe(5)
		expect(out.fillOverrides?.Banana).toBe("none")
	})

	it("returns empty objects when called on a category with no overrides (no-op safe)", () => {
		const empty = {
			overrides: {},
			fillOverrides: {},
			strokeOverrides: {},
		}
		const out = resetShapeCategoryOverrides(empty, "Anything")
		expect(out.overrides).toEqual({})
		expect(out.fillOverrides).toEqual({})
		expect(out.strokeOverrides).toEqual({})
	})

	it("works when fillOverrides / strokeOverrides are undefined (older configs)", () => {
		// Older saved visualizations may not have these keys at all. The
		// helper must tolerate missing maps without throwing.
		const partial = {
			overrides: { Apple: 1 },
		} as Parameters<typeof resetShapeCategoryOverrides>[0]
		const out = resetShapeCategoryOverrides(partial, "Apple")
		expect(out.overrides).toEqual({})
		expect(out.fillOverrides).toEqual({})
		expect(out.strokeOverrides).toEqual({})
	})
})

describe("shapeCategoryHasOverride", () => {
	it("is true when shape index is overridden", () => {
		const cfg = {
			overrides: { Apple: 2 },
			fillOverrides: {},
			strokeOverrides: {},
		}
		expect(shapeCategoryHasOverride(cfg, "Apple")).toBe(true)
		expect(shapeCategoryHasOverride(cfg, "Banana")).toBe(false)
	})

	it("is true when only fill is overridden (so the row's reset link still appears)", () => {
		// The previous bug: the reset link only appeared when the SHAPE
		// override was set. A user who'd set just the fill color had no
		// way to clear it from the row level. Catch that regression here.
		const cfg = {
			overrides: {},
			fillOverrides: { Apple: "#ff0000" },
			strokeOverrides: {},
		}
		expect(shapeCategoryHasOverride(cfg, "Apple")).toBe(true)
	})

	it("is true when only stroke is overridden", () => {
		const cfg = {
			overrides: {},
			fillOverrides: {},
			strokeOverrides: { Apple: "#000000" },
		}
		expect(shapeCategoryHasOverride(cfg, "Apple")).toBe(true)
	})

	it("is false when no override of any kind is set", () => {
		const cfg = {
			overrides: {},
			fillOverrides: {},
			strokeOverrides: {},
		}
		expect(shapeCategoryHasOverride(cfg, "Apple")).toBe(false)
	})
})
