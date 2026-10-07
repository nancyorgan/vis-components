/** The host's account page (log out etc.), when the app runs under a server
 *  that has accounts. It comes from /api/config at boot, and main.tsx
 *  installs it before render. In local mode, and on the standalone server,
 *  it stays null and the header shows no account link. */

let accountUrl: string | null = null

/** Install the server-provided account path. Called once at boot, before
 *  render, and only in server mode. */
export const setAccountUrl = (url: string): void => {
	accountUrl = url
}

export const getAccountUrl = (): string | null => accountUrl
