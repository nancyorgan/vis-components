import { describe, expect, it } from "vitest"

import { DEFAULT_MAP_CONFIG } from "../mapConfig"
import { emptyEncodings } from "../types"
import { GeoChoroplethMode } from "./geoChoropleth"

const geo = { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" as const }

describe("GeoChoroplethMode.detect", () => {
	it("false when geographic mode is off", () => {
		const e = { ...emptyEncodings(), connection: { field: "state" } }
		expect(
			GeoChoroplethMode.detect(e, undefined, undefined, DEFAULT_MAP_CONFIG)
		).toBe(false)
	})

	it("true when geographic + connection mapped", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			hue: { field: "rate" },
		}
		expect(GeoChoroplethMode.detect(e, undefined, undefined, geo)).toBe(true)
	})

	it("false when geographic but x/y mapped instead (that is a point map)", () => {
		const e = { ...emptyEncodings(), x: { field: "lon" }, y: { field: "lat" } }
		expect(GeoChoroplethMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("safe-false when mapConfig is absent", () => {
		const e = { ...emptyEncodings(), connection: { field: "state" } }
		expect(GeoChoroplethMode.detect(e)).toBe(false)
	})

	it("false when geographic + connection but x also mapped", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			x: { field: "lon" },
		}
		expect(GeoChoroplethMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("false when geographic but no connection mapped", () => {
		const e = { ...emptyEncodings(), hue: { field: "rate" } }
		expect(GeoChoroplethMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("false when geographic + connection + area (that is a bubble map)", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		}
		expect(GeoChoroplethMode.detect(e, undefined, undefined, geo)).toBe(false)
	})
})

describe("GeoChoroplethMode.legend", () => {
	// In a choropleth the `connection` channel is the region key (which feature
	// each row is), not a visual series — so it must not produce a legend entry.
	it("hides the connection legend section in geographic mode", () => {
		expect(GeoChoroplethMode.legend.hideConnectionInThisMode).toBe(true)
	})
})
