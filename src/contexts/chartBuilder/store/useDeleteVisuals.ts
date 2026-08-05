import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { removeInstancesForVisual } from "../lib/embedInstances"
import { sweepOrphanDatasets } from "../lib/datasetSweep"

import {
	currentDatasetIdAtom,
	datasetsAtom,
	embedInstancesAtom,
	visualsAtom,
} from "./atoms"

/** Delete visuals with full cascade: their embed instances go (the landing
 * page must not refer to missing ids), and any dataset left referenced by no
 * remaining visual goes with them — datasets have no UI of their own, so a
 * dataset's last visual is its last reachable reference. The editor's
 * current dataset is exempt (an upload not yet saved as a visual is live
 * work in progress). Shared by the single-visual delete button and the
 * library's bulk delete. */
export const useDeleteVisuals = () =>
	useAtomCallback(
		useCallback((get, set, visualIds: Iterable<string>) => {
			const ids = new Set(visualIds)
			const remaining = get(visualsAtom).filter((v) => !ids.has(v.id))
			set(visualsAtom, remaining)
			set(embedInstancesAtom, (prev) => {
				let next = prev
				for (const id of ids) next = removeInstancesForVisual(next, id)
				return next
			})
			const swept = sweepOrphanDatasets({
				datasets: get(datasetsAtom),
				visuals: remaining,
				protectedIds: [get(currentDatasetIdAtom)],
			})
			if (swept.removedIds.length > 0) set(datasetsAtom, swept.datasets)
		}, [])
	)
