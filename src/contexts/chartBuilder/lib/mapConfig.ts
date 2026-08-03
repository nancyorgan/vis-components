/** Master switch for the Maps section. `"noMap"` (the default) and `"cartesian"`
 *  both render the ordinary x/y chart with no basemap — they share a render path;
 *  `"noMap"` is just the neutral default so a fresh chart doesn't claim a
 *  coordinate system. Only `"geographic"` activates the map (projection, basemap,
 *  geo chart modes). */
export type CoordSystemKind = "noMap" | "cartesian" | "geographic"
export type GeographyLevel = "states" | "counties" | "zcta" | "countries"
export type ProjectionName = "albersUsa" | "naturalEarth" | "mercator"
export type RegionKeyType = "fips" | "abbrev" | "iso" | "name"

/** A continent / sub-continental region the map can center on. Selecting one
 *  pans + zooms the projection to that region's extent (see `focusRegion.ts`);
 *  `"auto"` (the default) fits to the loaded geometry, the legacy behavior. */
export type FocusRegion =
	| "northAmerica"
	| "southAmerica"
	| "centralAmerica"
	| "europe"
	| "asia"
	| "africa"
	| "middleEast"
	| "oceania"
	| "australia"
	| "antarctica"

/** A user-defined map viewport as a lon/lat bounding box, used by the `"custom"`
 *  focus (drag-to-pan + scroll/keyboard-zoom). Stored instead of a pixel
 *  transform so it survives panel resizes — the projection re-fits the box to
 *  whatever size the panel is. `west < east`, `south < north`. */
export type GeoViewport = {
	west: number
	south: number
	east: number
	north: number
}

export const GEOGRAPHY_LEVELS: GeographyLevel[] = [
	"states",
	"counties",
	"zcta",
	"countries",
]
export const PROJECTIONS: ProjectionName[] = ["albersUsa", "naturalEarth", "mercator"]
// Listed in the order they appear in the Focus dropdown.
export const FOCUS_REGIONS: FocusRegion[] = [
	"northAmerica",
	"southAmerica",
	"centralAmerica",
	"europe",
	"asia",
	"africa",
	"middleEast",
	"oceania",
	"australia",
	"antarctica",
]

export type MapConfig = {
	coordSystem: CoordSystemKind
	projection: ProjectionName | "auto"
	geographyLevel: GeographyLevel | "auto"
	keyType: RegionKeyType | "auto"
	/** Center + zoom the map on a continent/region. `"auto"` fits to the loaded
	 *  geometry (legacy behavior). A specific region forces a world projection
	 *  (albersUsa is US-only and would clip the rest of the globe). `"custom"`
	 *  uses the user-dragged `customViewport`. */
	focusRegion: FocusRegion | "auto" | "custom"
	/** The viewport for `focusRegion: "custom"` — the box the user pans/zooms.
	 *  Null until they switch to Custom (then it's seeded from the current view).
	 *  Like a region, a custom viewport forces a world projection. */
	customViewport: GeoViewport | null
	noDataFill: string
	/** When true, every basemap feature draws — regions with no matching data
	 *  row are painted with `noDataFill`. When false (default), only regions
	 *  that join to a data row are drawn; the rest of the basemap is omitted. */
	showNoDataRegions: boolean
	/** When true (default), the geography region outlines draw as a backdrop
	 *  behind the data marks (e.g. the Phase 3 bubble map). When false, the
	 *  basemap is omitted and only the data marks render. */
	showBasemap: boolean
}

export const DEFAULT_MAP_CONFIG: MapConfig = {
	coordSystem: "noMap",
	projection: "auto",
	geographyLevel: "auto",
	keyType: "auto",
	focusRegion: "auto",
	customViewport: null,
	noDataFill: "#e7e5e4", // stone-200
	showNoDataRegions: false,
	showBasemap: true,
}
