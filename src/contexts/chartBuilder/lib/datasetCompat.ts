import type { Field } from "./types"

export type ColumnDiff = {
	missing: string[] // present on prior version, absent in upload
	added: string[] // present in upload, absent on prior version
	typeChanged: Array<{ name: string; expected: string; got: string }>
}

/** Compare a candidate upload's fields against a Dataset's existing fields.
 * Returns a diff describing every mismatch — empty diff = compatible. */
export const diffFields = (
	existing: Field[],
	candidate: Field[]
): ColumnDiff => {
	const existingByName = new Map(existing.map((f) => [f.name, f]))
	const candidateByName = new Map(candidate.map((f) => [f.name, f]))
	const missing = existing
		.filter((f) => !candidateByName.has(f.name))
		.map((f) => f.name)
	const added = candidate
		.filter((f) => !existingByName.has(f.name))
		.map((f) => f.name)
	const typeChanged: ColumnDiff["typeChanged"] = []
	for (const f of candidate) {
		const prior = existingByName.get(f.name)
		if (prior && prior.inferredType !== f.inferredType) {
			typeChanged.push({
				name: f.name,
				expected: prior.inferredType,
				got: f.inferredType,
			})
		}
	}
	return { missing, added, typeChanged }
}

/** A new version is compatible as long as it keeps every existing column with
 * the same inferred type. Net-new columns are allowed (additive) and get
 * merged into the dataset's invariant field list when the version is appended;
 * dropping a column or changing a column's type is still rejected. */
export const isCompatible = (diff: ColumnDiff): boolean =>
	diff.missing.length === 0 && diff.typeChanged.length === 0

/** Format the blocking part of a ColumnDiff (missing columns + type changes)
 * as a one-paragraph human-readable explanation. Added columns are additive,
 * not blocking, so they are intentionally excluded here — see
 * `describeAddedColumns` for the informational note. */
export const describeDiff = (diff: ColumnDiff): string => {
	const parts: string[] = []
	if (diff.missing.length > 0) {
		parts.push(
			`missing column${diff.missing.length === 1 ? "" : "s"}: ${diff.missing.map((n) => `\`${n}\``).join(", ")}`
		)
	}
	if (diff.typeChanged.length > 0) {
		parts.push(
			`type change${diff.typeChanged.length === 1 ? "" : "s"}: ${diff.typeChanged
				.map((t) => `\`${t.name}\` was ${t.expected}, now ${t.got}`)
				.join(", ")}`
		)
	}
	return parts.join("; ")
}

/** Human-readable note listing the net-new columns an additive upload adds.
 * Empty string when the upload adds no new columns. */
export const describeAddedColumns = (diff: ColumnDiff): string => {
	if (diff.added.length === 0) return ""
	return `Adds ${diff.added.length} new column${
		diff.added.length === 1 ? "" : "s"
	}: ${diff.added.map((n) => `\`${n}\``).join(", ")}.`
}
