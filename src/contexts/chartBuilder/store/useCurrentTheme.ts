import { useAtomValue } from "jotai"
import type { Theme } from "../lib/types"
import { currentThemeIdAtom, themeAtom, themesAtom } from "./atoms"

/** The theme the current visual is actually on: the LIVE entry from
 * `themesAtom` (so Settings-page edits take effect immediately in reset
 * baselines, changed dots, and quick-start seeding), falling back to the
 * legacy `themeAtom` snapshot only when the visual's themeId isn't in the
 * list. The legacy snapshot is frozen at the last theme APPLY — reading it
 * directly shows stale values the moment the user edits the theme sheet
 * (the recurring bug class CLAUDE.md's "theme-derived UI" rule targets).
 * One hook so panels stop hand-rolling the resolution. */
export const useCurrentTheme = (): Theme => {
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	return allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
}
