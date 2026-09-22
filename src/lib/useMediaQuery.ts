import { useSyncExternalStore } from "react"

/** Below this the editor trades its side-by-side layout for an overlay
 *  sheet (see EditorLayout): phones and tablets in portrait. 1024px is
 *  Tailwind's `lg`, so an iPad in landscape keeps the desktop layout. */
export const NARROW_LAYOUT_QUERY = "(max-width: 1023px)"

const canQuery = (): boolean =>
	typeof window !== "undefined" && typeof window.matchMedia === "function"

/** One-shot read, for initial state that must be decided before React
 *  renders (an atom's default, say). False where matchMedia is missing. */
export const mediaQueryMatches = (query: string): boolean =>
	canQuery() && window.matchMedia(query).matches

/** Live `matchMedia` subscription. Re-renders when the match flips; false
 *  in environments without matchMedia. */
export const useMediaQuery = (query: string): boolean =>
	useSyncExternalStore(
		(onChange) => {
			if (!canQuery()) return () => {}
			const mql = window.matchMedia(query)
			mql.addEventListener("change", onChange)
			return () => mql.removeEventListener("change", onChange)
		},
		() => mediaQueryMatches(query),
		() => false
	)

export const useNarrowLayout = (): boolean => useMediaQuery(NARROW_LAYOUT_QUERY)
