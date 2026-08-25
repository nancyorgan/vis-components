import { describe, expect, it } from "vitest"
import { featureId, loadGeometry } from "./loadGeometry"

describe("loadGeometry(states)", () => {
	it("decodes 51 state features with FIPS ids", async () => {
		const b = await loadGeometry("states")
		expect(b.features.length).toBeGreaterThanOrEqual(51)
		expect(b.table.find((r) => r.keys.abbrev === "CA")?.featureId).toBe("06")
	})
	it("memoizes (same promise on repeat)", () => {
		expect(loadGeometry("states")).toBe(loadGeometry("states"))
	})
	it("computes a centroid for every state row with finite coords", async () => {
		const b = await loadGeometry("states")
		// 50 states + DC are in the lookup table; us-atlas also carries a few
		// territories, so centroids covers at least the 51 we care about.
		expect(b.centroids.size).toBeGreaterThanOrEqual(51)
		for (const row of b.table) {
			const c = b.centroids.get(row.featureId)
			expect(c).toBeDefined()
			expect(Number.isFinite(c![0])).toBe(true)
			expect(Number.isFinite(c![1])).toBe(true)
		}
	})
	it("normalizes each feature's id to its 2-digit FIPS so featureId() agrees with the table", async () => {
		const b = await loadGeometry("states")
		const tableIds = new Set(b.table.map((r) => r.featureId))
		for (const f of b.features) {
			const id = featureId(f)
			// 2-digit FIPS, and present in the table (renderer lookup will hit).
			expect(id).toMatch(/^\d{2}$/)
			expect(tableIds.has(id)).toBe(true)
		}
		// California's feature id resolves to its 2-digit FIPS.
		const ca = b.features.find((f) => featureId(f) === "06")
		expect(ca).toBeDefined()
	})
	it("rejects for unimplemented levels (zcta)", async () => {
		await expect(loadGeometry("zcta")).rejects.toThrow(/not implemented/)
	})
})

describe("loadGeometry(counties)", () => {
	it("decodes all county features with 5-digit FIPS ids agreeing with the table", async () => {
		const b = await loadGeometry("counties")
		// counties-10m ships 3231 features (counties + territory equivalents).
		expect(b.features.length).toBe(3231)
		expect(b.table.length).toBe(b.features.length)
		const tableIds = new Set(b.table.map((r) => r.featureId))
		expect(tableIds.size).toBe(b.table.length)
		for (const f of b.features) {
			const id = featureId(f)
			expect(id).toMatch(/^\d{5}$/)
			expect(tableIds.has(id)).toBe(true)
		}
	})
	it("memoizes (same promise on repeat)", () => {
		expect(loadGeometry("counties")).toBe(loadGeometry("counties"))
	})
	it("keys rows on fips + name + stateFips, never abbrev", async () => {
		const b = await loadGeometry("counties")
		const la = b.table.find((r) => r.featureId === "06037")
		expect(la).toBeDefined()
		expect(la!.keys.fips).toBe("06037")
		expect(la!.keys.name).toBe("Los Angeles")
		expect(la!.keys.stateFips).toBe("06")
		// No abbrev key — a state-abbrev column must not join the county table.
		expect(b.table.every((r) => r.keys.abbrev === undefined)).toBe(true)
	})
	it("suffixes independent cities ' city' so city/county name pairs split", async () => {
		const b = await loadGeometry("counties")
		expect(b.table.find((r) => r.featureId === "24510")?.keys.name).toBe(
			"Baltimore city"
		)
		expect(b.table.find((r) => r.featureId === "24005")?.keys.name).toBe(
			"Baltimore"
		)
		// Names already ending in "City" keep their name (Carson City 32510 is
		// an independent city; Charles City 51036 is an ordinary county).
		expect(b.table.find((r) => r.featureId === "32510")?.keys.name).toBe(
			"Carson City"
		)
		expect(b.table.find((r) => r.featureId === "51036")?.keys.name).toBe(
			"Charles City"
		)
		// The aliasing makes every within-state (name, stateFips) pair unique.
		const seen = new Set<string>()
		for (const r of b.table) {
			const key = `${r.keys.name?.toLowerCase()}|${r.keys.stateFips}`
			expect(seen.has(key)).toBe(false)
			seen.add(key)
		}
	})
	it("computes a centroid for every county with finite coords", async () => {
		const b = await loadGeometry("counties")
		expect(b.centroids.size).toBe(b.features.length)
		for (const row of b.table) {
			const c = b.centroids.get(row.featureId)
			expect(c).toBeDefined()
			expect(Number.isFinite(c![0])).toBe(true)
			expect(Number.isFinite(c![1])).toBe(true)
		}
	})
})

describe("loadGeometry(countries)", () => {
	it("decodes world country features with a row per feature", async () => {
		const b = await loadGeometry("countries")
		// world-atlas countries-110m ships 177 features.
		expect(b.features.length).toBe(177)
		expect(b.table.length).toBe(b.features.length)
	})
	it("memoizes (same promise on repeat)", () => {
		expect(loadGeometry("countries")).toBe(loadGeometry("countries"))
	})
	it("joins real ISO data (USA -> 840)", async () => {
		const b = await loadGeometry("countries")
		const usa = b.table.find((r) => r.keys.iso3 === "USA")
		expect(usa).toBeDefined()
		expect(usa!.featureId).toBe("840")
		expect(usa!.keys.iso2).toBe("US")
		expect(usa!.keys.isoNumeric).toBe("840")
		expect(usa!.keys.name).toContain("United States")
		// Countries carry no fips/abbrev keys.
		expect(usa!.keys.fips).toBeUndefined()
		expect(usa!.keys.abbrev).toBeUndefined()
	})
	it("handles the 3 id-less features by name with distinct, non-undefined ids", async () => {
		const b = await loadGeometry("countries")
		const names = ["Kosovo", "N. Cyprus", "Somaliland"]
		const rows = names.map((n) =>
			b.table.find((r) => r.keys.name === n)
		)
		for (const row of rows) {
			expect(row).toBeDefined()
			expect(row!.featureId).toBeTruthy()
			expect(row!.featureId).not.toBe("undefined")
			expect(row!.keys.name).toBeTruthy()
		}
		// Three DISTINCT featureIds (no collision from String(undefined)).
		const ids = rows.map((r) => r!.featureId)
		expect(new Set(ids).size).toBe(3)
		// The two with no ISO codes pass undefined (not "") so they don't pollute.
		const cyprus = b.table.find((r) => r.keys.name === "N. Cyprus")!
		expect(cyprus.keys.iso2).toBeUndefined()
		expect(cyprus.keys.iso3).toBeUndefined()
		expect(cyprus.keys.isoNumeric).toBe(cyprus.featureId)
	})
	it("featureId() agrees with the table for EVERY feature (no undefined, no collisions)", async () => {
		const b = await loadGeometry("countries")
		const tableIds = b.table.map((r) => r.featureId)
		const tableIdSet = new Set(tableIds)
		// No duplicate featureIds in the table.
		expect(tableIdSet.size).toBe(tableIds.length)
		for (const f of b.features) {
			const id = featureId(f)
			expect(id).toBeTruthy()
			expect(id).not.toBe("undefined")
			// Renderer's lookup (featureId(feature) -> row) will hit.
			expect(tableIdSet.has(id)).toBe(true)
		}
	})
	it("computes a centroid for every feature with finite coords", async () => {
		const b = await loadGeometry("countries")
		expect(b.centroids.size).toBe(b.features.length)
		for (const row of b.table) {
			const c = b.centroids.get(row.featureId)
			expect(c).toBeDefined()
			expect(Number.isFinite(c![0])).toBe(true)
			expect(Number.isFinite(c![1])).toBe(true)
		}
	})

	// --- long-form / variant name aliases (countryNames.ts) -----------------

	it("joins full names against the atlas's abbreviated feature names", async () => {
		const b = await loadGeometry("countries")
		const r = resolveGeography(
			[
				"Democratic Republic of the Congo",
				"Central African Republic",
				"Bosnia and Herzegovina",
				"South Sudan",
				"Equatorial Guinea",
				"Dominican Republic",
				"Solomon Islands",
				"Western Sahara",
				"North Macedonia",
			],
			b.table
		)
		expect(r.keyType).toBe("name")
		expect(r.unmatched).toEqual([])
		expect(r.matched.get("Democratic Republic of the Congo")).toBe("180")
		expect(r.matched.get("Central African Republic")).toBe("140")
		expect(r.matched.get("Bosnia and Herzegovina")).toBe("070")
		expect(r.matched.get("South Sudan")).toBe("728")
		expect(r.matched.get("North Macedonia")).toBe("807")
	})

	it("joins common variants (US/UK/Korea/Russia/Czechia/Ivory Coast/Burma…)", async () => {
		const b = await loadGeometry("countries")
		const r = resolveGeography(
			[
				"United States",
				"Great Britain",
				"Republic of Korea",
				"Russian Federation",
				"Czech Republic",
				"Ivory Coast",
				"Burma",
				"Swaziland",
				"East Timor",
				"The Gambia",
				"The Bahamas",
				"Viet Nam",
				"Syrian Arab Republic",
				"Türkiye",
			],
			b.table,
			"name"
		)
		expect(r.unmatched).toEqual([])
		expect(r.matched.get("United States")).toBe("840")
		expect(r.matched.get("Great Britain")).toBe("826")
		expect(r.matched.get("Republic of Korea")).toBe("410")
		expect(r.matched.get("Russian Federation")).toBe("643")
		expect(r.matched.get("Czech Republic")).toBe("203")
		expect(r.matched.get("Ivory Coast")).toBe("384")
		expect(r.matched.get("Burma")).toBe("104")
		expect(r.matched.get("Swaziland")).toBe("748")
		expect(r.matched.get("East Timor")).toBe("626")
		expect(r.matched.get("The Gambia")).toBe("270")
		expect(r.matched.get("The Bahamas")).toBe("044")
	})

	it("never cross-joins the two Congos", async () => {
		const b = await loadGeometry("countries")
		const r = resolveGeography(
			[
				"Congo",
				"Republic of the Congo",
				"Congo-Brazzaville",
				"Dem. Rep. Congo",
				"Democratic Republic of the Congo",
				"Congo-Kinshasa",
				"DRC",
			],
			b.table,
			"name"
		)
		expect(r.unmatched).toEqual([])
		expect(r.matched.get("Congo")).toBe("178")
		expect(r.matched.get("Republic of the Congo")).toBe("178")
		expect(r.matched.get("Congo-Brazzaville")).toBe("178")
		expect(r.matched.get("Dem. Rep. Congo")).toBe("180")
		expect(r.matched.get("Democratic Republic of the Congo")).toBe("180")
		expect(r.matched.get("Congo-Kinshasa")).toBe("180")
		expect(r.matched.get("DRC")).toBe("180")
	})

	it("still joins every atlas short name (aliases regress nothing)", async () => {
		const b = await loadGeometry("countries")
		const names = b.table
			.map((r) => r.keys.name)
			.filter((n): n is string => n != null)
		const r = resolveGeography(names, b.table, "name")
		expect(r.unmatched).toEqual([])
		for (const row of b.table) {
			expect(r.matched.get(row.keys.name!)).toBe(row.featureId)
		}
	})

	it("every declared alias joins its own feature (none dead or ambiguous)", async () => {
		const b = await loadGeometry("countries")
		const rows = b.table.filter((row) => row.keys.nameAliases !== undefined)
		// The alias table targets real bundle rows (a stale numeric would make
		// its aliases silently dead).
		expect(rows.length).toBeGreaterThan(0)
		for (const row of rows) {
			for (const alias of row.keys.nameAliases!) {
				const r = resolveGeography([alias], b.table, "name")
				expect(r.matched.get(alias), alias).toBe(row.featureId)
			}
		}
	})
})

// --- zcta ---------------------------------------------------------------
// These tests register a tiny fixture through the runtime seam so the id
// normalization / drop / join edge cases stay readable (the real bundled
// asset carries 33.8k well-formed features and can't express them). The
// override wins over every other route, and the real asset gets its own
// end-to-end suite in zctaTopology.test.ts.

describe("loadGeometry(zcta)", () => {
	const fixture = {
		type: "Topology",
		objects: {
			zctas: {
				type: "GeometryCollection",
				geometries: [
					// Numeric id that lost its leading zeros → normalized "00601".
					{ type: "Polygon", id: 601, arcs: [[0]] },
					// No id; the code rides a Census property instead.
					{
						type: "Polygon",
						properties: { ZCTA5CE20: "90210" },
						arcs: [[1]],
					},
					// Neither id nor a code property → dropped entirely.
					{ type: "Polygon", arcs: [[2]] },
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
				[-118.4, 34.0],
				[-118.3, 34.0],
				[-118.3, 34.1],
				[-118.4, 34.1],
				[-118.4, 34.0],
			],
			[
				[-100.0, 40.0],
				[-99.9, 40.0],
				[-99.9, 40.1],
				[-100.0, 40.1],
				[-100.0, 40.0],
			],
		],
	} as unknown as ZctaTopology

	beforeAll(() => {
		setZctaTopologyLoader(async () => fixture)
	})
	afterAll(() => {
		setZctaTopologyLoader(null)
	})

	it("decodes features with 5-digit zero-padded ids agreeing with the table", async () => {
		const b = await loadGeometry("zcta")
		// The code-less third feature is dropped; the other two survive.
		expect(b.features.length).toBe(2)
		expect(b.table.length).toBe(2)
		const tableIds = new Set(b.table.map((r) => r.featureId))
		for (const f of b.features) {
			const id = featureId(f)
			expect(id).toMatch(/^\d{5}$/)
			expect(tableIds.has(id)).toBe(true)
		}
		expect(tableIds.has("00601")).toBe(true)
		expect(tableIds.has("90210")).toBe(true)
	})

	it("memoizes (same promise on repeat)", () => {
		expect(loadGeometry("zcta")).toBe(loadGeometry("zcta"))
	})

	it("keys rows ONLY on zip (never fips/name), so other columns can't mis-join", async () => {
		const b = await loadGeometry("zcta")
		for (const r of b.table) {
			expect(r.keys.zip).toBe(r.featureId)
			expect(r.keys.fips).toBeUndefined()
			expect(r.keys.name).toBeUndefined()
			expect(r.keys.abbrev).toBeUndefined()
		}
	})

	it("computes a centroid for every row with finite coords", async () => {
		const b = await loadGeometry("zcta")
		expect(b.centroids.size).toBe(b.features.length)
		for (const row of b.table) {
			const c = b.centroids.get(row.featureId)
			expect(c).toBeDefined()
			expect(Number.isFinite(c![0])).toBe(true)
			expect(Number.isFinite(c![1])).toBe(true)
		}
	})

	it("joins end-to-end: unpadded numeric ZIP column matches the decoded table", async () => {
		const b = await loadGeometry("zcta")
		const r = resolveGeography(["601", "90210"], b.table)
		expect(r.keyType).toBe("zip")
		expect(r.matched.get("601")).toBe("00601")
		expect(r.matched.get("90210")).toBe("90210")
	})
})
