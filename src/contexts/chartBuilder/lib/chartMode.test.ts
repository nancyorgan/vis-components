import { describe, expect, it } from "vitest"

import { getChartMode, getChartModeDef } from "./chartMode"
import { DEFAULT_MAP_CONFIG } from "./mapConfig"
import { emptyEncodings } from "./types"

const enc = (overrides: Partial<Record<string, string>>) => {
	const e = emptyEncodings()
	for (const [ch, field] of Object.entries(overrides)) {
		;(e as Record<string, { field: string | null }>)[ch] = {
			field: field ?? null,
		}
	}
	return e
}

describe("getChartMode", () => {
	it("returns scatter when only x and y are mapped", () => {
		expect(getChartMode(enc({ x: "a", y: "b" }))).toBe("scatter")
	})

	it("returns scatter when x+y+length are mapped (segments)", () => {
		expect(getChartMode(enc({ x: "a", y: "b", length: "c" }))).toBe("scatter")
	})

	it("returns scatter when x+y+length+angle are mapped (vectors)", () => {
		expect(getChartMode(enc({ x: "a", y: "b", length: "c", angle: "d" }))).toBe(
			"scatter"
		)
	})

	it("returns bars-x when only x and length are mapped", () => {
		expect(getChartMode(enc({ x: "a", length: "b" }))).toBe("bars-x")
	})

	it("returns bars-y when only y and length are mapped", () => {
		expect(getChartMode(enc({ y: "a", length: "b" }))).toBe("bars-y")
	})

	it("returns scatter when neither x nor y is mapped", () => {
		expect(getChartMode(enc({ length: "a" }))).toBe("scatter")
	})

	it("returns scatter when only x is mapped (no length)", () => {
		expect(getChartMode(enc({ x: "a" }))).toBe("scatter")
	})

	it("returns pies-x when x and angle are mapped", () => {
		expect(getChartMode(enc({ x: "a", angle: "b" }))).toBe("pies-x")
	})

	it("returns pies-y when y and angle are mapped", () => {
		expect(getChartMode(enc({ y: "a", angle: "b" }))).toBe("pies-y")
	})

	it("returns pies (single centered pie) when angle is mapped without x or y", () => {
		expect(getChartMode(enc({ angle: "a" }))).toBe("pies")
	})

	it("returns pies when angle + hue are mapped without x or y", () => {
		expect(getChartMode(enc({ angle: "a", hue: "b" }))).toBe("pies")
	})

	it("stays pies (not pies-x) when facet is mapped alongside angle — facet is orthogonal", () => {
		expect(getChartMode(enc({ angle: "a", hue: "b", facet: "c" }))).toBe("pies")
	})

	it("returns pies-x (not pies) when x is mapped alongside angle", () => {
		expect(getChartMode(enc({ x: "a", angle: "b", hue: "c" }))).toBe("pies-x")
	})

	it("returns scatter when length and angle are both mapped (vector field)", () => {
		expect(getChartMode(enc({ x: "a", length: "b", angle: "c" }))).toBe(
			"scatter"
		)
	})

	it("returns scatter when encodings are empty", () => {
		expect(getChartMode(emptyEncodings())).toBe("scatter")
	})

	it("ignores facet when resolving the mode (bars-x with facet is still bars-x)", () => {
		expect(getChartMode(enc({ x: "a", length: "b", facet: "f" }))).toBe(
			"bars-x"
		)
	})

	it("ignores facet when resolving the mode (scatter with facet is still scatter)", () => {
		expect(getChartMode(enc({ x: "a", y: "b", facet: "f" }))).toBe("scatter")
	})

	it("returns areas-x when x + length + connection are mapped (no y, no angle)", () => {
		expect(getChartMode(enc({ x: "a", length: "b", connection: "c" }))).toBe(
			"areas-x"
		)
	})

	it("returns areas-y when y + length + connection are mapped (no x, no angle)", () => {
		expect(getChartMode(enc({ y: "a", length: "b", connection: "c" }))).toBe(
			"areas-y"
		)
	})

	it("stays bars-x when x + length are mapped without connection (connection required for areas)", () => {
		expect(getChartMode(enc({ x: "a", length: "b" }))).toBe("bars-x")
	})

	it("falls through to scatter when angle is mapped alongside x + length + connection", () => {
		expect(
			getChartMode(enc({ x: "a", length: "b", connection: "c", angle: "d" }))
		).toBe("scatter")
	})

	it("returns scatter when x + y + length + connection are mapped (both x and y)", () => {
		expect(
			getChartMode(enc({ x: "a", y: "b", length: "c", connection: "d" }))
		).toBe("scatter")
	})

	it("returns scatter when x + y + connection are mapped without hue (single-series line chart)", () => {
		// Without a hue mapping, "scatter + connection" is the classic
		// line-chart use case — a polyline through scatter points. Routing
		// it to areas-x stripped point markers and the per-line knobs that
		// belong on scatter (point sampling, dash patterns). The user
		// reported this as "no points on line charts"; the regression
		// guard pins the routing at scatter-mode.
		expect(getChartMode(enc({ x: "a", y: "b", connection: "c" }))).toBe(
			"scatter"
		)
	})

	it("returns scatter when x + y + connection + hue are mapped (multi-line chart)", () => {
		// Adding hue to a line chart (x + y + connection) should color the
		// lines — not silently flip the chart type to areas. Area mode is
		// opt-in via the `length` encoding now. The previous behavior was
		// reported as: "I add hue and it instantly becomes an area chart."
		expect(
			getChartMode(enc({ x: "a", y: "b", connection: "c", hue: "h" }))
		).toBe("scatter")
	})

	it("returns scatter when x + y + length + connection are mapped (ambiguous, falls through)", () => {
		expect(
			getChartMode(enc({ x: "a", y: "b", length: "c", connection: "d" }))
		).toBe("scatter")
	})

	it("returns scatter when x + y + connection + angle are mapped (angle blocks area)", () => {
		expect(
			getChartMode(enc({ x: "a", y: "b", connection: "c", angle: "d" }))
		).toBe("scatter")
	})

	it("prefers areas-x over bars-x when connection is mapped alongside x + length", () => {
		// Areas detect is a strict superset of bars detect (adds the
		// connection requirement), so ordering in MODE_REGISTRY must place
		// areas before bars — this test guards against a reordering regression.
		expect(
			getChartMode(enc({ x: "a", length: "b", connection: "c" }))
		).not.toBe("bars-x")
	})

	it("returns radar when r + angle are mapped (no x, no y)", () => {
		expect(getChartMode(enc({ r: "a", angle: "b" }))).toBe("radar")
	})

	it("returns radar even when connection / hue / length are also mapped", () => {
		expect(
			getChartMode(
				enc({ r: "a", angle: "b", connection: "c", hue: "d", length: "e" })
			)
		).toBe("radar")
	})

	it("stays scatter when only r is mapped (no angle)", () => {
		expect(getChartMode(enc({ r: "a" }))).toBe("scatter")
	})

	it("stays pies when angle is mapped without r (and no x/y/length)", () => {
		expect(getChartMode(enc({ angle: "a" }))).toBe("pies")
	})

	it("does NOT return radar when x is also mapped (falls through to pies-x)", () => {
		// `r + angle + x` doesn't satisfy radar's `!x && !y` predicate, so
		// the registry walks past to pies-x (which matches on x + angle).
		// `r` is ignored in that mode — same way length / opacity / etc.
		// pass through any inactive mode.
		expect(getChartMode(enc({ r: "a", angle: "b", x: "c" }))).toBe("pies-x")
	})
})

describe("getChartModeDef — mapConfig threading is a no-op for existing modes", () => {
	// Threading MapConfig as a 4th optional param into detection must NOT
	// change which mode resolves for any existing (cartesian) encoding set.
	// For each representative case, the resolved id must be identical whether
	// mapConfig is omitted or the default (coordSystem:"noMap").
	const cases: Array<{ name: string; enc: Record<string, string> }> = [
		{ name: "scatter (x+y)", enc: { x: "a", y: "b" } },
		{ name: "bars-x (x+length)", enc: { x: "a", length: "b" } },
		{ name: "bars-y (y+length)", enc: { y: "a", length: "b" } },
		{ name: "pies-x (x+angle)", enc: { x: "a", angle: "b" } },
		{ name: "pies (angle only)", enc: { angle: "a" } },
		{ name: "areas-x (x+length+connection)", enc: { x: "a", length: "b", connection: "c" } },
		{ name: "radar (r+angle)", enc: { r: "a", angle: "b" } },
	]

	for (const { name, enc: overrides } of cases) {
		it(`resolves the same mode for ${name} with/without mapConfig`, () => {
			const e = enc(overrides)
			const noMap = getChartModeDef(e, undefined, undefined).id
			const withDefault = getChartModeDef(
				e,
				undefined,
				undefined,
				DEFAULT_MAP_CONFIG
			).id
			expect(withDefault).toBe(noMap)
		})
	}
})

describe("getChartMode — geographic mode precedence (full registry walk)", () => {
	const geo = { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" as const }

	it("resolves geographic + connection + area to geo-symbols (bubble map)", () => {
		expect(
			getChartMode(
				enc({ connection: "state", area: "pop" }),
				undefined,
				undefined,
				geo
			)
		).toBe("geo-symbols")
	})

	it("resolves geographic + connection (no area) to geo-choropleth", () => {
		expect(
			getChartMode(enc({ connection: "state" }), undefined, undefined, geo)
		).toBe("geo-choropleth")
	})

	it("resolves geographic + x + y to geo-points (lat/long dot map)", () => {
		expect(
			getChartMode(enc({ x: "lon", y: "lat" }), undefined, undefined, geo)
		).toBe("geo-points")
	})

	it("resolves geographic + x + y + connection to geo-points (x/y position wins)", () => {
		expect(
			getChartMode(
				enc({ x: "lon", y: "lat", connection: "state" }),
				undefined,
				undefined,
				geo
			)
		).toBe("geo-points")
	})

	it("keeps geographic + connection + area at geo-symbols (adding geo-points did not disturb it)", () => {
		expect(
			getChartMode(
				enc({ connection: "state", area: "pop" }),
				undefined,
				undefined,
				geo
			)
		).toBe("geo-symbols")
	})

	it("keeps geographic + connection (no area) at geo-choropleth (adding geo-points did not disturb it)", () => {
		expect(
			getChartMode(enc({ connection: "state" }), undefined, undefined, geo)
		).toBe("geo-choropleth")
	})
})
