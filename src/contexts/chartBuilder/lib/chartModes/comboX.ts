import type { ChartModeDef } from "./types"
import { comboOrientation } from "./combo"

/** `x + y + length` with Length drawn as bars → vertical bars (x = category,
 * length = measure) plus the y variable as scatter marks on the measure
 * axis — a line when Connection is mapped. See `combo.ts` for the gate and
 * the orientation rule. Rendered by BarPlot, which draws the bars exactly as
 * bars-x and adds the marks layer on top. */
export const ComboXMode: ChartModeDef = {
	id: "combo-x",
	detect: (encodings, getType, channelConfigs): boolean =>
		comboOrientation(encodings, getType, channelConfigs) === "x",
	legend: {
		hideLengthInThisMode: true,
		hideAngleInThisMode: false,
		hideConnectionInThisMode: false,
		reverseCategoricalOrder: true,
	},
	facet: {
		supportsSharedMeasureMax: true,
	},
	annotations: {
		xValueChannel: "x",
		// The vertical value axis is the measure axis (bars AND marks).
		yValueChannel: "length",
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
		// The marks layer joins into polylines by Connection, like scatter.
		connectionRole: "line",
		// The marks layer draws point glyphs (Default shape applies); bars
		// read the outline width as their cell border, as in bars-x.
		shapeRole: "glyph",
		// The marks layer sizes its points through the Area panel's default
		// size / px range.
		areaRole: "mark",
		mark: "bar",
		statOverlays: false,
		measureAxis: "y",
		resolveMeasureField: (encodings) => encodings.length?.field ?? null,
		supportsNegativeMeasure: true,
	},
}
