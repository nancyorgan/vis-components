import { hexbinEligible, hexbinSourceOf } from "../hexbinMeasure"
import type { ChartModeDef } from "./types"

/** Hexbin: a continuous×continuous scatter whose hue varies by the derived
 * "Point count" — points bin onto a hex lattice, cells color by density.
 * The hue mapping IS the mode trigger (no toggle); losing the gating (x/y
 * unmapped or non-quantitative) falls back to scatter, which ignores the
 * dangling `measureSource` (hue behaves as unmapped). */
export const HexbinMode: ChartModeDef = {
	id: "hexbin",
	detect: (encodings, getType) =>
		hexbinSourceOf(encodings.hue) === "hexCount" &&
		hexbinEligible(encodings, getType),
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
	canvas: {
		coordFamily: "cartesian",
		measureAxis: null,
	},
}
