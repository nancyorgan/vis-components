import { describe, expect, it } from "vitest"

import { DEFAULT_MAP_CONFIG, type MapConfig } from "../mapConfig"
import { MAP_CONFIG_VERSION, mapConfigMigrations } from "./migrations"
import { loadVersioned, migrateVersioned, saveVersioned } from "./versioning"

/** mapConfig version contract. v1 was the original (identity-promoted)
 *  shape; v2 adds `showNoDataRegions`; v3 `showBasemap`; v4 `focusRegion`;
 *  v5 `customViewport`; v6 RESETS `showNoDataRegions` to true (one-time —
 *  the default flipped so regions absent from the dataset paint with the
 *  no-data fill; pre-v6 falses were overwhelmingly the old backfilled
 *  default); v7 backfills `noDataPattern` (null) + `noDataPatternInk`.
 *  These tests pin:
 *   - a missing stored value falls back to DEFAULT_MAP_CONFIG (handled at
 *     the `loadVersioned` layer, mirroring versioning.test.ts);
 *   - an already-current wrapper round-trips unchanged (incl. an explicit
 *     `showNoDataRegions: false` — the v6 reset never re-fires);
 *   - pre-v6 objects promoted to current land on `showNoDataRegions: true`
 *     whatever they stored. */

/** In-memory Storage shim so the loader test doesn't touch real
 *  localStorage. Mirrors makeStorage() in versioning.test.ts. */
const makeStorage = (): Storage => {
	const map = new Map<string, string>()
	return {
		get length() {
			return map.size
		},
		clear: () => map.clear(),
		getItem: (k) => (map.has(k) ? map.get(k)! : null),
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => {
			map.delete(k)
		},
		setItem: (k, v) => {
			map.set(k, String(v))
		},
	}
}

describe("mapConfig migration", () => {
	it("falls back to DEFAULT_MAP_CONFIG when nothing is stored", () => {
		const result = loadVersioned<MapConfig>({
			key: "missing",
			currentVersion: MAP_CONFIG_VERSION,
			migrations: mapConfigMigrations,
			fallback: DEFAULT_MAP_CONFIG,
			storage: makeStorage(),
		})
		expect(result).toEqual(DEFAULT_MAP_CONFIG)
	})

	it("round-trips a current { _v: 2, data } wrapper unchanged", () => {
		const data: MapConfig = {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			geographyLevel: "states",
		}
		expect(
			migrateVersioned(
				{ _v: MAP_CONFIG_VERSION, data },
				MAP_CONFIG_VERSION,
				mapConfigMigrations,
				DEFAULT_MAP_CONFIG
			)
		).toEqual(data)
	})

	it("DEFAULT_MAP_CONFIG round-trips through the current version unchanged", () => {
		expect(
			migrateVersioned(
				{ _v: MAP_CONFIG_VERSION, data: DEFAULT_MAP_CONFIG },
				MAP_CONFIG_VERSION,
				mapConfigMigrations,
				DEFAULT_MAP_CONFIG
			)
		).toEqual(DEFAULT_MAP_CONFIG)
		// And the default fills regions with no data, on by default.
		expect(DEFAULT_MAP_CONFIG.showNoDataRegions).toBe(true)
		// And the basemap-backdrop field, on by default.
		expect(DEFAULT_MAP_CONFIG.showBasemap).toBe(true)
		// And the focus-region field, auto by default.
		expect(DEFAULT_MAP_CONFIG.focusRegion).toBe("auto")
		// And the custom viewport, null until the user drags.
		expect(DEFAULT_MAP_CONFIG.customViewport).toBeNull()
	})

	it("promotes a v2 object through to current (gains showBasemap + focusRegion)", () => {
		// A config persisted before the basemap toggle shipped: v2 wrapper, no
		// `showBasemap`. Migrating forward must backfill `showBasemap: true`
		// (v2→v3) and `focusRegion: "auto"` (v3→v4) while leaving every other
		// field untouched — except `showNoDataRegions`, which the v5→v6 reset
		// flips to true.
		const v2Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: false,
		}
		const result = migrateVersioned(
			{ _v: 2, data: v2Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect(result).toEqual({
			...v2Data,
			showNoDataRegions: true,
			showBasemap: true,
			focusRegion: "auto",
			customViewport: null,
			noDataPattern: null,
			noDataPatternInk: "#a8a29e",
		})
	})

	it("promotes a v3 object without focusRegion to v4 (gains the field, auto)", () => {
		// A config persisted before the focus-region control shipped: v3 wrapper,
		// no `focusRegion`. The v3→v4 migration must backfill it as "auto" while
		// leaving every other field untouched.
		const v3Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: false,
			showBasemap: true,
		}
		const result = migrateVersioned(
			{ _v: 3, data: v3Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect(result).toEqual({
			...v3Data,
			showNoDataRegions: true,
			focusRegion: "auto",
			customViewport: null,
			noDataPattern: null,
			noDataPatternInk: "#a8a29e",
		})
	})

	it("does not clobber an existing focusRegion during v3→v4 (idempotent)", () => {
		// A v3 config that already carries a focusRegion (e.g. a half-migrated
		// store). The v3→v4 backfill must only fill when absent, so the existing
		// value survives — it is NOT reset to "auto".
		const v3Data = {
			coordSystem: "geographic",
			projection: "naturalEarth",
			geographyLevel: "countries",
			keyType: "iso",
			noDataFill: "#e7e5e4",
			showNoDataRegions: false,
			showBasemap: true,
			focusRegion: "europe",
		}
		const result = migrateVersioned(
			{ _v: 3, data: v3Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect((result as MapConfig).focusRegion).toBe("europe")
	})

	it("does not clobber an existing showBasemap: false during v2→v3 (idempotent)", () => {
		// A v2 config that already carries showBasemap: false (e.g. a
		// half-migrated store). The v2→v3 backfill must only fill when absent,
		// so the existing `false` survives — it is NOT reset to the default true.
		const v2Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: false,
			showBasemap: false,
		}
		const result = migrateVersioned(
			{ _v: 2, data: v2Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect((result as MapConfig).showBasemap).toBe(false)
	})

	it("promotes a v1 object without showNoDataRegions through to current (field lands on)", () => {
		// A config persisted before the toggle shipped: v1 wrapper, no
		// `showNoDataRegions`. v1→v2 backfills it (historically false), then the
		// v5→v6 reset lands it on true; every other field is untouched.
		const v1Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
		}
		const result = migrateVersioned(
			{ _v: 1, data: v1Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect(result).toEqual({
			...v1Data,
			showNoDataRegions: true,
			showBasemap: true,
			focusRegion: "auto",
			customViewport: null,
			noDataPattern: null,
			noDataPatternInk: "#a8a29e",
		})
	})

	it("does not clobber an existing showNoDataRegions: true during v1→v2 (idempotent)", () => {
		// A v1 config that already carries showNoDataRegions: true (e.g. a
		// half-migrated store). The v1→v2 backfill must only fill when absent,
		// so the existing `true` survives — it is NOT reset to the default false.
		const v1Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: true,
		}
		const result = migrateVersioned(
			{ _v: 1, data: v1Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect((result as MapConfig).showNoDataRegions).toBe(true)
	})

	it("promotes a bare (unwrapped) v0 legacy value through to the current version", () => {
		// No `_v` wrapper → treated as v0, migrated forward through every
		// step. The v0→v1 step is identity; the chain ends with the v5→v6
		// showNoDataRegions reset, so the field lands on true.
		const v0Data = {
			coordSystem: "geographic",
			projection: "auto",
			geographyLevel: "states",
			keyType: "auto",
			noDataFill: "#e7e5e4",
		}
		expect(
			migrateVersioned(
				v0Data,
				MAP_CONFIG_VERSION,
				mapConfigMigrations,
				DEFAULT_MAP_CONFIG
			)
		).toEqual({
			...v0Data,
			showNoDataRegions: true,
			showBasemap: true,
			focusRegion: "auto",
			customViewport: null,
			noDataPattern: null,
			noDataPatternInk: "#a8a29e",
		})
	})

	it("promotes a v4 object without customViewport through to current (gains the field, null)", () => {
		const v4Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: false,
			showBasemap: true,
			focusRegion: "auto",
		}
		const result = migrateVersioned(
			{ _v: 4, data: v4Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect(result).toEqual({
			...v4Data,
			showNoDataRegions: true,
			customViewport: null,
			noDataPattern: null,
			noDataPatternInk: "#a8a29e",
		})
	})

	it("v5→v6 resets a stored showNoDataRegions: false to true (one-time reset)", () => {
		// The deliberate behavioral reset: regions absent from the dataset now
		// paint with the no-data fill by default, so pre-v6 configs — where
		// `false` was overwhelmingly the old backfilled default, not a user
		// choice — come forward with the field flipped on.
		const v5Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: false,
			showBasemap: true,
			focusRegion: "auto",
			customViewport: null,
		}
		const result = migrateVersioned(
			{ _v: 5, data: v5Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect(result).toEqual({
			...v5Data,
			showNoDataRegions: true,
			noDataPattern: null,
			noDataPatternInk: "#a8a29e",
		})
	})

	it("v6→v7 backfills the no-data pattern fields (absent → null / default ink)", () => {
		const v6Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: true,
			showBasemap: true,
			focusRegion: "auto",
			customViewport: null,
		}
		const result = migrateVersioned(
			{ _v: 6, data: v6Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect(result).toEqual({
			...v6Data,
			noDataPattern: null,
			noDataPatternInk: "#a8a29e",
		})
	})

	it("does not clobber existing no-data pattern fields during v6→v7 (idempotent)", () => {
		const v6Data = {
			coordSystem: "geographic",
			projection: "albersUsa",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: true,
			showBasemap: true,
			focusRegion: "auto",
			customViewport: null,
			noDataPattern: 3,
			noDataPatternInk: "#123456",
		}
		const result = migrateVersioned(
			{ _v: 6, data: v6Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect((result as MapConfig).noDataPattern).toBe(3)
		expect((result as MapConfig).noDataPatternInk).toBe("#123456")
	})

	it("a current wrapper with showNoDataRegions: false round-trips unchanged (reset never re-fires)", () => {
		// A user who turns the toggle off AFTER the v6 reset persists at the
		// current version, which skips the migration chain entirely — their
		// choice sticks.
		const data: MapConfig = {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			showNoDataRegions: false,
		}
		expect(
			migrateVersioned(
				{ _v: MAP_CONFIG_VERSION, data },
				MAP_CONFIG_VERSION,
				mapConfigMigrations,
				DEFAULT_MAP_CONFIG
			)
		).toEqual(data)
	})

	it("does not clobber an existing customViewport during v4→v5 (idempotent)", () => {
		const vp = { west: -120, south: 30, east: -70, north: 50 }
		const v4Data = {
			coordSystem: "geographic",
			projection: "naturalEarth",
			geographyLevel: "states",
			keyType: "fips",
			noDataFill: "#e7e5e4",
			showNoDataRegions: false,
			showBasemap: true,
			focusRegion: "custom",
			customViewport: vp,
		}
		const result = migrateVersioned(
			{ _v: 4, data: v4Data },
			MAP_CONFIG_VERSION,
			mapConfigMigrations,
			DEFAULT_MAP_CONFIG
		)
		expect((result as MapConfig).customViewport).toEqual(vp)
	})

	it("save then load round-trips a non-default config unchanged", () => {
		const storage = makeStorage()
		const data: MapConfig = {
			...DEFAULT_MAP_CONFIG,
			coordSystem: "geographic",
			projection: "albersUsa",
			keyType: "fips",
		}
		saveVersioned({
			key: "vis-components:currentMapConfig",
			currentVersion: MAP_CONFIG_VERSION,
			data,
			storage,
		})
		const result = loadVersioned<MapConfig>({
			key: "vis-components:currentMapConfig",
			currentVersion: MAP_CONFIG_VERSION,
			migrations: mapConfigMigrations,
			fallback: DEFAULT_MAP_CONFIG,
			storage,
		})
		expect(result).toEqual(data)
	})
})
