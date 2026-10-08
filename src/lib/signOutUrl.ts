/** Where the header's "Log out" form posts, when the app runs under a host
 *  that has sessions to end. It comes from /api/config at boot, and main.tsx
 *  installs it before render. In local mode, and on the standalone server,
 *  it stays null and the header shows no log-out control. */

let signOutUrl: string | null = null

/** Install the server-provided sign-out path. Called once at boot, before
 *  render, and only in server mode. */
export const setSignOutUrl = (url: string): void => {
	signOutUrl = url
}

export const getSignOutUrl = (): string | null => signOutUrl
