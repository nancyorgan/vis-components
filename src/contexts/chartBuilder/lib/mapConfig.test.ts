import { describe, expect, it } from "vitest"
import { DEFAULT_MAP_CONFIG, GEOGRAPHY_LEVELS, PROJECTIONS } from "./mapConfig"

describe("mapConfig", () => {
	it("defaults to noMap (maps off)", () => {
		expect(DEFAULT_MAP_CONFIG.coordSystem).toBe("noMap")
	})
	it("defaults projection/level/keyType to auto", () => {
		expect(DEFAULT_MAP_CONFIG.projection).toBe("auto")
		expect(DEFAULT_MAP_CONFIG.geographyLevel).toBe("auto")
		expect(DEFAULT_MAP_CONFIG.keyType).toBe("auto")
	})
	it("knows the four geography levels", () => {
		expect(GEOGRAPHY_LEVELS).toEqual(["states", "counties", "zcta", "countries"])
	})
	it("offers albersUsa and naturalEarth projections", () => {
		expect(PROJECTIONS).toContain("albersUsa")
		expect(PROJECTIONS).toContain("naturalEarth")
	})
})
