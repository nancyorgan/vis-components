// A build that is BEHIND the server's content schema must not write.
//
// Chart saves carry no version of their own, so a tab still running the
// previous bundle after a deploy would write the previous SHAPE back over
// migrated content — and nothing would migrate it again, because the
// server's stamp already says the collection is current. So every write
// to a versioned collection names the content version this build writes
// (`x-vis-content-version`), and the server answers 409 when that is
// behind its stamp. This module is the client half: the header, and the
// one-way "this build is stale" flag the banner reads so the user knows to
// reload (the editor draft is kept in localStorage, so nothing is lost).

import { useSyncExternalStore } from "react"

export { contentVersionHeader } from "./contentVersionHeader"

/** Thrown by a write the server refused as behind its content schema, and
 *  by every write attempted after that (no point asking again). */
export class StaleBuildError extends Error {
	constructor(detail: string) {
		super(
			`This build is behind the server's content schema (${detail}). ` +
				`Reload to pick up the current build; unsaved edits are kept.`
		)
		this.name = "StaleBuildError"
	}
}

let stale = false
const listeners = new Set<() => void>()

/** Record that the server refused a write from this build. One-way: only a
 *  reload clears it. */
export const markStaleBuild = (): void => {
	if (stale) return
	stale = true
	for (const listener of listeners) listener()
}

export const isStaleBuild = (): boolean => stale

/** Test-only reset. */
export const resetStaleBuildForTests = (): void => {
	stale = false
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/** Whether this build has been refused a write as stale — for the banner. */
export const useStaleBuild = (): boolean =>
	useSyncExternalStore(
		subscribe,
		() => stale,
		() => false
	)

/** Before a write: refuse locally once the server has already said no. */
export const assertNotStale = (what: string): void => {
	if (stale) throw new StaleBuildError(`${what} skipped`)
}

/** After a write: a 409 is the server's refusal. Marks the build stale and
 *  returns the error to throw; `null` for any other response. */
export const staleBuildErrorFrom = (
	response: Pick<Response, "status">,
	what: string
): StaleBuildError | null => {
	if (response.status !== 409) return null
	markStaleBuild()
	return new StaleBuildError(`${what} refused`)
}
