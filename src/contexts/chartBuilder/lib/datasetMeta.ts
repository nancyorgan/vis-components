/** Dataset metadata: the row-free description of a data set.
 *
 *  The app boots on metadata alone and pulls row data per dataset, on demand.
 *  This module owns the one conversion between the two, so `rowCount` can
 *  never drift from the body it describes.
 *
 *  In server mode the metadata is stored beside the body but derived HERE,
 *  on the client — the self-host server never parses dataset bodies (see
 *  server/src/db.ts). That is also why the server can hand back `null` for a
 *  dataset it has no metadata for: rows written before the metadata column
 *  existed, or a body write whose metadata follow-up was lost. Both are
 *  repaired the same way, by loading the body and deriving from it. */

import type { Dataset, DatasetMeta, DatasetVersionMeta, Field } from "./types"

/** Everything about a data set that can be answered without its rows.
 *
 *  Both `Dataset` and `DatasetMeta` satisfy this, which neither does for the
 *  other — their `versions` differ by exactly the rows. Helpers that only name
 *  a dataset, count its versions, or check that it exists take this, so they
 *  work whether or not the body has been loaded. */
export type DatasetLike = {
	id: string
	name: string
	fields: Field[]
	versions: ReadonlyArray<{
		id: string
		filename: string
		createdAt: number
		note?: string
	}>
	latestVersionId: string
	createdAt: number
}

/** Strip the rows out of one version, keeping a count in their place. */
const versionMetaFrom = (
	version: Dataset["versions"][number]
): DatasetVersionMeta => {
	const { rows, ...rest } = version
	return { ...rest, rowCount: rows.length }
}

/** Derive a dataset's metadata from its full body.
 *
 *  Tolerates a missing `versions` array. Datasets reach this from storage and
 *  from bundle imports, where legacy and hand-edited shapes turn up; deriving
 *  an empty version list is the same answer the rest of the pipeline gives
 *  such a dataset, and is strictly better than throwing inside a save. */
export const datasetMetaFrom = (dataset: Dataset): DatasetMeta => ({
	...dataset,
	versions: (dataset.versions ?? []).map(versionMetaFrom),
})

/** Derive the metadata index for a whole store of loaded datasets. */
export const datasetIndexFrom = (
	datasets: Record<string, Dataset>
): Record<string, DatasetMeta> =>
	Object.fromEntries(
		Object.entries(datasets).map(([id, dataset]) => [
			id,
			datasetMetaFrom(dataset),
		])
	)

/** True when `value` is shaped like stored dataset metadata.
 *
 *  Guards the seam where metadata arrives as opaque JSON the server stored
 *  without ever inspecting it. A row that fails this is treated exactly like
 *  an absent one — re-derived from the body — rather than trusted, so a
 *  malformed stamp degrades to a slow load instead of a broken library. */
export const isDatasetMeta = (value: unknown): value is DatasetMeta => {
	if (typeof value !== "object" || value === null) return false
	const record = value as Record<string, unknown>
	return (
		typeof record.id === "string" &&
		typeof record.name === "string" &&
		Array.isArray(record.fields) &&
		Array.isArray(record.versions) &&
		record.versions.every(
			(v) =>
				typeof v === "object" &&
				v !== null &&
				typeof (v as Record<string, unknown>).id === "string" &&
				// Rows here would mean this isn't metadata at all — something
				// wrote a full body into the index.
				!("rows" in (v as Record<string, unknown>))
		)
	)
}
