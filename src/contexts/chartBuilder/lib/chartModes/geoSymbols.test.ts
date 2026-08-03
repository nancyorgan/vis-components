import { describe, expect, it } from "vitest"

import { DEFAULT_MAP_CONFIG } from "../mapConfig"
import { emptyEncodings } from "../types"
import { GeoSymbolsMode } from "./geoSymbols"

const geo = { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" as const }

describe("GeoSymbolsMode.detect", () => {
	it("true when geographic + connection + area mapped (bubble map)", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		}
		expect(GeoSymbolsMode.detect(e, undefined, undefined, geo)).toBe(true)
	})

	it("false when geographic + connection but no area (that is a choropleth)", () => {
		const e = { ...emptyEncodings(), connection: { field: "state" } }
		expect(GeoSymbolsMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("false when geographic + connection + area but x also mapped", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
			x: { field: "lon" },
		}
		expect(GeoSymbolsMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("false when geographic + area but no connection", () => {
		const e = { ...emptyEncodings(), area: { field: "pop" } }
		expect(GeoSymbolsMode.detect(e, undefined, undefined, geo)).toBe(false)
	})

	it("false when geographic mode is off", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		}
		expect(
			GeoSymbolsMode.detect(e, undefined, undefined, DEFAULT_MAP_CONFIG)
		).toBe(false)
	})

	it("safe-false when mapConfig is absent", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		}
		expect(GeoSymbolsMode.detect(e)).toBe(false)
	})
})

describe("GeoSymbolsMode.legend", () => {
	// As in the choropleth, the `connection` channel is the region key, not a
	// visual series — so it must not produce a legend entry.
	it("hides the connection legend section in geographic mode", () => {
		expect(GeoSymbolsMode.legend.hideConnectionInThisMode).toBe(true)
	})
})
