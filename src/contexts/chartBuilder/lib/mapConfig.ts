/** Master switch for the Maps section. `"noMap"` (the default) and `"cartesian"`
 *  both render the ordinary x/y chart with no basemap — they share a render path;
 *  `"noMap"` is just the neutral default so a fresh chart doesn't claim a
 *  coordinate system. Only `"geographic"` activates the map (projection, basemap,
 *  geo chart modes). */
export type CoordSystemKind = "noMap" | "cartesian" | "geographic"
export type GeographyLevel = "states" | "counties" | "zcta" | "countries"
export type ProjectionName = "albersUsa" | "naturalEarth" | "mercator"
// "zip" = 5-digit ZIP/ZCTA codes (the zcta level's only key type). Adding a
// union member needs no mapConfig migration: persisted keyType values stay
// valid, and "zip" is only ever written going forward.
export type RegionKeyType = "fips" | "zip" | "abbrev" | "iso" | "name"

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
	/** Optional pattern overlay for no-data regions: an index into
	 *  `PATTERN_PALETTE` (lib/patterns), or null (default) for the solid
	 *  `noDataFill`. Applies to regions absent from the dataset and to matched
	 *  rows whose mapped measure value is blank/NA — NOT to maps with no
	 *  measure mapped at all (there every region is "no measure", not
	 *  "missing data"). */
	noDataPattern: number | null
	/** Ink color for `noDataPattern` (the pattern tiles' background is
	 *  `noDataFill`). Inert while `noDataPattern` is null. */
	noDataPatternInk: string
	/** When true (default), every basemap feature draws — regions with no
	 *  matching data row are painted with `noDataFill`, exactly like a matched
	 *  row whose measure value is blank/NA. When false, only regions that join
	 *  to a data row are drawn; the rest of the basemap is omitted. */
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
	noDataPattern: null,
	noDataPatternInk: "#a8a29e", // stone-400 — subtle over the stone-200 fill
	showNoDataRegions: true,
	showBasemap: true,
}
