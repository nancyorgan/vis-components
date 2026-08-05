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
})
