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
 *    orphaned (see docs/plans/2026-08-05-orphan-dataset-cleanup-design.md,
 *    kept outside the repo). */

import { pruneOrphanFields } from "./datasetCompat"
import { dedupeDatasetStores } from "./datasetDedupe"
import {
	idbAvailable,
} from "./storage/idb"
import {
	loadCurrentDatasetId,
	loadDatasetCleanupDone,
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
import type { Dataset, Visual } from "./types"

/** Bump to make {@link runDatasetStoreCleanup} run once more in browsers
 *  that already completed an earlier version.
 *  v2: prune orphaned fields left behind by deleted additive versions. */
const CLEANUP_VERSION = 2

export type SweepInput = {
	datasets: Record<string, Dataset>
	visuals: Visual[]
	/** Dataset ids that must survive even when no visual references them —
	 *  the editor's persisted current dataset (an upload not yet saved as a
	 *  visual is live work in progress). Nulls are ignored. */
	protectedIds?: readonly (string | null)[]
}

export type SweepResult = {
	datasets: Record<string, Dataset>
	removedIds: string[]
}

/** Drop every dataset that no visual references and no protected id names.
 *  Pure; returns the input record unchanged (same reference) when there is
 *  nothing to remove. */
export const sweepOrphanDatasets = ({
	datasets,
	visuals,
	protectedIds = [],
}: SweepInput): SweepResult => {
	const referenced = new Set<string>()
	for (const v of visuals) if (v.datasetId != null) referenced.add(v.datasetId)
	for (const id of protectedIds) if (id != null) referenced.add(id)

	const removedIds = Object.keys(datasets).filter((id) => !referenced.has(id))
	if (removedIds.length === 0) return { datasets, removedIds }

	const kept: Record<string, Dataset> = {}
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
		// still hold them.
		let fieldsPruned = 0
		const finalDatasets: Record<string, Dataset> = {}
		for (const [id, d] of Object.entries(swept.datasets)) {
			const pruned = pruneOrphanFields(d)
			fieldsPruned += d.fields.length - pruned.fields.length
			finalDatasets[id] = pruned
		}

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
		if (deduped.changed || swept.removedIds.length > 0 || fieldsPruned > 0) {
			if (idbAvailable()) {
				await saveDatasetsAsync(finalDatasets)
			} else {
				saveDatasetsLocalFallback(finalDatasets)
			}
		}

		saveDatasetCleanupDone(CLEANUP_VERSION)
		if (swept.removedIds.length > 0 || deduped.changed || fieldsPruned > 0) {
			// eslint-disable-next-line no-console
			console.info(
				`[vis-components] dataset cleanup: removed ${swept.removedIds.length} orphaned dataset(s), ` +
					`collapsed ${Object.keys(deduped.datasetIdMap).length} duplicate(s), ` +
					`pruned ${fieldsPruned} orphaned field(s)`
			)
		}
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("[vis-components] dataset cleanup failed:", error)
	}
}
