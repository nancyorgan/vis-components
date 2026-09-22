import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mediaQueryMatches, useMediaQuery } from "./useMediaQuery"

type Listener = () => void

/** Stub matchMedia with a switchable match so the hook's subscription can
 *  be exercised; happy-dom's own implementation never changes. */
const installMatchMedia = (initial: boolean) => {
	let matches = initial
	const listeners = new Set<Listener>()
	vi.stubGlobal("matchMedia", (query: string) => ({
		media: query,
		get matches() {
			return matches
		},
		addEventListener: (_: "change", fn: Listener) => listeners.add(fn),
		removeEventListener: (_: "change", fn: Listener) => listeners.delete(fn),
	}))
	return {
		flip: (next: boolean) => {
			matches = next
			for (const fn of listeners) fn()
		},
		listenerCount: () => listeners.size,
	}
}

afterEach(() => vi.unstubAllGlobals())

describe("useMediaQuery", () => {
	it("reports the current match and follows changes", () => {
		const mm = installMatchMedia(false)
		const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"))
		expect(result.current).toBe(false)
		act(() => mm.flip(true))
		expect(result.current).toBe(true)
	})

	it("unsubscribes on unmount", () => {
		const mm = installMatchMedia(true)
		const { unmount } = renderHook(() => useMediaQuery("(max-width: 1023px)"))
		expect(mm.listenerCount()).toBe(1)
		unmount()
		expect(mm.listenerCount()).toBe(0)
	})

	it("is false when matchMedia is unavailable", () => {
		vi.stubGlobal("matchMedia", undefined)
		expect(mediaQueryMatches("(max-width: 1023px)")).toBe(false)
		const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"))
		expect(result.current).toBe(false)
	})
})
