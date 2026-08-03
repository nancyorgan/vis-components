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
	canvas: {
		coordFamily: "cartesian",
		measureAxis: null,
	},
}
