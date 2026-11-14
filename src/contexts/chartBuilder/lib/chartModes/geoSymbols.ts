import type { ChartModeDef } from "./types"

/** Geographic symbol (bubble) map: when the chart is in geographic coordinates
 *  and the `connection` channel names a region key (e.g. state, county) AND the
 *  `area` channel is mapped, each region gets a bubble whose size encodes its
 *  measure, drawn over an optional basemap. Activates only when both
 *  `connection` and `area` are mapped and neither `x` nor `y` is — x/y mapped
 *  under geographic coords means a point/symbol map (lat/lon), not this
 *  region-keyed bubble map. `connection` WITHOUT `area` is a choropleth.
 *
 *  `mapConfig` is the 4th `detect` arg; when absent (cartesian callers) this
 *  mode never activates, so existing non-map scenarios are unaffected. */
export const GeoSymbolsMode: ChartModeDef = {
	id: "geo-symbols",
	detect: (encodings, _getType, _configs, mapConfig) => {
		if (mapConfig?.coordSystem !== "geographic") return false
		return (
			!!encodings.connection?.field &&
			!!encodings.area?.field &&
			!encodings.x?.field &&
			!encodings.y?.field
		)
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
		// No value axes: the panel is a projection, not a pair of position
		// scales, so a "data units" coordinate has nothing to scale against
		// (a linear lon/lat scale over the panel rect would NOT match the
		// projected marks). Value mode is disabled.
		xValueChannel: null,
		yValueChannel: null,
		polarValueCoords: false,
	},
	labels: {
		placement: "mark",
		positionLockedToAxes: false,
		seriesEndpoints: false,
		containerRimLabels: false,
	},
	canvas: {
		coordFamily: "geo",
		cartesianAxes: { x: false, y: false },
		lengthRole: "none",
		connectionRole: "key",
		shapeRole: "outline",
		areaRole: "mark",
		mark: "region",
		statOverlays: false,
		geo: { marks: "symbols", position: "region" },
		measureAxis: null,
	},
}
