import type { Encodings } from "../types"
import type { ChartModeDef } from "./types"

/** `y + angle` (no x, no length) → pies with categories along y-axis. */
export const PiesYMode: ChartModeDef = {
	id: "pies-y",
	detect: (encodings: Encodings): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const lengthMapped = !!encodings.length?.field
		const angleMapped = !!encodings.angle?.field
		return angleMapped && !lengthMapped && yMapped && !xMapped
	},
	legend: {
		hideLengthInThisMode: false,
		hideAngleInThisMode: true,
		hideConnectionInThisMode: false,
		reverseCategoricalOrder: false,
	},
	facet: {
		supportsSharedMeasureMax: false,
	},
	canvas: {
		coordFamily: "polar",
		measureAxis: null,
		polarUnit: "angleSum",
	},
}
