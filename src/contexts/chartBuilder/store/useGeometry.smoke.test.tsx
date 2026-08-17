import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useGeometry } from "./useGeometry"

describe("useGeometry", () => {
	it("starts loading with no bundle, then resolves an implemented level", async () => {
		const { result } = renderHook(() => useGeometry("states"))

		// Initial synchronous state: loading, no bundle yet.
		expect(result.current.loading).toBe(true)
		expect(result.current.bundle).toBeNull()

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.bundle).not.toBeNull()
		expect(result.current.bundle?.features.length).toBeGreaterThan(0)
	})

	it("settles with a null bundle for an unimplemented level (catch path)", async () => {
		const { result } = renderHook(() => useGeometry("zcta"))

		await waitFor(() => expect(result.current.loading).toBe(false))
		expect(result.current.bundle).toBeNull()
	})
})
