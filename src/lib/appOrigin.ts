/** The origin used for OUTWARD-FACING absolute links (embed/share URLs).
 *
 *  In server mode the app usually sits behind proxies, so the page's own
 *  `window.location.origin` may not be the address links should carry; the
 *  server supplies the canonical base URL at boot (via /api/config, from its
 *  VIS_BASE_URL) and main.tsx installs it here. Everywhere else — including
 *  internal same-origin mechanics like the thumbnail-capture iframe — keeps
 *  reading `window.location.origin` directly. */

let configuredOrigin: string | null = null

/** Install the server-provided base URL. Called once at boot, before render,
 *  and only in server mode. */
export const setAppOrigin = (origin: string): void => {
	configuredOrigin = origin.replace(/\/+$/, "")
}

/** The origin for shareable absolute URLs: the configured base URL in server
 *  mode, the page's own origin otherwise. */
export const appOrigin = (): string => {
	if (configuredOrigin !== null) return configuredOrigin
	return typeof window === "undefined" ? "" : window.location.origin
}

/** Test-only reset — module state would otherwise leak between suites. */
export const resetAppOriginForTests = (): void => {
	configuredOrigin = null
}
