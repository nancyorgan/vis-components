import type { Dataset, Field } from "./types"

export type ColumnDiff = {
	missing: string[] // present on prior version, absent in upload
	added: string[] // present in upload, absent on prior version
	typeChanged: Array<{ name: string; expected: string; got: string }>
}

/** Non-blocking type drift: categorical → quantitative is allowed because
 * inference has widened over time (dollar/comma cells like "$1,234" now infer
 * quantitative), so a byte-identical re-upload of a column stored under the
 * OLD inference must not read as a type change. The dataset's stored type
 * stays authoritative, and quantitative values always render fine as
 * categories — the guard only matters in the other direction (a quantitative
 * column turning non-numeric would break every chart using it as a measure). */
const typeCompatible = (prior: Field, got: Field): boolean =>
	prior.inferredType === got.inferredType ||
	(prior.inferredType === "categorical" && got.inferredType === "quantitative")

/** Resolve which candidate column each existing field matches (or null).
 * A candidate column matches an existing field by its CURRENT name or by any
 * former name (`Field.sourceNames`, written by the Fields-panel rename), so
 * new versions of a file keep matching whether they use the old or the new
 * header. When an upload carries BOTH names, the type-compatible one wins
 * (current name first) and the other lands as an ordinary added column. A
 * candidate column is claimed by at most one field. */
const matchCandidates = (
	existing: Field[],
	candidate: Field[]
): Array<{ field: Field; match: Field | null }> => {
	const candidateByName = new Map(candidate.map((f) => [f.name, f]))
	const claimed = new Set<string>()
	return existing.map((f) => {
		const exactRaw = candidateByName.get(f.name)
		const exact = exactRaw && !claimed.has(exactRaw.name) ? exactRaw : undefined
		const aliases = (f.sourceNames ?? [])
			.map((n) => candidateByName.get(n))
			.filter((c): c is Field => c !== undefined && !claimed.has(c.name))
		const match =
			exact && typeCompatible(f, exact)
				? exact
				: (aliases.find((c) => typeCompatible(f, c)) ?? exact ?? aliases[0] ?? null)
		if (match) claimed.add(match.name)
		return { field: f, match }
	})
}

/** Compare a candidate upload's fields against a Dataset's existing fields.
 * Returns a diff describing every mismatch — empty diff = compatible.
 * Matching rules live in `matchCandidates`; candidate columns no field
 * claimed are `added`. */
export const diffFields = (
	existing: Field[],
	candidate: Field[]
): ColumnDiff => {
	const matches = matchCandidates(existing, candidate)
	const claimed = new Set(
		matches.flatMap(({ match }) => (match ? [match.name] : []))
	)
	const missing = matches
		.filter(({ match }) => match === null)
		.map(({ field }) => field.name)
	const typeChanged: ColumnDiff["typeChanged"] = []
	for (const { field, match } of matches) {
		if (match && !typeCompatible(field, match)) {
			typeChanged.push({
				name: match.name,
				expected: field.inferredType,
				got: match.inferredType,
			})
		}
	}
	const added = candidate.filter((c) => !claimed.has(c.name)).map((c) => c.name)
	return { missing, added, typeChanged }
}

/** The `DatasetVersion.keyAliases` record a version being appended should
 * carry: field current name → matched candidate column, for exactly the
 * ambiguous matches — a renamed field bound to a FORMER-name column while
 * the upload ALSO carries a column under the field's current name (the type
 * tiebreak). The view-time remap needs this to keep the current-name key
 * from shadowing the matched column; unambiguous former-name matches are
 * resolved by the generic `sourceNames` scan and need no record. Empty for
 * almost every upload — callers attach it only when non-empty. */
export const versionKeyAliases = (
	existing: Field[],
	candidate: Field[]
): Record<string, string> => {
	const candidateNames = new Set(candidate.map((f) => f.name))
	const out: Record<string, string> = {}
	for (const { field, match } of matchCandidates(existing, candidate)) {
		if (match && match.name !== field.name && candidateNames.has(field.name))
			out[field.name] = match.name
	}
	return out
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
 * than risk dropping a live field. A RENAMED field's rows still carry its
 * original column key, so representation checks the field's former names
 * (`sourceNames`) too — judging by `name` alone would silently delete every
 * renamed field here. Returns the input unchanged (same reference) when
 * nothing is pruned. */
export const pruneOrphanFields = (dataset: Dataset): Dataset => {
	if (dataset.versions.length === 0) return dataset
	if (dataset.versions.some((v) => v.rows.length === 0)) return dataset
	const represented = new Set<string>()
	for (const v of dataset.versions)
		for (const row of v.rows)
			for (const key of Object.keys(row)) represented.add(key)
	const kept = dataset.fields.filter(
		(f) =>
			represented.has(f.name) ||
			(f.sourceNames ?? []).some((n) => represented.has(n))
	)
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
