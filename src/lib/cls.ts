/**
 * Conveniently build className strings. Falsy values (false / undefined /
 * null / "") are stripped, the rest are joined with a single space.
 *
 * @example
 *   const classes = combine("font-bold", isOpen && "open", className)
 *
 * Vendored from `@th/lib/src/render/classes.ts` — the original also reported
 * a runtime error if `true` was passed in; we drop that since vis-components
 * doesn't have the in-house error-reporting plumbing.
 */
type ClassName = string | false | undefined | null

export const combine = (...args: ClassName[]): string =>
	args.filter((c): c is string => typeof c === "string" && c.length > 0).join(" ")
