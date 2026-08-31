/** Orphaned-dataset cleanup.
 *
 *  Datasets have no UI of their own — the data drawer shows only the current
 *  dataset, embeds resolve their dataset through their visual (and cascade-
 *  delete with it), so a dataset referenced by no visual and not open in the
 *  editor is unreachable from every surface. Two consumers:
 *
 *  - {@link sweepOrphanDatasets}: the pure core, run whenever visuals are
 *    deleted so a dataset's last reference takes the dataset with it.
 *  - {@link runDatasetStoreCleanup}: a marker-guarded one-shot (main.tsx)
 *    that clears the backlog accumulated before cascade-on-delete existed,
 *    and re-runs the duplicate collapse the localStorage→IndexedDB move
 *    orphaned. Design decisions behind that one-shot: sweep on a
 *    {@link CLEANUP_VERSION} marker rather than every launch (bump it to
 *    re-run); dedupe BEFORE sweeping so collapsed duplicates take their
 *    references with them; protect the editor's current dataset so an
 *    unsaved upload survives; and never throw — a failure logs, skips the
 *    marker so it retries next launch, and first paint proceeds. */

import { pruneOrphanFields } from "./datasetCompat"
import { dedupeDatasetStores, withFreshContentHash } from "./datasetDedupe"
import {
	idbAvailable,
} from "./storage/idb"
import { getStorageAdapter } from "./storage/registry"
import {
	loadCurrentDatasetId,
	loadDatasetCleanupDone,
	deleteDatasetsAsync,
	loadDatasetsAsync,
	loadEmbedInstances,
	loadPreviewVersionId,
	loadVisuals,
	saveCurrentDatasetId,
	saveDatasetCleanupDone,
	saveDatasetsAsync,
	saveDatasetsLocalFallback,
	saveEmbedInstances,
	savePreviewVersionId,
	saveVisuals,
} from "./storage"
import type { Dataset } from "./types"

/** Bump to make {@link runDatasetStoreCleanup} run once more in browsers
 *  that already completed an earlier version.
 *  v2: prune orphaned fields left behind by deleted additive versions.
 *  v3: refresh stale content hashes — before lazy loading shipped, appending
 *  or deleting a version never updated the creation-time hash, and a stale
 *  hash makes upload dedupe hint a false match that also disables the
 *  name-collision guard. */
const CLEANUP_VERSION = 3

export type SweepInput<T = Dataset> = {
	datasets: Record<string, T>
	visuals: readonly { datasetId: string | null }[]
	/** Dataset ids that must survive even when no visual references them —
	 *  the editor's persisted current dataset (an upload not yet saved as a
	 *  visual is live work in progress). Nulls are ignored. */
	protectedIds?: readonly (string | null)[]
}

export type SweepResult<T = Dataset> = {
	datasets: Record<string, T>
	removedIds: string[]
}

/** Drop every dataset that no visual references and no protected id names.
 *  Pure; returns the input record unchanged (same reference) when there is
 *  nothing to remove. */
export const sweepOrphanDatasets = <T>({
	datasets,
	visuals,
	protectedIds = [],
}: SweepInput<T>): SweepResult<T> => {
	const referenced = new Set<string>()
	for (const v of visuals) if (v.datasetId != null) referenced.add(v.datasetId)
	for (const id of protectedIds) if (id != null) referenced.add(id)

	const removedIds = Object.keys(datasets).filter((id) => !referenced.has(id))
	if (removedIds.length === 0) return { datasets, removedIds }

	const kept: Record<string, T> = {}
	for (const [id, d] of Object.entries(datasets)) {
		if (referenced.has(id)) kept[id] = d
	}
	return { datasets: kept, removedIds }
}

/** One-shot store cleanup: collapse byte-identical duplicate datasets
 *  (repointing visuals/embeds and the editor's dataset/version pins), then
 *  delete orphans. Runs once per browser (marker-guarded); must never throw
 *  — a failed cleanup logs, skips the marker (so it retries next launch),
 *  and first paint proceeds. Call AFTER applyExampleSeed so seeded datasets
 *  are judged against the seeded visuals that reference them. */
export const runDatasetStoreCleanup = async (): Promise<void> => {
	try {
		// Local-store maintenance only: this walks the IndexedDB layer directly,
		// beneath the adapter seam. In server mode the server is the store —
		// sweeping a stale local mirror here would report deletions the server
		// never sees and write the mirror back as truth. main.tsx already
		// returns before calling this in server mode; refusing here too makes
		// the invariant the mechanism's own, not call-site ordering's.
		if (getStorageAdapter().capabilities.remoteLoad) return
		if (loadDatasetCleanupDone() >= CLEANUP_VERSION) return

		const datasets = await loadDatasetsAsync()
		const deduped = dedupeDatasetStores({
			datasets,
			visuals: loadVisuals(),
			embeds: loadEmbedInstances(),
		})

		const currentDatasetId = loadCurrentDatasetId()
		const currentRemapped =
			currentDatasetId != null
				? deduped.datasetIdMap[currentDatasetId] ?? currentDatasetId
				: null
		const previewVersionId = loadPreviewVersionId()
		const previewRemapped =
			previewVersionId != null
				? deduped.versionIdMap[previewVersionId] ?? previewVersionId
				: null

		const swept = sweepOrphanDatasets({
			datasets: deduped.datasets,
			visuals: deduped.visuals,
			protectedIds: [currentRemapped],
		})

		// Historical orphaned fields: version deletion now prunes fields no
		// remaining version carries, but datasets touched before that fix can
		// still hold them. Pruning changes the canonical content, so the cached
		// hash must follow (datasetDedupe's invariant) — dedupe's backfill above
		// hashed the PRE-prune body.
		let fieldsPruned = 0
		const finalDatasets: Record<string, Dataset> = {}
		for (const [id, d] of Object.entries(swept.datasets)) {
			const pruned = pruneOrphanFields(d)
			if (pruned.fields.length === d.fields.length) {
				finalDatasets[id] = d
				continue
			}
			fieldsPruned += d.fields.length - pruned.fields.length
			finalDatasets[id] = withFreshContentHash(pruned)
		}

		// Datasets whose only change was dedupe's hash backfill/refresh (stale
		// creation-time hashes from before appends/deletes maintained them).
		// `deduped.changed` deliberately excludes these, so count them here —
		// they must persist or the false-match/duplicate-name trap stays live.
		const hashesRefreshed = Object.keys(deduped.datasets).filter(
			(id) =>
				datasets[id] !== undefined && deduped.datasets[id] !== datasets[id]
		).length

		if (deduped.changed) {
			// Awaited for the same reason as the seed apply: the visuals
			// atom's one-shot thumbnail merge must see the final store.
			await saveVisuals(deduped.visuals)
			saveEmbedInstances(deduped.embeds)
			if (currentRemapped !== currentDatasetId)
				saveCurrentDatasetId(currentRemapped)
			if (previewRemapped !== previewVersionId)
				savePreviewVersionId(previewRemapped)
		}
		// Removals are explicit. `saveDatasetsAsync` is upsert-only now that
		// bodies load on demand — a whole-map save can no longer be read as
		// "everything absent was deleted", so the sweep has to say which ids
		// it dropped. Collapsed duplicates count: the losing copy is gone.
		const removedIds = [
			...swept.removedIds,
			...Object.keys(deduped.datasetIdMap),
		].filter((id) => !(id in finalDatasets))

		const anythingChanged =
			deduped.changed ||
			swept.removedIds.length > 0 ||
			fieldsPruned > 0 ||
			hashesRefreshed > 0
		if (anythingChanged) {
			if (idbAvailable()) {
				await saveDatasetsAsync(finalDatasets)
				await deleteDatasetsAsync(removedIds)
			} else {
				saveDatasetsLocalFallback(finalDatasets)
			}
		}

		saveDatasetCleanupDone(CLEANUP_VERSION)
		if (anythingChanged) {
			// eslint-disable-next-line no-console
			console.info(
				`[vis-components] dataset cleanup: removed ${swept.removedIds.length} orphaned dataset(s), ` +
					`collapsed ${Object.keys(deduped.datasetIdMap).length} duplicate(s), ` +
					`pruned ${fieldsPruned} orphaned field(s), ` +
					`refreshed ${hashesRefreshed} content hash(es)`
			)
		}
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("[vis-components] dataset cleanup failed:", error)
	}
}
