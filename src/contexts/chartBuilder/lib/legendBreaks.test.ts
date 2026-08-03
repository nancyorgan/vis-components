import { describe, expect, it } from "vitest"

import {
	buildLegendFormatter,
	decorateOpenTopLabel,
	formatBreaksInput,
	legendDataExtent,
	parseBreaksInput,
	resolveLegendBreaks,
	resolveLegendChannelConfig,
	resolveLegendDomain,
} from "./legendBreaks"

describe("legendDataExtent", () => {
	it("returns null when no values parse as numbers", () => {
		expect(legendDataExtent(["a", "b"], "quantitative")).toBeNull()
	})

	it("returns [min, max] for quantitative numeric values", () => {
		expect(legendDataExtent([10, 2, 194, 50], "quantitative")).toEqual([2, 194])
	})

	it("coerces temporal Date instances to ms since epoch", () => {
		const a = new Date("2024-01-01T00:00:00Z")
		const b = new Date("2024-12-31T00:00:00Z")
		const ext = legendDataExtent([a, b], "temporal")
		expect(ext).toEqual([a.getTime(), b.getTime()])
	})
})

describe("resolveLegendChannelConfig", () => {
	it("fills defaults for missing fields", () => {
		const merged = resolveLegendChannelConfig({ breakCount: 7 })
		expect(merged).toEqual({
			format: "",
			breakCount: 7,
			breaks: [],
		})
	})

	it("returns full defaults for undefined input", () => {
		expect(resolveLegendChannelConfig(undefined).breakCount).toBe(5)
		expect(resolveLegendChannelConfig(undefined).breaks).toEqual([])
	})
})

describe("resolveLegendDomain", () => {
	it("uses custom breaks min/max when set", () => {
		expect(
			resolveLegendDomain([2, 194], "quantitative", {
				breaks: [0, 50, 100, 150, 200],
			}),
		).toEqual([0, 200])
	})

	it("falls back to data extent when breaks empty", () => {
		expect(resolveLegendDomain([2, 194], "quantitative", undefined)).toEqual([
			2, 194,
		])
	})

	it("ignores single-value breaks (no real domain)", () => {
		// One-element breaks can't define a span; we should fall back to data.
		expect(
			resolveLegendDomain([2, 194], "quantitative", { breaks: [100] }),
		).toEqual([2, 194])
	})
})

describe("resolveLegendBreaks", () => {
	it("returns sorted-deduped user breaks when provided", () => {
		const out = resolveLegendBreaks([2, 194], "quantitative", {
			breaks: [200, 50, 0, 100, 50, 150],
		})
		expect(out).toEqual([0, 50, 100, 150, 200])
	})

	it("interpolates breakCount with nice round increments", () => {
		// 0..100 already starts on a round boundary — d3 picks step 20 →
		// 0, 20, 40, 60, 80, 100 (6 values for nominal count=5; the
		// algorithm prefers round increments over exact count).
		const out = resolveLegendBreaks([0, 100], "quantitative", { breakCount: 5 })
		expect(out.every((n) => n % 10 === 0)).toBe(true)
		const steps = out.slice(1).map((v, i) => v - out[i]!)
		expect(new Set(steps).size).toBe(1)
	})

	it("extends past a non-round data extent to round endpoints (the user's 2..194 example)", () => {
		// User's literal example: data 2..194 with count=5 should pick
		// 0..200 as the nice endpoints and step 50 between them →
		// [0, 50, 100, 150, 200].
		const out = resolveLegendBreaks([2, 194], "quantitative", { breakCount: 5 })
		expect(out).toEqual([0, 50, 100, 150, 200])
	})

	it("uses the supplied defaultCount when breakCount is the (default) 5", () => {
		const out = resolveLegendBreaks([0, 4], "quantitative", undefined)
		expect(out.length).toBeGreaterThanOrEqual(2)
		// 0..4 with count=5 → pretty breaks like 0,1,2,3,4 (every integer
		// is round).
		expect(out[0]).toBe(0)
		expect(out.at(-1)).toBe(4)
	})

	it("respects the floorCount minimum (3 for size legends)", () => {
		// User asked for 2, but a size legend uses floorCount=3.
		const out = resolveLegendBreaks(
			[0, 100],
			"quantitative",
			{ breakCount: 2 },
			5,
			3,
		)
		expect(out).toHaveLength(3)
	})

	it("returns single-element array when lo === hi (degenerate range)", () => {
		expect(resolveLegendBreaks([5, 5, 5], "quantitative", undefined)).toEqual([
			5,
		])
	})
})

describe("buildLegendFormatter", () => {
	it("returns null for empty spec", () => {
		expect(buildLegendFormatter("")).toBeNull()
		expect(buildLegendFormatter("   ")).toBeNull()
	})

	it("formats numbers with d3-format spec", () => {
		const f = buildLegendFormatter(",")!
		expect(f(1234)).toBe("1,234")
	})

	it("formats currency with $,.0f", () => {
		const f = buildLegendFormatter("$,.0f")!
		expect(f(1234)).toBe("$1,234")
	})

	it("formats time-format spec with d3-time-format", () => {
		const f = buildLegendFormatter("%Y")!
		const ms = Date.UTC(2024, 5, 15, 12)
		expect(f(ms)).toBe("2024")
	})

	it("falls back to String() on invalid spec without throwing", () => {
		const f = buildLegendFormatter("INVALID")!
		expect(typeof f(42)).toBe("string")
	})
})

describe("decorateOpenTopLabel", () => {
	const breaks = [0, 1000, 2000, 3000, 5000]

	it("appends '+' to the top break label when top break < data max", () => {
		// User's example: breaks top out at 5000 but data max is 18000.
		expect(
			decorateOpenTopLabel("5,000", 4, breaks, [0, 18000]),
		).toBe("5,000+")
	})

	it("leaves intermediate break labels unchanged", () => {
		expect(decorateOpenTopLabel("3,000", 3, breaks, [0, 18000])).toBe("3,000")
		expect(decorateOpenTopLabel("0", 0, breaks, [0, 18000])).toBe("0")
	})

	it("does not append '+' when top break >= data max (auto-pretty case)", () => {
		// Auto-pretty breaks extend OUTWARD so top break is typically >=
		// data max — no "+" needed.
		expect(decorateOpenTopLabel("5,000", 4, breaks, [0, 4500])).toBe("5,000")
		expect(decorateOpenTopLabel("5,000", 4, breaks, [0, 5000])).toBe("5,000")
	})

	it("is a no-op when extent is null", () => {
		expect(decorateOpenTopLabel("5,000", 4, breaks, null)).toBe("5,000")
	})

	it("works on a single-element break list (degenerate case)", () => {
		expect(decorateOpenTopLabel("5", 0, [5], [5, 100])).toBe("5+")
	})
})

describe("parseBreaksInput / formatBreaksInput", () => {
	it("parses comma-separated numeric input", () => {
		expect(parseBreaksInput("0, 50, 100, 150, 200")).toEqual([
			0, 50, 100, 150, 200,
		])
	})

	it("parses whitespace-separated input", () => {
		expect(parseBreaksInput("0 50  100")).toEqual([0, 50, 100])
	})

	it("ignores non-numeric tokens silently", () => {
		expect(parseBreaksInput("0, foo, 100")).toEqual([0, 100])
	})

	it("round-trips integers without decimal noise", () => {
		expect(formatBreaksInput([0, 50, 100, 150, 200])).toBe("0, 50, 100, 150, 200")
	})

	it("formats fractional numbers with two decimals", () => {
		expect(formatBreaksInput([0, 12.5, 99.999])).toBe("0, 12.50, 100.00")
	})
})
