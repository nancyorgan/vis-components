import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { detectGeographyLevel } from "./detectGeographyLevel"
import { featureId, loadGeometry } from "./loadGeometry"
import { resolveGeography } from "./resolveGeography"
import {
	setZctaTopologyLoader,
	zctaTopologyAvailable,
	type ZctaTopology,
} from "./zctaTopology"

/**
 * The REAL ZCTA asset (`public/geo/zcta-500k.json`, Census
 * cb_2020_us_zcta520_500k — see tooling/build-zcta-topology.js). Every other
 * zcta suite runs on a hand-written 2–3 feature fixture; this one runs the
 * whole chain (topojson decode → join table → centroids → level detection)
 * against the shipped file, which is what catches a bad regeneration:
 * different vintage, dropped territories, wrong id field, mis-quantized
 * coordinates.
 *
 * SKIPPED when the asset isn't present, and that's the normal state of a
 * fresh checkout — the file is gitignored (it's a build input, regenerated
 * byte-for-byte by `pnpm zcta`), so CI has nothing to check here. Run
 * `pnpm zcta` once and these light up.
 *
 * The asset is read from DISK and registered through `setZctaTopologyLoader`
 * rather than left to the seam's own routes: in production it arrives over
 * `fetch`, which happy-dom won't serve, and vite.config.ts deliberately nulls
 * `__ZCTA_ASSET_PATH__` under Vitest so no suite depends on whether a given
 * machine has generated the file.
 *
 * Lives in its OWN file because `loadGeometry` memoizes one bundle per level
 * for the lifetime of the module: sharing a file with the fixture suites would
 * make whichever ran first win. Vitest isolates module registries per file, so
 * this file gets a fresh cache.
 *
 * Cost when it does run: ~8.6MB of JSON parsed and 33.8k features decoded,
 * once for the file (the memoized promise is shared by every test below).
 */
// Resolved from the working directory (the repo root, where vitest runs) —
// `import.meta.url` is an http URL under happy-dom, not a file one.
const assetDir = join(process.cwd(), "public/geo")

const assetFile = ((): string | null => {
	try {
		const name = readdirSync(assetDir)
			.filter((f) => /^zcta.*\.json$/.test(f))
			.sort()[0]
		return name === undefined ? null : join(assetDir, name)
	} catch {
		return null
	}
})()

describe("ZCTA topology seam without a source", () => {
	it("reports unavailable, so the sidebar can explain rather than blank", () => {
		// No loader registered, no sidecar path under Vitest, no inlined
		// data/zcta*.json in the tree — the asset-less build's exact state.
		expect(zctaTopologyAvailable()).toBe(false)
	})
})

describe.skipIf(assetFile === null)(
	"real ZCTA asset (skipped unless `pnpm zcta` has generated public/geo/)",
	() => {
		beforeAll(() => {
			const topology = JSON.parse(
				readFileSync(assetFile as string, "utf8")
			) as ZctaTopology
			setZctaTopologyLoader(async () => topology)
		})

		afterAll(() => {
			setZctaTopologyLoader(null)
		})

		it("decodes the full national ZCTA set (~33.8k features)", async () => {
			const b = await loadGeometry("zcta")
			// 2020 vintage ships 33,791 ZCTAs. A range, not an equality, so a
			// re-generated asset (different vintage/simplification) still passes
			// while a truncated or clipped file fails loudly.
			expect(b.features.length).toBeGreaterThan(33_000)
			expect(b.features.length).toBeLessThan(34_500)
			expect(b.table.length).toBe(b.features.length)
			expect(b.centroids.size).toBe(b.features.length)
		})

		it("carries every ZCTA code as a unique 5-digit feature id", async () => {
			const b = await loadGeometry("zcta")
			const tableIds = new Set(b.table.map((r) => r.featureId))
			expect(tableIds.size).toBe(b.table.length)
			// Spot-check the id normalization across the whole file rather than
			// per-feature assertions (33.8k expect() calls would dominate runtime).
			const badId = b.features.find((f) => !/^\d{5}$/.test(featureId(f)))
			expect(badId).toBeUndefined()
			const unjoinable = b.features.find((f) => !tableIds.has(featureId(f)))
			expect(unjoinable).toBeUndefined()
		})

		it("contains known ZIPs, including the leading-zero Puerto Rico case", async () => {
			const b = await loadGeometry("zcta")
			const ids = new Set(b.table.map((r) => r.featureId))
			// 00601 Adjuntas PR (leading zeros survive as a string id), 10001
			// Manhattan, 90210 Beverly Hills, 96950 Saipan (territory coverage).
			for (const zip of ["00601", "10001", "90210", "96950"]) {
				expect(ids.has(zip), zip).toBe(true)
			}
		})

		it("joins a real ZIP column end-to-end, unpadded values included", async () => {
			const b = await loadGeometry("zcta")
			const r = resolveGeography(["601", "10001", "90210"], b.table)
			expect(r.keyType).toBe("zip")
			expect(r.matched.get("601")).toBe("00601")
			expect(r.matched.get("10001")).toBe("10001")
			expect(r.matched.get("90210")).toBe("90210")
			expect(r.unmatched).toEqual([])
		})

		it("places centroids at real-world coordinates", async () => {
			const b = await loadGeometry("zcta")
			// geoPath() with no projection passes coordinates through, so centroids
			// are [lon, lat] degrees — a decent guard against a mis-projected or
			// mis-quantized asset (a wrong transform would move these miles).
			const nyc = b.centroids.get("10001")!
			expect(nyc[0]).toBeCloseTo(-73.99, 1)
			expect(nyc[1]).toBeCloseTo(40.75, 1)
			const bh = b.centroids.get("90210")!
			expect(bh[0]).toBeCloseTo(-118.41, 1)
			expect(bh[1]).toBeCloseTo(34.1, 1)
			const finite = b.features.every((f) => {
				const c = b.centroids.get(featureId(f))
				return c !== undefined && Number.isFinite(c[0]) && Number.isFinite(c[1])
			})
			expect(finite).toBe(true)
		})

		it("auto-detects a real ZIP column as the zcta level", async () => {
			// The whole point of shipping the asset: a pasted ZIP column resolves
			// to zcta instead of falling back to states.
			await expect(
				detectGeographyLevel(["00601", "10001", "90210", "60614"])
			).resolves.toBe("zcta")
			// Unpadded numerics (a spreadsheet ate the leading zeros) too.
			await expect(detectGeographyLevel(["601", "2134", "90210"])).resolves.toBe(
				"zcta"
			)
		})
	}
)
