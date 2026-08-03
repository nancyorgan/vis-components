import { useEffect, useState } from "react"

import { loadGeometry, type GeometryBundle } from "../lib/geo/loadGeometry"
import type { GeographyLevel } from "../lib/mapConfig"

/** Load (and cache) the decoded geometry bundle for `level`, exposing it as
 *  React state. While the promise is in flight, `loading` is true and `bundle`
 *  is null; once resolved it carries the features/table/centroids. Re-runs when
 *  the level changes. `loadGeometry` is memoized per level, so repeat mounts
 *  share the same promise.
 *
 *  Pass `null` to load nothing (bundle stays null, loading false) — used for an
 *  optional backdrop layer that only some projections need, where the hook must
 *  still be called unconditionally.
 *
 *  Shared by the map renderers (GeoChoroplethPlot, GeoSymbolPlot) and the
 *  Maps-section join-status hook (useGeoResolution) so there's a single source
 *  of truth for the load/cancel/catch lifecycle. */
export const useGeometry = (
	level: GeographyLevel | null
): { bundle: GeometryBundle | null; loading: boolean } => {
	const [bundle, setBundle] = useState<GeometryBundle | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		if (level === null) {
			setBundle(null)
			setLoading(false)
			return
		}
		let cancelled = false
		setLoading(true)
		setBundle(null)
		loadGeometry(level)
			.then((b) => {
				if (cancelled) return
				setBundle(b)
				setLoading(false)
			})
			.catch(() => {
				// Unimplemented levels reject; surface as "no geometry" rather than
				// throwing, so the renderer can show the loading placeholder.
				if (cancelled) return
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [level])

	return { bundle, loading }
}
