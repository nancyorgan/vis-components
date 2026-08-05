import { describe, expect, it } from "vitest"

import { detectGeographyLevel } from "./detectGeographyLevel"

/** Exercises detection against the REAL geometry bundles (states/countries
 *  are static imports; counties is the lazy chunk, which vitest resolves like
 *  any module), so these results are exactly what the app resolves. */
describe("detectGeographyLevel", () => {
	it("detects state names as states", async () => {
		await expect(
			detectGeographyLevel(["California", "Texas", "Vermont"])
		).resolves.toBe("states")
	})

	it("detects state abbrevs as states", async () => {
		await expect(detectGeographyLevel(["CA", "TX", "NY", "WA"])).resolves.toBe(
			"states"
		)
	})

	it("detects 2-digit state FIPS as states (not ISO-numeric countries)", async () => {
		// Several 2-digit codes double as ISO numeric country codes ("40" ->
		// Austria); the full-column score keeps states on top.
		await expect(
			detectGeographyLevel(["06", "48", "40", "01", "56"])
		).resolves.toBe("states")
	})

	it("detects 5-digit county FIPS as counties", async () => {
		await expect(
			detectGeographyLevel(["06037", "48201", "17031", "36061"])
		).resolves.toBe("counties")
	})

	it("detects unpadded county FIPS as counties", async () => {
		await expect(
			detectGeographyLevel(["1001", "6037", "48201"])
		).resolves.toBe("counties")
	})

	it("detects state-qualified county names as counties", async () => {
		await expect(
			detectGeographyLevel([
				"Washington County, TX",
				"Baltimore city, MD",
				"Los Angeles County, CA",
			])
		).resolves.toBe("counties")
	})

	it("detects bare unique county names as counties", async () => {
		await expect(
			detectGeographyLevel(["Snohomish", "Miami-Dade", "Tangipahoa"])
		).resolves.toBe("counties")
	})

	it("detects ISO country codes as countries", async () => {
		await expect(
			detectGeographyLevel(["USA", "FRA", "BRA", "JPN"])
		).resolves.toBe("countries")
	})

	it("detects country names as countries", async () => {
		await expect(
			detectGeographyLevel(["France", "Brazil", "Japan", "Germany"])
		).resolves.toBe("countries")
	})

	it("falls back to states for empty input", async () => {
		await expect(detectGeographyLevel([])).resolves.toBe("states")
		await expect(detectGeographyLevel(["", "  "])).resolves.toBe("states")
	})

	it("falls back to states when nothing matches any level", async () => {
		await expect(
			detectGeographyLevel(["widget-a", "widget-b", "widget-c"])
		).resolves.toBe("states")
	})

	it("honors a keyType override during scoring", async () => {
		// Forced to "name", numeric county FIPS match nothing anywhere ->
		// states fallback (the override applies to every level's score).
		await expect(
			detectGeographyLevel(["06037", "48201"], "name")
		).resolves.toBe("states")
	})

	it("majority wins over minority junk (county FIPS + stray values)", async () => {
		await expect(
			detectGeographyLevel(["06037", "48201", "17031", "not-a-code"])
		).resolves.toBe("counties")
	})
})
