import type { Dataset, DatasetVersion, DatasetView } from "./types"

/**
 * Resolve a Dataset to a specific DatasetVersion.
 *
 * @param dataset           The dataset to resolve, or undefined.
 * @param preferredVersionId  Pin to this version. If null, undefined, or the
 *                          version doesn't exist, falls back to the dataset's
 *                          latest version. Returns null if the dataset itself
 *                          is missing or has no versions.
 */
export const resolveDatasetVersion = (
	dataset: Dataset | undefined,
	preferredVersionId: string | null | undefined
): DatasetVersion | null => {
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
	dataset: Dataset | undefined,
	requestedVersionId: string
): DatasetVersion | null => {
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
