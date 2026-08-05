import { useEffect, useMemo, useState } from "react"
import { useAtomValue } from "jotai"

import { detectGeographyLevel } from "../lib/geo/detectGeographyLevel"
import type { GeographyLevel, RegionKeyType } from "../lib/mapConfig"
import { resolveDatasetView } from "../lib/resolveDatasetVersion"
import {
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentMapConfigAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "./atoms"

/**
 * The concrete geography level the map should use — the ONE home for
 * resolving `mapConfig.geographyLevel: "auto"`, shared by the renderers
 * (via useGeoMapScaffold), the match status (useGeoResolution) and the Maps
 * sidebar, so they can never disagree.
 *
 * An explicit level passes straight through. `"auto"` detects the level from
 * the connection field's values (states / counties / countries — see
 * detectGeographyLevel); with no connection field or no dataset there is
 * nothing to detect and auto falls back to states, the legacy meaning (this
 * keeps the lat/long dot map, which doesn't use connection, on states).
 *
 * Returns `null` while detection is in flight — callers treat it like
 * geometry that hasn't loaded yet (loading placeholder / match-status
 * "Checking matches…").
 */
export const useEffectiveGeographyLevel = (): GeographyLevel | null => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	// NOT useCurrentDatasetView(): that helper re-derives a fresh DatasetView
	// object every render, and the detection effect below keys on the dataset
	// — an unstable identity would reset detection each render and loop
	// forever at "loading". Memoizing on the underlying atom values (stable
	// between real updates) keeps the effect quiescent.
	const datasets = useAtomValue(datasetsAtom)
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const previewVersionId = useAtomValue(previewVersionIdAtom)
	const dataset = useMemo(
		() =>
			datasetId
				? resolveDatasetView(datasets[datasetId], previewVersionId)
				: undefined,
		[datasets, datasetId, previewVersionId]
	)

	const configured = mapConfig.geographyLevel
	const regionField = encodings.connection.field
	const keyTypeOverride: RegionKeyType | undefined =
		mapConfig.keyType === "auto" ? undefined : mapConfig.keyType

	// The values detection scores — null when not in detection mode (explicit
	// level, or nothing mapped), so the effect below has a single gate. Always
	// the FULL dataset's rows, not a facet panel's subset: the level is
	// chart-wide, so every panel must resolve the same one.
	const values = useMemo(() => {
		if (configured !== "auto" || !regionField || !dataset) return null
		return dataset.rows.map((r) => String(r[regionField] ?? ""))
	}, [configured, regionField, dataset])

	const [detected, setDetected] = useState<GeographyLevel | null>(null)
	useEffect(() => {
		if (values === null) return
		let cancelled = false
		setDetected(null)
		detectGeographyLevel(values, keyTypeOverride).then((level) => {
			if (!cancelled) setDetected(level)
		})
		return () => {
			cancelled = true
		}
	}, [values, keyTypeOverride])

	if (configured !== "auto") return configured
	if (!regionField || !dataset) return "states"
	return detected
}
