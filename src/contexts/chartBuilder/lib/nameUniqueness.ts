/** Canonical form for comparing entity names. Trim surrounding whitespace,
 * then lowercase. A name like `"  Kinds of Cats  "` collides with
 * `"kinds of cats"` — intentional, since users rarely want case-only or
 * whitespace-only distinctions in a list of visuals or data sets. */
export const normalizeName = (name: string): string => name.trim().toLowerCase()

/** Does `candidate` collide with an existing record's name, case-insensitively
 * and ignoring surrounding whitespace?
 *
 * - Empty / whitespace-only names never collide (they're saved as "Untitled"
 *   elsewhere in the app and the uniqueness check doesn't apply).
 * - `excludeId` lets the rename path ignore the record currently being
 *   renamed ("my own name doesn't collide with myself"). For brand-new
 *   records, omit it.
 */
export const nameCollides = <T extends { id: string; name: string }>(
	candidate: string,
	records: readonly T[],
	excludeId?: string
): boolean => {
	const norm = normalizeName(candidate)
	if (norm === "") return false
	return records.some(
		(r) => r.id !== excludeId && normalizeName(r.name) === norm
	)
}
