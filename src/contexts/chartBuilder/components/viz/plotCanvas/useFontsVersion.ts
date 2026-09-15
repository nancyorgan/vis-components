import { useEffect, useState } from "react"

/** A counter that bumps once the document's webfonts have finished
 *  loading, and again on every later `loadingdone` (a user font
 *  registering from IndexedDB, a Google Fonts face arriving late).
 *
 *  Text-measurement memos in PlotCanvas (tick labels, the data-label edge
 *  reserve) take it as a dependency: canvas `measureText` before the real
 *  face is available measures the FALLBACK face, and a webfont that swaps
 *  in afterwards is often wider — the reserved margin then lands short and
 *  the last glyphs clip. Nothing else in those memos' inputs changes when
 *  a font loads, so without this they'd never re-measure.
 *
 *  Stays 0 where the Font Loading API is unavailable (SSR, happy-dom). */
export const useFontsVersion = (): number => {
	const [version, setVersion] = useState(0)
	useEffect(() => {
		if (typeof document === "undefined" || !("fonts" in document)) return
		const fonts = document.fonts
		let cancelled = false
		const bump = () => {
			if (!cancelled) setVersion((v) => v + 1)
		}
		// `ready` resolves immediately when everything is already loaded —
		// one cheap extra measure on mount, exact widths thereafter.
		fonts.ready.then(bump, () => undefined)
		fonts.addEventListener("loadingdone", bump)
		return () => {
			cancelled = true
			fonts.removeEventListener("loadingdone", bump)
		}
	}, [])
	return version
}
