// The person's sign-in has lapsed: a one-way flag the banner reads.
//
// Behind a sign-in proxy (the server's `VIS_AUTH_MODE=header`), an expired
// session makes the proxy answer 401 to every request under /api/ — a save,
// a collection load, a presence heartbeat — before it reaches the server;
// the server itself answers 401 to a request the proxy let through without
// identity. Either way the status is the whole signal (the body may be the
// proxy's, not ours), and a reload signs the person straight back in. So a
// 401 anywhere on /api/ flips this flag, the banner asks for a reload, and
// nothing clears it but the reload. Same shape as `staleBuild.ts`.

import { useSyncExternalStore } from "react"

let lapsed = false
const listeners = new Set<() => void>()

/** Record a 401 from the API. One-way: only a reload clears it. */
export const markSignInLapsed = (): void => {
	if (lapsed) return
	lapsed = true
	for (const listener of listeners) listener()
}

export const isSignInLapsed = (): boolean => lapsed

/** Test-only reset. */
export const resetSignInLapsedForTests = (): void => {
	lapsed = false
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Whether the API has answered 401 this page load — for the banner. */
export const useSignInLapsed = (): boolean =>
	useSyncExternalStore(
		subscribe,
		() => lapsed,
		() => false
	)

/** Pass every /api/ response through this: a 401 marks the sign-in lapsed.
 *  Returns the response unchanged so it slots into a fetch chain. */
export const noteSignIn = <R extends Pick<Response, "status">>(response: R): R => {
	if (response.status === 401) markSignInLapsed()
	return response
}
