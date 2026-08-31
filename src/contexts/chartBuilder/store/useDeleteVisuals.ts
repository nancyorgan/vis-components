import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { removeInstancesForVisual } from "../lib/embedInstances"
import { unpublishEmbedRequest } from "../lib/embedPublish"
import { sweepOrphanDatasets } from "../lib/datasetSweep"

import {
	currentDatasetIdAtom,
	datasetIndexAtom,
	deleteDatasetsAtom,
	embedInstancesAtom,
	visualsAtom,
} from "./atoms"

/** Delete visuals with full cascade: their published embed files go first
 * (public URLs must not outlive the visual they render), their embed
 * instances go (the landing page must not refer to missing ids), and any
 * dataset left referenced by no remaining visual goes with them — datasets
 * have no UI of their own, so a dataset's last visual is its last reachable
 * reference. The editor's current dataset is exempt (an upload not yet saved
 * as a visual is live work in progress). Shared by the single-visual delete
 * button and the library's bulk delete. */
export const useDeleteVisuals = () =>
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
