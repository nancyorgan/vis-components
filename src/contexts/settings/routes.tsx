import { createRoute } from "@tanstack/react-router"

import { rootRoute } from "../../routes/router"
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

// Default redirect: /settings → /settings/themes
export const settingsIndexRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/",
	component: ThemesPage,
})
