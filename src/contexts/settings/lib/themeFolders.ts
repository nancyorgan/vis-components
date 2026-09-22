import {
	isManagedTheme,
	withManaged,
} from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"
import { stringifyJsonDangerous } from "../../../lib/json"

/** The three fixed folders in Settings → Themes, in the order they're
 *  shown. Not user-creatable: this is a permission ladder with an
 *  honor-system gate on one rung, not a filing system, so an arbitrary
 *  folder tree (the one the library uses for visuals) would just be
 *  somewhere else for a shared theme to hide.
 *
 *  - `system`: the bundled themes. Read-only in the UI; copy one to build
 *    on it. Pinned here — they can't be moved.
 *  - `managed`: shared, team-wide themes. Opening or moving one passes the
 *    administrator dialog.
 *  - `custom`: editable by anyone. (There are no user accounts yet; when
 *    there are, these are the ones that would belong to a person.) */
export type ThemeFolder = "system" | "managed" | "custom"

export const THEME_FOLDERS: readonly ThemeFolder[] = ["system", "managed", "custom"]

export const THEME_FOLDER_LABEL: Record<ThemeFolder, string> = {
	system: "System Themes",
	managed: "Managed Themes",
	custom: "Custom Themes",
}

export const folderOfTheme = (theme: SavedTheme): ThemeFolder =>
	// `isManagedTheme` is true for the bundled themes too (managed inherits
	// from `isSystem`), so the system check has to come first.
	theme.isSystem ? "system" : isManagedTheme(theme) ? "managed" : "custom"

/** Split the theme list into its folders, each keeping the list's own
 *  order so a theme doesn't jump position when it's promoted or demoted. */
export const groupThemesByFolder = (
	themes: readonly SavedTheme[]
): Record<ThemeFolder, SavedTheme[]> => ({
	system: themes.filter((t) => folderOfTheme(t) === "system"),
	managed: themes.filter((t) => folderOfTheme(t) === "managed"),
	custom: themes.filter((t) => folderOfTheme(t) === "custom"),
})

/** Whether moving `themeId` into `target` has to pass the administrator
 *  dialog. True in BOTH directions across the boundary: promoting a theme
 *  makes it everyone's, and demoting one takes a shared theme out of the
 *  managed set. A move inside a folder (a no-op here) needs no gate. */
export const moveNeedsAdminGate = (
	themes: readonly SavedTheme[],
	themeId: string,
	target: ThemeFolder
): boolean => {
	const theme = themes.find((t) => t.id === themeId)
	if (!theme || !canMoveTheme(theme) || !canDropIntoFolder(target)) return false
	return isManagedTheme(theme) || target === "managed"
}

/** Whether a theme can leave the folder it's in. The bundled system
 *  themes can't: they're permanently read-only, so filing one under Custom
 *  Themes would promise an edit that never works. */
export const canMoveTheme = (theme: SavedTheme): boolean => !theme.isSystem

/** Whether a folder accepts dropped themes. System Themes is closed: a
 *  theme can't become bundled by being filed there. */
export const canDropIntoFolder = (folder: ThemeFolder): boolean =>
	folder !== "system"

/** Move one theme between the folders. Returns the input array unchanged
 *  when the theme is unknown, pinned, or already in `target` — server mode
 *  diffs whole-collection saves against a baseline, so a no-op write should
 *  stay a no-op rather than churn a PUT. */
export const moveThemeToFolder = (
	themes: readonly SavedTheme[],
	themeId: string,
	target: ThemeFolder
): SavedTheme[] => {
	const theme = themes.find((t) => t.id === themeId)
	if (
		!theme ||
		!canMoveTheme(theme) ||
		!canDropIntoFolder(target) ||
		folderOfTheme(theme) === target
	)
		return [...themes]
	return themes.map((t) =>
		t.id === themeId ? withManaged(t, target === "managed") : t
	)
}

/** Custom dataTransfer MIME type for a theme-row drag. Anything else
 *  (files, text, a visuals drag from the library) is ignored by the
 *  folder drop targets. */
export const THEME_DRAG_TYPE = "application/x-vis-theme"

export type ThemeDragPayload = { themeId: string }

export const encodeThemeDrag = (themeId: string): string =>
	stringifyJsonDangerous({ themeId })

export const decodeThemeDrag = (raw: string): ThemeDragPayload | null => {
	try {
		const parsed = JSON.parse(raw) as unknown
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as { themeId?: unknown }).themeId === "string"
		) {
			return { themeId: (parsed as { themeId: string }).themeId }
		}
	} catch {
		// fall through to null
	}
	return null
}
