import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useFontsVersion } from "./useFontsVersion"

/** happy-dom has no Font Loading API, so the hook's "unavailable" branch is
 *  the default here; the loaded / loadingdone branches run against a stub
 *  `document.fonts` installed per test. */
const installFontsStub = () => {
	const target = new EventTarget()
	let resolveReady: () => void = () => undefined
	const ready = new Promise<void>((res) => {
		resolveReady = res
	})
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: Object.assign(target, { ready }),
	})
	return { target, resolveReady }
}

afterEach(() => {
	delete (document as unknown as Record<string, unknown>)["fonts"]
})

describe("useFontsVersion", () => {
	it("stays 0 when the Font Loading API is unavailable", () => {
		expect("fonts" in document).toBe(false)
		const { result } = renderHook(() => useFontsVersion())
		expect(result.current).toBe(0)
	})

	it("bumps once fonts.ready resolves and again on each loadingdone", async () => {
		const { target, resolveReady } = installFontsStub()
		const { result } = renderHook(() => useFontsVersion())
		expect(result.current).toBe(0)
		await act(async () => {
			resolveReady()
			await Promise.resolve()
		})
		expect(result.current).toBe(1)
		act(() => {
			target.dispatchEvent(new Event("loadingdone"))
		})
		expect(result.current).toBe(2)
	})

	it("stops bumping after unmount", async () => {
		const { target, resolveReady } = installFontsStub()
		const { result, unmount } = renderHook(() => useFontsVersion())
		unmount()
		await act(async () => {
			resolveReady()
			await Promise.resolve()
			target.dispatchEvent(new Event("loadingdone"))
		})
		expect(result.current).toBe(0)
	})
})
