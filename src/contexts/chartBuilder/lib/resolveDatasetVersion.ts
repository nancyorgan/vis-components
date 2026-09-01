import { datasetFromParts, type DatasetLike } from "./datasetMeta"
import type { Dataset, DatasetMeta, DatasetView } from "./types"

/**
 * Resolve a Dataset to a specific DatasetVersion.
 *
 * @param dataset           The dataset to resolve, or undefined.
 * @param preferredVersionId  Pin to this version. If null, undefined, or the
 *                          version doesn't exist, falls back to the dataset's
 *                          latest version. Returns null if the dataset itself
 *                          is missing or has no versions.
 */
export const resolveDatasetVersion = <V extends { id: string }>(
	dataset: { versions: readonly V[]; latestVersionId: string } | undefined,
	preferredVersionId: string | null | undefined
): V | null => {
	if (!dataset || dataset.versions.length === 0) return null
	if (preferredVersionId) {
		const found = dataset.versions.find((v) => v.id === preferredVersionId)
		if (found) return found
	}
	const latest = dataset.versions.find((v) => v.id === dataset.latestVersionId)
	// Length-checked above: there is at least one version, so `.at(-1)` is safe.
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded above
	return latest ?? dataset.versions.at(-1)!
}

/**
 * Like `resolveDatasetVersion` but also returns null when the requested
 * version was specifically requested and missing — used by the iframe viewer
 * to surface a "this pinned version no longer exists" error rather than
 * silently falling back to latest.
 */
export const resolveDatasetVersionStrict = (
	dataset: DatasetLike | undefined,
	requestedVersionId: string
): { id: string } | null => {
	if (!dataset) return null
	return dataset.versions.find((v) => v.id === requestedVersionId) ?? null
}

/** Surface renamed fields' values under their CURRENT name. Stored rows keep
 * their original column keys forever (rewriting every version's rows would
 * dirty every persisted body); a field renamed via the Fields panel instead
 * carries its former names in `Field.sourceNames`, and this remap copies the
 * first present alias's value onto `field.name` for rows that lack the
 * current key. A row that already carries the current name wins as-is —
 * including the both-columns case where an old-named column was re-added as
 * its own field (the alias key is never deleted, so that field still reads
 * its column directly). The exception is a version whose `keyAliases` record
 * pins a field to a specific column (the upload-time type tiebreak bound a
 * renamed field to its former-name column while a same-named column was also
 * present) — there the pinned key wins even over a present current-name key.
 * Identity-preserving: with no aliased fields — every dataset untouched by
 * renames — the input array is returned unchanged. */
const remapRowsToFieldNames = (
	fields: readonly { name: string; sourceNames?: string[] }[],
	rows: Array<Record<string, string>>,
	keyAliases: Record<string, string> | undefined
): Array<Record<string, string>> => {
	const aliased = fields.filter(
		(f) => (f.sourceNames?.length ?? 0) > 0 || keyAliases?.[f.name] !== undefined
	)
	if (aliased.length === 0) return rows
	let changed = false
	const out = rows.map((row) => {
		let next = row
		for (const f of aliased) {
			const pinned = keyAliases?.[f.name]
			const source =
				pinned !== undefined && pinned in row
					? pinned
					: f.name in row
						? undefined
						: f.sourceNames?.find((a) => a in row)
			if (source === undefined || row[f.name] === row[source]) continue
			if (next === row) next = { ...row }
			next[f.name] = row[source] ?? ""
		}
		if (next !== row) changed = true
		return next
	})
	return changed ? out : rows
}

/**
 * Build a flat DatasetView for renderers. Returns undefined when the dataset
 * is missing, otherwise pairs the dataset's invariant fields with the resolved
 * version's rows + version metadata. Rows of versions uploaded under a field's
 * FORMER name are remapped to the current name (see `remapRowsToFieldNames`).
 */
export const resolveDatasetView = (
	dataset: Dataset | undefined,
	preferredVersionId: string | null | undefined
): DatasetView | undefined => {
	if (!dataset) return undefined
	const version = resolveDatasetVersion(dataset, preferredVersionId)
	if (!version) return undefined
	const versionIndex = dataset.versions.findIndex((v) => v.id === version.id)
	return {
		id: dataset.id,
		name: dataset.name,
		filename: version.filename,
		fields: dataset.fields,
		rows: remapRowsToFieldNames(
			dataset.fields,
			version.rows,
			version.keyAliases
		),
		createdAt: dataset.createdAt,
		versionId: version.id,
		versionIndex: versionIndex + 1,
		totalVersions: dataset.versions.length,
		isLatest: version.id === dataset.latestVersionId,
		versionCreatedAt: version.createdAt,
		versionNote: version.note,
	}
}

/** Which version a `DatasetMeta` resolves to, given an optional pin — the
 *  same rule as `resolveDatasetVersion` (it IS that function, over metadata),
 *  answered before any rows exist so the caller can work out WHICH rows to
 *  fetch before fetching any. */
export const resolveVersionIdFromMeta = (
	meta: DatasetMeta | undefined,
	preferredVersionId: string | null | undefined
): string | null => resolveDatasetVersion(meta, preferredVersionId)?.id ?? null

/** The metadata-plus-one-version equivalent of `resolveDatasetView`, for the
 *  lazy read path: everything but the rows comes from the index, and only the
 *  rows of the version actually being drawn are needed. Delegates through
 *  `datasetFromParts` + `resolveDatasetView`, so there is exactly one
 *  constructor of `DatasetView` and the two paths cannot drift. */
export const resolveDatasetViewFromMeta = (
	meta: DatasetMeta | undefined,
	rows: Array<Record<string, string>> | undefined,
	preferredVersionId: string | null | undefined
): DatasetView | undefined => {
	if (!meta || !rows) return undefined
	const versionId = resolveVersionIdFromMeta(meta, preferredVersionId)
	if (!versionId) return undefined
	return resolveDatasetView(
		datasetFromParts(meta, { [versionId]: rows }),
		preferredVersionId
	)
}
