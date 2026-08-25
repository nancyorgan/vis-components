import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { setZctaTopologyLoader } from "../lib/geo/zctaTopology"
import { useGeometry } from "./useGeometry"

describe("useGeometry", () => {
	afterEach(() => {
		setZctaTopologyLoader(null)
	})

	it("starts loading with no bundle, then resolves an implemented level", async () => {
		const { result } = renderHook(() => useGeometry("states"))

		// Initial synchronous state: loading, no bundle yet.
		expect(result.current.loading).toBe(true)
		expect(result.current.bundle).toBeNull()

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.bundle).not.toBeNull()
		expect(result.current.bundle?.features.length).toBeGreaterThan(0)
	})

	it("settles with a null bundle when a level's load fails (catch path)", async () => {
		// zcta is the only level whose source can fail (an asset-less build, or
		// a host loader that errors); drive that through the seam. Registered
		// BEFORE the first zcta load in this file, so nothing is memoized yet.
		setZctaTopologyLoader(async () => {
			throw new Error("no zcta source in this test")
		})
		const { result } = renderHook(() => useGeometry("zcta"))

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.bundle).toBeNull()
	})
})
