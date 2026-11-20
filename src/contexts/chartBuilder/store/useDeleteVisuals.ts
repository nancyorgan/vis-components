import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { removeInstancesForVisual } from "../lib/embedInstances"
import { unpublishEmbedRequest } from "../lib/embedPublish"
import { restoreVisuals, trashVisuals } from "../lib/visualTrash"

import {
	embedInstancesAtom,
	foldersAtom,
	republishOnSaveVisualsAtom,
	visualsAtom,
	withRepublishOnSave,
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
 * embed instances go (the landing page must not refer to missing ids). The
 * data set STAYS: it lives in the library's Data tab, where another
 * visualization can be started from it and where it is deleted by hand.
 * Reached only from the Trash panel (Delete forever / Empty trash). */
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
			// This device's "Republish on every save" choices for the purged
			// visuals have nothing left to apply to.
			set(republishOnSaveVisualsAtom, (prev) =>
				[...ids].reduce((acc, id) => withRepublishOnSave(acc, id, false), prev)
			)
		}, [])
	)
