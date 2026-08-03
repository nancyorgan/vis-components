import { useAtomValue } from "jotai"
import { resolveDatasetView } from "../lib/resolveDatasetVersion"
import type { DatasetView } from "../lib/types"

import {
	currentDatasetIdAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "./atoms"

/**
 * Resolve the currently-bound dataset to a flat DatasetView at the latest
 * version (or, if a preview version is active, that version). Returns
 * `undefined` when no dataset is bound or it can't be resolved.
 *
 * Editor consumers (chart canvas, encoding shelves, channel panels,
 * data drawer) should use this rather than reaching into `datasetsAtom`
 * directly, so version selection and live updates flow through one place.
 */
export const useCurrentDatasetView = (): DatasetView | undefined => {
	const datasets = useAtomValue(datasetsAtom)
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const previewVersionId = useAtomValue(previewVersionIdAtom)
	if (!datasetId) return undefined
	return resolveDatasetView(datasets[datasetId], previewVersionId)
}
