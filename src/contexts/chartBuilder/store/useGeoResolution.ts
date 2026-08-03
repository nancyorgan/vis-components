import { useMemo } from "react"
import { useAtomValue } from "jotai"
import { resolveGeography } from "../lib/geo/resolveGeography"
import type { GeographyLevel, RegionKeyType } from "../lib/mapConfig"
import { currentEncodingsAtom, currentMapConfigAtom } from "./atoms"
import { useCurrentDatasetView } from "./useCurrentDatasetView"
import { useGeometry } from "./useGeometry"

/** What the Maps section's match-status UI needs to render:
 *  "{matchedCount} of {total} matched — {unmatched.length} unmatched (show)".
 *  `keyType` is the format the values were interpreted as (auto-detected or
 *  the user's override); `loading` is true while geometry is in flight or no
 *  dataset/connection is bound yet. */
export type GeoResolutionStatus = {
	keyType: RegionKeyType | undefined
	matchedCount: number
	unmatched: string[]
	total: number
	loading: boolean
}

const EMPTY: GeoResolutionStatus = {
	keyType: undefined,
	matchedCount: 0,
	unmatched: [],
	total: 0,
	loading: true,
}

/**
 * Resolve the current connection field against the active geography level and
 * report join status for the sidebar. Geometry loads async (loadGeometry is a
 * memoized promise) so we lean on the shared `useGeometry` hook to load the
 * bundle and return a safe loading shape until it lands.
 */
export const useGeoResolution = (): GeoResolutionStatus => {
	const encodings = useAtomValue(currentEncodingsAtom)
	const mapConfig = useAtomValue(currentMapConfigAtom)
	const dataset = useCurrentDatasetView()

	// Phase 1 implements states only; "auto" resolves to states (mirrors the
	// renderer's choice in GeoChoroplethPlot).
	const level: GeographyLevel =
		mapConfig.geographyLevel === "auto" ? "states" : mapConfig.geographyLevel

	const { bundle, loading } = useGeometry(level)

	const regionField = encodings.connection.field
	const keyTypeOverride: RegionKeyType | undefined =
		mapConfig.keyType === "auto" ? undefined : mapConfig.keyType

	return useMemo<GeoResolutionStatus>(() => {
		if (loading) return EMPTY
		if (!bundle || !regionField || !dataset) return { ...EMPTY, loading: false }
		const values = dataset.rows.map((r) => String(r[regionField] ?? ""))
		const { keyType, matched, unmatched } = resolveGeography(
			values,
			bundle.table,
			keyTypeOverride
		)
		return {
			keyType,
			matchedCount: matched.size,
			unmatched,
			// Distinct input values = matched + unmatched.
			total: matched.size + unmatched.length,
			loading: false,
		}
	}, [loading, bundle, regionField, dataset, keyTypeOverride])
}
