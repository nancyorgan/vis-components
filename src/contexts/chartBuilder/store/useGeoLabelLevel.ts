import { useEffect, useMemo, useState } from "react"
import { useAtomValue } from "jotai"

import { detectGeographyLevel } from "../lib/geo/detectGeographyLevel"
import type { GeographyLevel } from "../lib/mapConfig"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"

/**
 * The geography level the Data Labels `geography` channel joins at,
 * auto-detected from THAT field's values (same two-stage scoring as the
 * map's own auto level — see detectGeographyLevel). Independent of
 * `mapConfig.geographyLevel` by design: labeling state values on a county
 * choropleth means the label field detects "states" while the map draws
 * counties. The scaffold skips this hook (passes `field: null`) when the
 * label field IS the map's region field and reuses the map's effective
 * level instead, so the two can't disagree there.
 *
 * Detection runs on the FULL dataset's rows (not a facet panel's subset) —
 * the level is chart-wide. Returns `null` while detection is in flight or
 * when there's nothing to detect; callers treat that as "no label geometry".
 */
export const useGeoLabelLevel = (field: string | null): GeographyLevel | null => {
	// Cached derived view (stable identity between real updates) so the
	// detection effect can key on it without looping — never the unmemoized
	// useCurrentDatasetView() result (see the maps auto-level gotcha).
	const dataset = useAtomValue(currentDatasetViewAtom)

	const values = useMemo(() => {
		if (!field || !dataset) return null
		return dataset.rows.map((r) => String(r[field] ?? ""))
	}, [field, dataset])

	const [detected, setDetected] = useState<GeographyLevel | null>(null)
	useEffect(() => {
		if (values === null) return
		let cancelled = false
		setDetected(null)
		detectGeographyLevel(values).then((level) => {
			if (!cancelled) setDetected(level)
		})
		return () => {
			cancelled = true
		}
	}, [values])

	if (!field || !dataset) return null
	return detected
}
