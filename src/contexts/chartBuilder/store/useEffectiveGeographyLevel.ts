import { useEffect, useMemo, useState } from "react"
import { useAtomValue } from "jotai"

import { detectGeographyLevel } from "../lib/geo/detectGeographyLevel"
import type { GeographyLevel, RegionKeyType } from "../lib/mapConfig"
import { currentEncodingsAtom, currentMapConfigAtom } from "./atoms"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"

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
	// The derived view atom caches per store, so its identity is stable
	// between real updates — the detection effect below can key on it without
	// looping. (It also carries the wide→long reshape, so detection sees the
	// same fields/rows the chart renders.)
	const dataset = useAtomValue(currentDatasetViewAtom)

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
