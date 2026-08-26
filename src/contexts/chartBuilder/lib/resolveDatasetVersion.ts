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

/**
 * Build a flat DatasetView for renderers. Returns undefined when the dataset
 * is missing, otherwise pairs the dataset's invariant fields with the resolved
 * version's rows + version metadata.
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
		rows: version.rows,
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
