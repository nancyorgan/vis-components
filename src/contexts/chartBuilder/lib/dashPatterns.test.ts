import { describe, expect, it } from "vitest"

import { dashArrayFor, resolveDashAlternateColor } from "./dashPatterns"

describe("dashArrayFor", () => {
	it("returns null for solid (renderer should drop the attribute, not stroke a 0-length array)", () => {
		expect(dashArrayFor("solid")).toBeNull()
	})

	it("emits SVG-compatible dasharray strings for each non-solid preset", () => {
		// Each entry must be a comma-separated list of positive numbers — the
		// shape SVG's `stroke-dasharray` accepts. Pin the exact strings so a
		// regression that changes "8,4" to "[8,4]" or similar trips here.
		expect(dashArrayFor("dashed")).toBe("8,4")
		expect(dashArrayFor("dotted")).toBe("2,3")
		expect(dashArrayFor("dash-dot")).toBe("8,3,2,3")
	})
})

describe("resolveDashAlternateColor", () => {
	it("uses the per-group override when set", () => {
		const c = resolveDashAlternateColor({
			groupKey: "A",
			overrides: { A: "#00ff00", B: "#ff0000" },
			visualizationBackground: "#111111",
		})
		expect(c).toBe("#00ff00")
	})

	it("falls back to the visualization background when no override exists", () => {
		// User's stated default: the alternate (between-dashes) color is the
		// chart background so the dash pattern reads as two-color against
		// whatever the chart actually sits on.
		const c = resolveDashAlternateColor({
			groupKey: "A",
			overrides: {},
			visualizationBackground: "#222222",
		})
		expect(c).toBe("#222222")
	})

	it("falls back to white when the background is null/transparent", () => {
		// Explicit user-stated rule: transparent background → white.
		// White keeps dashed lines visually punchy regardless of the
		// underlying page background.
		expect(
			resolveDashAlternateColor({
				groupKey: "A",
				overrides: {},
				visualizationBackground: null,
			})
		).toBe("#ffffff")
	})

	it("ignores empty-string overrides (treats them as 'unset')", () => {
		// A previous panel UX let a user clear the override to "" instead of
		// removing the key. The helper treats empty as unset to keep the
		// fallback chain consistent.
		const c = resolveDashAlternateColor({
			groupKey: "A",
			overrides: { A: "" },
			visualizationBackground: "#abcdef",
		})
		expect(c).toBe("#abcdef")
	})
})
