import type { Encodings } from "../types"
import type { ChartModeDef } from "./types"

/** `x + angle` (no y, no length) → pies with categories along x-axis. */
export const PiesXMode: ChartModeDef = {
	id: "pies-x",
	detect: (encodings: Encodings): boolean => {
		const xMapped = !!encodings.x?.field
		const yMapped = !!encodings.y?.field
		const lengthMapped = !!encodings.length?.field
		const angleMapped = !!encodings.angle?.field
		return angleMapped && !lengthMapped && xMapped && !yMapped
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
