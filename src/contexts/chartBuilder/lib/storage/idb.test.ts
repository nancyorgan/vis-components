import { describe, expect, it } from "vitest"

import { idbAvailable, idbDelete, idbGet, idbSet } from "./idb"

/** The test environment (happy-dom) has no IndexedDB. The whole datasets-in-IDB
 *  design depends on these calls degrading to safe no-ops there (and in SSR /
 *  privacy modes) so callers can fall back to the localStorage bootstrap. */
describe("idb wrapper without IndexedDB", () => {
	it("reports IndexedDB as unavailable", () => {
		expect(idbAvailable()).toBe(false)
	})

	it("idbGet resolves null instead of throwing", async () => {
		await expect(idbGet("anything")).resolves.toBeNull()
	})

	it("idbSet resolves false (write did not happen)", async () => {
		await expect(idbSet("k", { a: 1 })).resolves.toBe(false)
	})

	it("idbDelete resolves without throwing", async () => {
		await expect(idbDelete("k")).resolves.toBeUndefined()
	})
})
