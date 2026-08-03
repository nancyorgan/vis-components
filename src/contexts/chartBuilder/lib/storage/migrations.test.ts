import { describe, expect, it } from "vitest"

import { datasetsMigrations, visualsMigrations } from "./migrations"

/** Migration tests for the two non-identity migration arrays.
 *
 *  The other migration arrays are `identityMigrations`, which is just
 *  `[(raw) => raw]` — trivially correct, not worth a dedicated test. */

describe("visualsMigrations v0 -> v1", () => {
	const upgrade = visualsMigrations[0]!

	it("returns [] when the stored value isn't an array (corruption guard)", () => {
		// Indirect undefined so unicorn/no-useless-undefined doesn't flag
		// the literal — the migration's tolerance for undefined input is
		// part of its contract.
		const explicitUndefined: unknown = void 0
		expect(upgrade(null)).toEqual([])
		expect(upgrade(explicitUndefined)).toEqual([])
		expect(upgrade({})).toEqual([])
		expect(upgrade("not an array")).toEqual([])
	})

	it("backfills createdAtVersionId on visuals missing it", () => {
		const result = upgrade([{ id: "a", name: "vis a" }]) as Array<
			Record<string, unknown>
		>
		expect(result[0]).toHaveProperty("createdAtVersionId", null)
	})

	it("leaves createdAtVersionId alone when present (even if null)", () => {
		const result = upgrade([
			{ id: "a", name: "vis a", createdAtVersionId: "dv-1" },
			{ id: "b", name: "vis b", createdAtVersionId: null },
		]) as Array<Record<string, unknown>>
		expect(result[0]?.createdAtVersionId).toBe("dv-1")
		expect(result[1]?.createdAtVersionId).toBe(null)
	})

	it("scrubs defaultSaturation=1 to null (the historic Reset-button trap)", () => {
		const result = upgrade([
			{
				id: "a",
				channelConfigs: {
					defaultSaturation: 1,
					defaultBrightness: 0.5,
				},
			},
		]) as Array<{ channelConfigs: Record<string, unknown> }>
		expect(result[0]?.channelConfigs.defaultSaturation).toBeNull()
		expect(result[0]?.channelConfigs.defaultBrightness).toBeNull()
	})

	it("keeps defaultSaturation/defaultBrightness at non-trap values", () => {
		const result = upgrade([
			{
				id: "a",
				channelConfigs: {
					defaultSaturation: 0.6,
					defaultBrightness: 0.42,
				},
			},
		]) as Array<{ channelConfigs: Record<string, unknown> }>
		expect(result[0]?.channelConfigs.defaultSaturation).toBe(0.6)
		expect(result[0]?.channelConfigs.defaultBrightness).toBe(0.42)
	})

	it("is idempotent on already-v1 data (running again leaves it unchanged)", () => {
		const v1 = [
			{
				id: "a",
				name: "vis a",
				createdAtVersionId: null,
				channelConfigs: { defaultSaturation: 0.6 },
			},
		]
		const once = upgrade(v1)
		const twice = upgrade(once)
		expect(twice).toEqual(once)
	})
})

describe("datasetsMigrations v0 -> v1", () => {
	const upgrade = datasetsMigrations[0]!

	it("returns {} when the stored value isn't an object", () => {
		const explicitUndefined: unknown = void 0
		expect(upgrade(null)).toEqual({})
		expect(upgrade(explicitUndefined)).toEqual({})
		expect(upgrade(42)).toEqual({})
	})

	it("wraps a legacy single-version dataset into the modern shape", () => {
		const legacy = {
			"ds-1": {
				id: "ds-1",
				filename: "data.csv",
				fields: [{ name: "a", inferredType: "categorical" }],
				rows: [{ a: "x" }, { a: "y" }],
				createdAt: 1234,
			},
		}
		const result = upgrade(legacy) as Record<string, unknown>
		const ds = result["ds-1"] as {
			id: string
			name: string
			versions: Array<{ id: string; filename: string; rows: unknown[] }>
			latestVersionId: string
			createdAt: number
		}
		expect(ds.id).toBe("ds-1")
		expect(ds.name).toBe("data.csv")
		expect(ds.versions.length).toBe(1)
		expect(ds.versions[0]?.filename).toBe("data.csv")
		expect(ds.versions[0]?.rows).toEqual([{ a: "x" }, { a: "y" }])
		expect(ds.latestVersionId).toBe(ds.versions[0]?.id)
	})

	it("leaves a modern dataset (already has `versions`) untouched", () => {
		const modern = {
			"ds-1": {
				id: "ds-1",
				name: "named",
				fields: [],
				versions: [{ id: "dv-1", filename: "v1.csv", rows: [], createdAt: 1 }],
				latestVersionId: "dv-1",
				createdAt: 1,
			},
		}
		const result = upgrade(modern) as Record<string, unknown>
		expect(result["ds-1"]).toEqual(modern["ds-1"])
	})

	it("handles a mixed bag of legacy and modern in one call", () => {
		const mixed = {
			"ds-legacy": {
				id: "ds-legacy",
				filename: "old.csv",
				fields: [],
				rows: [{ a: "x" }],
				createdAt: 1,
			},
			"ds-modern": {
				id: "ds-modern",
				name: "modern",
				fields: [],
				versions: [{ id: "dv-m", filename: "m.csv", rows: [], createdAt: 2 }],
				latestVersionId: "dv-m",
				createdAt: 2,
			},
		}
		const result = upgrade(mixed) as Record<
			string,
			{ name: string; versions: unknown[] }
		>
		// Legacy got wrapped (name derived from filename).
		expect(result["ds-legacy"]?.name).toBe("old.csv")
		// Modern stayed as-is.
		expect(result["ds-modern"]?.name).toBe("modern")
	})
})
