import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { removeInstancesForVisual } from "../lib/embedInstances"
import { unpublishEmbedRequest } from "../lib/embedPublish"
import { sweepOrphanDatasets } from "../lib/datasetSweep"
import { restoreVisuals, trashVisuals } from "../lib/visualTrash"

import {
	currentDatasetIdAtom,
	datasetIndexAtom,
	deleteDatasetsAtom,
	embedInstancesAtom,
	foldersAtom,
	visualsAtom,
} from "./atoms"

/** Move visuals to the Trash. Nothing cascades: the visual keeps its row,
 * thumbnail, embed instances, published files and data set, so Restore can
 * bring it back whole. The library hides it (`liveVisualsAtom`) and the
 * editor refuses to open it (`useLoadVisual`). Shared by the card's trash
 * icon, the table row's Delete and the library's bulk Delete. */
export const useTrashVisuals = () =>
	useAtomCallback(
		useCallback((_get, set, visualIds: Iterable<string>) => {
			set(visualsAtom, (prev) => trashVisuals(prev, visualIds))
		}, [])
	)

/** Bring trashed visuals back into the library, at the root if their
 * folder is gone and with a "(restored)" suffix if a live visual has
 * taken their name since (see `restoreVisuals`). */
export const useRestoreVisuals = () =>
	useAtomCallback(
		useCallback((get, set, visualIds: Iterable<string>) => {
			const folders = get(foldersAtom)
			set(visualsAtom, (prev) => restoreVisuals(prev, visualIds, folders))
		}, [])
	)

/** Delete visuals for good, with full cascade: their published embed files
 * go first (public URLs must not outlive the visual they render), their
 * embed instances go (the landing page must not refer to missing ids), and
 * any dataset left referenced by no remaining visual goes with them —
 * datasets have no UI of their own, so a dataset's last visual is its last
 * reachable reference. "Remaining" includes visuals still in the Trash:
 * they hold their data sets until they are purged themselves. The editor's
 * current dataset is exempt (an upload not yet saved as a visual is live
 * work in progress). Reached only from the Trash panel (Delete forever /
 * Empty trash). */
export const usePurgeVisuals = () =>
	useAtomCallback(
		useCallback((get, set, visualIds: Iterable<string>) => {
			const ids = new Set(visualIds)
			const remaining = get(visualsAtom).filter((v) => !ids.has(v.id))
			// Unpublish before the instances are dropped (afterwards the
			// publishIds are unknowable). Fire-and-forget: a failed DELETE
			// leaves an orphaned public file, which is regrettable but must
			// not block the local delete the user asked for.
			for (const instance of Object.values(get(embedInstancesAtom))) {
				if (ids.has(instance.visualId) && instance.publishId !== undefined) {
					void unpublishEmbedRequest(instance.publishId).catch(() => undefined)
				}
			}
			set(visualsAtom, remaining)
			set(embedInstancesAtom, (prev) => {
				let next = prev
				for (const id of ids) next = removeInstancesForVisual(next, id)
				return next
			})
			// Swept over the INDEX, not the loaded bodies: the index is the
			// authoritative list of what exists, and orphan-ness is a question
			// about references, which needs no rows. Sweeping the loaded map
			// would only ever consider the handful of datasets this session
			// happened to open.
			const swept = sweepOrphanDatasets({
				datasets: get(datasetIndexAtom),
				visuals: remaining,
				protectedIds: [get(currentDatasetIdAtom)],
			})
			if (swept.removedIds.length > 0) {
				set(deleteDatasetsAtom, swept.removedIds)
			}
		}, [])
	)
