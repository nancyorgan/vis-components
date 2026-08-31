/** The embed document's URL prefix — the ONE definition. The router mounts
 *  the embed route under it, RootLayout strips the app chrome by it, and the
 *  HTTP storage adapter decides thumbnail-free payloads by it. Before this
 *  was shared, a rename would have silently changed payload shape or chrome
 *  on whichever copy it missed. */
export const EMBED_PATH_PREFIX = "/embed/"

/** True when this DOCUMENT is an embed — a user-facing embed iframe or one
 *  of the hidden capture iframes, which boot the same route. Document-level
 *  on purpose: an embed never renders the library, so it never needs a
 *  thumbnail. */
export const isEmbedDocument = (): boolean =>
	typeof window !== "undefined" &&
	window.location.pathname.startsWith(EMBED_PATH_PREFIX)
