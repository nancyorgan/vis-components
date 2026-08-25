import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { detectGeographyLevel } from "./detectGeographyLevel"
import { setZctaTopologyLoader, type ZctaTopology } from "./zctaTopology"

/** ZCTA availability needs no stubbing here: the shipped source is a served
 *  sidecar file, which vite.config.ts deliberately switches off under Vitest,
 *  so registering a loader through the seam IS the difference between an
 *  asset-bearing and an asset-less build. Detection against the REAL
 *  33.8k-feature asset lives in zctaTopology.test.ts, which gets a fresh
 *  `loadGeometry` cache (this file's fixture would otherwise win the memoized
 *  zcta slot). */

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

// --- zcta (third detection stage, behind the topology seam) ---------------
// The ZCTA table only becomes a candidate when a topology source exists (none
// is active under Vitest — see zctaTopology.ts), so these tests register a
// small fixture through the runtime seam.

describe("detectGeographyLevel (zcta)", () => {
	const fixture = {
		type: "Topology",
		objects: {
			zctas: {
				type: "GeometryCollection",
				geometries: [
					{ type: "Polygon", id: "00601", arcs: [[0]] },
					{ type: "Polygon", id: "02134", arcs: [[1]] },
					{ type: "Polygon", id: "90210", arcs: [[2]] },
				],
			},
		},
		arcs: [
			[
				[-66.8, 18.1],
				[-66.7, 18.1],
				[-66.7, 18.2],
				[-66.8, 18.2],
				[-66.8, 18.1],
			],
			[
				[-71.2, 42.3],
				[-71.1, 42.3],
				[-71.1, 42.4],
				[-71.2, 42.4],
				[-71.2, 42.3],
			],
			[
				[-118.4, 34.0],
				[-118.3, 34.0],
				[-118.3, 34.1],
				[-118.4, 34.1],
				[-118.4, 34.0],
			],
		],
	} as unknown as ZctaTopology

	beforeAll(() => {
		setZctaTopologyLoader(async () => fixture)
	})
	afterAll(() => {
		setZctaTopologyLoader(null)
	})

	it("detects 5-digit ZIP codes as zcta when a topology source exists", async () => {
		await expect(
			detectGeographyLevel(["00601", "02134", "90210"])
		).resolves.toBe("zcta")
	})

	it("detects unpadded numeric ZIPs (leading zeros lost) as zcta", async () => {
		await expect(
			detectGeographyLevel(["601", "2134", "90210"])
		).resolves.toBe("zcta")
	})

	it("still detects county FIPS as counties (counties outrank zcta)", async () => {
		// Kent + Sussex County, DE — valid county FIPS that read like ZIPs.
		// Counties clear the good-match threshold first, so the zcta stage
		// never runs for a genuine county-FIPS column.
		await expect(detectGeographyLevel(["10001", "10003"])).resolves.toBe(
			"counties"
		)
	})
})

describe("detectGeographyLevel (zcta unavailable)", () => {
	it("falls back to states for ZIP columns when no topology source exists", async () => {
		// An asset-less build: with no source registered
		// `zctaTopologyAvailable()` is false, so zcta is never a candidate and
		// nothing else matches these values.
		setZctaTopologyLoader(null)
		await expect(
			detectGeographyLevel(["00601", "02134", "90210"])
		).resolves.toBe("states")
	})
})
