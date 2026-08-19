import { geoContains } from "d3-geo"
import type { Feature } from "geojson"

/** Build the "is this pixel open map space?" predicate the geo data-label
 * overlap spread uses to steer displaced labels toward ocean and no-data
 * regions — anywhere a label can't land on top of another region's marks.
 * A pixel is OPEN unless it falls inside a feature that carries data
 * (`occupiedIds`, the map's own region join).
 *
 * Pixel-space bounding boxes prefilter the occupied features; only bbox
 * hits pay the exact test (invert the pixel back to [lon, lat] once, then
 * `geoContains` per hit). The bbox cache builds lazily on the FIRST call,
 * so charts whose labels never collide pay nothing. A pixel the projection
 * can't invert (outside a composite projection like albersUsa) is open by
 * definition — nothing is drawn there. */
export const buildOpenSpacePredicate = ({
	features,
	occupiedIds,
	bounds,
	invert,
}: {
	features: Feature[]
	/** Canonical feature ids (the bundle normalizes `feature.id` in place)
	 *  of regions matched to a data row. Empty set → everything is open,
	 *  and the predicate degenerates to `true` (no preference). */
	occupiedIds: ReadonlySet<string>
	/** Projected pixel bounds of a feature — `geoPath.bounds`. */
	bounds: (f: Feature) => [[number, number], [number, number]]
	/** Pixel → [lon, lat], or null when the pixel is outside the
	 *  projection's invertible area. */
	invert: (pixel: [number, number]) => [number, number] | null
}): ((x: number, y: number) => boolean) => {
	type Entry = { f: Feature; b: [[number, number], [number, number]] }
	let occupied: Entry[] | null = null
	return (x, y) => {
		if (occupied === null) {
			occupied = features
				.filter((f) => occupiedIds.has(String(f.id ?? "")))
				.map((f) => ({ f, b: bounds(f) }))
		}
		let lonlat: [number, number] | null | undefined
		for (const { f, b } of occupied) {
			if (x < b[0][0] || x > b[1][0] || y < b[0][1] || y > b[1][1]) continue
			if (lonlat === undefined) lonlat = invert([x, y])
			if (lonlat === null) return true
			if (geoContains(f, lonlat)) return false
		}
		return true
	}
}
