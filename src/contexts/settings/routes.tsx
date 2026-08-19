import { createRoute } from "@tanstack/react-router"

import { rootRoute } from "../../routes/router"
import { FontsPage } from "./components/FontsPage"
import { SettingsLayout } from "./components/SettingsLayout"
import { SharingPage } from "./components/SharingPage"
import { ThemesPage } from "./components/ThemesPage"

export const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsLayout,
})

export const settingsThemesRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/themes",
	component: ThemesPage,
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

// Default redirect: /settings → /settings/themes
export const settingsIndexRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/",
	component: ThemesPage,
})
