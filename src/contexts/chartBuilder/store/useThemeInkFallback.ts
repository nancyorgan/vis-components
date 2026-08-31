import { useMemo } from "react"
import { buildThemeInkFallback, type ThemeInkFallback } from "../lib/patterns"

import { useCurrentTheme } from "./useCurrentTheme"

/** The current theme's cross-palette pattern-ink table (hex → paired ink,
 * see `buildThemeInkFallback`), memoized per theme. Most consumers get it
 * via `AestheticScales.themeInkFallback`; this hook is for the few sites
 * that resolve pattern inks without the scales bundle (flows, legend,
 * sidebar previews). */
export const useThemeInkFallback = (): ThemeInkFallback => {
	const theme = useCurrentTheme()
	return useMemo(() => buildThemeInkFallback(theme), [theme])
}
