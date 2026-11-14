import type { ChartModeDef } from "./types"
import { comboOrientation } from "./combo"

/** Horizontal twin of combo-x: y = category, length = measure along x, and
 * the x variable's marks ride the horizontal measure axis. Selected only
 * when y reads as a category and x is quantitative (see `combo.ts`). */
export const ComboYMode: ChartModeDef = {
	id: "combo-y",
	detect: (encodings, getType, channelConfigs): boolean =>
		comboOrientation(encodings, getType, channelConfigs) === "y",
	legend: {
		hideLengthInThisMode: true,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: false,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: true,
	},
	annotations: {
		xValueChannel: "length",
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
		lengthRole: "measure",
		connectionRole: "line",
		shapeRole: "glyph",
		areaRole: "mark",
		mark: "bar",
		statOverlays: false,
		measureAxis: "x",
		resolveMeasureField: (encodings) => encodings.length?.field ?? null,
		supportsNegativeMeasure: true,
	},
}
