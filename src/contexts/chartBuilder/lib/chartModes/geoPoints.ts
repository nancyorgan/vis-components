import type { ChartModeDef } from "./types"

/** Geographic point (lat/long dot) map: when the chart is in geographic
 *  coordinates and both `x` and `y` are mapped, each data row carries a raw
 *  longitude (x) and latitude (y) which is projected to a dot, drawn over an
 *  optional basemap. `area` mapped alongside is still a point map — it just
 *  sizes the dots (GeoPointPlot handles area sizing) — so it does NOT divert.
 *  `connection` mapped alongside also doesn't divert: x/y position wins (a
 *  region-keyed bubble/choropleth requires NO x/y). Activates only when both
 *  `x` and `y` name a field.
 *
 *  `mapConfig` is the 4th `detect` arg; when absent (cartesian callers) this
 *  mode never activates, so existing non-map scenarios are unaffected. */
export const GeoPointsMode: ChartModeDef = {
	id: "geo-points",
	detect: (encodings, _getType, _configs, mapConfig) => {
		if (mapConfig?.coordSystem !== "geographic") return false
		return !!encodings.x?.field && !!encodings.y?.field
	},
	legend: {
		hideLengthInThisMode: true,
		hideAngleInThisMode: true,
		hideConnectionInThisMode: true,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	annotations: {
		xValueChannel: "x",
		yValueChannel: "y",
		polarValueCoords: false,
	},
	canvas: {
		coordFamily: "geo",
		measureAxis: null,
	},
}
