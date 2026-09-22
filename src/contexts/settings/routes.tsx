import { createRoute } from "@tanstack/react-router"

import { rootRoute } from "../../routes/router"
import { FontsPage } from "./components/FontsPage"
import { SettingsLayout } from "./components/SettingsLayout"
import { SharingPage } from "./components/SharingPage"
import { ThemeEditorPage } from "./components/ThemeEditorPage"
import { ThemesGalleryPage } from "./components/ThemesGalleryPage"
import { THEME_FOLDERS, type ThemeFolder } from "./lib/themeFolders"

/** `?folder=system|managed|custom` narrows the gallery to one folder — the
 *  rail's folder headers set it, "Themes" / the rail's empty space clear
 *  it. Anything else is dropped so a stale link shows every theme. */
export type ThemesGallerySearch = { folder?: ThemeFolder }

const validateGallerySearch = (
	raw: Record<string, unknown>
): ThemesGallerySearch =>
	THEME_FOLDERS.includes(raw.folder as ThemeFolder)
		? { folder: raw.folder as ThemeFolder }
		: {}

export const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsLayout,
})

/** The theme gallery — every theme as a card, like the library's visuals. */
export const settingsThemesRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/themes",
	component: ThemesGalleryPage,
	validateSearch: validateGallerySearch,
})

/** One theme's editor. The analog of `/editor/$visualId`. */
export const settingsThemeEditorRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/themes/$themeId",
	component: ThemeEditorPage,
})

export const settingsSharingRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/sharing",
	component: SharingPage,
})

export const settingsFontsRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/fonts",
	component: FontsPage,
})

// Default: /settings shows the theme gallery
export const settingsIndexRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/",
	component: ThemesGalleryPage,
	validateSearch: validateGallerySearch,
})
