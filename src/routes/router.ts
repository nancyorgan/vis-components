import {
	createHashHistory,
	createRootRoute,
	createRouter,
} from "@tanstack/react-router"

import {
	editorNewRoute,
	editorVisualRoute,
} from "../contexts/chartBuilder/routes"
import { embedRoute } from "../contexts/embed/routes"
import { libraryRoute } from "../contexts/library/routes"
import {
	settingsFontsRoute,
	settingsIndexRoute,
	settingsRoute,
	settingsSharingRoute,
	settingsThemesRoute,
} from "../contexts/settings/routes"
import { RootLayout } from "./RootLayout"

export const rootRoute = createRootRoute({
	component: RootLayout,
})

// `createRoute` is re-exported via `export * from "@tanstack/react-router"`
// below — no explicit re-export needed (would be a duplicate export).

const routeTree = rootRoute.addChildren([
	libraryRoute,
	editorNewRoute,
	editorVisualRoute,
	embedRoute,
	settingsRoute.addChildren([
		settingsIndexRoute,
		settingsThemesRoute,
		settingsFontsRoute,
		settingsSharingRoute,
	]),
])

/** The single-file build is meant to be shared as a bare `dist/index.html`
 * that people open straight from disk. Under `file://` the URL path is the
 * file's filesystem path, which browser-history routing can never match — so
 * route via the hash fragment (`index.html#/editor/new`) there. Served over
 * http(s) (dev server, e2e, a real deploy) we keep clean path-based URLs. */
const isFileProtocol =
	typeof window !== "undefined" && window.location.protocol === "file:"

export const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	...(isFileProtocol ? { history: createHashHistory() } : {}),
})

export * from "@tanstack/react-router"
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}
