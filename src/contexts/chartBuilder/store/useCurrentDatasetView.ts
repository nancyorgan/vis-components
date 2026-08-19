import { atom, useAtomValue } from "jotai"
import { applyReshapeToView } from "../lib/reshape"
import { resolveDatasetView } from "../lib/resolveDatasetVersion"
import type { DatasetView } from "../lib/types"

import {
	currentDatasetIdAtom,
	currentReshapeConfigAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "./atoms"

/** The currently-bound dataset resolved to a flat DatasetView at the latest
 * version (or the preview version, when one is pinned), BEFORE the
 * wide→long reshape. Only reshape-adjacent code should read this — the
 * Reshape panel needs the wide column list, and the upload/version flows
 * compare against the raw `Dataset` directly. Everything else wants
 * {@link currentDatasetViewAtom}. */
export const currentRawDatasetViewAtom = atom(
	(get): DatasetView | undefined => {
		const datasetId = get(currentDatasetIdAtom)
		if (!datasetId) return undefined
		return resolveDatasetView(
			get(datasetsAtom)[datasetId],
			get(previewVersionIdAtom)
		)
	}
)

/** The dataset view the editor renders: the raw view with the per-visual
 * wide→long reshape applied when active. A derived atom rather than a
 * per-component derive so the view (and its `fields`/`rows` arrays) keeps a
 * stable identity between store updates — memos and effects may key on it
 * safely. */
export const currentDatasetViewAtom = atom((get): DatasetView | undefined =>
	applyReshapeToView(
		get(currentRawDatasetViewAtom),
		get(currentReshapeConfigAtom)
	)
)

/** True when the reshape is actively transforming the current view —
 * `applyReshapeToView` passes the raw view through by identity when it
 * doesn't apply, so an object comparison is exact. Drives the tray button's
 * "Reshape ✓" active state. */
export const reshapeAppliedAtom = atom((get): boolean => {
	const raw = get(currentRawDatasetViewAtom)
	return raw !== undefined && get(currentDatasetViewAtom) !== raw
})

/**
 * Resolve the currently-bound dataset to a flat DatasetView at the latest
 * version (or, if a preview version is active, that version), with the
 * per-visual wide→long reshape applied when one is active. Returns
 * `undefined` when no dataset is bound or it can't be resolved.
 *
 * Editor consumers (chart canvas, encoding shelves, channel panels,
 * data drawer) should use this rather than reaching into `datasetsAtom`
 * directly, so version selection, the reshape, and live updates flow
 * through one place.
 */
export const useCurrentDatasetView = (): DatasetView | undefined =>
	useAtomValue(currentDatasetViewAtom)
