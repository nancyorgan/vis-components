import type { ChartModeDef } from "./types"

/** Geographic choropleth: when the chart is in geographic coordinates and the
 *  `connection` channel names a region key (e.g. state, county), each region's
 *  polygon is filled by its measure. Activates only when `connection` is mapped
 *  and neither `x` nor `y` is — x/y mapped under geographic coords means a
 *  point/symbol map, not a choropleth. `area` mapped alongside
 *  `connection` is a bubble map (geo-symbols), so it is excluded here too.
 *
 *  `mapConfig` is the 4th `detect` arg; when absent (cartesian callers) this
 *  mode never activates, so existing non-map scenarios are unaffected. */
export const GeoChoroplethMode: ChartModeDef = {
	id: "geo-choropleth",
	detect: (encodings, _getType, _configs, mapConfig) => {
		if (mapConfig?.coordSystem !== "geographic") return false
		return (
			!!encodings.connection?.field &&
			!encodings.area?.field &&
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
		areaRole: "none",
		mark: "region",
		statOverlays: false,
		geo: { marks: "regions", position: "region" },
		measureAxis: null,
	},
}
