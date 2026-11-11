/** Levenshtein distance between `a` and `b`, case-insensitive. */
export const editDistance = (a: string, b: string): number => {
	const x = a.toLowerCase()
	const y = b.toLowerCase()
	let row = Array.from({ length: y.length + 1 }, (_, j) => j)
	for (let i = 1; i <= x.length; i++) {
		const next = [i]
		for (let j = 1; j <= y.length; j++)
			next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)))
		row = next
	}
	return row[y.length]
}

/** `; did you mean "x"?` for the closest candidate by edit distance
 * (case-insensitive, at most a third of the name's length), else "". Shared
 * by the chart-spec and settings problems lists. */
export const didYouMean = (name: string, candidates: readonly string[]): string => {
	let best: string | null = null
	let bestDist = Math.max(2, Math.ceil(name.length / 3)) + 1
	for (const c of candidates) {
		const dist = editDistance(name, c)
		if (dist < bestDist) [best, bestDist] = [c, dist]
	}
	return best === null ? "" : `; did you mean "${best}"?`
}
