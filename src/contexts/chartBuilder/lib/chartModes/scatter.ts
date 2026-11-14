import type { Encodings } from "../types"
import type { ChartModeDef } from "./types"

/** Scatter is the fallback mode: it selects whenever no more-specific
 * mode (bars, pies) matches. Always register it last. */
export const ScatterMode: ChartModeDef = {
	id: "scatter",
	detect: (_encodings: Encodings): boolean => true,
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: false,
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
	labels: {
		placement: "mark",
		positionLockedToAxes: false,
		seriesEndpoints: true,
		containerRimLabels: false,
	},
	canvas: {
		coordFamily: "cartesian",
		cartesianAxes: { x: true, y: true },
		lengthRole: "mark",
		connectionRole: "line",
		shapeRole: "glyph",
		areaRole: "mark",
		mark: "point",
		statOverlays: true,
		measureAxis: null,
	},
}
