import { describe, expect, it } from "vitest"

import {
	dashArrayFor,
	dashSpecForPatternValue,
	resolveDashGapColor,
	resolveDashGapFill,
	splitIntoValueRuns,
} from "./dashPatterns"

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

describe("resolveDashGapColor", () => {
	// The palette pairing area patterns use: each palette color can carry a
	// paired pattern ink in the theme's palette options.
	const base = {
		overrideKeys: ["East", "A"] as ReadonlyArray<string | null | undefined>,
		patternValue: null as string | null,
		lineColor: "#4f8eda",
		overrides: {} as Record<string, string>,
		singleOverride: null as string | null,
		inkColors: {} as Record<string, string>,
		palette: ["#4f8eda", "#e2726e"] as readonly string[],
		patternInks: ["#1d4f8f", "#8f1d1d"] as ReadonlyArray<string | null>,
		defaultInk: "#101010",
	}

	it("uses the per-category override, trying keys in order (hue value before legacy group key)", () => {
		expect(
			resolveDashGapColor({
				...base,
				overrides: { East: "#00ff00", A: "#ff0000" },
			})
		).toBe("#00ff00")
		// Hue key absent → the legacy connection-group key still hits.
		expect(
			resolveDashGapColor({ ...base, overrides: { A: "#ff0000" } })
		).toBe("#ff0000")
		// Nullish keys are skipped.
		expect(
			resolveDashGapColor({
				...base,
				overrideKeys: [null, "A"],
				overrides: { A: "#ff0000" },
			})
		).toBe("#ff0000")
	})

	it("uses the single dashGapColor override next (the no-hue one-swatch case)", () => {
		expect(
			resolveDashGapColor({ ...base, singleOverride: "#abc123" })
		).toBe("#abc123")
		// Per-category override still wins over it.
		expect(
			resolveDashGapColor({
				...base,
				overrides: { East: "#00ff00" },
				singleOverride: "#abc123",
			})
		).toBe("#00ff00")
	})

	it("uses the pattern channel's per-category Color pick next", () => {
		expect(
			resolveDashGapColor({
				...base,
				patternValue: "proj",
				inkColors: { proj: "#123456" },
			})
		).toBe("#123456")
	})

	it("pairs the line's color with the palette's pattern ink (the area-pattern rule)", () => {
		expect(resolveDashGapColor(base)).toBe("#1d4f8f")
		expect(resolveDashGapColor({ ...base, lineColor: "#E2726E" })).toBe(
			"#8f1d1d"
		)
	})

	it("falls back to the default pattern ink when the line color isn't a palette color", () => {
		expect(resolveDashGapColor({ ...base, lineColor: "#888888" })).toBe(
			"#101010"
		)
	})

	it("falls back to the built-in ink when no default is configured", () => {
		expect(
			resolveDashGapColor({
				...base,
				lineColor: "#888888",
				defaultInk: null,
			})
		).toBe("#0f172a")
	})

	it("ignores empty-string overrides (treats them as 'unset')", () => {
		expect(
			resolveDashGapColor({ ...base, overrides: { East: "", A: "" } })
		).toBe("#1d4f8f")
	})
})

describe("dashSpecForPatternValue", () => {
	const domain = ["known", "proj", "other"]

	it("auto-cycles through DASH_CYCLE by domain position when nothing is overridden", () => {
		expect(dashSpecForPatternValue("known", {}, {}, domain)).toEqual({
			kind: "pattern",
			pattern: "dashed",
		})
		expect(dashSpecForPatternValue("proj", {}, {}, domain)).toEqual({
			kind: "pattern",
			pattern: "dotted",
		})
	})

	it("an explicit swatch override wins over the auto-cycle", () => {
		expect(dashSpecForPatternValue("known", { known: 2 }, {}, domain)).toEqual({
			kind: "pattern",
			pattern: "dash-dot",
		})
	})

	it("a 'none' override resolves to an explicit solid (not a fall-through)", () => {
		expect(
			dashSpecForPatternValue("known", { known: "none" }, {}, domain)
		).toEqual({ kind: "pattern", pattern: "solid" })
	})

	it("a custom dasharray wins over both the override and the cycle", () => {
		expect(
			dashSpecForPatternValue("known", { known: 1 }, { known: "2 2" }, domain)
		).toEqual({ kind: "custom", dasharray: "2,2" })
	})

	it("an unsanitizable custom dasharray falls through to the override chain", () => {
		expect(
			dashSpecForPatternValue("known", { known: 1 }, { known: "abc" }, domain)
		).toEqual({ kind: "pattern", pattern: "dotted" })
	})

	it("returns null for a value outside the domain (caller falls back)", () => {
		expect(dashSpecForPatternValue("mystery", {}, {}, domain)).toBeNull()
	})
})

describe("resolveDashGapFill", () => {
	it("an explicit user choice wins in both directions", () => {
		expect(
			resolveDashGapFill({ configured: false, patternField: "a", hueField: "b" })
		).toBe(false)
		expect(
			resolveDashGapFill({ configured: true, patternField: "a", hueField: "a" })
		).toBe(true)
	})

	it("auto paints the gaps when pattern and hue map different fields (or hue is unmapped)", () => {
		expect(
			resolveDashGapFill({ configured: null, patternField: "status", hueField: "series" })
		).toBe(true)
		expect(
			resolveDashGapFill({ configured: null, patternField: "status", hueField: null })
		).toBe(true)
		expect(
			resolveDashGapFill({ configured: null, patternField: null, hueField: "series" })
		).toBe(true)
	})

	it("auto leaves true gaps when pattern and hue map the SAME field", () => {
		expect(
			resolveDashGapFill({ configured: null, patternField: "series", hueField: "series" })
		).toBe(false)
	})
})

describe("splitIntoValueRuns", () => {
	type P = { x: number; v: string | null }
	const v = (p: P) => p.v

	it("keeps a constant-value line as one run", () => {
		const pts: P[] = [
			{ x: 1, v: "a" },
			{ x: 2, v: "a" },
			{ x: 3, v: "a" },
		]
		expect(splitIntoValueRuns(pts, v)).toEqual([{ value: "a", items: pts }])
	})

	it("splits at value transitions, sharing the boundary point with the LATER run", () => {
		const pts: P[] = [
			{ x: 1, v: "known" },
			{ x: 2, v: "known" },
			{ x: 3, v: "proj" },
			{ x: 4, v: "proj" },
		]
		const runs = splitIntoValueRuns(pts, v)
		expect(runs.length).toBe(2)
		expect(runs[0]).toEqual({ value: "known", items: [pts[0], pts[1]] })
		// The proj run starts at the last known point so the segment
		// last-known → first-proj takes the PROJECTED styling.
		expect(runs[1]).toEqual({ value: "proj", items: [pts[1], pts[2], pts[3]] })
	})

	it("null-valued items form their own runs", () => {
		const pts: P[] = [
			{ x: 1, v: "a" },
			{ x: 2, v: null },
			{ x: 3, v: "a" },
		]
		const runs = splitIntoValueRuns(pts, v)
		expect(runs.map((r) => r.value)).toEqual(["a", null, "a"])
		expect(runs[1]?.items).toEqual([pts[0], pts[1]])
		expect(runs[2]?.items).toEqual([pts[1], pts[2]])
	})

	it("returns no runs for empty input", () => {
		expect(splitIntoValueRuns([], v)).toEqual([])
	})
})
