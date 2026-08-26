import { atom, useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"
import { applyPercentConversionToView } from "../lib/percentCells"
import { applyReshapeToView } from "../lib/reshape"
import {
	resolveDatasetView,
	resolveDatasetViewFromMeta,
	resolveVersionIdFromMeta,
} from "../lib/resolveDatasetVersion"
import type { DatasetView } from "../lib/types"

import {
	currentDatasetIdAtom,
	datasetIndexAtom,
	datasetIndexReadyAtom,
	datasetLoadStatesAtom,
	ensureDatasetLoadedAtom,
	loadedVersionRowsAtom,
	versionRowsKey,
	currentFieldOverridesAtom,
	currentReshapeConfigAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
	type DatasetLoadState,
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
		const preferredVersionId = get(previewVersionIdAtom)

		// A whole body in memory wins — a just-uploaded or just-imported
		// dataset is here before anything has been persisted, let alone split
		// into per-version bodies.
		const whole = get(loadedDatasetsAtom)[datasetId]
		if (whole) return resolveDatasetView(whole, preferredVersionId)

		// The lazy path: everything but the rows comes from the index, and the
		// rows are just the one version being drawn.
		const meta = get(datasetIndexAtom)[datasetId]
		const versionId = resolveVersionIdFromMeta(meta, preferredVersionId)
		if (!versionId) return undefined
		return resolveDatasetViewFromMeta(
			meta,
			get(loadedVersionRowsAtom)[versionRowsKey(datasetId, versionId)],
			preferredVersionId
		)
	}
)

/** The raw view with the per-visual wide→long reshape applied when active,
 * BEFORE percent-cell conversion. Kept as its own stage so
 * `reshapeAppliedAtom` can detect the reshape by identity without the
 * percent conversion registering as a reshape. */
const reshapedDatasetViewAtom = atom((get): DatasetView | undefined =>
	applyReshapeToView(
		get(currentRawDatasetViewAtom),
		get(currentReshapeConfigAtom)
	)
)

/** The dataset view the editor renders: the raw view with the per-visual
 * wide→long reshape applied when active, then percent-formatted cells
 * ("14%") converted to numeric fractions ("0.14") in columns the user has
 * overridden to quantitative. A derived atom rather than a per-component
 * derive so the view (and its `fields`/`rows` arrays) keeps a stable
 * identity between store updates — memos and effects may key on it
 * safely. */
export const currentDatasetViewAtom = atom((get): DatasetView | undefined =>
	applyPercentConversionToView(
		get(reshapedDatasetViewAtom),
		get(currentFieldOverridesAtom)
	)
)

/** True when the reshape is actively transforming the current view —
 * `applyReshapeToView` passes the raw view through by identity when it
 * doesn't apply, so an object comparison is exact. Drives the tray button's
 * "Reshape ✓" active state. Compares the reshape STAGE, not the final view,
 * so percent-cell conversion alone doesn't read as a reshape. */
export const reshapeAppliedAtom = atom((get): boolean => {
	const raw = get(currentRawDatasetViewAtom)
	return raw !== undefined && get(reshapedDatasetViewAtom) !== raw
})

/**
 * Resolve the currently-bound dataset to a flat DatasetView at the latest
 * version (or, if a preview version is active, that version), with the
 * per-visual wide→long reshape applied when one is active. Returns
 * `undefined` when no dataset is bound or it can't be resolved.
 *
 * Editor consumers (chart canvas, encoding shelves, channel panels,
 * data drawer) should use this rather than reaching into `loadedDatasetsAtom`
 * directly, so version selection, the reshape, and live updates flow
 * through one place.
 */
export const useCurrentDatasetView = (): DatasetView | undefined =>
	useAtomValue(currentDatasetViewAtom)

/** Whether the bound dataset's rows are here yet.
 *
 *  Derived from the SAME view the canvas renders, so the two can never
 *  disagree — a status computed from raw ingredients drifted from the view
 *  resolution once already. "loading" is the window this whole design
 *  creates: the visualization is known but its rows are still in flight. The
 *  canvas MUST render a distinct loading state through it rather than an
 *  empty chart — `chartLayoutReady` only checks that the plot SVG exists at
 *  a non-zero size, so a data-less chart reads as "ready and stable" to the
 *  thumbnail capture pipeline and gets saved as a blank preview. */
export const currentDatasetStatusAtom = atom(
	(get): DatasetLoadState | "absent" | "loading" | "ready" => {
		const datasetId = get(currentDatasetIdAtom)
		if (!datasetId) return "absent"
		if (get(currentRawDatasetViewAtom)) return "ready"
		const state = get(datasetLoadStatesAtom)[datasetId]
		if (state) return state
		// A body in memory that still resolves no view is a dataset with no
		// versions — the empty state, not a load in progress.
		if (get(loadedDatasetsAtom)[datasetId]) return "absent"
		return "loading"
	}
)

export const useCurrentDatasetStatus = () =>
	useAtomValue(currentDatasetStatusAtom)

/** Pull the bound dataset's rows in when the editor (or an embed) opens one.
 *  Mounted once per app shell; the action is idempotent per id. */
export const useEnsureCurrentDatasetLoaded = (): void => {
	const datasetId = useAtomValue(currentDatasetIdAtom)
	// Pinning an older version asks for different rows, so it re-triggers the
	// fetch just as switching dataset does. Without this, previewing v1 of a
	// dataset whose v3 is loaded would sit on the loading state forever.
	const previewVersionId = useAtomValue(previewVersionIdAtom)
	// The ensure action refuses to run before the index is authoritative (it
	// couldn't tell "not split yet" from "deleted"), so its no-op there must
	// be re-fired when readiness flips — this dep is what re-fires it.
	const indexReady = useAtomValue(datasetIndexReadyAtom)
	const ensure = useSetAtom(ensureDatasetLoadedAtom)
	useEffect(() => {
		ensure(datasetId)
	}, [datasetId, previewVersionId, indexReady, ensure])
}
