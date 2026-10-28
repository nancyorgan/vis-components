/** Edit distance between two strings (insert / delete / substitute). */
const distance = (a: string, b: string): number => {
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
	for (let i = 1; i <= a.length; i++) {
		const next = [i]
		for (let j = 1; j <= b.length; j++) {
			next[j] = Math.min(
				(prev[j] ?? 0) + 1,
				(next[j - 1] ?? 0) + 1,
				(prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
			)
		}
		prev = next
	}
	return prev[b.length] ?? 0
}

/** Names longer than this only get a case-insensitive match: edit
 *  distance costs their length times each candidate's. */
const MAX_FUZZY = 64

/** The candidate `name` was most likely meant as: a case-insensitive match
 * first, else the closest within a third of the name's length (at least
 * one edit). `null` when nothing is close. */
export const nearestName = (
	name: string,
	candidates: readonly string[]
): string | null => {
	const lower = name.toLowerCase()
	const caseOnly = candidates.find((c) => c.toLowerCase() === lower)
	if (caseOnly !== undefined) return caseOnly
	if (name.length > MAX_FUZZY) return null
	const limit = Math.max(1, Math.floor(name.length / 3))
	let best: string | null = null
	let bestDistance = limit + 1
	for (const c of candidates) {
		if (Math.abs(c.length - name.length) >= bestDistance) continue
		const d = distance(lower, c.toLowerCase())
		if (d < bestDistance) {
			best = c
			bestDistance = d
		}
	}
	return best
}

/** `; did you mean "x"?` for the nearest candidate, or nothing. */
export const didYouMean = (
	name: string,
	candidates: readonly string[]
): string => {
	const near = nearestName(name, candidates)
	return near === null ? "" : `; did you mean "${near}"?`
}
