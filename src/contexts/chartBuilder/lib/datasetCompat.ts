import type { Dataset, Field } from "./types"

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
			// categorical → quantitative is non-blocking: inference has widened
			// over time (dollar/comma cells like "$1,234" now infer
			// quantitative), so a byte-identical re-upload of a column stored
			// under the OLD inference must not read as a type change. The
			// dataset's stored type stays authoritative, and quantitative
			// values always render fine as categories — the guard only matters
			// in the other direction (a quantitative column turning
			// non-numeric would break every chart using it as a measure).
			if (prior.inferredType === "categorical" && f.inferredType === "quantitative")
				continue
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

/** Drop fields no remaining version's rows actually carry. Additive version
 * uploads merge net-new columns into the dataset's invariant field list, so
 * deleting the version that introduced a column leaves its field orphaned —
 * call this after any version removal (and in the one-shot store cleanup for
 * historical orphans).
 *
 * Column presence is judged by row keys unioned across every row of every
 * version (PapaParse omits trailing keys on short rows, so a single row isn't
 * authoritative). A version with zero rows makes its columns unknowable from
 * rows, so pruning is skipped entirely when any version is row-less rather
 * than risk dropping a live field. Returns the input unchanged (same
 * reference) when nothing is pruned. */
export const pruneOrphanFields = (dataset: Dataset): Dataset => {
	if (dataset.versions.length === 0) return dataset
	if (dataset.versions.some((v) => v.rows.length === 0)) return dataset
	const represented = new Set<string>()
	for (const v of dataset.versions)
		for (const row of v.rows)
			for (const key of Object.keys(row)) represented.add(key)
	const kept = dataset.fields.filter((f) => represented.has(f.name))
	if (kept.length === dataset.fields.length) return dataset
	return { ...dataset, fields: kept }
}

/** Human-readable note listing the net-new columns an additive upload adds.
 * Empty string when the upload adds no new columns. */
export const describeAddedColumns = (diff: ColumnDiff): string => {
	if (diff.added.length === 0) return ""
	return `Adds ${diff.added.length} new column${
		diff.added.length === 1 ? "" : "s"
	}: ${diff.added.map((n) => `\`${n}\``).join(", ")}.`
}
