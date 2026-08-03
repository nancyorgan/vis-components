import type { FocusRegion, GeographyLevel, ProjectionName } from "../mapConfig"

/**
 * Resolve the concrete projection for a geography level + the user's projection
 * setting + an optional focus region.
 *
 * `albersUsa` is a US-only composite projection that returns null for non-US
 * points, so the `"auto"` setting must pick a world projection for the
 * `countries` level — otherwise most countries wouldn't render. Every other
 * level resolves `"auto"` to `albersUsa`. Explicit projections are honored
 * as-is (pass straight through).
 *
 * A `focusRegion` (a named region OR `"custom"`) pans + zooms to an arbitrary
 * part of the globe, which albersUsa (US-only, clips everything else) can't do
 * — so ANY focus forces a world projection. An explicit Mercator is honored;
 * anything else (auto, or even an explicit albersUsa) resolves to Natural Earth.
 *
 * Shared by every geographic renderer (GeoChoroplethPlot, GeoSymbolPlot, and
 * the lat/long dot map) so the resolution can never drift between them.
 */
export const resolveGeoProjection = (
	level: GeographyLevel,
	projection: ProjectionName | "auto",
	focusRegion: FocusRegion | "auto" | "custom" = "auto"
): ProjectionName =>
	focusRegion !== "auto"
		? projection === "mercator"
			? "mercator"
			: "naturalEarth"
		: projection !== "auto"
			? projection
			: level === "countries"
				? "naturalEarth"
				: "albersUsa"
