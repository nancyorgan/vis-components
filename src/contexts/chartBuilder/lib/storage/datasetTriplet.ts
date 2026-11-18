/** The dataset write triplet, parameterized by the caller's request
 *  function: the ONE implementation shared by the HTTP storage adapter
 *  (httpAdapter.ts) and any outside program (an MCP client), so the order and
 *  headers below can't drift between the editor and a program writing
 *  through the same API.
 *
 *  Order, load-bearing: the whole body (old clients and the export path read
 *  that file), the per-version sync, and the metadata LAST — a crash or a
 *  failed version sync (which throws past the meta write) then reads as
 *  un-hydrated, repaired on the next boot, never as
 *  fresh-meta-over-stale-versions. */

import { stringifyJsonDangerous } from "../../../../lib/json"
import { datasetMetaFrom } from "../datasetMeta"
import type { Dataset, DatasetMeta } from "../types"
import { syncDatasetVersions } from "./syncDatasetVersions"

/** One write to `/api/<collection>/<id>`. The caller's implementation owns
 *  the content-version header and the failure policy. */
export type StorageRequest = (
	method: "PUT" | "DELETE",
	collection: string,
	id: string,
	body?: string,
	headers?: Record<string, string>
) => Promise<void>

const JSON_HEADERS = { "content-type": "application/json" }

/** The whole body. The header tells the server this client manages the
 *  per-version bodies itself (the PUTs/DELETEs that follow this write).
 *  Without it — a body PUT from the previous bundle during a rolling
 *  deploy — the server purges the stored per-version rows, because they
 *  describe the PREVIOUS body. */
export const putDatasetBody = (
	request: StorageRequest,
	id: string,
	serialized: string
): Promise<void> =>
	request("PUT", "datasets", id, serialized, {
		...JSON_HEADERS,
		"x-vis-versions-managed": "1",
	})

/** One dataset's derived metadata, through the sub-resource route. */
export const putDatasetMeta = (
	request: StorageRequest,
	id: string,
	meta: DatasetMeta
): Promise<void> =>
	request(
		"PUT",
		`datasets/${encodeURIComponent(id)}`,
		"meta",
		stringifyJsonDangerous(meta as never),
		JSON_HEADERS
	)

/** The per-version sync (`syncDatasetVersions`) wired to the API: PUT each
 *  version whose rows changed, DELETE the versions in `priorVersionIds`
 *  that no longer exist. Throws on failure. */
export const syncDatasetVersionsVia = (
	request: StorageRequest,
	dataset: Dataset,
	priorVersionIds: Iterable<string> | undefined,
	written: Map<string, WeakRef<object>>
): Promise<void> => {
	const versions = `datasets/${encodeURIComponent(dataset.id)}/versions`
	return syncDatasetVersions(
		dataset,
		priorVersionIds,
		{
			putVersion: async (version) => {
				await request(
					"PUT",
					versions,
					version.id,
					stringifyJsonDangerous(version as never),
					JSON_HEADERS
				)
				return true
			},
			deleteVersion: (versionId) => request("DELETE", versions, versionId),
		},
		written
	)
}

/** Body, then `splitVersions`, then meta. */
export const writeDatasetTriplet = async (
	request: StorageRequest,
	dataset: Dataset,
	serialized: string,
	splitVersions: (dataset: Dataset) => Promise<void>
): Promise<void> => {
	await putDatasetBody(request, dataset.id, serialized)
	await splitVersions(dataset)
	await putDatasetMeta(request, dataset.id, datasetMetaFrom(dataset))
}
