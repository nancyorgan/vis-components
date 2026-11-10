/** Who is making a request, as the HOST says. This server has no accounts
 *  of its own: a host that runs the handler behind its own sign-in passes
 *  `identify`, and only then does the app show who is in an editor and who
 *  saved a visual last. The standalone server in `VIS_AUTH_MODE=header`
 *  passes `identifyFromForwardedHeaders`, trusting a sign-in proxy in front
 *  of it; in the default mode it passes nothing, and every identity feature
 *  stays off. */

import type { IncomingMessage } from "node:http"

export type AppUser = {
	/** Stable account id (an email, a subject claim, …). Only ever compared,
	 *  never shown. */
	id: string
	/** Display name, e.g. "Jane Doe". The app derives initials and a first
	 *  name from it. */
	name: string
}

/** Resolve the signed-in user for a request, or null when there is none.
 *  Must not throw for an anonymous request. */
export type IdentifyUser = (req: IncomingMessage) => AppUser | null

const MAX_ID = 256
const MAX_NAME = 120

/** Header names a sign-in proxy sets on every request it forwards. The
 *  proxy replaces any copies a client sends, which is the only reason they
 *  can be trusted — this hook is for `VIS_AUTH_MODE=header` and nothing
 *  else. */
export const FORWARDED_USER_HEADER = "x-forwarded-user"
export const FORWARDED_EMAIL_HEADER = "x-forwarded-email"
export const FORWARDED_USERNAME_HEADER = "x-forwarded-preferred-username"

const headerValue = (req: IncomingMessage, name: string): string => {
	const raw = req.headers[name]
	const value = Array.isArray(raw) ? raw[0] : raw
	return typeof value === "string" ? value.trim() : ""
}

/** Identity as a sign-in proxy states it: id = `X-Forwarded-User` (a stable
 *  opaque account id, compared and never shown), name = `X-Forwarded-Email`
 *  (the app reads initials and a first name through an email's local
 *  part), falling back to `X-Forwarded-Preferred-Username` and then to the
 *  id itself. No user header means nobody — and in header mode the handler
 *  turns that into a 401. */
export const identifyFromForwardedHeaders: IdentifyUser = (req) => {
	const id = headerValue(req, FORWARDED_USER_HEADER)
	if (!id) return null
	const name =
		headerValue(req, FORWARDED_EMAIL_HEADER) || headerValue(req, FORWARDED_USERNAME_HEADER)
	return sanitizeUser({ id, name })
}

/** Normalize whatever the host's hook returned: trimmed, length-capped, and
 *  a blank name falls back to the id. A missing or blank id means nobody —
 *  identity without an id can't be compared, so it's worth nothing. */
export const sanitizeUser = (value: unknown): AppUser | null => {
	if (typeof value !== "object" || value === null) return null
	const record = value as Record<string, unknown>
	const id = typeof record.id === "string" ? record.id.trim().slice(0, MAX_ID) : ""
	if (!id) return null
	const rawName = typeof record.name === "string" ? record.name.trim() : ""
	return { id, name: (rawName || id).slice(0, MAX_NAME) }
}

/** Run the host's hook defensively: a hook that throws reads as anonymous
 *  rather than failing the request it was asked about. */
export const requestUser = (
	identify: IdentifyUser | undefined,
	req: IncomingMessage
): AppUser | null => {
	if (!identify) return null
	try {
		return sanitizeUser(identify(req))
	} catch {
		return null
	}
}

const sameUser = (a: unknown, b: unknown): boolean => {
	if (a === undefined || b === undefined) return a === b
	const left = sanitizeUser(a)
	const right = sanitizeUser(b)
	return left !== null && right !== null && left.id === right.id && left.name === right.name
}

/** Make a visual's `updatedBy` say who REALLY saved it.
 *
 *  Every write of a visual comes through one PUT: a real save, but also a
 *  folder move, a trash, a restore. Only a real save restamps `updatedBy`
 *  (the client stamps itself alongside `updatedAt`), so a body whose
 *  `updatedBy` matches what's stored is passed through untouched — moving
 *  Jane's chart doesn't credit you with her save. A body that CHANGES it is a
 *  save, and the server, not the client, says by whom: the requesting user,
 *  or (anonymous request) the stored saver kept as it was.
 *
 *  A CREATE (`stored` is null: nothing under that id yet) is always a save
 *  by the requester, whether or not the body names anyone — an API client
 *  or agent sends no `updatedBy` at all, and the chart it makes should
 *  still say who made it.
 *
 *  Returns the body to store, or null when it should be stored as received. */
export const stampSaver = (
	body: Record<string, unknown>,
	stored: { updatedBy?: unknown } | null,
	user: AppUser | null
): Record<string, unknown> | null => {
	const storedUpdatedBy = stored?.updatedBy
	if (stored !== null && sameUser(body.updatedBy, storedUpdatedBy)) return null
	const next = { ...body }
	const keep = user ?? sanitizeUser(storedUpdatedBy)
	if (keep) next.updatedBy = keep
	else delete next.updatedBy
	return next
}
